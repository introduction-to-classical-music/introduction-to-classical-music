import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectRegisteredLocalResourcePaths,
  isAllowedLocalResourcePath,
  isPathWithin,
  resolveAllowedLocalResourceTarget,
} from "../../packages/data-core/src/local-resource-access.ts";
import { validateLibrary } from "../../packages/shared/src/schema.ts";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "classical-local-resource-access-"));
  tempDirs.push(root);
  return root;
}

function buildLibrary() {
  return validateLibrary({
    composers: [
      {
        id: "composer-1",
        slug: "composer-1",
        name: "贝多芬",
        fullName: "贝多芬",
        nameLatin: "Ludwig van Beethoven",
        country: "Germany",
        avatarSrc: "",
        aliases: [],
        sortKey: "0010",
        summary: "",
      },
    ],
    people: [],
    workGroups: [
      { id: "group-1", composerId: "composer-1", title: "管弦乐", slug: "orchestral", path: ["管弦乐"], sortKey: "0010" },
    ],
    works: [
      {
        id: "work-1",
        composerId: "composer-1",
        groupIds: ["group-1"],
        slug: "work-1",
        title: "作品一",
        titleLatin: "",
        aliases: [],
        catalogue: "",
        summary: "",
        sortKey: "0010",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ],
    recordings: [
      {
        id: "recording-1",
        workId: "work-1",
        slug: "recording-1",
        title: "Recording",
        workTypeHint: "orchestral",
        sortKey: "0010",
        isPrimaryRecommendation: false,
        updatedAt: "2026-03-21T00:00:00.000Z",
        images: [],
        credits: [],
        links: [
          {
            platform: "local",
            url: "",
            localPath: "D:\\Music\\registered\\recording.flac",
            title: "Local",
            linkType: "local",
            visibility: "local-only",
          },
        ],
        notes: "",
        performanceDateText: "",
        venueText: "",
        albumTitle: "",
        label: "",
        releaseDate: "",
        infoPanel: {
          text: "",
          articleId: "",
          collectionLinks: [
            {
              platform: "local",
              url: "",
              localPath: "D:\\Music\\registered\\collection.flac",
              title: "Collection",
              linkType: "local",
              visibility: "local-only",
            },
            {
              platform: "local",
              url: "",
              localPath: "D:\\Music\\registered\\recording.flac",
              title: "Duplicate",
              linkType: "local",
              visibility: "local-only",
            },
          ],
        },
        legacyPath: "",
      },
    ],
  });
}

describe("local resource access policy (W3)", () => {
  it("collects unique registered local paths from links and info panels", () => {
    const paths = collectRegisteredLocalResourcePaths(buildLibrary());
    expect(paths.sort()).toEqual([
      "D:\\Music\\registered\\collection.flac",
      "D:\\Music\\registered\\recording.flac",
    ]);
  });

  it("detects path containment for both separators", () => {
    const root = path.resolve("C:/Library");
    expect(isPathWithin(root, path.join(root, "assets", "cover.jpg"))).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(root, "C:/Other/file.flac")).toBe(false);
    expect(isPathWithin(root, "C:/LibraryEvil/file.flac")).toBe(false);
  });

  it("allows registered paths and library files, rejects unregistered ones", async () => {
    const root = await createTempRoot();
    const libraryRoot = path.join(root, "library");
    const assetsDir = path.join(libraryRoot, "assets");
    const registeredPath = path.join(root, "music", "registered.flac");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(path.dirname(registeredPath), { recursive: true });
    await writeFile(path.join(assetsDir, "cover.jpg"), "asset", "utf8");
    await writeFile(registeredPath, "audio", "utf8");

    const options = {
      libraryRootDir: libraryRoot,
      assetsDirs: [assetsDir],
      registeredLocalPaths: [registeredPath],
    };

    expect(isAllowedLocalResourcePath(registeredPath, options)).toBe(true);
    expect(isAllowedLocalResourcePath(path.join(assetsDir, "cover.jpg"), options)).toBe(true);
    expect(isAllowedLocalResourcePath(path.join(root, "unregistered.flac"), options)).toBe(false);
    expect(isAllowedLocalResourcePath("", options)).toBe(false);
    expect(isAllowedLocalResourcePath("   ", options)).toBe(false);
  });

  it("resolves only existing, allowed targets", async () => {
    const root = await createTempRoot();
    const libraryRoot = path.join(root, "library");
    await mkdir(libraryRoot, { recursive: true });
    const allowedFile = path.join(libraryRoot, "assets", "track.flac");
    await mkdir(path.dirname(allowedFile), { recursive: true });
    await writeFile(allowedFile, "audio", "utf8");
    const options = { libraryRootDir: libraryRoot };

    await expect(resolveAllowedLocalResourceTarget(allowedFile, options)).resolves.toBe(path.resolve(allowedFile));
    await expect(
      resolveAllowedLocalResourceTarget(path.join(libraryRoot, "assets", "missing.flac"), options),
    ).rejects.toThrow(/ENOENT/);
    await expect(resolveAllowedLocalResourceTarget("", options)).rejects.toThrow(/Missing local resource path/);
    await expect(
      resolveAllowedLocalResourceTarget(path.join(root, "outside.flac"), options),
    ).rejects.toThrow(/not registered in the active library/);
  });
});

describe("local resource executable/realpath hardening (C-F13)", () => {
  it("rejects executable/script extensions even inside an allowed root", async () => {
    const root = await createTempRoot();
    const libraryRoot = path.join(root, "library");
    await mkdir(libraryRoot, { recursive: true });
    for (const name of ["tool.exe", "run.cmd", "hook.ps1", "link.lnk", "script.js", "setup.msi"]) {
      const target = path.join(libraryRoot, name);
      await writeFile(target, "x", "utf8");
      await expect(resolveAllowedLocalResourceTarget(target, { libraryRootDir: libraryRoot })).rejects.toThrow(
        /可执行文件或脚本/,
      );
    }
  });

  it("allows ordinary images/PDFs inside the allowed root", async () => {
    const root = await createTempRoot();
    const libraryRoot = path.join(root, "library");
    await mkdir(libraryRoot, { recursive: true });
    for (const name of ["cover.jpg", "score.pdf"]) {
      const target = path.join(libraryRoot, name);
      await writeFile(target, "x", "utf8");
      await expect(resolveAllowedLocalResourceTarget(target, { libraryRootDir: libraryRoot })).resolves.toBe(
        path.resolve(target),
      );
    }
  });

  it("rejects symlink escapes out of the allowed root (when symlinks are available)", async () => {
    const root = await createTempRoot();
    const libraryRoot = path.join(root, "library");
    const outsideDir = path.join(root, "outside");
    await mkdir(libraryRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "secret.mp3");
    await writeFile(outsideFile, "audio", "utf8");
    const linkPath = path.join(libraryRoot, "escape.mp3");
    try {
      await symlink(outsideFile, linkPath, "file");
    } catch {
      return; // Windows without symlink privilege: covered by realpath logic review
    }
    await expect(resolveAllowedLocalResourceTarget(linkPath, { libraryRootDir: libraryRoot })).rejects.toThrow(
      /not registered/,
    );
  });
});
