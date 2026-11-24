import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Cross-process lock for Astro builds (W10/CI hardening).
 *
 * Astro builds share caches under `apps/site/.astro` and `node_modules`; two
 * test files (or an owner + CLI build) building concurrently can corrupt each
 * other. This module serializes builds across processes with a lock file.
 *
 * Robustness rules:
 * - same-process reentrancy: a nested build in the same process keeps the lock
 *   and decrements a depth counter; only the outermost release removes the file;
 * - dead holder: if the lock's PID is no longer alive (e.g. a test worker was
 *   killed by a timeout), the lock is treated as stale and removed immediately;
 * - old/unreadable locks older than `staleMs` are also removed;
 * - failures release the lock via the caller's `finally` (see site-build-runner);
 * - wait timeouts are short (default 120s) and the error includes the holder
 *   metadata so Windows CI failures are diagnosable.
 */

export const ASTRO_BUILD_LOCK_FILE = ".astro-build.lock";
export const ASTRO_BUILD_LOCK_TIMEOUT_MS = 120_000;
export const ASTRO_BUILD_LOCK_POLL_MS = 250;
export const ASTRO_BUILD_LOCK_STALE_MS = 10 * 60_000;

export type AstroBuildLockInfo = {
  token: string;
  pid: number;
  createdAt: string;
  processName?: string;
};

export type AstroBuildLockOptions = {
  repoRoot: string;
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
};

type HeldLock = {
  token: string;
  depth: number;
};

const heldLocks = new Map<string, HeldLock>();

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function astroBuildLockPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), "output", ASTRO_BUILD_LOCK_FILE);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we may not signal it.
    return code === "EPERM";
  }
}

export async function readAstroBuildLockInfo(lockPath: string): Promise<AstroBuildLockInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as Partial<AstroBuildLockInfo>;
    if (!parsed || typeof parsed.token !== "string" || !Number.isFinite(parsed.pid)) {
      return null;
    }
    return {
      token: parsed.token,
      pid: Number(parsed.pid),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
}

async function removeIfStale(lockPath: string, staleMs: number): Promise<boolean> {
  const info = await readAstroBuildLockInfo(lockPath);
  if (info && isProcessAlive(info.pid)) {
    return false;
  }
  try {
    const lockStats = await stat(lockPath);
    if (Date.now() - lockStats.mtimeMs > staleMs) {
      await unlink(lockPath).catch(() => undefined);
      return true;
    }
    if (!info) {
      // Unreadable/partial lock: give the writer a short grace period, then drop.
      const graceMs = Math.min(2_000, staleMs);
      if (Date.now() - lockStats.mtimeMs > graceMs) {
        await unlink(lockPath).catch(() => undefined);
        return true;
      }
      return false;
    }
    // Known holder with a dead PID: remove immediately regardless of mtime.
    await unlink(lockPath).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the Astro build lock. Returns an idempotent release function.
 * Nested calls in the same process reuse the existing lock (depth counter).
 */
export async function acquireAstroBuildLock(options: AstroBuildLockOptions): Promise<() => Promise<void>> {
  const lockPath = astroBuildLockPath(options.repoRoot);
  const timeoutMs = options.timeoutMs ?? ASTRO_BUILD_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? ASTRO_BUILD_LOCK_POLL_MS;
  const staleMs = options.staleMs ?? ASTRO_BUILD_LOCK_STALE_MS;
  await mkdir(path.dirname(lockPath), { recursive: true });

  const existing = heldLocks.get(lockPath);
  if (existing) {
    existing.depth += 1;
    return createRelease(lockPath, existing);
  }

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        const info: AstroBuildLockInfo = {
          token,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        };
        await handle.writeFile(`${JSON.stringify(info)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      const held = { token, depth: 1 };
      heldLocks.set(lockPath, held);
      return createRelease(lockPath, held);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (await removeIfStale(lockPath, staleMs)) {
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        const holder = await readAstroBuildLockInfo(lockPath);
        throw new Error(
          `Timed out waiting for the Astro build lock: ${lockPath}` +
            (holder
              ? ` (holder pid=${holder.pid} createdAt=${holder.createdAt} token=${holder.token})`
              : " (holder metadata unreadable)"),
        );
      }
      await delay(pollMs);
    }
  }
}

function createRelease(lockPath: string, held: HeldLock): () => Promise<void> {
  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    const state = heldLocks.get(lockPath);
    if (!state || state.token !== held.token) {
      return;
    }
    state.depth -= 1;
    if (state.depth > 0) {
      return;
    }
    heldLocks.delete(lockPath);
    try {
      const info = await readAstroBuildLockInfo(lockPath);
      if (info && info.token !== held.token) {
        return; // another process re-created the lock after ours disappeared
      }
      await unlink(lockPath);
    } catch {
      // already released or unreadable: nothing else to do
    }
  };
}

/**
 * Test/teardown helper: remove a leftover lock when its holder is dead or the
 * file is older than `staleMs`. Returns true when a stale lock was removed.
 */
export async function clearStaleAstroBuildLock(options: AstroBuildLockOptions): Promise<boolean> {
  const lockPath = astroBuildLockPath(options.repoRoot);
  const held = heldLocks.get(lockPath);
  if (held) {
    return false; // this process currently owns the lock: never clear it
  }
  return removeIfStale(lockPath, options.staleMs ?? ASTRO_BUILD_LOCK_STALE_MS);
}
