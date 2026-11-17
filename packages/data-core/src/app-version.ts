import { readFileSync } from "node:fs";
import path from "node:path";

import { getRuntimePaths } from "./app-paths.js";

/**
 * Resolve the version of the running application (single source of truth, F08).
 *
 * Resolution order:
 * 1. `ICM_APP_VERSION` — the desktop main process primes this from
 *    `app.getVersion()` before any runtime module is used, so packaged builds
 *    report the installer/asar version instead of a hardcoded string.
 * 2. `<repoRoot>/package.json` — CLI scripts, tests and portable builds read
 *    the same version file that is shipped in the package.
 *
 * The previous hardcoded `APP_VERSION = "0.1.0"` constant was removed: it made
 * 0.1.1 builds write 0.1.0 build metadata, which in turn made every launch
 * rebuild the library site (see `needsSiteRebuild`).
 */
export function getAppVersion(): string {
  const fromEnvironment = String(process.env.ICM_APP_VERSION ?? "").trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }

  try {
    const packageJsonPath = path.join(getRuntimePaths().repoRoot, "package.json");
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (version) {
      return version;
    }
  } catch {
    // Fall through to the conservative fallback below: a build without a
    // resolvable version must not claim an older release version.
  }

  return "0.0.0";
}
