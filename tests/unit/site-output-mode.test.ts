import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.resetModules();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

const localRecording = (id: string, localPath: string) => ({
  id,
  workId: "work-1",
  slug: id,
  title: "Local recording",
  workTypeHint: "orchestral",
  sortKey: "0010",
  isPrimaryRecommendation: false,
  updatedAt: "2026-03-21T00:00:00.000Z",
  images: [],
  credits: [],
  links: [
    {
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=abc",
      localPath: "",
      title: "Public",
      linkType: "external",
      visibility: "public",
    },
    {
      platform: "local",
      url: "",
      localPath,
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
        localPath: "D:\\Music\\collection.flac",
        title: "Collection",
        linkType: "local",
        visibility: "local-only",
      },
    ],
  },
  legacyPath: "",
});

async function seedBundle(libraryRoot: string) {
  const { ensureLibraryBundle } = await import("../../packages/data-core/src/library-bundle.ts");
  const { saveLibraryToDisk, saveSiteConfig, saveArticlesToDisk } = await import(
    "../../packages/data-core/src/library-store.ts"
  );
  const { validateLibrary } = await import("../../packages/shared/src/schema.ts");
  await ensureLibraryBundle(libraryRoot, { libraryName: "输出模式测试库" });
  await saveLibraryToDisk(
    validateLibrary({
      composers: [
        {
          id: "composer-1",
          slug: "composer-1",
          name: "作曲家 <script>alert(1)</script>",
          fullName: "作曲家 <script>alert(1)</script>",
          nameLatin: "Composer <script>alert(2)</script>",
          country: "Germany",
          avatarSrc: "",
          aliases: [],
          sortKey: "0010",
          summary: "",
        },
      ],
      people: [],
      workGroups: [
        {
          id: "group-1",
          composerId: "composer-1",
          title: "管弦乐",
          slug: "orchestral",
          path: ["管弦乐"],
          sortKey: "0010",
        },
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
      recordings: [localRecording("recording-1", "D:\\Music\\Mahler.flac")],
    }),
  );
  await saveSiteConfig({
    title: "输出模式测试",
    subtitle: "",
    description: "",
    heroIntro: "",
    composerDirectoryIntro: "",
    conductorDirectoryIntro: "",
    searchIntro: "",
    about: [],
    contact: { label: "", value: "" },
    copyrightNotice: "",
    lastImportedAt: "",
  });
  await saveArticlesToDisk([]);
}

async function writeGenerated(libraryRoot: string, options: { siteOutputMode?: "local" | "public" }) {
  process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
  process.env.ICM_APP_DATA_DIR = path.join(path.dirname(libraryRoot), "appdata");
  const { writeGeneratedArtifacts } = await import("../../packages/data-core/src/library-store.ts");
  const result = await writeGeneratedArtifacts(options);
  const generatedLibraryRaw = await readFile(path.join(libraryRoot, "runtime", "generated", "library.json"), "utf8");
  return { result, generatedLibraryRaw };
}

async function prepareLibrary(libraryRoot: string) {
  // Bundle-mode paths must be in effect before any library-store call so the
  // fixture is written into the temp library instead of the repository data.
  process.env.ICM_ACTIVE_LIBRARY_DIR = libraryRoot;
  process.env.ICM_APP_DATA_DIR = path.join(path.dirname(libraryRoot), "appdata");
  await seedBundle(libraryRoot);
}

describe("site output mode stripping (F15)", () => {
  it("strips local/local-only links and reports the count in public mode", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-site-output-mode-"));
    tempDirs.push(tempRoot);
    const libraryRoot = path.join(tempRoot, "library");
    await prepareLibrary(libraryRoot);

    const { result, generatedLibraryRaw } = await writeGenerated(libraryRoot, { siteOutputMode: "public" });
    const generated = JSON.parse(generatedLibraryRaw);

    expect(result.siteOutputMode).toBe("public");
    // one local recording link + one local collection link in the info panel
    expect(result.strippedLocalLinks).toBe(2);
    expect(generatedLibraryRaw).not.toContain("D:\\\\Music");
    expect(generated.recordings[0].links).toHaveLength(1);
    expect(generated.recordings[0].links[0].url).toBe("https://www.youtube.com/watch?v=abc");
    expect(generated.recordings[0].links[0].linkType).toBe("external");
    expect(generated.recordings[0].infoPanel.collectionLinks).toEqual([]);
  });

  it("keeps local links for local builds (W3 will switch these to IPC)", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-site-output-mode-local-"));
    tempDirs.push(tempRoot);
    const libraryRoot = path.join(tempRoot, "library");
    await prepareLibrary(libraryRoot);

    const { result, generatedLibraryRaw } = await writeGenerated(libraryRoot, { siteOutputMode: "local" });
    const generated = JSON.parse(generatedLibraryRaw);

    expect(result.siteOutputMode).toBe("local");
    expect(result.strippedLocalLinks).toBe(0);
    expect(generated.recordings[0].links).toHaveLength(2);
    const localLink = generated.recordings[0].links.find((link: { linkType: string }) => link.linkType === "local");
    expect(localLink.localPath).toBe("D:\\Music\\Mahler.flac");
    expect(generated.recordings[0].infoPanel.collectionLinks).toHaveLength(1);
  });

  it("defaults to the safe public mode when no mode is given", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-site-output-mode-default-"));
    tempDirs.push(tempRoot);
    const libraryRoot = path.join(tempRoot, "library");
    await prepareLibrary(libraryRoot);

    const { result, generatedLibraryRaw } = await writeGenerated(libraryRoot, {});
    const generated = JSON.parse(generatedLibraryRaw);

    expect(result.siteOutputMode).toBe("public");
    expect(result.strippedLocalLinks).toBe(2);
    expect(generated.recordings[0].links).toHaveLength(1);
    expect(generated.recordings[0].links[0].linkType).toBe("external");
  });
});
