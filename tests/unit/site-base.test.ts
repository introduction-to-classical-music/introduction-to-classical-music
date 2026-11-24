import { describe, expect, it } from "vitest";

import { normalizeBasePath, withBasePath } from "../../packages/shared/src/site-base.ts";

const PAGES_BASE = "/introduction-to-classical-music-sites/";

describe("site base path helpers (W10b)", () => {
  it("normalizes base paths", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath(PAGES_BASE)).toBe(PAGES_BASE);
    expect(normalizeBasePath("introduction-to-classical-music-sites")).toBe(PAGES_BASE);
    expect(normalizeBasePath("/docs")).toBe("/docs/");
  });

  it("keeps root-absolute hrefs unchanged for a root build", () => {
    expect(withBasePath("/composers/", "/")).toBe("/composers/");
    expect(withBasePath("/works/work-1/", "/")).toBe("/works/work-1/");
  });

  it("prefixes internal hrefs for a Pages build", () => {
    expect(withBasePath("/composers/", PAGES_BASE)).toBe(`${PAGES_BASE}composers/`);
    expect(withBasePath("/recordings/recording-1/", PAGES_BASE)).toBe(`${PAGES_BASE}recordings/recording-1/`);
    expect(withBasePath("/", PAGES_BASE)).toBe(PAGES_BASE);
  });

  it("is idempotent for already-prefixed hrefs", () => {
    const once = withBasePath("/works/work-1/", PAGES_BASE);
    expect(withBasePath(once, PAGES_BASE)).toBe(once);
    expect(withBasePath(`${PAGES_BASE}composers/`, PAGES_BASE)).toBe(`${PAGES_BASE}composers/`);
  });

  it("leaves external, protocol-relative, hash, query and relative links untouched", () => {
    for (const value of [
      "https://www.youtube.com/watch?v=abc",
      "mailto:maintainer@example.com",
      "//cdn.example.com/asset.js",
      "#section",
      "?q=bach",
      "relative/path",
    ]) {
      expect(withBasePath(value, PAGES_BASE)).toBe(value);
    }
  });
});
