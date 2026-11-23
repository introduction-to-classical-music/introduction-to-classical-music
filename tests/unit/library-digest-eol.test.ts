import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hashDirectory, isTextDigestPath, normalizeTextEol } from "../../scripts/lib/library-ops.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTree(label: string, eol: "\n" | "\r\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), `classical-digest-eol-${label}-`));
  tempDirs.push(root);
  await mkdir(path.join(root, "content", "library"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  const lines = ["{", '  "id": "composer-1",', '  "name": "贝多芬"', "}"];
  await writeFile(path.join(root, "content", "library", "composers.json"), lines.join(eol) + eol, "utf8");
  await writeFile(path.join(root, "content", "library", "notes.md"), ["# 标题", "正文"].join(eol) + eol, "utf8");
  await writeFile(path.join(root, "assets", "cover.bin"), Buffer.from([1, 2, 3, 4, 5]));
  return root;
}

describe("deterministic library digest (W10a)", () => {
  it("normalizes CRLF/CR to LF for text content", () => {
    expect(normalizeTextEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeTextEol("no EOL")).toBe("no EOL");
  });

  it("recognizes text digest extensions", () => {
    for (const file of ["a.json", "b.md", "c.txt", "d.yml", "e.html", "f.css", "g.js", "h.xml", "i.csv"]) {
      expect(isTextDigestPath(file), file).toBe(true);
    }
    for (const file of ["a.png", "b.bin", "c.jpg", "d.tar"]) {
      expect(isTextDigestPath(file), file).toBe(false);
    }
  });

  it("gives the same digest for CRLF and LF checkouts of the same content", async () => {
    const lfTree = await createTree("lf", "\n");
    const crlfTree = await createTree("crlf", "\r\n");

    const lfDigest = await hashDirectory(lfTree);
    const crlfDigest = await hashDirectory(crlfTree);

    expect(crlfDigest.digest).toBe(lfDigest.digest);
    expect(crlfDigest.files.map((file: { sha256: string }) => file.sha256)).toEqual(
      lfDigest.files.map((file: { sha256: string }) => file.sha256),
    );
  });

  it("still hashes binary files byte-for-byte", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "classical-digest-binary-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "a.bin"), Buffer.from([0x0d, 0x0a]));
    const first = await hashDirectory(root);
    await writeFile(path.join(root, "a.bin"), Buffer.from([0x0a]));
    const second = await hashDirectory(root);
    expect(second.digest).not.toBe(first.digest);
  });
});
