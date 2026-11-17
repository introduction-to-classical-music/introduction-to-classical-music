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
    expect(seedScript).toContain('siteOutputMode: "public"');
    expect(releaseScript).toContain('buildSource: "export"');
    expect(releaseScript).toContain('siteOutputMode: "public"');
    expect(releaseScript).toContain("auditSiteOutputForLocalPaths");
    expect(config).toContain('const defaultSiteBase = "/introduction-to-classical-music-sites/";');
  });

  it("uses public export mode / local mode consistently across call sites", async () => {
    const ownerServer = await fs.readFile(path.resolve("apps/owner/server/owner-app.ts"), "utf8");
    const desktopMain = await fs.readFile(path.resolve("apps/desktop/main.ts"), "utf8");
    const directoryBrowser = await fs.readFile(path.resolve("apps/site/src/components/DirectoryBrowser.astro"), "utf8");
    const emphasisModule = await fs.readFile(path.resolve("apps/site/src/lib/directory-emphasis.ts"), "utf8");

    // Owner: local build keeps local links; export-site is public and audits output.
    expect(ownerServer).toMatch(/app\.post\("\/api\/library\/build-site"[\s\S]{0,400}siteOutputMode: "local"/);
    expect(ownerServer).toMatch(/app\.post\("\/api\/library\/export-site"[\s\S]{0,900}siteOutputMode: "public"/);
    expect(ownerServer).toContain("auditSiteOutputForLocalPaths");
    expect(ownerServer).toContain("strippedLocalLinks");

    // Desktop local site build keeps local links.
    expect(desktopMain).toContain('buildActiveLibrarySite({ siteOutputMode: "local", buildSource: "local" })');

    // F06: directory name emphasis escapes before inserting <strong>.
    expect(directoryBrowser).toContain("emphasizeHtml");
    expect(directoryBrowser).not.toContain("value.replace(highlight");
    expect(emphasisModule).toContain("escapeHtmlText");
    expect(emphasisModule).toContain("HTML_ESCAPE_MAP");
  });
});
