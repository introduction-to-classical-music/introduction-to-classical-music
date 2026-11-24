/**
 * Rebuild decision for the locally served library site (F08).
 *
 * The desktop main process previously compared `.icm-build-meta.json.appVersion`
 * with `app.getVersion()` inline. That comparison is extracted here so the
 * migration semantics are testable without Electron:
 *
 * - A different app version means the existing build was produced by another
 *   release and is stale.
 * - A missing build (`index.html` absent) or missing/unreadable build metadata
 *   means the build cannot be trusted as current.
 * - The same version is reused when the built site is not older than the site
 *   source/reference files. Equal timestamps count as fresh: the last build
 *   already included the current sources.
 *
 * Migration note: installations upgraded from 0.1.0 carry a seed site whose
 * metadata says `appVersion: "0.1.0"`. Once the app runs 0.1.1 such a site is
 * rebuilt exactly once (expected one-time migration cost); afterwards the
 * metadata matches and the local site is served without rebuilding.
 */
export type SiteRebuildState = {
  /** `appVersion` recorded in the existing `.icm-build-meta.json`; `null` when missing/invalid. */
  metaVersion?: string | null;
  /** Version a fresh build would record (desktop: `app.getVersion()`). */
  appVersion: string;
  /** mtime of the built `index.html` in milliseconds; `null` when it does not exist. */
  indexMtimeMs?: number | null;
  /** mtime of the newest site source/reference file in milliseconds. */
  sourceMtimeMs?: number | null;
};

export function needsSiteRebuild(state: SiteRebuildState): boolean {
  if (state.indexMtimeMs === null || state.indexMtimeMs === undefined) {
    return true;
  }

  const metaVersion = String(state.metaVersion ?? "").trim();
  if (!metaVersion) {
    return true;
  }

  const appVersion = String(state.appVersion ?? "").trim();
  if (metaVersion !== appVersion) {
    return true;
  }

  const sourceMtimeMs = state.sourceMtimeMs ?? 0;
  return sourceMtimeMs > state.indexMtimeMs;
}
