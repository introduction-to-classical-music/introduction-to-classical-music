import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import { resetAstroBuildLockForTests } from "./support/astro-build-lock.ts";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

beforeAll(async () => {
  await resetAstroBuildLockForTests();
});

afterAll(async () => {
  await resetAstroBuildLockForTests();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.resetModules();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

const INTERNAL_MARKER = ".library-commit.json";

function buildLibrary(composerId: string) {
  return {
    composers: [
      {
        id: composerId,
        slug: composerId,
        name: "贝多芬",
        fullName: "贝多芬",
        nameLatin: "Ludwig van Beethoven",
        country: "Germany",
        birthYear: 1770,
        deathYear: 1827,
        avatarSrc: "",
        aliases: [],
        sortKey: "0010",
        summary: "",
      },
    ],
    people: [],
    workGroups: [],
    works: [],
    recordings: [],
  };
}

async function createSavedLibrary() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-export-hygiene-"));
  tempDirs.push(tempRoot);
  const libraryRoot = path.join(tempRoot, "library");
  process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
  process.env.ICM_APP_DATA_DIR = path.join(tempRoot, "appdata");

  const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
  const { saveLibraryToDisk } = await import("../../packages/data-core/src/library-store.ts");
  const { validateLibrary } = await import("../../packages/shared/src/schema.ts");
  await ensureLibraryBundle(libraryRoot, { libraryName: "导出卫生测试库" });
  await saveLibraryToDisk(validateLibrary(buildLibrary("composer-a")));
  return { tempRoot, libraryRoot, validateLibrary };
}

async function collectInternalEntries(rootDir: string, relativeDir = ""): Promise<string[]> {
  const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectInternalEntries(rootDir, relativePath)));
      continue;
    }
    const normalized = relativePath.replace(/\\/g, "/");
    const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (basename === INTERNAL_MARKER || /^\..+\.tmp$/.test(basename)) {
      found.push(normalized);
    }
  }
  return found;
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || "";
}

describe("library internal state must not leak into export surfaces (R1)", () => {
  it("keeps the commit marker out of content/ and inside runtime/state", async () => {
    const { libraryRoot } = await createSavedLibrary();

    expect(existsSync(path.join(libraryRoot, "runtime", "state", INTERNAL_MARKER))).toBe(true);
    expect(existsSync(path.join(libraryRoot, "content", "library", INTERNAL_MARKER))).toBe(false);
  });

  it("does not export internal state through the directory bundle", async () => {
    const { libraryRoot } = await createSavedLibrary();
    const { copyLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
    const exportRoot = path.join(path.dirname(libraryRoot), "bundle-export");

    await copyLibraryBundle(libraryRoot, exportRoot);

    expect(await collectInternalEntries(exportRoot)).toEqual([]);
  });

  it("does not export internal state through the .icmlibrary zip", async () => {
    const { libraryRoot } = await createSavedLibrary();
    const { writeCompressedLibraryPackage } = await import("../../packages/data-core/src/library-bundle.ts");
    const archivePath = path.join(path.dirname(libraryRoot), "package.icmlibrary");

    await writeCompressedLibraryPackage(libraryRoot, archivePath);

    const entries = new AdmZip(archivePath).getEntries().map((entry) => entry.entryName.replace(/\\/g, "/"));
    expect(entries.filter((name) => name.endsWith(INTERNAL_MARKER))).toEqual([]);
    expect(entries.filter((name) => /^\..+\.tmp$/.test(name.slice(name.lastIndexOf("/") + 1)))).toEqual([]);
  });

  it("does not export internal state through directory package / source export", async () => {
    const { libraryRoot } = await createSavedLibrary();
    const manager = await import("../../packages/data-core/src/library-manager.ts");
    const destinationDir = path.join(path.dirname(libraryRoot), "exports");
    await mkdir(destinationDir, { recursive: true });

    const directoryPackage = await manager.exportActiveLibraryDirectoryPackage(destinationDir);
    expect(await collectInternalEntries(directoryPackage.exportedRoot)).toEqual([]);

    const sourceExport = await manager.exportActiveLibrarySource(destinationDir);
    expect(await collectInternalEntries(sourceExport.exportedRoot)).toEqual([]);
  });

  it("keeps the official source git worktree clean after sync-library-source --apply", async () => {
    const { libraryRoot } = await createSavedLibrary();
    const repoRoot = process.cwd();
    const targetRoot = path.join(path.dirname(libraryRoot), "official-source");
    const { copyLibrarySourceBundle, ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
    await ensureLibraryBundle(targetRoot, { libraryName: "official source" });
    await copyLibrarySourceBundle(libraryRoot, targetRoot);
    expect(await collectInternalEntries(targetRoot)).toEqual([]);

    runGit(targetRoot, ["init", "-q"]);
    runGit(targetRoot, ["config", "user.email", "test@example.invalid"]);
    runGit(targetRoot, ["config", "user.name", "Test"]);
    runGit(targetRoot, ["add", "-A"]);
    runGit(targetRoot, ["commit", "-q", "-m", "seed"]);

    const sync = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "sync-library-source.mjs"), "--source", libraryRoot, "--target", targetRoot, "--apply"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    if (sync.status !== 0) {
      throw new Error(`sync-library-source failed (exit=${sync.status}): ${sync.stderr}`);
    }

    expect(await collectInternalEntries(targetRoot)).toEqual([]);
    const status = runGit(targetRoot, ["status", "--porcelain"]);
    expect(status.trim()).toBe("");
  });

  it("does not copy stale internal files from a legacy content tree", async () => {
    const { libraryRoot } = await createSavedLibrary();
    const { copyLibraryBundle, copyLibrarySourceBundle, writeCompressedLibraryPackage } = await import(
      "../../packages/data-core/src/library-bundle.ts"
    );
    const legacyRoot = path.join(path.dirname(libraryRoot), "legacy-library");
    await cp(libraryRoot, legacyRoot, { recursive: true, force: true });
    await writeFile(path.join(legacyRoot, "content", "library", INTERNAL_MARKER), "{}", "utf8");
    await writeFile(path.join(legacyRoot, "content", "library", ".works.json.1.2.tmp"), "{}", "utf8");

    const bundleRoot = path.join(path.dirname(libraryRoot), "legacy-bundle-export");
    await copyLibraryBundle(legacyRoot, bundleRoot);
    expect(await collectInternalEntries(bundleRoot)).toEqual([]);

    const sourceRoot = path.join(path.dirname(libraryRoot), "legacy-source-export");
    await copyLibrarySourceBundle(legacyRoot, sourceRoot);
    expect(await collectInternalEntries(sourceRoot)).toEqual([]);

    const archivePath = path.join(path.dirname(libraryRoot), "legacy.icmlibrary");
    await writeCompressedLibraryPackage(legacyRoot, archivePath);
    const entries = new AdmZip(archivePath).getEntries().map((entry) => entry.entryName.replace(/\\/g, "/"));
    expect(entries.filter((name) => name.endsWith(INTERNAL_MARKER) || /\.tmp$/.test(name))).toEqual([]);
  });

  it("keeps the site output free of internal state (public build)", async () => {
    const { tempRoot, libraryRoot } = await createSavedLibrary();
    process.env.ICM_REPO_ROOT = process.cwd();
    process.env.ICM_RUNTIME_MODE = "bundle";
    const { buildLibrarySite } = await import("../../packages/data-core/src/site-build-runner.ts");
    const outputDir = path.join(tempRoot, "site-output");

    await buildLibrarySite({ outputDir, siteBase: "/", buildSource: "export", siteOutputMode: "public" });

    expect(await collectInternalEntries(outputDir)).toEqual([]);
    expect(existsSync(path.join(outputDir, "runtime"))).toBe(false);
  });

  it("keeps legacy/dev commit bookkeeping outside the tracked library tree", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-export-hygiene-legacy-"));
    tempDirs.push(tempRoot);
    const fakeRepoRoot = path.join(tempRoot, "repo");
    process.env.ICM_REPO_ROOT = fakeRepoRoot;
    delete process.env.ICM_ACTIVE_LIBRARY_DIR;
    process.env.ICM_APP_DATA_DIR = path.join(tempRoot, "appdata");
    delete process.env.ICM_RUNTIME_MODE;

    const contentLibrary = path.join(fakeRepoRoot, "data", "library");
    const contentSite = path.join(fakeRepoRoot, "data", "site");
    await mkdir(contentLibrary, { recursive: true });
    await mkdir(contentSite, { recursive: true });
    for (const [fileName, value] of Object.entries({
      "composers.json": [],
      "people.json": [],
      "work-groups.json": [],
      "works.json": [],
      "recordings.json": [],
      "person-links.json": { canonicalPersonLinks: {} },
      "review-queue.json": [],
      "entity-vitals-review.json": [],
    })) {
      await writeFile(path.join(contentLibrary, fileName), `${JSON.stringify(value)}\n`, "utf8");
    }
    await writeFile(path.join(contentSite, "config.json"), "{}\n", "utf8");
    await writeFile(path.join(contentSite, "articles.json"), "[]\n", "utf8");

    const { saveLibraryToDisk, getLibraryTransactionRootPath } = await import(
      "../../packages/data-core/src/library-store.ts"
    );
    const { validateLibrary } = await import("../../packages/shared/src/schema.ts");
    await saveLibraryToDisk(validateLibrary(buildLibrary("composer-legacy")));

    expect(existsSync(path.join(fakeRepoRoot, "data", "library", INTERNAL_MARKER))).toBe(false);
    expect(await collectInternalEntries(path.join(fakeRepoRoot, "data"))).toEqual([]);
    const commitPath = path.join(fakeRepoRoot, "output", "library-state", INTERNAL_MARKER);
    expect(existsSync(commitPath)).toBe(true);
    expect(getLibraryTransactionRootPath().startsWith(fakeRepoRoot)).toBe(true);
  });
});
