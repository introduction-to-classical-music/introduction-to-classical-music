import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("local site export", () => {
  it("supports relative base configuration for file:// inspection", async () => {
    const config = await fs.readFile(path.resolve("apps/site/astro.config.mjs"), "utf8");
    const runner = await fs.readFile(path.resolve("packages/data-core/src/site-build-runner.ts"), "utf8");
    expect(config).toContain('trimmed === "." || trimmed === "./"');
    expect(runner).toContain("rewriteRelativeSiteLinks");
  });

  it("builds the packaged seed library with a root base instead of the Pages sub-path", async () => {
    const seedScript = await fs.readFile(path.resolve("scripts/build-library-site.ts"), "utf8");
    const releaseScript = await fs.readFile(path.resolve("scripts/export-site-release.mjs"), "utf8");
    const config = await fs.readFile(path.resolve("apps/site/astro.config.mjs"), "utf8");

    // F09: the seed site is served from 127.0.0.1:4331/ and must not use the
    // GitHub Pages sub-path; the Pages base stays the export default.
    expect(seedScript).toContain('siteBase: "/"');
    expect(seedScript).toContain('buildSource: "cli"');
    expect(releaseScript).toContain('buildSource: "export"');
    expect(config).toContain('const defaultSiteBase = "/introduction-to-classical-music-sites/";');
  });
});
