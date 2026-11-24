import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditLibraryRoot, hashDirectory, parseCliArgs } from "./lib/library-ops.mjs";
import { buildReleaseManifest, readSnapshotVersions } from "./lib/library-release.mjs";

const args = parseCliArgs(process.argv.slice(2));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceRoot = path.join(repoRoot, "output", "release-default-library");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const version = String(args.version || args._[1] || packageJson.version || "").trim();
const outputRoot = path.resolve(String(args.out || args._[0] || path.join(repoRoot, "..", "release-default-library", `v${version}`)));

if (path.resolve(sourceRoot) === outputRoot) {
  throw new Error("Default library snapshot output must be different from the build source");
}

const audit = await auditLibraryRoot(sourceRoot, { mode: "working" });
if (!audit.ok) {
  throw new Error(`Default library audit failed: ${JSON.stringify(audit.errors)}`);
}

// F11 / W7a: never publish provenance for a stale build. The snapshot's
// `.icm-build-meta.json` appVersion must match the release version; pre-W4
// snapshots recorded 0.1.0 and are rejected with a rebuild hint.
const { buildMeta, libraryManifest } = await readSnapshotVersions(sourceRoot);
if (audit.manifest?.libraryId && libraryManifest?.libraryId && audit.manifest.libraryId !== libraryManifest.libraryId) {
  throw new Error(
    `Default library manifest mismatch: audit libraryId=${audit.manifest.libraryId} but library.manifest.json=${libraryManifest.libraryId}`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.dirname(outputRoot), { recursive: true });
await cp(sourceRoot, outputRoot, { recursive: true, force: true });

const snapshotTree = await hashDirectory(outputRoot, { exclude: ["release-manifest.json"] });
const manifest = buildReleaseManifest({
  version,
  libraryManifest,
  buildMeta,
  sourceDigest: audit.sourceDigest,
  snapshotDigest: snapshotTree.digest,
  counts: audit.counts,
});
await writeFile(path.join(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputRoot, manifest }, null, 2)}\n`);
