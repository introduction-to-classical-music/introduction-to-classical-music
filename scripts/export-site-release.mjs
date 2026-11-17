import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditLibraryRoot,
  hashDirectory,
  normalizeSiteBase,
  parseCliArgs,
} from "./lib/library-ops.mjs";

function requiredArg(args, name) {
  const positionalIndex = name === "source" ? 0 : 1;
  const value = String(args[name] || args._[positionalIndex] || "").trim();
  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }
  return path.resolve(value);
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const args = parseCliArgs(process.argv.slice(2));
let temporaryRoot = "";

try {
  const sourceRoot = requiredArg(args, "source");
  const outputDir = requiredArg(args, "out");
  const siteBase = normalizeSiteBase(args.base || args._[2] || "/");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const sourceAudit = await auditLibraryRoot(sourceRoot, { mode: "working" });
  if (!sourceAudit.ok) {
    throw new Error("Source library audit failed; site was not built");
  }
  if (isInside(sourceRoot, outputDir)) {
    throw new Error("Site output must not be inside the source library");
  }

  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "icm-site-build-"));
  const temporaryLibrary = path.join(temporaryRoot, "library");
  await mkdir(temporaryLibrary, { recursive: true });
  await cp(path.join(sourceRoot, "library.manifest.json"), path.join(temporaryLibrary, "library.manifest.json"));
  await cp(path.join(sourceRoot, "content"), path.join(temporaryLibrary, "content"), { recursive: true });
  await cp(path.join(sourceRoot, "assets"), path.join(temporaryLibrary, "assets"), { recursive: true });

  process.env.ICM_REPO_ROOT = repoRoot;
  process.env.ICM_RUNTIME_MODE = "bundle";
  process.env.ICM_ACTIVE_LIBRARY_DIR = temporaryLibrary;
  process.env.ICM_DEFAULT_LIBRARY_DIR = temporaryLibrary;
  process.env.ICM_APP_DATA_DIR = path.join(temporaryRoot, "appdata");
  process.env.ICM_SITE_BASE = siteBase;

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const { buildLibrarySite } = await import("../output/runtime/packages/data-core/src/site-build-runner.js");
  const { auditSiteOutputForLocalPaths } = await import("../output/runtime/packages/data-core/src/site-output-audit.js");
  const buildResult = await buildLibrarySite({
    outputDir,
    siteBase,
    buildSource: "export",
    siteOutputMode: "public",
  });
  // W5/F15: verify the emitted files, not only the transformation. Public
  // artifacts must not contain local-resource endpoints or absolute paths.
  const outputAudit = await auditSiteOutputForLocalPaths(outputDir);
  if (!outputAudit.ok) {
    throw new Error(
      `Public site output audit failed (${JSON.stringify({
        localResourceUrls: outputAudit.localResourceUrls.slice(0, 5),
        absolutePathHits: outputAudit.absolutePathHits.slice(0, 5),
      })})`,
    );
  }
  await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const siteTree = await hashDirectory(outputDir, { exclude: ["site-release-manifest.json"] });
  const manifest = {
    libraryId: sourceAudit.manifest?.libraryId || "",
    libraryName: sourceAudit.manifest?.libraryName || "",
    appVersion: packageJson.version || "",
    builtAt: new Date().toISOString(),
    siteBase,
    siteOutputMode: buildResult.siteOutputMode,
    strippedLocalLinks: buildResult.strippedLocalLinks,
    sourceLocalResourceLinks: sourceAudit.counts?.localResourceLinks ?? 0,
    sourceDigest: sourceAudit.sourceDigest,
    siteDigest: siteTree.digest,
  };
  await writeFile(path.join(outputDir, "site-release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (buildResult.strippedLocalLinks > 0) {
    process.stderr.write(`已剥离 ${buildResult.strippedLocalLinks} 条本地链接（public 模式不导出本地路径）。\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ outputDir, manifest, outputAudit: { checkedFiles: outputAudit.checkedFiles } }, null, 2)}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
