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
});
