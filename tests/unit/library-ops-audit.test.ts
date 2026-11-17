import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createLibraryRoot(options: { localPath?: string; externalUrl?: string; summary?: string } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-library-ops-audit-"));
  tempDirs.push(tempRoot);
  await mkdir(path.join(tempRoot, "content", "library"), { recursive: true });
  await mkdir(path.join(tempRoot, "content", "site"), { recursive: true });
  await mkdir(path.join(tempRoot, "assets"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "library.manifest.json"),
    JSON.stringify(
      { schemaVersion: "library-bundle-v1", libraryId: "library-1", libraryName: "测试库", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", appMinVersion: "0.1.1" },
      null,
      2,
    ),
    "utf8",
  );
  const links = [
    {
      platform: "youtube",
      url: options.externalUrl ?? "https://www.youtube.com/watch?v=abc",
      localPath: "",
      title: "公开链接",
      linkType: "external",
      visibility: "public",
    },
    ...(options.localPath
      ? [
          {
            platform: "local",
            url: "",
            localPath: options.localPath,
            title: "本地文件",
            linkType: "local",
            visibility: "local-only",
          },
        ]
      : []),
  ];
  await writeFile(
    path.join(tempRoot, "content", "library", "recordings.json"),
    JSON.stringify([{ id: "recording-1", links }], null, 2),
    "utf8",
  );
  await writeFile(
    path.join(tempRoot, "content", "library", "composers.json"),
    JSON.stringify([{ id: "composer-1", summary: options.summary ?? "普通简介" }], null, 2),
    "utf8",
  );
  for (const [fileName, contents] of Object.entries({
    "people.json": [],
    "work-groups.json": [],
    "works.json": [],
    "entity-vitals-review.json": [],
    "review-queue.json": [],
    "person-links.json": { canonicalPersonLinks: {} },
  })) {
    await writeFile(path.join(tempRoot, "content", "library", fileName), JSON.stringify(contents, null, 2), "utf8");
  }
  await writeFile(
    path.join(tempRoot, "content", "site", "config.json"),
    JSON.stringify({ title: "测试站点" }, null, 2),
    "utf8",
  );
  await writeFile(path.join(tempRoot, "content", "site", "articles.json"), JSON.stringify([], null, 2), "utf8");
  return tempRoot;
}

describe("library root audit semantics (F15)", () => {
  it("allows schema-valid localPath values and counts them", async () => {
    const { auditLibraryRoot } = await import("../../scripts/lib/library-ops.mjs");
    const root = await createLibraryRoot({ localPath: "D:\\Music\\Mahler\\Symphony7.flac" });
    const report = await auditLibraryRoot(root, { mode: "working" });

    expect(report.ok).toBe(true);
    expect(report.counts.localResourceLinks).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("still rejects absolute paths in non-link fields", async () => {
    const { auditLibraryRoot } = await import("../../scripts/lib/library-ops.mjs");
    const root = await createLibraryRoot({ summary: "见 D:\\Users\\maintainer\\notes.txt" });
    const report = await auditLibraryRoot(root, { mode: "working" });

    expect(report.ok).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "absolute-windows-path" }),
      ]),
    );
  });

  it("still rejects localhost URLs and known test content", async () => {
    const { auditLibraryRoot } = await import("../../scripts/lib/library-ops.mjs");
    const root = await createLibraryRoot({ externalUrl: "http://localhost:8080/test" });
    const report = await auditLibraryRoot(root, { mode: "working" });

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding: { code: string }) => finding.code)).toEqual(
      expect.arrayContaining(["local-host"]),
    );
  });
});
