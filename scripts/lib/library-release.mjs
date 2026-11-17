import { readFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_MANIFEST_SCHEMA_VERSION = "library-release-v1";

/**
 * Validate that a default-library snapshot was built from the version that is
 * being released (F11 / W7a). Historical snapshots built before W4 recorded
 * `appVersion: "0.1.0"` in `.icm-build-meta.json`; re-exporting such a stale
 * build would publish misleading provenance, so the export fails instead.
 */
export function assertReleaseSnapshotVersions({ expectedVersion, buildMeta, libraryManifest }) {
  const errors = [];
  const version = String(expectedVersion || "").trim();
  if (!version) {
    errors.push("Missing expected release version");
  }
  if (!buildMeta) {
    errors.push(
      "Missing snapshot build meta (build/site/.icm-build-meta.json); run `npm run build` before exporting the default library snapshot",
    );
  } else {
    const buildMetaVersion = String(buildMeta.appVersion || "").trim();
    if (!buildMetaVersion) {
      errors.push("Snapshot build meta has no appVersion; rebuild the default library with the current app version");
    } else if (version && buildMetaVersion !== version) {
      errors.push(
        `Snapshot build meta appVersion=${buildMetaVersion} does not match release version ${version}; ` +
          "run `npm run build` from a checkout at the release version before exporting " +
          "(pre-W4 snapshots record 0.1.0 and are not acceptable provenance)",
      );
    }
  }
  if (!libraryManifest || !String(libraryManifest.libraryId || "").trim()) {
    errors.push("Missing snapshot library.manifest.json libraryId; rebuild the default library before exporting");
  }
  return { ok: errors.length === 0, errors };
}

export async function readSnapshotVersions(sourceRoot) {
  const buildMetaPath = path.join(sourceRoot, "build", "site", ".icm-build-meta.json");
  const libraryManifestPath = path.join(sourceRoot, "library.manifest.json");
  let buildMeta = null;
  let libraryManifest = null;
  try {
    buildMeta = JSON.parse(await readFile(buildMetaPath, "utf8"));
  } catch {
    buildMeta = null;
  }
  try {
    libraryManifest = JSON.parse(await readFile(libraryManifestPath, "utf8"));
  } catch {
    libraryManifest = null;
  }
  return { buildMeta, libraryManifest };
}

export function buildReleaseManifest({
  version,
  libraryManifest,
  buildMeta,
  sourceDigest,
  snapshotDigest,
  counts,
  builtAt = new Date().toISOString(),
}) {
  const validation = assertReleaseSnapshotVersions({ expectedVersion: version, buildMeta, libraryManifest });
  if (!validation.ok) {
    const error = new Error(`Default library snapshot version check failed: ${validation.errors.join("; ")}`);
    error.code = "release-snapshot-version-mismatch";
    throw error;
  }
  const manifest = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    libraryId: String(libraryManifest.libraryId),
    libraryName: String(libraryManifest.libraryName || ""),
    appVersion: String(version),
    builtAt,
    buildMetaAppVersion: String(buildMeta.appVersion),
    sourceDigest,
    snapshotDigest,
    counts,
  };
  if (buildMeta.builtAt) {
    manifest.buildMetaBuiltAt = String(buildMeta.builtAt);
  }
  return manifest;
}
