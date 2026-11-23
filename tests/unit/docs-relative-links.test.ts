import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(".");
const docsRoot = path.join(repoRoot, "docs");

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(target)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(target);
    }
  }
  return files;
}

function stripFencedCodeBlocks(markdown: string) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

describe("release/docs relative links (W7a/W9a)", () => {
  it("every relative markdown link inside docs and README resolves to an existing file", async () => {
    const files = [...(await collectMarkdownFiles(docsRoot)), path.join(repoRoot, "README.md")];
    const missing: string[] = [];

    for (const filePath of files) {
      const content = stripFencedCodeBlocks(await fs.readFile(filePath, "utf8"));
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const rawTarget = match[1].trim();
        if (!rawTarget || rawTarget.startsWith("#") || rawTarget.startsWith("mailto:")) {
          continue;
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawTarget) || rawTarget.startsWith("//")) {
          continue;
        }
        const targetWithoutAnchor = rawTarget.split("#")[0];
        if (!targetWithoutAnchor) {
          continue;
        }
        const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(targetWithoutAnchor));
        if (!(await fs.stat(resolved).catch(() => null))) {
          missing.push(`${path.relative(repoRoot, filePath)} -> ${rawTarget}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
