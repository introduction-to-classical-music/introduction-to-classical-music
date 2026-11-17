import { describe, expect, it } from "vitest";

import {
  auditResourceLinks,
  countLocalOnlyResourceLinks,
  filterRenderableResourceLinks,
  getPlatformBadgeLabel,
  getResourceLinkPresentation,
  normalizeResourceLink,
  resolveIncludeLocalOnlyLinks,
  resolveSiteOutputMode,
  sanitizeResourceLinksForSiteOutput,
} from "@/lib/resource-links";

describe("resource links", () => {
  it("normalizes platform labels for button rendering", () => {
    expect(getPlatformBadgeLabel("bilibili")).toBe("bilibili");
    expect(getPlatformBadgeLabel("youtube")).toBe("YouTube");
    expect(getPlatformBadgeLabel("apple-music")).toBe("Apple Music");
    expect(getPlatformBadgeLabel("other")).toBe("其他资源");
  });

  it("presents only clickable platform buttons while preserving titles as metadata", () => {
    const normalized = normalizeResourceLink({
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=SayJA16R0ZQ",
      localPath: "",
      title: "Appassionata, 1st Movement, performed by Solomon Cutner",
      linkType: "external",
      visibility: "public",
    });

    const presentation = getResourceLinkPresentation(normalized);
    expect(presentation.label).toBe("YouTube");
    expect(presentation.href).toBe("https://www.youtube.com/watch?v=SayJA16R0ZQ");
    expect(presentation.metadataTitle).toBe("Appassionata, 1st Movement, performed by Solomon Cutner");
  });

  it("flags mismatched or invalid external links for review", () => {
    const audit = auditResourceLinks([
      {
        platform: "youtube",
        url: "https://www.bilibili.com/video/BV1Qd4y1B7N9",
        localPath: "",
        title: "wrong",
        linkType: "external",
        visibility: "public",
      },
      {
        platform: "bilibili",
        url: "Appassionata, 1st Movement",
        localPath: "",
        title: "broken",
        linkType: "external",
        visibility: "public",
      },
    ]);

    expect(audit).toHaveLength(2);
    expect(audit[0]?.code).toBe("platform-mismatch");
    expect(audit[1]?.code).toBe("invalid-url");
  });

  it("normalizes local resource links and builds same-origin open urls", () => {
    const normalized = normalizeResourceLink({
      platform: "local",
      url: "",
      localPath: "D:\\Music\\Bruckner\\Symphony7.flac",
      title: "Bruckner 7",
      linkType: "local",
      visibility: "public",
    });

    const presentation = getResourceLinkPresentation(normalized);
    expect(presentation.label).toBe("本地文件");
    expect(presentation.linkType).toBe("local");
    expect(presentation.visibility).toBe("public");
    expect(presentation.href).toContain("/__local-resource?path=");
    expect(decodeURIComponent(presentation.href.split("path=")[1] || "")).toBe("D:\\Music\\Bruckner\\Symphony7.flac");
  });

  it("can filter local-only links out of public site output", () => {
    const filtered = sanitizeResourceLinksForSiteOutput(
      [
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
          localPath: "D:\\Music\\Private.flac",
          title: "Private",
          linkType: "local",
          visibility: "local-only",
        },
      ],
      { includeLocalOnly: false },
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.url).toBe("https://www.youtube.com/watch?v=abc");
  });

  it("strips local links by default because public is the safe default", () => {
    const links = [
      {
        platform: "youtube",
        url: "https://www.youtube.com/watch?v=abc",
        localPath: "",
        title: "Public",
        linkType: "external" as const,
        visibility: "public" as const,
      },
      {
        platform: "local",
        url: "",
        localPath: "D:\\Music\\Private.flac",
        title: "Private",
        linkType: "local" as const,
        visibility: "local-only" as const,
      },
    ];

    expect(sanitizeResourceLinksForSiteOutput(links)).toHaveLength(1);
    expect(sanitizeResourceLinksForSiteOutput(links, { siteOutputMode: "local" })).toHaveLength(2);
    expect(countLocalOnlyResourceLinks(links)).toBe(1);
  });

  it("resolves output modes and include flags with a public safe default", () => {
    expect(resolveSiteOutputMode()).toBe("public");
    expect(resolveSiteOutputMode({ includeLocalOnlyLinks: true })).toBe("local");
    expect(resolveSiteOutputMode({ siteOutputMode: "local" })).toBe("local");
    expect(resolveSiteOutputMode({ siteOutputMode: "public", includeLocalOnlyLinks: true })).toBe("public");
    expect(resolveIncludeLocalOnlyLinks()).toBe(false);
    expect(resolveIncludeLocalOnlyLinks({ siteOutputMode: "local" })).toBe(true);
    expect(resolveIncludeLocalOnlyLinks({ siteOutputMode: "public" })).toBe(false);
    expect(resolveIncludeLocalOnlyLinks({ includeLocalOnly: true })).toBe(true);
  });

  it("keeps local links renderable for local site builds", () => {
    const renderable = filterRenderableResourceLinks([
      {
        platform: "local",
        url: "",
        localPath: "D:\\Music\\Mahler.mp3",
        title: "",
        linkType: "local",
        visibility: "local-only",
      },
    ]);

    expect(renderable).toHaveLength(1);
    expect(renderable[0]?.linkType).toBe("local");
    // Rendering stays permissive for the local build, but an explicit public
    // mode never renders a local link (public data is stripped upstream).
    expect(
      filterRenderableResourceLinks(
        [
          {
            platform: "local",
            url: "",
            localPath: "D:\\Music\\Mahler.mp3",
            title: "",
            linkType: "local",
            visibility: "local-only",
          },
        ],
        { siteOutputMode: "public" },
      ),
    ).toHaveLength(0);
  });
});
