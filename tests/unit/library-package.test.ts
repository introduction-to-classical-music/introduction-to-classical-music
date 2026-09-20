import { describe, expect, it } from "vitest";
import path from "node:path";
import { compareLibraries, loadLibraryFromBundleRoot } from "../../packages/data-core/src/library-merge.js";

const fixtures = path.resolve("docs/manual-fixtures");

describe("unified library packages", () => {
  it("loads the same schema from compressed and directory packages", async () => {
    const compressed = await loadLibraryFromBundleRoot(path.join(fixtures, "library-b.icmlibrary"));
    const directory = await loadLibraryFromBundleRoot(path.join(fixtures, "library-b-directory.icmlibrary"));
    expect(compressed).toEqual(directory);
    expect(compressed.works).toHaveLength(3);
  });

  it("provides overlapping fixtures with additions and conflicts", async () => {
    const a = await loadLibraryFromBundleRoot(path.join(fixtures, "library-a.icmlibrary"));
    const b = await loadLibraryFromBundleRoot(path.join(fixtures, "library-b.icmlibrary"));
    const report = compareLibraries(a, b);
    expect(report.added.map((item) => item.entityType)).toEqual(["composer", "person", "workGroup", "work", "recording"]);
    expect(report.localOnly.map((item) => item.entityType)).toEqual(["composer", "person", "workGroup", "work", "recording"]);
    expect(report.unchanged).toHaveLength(5);
    expect(report.conflicts.map((item) => item.entityType)).toEqual(["person", "workGroup", "work", "recording"]);
    expect(report.conflicts.find((item) => item.entityType === "recording")?.fields.map((field) => field.path)).toEqual(["title", "images", "links", "notes"]);
  });
});
