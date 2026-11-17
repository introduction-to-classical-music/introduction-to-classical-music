import type { ResourceLink } from "../../shared/src/schema.js";

/**
 * Output mode for a built site (F15):
 * - `local`: desktop/owner local site; local resource links stay in the data so
 *   the Electron layer can open them (W3 replaces the HTTP endpoint with IPC).
 * - `public`: exported site; local/local-only links are stripped before the
 *   generated data is written, so no `/__local-resource` URL is ever produced.
 */
export type SiteOutputMode = "local" | "public";

export type ResourceLinkOutputOptions = {
  includeLocalOnly?: boolean;
  siteOutputMode?: SiteOutputMode;
};

/**
 * Resolve the explicit output mode. The safe default is `public`: callers that
 * serve the site locally must opt in to `local`.
 */
export function resolveSiteOutputMode(
  options: { includeLocalOnlyLinks?: boolean; siteOutputMode?: SiteOutputMode } = {},
): SiteOutputMode {
  if (options.siteOutputMode === "local" || options.siteOutputMode === "public") {
    return options.siteOutputMode;
  }
  return options.includeLocalOnlyLinks === true ? "local" : "public";
}

/**
 * Resolve whether local/local-only links may be rendered in this output.
 * Explicit `includeLocalOnly` wins (legacy API); otherwise the mode decides;
 * the safe default is `false` (public).
 */
export function resolveIncludeLocalOnlyLinks(options: ResourceLinkOutputOptions = {}): boolean {
  if (typeof options.includeLocalOnly === "boolean") {
    return options.includeLocalOnly;
  }
  return options.siteOutputMode === "local";
}

export type ResourceLinkAuditIssue = {
  code: "invalid-url" | "platform-mismatch" | "title-looks-like-url";
  message: string;
  link: ResourceLink;
};

const platformLabels: Record<string, string> = {
  bilibili: "bilibili",
  youtube: "YouTube",
  netease: "网易云音乐",
  "apple-music": "Apple Music",
  "amazon-music": "Amazon Music",
  local: "本地文件",
  other: "其他资源",
};

export function detectPlatformFromUrl(url: string): ResourceLink["platform"] {
  if (/bilibili\.com/i.test(url)) {
    return "bilibili";
  }
  if (/youtube\.com|youtu\.be/i.test(url)) {
    return "youtube";
  }
  if (/music\.163\.com/i.test(url)) {
    return "netease";
  }
  if (/music\.apple\.com/i.test(url)) {
    return "apple-music";
  }
  if (/amazon\.[^/]+\/music/i.test(url)) {
    return "amazon-music";
  }
  return "other";
}

export function getPlatformBadgeLabel(platform: ResourceLink["platform"]) {
  return platformLabels[platform] ?? platformLabels.other;
}

export function normalizeResourceLink(link: ResourceLink): ResourceLink {
  const linkType = link.linkType === "local" ? "local" : "external";
  const normalizedUrl = (link.url ?? "").trim();
  const normalizedLocalPath = (link.localPath ?? "").trim();
  const detectedPlatform = /^https?:\/\//i.test(normalizedUrl) ? detectPlatformFromUrl(normalizedUrl) : link.platform;

  return {
    platform: link.platform || detectedPlatform || "other",
    url: normalizedUrl,
    localPath: normalizedLocalPath,
    title: (link.title ?? "").trim(),
    linkType,
    visibility: link.visibility === "local-only" ? "local-only" : "public",
  };
}

export function auditResourceLinks(links: ResourceLink[]): ResourceLinkAuditIssue[] {
  const issues: ResourceLinkAuditIssue[] = [];

  for (const link of links.map(normalizeResourceLink)) {
    if (link.linkType === "local") {
      continue;
    }

    if (!/^https?:\/\//i.test(link.url)) {
      issues.push({
        code: "invalid-url",
        message: `Link is not a valid http/https URL: ${link.url}`,
        link,
      });
      continue;
    }

    const detectedPlatform = detectPlatformFromUrl(link.url);
    if (link.platform !== "other" && detectedPlatform !== "other" && detectedPlatform !== link.platform) {
      issues.push({
        code: "platform-mismatch",
        message: `Platform ${link.platform} does not match URL ${link.url}`,
        link,
      });
    }

    if (/^https?:\/\//i.test(link.title ?? "")) {
      issues.push({
        code: "title-looks-like-url",
        message: `Title appears to contain a URL: ${link.title}`,
        link,
      });
    }
  }

  return issues;
}

export function isLocalOnlyResourceLink(link: ResourceLink): boolean {
  const normalized = normalizeResourceLink(link);
  return normalized.linkType === "local" || normalized.visibility === "local-only";
}

/** Number of links that a public site output would strip (local/local-only). */
export function countLocalOnlyResourceLinks(links: ResourceLink[] = []): number {
  return links.filter(isLocalOnlyResourceLink).length;
}

export function isRenderableResourceLink(link: ResourceLink, options: ResourceLinkOutputOptions = {}) {
  const normalized = normalizeResourceLink(link);
  // Rendering keeps the legacy permissive default: in local builds the
  // generated data still carries local links and the components must show
  // them. Public builds strip local links before the data is written, and can
  // additionally pass `siteOutputMode: "public"` to be explicit.
  const includeLocalOnly =
    typeof options.includeLocalOnly === "boolean"
      ? options.includeLocalOnly
      : options.siteOutputMode !== "public";
  if (normalized.linkType === "local") {
    return includeLocalOnly && Boolean(normalized.localPath);
  }
  if (normalized.visibility === "local-only") {
    return includeLocalOnly && Boolean(normalized.url);
  }
  return Boolean(normalized.url);
}

export function filterRenderableResourceLinks(links: ResourceLink[], options: ResourceLinkOutputOptions = {}) {
  return links.map(normalizeResourceLink).filter((link) => isRenderableResourceLink(link, options));
}

export function sanitizeResourceLinksForSiteOutput(links: ResourceLink[], options: ResourceLinkOutputOptions = {}) {
  const includeLocalOnly = resolveIncludeLocalOnlyLinks(options);
  return links
    .map(normalizeResourceLink)
    .filter((link) => {
      if (!includeLocalOnly && (link.linkType === "local" || link.visibility === "local-only")) {
        return false;
      }
      return Boolean(link.linkType === "local" ? link.localPath : link.url);
    });
}


/**
 * Presentation for one renderable link.
 *
 * Local links keep the legacy `/__local-resource` href for local-mode builds
 * (desktop/owner local site). Public builds never reach this branch because
 * local/local-only links are stripped from the generated data first; W3 will
 * replace the HTTP endpoint with an Electron IPC bridge.
 */
export function getResourceLinkPresentation(link: ResourceLink) {
  const normalized = normalizeResourceLink(link);
  const href =
    normalized.linkType === "local"
      ? `/__local-resource?path=${encodeURIComponent(normalized.localPath || "")}`
      : normalized.url;

  return {
    href,
    label: getPlatformBadgeLabel(normalized.platform),
    metadataTitle: normalized.title || "",
    platform: normalized.platform,
    linkType: normalized.linkType,
    visibility: normalized.visibility,
    localPath: normalized.localPath || "",
  };
}
