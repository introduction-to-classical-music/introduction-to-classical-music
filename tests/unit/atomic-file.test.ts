import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic, writeJsonFileAtomic } from "../../packages/data-core/src/atomic-file.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTempDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), "classical-atomic-file-"));
  tempDirs.push(root);
  return root;
}

describe("atomic file writes (F16)", () => {
  it("writes JSON content and creates parent directories", async () => {
    const root = await createTempDir();
    const target = path.join(root, "nested", "state.json");

    await writeJsonFileAtomic(target, { ok: true, count: 2 });

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ ok: true, count: 2 });
    await expect(readdir(path.dirname(target))).resolves.toEqual(["state.json"]);
  });

  it("replaces existing content without leaving temporary files", async () => {
    const root = await createTempDir();
    const target = path.join(root, "state.json");
    await writeFile(target, "old", "utf8");

    await writeJsonFileAtomic(target, { version: 2 });

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 2 });
    expect((await readdir(root)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("writes binary content atomically", async () => {
    const root = await createTempDir();
    const target = path.join(root, "asset.bin");
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);

    await writeFileAtomic(target, bytes);

    expect([...(await readFile(target))]).toEqual([1, 2, 3, 4, 5]);
  });

  it("cleans up the temporary file when the rename target is invalid", async () => {
    const root = await createTempDir();
    const target = path.join(root, "occupied");
    await mkdir(target);

    await expect(writeFileAtomic(target, "content")).rejects.toBeTruthy();
    expect((await readdir(root)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
