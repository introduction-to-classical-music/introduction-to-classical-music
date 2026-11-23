import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RELEASE_MANIFEST_SCHEMA_VERSION,
  assertReleaseSnapshotVersions,
  buildReleaseManifest,
  readSnapshotVersions,
} from "../../scripts/lib/library-release.mjs";

const libraryManifest = {
  schemaVersion: "library-bundle-v1",
  libraryId: "8ff98548-ddef-4f0b-a4ac-a9e2a8d33267",
  libraryName: "默认资料库",
  createdAt: "2026-09-20T01:52:04.109Z",
  updatedAt: "2026-09-20T01:52:04.109Z",
  appMinVersion: "0.1.1",
};

describe("default library release snapshot version checks (W7a)", () => {
  it("accepts a snapshot built from the release version", () => {
    const buildMeta = { appVersion: "0.1.1", builtAt: "2026-11-17T00:00:00.000Z" };
    const validation = assertReleaseSnapshotVersions({
      expectedVersion: "0.1.1",
      buildMeta,
      libraryManifest,
    });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);

    const manifest = buildReleaseManifest({
      version: "0.1.1",
      libraryManifest,
      buildMeta,
      sourceDigest: "source-digest",
      snapshotDigest: "snapshot-digest",
      counts: { composers: 0 },
      builtAt: "2026-11-17T01:00:00.000Z",
    });
    expect(manifest).toMatchObject({
      schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
      libraryId: libraryManifest.libraryId,
      libraryName: "默认资料库",
      appVersion: "0.1.1",
      buildMetaAppVersion: "0.1.1",
      buildMetaBuiltAt: "2026-11-17T00:00:00.000Z",
      sourceDigest: "source-digest",
      snapshotDigest: "snapshot-digest",
      builtAt: "2026-11-17T01:00:00.000Z",
    });
  });

  it("rejects the historical 0.1.1 snapshot whose build meta still says 0.1.0", () => {
    // Exactly the released release-default-library/v0.1.1 shape (pre-W4 build).
    const buildMeta = { appVersion: "0.1.0", builtAt: "2026-09-20T01:52:06.430Z" };
    const validation = assertReleaseSnapshotVersions({
      expectedVersion: "0.1.1",
      buildMeta,
      libraryManifest,
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("appVersion=0.1.0");
    expect(validation.errors.join("\n")).toContain("0.1.1");
    expect(validation.errors.join("\n")).toContain("npm run build");
    expect(() =>
      buildReleaseManifest({
        version: "0.1.1",
        libraryManifest,
        buildMeta,
        sourceDigest: "source",
        snapshotDigest: "snapshot",
        counts: {},
      }),
    ).toThrow(/version check failed/);
  });

  it("rejects missing build meta and missing libraryId", () => {
    const missingBuildMeta = assertReleaseSnapshotVersions({
      expectedVersion: "0.1.1",
      buildMeta: null,
      libraryManifest,
    });
    expect(missingBuildMeta.ok).toBe(false);
    expect(missingBuildMeta.errors.join("\n")).toContain("build/site/.icm-build-meta.json");

    const missingLibraryId = assertReleaseSnapshotVersions({
      expectedVersion: "0.1.1",
      buildMeta: { appVersion: "0.1.1" },
      libraryManifest: { libraryName: "默认资料库" },
    });
    expect(missingLibraryId.ok).toBe(false);
    expect(missingLibraryId.errors.join("\n")).toContain("libraryId");

    const emptyVersion = assertReleaseSnapshotVersions({
      expectedVersion: "",
      buildMeta: { appVersion: "0.1.1" },
      libraryManifest,
    });
    expect(emptyVersion.ok).toBe(false);
    expect(emptyVersion.errors.join("\n")).toContain("release version");
  });

  it("reads build meta and library manifest from a snapshot directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "classical-release-snapshot-"));
    try {
      await mkdir(path.join(root, "build", "site"), { recursive: true });
      await writeFile(
        path.join(root, "build", "site", ".icm-build-meta.json"),
        JSON.stringify({ appVersion: "0.1.1", builtAt: "2026-11-17T00:00:00.000Z" }),
        "utf8",
      );
      await writeFile(path.join(root, "library.manifest.json"), JSON.stringify(libraryManifest), "utf8");
      const versions = await readSnapshotVersions(root);
      expect(versions.buildMeta.appVersion).toBe("0.1.1");
      expect(versions.libraryManifest.libraryId).toBe(libraryManifest.libraryId);
      expect(assertReleaseSnapshotVersions({ expectedVersion: "0.1.1", ...versions }).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports missing snapshot files as null instead of throwing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "classical-release-empty-"));
    try {
      const versions = await readSnapshotVersions(root);
      expect(versions.buildMeta).toBeNull();
      expect(versions.libraryManifest).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
