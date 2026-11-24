import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

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

function buildLibrary(composerId: string, composerName: string) {
  return {
    composers: [
      {
        id: composerId,
        slug: composerId,
        name: composerName,
        fullName: composerName,
        nameLatin: "Latin Name",
        country: "Germany",
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

async function prepareLibrary(composerId: string, composerName: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-transaction-"));
  tempDirs.push(tempRoot);
  const libraryRoot = path.join(tempRoot, "library");
  process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
  process.env.ICM_APP_DATA_DIR = path.join(tempRoot, "appdata");

  const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
  const { saveLibraryToDisk } = await import("../../packages/data-core/src/library-store.ts");
  const { validateLibrary: validate } = await import("../../packages/shared/src/schema.ts");
  await ensureLibraryBundle(libraryRoot, { libraryName: "事务测试库" });
  await saveLibraryToDisk(validate(buildLibrary(composerId, composerName)));
  return { tempRoot, libraryRoot, saveLibraryToDisk, validate };
}

async function readComposerIds(libraryRoot: string) {
  const raw = await readFile(path.join(libraryRoot, "content", "library", "composers.json"), "utf8");
  return JSON.parse(raw).map((composer: { id: string }) => composer.id);
}

async function readTransactionRoot(tempRoot: string) {
  return path.join(tempRoot, "backups", "library-transactions");
}

async function listTransactionDirectories(tempRoot: string) {
  try {
    return (await readdir(await readTransactionRoot(tempRoot))).sort();
  } catch {
    return [];
  }
}

describe("library save transactions (F16)", () => {
  it("writes a commit marker and a rolling snapshot after a save", async () => {
    const { tempRoot, libraryRoot, saveLibraryToDisk, validate } = await prepareLibrary("composer-a", "Composer A");

    const marker = JSON.parse(
      await readFile(path.join(libraryRoot, "runtime", "state", ".library-commit.json"), "utf8"),
    );
    expect(marker.schemaVersion).toBe("library-commit-v1");
    expect(marker.files.map((file: { name: string }) => file.name).sort()).toEqual([
      "composers.json",
      "people.json",
      "recordings.json",
      "work-groups.json",
      "works.json",
    ]);

    const transactions = await listTransactionDirectories(tempRoot);
    expect(transactions.length).toBeGreaterThan(0);

    await saveLibraryToDisk(validate(buildLibrary("composer-b", "Composer B")));
    expect(await readComposerIds(libraryRoot)).toEqual(["composer-b"]);
    expect((await listTransactionDirectories(tempRoot)).length).toBeGreaterThan(transactions.length);
  });

  it("rolls back to the previous consistent snapshot when a save is interrupted after 3 files", async () => {
    const { tempRoot, libraryRoot, saveLibraryToDisk, validate } = await prepareLibrary("composer-a", "Composer A");
    process.env.NODE_ENV = "test";
    process.env.ICM_TEST_FAULT_AFTER_LIBRARY_FILE_WRITES = "3";

    await expect(saveLibraryToDisk(validate(buildLibrary("composer-b", "Composer B")))).rejects.toThrow(
      /Injected library save failure after writing 3 file/,
    );

    // The marker must live outside the exported content tree (R1 rework).
    await expect(
      readFile(path.join(libraryRoot, "content", "library", ".library-commit.json"), "utf8"),
    ).rejects.toThrow();
    expect((await readdir(path.join(libraryRoot, "content", "library"))).sort()).not.toContain(".library-commit.json");

    // "Restart": loading must detect the mismatched commit marker and roll the
    // mixed half-save back to the previous snapshot.
    const { loadLibraryFromDisk, recoverLibraryFromInterruptedSave } = await import(
      "../../packages/data-core/src/library-store.ts"
    );
    const recovery = await recoverLibraryFromInterruptedSave();
    expect(recovery.status).toBe("recovered");
    const library = await loadLibraryFromDisk();
    expect(library.composers.map((composer) => composer.id)).toEqual(["composer-a"]);
    expect(await readComposerIds(libraryRoot)).toEqual(["composer-a"]);

    const marker = JSON.parse(
      await readFile(path.join(libraryRoot, "runtime", "state", ".library-commit.json"), "utf8"),
    );
    expect(marker.recoveredAt).toBeTruthy();

    delete process.env.ICM_TEST_FAULT_AFTER_LIBRARY_FILE_WRITES;
    expect((await recoverLibraryFromInterruptedSave()).status).toBe("consistent");
    expect(tempRoot).toBeTruthy();
  });

  it("restores the last snapshot when an entity file is corrupted outside a save", async () => {
    const { tempRoot, libraryRoot, saveLibraryToDisk, validate } = await prepareLibrary("composer-a", "Composer A");
    await saveLibraryToDisk(validate(buildLibrary("composer-b", "Composer B")));

    // Corrupt one file after the last successful save (e.g. external damage).
    await writeFile(path.join(libraryRoot, "content", "library", "works.json"), "{ not json", "utf8");

    const { loadLibraryFromDisk } = await import("../../packages/data-core/src/library-store.ts");
    const library = await loadLibraryFromDisk();
    // The newest complete snapshot is the pre-save state of the last save.
    expect(library.composers.map((composer) => composer.id)).toEqual(["composer-a"]);
    expect(tempRoot).toBeTruthy();
  });

  it("keeps a bounded number of rolling snapshots", async () => {
    const { tempRoot, libraryRoot, saveLibraryToDisk, validate } = await prepareLibrary("composer-0", "Composer 0");
    for (let index = 1; index <= 7; index += 1) {
      await saveLibraryToDisk(validate(buildLibrary(`composer-${index}`, `Composer ${index}`)));
    }
    const transactions = await listTransactionDirectories(tempRoot);
    expect(transactions.length).toBeLessThanOrEqual(5);
    expect(await readComposerIds(libraryRoot)).toEqual(["composer-7"]);
  });

  it("migrates a pre-rework commit marker out of content/library on load", async () => {
    const { libraryRoot } = await prepareLibrary("composer-a", "Composer A");
    const commitPath = path.join(libraryRoot, "runtime", "state", ".library-commit.json");
    const legacyContentMarker = path.join(libraryRoot, "content", "library", ".library-commit.json");
    await writeFile(legacyContentMarker, await readFile(commitPath, "utf8"), "utf8");
    await rm(commitPath);

    const { loadLibraryFromDisk } = await import("../../packages/data-core/src/library-store.ts");
    const library = await loadLibraryFromDisk();

    expect(library.composers.map((composer) => composer.id)).toEqual(["composer-a"]);
    expect(existsSync(legacyContentMarker)).toBe(false);
    expect(existsSync(commitPath)).toBe(true);
  });

  it("reports no-commit-record for a legacy library that was never saved through the store", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-legacy-"));
    tempDirs.push(tempRoot);
    const libraryRoot = path.join(tempRoot, "library");
    process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
    process.env.ICM_APP_DATA_DIR = path.join(tempRoot, "appdata");
    const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
    await ensureLibraryBundle(libraryRoot, { libraryName: "遗留库" });

    const { recoverLibraryFromInterruptedSave } = await import("../../packages/data-core/src/library-store.ts");
    expect((await recoverLibraryFromInterruptedSave()).status).toBe("no-commit-record");
  });
});
