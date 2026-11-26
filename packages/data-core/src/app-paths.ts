import os from "node:os";
import path from "node:path";

export const LIBRARY_BUNDLE_SCHEMA_VERSION = "library-bundle-v1";
// 应用数据目录名必须与桌面端实际使用的 `app.getPath("userData")` 一致
// （Electron 取 package.json 的 `name`，即 buquanshu）。桌面端会把
// `ICM_APP_DATA_DIR` 显式注入子进程；这里只是无头/开发运行的兜底默认值，
// 两边取同一个名字，避免出现两个 AppData 根目录、各自看到不同的库。
export const APP_DATA_DIR_NAME = "buquanshu";
/** @deprecated 保留旧名以避免外部脚本 import 断裂；值已与桌面端统一。 */
export const APP_DISPLAY_NAME = APP_DATA_DIR_NAME;
// The app version is no longer a constant here: use `getAppVersion()` from
// `app-version.ts` (env injected by the desktop process, else package.json).

export type RuntimePaths = {
  mode: "legacy" | "bundle";
  repoRoot: string;
  ownerWebDir: string;
  sitePublicDir: string;
  templateDir: string;
  recordingRetrievalAppDir: string;
  appData: {
    rootDir: string;
    settingsPath: string;
    secretsPath: string;
    statePath: string;
    librariesDir: string;
    logsDir: string;
    cacheDir: string;
  };
  library: {
    rootDir: string;
    manifestPath: string;
    contentDir: string;
    contentLibraryDir: string;
    contentSiteDir: string;
    assetsDir: string;
    assetsManagedDir: string;
    assetsImportedDir: string;
    runtimeDir: string;
    runtimeAutomationDir: string;
    runtimeAutomationRunsDir: string;
    runtimeGeneratedDir: string;
    buildDir: string;
    buildSiteDir: string;
    exportsDir: string;
    legacyDataDir: string;
  };
};

function resolveRepoRoot() {
  return path.resolve(process.env.ICM_REPO_ROOT || process.cwd());
}

export function resolveDevelopmentAppDataRoot(repoRoot = resolveRepoRoot()) {
  const rawRoot = String(repoRoot);
  const pathApi = /^[A-Za-z]:[\\/]/.test(rawRoot) ? path.win32 : path;
  return pathApi.join(pathApi.resolve(rawRoot), "output", "desktop-dev-appdata");
}

function resolveDefaultAppDataRoot() {
  const appDataBase = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appDataBase, APP_DATA_DIR_NAME);
}

export function getRuntimePaths(): RuntimePaths {
  const repoRoot = resolveRepoRoot();
  const ownerWebDir = path.join(repoRoot, "apps", "owner", "web");
  const sitePublicDir = path.join(repoRoot, "apps", "site", "public");
  const templateDir = path.join(repoRoot, "materials", "fixtures", "templates");
  const recordingRetrievalAppDir = path.join(repoRoot, "tools", "recording-retrieval-service", "app");

  const forcedMode = process.env.ICM_RUNTIME_MODE === "bundle" ? "bundle" : null;
  const activeLibraryRoot = process.env.ICM_ACTIVE_LIBRARY_DIR
    ? path.resolve(process.env.ICM_ACTIVE_LIBRARY_DIR)
    : repoRoot;
  const mode = forcedMode || (process.env.ICM_ACTIVE_LIBRARY_DIR ? "bundle" : "legacy");
  const legacyAutomationDir = path.join(repoRoot, "data", "automation");
  const appDataRoot = path.resolve(
    process.env.ICM_APP_DATA_DIR || (mode === "bundle" ? resolveDefaultAppDataRoot() : legacyAutomationDir),
  );

  const legacyDataDir = path.join(repoRoot, "data");
  const contentDir = mode === "bundle" ? path.join(activeLibraryRoot, "content") : legacyDataDir;
  const contentLibraryDir = mode === "bundle" ? path.join(contentDir, "library") : path.join(contentDir, "library");
  const contentSiteDir = mode === "bundle" ? path.join(contentDir, "site") : path.join(contentDir, "site");
  const assetsDir = mode === "bundle" ? path.join(activeLibraryRoot, "assets") : path.join(sitePublicDir, "library-assets");
  const runtimeDir = mode === "bundle" ? path.join(activeLibraryRoot, "runtime") : path.join(legacyDataDir, "automation");
  const buildDir = mode === "bundle" ? path.join(activeLibraryRoot, "build") : path.join(repoRoot, "output");

  return {
    mode,
    repoRoot,
    ownerWebDir,
    sitePublicDir,
    templateDir,
    recordingRetrievalAppDir,
    appData: {
      rootDir: appDataRoot,
      settingsPath: path.join(appDataRoot, mode === "bundle" ? "settings.json" : "recording-retrieval.local.json"),
      secretsPath: path.join(appDataRoot, mode === "bundle" ? "secrets.json" : "settings.local.json"),
      statePath: path.join(appDataRoot, mode === "bundle" ? "state.json" : "state.local.json"),
      librariesDir: path.join(appDataRoot, "libraries"),
      logsDir: path.join(appDataRoot, "logs"),
      cacheDir: path.join(appDataRoot, "cache"),
    },
    library: {
      rootDir: activeLibraryRoot,
      manifestPath: path.join(activeLibraryRoot, "library.manifest.json"),
      contentDir,
      contentLibraryDir,
      contentSiteDir,
      assetsDir,
      assetsManagedDir: path.join(assetsDir, "managed"),
      assetsImportedDir: path.join(assetsDir, "imported"),
      runtimeDir,
      runtimeAutomationDir: runtimeDir,
      runtimeAutomationRunsDir: path.join(runtimeDir, "runs"),
      runtimeGeneratedDir: mode === "bundle" ? path.join(runtimeDir, "generated") : path.join(repoRoot, "apps", "site", "src", "generated"),
      buildDir,
      buildSiteDir: mode === "bundle" ? path.join(buildDir, "site") : path.join(buildDir, "site"),
      exportsDir: mode === "bundle" ? path.join(activeLibraryRoot, "exports") : path.join(buildDir, "exports"),
      legacyDataDir,
    },
  };
}
