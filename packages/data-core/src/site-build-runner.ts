import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, appendFile, mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimePaths } from "./app-paths.js";
import { getAppVersion } from "./app-version.js";
import { syncLibraryAssetsToBuildSite } from "./library-build.js";
import { writeGeneratedArtifacts } from "./library-store.js";
import { resolveSiteOutputMode, type SiteOutputMode } from "./resource-links.js";
import { createSiteBuildEnvironment } from "./site-runtime.js";
import { auditSiteOutputForLocalPaths, type SiteOutputAudit } from "./site-output-audit.js";

// Astro builds share caches under apps/site/.astro and node_modules; two CI
// test files (or an owner + CLI build) running concurrently can corrupt each
// other. Serialize builds across processes with a small lock file.
const ASTRO_BUILD_LOCK_TIMEOUT_MS = 240_000;
const ASTRO_BUILD_LOCK_POLL_MS = 250;
const ASTRO_BUILD_LOCK_STALE_MS = 10 * 60_000;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function acquireAstroBuildLock(repoRoot: string): Promise<() => Promise<void>> {
  const lockPath = path.join(repoRoot, "output", ".astro-build.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
          "utf8",
        );
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const content = await readFile(lockPath, "utf8");
          if (!content.includes(token)) {
            return; // another process owns a newer lock; never remove it
          }
          await unlink(lockPath);
        } catch {
          // already released or unreadable: nothing else to do
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStats = await stat(lockPath);
        if (Date.now() - lockStats.mtimeMs > ASTRO_BUILD_LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        // lock disappeared between open and stat: retry immediately
        continue;
      }
      if (Date.now() - startedAt > ASTRO_BUILD_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for the Astro build lock: ${lockPath}`);
      }
      await delay(ASTRO_BUILD_LOCK_POLL_MS);
    }
  }
}

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
  let stderrTail = "";
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrTail = `${stderrTail}${text}`.slice(-8000);
    void writeBuildRuntimeLog(`runAstroBuild: stderr ${text.trimEnd()}`);
  });
  child.once("error", (error) => {
    void writeBuildRuntimeLog(`runAstroBuild: child error ${error.message}`);
  });
  const [code] = await once(child, "exit");
  await writeBuildRuntimeLog(`runAstroBuild: exit code=${String(code)}`);
  if (code !== 0) {
    const diagnostic = stderrTail.trim();
    throw new Error(
      `Astro build failed with exit code ${code}${diagnostic ? `: ${diagnostic}` : " (no stderr captured)"}`,
    );
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
  siteOutputMode?: SiteOutputMode;
  strippedLocalLinks?: number;
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
    siteOutputMode: options.siteOutputMode || "public",
    strippedLocalLinks: options.strippedLocalLinks ?? 0,
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
  /** `public` (default) strips local/local-only links; `local` keeps them. */
  siteOutputMode?: SiteOutputMode;
};

export type LibrarySiteBuildResult = {
  outputDir: string;
  siteOutputMode: SiteOutputMode;
  strippedLocalLinks: number;
  outputAudit?: SiteOutputAudit;
};

export async function buildLibrarySite(options: LibrarySiteBuildOptions = {}): Promise<LibrarySiteBuildResult> {
  const runtimePaths = getRuntimePaths();
  const outputDir = path.resolve(options.outputDir || runtimePaths.library.buildSiteDir);
  const { buildSource, includeLocalOnlyLinks, siteBase } = options;
  const siteOutputMode = resolveSiteOutputMode({ siteOutputMode: options.siteOutputMode, includeLocalOnlyLinks });
  // W10b: generated indexes/search entries need the same base Astro builds with.
  // Explicit option > inherited env (desktop sets "/") > astro.config default.
  const generatedBasePath = String(options.siteBase ?? process.env.ICM_SITE_BASE ?? "/introduction-to-classical-music-sites/");
  await writeBuildRuntimeLog(`buildLibrarySite: begin root=${runtimePaths.library.rootDir} mode=${siteOutputMode}`);
  await writeBuildRuntimeLog("buildLibrarySite: writeGeneratedArtifacts:start");
  const generated = await writeGeneratedArtifacts({ siteOutputMode, basePath: generatedBasePath });
  await writeBuildRuntimeLog(
    `buildLibrarySite: writeGeneratedArtifacts:done strippedLocalLinks=${generated.strippedLocalLinks}`,
  );
  await writeBuildRuntimeLog("buildLibrarySite: runAstroBuild:start");
  const releaseBuildLock = await acquireAstroBuildLock(runtimePaths.repoRoot);
  try {
    await runAstroBuild({ outputDir, siteBase });
  } finally {
    await releaseBuildLock();
  }
  await writeBuildRuntimeLog("buildLibrarySite: runAstroBuild:done");
  await writeBuildRuntimeLog("buildLibrarySite: syncLibraryAssets:start");
  await syncLibraryAssetsToBuildSite({
    assetsDir: runtimePaths.library.assetsDir,
    buildSiteDir: outputDir,
  });
  await rewriteRelativeSiteLinks(outputDir, siteBase);
  await writeBuildRuntimeLog("buildLibrarySite: syncLibraryAssets:done");

  let outputAudit: SiteOutputAudit | undefined;
  if (siteOutputMode === "public") {
    outputAudit = await auditSiteOutputForLocalPaths(outputDir);
    if (outputAudit.localResourceUrls.length > 0) {
      const sample = outputAudit.localResourceUrls
        .slice(0, 3)
        .map((hit) => `${hit.path}:${hit.line}`)
        .join(", ");
      throw new Error(`Public site output still references /__local-resource (${sample}); local links were not stripped`);
    }
    if (outputAudit.absolutePathHits.length > 0) {
      await writeBuildRuntimeLog(
        `buildLibrarySite: public output contains ${outputAudit.absolutePathHits.length} absolute path hit(s); review before release`,
      );
    }
    await writeBuildRuntimeLog(
      `buildLibrarySite: public output audit ok files=${outputAudit.checkedFiles} strippedLocalLinks=${generated.strippedLocalLinks}`,
    );
  }

  await writeBuildMetadata(outputDir, {
    buildSource,
    siteBase,
    siteOutputMode,
    strippedLocalLinks: generated.strippedLocalLinks,
  });
  await writeBuildRuntimeLog("buildLibrarySite: writeBuildMetadata:done");
  return {
    outputDir,
    siteOutputMode,
    strippedLocalLinks: generated.strippedLocalLinks,
    outputAudit,
  };
}
