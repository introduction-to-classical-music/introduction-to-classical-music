import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Post-build guard for public site exports (F15).
 *
 * Public output must not contain local-resource endpoints (`/__local-resource`)
 * or absolute Windows paths that leak the maintainer's local filesystem. The
 * build strips those links before writing generated data; this audit verifies
 * the actual emitted files instead of trusting the transformation.
 */
export type SiteOutputAuditHit = {
  path: string;
  line: number;
  pattern: "local-resource-url" | "absolute-windows-path";
  excerpt: string;
};

export type SiteOutputAudit = {
  ok: boolean;
  rootDir: string;
  checkedFiles: number;
  localResourceUrls: SiteOutputAuditHit[];
  absolutePathHits: SiteOutputAuditHit[];
};

const TEXT_OUTPUT_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".xml", ".svg"]);

const LOCAL_RESOURCE_PATTERN = /__local-resource/;
// A drive-letter path must not be preceded by another letter/number, otherwise
// URL schemes such as `https://` would match (`s:/`). `file:///C:/...` still
// matches because `C` follows a slash.
const ABSOLUTE_WINDOWS_PATH_PATTERN = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/;

async function collectTextOutputFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextOutputFiles(target)));
    } else if (entry.isFile() && TEXT_OUTPUT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(target);
    }
  }
  return files;
}

function excerptLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

export async function auditSiteOutputForLocalPaths(outputDir: string): Promise<SiteOutputAudit> {
  const rootDir = path.resolve(outputDir);
  const audit: SiteOutputAudit = {
    ok: true,
    rootDir,
    checkedFiles: 0,
    localResourceUrls: [],
    absolutePathHits: [],
  };

  let files: string[];
  try {
    files = await collectTextOutputFiles(rootDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...audit, ok: false };
    }
    throw error;
  }

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    audit.checkedFiles += 1;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (LOCAL_RESOURCE_PATTERN.test(line)) {
        audit.localResourceUrls.push({ path: relativePath, line: index + 1, pattern: "local-resource-url", excerpt: excerptLine(line) });
      }
      if (ABSOLUTE_WINDOWS_PATH_PATTERN.test(line)) {
        audit.absolutePathHits.push({ path: relativePath, line: index + 1, pattern: "absolute-windows-path", excerpt: excerptLine(line) });
      }
    }
  }

  audit.ok = audit.localResourceUrls.length === 0 && audit.absolutePathHits.length === 0;
  return audit;
}
