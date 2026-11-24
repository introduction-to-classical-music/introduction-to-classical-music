import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const SOURCE_RELATIVE_PATHS = [
  "library.manifest.json",
  "content",
  "assets",
];

export const REQUIRED_JSON_PATHS = [
  "content/library/composers.json",
  "content/library/people.json",
  "content/library/work-groups.json",
  "content/library/works.json",
  "content/library/recordings.json",
  "content/library/entity-vitals-review.json",
  "content/library/review-queue.json",
  "content/library/person-links.json",
  "content/site/config.json",
  "content/site/articles.json",
];

export const GENERATED_RELATIVE_PATHS = ["build", "runtime", "exports"];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
]);

// W10a: digests of text content are computed after deterministic EOL
// normalization so a CRLF working tree and an LF checkout/CI of the same
// content produce the same digest. Binary files are hashed byte-for-byte.
const TEXT_DIGEST_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ".csv",
  ".mjs",
  ".svg",
  ".tsv",
  ".xml",
]);

/** Normalize line endings for deterministic text digests (CRLF/CR -> LF). */
export function normalizeTextEol(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isTextDigestPath(relativePath) {
  return TEXT_DIGEST_EXTENSIONS.has(path.extname(String(relativePath ?? "")).toLowerCase());
}

function sha256Bytes(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

async function exists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootDir, relativeDir = "") {
  const absoluteDir = path.join(rootDir, relativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const absolutePath = path.join(rootDir, relativePath);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, relativePath)));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: normalizeRelativePath(relativePath),
      });
    }
  }
  return files;
}

async function sha256File(filePath, relativePath = filePath) {
  const content = await readFile(filePath);
  if (isTextDigestPath(relativePath)) {
    return sha256Bytes(Buffer.from(normalizeTextEol(content.toString("utf8")), "utf8"));
  }
  return sha256Bytes(content);
}

export async function hashDirectory(rootDir, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const excluded = new Set(options.exclude || []);
  const includePrefixes = options.includePrefixes || null;
  const files = (await collectFiles(resolvedRoot))
    .filter((file) => !excluded.has(file.relativePath))
    .filter((file) => !includePrefixes || includePrefixes.some((prefix) => file.relativePath === prefix || file.relativePath.startsWith(`${prefix}/`)))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const entries = [];
  for (const file of files) {
    entries.push({ path: file.relativePath, sha256: await sha256File(file.absolutePath, file.relativePath) });
  }
  const digest = createHash("sha256")
    .update(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""))
    .digest("hex");
  return { digest, files: entries };
}

async function readJson(rootDir, relativePath, errors) {
  const filePath = path.join(rootDir, relativePath);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push({
      code: "invalid-json-or-missing",
      path: relativePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function countValue(value) {
  return Array.isArray(value) ? value.length : null;
}

const FORBIDDEN_TEXT_CHECKS = [
  ["test-link", /guide-test-3|testtesttest/i],
  ["local-host", /localhost|127\.0\.0\.1/i],
  // F15: absolute Windows paths (backslash or forward slash) are a leak in
  // public output, but schema-valid local resource links (`localPath`) are a
  // supported feature and are stripped by public exports instead of rejected.
  // The lookbehind avoids matching URL schemes such as `https://` ("s:/").
  ["absolute-windows-path", /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/],
];

// Keep in sync with packages/data-core/src/library-state-files.ts.
const LIBRARY_COMMIT_FILE_NAME = ".library-commit.json";

export function isLibraryInternalStateEntry(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "runtime" && segments[index + 1] === "state") {
      return true;
    }
  }
  const basename = segments[segments.length - 1];
  return basename === LIBRARY_COMMIT_FILE_NAME || /^\..+\.tmp$/.test(basename);
}

/** Keys whose string values are schema-valid local resource paths (allowed). */
const LOCAL_RESOURCE_KEYS = new Set(["localPath", "path"]);

function inspectStringValue(value, relativePath, findings) {
  for (const [code, pattern] of FORBIDDEN_TEXT_CHECKS) {
    if (pattern.test(value)) {
      findings.push({ code, path: relativePath });
    }
  }
}

function inspectJsonValue(value, location, findings, counters) {
  if (typeof value === "string") {
    inspectStringValue(value, location, findings);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectJsonValue(item, `${location}[${index}]`, findings, counters));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (LOCAL_RESOURCE_KEYS.has(key)) {
      if (typeof child === "string" && child.trim()) {
        counters.localResourceLinks += 1;
      }
      // Allowed: public exports strip local links and assert the emitted files
      // contain no local paths (see scripts/export-site-release.mjs).
      continue;
    }
    inspectJsonValue(child, childLocation, findings, counters);
  }
}

function inspectForbiddenText(relativePath, text, findings, counters) {
  if (relativePath.toLowerCase().endsWith(".json")) {
    try {
      inspectJsonValue(JSON.parse(text), relativePath, findings, counters);
      return;
    } catch {
      // Invalid JSON is already reported by readJson(); fall back to raw checks.
    }
  }
  inspectStringValue(text, relativePath, findings);
}

export async function auditLibraryRoot(rootDir, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const mode = options.mode || "source";
  const errors = [];
  const warnings = [];
  const findings = [];
  const counts = {};
  const counters = { localResourceLinks: 0 };

  if (!(await exists(resolvedRoot))) {
    errors.push({ code: "root-missing", path: resolvedRoot });
    return {
      ok: false,
      rootDir: resolvedRoot,
      mode,
      errors,
      warnings,
      findings,
      counts: {
        ...counts,
        localResourceLinks: counters.localResourceLinks,
      },
      sourceDigest: "",
      sourceFiles: [],
    };
  }

  const manifest = await readJson(resolvedRoot, "library.manifest.json", errors);
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    if (manifest.schemaVersion !== "library-bundle-v1") {
      errors.push({ code: "unsupported-schema", path: "library.manifest.json", value: manifest.schemaVersion });
    }
    if (!String(manifest.libraryId || "").trim()) {
      errors.push({ code: "library-id-missing", path: "library.manifest.json" });
    }
  }

  for (const relativePath of REQUIRED_JSON_PATHS) {
    const value = await readJson(resolvedRoot, relativePath, errors);
    if (relativePath.endsWith("person-links.json")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push({ code: "person-links-shape", path: relativePath });
      }
    } else if (relativePath.endsWith("config.json")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push({ code: "site-config-shape", path: relativePath });
      }
    } else if (relativePath.endsWith("articles.json")) {
      const count = countValue(value);
      if (count === null) {
        errors.push({ code: "articles-shape", path: relativePath });
      } else {
        counts.articles = count;
      }
    } else {
      const count = countValue(value);
      if (count === null) {
        errors.push({ code: "entity-array-shape", path: relativePath });
      } else {
        const name = path.basename(relativePath, ".json");
        counts[name] = count;
      }
    }
  }

  for (const generatedPath of GENERATED_RELATIVE_PATHS) {
    if (await exists(path.join(resolvedRoot, generatedPath))) {
      if (mode === "source") {
        errors.push({ code: "generated-path-present", path: generatedPath });
      } else {
        warnings.push({ code: "generated-path-present", path: generatedPath });
      }
    }
  }

  const sourceTree = await hashDirectory(resolvedRoot, {
    includePrefixes: ["library.manifest.json", "content", "assets"],
  });
  const sourceFiles = sourceTree.files;

  for (const entry of sourceFiles) {
    if (isLibraryInternalStateEntry(entry.path)) {
      // Stale crash-recovery bookkeeping from an older build; it must not be
      // committed to the library source. Loading the library migrates it.
      findings.push({ code: "internal-state-file", path: entry.path });
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.path).toLowerCase())) {
      continue;
    }
    try {
      const text = await readFile(path.join(resolvedRoot, entry.path), "utf8");
      inspectForbiddenText(entry.path, text, findings, counters);
    } catch (error) {
      errors.push({ code: "source-read-failed", path: entry.path, message: error instanceof Error ? error.message : String(error) });
    }
    if (/\/test(?:test)?\//i.test(entry.path) || /(^|\/)test[^/]*\.(?:png|jpe?g|jfif|webp)$/i.test(entry.path)) {
      findings.push({ code: "test-asset-path", path: entry.path });
    }
  }

  if (findings.length > 0) {
    errors.push({ code: "forbidden-content", findings });
  }

  return {
    ok: errors.length === 0,
    rootDir: resolvedRoot,
    mode,
    manifest,
    counts: {
      ...counts,
      localResourceLinks: counters.localResourceLinks,
    },
    errors,
    warnings,
    findings,
    sourceDigest: sourceTree.digest,
    sourceFiles,
  };
}

export function parseCliArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 2) {
      args[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }
    const key = token.slice(2);
    if (key === "apply" || key === "json" || key === "publish") {
      args[key] = true;
      continue;
    }
    args[key] = argv[index + 1] || "";
    index += 1;
  }
  return args;
}

export function normalizeSiteBase(value = "/") {
  const trimmed = String(value || "/").trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}
