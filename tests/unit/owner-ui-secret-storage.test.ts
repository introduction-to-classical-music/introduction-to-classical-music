import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("owner UI never persists the LLM API key (C-F07 / release S2)", () => {
  it("keeps the api key in memory and clears legacy localStorage values", async () => {
    const appJs = await readFile(path.resolve("apps/owner/web/app.js"), "utf8");
    expect(appJs).not.toMatch(/localStorage\.setItem\(\s*["']owner\.llm\.apiKey/);
    expect(appJs).not.toMatch(/localStorage\.getItem\(\s*["']owner\.llm\.apiKey/);
    expect(appJs).toContain('localStorage.removeItem(legacyLlmApiKeyStorageKey)');
    expect(appJs).toContain("let llmApiKeyDraft");
    expect(appJs).toMatch(/const readStoredLlmApiKey = \(\) => llmApiKeyDraft/);
  });
});
