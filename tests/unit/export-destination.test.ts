import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertExportDestinationAllowed,
  assertExportDestinationSafe,
} from "../../packages/data-core/src/export-destination.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "classical-export-destination-"));
  tempDirs.push(root);
  return root;
}

describe("export destination policy (W3)", () => {
  it("rejects drive roots, system roots, the home directory and the active library", async () => {
    const root = await createTempRoot();
    const systemRoot = path.join(root, "Windows");
    const libraryRoot = path.join(root, "library");
    await mkdir(systemRoot, { recursive: true });
    await mkdir(libraryRoot, { recursive: true });

    expect(() => assertExportDestinationAllowed("C:\\")).toThrow(/drive or share root/);
    expect(() => assertExportDestinationAllowed("D:/")).toThrow(/drive or share root/);
    expect(() => assertExportDestinationAllowed("", {})).toThrow(/Missing site export destination/);
    expect(() =>
      assertExportDestinationAllowed(root, { homeDir: root }),
    ).toThrow(/user home directory/);
    expect(() =>
      assertExportDestinationAllowed(path.join(systemRoot, "System32"), { systemRoots: [systemRoot] }),
    ).toThrow(/system directory/);
    expect(() =>
      assertExportDestinationAllowed(path.join(libraryRoot, "exports"), { activeLibraryRoot: libraryRoot }),
    ).toThrow(/inside the active library/);
  });

  it("allows a new directory and rejects an existing file", async () => {
    const root = await createTempRoot();
    const target = path.join(root, "new-site");
    await expect(assertExportDestinationSafe(target, {})).resolves.toBe(path.resolve(target));

    const fileTarget = path.join(root, "site.txt");
    await writeFile(fileTarget, "x", "utf8");
    await expect(assertExportDestinationSafe(fileTarget, {})).rejects.toMatchObject({
      code: "destination-not-directory",
    });
  });

  it("requires explicit overwrite for a non-empty existing directory", async () => {
    const root = await createTempRoot();
    const target = path.join(root, "existing");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "old.html"), "old", "utf8");

    await expect(assertExportDestinationSafe(target, {})).rejects.toMatchObject({
      code: "destination-not-empty",
    });
    await expect(assertExportDestinationSafe(target, { overwrite: true })).resolves.toBe(path.resolve(target));

    const emptyTarget = path.join(root, "empty");
    await mkdir(emptyTarget, { recursive: true });
    await expect(assertExportDestinationSafe(emptyTarget, {})).resolves.toBe(path.resolve(emptyTarget));
  });
});
