import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const rrsAppRoot = path.resolve("tools/recording-retrieval-service/app");
const specPath = path.join(rrsAppRoot, "packaging", "recording-retrieval-service.spec");
const whitelistPath = path.join(rrsAppRoot, "packaging", "materials-whitelist.json");
const buildPortablePath = path.join(rrsAppRoot, "packaging", "build-portable.ps1");

const SENSITIVE_MATERIALS_PATTERN = /llm[\s_-]*config|\.local\.json$|\.env$|secret|token|credential|password|cookie/i;

describe("recording retrieval service packaging inputs", () => {
  it("packs an explicit materials allow-list instead of the whole materials directory", async () => {
    const spec = await fs.readFile(specPath, "utf8");

    expect(spec).not.toMatch(/\(\s*str\(materials_root\)\s*,\s*["']materials["']\s*\)/);
    expect(spec).toContain("materials-whitelist.json");
    expect(spec).toContain("_SENSITIVE_MATERIALS_PATTERN");
    expect(spec).toContain("load_materials_datas()");
  });

  it("whitelists only existing, non-sensitive runtime material files", async () => {
    const whitelist = JSON.parse(await fs.readFile(whitelistPath, "utf8")) as { files: string[] };
    expect(Array.isArray(whitelist.files)).toBe(true);
    expect(whitelist.files.length).toBeGreaterThan(0);

    for (const relativePath of whitelist.files) {
      expect(relativePath.startsWith("materials/")).toBe(true);
      expect(relativePath.includes("..")).toBe(false);
      const fileName = path.posix.basename(relativePath);
      expect(fileName).not.toMatch(SENSITIVE_MATERIALS_PATTERN);
      await expect(fs.stat(path.join(rrsAppRoot, relativePath))).resolves.toBeTruthy();
    }

    // The legacy LLM config file must never be packaged again.
    for (const relativePath of whitelist.files) {
      expect(relativePath.toLowerCase()).not.toContain("llm");
    }

    // Runtime rule files consumed by app/services/source_profiles.py.
    expect(whitelist.files).toEqual(
      expect.arrayContaining([
        "materials/source-profiles/high-quality.txt",
        "materials/source-profiles/streaming.txt",
        "materials/source-profiles/orchestra-abbreviations.txt",
        "materials/source-profiles/person-name-aliases.txt",
      ]),
    );
  });

  it("verifies the built bundle against the whitelist without relying on post-build deletion", async () => {
    const buildPortable = await fs.readFile(buildPortablePath, "utf8");
    const assertPortableBundle = await fs.readFile(
      path.join(rrsAppRoot, "packaging", "assert-portable-bundle.ps1"),
      "utf8",
    );

    expect(buildPortable).toContain("assert-portable-bundle.ps1");
    expect(buildPortable).toContain("$sensitiveLegacyLlmPaths");
    expect(assertPortableBundle).toContain("materials-whitelist.json");
    expect(assertPortableBundle).toContain("expectedMaterials");
    expect(assertPortableBundle).toContain("outside the allow-list");
    expect(assertPortableBundle).toContain("secretContentPattern");
    expect(assertPortableBundle).toContain("forbiddenFilePattern");
  });
});
