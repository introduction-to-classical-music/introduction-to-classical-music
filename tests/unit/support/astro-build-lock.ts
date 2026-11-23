import process from "node:process";

import { clearStaleAstroBuildLock } from "../../../packages/data-core/src/site-build-lock.ts";

/**
 * Test teardown helper for site-build tests: remove a leftover Astro build lock
 * only when its holder process is dead (e.g. a previous test worker was killed
 * by an old tool timeout). Live/foreign locks are left untouched so parallel
 * test files on Linux do not break each other's builds.
 */
export async function resetAstroBuildLockForTests(repoRoot = process.cwd()): Promise<void> {
  try {
    await clearStaleAstroBuildLock({ repoRoot, staleMs: Number.MAX_SAFE_INTEGER });
  } catch {
    // best-effort cleanup only
  }
}
