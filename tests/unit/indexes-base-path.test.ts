import { describe, expect, it } from "vitest";

import { buildIndexes } from "../../packages/data-core/src/indexes.ts";
import { validateLibrary } from "../../packages/shared/src/schema.ts";

const PAGES_BASE = "/introduction-to-classical-music-sites/";

function buildFixtureLibrary() {
  return validateLibrary({
    composers: [
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
    ],
    people: [
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
    ],
    workGroups: [
      { id: "group-1", composerId: "composer-1", title: "交响曲", slug: "symphony", path: ["交响曲"], sortKey: "0010" },
    ],
    works: [
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
    ],
    recordings: [
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
    ],
  });
}

function collectHrefs(value: unknown, hrefs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectHrefs(item, hrefs);
    return hrefs;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "href" && typeof child === "string") {
        hrefs.push(child);
      } else {
        collectHrefs(child, hrefs);
      }
    }
  }
  return hrefs;
}

const articles = [
  {
    id: "article-1",
    slug: "guide",
    title: "导览",
    summary: "",
    markdown: "",
    showOnHome: false,
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
  },
];

describe("index href generation with deployment base (W10b)", () => {
  it("prefixes every internal href with the Pages base once", () => {
    const indexes = buildIndexes(buildFixtureLibrary(), { canonicalPersonLinks: {} }, articles, { basePath: PAGES_BASE });
    const hrefs = collectHrefs(indexes);

    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href.startsWith(PAGES_BASE), href).toBe(true);
      const remainder = href.slice(PAGES_BASE.length);
      expect(remainder.startsWith(PAGES_BASE), `double prefix: ${href}`).toBe(false);
    }
    // conductor/orchestra relationship entries (the 607-link source) are based.
    expect(hrefs.some((href) => href.startsWith(`${PAGES_BASE}works/`))).toBe(true);
    expect(hrefs.some((href) => href.startsWith(`${PAGES_BASE}recordings/`))).toBe(true);
    expect(hrefs.some((href) => href.startsWith(`${PAGES_BASE}columns/`))).toBe(true);
  });

  it("keeps root-relative hrefs for root builds", () => {
    const indexes = buildIndexes(buildFixtureLibrary(), { canonicalPersonLinks: {} }, articles, { basePath: "/" });
    const hrefs = collectHrefs(indexes);

    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href.startsWith("/"), href).toBe(true);
      expect(href.startsWith(PAGES_BASE), href).toBe(false);
    }
  });

  it("defaults to a root build when no base is provided", () => {
    const indexes = buildIndexes(buildFixtureLibrary());
    const hrefs = collectHrefs(indexes);
    expect(hrefs.every((href) => href.startsWith("/") && !href.startsWith(PAGES_BASE))).toBe(true);
  });
});
