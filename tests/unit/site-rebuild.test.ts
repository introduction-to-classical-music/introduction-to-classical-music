import { describe, expect, it } from "vitest";

import { needsSiteRebuild } from "../../packages/data-core/src/site-rebuild.ts";

describe("needsSiteRebuild", () => {
  const current = {
    appVersion: "0.1.1",
    metaVersion: "0.1.1",
    indexMtimeMs: 2_000,
    sourceMtimeMs: 1_000,
  };

  it("reuses a same-version build whose site is not older than the sources", () => {
    expect(needsSiteRebuild(current)).toBe(false);
  });

  it("treats equal timestamps as fresh (the last build already saw the sources)", () => {
    expect(needsSiteRebuild({ ...current, sourceMtimeMs: current.indexMtimeMs })).toBe(false);
  });

  it("rebuilds when the site sources are newer than the built site", () => {
    expect(needsSiteRebuild({ ...current, sourceMtimeMs: current.indexMtimeMs + 1 })).toBe(true);
  });

  it("rebuilds when the build metadata was written by another app version", () => {
    expect(needsSiteRebuild(current)).toBe(false);
    expect(needsSiteRebuild({ ...current, metaVersion: "0.1.0" })).toBe(true);
    expect(needsSiteRebuild({ ...current, appVersion: "0.1.2" })).toBe(true);
  });

  it("rebuilds when the built index.html is missing", () => {
    expect(needsSiteRebuild({ ...current, indexMtimeMs: null })).toBe(true);
    expect(needsSiteRebuild({ ...current, indexMtimeMs: undefined })).toBe(true);
  });

  it("rebuilds when the build metadata is missing or unreadable", () => {
    expect(needsSiteRebuild({ ...current, metaVersion: null })).toBe(true);
    expect(needsSiteRebuild({ ...current, metaVersion: undefined })).toBe(true);
    expect(needsSiteRebuild({ ...current, metaVersion: "" })).toBe(true);
    expect(needsSiteRebuild({ ...current, metaVersion: "   " })).toBe(true);
  });

  it("rebuilds an installed 0.1.0 seed site exactly once after the 0.1.1 upgrade", () => {
    const installedOldMetadata = { ...current, appVersion: "0.1.1", metaVersion: "0.1.0" };
    expect(needsSiteRebuild(installedOldMetadata)).toBe(true);

    // Second launch after the migration rebuild: metadata now matches.
    const afterMigration = { ...current, appVersion: "0.1.1", metaVersion: "0.1.1" };
    expect(needsSiteRebuild(afterMigration)).toBe(false);
  });
});
