import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acquireAstroBuildLock,
  astroBuildLockPath,
  clearStaleAstroBuildLock,
  readAstroBuildLockInfo,
} from "../../packages/data-core/src/site-build-lock.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const target = tempRoots.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTempRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "classical-astro-build-lock-"));
  tempRoots.push(root);
  await mkdir(path.join(root, "output"), { recursive: true });
  return root;
}

async function spawnExitedProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await once(child, "exit");
  return child.pid ?? -1;
}

async function spawnLiveProcess() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "ignore" });
  await once(child, "spawn");
  return child;
}

async function writeLock(repoRoot: string, pid: number, token = "foreign-token") {
  await writeFile(
    astroBuildLockPath(repoRoot),
    `${JSON.stringify({ token, pid, createdAt: new Date().toISOString() })}\n`,
    "utf8",
  );
}

describe("Astro build lock stability (Windows CI hardening)", () => {
  it("acquires the lock, supports same-process reentrancy and releases only after the outer release", async () => {
    const repoRoot = await createTempRepo();
    const releaseOuter = await acquireAstroBuildLock({ repoRoot, timeoutMs: 2000 });
    const info = await readAstroBuildLockInfo(astroBuildLockPath(repoRoot));
    expect(info?.pid).toBe(process.pid);
    expect(info?.token).toBeTruthy();

    const releaseNested = await acquireAstroBuildLock({ repoRoot, timeoutMs: 2000 });
    await releaseNested();
    expect(await readAstroBuildLockInfo(astroBuildLockPath(repoRoot))).not.toBeNull();

    await releaseOuter();
    expect(await readAstroBuildLockInfo(astroBuildLockPath(repoRoot))).toBeNull();

    // Release must be idempotent (called from multiple error paths).
    await expect(releaseOuter()).resolves.toBeUndefined();
  });

  it("releases the lock when the build throws", async () => {
    const repoRoot = await createTempRepo();
    const release = await acquireAstroBuildLock({ repoRoot, timeoutMs: 2000 });
    try {
      throw new Error("simulated astro build failure");
    } catch (error) {
      expect((error as Error).message).toContain("simulated");
    } finally {
      await release();
    }
    expect(await readAstroBuildLockInfo(astroBuildLockPath(repoRoot))).toBeNull();
  });

  it("immediately reclaims a lock whose holder process is dead", async () => {
    const repoRoot = await createTempRepo();
    const deadPid = await spawnExitedProcess();
    await writeLock(repoRoot, deadPid, "dead-holder");

    const release = await acquireAstroBuildLock({ repoRoot, timeoutMs: 3000, pollMs: 20 });
    const info = await readAstroBuildLockInfo(astroBuildLockPath(repoRoot));
    expect(info?.pid).toBe(process.pid);
    expect(info?.token).not.toBe("dead-holder");
    await release();
  });

  it("times out with holder information when a live foreign process keeps the lock", async () => {
    const repoRoot = await createTempRepo();
    const holder = await spawnLiveProcess();
    try {
      await writeLock(repoRoot, holder.pid ?? -1, "live-foreign-holder");
      await expect(
        acquireAstroBuildLock({ repoRoot, timeoutMs: 300, pollMs: 20 }),
      ).rejects.toThrow(/Timed out waiting for the Astro build lock.*holder pid=/);
      // Teardown helper removes the lock once the holder is gone.
      holder.kill();
      await once(holder, "exit");
      expect(await clearStaleAstroBuildLock({ repoRoot })).toBe(true);
      expect(await readAstroBuildLockInfo(astroBuildLockPath(repoRoot))).toBeNull();
    } finally {
      holder.kill();
    }
  });

  it("never clears a lock currently owned by this process", async () => {
    const repoRoot = await createTempRepo();
    const release = await acquireAstroBuildLock({ repoRoot, timeoutMs: 2000 });
    expect(await clearStaleAstroBuildLock({ repoRoot })).toBe(false);
    expect(await readAstroBuildLockInfo(astroBuildLockPath(repoRoot))).not.toBeNull();
    await release();
  });

  it("replaces unreadable/partial lock files after the grace period", async () => {
    const repoRoot = await createTempRepo();
    await writeFile(astroBuildLockPath(repoRoot), "{not-json", "utf8");
    // Fresh readable-but-invalid lock: waits briefly, then succeeds once the
    // grace period passes (test uses a tiny stale window instead of sleeping).
    const release = await acquireAstroBuildLock({ repoRoot, timeoutMs: 3000, pollMs: 20, staleMs: 0 });
    expect((await readAstroBuildLockInfo(astroBuildLockPath(repoRoot)))?.pid).toBe(process.pid);
    await release();
  });

  it("treats release as a no-op when another process replaced the lock", async () => {
    const repoRoot = await createTempRepo();
    const release = await acquireAstroBuildLock({ repoRoot, timeoutMs: 2000 });
    await writeFile(
      astroBuildLockPath(repoRoot),
      `${JSON.stringify({ token: "new-owner", pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    await release();
    expect((await readAstroBuildLockInfo(astroBuildLockPath(repoRoot)))?.token).toBe("new-owner");
    await rm(astroBuildLockPath(repoRoot), { force: true });
  });
});
