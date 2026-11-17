import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalAppVersion = process.env.ICM_APP_VERSION;
const originalRepoRoot = process.env.ICM_REPO_ROOT;
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalAppVersion === undefined) {
    delete process.env.ICM_APP_VERSION;
  } else {
    process.env.ICM_APP_VERSION = originalAppVersion;
  }
  if (originalRepoRoot === undefined) {
    delete process.env.ICM_REPO_ROOT;
  } else {
    process.env.ICM_REPO_ROOT = originalRepoRoot;
  }
  vi.resetModules();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function readPackageJson() {
  return JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };
}

describe("app version single source", () => {
  it("falls back to the shipped package.json version when no environment override is set", async () => {
    delete process.env.ICM_APP_VERSION;
    process.env.ICM_REPO_ROOT = process.cwd();
    const packageJson = await readPackageJson();

    const { getAppVersion } = await import("../../packages/data-core/src/app-version.ts");

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(getAppVersion()).toBe(packageJson.version);
  });

  it("prefers the desktop-injected ICM_APP_VERSION over package.json", async () => {
    process.env.ICM_APP_VERSION = "9.9.9-desktop";
    process.env.ICM_REPO_ROOT = process.cwd();

    const { getAppVersion } = await import("../../packages/data-core/src/app-version.ts");

    expect(getAppVersion()).toBe("9.9.9-desktop");
  });

  it("does not invent an older release version when package.json cannot be read", async () => {
    delete process.env.ICM_APP_VERSION;
    const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "classical-app-version-empty-"));
    tempDirs.push(emptyRoot);
    process.env.ICM_REPO_ROOT = emptyRoot;

    const { getAppVersion } = await import("../../packages/data-core/src/app-version.ts");

    expect(getAppVersion()).toBe("0.0.0");
  });

  it("keeps the data-core sources free of a hardcoded APP_VERSION", async () => {
    const appPaths = await readFile(path.resolve("packages/data-core/src/app-paths.ts"), "utf8");
    const runner = await readFile(path.resolve("packages/data-core/src/site-build-runner.ts"), "utf8");
    const mainProcess = await readFile(path.resolve("apps/desktop/main.ts"), "utf8");

    expect(appPaths).not.toContain("APP_VERSION");
    expect(runner).toContain("getAppVersion()");
    expect(runner).toContain("buildSource");
    expect(mainProcess).toContain("process.env.ICM_APP_VERSION = app.getVersion()");
    expect(mainProcess).toContain("needsSiteRebuild");
  });

  it("writes build metadata with the resolved version, build source and builtAt", async () => {
    delete process.env.ICM_APP_VERSION;
    process.env.ICM_REPO_ROOT = process.cwd();
    const packageJson = await readPackageJson();
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-build-meta-"));
    tempDirs.push(tempRoot);

    const { writeBuildMetadata } = await import("../../packages/data-core/src/site-build-runner.ts");
    await writeBuildMetadata(tempRoot);
    const localMetadata = JSON.parse(await readFile(path.join(tempRoot, ".icm-build-meta.json"), "utf8"));

    expect(localMetadata.appVersion).toBe(packageJson.version);
    expect(localMetadata.buildSource).toBe("local");
    expect(localMetadata.siteBase).toBeUndefined();
    expect(Number.isNaN(Date.parse(localMetadata.builtAt))).toBe(false);

    await writeBuildMetadata(tempRoot, { buildSource: "cli", siteBase: "/" });
    const cliMetadata = JSON.parse(await readFile(path.join(tempRoot, ".icm-build-meta.json"), "utf8"));

    expect(cliMetadata.appVersion).toBe(packageJson.version);
    expect(cliMetadata.buildSource).toBe("cli");
    expect(cliMetadata.siteBase).toBe("/");
    expect(Number.isNaN(Date.parse(cliMetadata.builtAt))).toBe(false);
  });
});
