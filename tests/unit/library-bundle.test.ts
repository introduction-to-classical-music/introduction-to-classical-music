import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("library bundle scaffolding", () => {
  it("creates a Library Bundle v1 scaffold with manifest and required directories", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-bundle-"));
    tempDirs.push(tempRoot);
    const libraryRoot = path.join(tempRoot, "bundle");

    const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
    const result = await ensureLibraryBundle(libraryRoot, { libraryName: "测试库" });

    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };
    const manifest = JSON.parse(await readFile(path.join(libraryRoot, "library.manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: "library-bundle-v1",
      libraryName: "测试库",
      // Single version source (F08): the manifest minimum version must match package.json.
      appMinVersion: packageJson.version,
    });

    await expect(stat(path.join(libraryRoot, "content", "library"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "content", "site"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "assets", "managed"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "assets", "imported"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "build", "site"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "runtime"))).resolves.toBeTruthy();
    await expect(stat(path.join(libraryRoot, "exports"))).resolves.toBeTruthy();
    await expect(readFile(path.join(libraryRoot, "content", "library", "composers.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(libraryRoot, "content", "library", "recordings.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(libraryRoot, "content", "site", "config.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(path.join(libraryRoot, "content", "site", "articles.json"), "utf8")).resolves.toBe("[]\n");
    expect(result.rootDir).toBe(libraryRoot);
    expect(result.manifestPath).toBe(path.join(libraryRoot, "library.manifest.json"));
  });

  it("seeds a new library bundle from a legacy project source", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-seed-"));
    tempDirs.push(tempRoot);
    const sourceRoot = path.join(tempRoot, "source");
    const libraryRoot = path.join(tempRoot, "bundle");
    await mkdir(path.join(sourceRoot, "data", "library"), { recursive: true });
    await mkdir(path.join(sourceRoot, "data", "site"), { recursive: true });
    await mkdir(path.join(sourceRoot, "apps", "site", "public", "library-assets", "managed"), { recursive: true });
    await writeFile(path.join(sourceRoot, "data", "library", "composers.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "library", "people.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "library", "work-groups.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "library", "works.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "library", "recordings.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "site", "config.json"), "{}\n", "utf8");
    await writeFile(path.join(sourceRoot, "data", "site", "articles.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "apps", "site", "public", "library-assets", "managed", "cover.jpg"), "asset", "utf8");

    const { seedLibraryBundleFromLegacySource } = await import("../../packages/data-core/src/library-bundle.ts");
    await seedLibraryBundleFromLegacySource(sourceRoot, libraryRoot, { libraryName: "导入库" });

    await expect(readFile(path.join(libraryRoot, "content", "library", "composers.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(libraryRoot, "content", "site", "articles.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(libraryRoot, "assets", "managed", "cover.jpg"), "utf8")).resolves.toBe("asset");
  });

  it("copies only source content for a source-only library export", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-source-export-"));
    tempDirs.push(tempRoot);
    const sourceRoot = path.join(tempRoot, "source");
    const targetRoot = path.join(tempRoot, "target");
    await mkdir(path.join(sourceRoot, "content", "library"), { recursive: true });
    await mkdir(path.join(sourceRoot, "content", "site"), { recursive: true });
    await mkdir(path.join(sourceRoot, "assets", "managed"), { recursive: true });
    await mkdir(path.join(sourceRoot, "build", "site"), { recursive: true });
    await writeFile(path.join(sourceRoot, "library.manifest.json"), JSON.stringify({
      schemaVersion: "library-bundle-v1",
      libraryId: "source-only-1",
      libraryName: "Source Only",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
      appMinVersion: "0.1.0",
    }, null, 2), "utf8");
    await writeFile(path.join(sourceRoot, "content", "library", "composers.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "content", "site", "articles.json"), "[]\n", "utf8");
    await writeFile(path.join(sourceRoot, "assets", "managed", "cover.txt"), "asset", "utf8");
    await writeFile(path.join(sourceRoot, "build", "site", "index.html"), "generated", "utf8");

    const { copyLibrarySourceBundle } = await import("../../packages/data-core/src/library-bundle.ts");
    await copyLibrarySourceBundle(sourceRoot, targetRoot);

    await expect(readFile(path.join(targetRoot, "library.manifest.json"), "utf8")).resolves.toContain("source-only-1");
    await expect(readFile(path.join(targetRoot, "content", "library", "composers.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(targetRoot, "assets", "managed", "cover.txt"), "utf8")).resolves.toBe("asset");
    await expect(stat(path.join(targetRoot, "build"))).rejects.toThrow();
  });
});
