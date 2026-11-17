import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimePaths } from "./app-paths.js";
import { getAppVersion } from "./app-version.js";
import { syncLibraryAssetsToBuildSite } from "./library-build.js";
import { writeGeneratedArtifacts } from "./library-store.js";
import { createSiteBuildEnvironment } from "./site-runtime.js";

function resolveRuntimeWorkingDirectory(repoRoot: string) {
  const normalized = path.resolve(repoRoot);
  return normalized.endsWith(".asar") ? path.dirname(normalized) : normalized;
}

async function resolveAstroPackagePath(repoRoot: string) {
  const packagedPath = path.join(repoRoot, "node_modules", "astro", "package.json");
  try {
    await access(packagedPath);
    return packagedPath;
  } catch {
    const fallbackPath = path.join(process.cwd(), "node_modules", "astro", "package.json");
    await access(fallbackPath);
    return fallbackPath;
  }
}

async function writeBuildRuntimeLog(message: string) {
  try {
    const runtimePaths = getRuntimePaths();
    await mkdir(runtimePaths.appData.logsDir, { recursive: true });
    await appendFile(
      path.join(runtimePaths.appData.logsDir, "site-build-runtime.log"),
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {
    // ignore build logging failures
  }
}

async function runAstroBuild(options: { outputDir?: string; siteBase?: string } = {}) {
  const runtimePaths = getRuntimePaths();
  const env = createSiteBuildEnvironment(process.env, options);
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  const astroPackagePath = await resolveAstroPackagePath(runtimePaths.repoRoot);
  const astroPackage = JSON.parse(await readFile(astroPackagePath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const astroBinRelativePath =
    typeof astroPackage.bin === "string"
      ? astroPackage.bin
      : typeof astroPackage.bin?.astro === "string"
        ? astroPackage.bin.astro
        : "astro.js";
  const astroCliPath = path.resolve(path.dirname(astroPackagePath), astroBinRelativePath);
  const astroRootDir = path.join(runtimePaths.repoRoot, "apps", "site");
  const astroCwd = resolveRuntimeWorkingDirectory(runtimePaths.repoRoot);
  await writeBuildRuntimeLog(`runAstroBuild: spawn ${process.execPath} ${astroCliPath} --root ${astroRootDir} cwd=${astroCwd}`);
  const child = spawn(process.execPath, [astroCliPath, "build", "--root", path.join(runtimePaths.repoRoot, "apps", "site")], {
    cwd: astroCwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => {
    void writeBuildRuntimeLog(`runAstroBuild: stdout ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on("data", (chunk) => {
    void writeBuildRuntimeLog(`runAstroBuild: stderr ${String(chunk).trimEnd()}`);
  });
  child.once("error", (error) => {
    void writeBuildRuntimeLog(`runAstroBuild: child error ${error.message}`);
  });
  const [code] = await once(child, "exit");
  await writeBuildRuntimeLog(`runAstroBuild: exit code=${String(code)}`);
  if (code !== 0) {
    throw new Error(`Astro build failed with exit code ${code}`);
  }
}

/**
 * Where a build came from, recorded in `.icm-build-meta.json` for traceability.
 * - `local`: desktop "open library site" build (default)
 * - `cli`: default-library / seed build (`scripts/build-library-site.ts`)
 * - `export`: public release export (`scripts/export-site-release.mjs`)
 */
export type LibrarySiteBuildSource = "local" | "cli" | "export";

export type BuildMetadataOptions = {
  buildSource?: LibrarySiteBuildSource;
  siteBase?: string;
};

export async function writeBuildMetadata(
  outputDir = getRuntimePaths().library.buildSiteDir,
  options: BuildMetadataOptions = {},
) {
  const resolvedOutputDir = path.resolve(outputDir);
  const metadataPath = path.join(resolvedOutputDir, ".icm-build-meta.json");
  const metadata: Record<string, unknown> = {
    appVersion: getAppVersion(),
    buildSource: options.buildSource || "local",
  };
  if (options.siteBase) {
    metadata.siteBase = options.siteBase;
  }
  metadata.builtAt = new Date().toISOString();
  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFileIfChanged(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function collectStaticTextFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectStaticTextFiles(target)));
    } else if (/\.(html|css|js|json)$/i.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

async function rewriteRelativeSiteLinks(outputDir: string, siteBase?: string) {
  if (siteBase !== "./") return;
  for (const filePath of await collectStaticTextFiles(outputDir)) {
    const relativeDirectory = path.relative(path.dirname(filePath), outputDir).replace(/\\/g, "/");
    const prefix = relativeDirectory ? `${relativeDirectory}/` : "./";
    const source = await readFile(filePath, "utf8");
    const rewritten = source.replace(/([\"'(])\/\.\/([^\"'\s)]+)/g, `$1${prefix}$2`);
    if (rewritten !== source) await writeFile(filePath, rewritten, "utf8");
  }
}

async function writeFileIfChanged(targetPath: string, content: string) {
  try {
    const existing = await readFile(targetPath, "utf8");
    if (existing === content) {
      return;
    }
  } catch {
    // write below
  }
  await writeFile(targetPath, content, "utf8");
}

export type LibrarySiteBuildOptions = {
  buildSource?: LibrarySiteBuildSource;
  includeLocalOnlyLinks?: boolean;
  outputDir?: string;
  siteBase?: string;
};

export async function buildLibrarySite(options: LibrarySiteBuildOptions = {}) {
  const runtimePaths = getRuntimePaths();
  const outputDir = path.resolve(options.outputDir || runtimePaths.library.buildSiteDir);
  const { buildSource, includeLocalOnlyLinks, siteBase } = options;
  await writeBuildRuntimeLog(`buildLibrarySite: begin root=${runtimePaths.library.rootDir}`);
  await writeBuildRuntimeLog("buildLibrarySite: writeGeneratedArtifacts:start");
  await writeGeneratedArtifacts({ includeLocalOnlyLinks });
  await writeBuildRuntimeLog("buildLibrarySite: writeGeneratedArtifacts:done");
  await writeBuildRuntimeLog("buildLibrarySite: runAstroBuild:start");
  await runAstroBuild({ outputDir, siteBase });
  await writeBuildRuntimeLog("buildLibrarySite: runAstroBuild:done");
  await writeBuildRuntimeLog("buildLibrarySite: syncLibraryAssets:start");
  await syncLibraryAssetsToBuildSite({
    assetsDir: runtimePaths.library.assetsDir,
    buildSiteDir: outputDir,
  });
  await rewriteRelativeSiteLinks(outputDir, siteBase);
  await writeBuildRuntimeLog("buildLibrarySite: syncLibraryAssets:done");
  await writeBuildMetadata(outputDir, { buildSource, siteBase });
  await writeBuildRuntimeLog("buildLibrarySite: writeBuildMetadata:done");
  return {
    outputDir,
  };
}
