import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetAstroBuildLockForTests } from "./support/astro-build-lock.ts";

const PAGES_BASE = "/introduction-to-classical-music-sites/";
const tempDirs: string[] = [];

beforeAll(async () => {
  await resetAstroBuildLockForTests();
});

afterAll(async () => {
  await resetAstroBuildLockForTests();
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createLibraryFixture() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-site-export-links-"));
  tempDirs.push(tempRoot);
  const libraryRoot = path.join(tempRoot, "library");
  await mkdir(path.join(libraryRoot, "assets", "managed"), { recursive: true });
  await mkdir(path.join(libraryRoot, "assets", "imported"), { recursive: true });
  await writeJson(path.join(libraryRoot, "library.manifest.json"), {
    schemaVersion: "library-bundle-v1",
    libraryId: "links-fixture",
    libraryName: "W10b links fixture",
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
    appMinVersion: "0.1.1",
  });
  await writeJson(path.join(libraryRoot, "content", "library", "composers.json"), [
    {
      id: "composer-1",
      slug: "beethoven",
      name: "贝多芬",
      fullName: "贝多芬",
      nameLatin: "Ludwig van Beethoven",
      country: "Germany",
      avatarSrc: "",
      aliases: [],
      sortKey: "0010",
      summary: "",
    },
  ]);
  await writeJson(path.join(libraryRoot, "content", "library", "people.json"), [
    {
      id: "person-conductor",
      slug: "karajan",
      name: "卡拉扬",
      fullName: "卡拉扬",
      nameLatin: "Herbert von Karajan",
      country: "Austria",
      avatarSrc: "",
      roles: ["conductor"],
      aliases: [],
      sortKey: "0010",
      summary: "",
    },
    {
      id: "person-orchestra",
      slug: "bpo",
      name: "柏林爱乐乐团",
      fullName: "柏林爱乐乐团",
      nameLatin: "Berliner Philharmoniker",
      country: "Germany",
      avatarSrc: "",
      roles: ["orchestra"],
      aliases: [],
      sortKey: "0011",
      summary: "",
    },
  ]);
  await writeJson(path.join(libraryRoot, "content", "library", "work-groups.json"), [
    { id: "group-1", composerId: "composer-1", title: "交响曲", slug: "symphony", path: ["交响曲"], sortKey: "0010" },
  ]);
  await writeJson(path.join(libraryRoot, "content", "library", "works.json"), [
    {
      id: "work-1",
      composerId: "composer-1",
      groupIds: ["group-1"],
      slug: "work-1",
      title: "第七交响曲",
      titleLatin: "Symphony No. 7",
      aliases: [],
      catalogue: "Op. 92",
      summary: "",
      sortKey: "0010",
      updatedAt: "2026-03-21T00:00:00.000Z",
    },
  ]);
  await writeJson(path.join(libraryRoot, "content", "library", "recordings.json"), [
    {
      id: "recording-1",
      workId: "work-1",
      slug: "recording-1",
      title: "卡拉扬 - 1977",
      workTypeHint: "orchestral",
      sortKey: "0010",
      isPrimaryRecommendation: true,
      updatedAt: "2026-03-21T00:00:00.000Z",
      images: [],
      credits: [
        { role: "conductor", personId: "person-conductor", displayName: "卡拉扬", label: "指挥" },
        { role: "orchestra", personId: "person-orchestra", displayName: "柏林爱乐乐团", label: "乐团" },
      ],
      links: [],
      notes: "",
      performanceDateText: "1977",
      venueText: "Berlin",
      albumTitle: "",
      label: "",
      releaseDate: "",
      infoPanel: { text: "", articleId: "", collectionLinks: [] },
      legacyPath: "",
    },
  ]);
  await writeJson(path.join(libraryRoot, "content", "library", "review-queue.json"), []);
  await writeJson(path.join(libraryRoot, "content", "library", "entity-vitals-review.json"), []);
  await writeJson(path.join(libraryRoot, "content", "library", "person-links.json"), { canonicalPersonLinks: {} });
  await writeJson(path.join(libraryRoot, "content", "site", "config.json"), { title: "W10b 站点", about: [] });
  await writeJson(path.join(libraryRoot, "content", "site", "articles.json"), []);
  return { tempRoot, libraryRoot };
}

async function collectHtmlFiles(rootDir: string, relativeDir = ""): Promise<string[]> {
  const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(rootDir, relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relativePath);
    }
  }
  return files;
}

const HREF_PATTERN = /<a\b[^>]*?\bhref\s*=\s*"([^"]*)"/gi;

async function analyzeSiteLinks(siteDir: string) {
  const htmlFiles = await collectHtmlFiles(siteDir);
  const internalHrefs: string[] = [];
  for (const relativePath of htmlFiles) {
    const html = await readFile(path.join(siteDir, relativePath), "utf8");
    for (const match of html.matchAll(HREF_PATTERN)) {
      const href = match[1].trim();
      if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("//")) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) continue;
      if (href.startsWith("/")) internalHrefs.push(href);
    }
  }
  return { htmlFiles, internalHrefs };
}

function runExportSite(libraryRoot: string, outputDir: string, siteBase: string) {
  const repoRoot = process.cwd();
  const inherited = process.env;
  const environment: NodeJS.ProcessEnv = {
    PATH: inherited.PATH,
    SystemRoot: inherited.SystemRoot,
    windir: inherited.windir,
    TEMP: inherited.TEMP,
    TMP: inherited.TMP,
    ComSpec: inherited.ComSpec,
    PATHEXT: inherited.PATHEXT,
    USERPROFILE: inherited.USERPROFILE,
    APPDATA: inherited.APPDATA,
    LOCALAPPDATA: inherited.LOCALAPPDATA,
    HOME: inherited.HOME,
    NODE_ENV: "production",
  };
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "export-site-release.mjs"), "--source", libraryRoot, "--out", outputDir, "--base", siteBase],
    { cwd: repoRoot, env: environment, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`export-site-release failed (exit=${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

describe("exported site internal links carry the deployment base (W10b)", () => {
  it("uses the Pages base for every internal anchor (real export-site-release run)", async () => {
    const { tempRoot, libraryRoot } = await createLibraryFixture();
    const siteDir = path.join(tempRoot, "pages-site");
    runExportSite(libraryRoot, siteDir, PAGES_BASE);

    const manifest = JSON.parse(await readFile(path.join(siteDir, "site-release-manifest.json"), "utf8"));
    expect(manifest.siteBase).toBe(PAGES_BASE);

    const { htmlFiles, internalHrefs } = await analyzeSiteLinks(siteDir);
    expect(htmlFiles.length).toBeGreaterThan(5);
    expect(internalHrefs.length).toBeGreaterThan(10);
    const missingBase = internalHrefs.filter((href) => !(href === PAGES_BASE.slice(0, -1) || href.startsWith(PAGES_BASE)));
    expect(missingBase).toEqual([]);
    expect(internalHrefs.some((href) => href.startsWith(`${PAGES_BASE}works/`))).toBe(true);
    expect(internalHrefs.some((href) => href.startsWith(`${PAGES_BASE}recordings/`))).toBe(true);
    expect(htmlFiles.some((file) => file.startsWith(`conductors${path.sep}`) || file.startsWith("conductors/"))).toBe(true);
  }, 120000);

  it("keeps root-relative links for a root export without the Pages prefix", async () => {
    const { tempRoot, libraryRoot } = await createLibraryFixture();
    const siteDir = path.join(tempRoot, "root-site");
    runExportSite(libraryRoot, siteDir, "/");

    const { internalHrefs } = await analyzeSiteLinks(siteDir);
    expect(internalHrefs.length).toBeGreaterThan(10);
    expect(internalHrefs.every((href) => href.startsWith("/"))).toBe(true);
    expect(internalHrefs.some((href) => href.startsWith(PAGES_BASE))).toBe(false);
    expect(internalHrefs.some((href) => href.startsWith("/works/"))).toBe(true);
  }, 120000);
});
