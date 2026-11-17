#!/usr/bin/env node
/**
 * Secret / credential scanner (W1b / F01).
 *
 * Scans:
 *   1. every git-tracked file in the working tree, and
 *   2. every file staged in the git index (so a partially staged secret is
 *      caught even when the working tree copy is already clean).
 *
 * Output shows `file:line` plus a masked excerpt; the full secret value is
 * never printed. One or more findings make the command exit with code 1.
 *
 * Deliberate design choices:
 * - Regex rules only (no entropy heuristics): digests/hashes/URLs are common in
 *   this repository and entropy scanning would create noisy false positives.
 * - Placeholder values such as `YOUR_TOKEN` / `example` are ignored for
 *   assignment-style rules so example configs stay usable.
 * - Never add real or fake credentials to this file or to the repository; use
 *   `node scripts/audit-secrets.mjs --cwd <temp-git-repo>` for negative tests.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXCERPT_LENGTH = 240;

const PLACEHOLDER_MARKERS = [
  "your",
  "example",
  "placeholder",
  "sample",
  "dummy",
  "redacted",
  "change-me",
  "changeme",
  "replace",
  "todo",
];

/**
 * Rules are the single source of truth for both scanning modes. `valueGroup`
 * selects the secret value inside a larger match; `placeholderFilter` marks
 * rules whose values are user-typed (so placeholders can be ignored).
 */
export const SECRET_RULES = [
  {
    id: "sk-api-key",
    description: "sk- prefixed API key (DeepSeek/OpenAI style)",
    pattern: /sk-[A-Za-z0-9]{16,}/g,
  },
  {
    id: "api-key-assignment",
    description: "apiKey/api_key/secretKey-style assignment with a long quoted literal value",
    pattern:
      /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|client[_-]?secret|developer[_-]?token)\s*["'`]?\s*[:=]\s*["'`]([A-Za-z0-9_-]{16,})["'`]/gi,
    valueGroup: 1,
    placeholderFilter: true,
  },
  {
    id: "env-secret-assignment",
    description: "Environment-style API_KEY/SECRET_KEY assignment with a long literal value",
    pattern:
      /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:API[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|DEVELOPER[_-]?TOKEN)[ \t]*=[ \t]*([A-Za-z0-9_-]{16,})[ \t]*(?=\r?\n|$)/g,
    valueGroup: 1,
    placeholderFilter: true,
  },
  {
    id: "authorization-bearer",
    description: "Authorization: Bearer <long token>",
    pattern: /authorization\s*:\s*bearer\s+([A-Za-z0-9._~+/=-]{20,})/gi,
    valueGroup: 1,
  },
  {
    id: "jwt",
    description: "JWT token",
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "github-token",
    description: "GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)",
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  },
  {
    id: "github-fine-grained-pat",
    description: "GitHub fine-grained personal access token",
    pattern: /github_pat_[A-Za-z0-9_]{22,}/g,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "private-key-block",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
];

const KNOWN_PREFIXES = [
  "github_pat_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "xoxr-",
  "xoxs-",
  "AKIA",
  "ASIA",
  "sk-",
];

/** Mask a secret so it can be logged safely; the full value is never returned. */
export function maskSecret(value) {
  const text = String(value ?? "");
  if (!text) {
    return "[empty]";
  }
  const prefix = KNOWN_PREFIXES.find((candidate) => text.startsWith(candidate)) ?? "";
  return `${prefix}***[redacted len=${text.length}]`;
}

export function looksLikePlaceholder(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return true;
  }
  if (text.startsWith("<") || text.startsWith("[") || text.startsWith("${") || text.startsWith("{{")) {
    return true;
  }
  const lowered = text.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

function freshRulePattern(rule) {
  const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
  return new RegExp(rule.pattern.source, flags);
}

function redactLine(line) {
  let redacted = line;
  for (const rule of SECRET_RULES) {
    const pattern = freshRulePattern(rule);
    redacted = redacted.replace(pattern, (match, ...rest) => {
      const groups = rest.slice(0, -2);
      const value = rule.valueGroup ? groups[rule.valueGroup - 1] : match;
      if (!value) {
        return match;
      }
      if (rule.placeholderFilter && looksLikePlaceholder(value)) {
        return match;
      }
      return match.replace(value, maskSecret(value));
    });
  }
  return redacted;
}

function excerptFor(line, matchIndexInLine) {
  const redacted = redactLine(line);
  if (redacted.length <= MAX_EXCERPT_LENGTH) {
    return redacted.trim();
  }
  // Redact a window around the match so a second secret on the same line
  // cannot leak through the plain-text excerpt.
  const windowText = redactLine(line.slice(matchIndexInLine, matchIndexInLine + MAX_EXCERPT_LENGTH));
  return `…${windowText.slice(0, MAX_EXCERPT_LENGTH).trim()}`;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}

/**
 * Scan one text blob. Returns findings with masked excerpts only.
 * @param {string} text
 * @param {string} file
 */
export function scanText(text, file = "<memory>") {
  const source = String(text ?? "");
  const lines = source.split(/\r?\n/);
  const findings = [];
  const seen = new Set();
  for (const rule of SECRET_RULES) {
    const pattern = freshRulePattern(rule);
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[0] === "") {
        pattern.lastIndex += 1;
        continue;
      }
      const value = rule.valueGroup ? match[rule.valueGroup] : match[0];
      if (!value) {
        continue;
      }
      if (rule.placeholderFilter && looksLikePlaceholder(value)) {
        continue;
      }
      const valueOffsetInMatch = match[0].indexOf(value);
      const valueIndex = match.index + Math.max(0, valueOffsetInMatch);
      const line = lineNumberAt(source, valueIndex);
      const lineStart = source.lastIndexOf("\n", valueIndex - 1) + 1;
      const matchIndexInLine = valueIndex - lineStart;
      const masked = maskSecret(value);
      const dedupeKey = `${file}:${line}:${rule.id}:${masked}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      findings.push({
        file,
        line,
        rule: rule.id,
        description: rule.description,
        masked,
        excerpt: excerptFor(lines[line - 1] ?? "", matchIndexInLine),
      });
    }
  }
  return findings;
}

export function formatFinding(finding, sourceKind) {
  const sourceLabel = sourceKind ? `[${sourceKind}] ` : "";
  return `${sourceLabel}${finding.file}:${finding.line} rule=${finding.rule} value=${finding.masked}\n    ${finding.excerpt}`;
}

function isProbablyBinary(buffer) {
  return buffer.includes(0);
}

function decodeText(buffer) {
  return buffer.toString("utf8");
}

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

function assertGitRepository(cwd) {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    throw new Error(`Not a git repository: ${cwd}${stderr ? ` (${stderr})` : ""}`);
  }
}

function listWorkingTreeFiles(cwd) {
  const output = git(cwd, ["ls-files", "-z"]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function readWorkingTreeFindings(cwd, files) {
  const findings = [];
  for (const relativePath of files) {
    const absolutePath = path.join(cwd, relativePath);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue; // deleted in the working tree but still tracked
    }
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) {
      continue;
    }
    let buffer;
    try {
      buffer = readFileSync(absolutePath);
    } catch {
      continue;
    }
    if (isProbablyBinary(buffer)) {
      continue;
    }
    for (const finding of scanText(decodeText(buffer), relativePath)) {
      findings.push({ ...finding, sourceKind: "working-tree" });
    }
  }
  return findings;
}

function listIndexEntries(cwd) {
  const output = git(cwd, ["ls-files", "-s", "-z"]).toString("utf8");
  const entries = [];
  for (const chunk of output.split("\0")) {
    if (!chunk) {
      continue;
    }
    const tabIndex = chunk.indexOf("\t");
    if (tabIndex === -1) {
      continue;
    }
    const [, objectId, stage] = chunk.slice(0, tabIndex).trim().split(/\s+/);
    const relativePath = chunk.slice(tabIndex + 1);
    if (!objectId || /^0+$/.test(objectId) || stage !== "0") {
      continue;
    }
    entries.push({ path: relativePath, objectId });
  }
  return entries;
}

function readIndexBlobs(cwd, entries) {
  if (entries.length === 0) {
    return [];
  }
  const input = `${entries.map((entry) => entry.objectId).join("\n")}\n`;
  const output = git(cwd, ["cat-file", "--batch"], { input });
  const blobs = [];
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error(`Unexpected git cat-file output while reading ${entry.path}`);
    }
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    const parts = header.split(" ");
    if (parts.length < 2 || parts[1] === "missing") {
      blobs.push({ path: entry.path, buffer: null });
      continue;
    }
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Unexpected git cat-file header "${header}" for ${entry.path}`);
    }
    blobs.push({ path: entry.path, buffer: output.subarray(offset, offset + size) });
    offset += size + 1;
  }
  return blobs;
}

function readStagedFindings(cwd, entries) {
  const findings = [];
  for (const blob of readIndexBlobs(cwd, entries)) {
    if (!blob.buffer || blob.buffer.length > MAX_TEXT_FILE_BYTES || isProbablyBinary(blob.buffer)) {
      continue;
    }
    for (const finding of scanText(decodeText(blob.buffer), blob.path)) {
      findings.push({ ...finding, sourceKind: "staged" });
    }
  }
  return findings;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const unique = [];
  for (const finding of findings) {
    const key = `${finding.sourceKind}:${finding.file}:${finding.line}:${finding.rule}:${finding.masked}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}

export function scanRepository({ cwd = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(cwd);
  assertGitRepository(repositoryRoot);
  const workingTreeFiles = listWorkingTreeFiles(repositoryRoot);
  const indexEntries = listIndexEntries(repositoryRoot);
  const findings = dedupeFindings([
    ...readWorkingTreeFindings(repositoryRoot, workingTreeFiles),
    ...readStagedFindings(repositoryRoot, indexEntries),
  ]).sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
  return { repositoryRoot, scannedFiles: workingTreeFiles.length, stagedFiles: indexEntries.length, findings };
}

function parseArgs(argv) {
  const parsed = { cwd: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cwd") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cwd requires a directory argument");
      }
      parsed.cwd = path.resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/audit-secrets.mjs [--cwd <git-repository>]\n");
    return 0;
  }
  const result = scanRepository({ cwd: args.cwd });
  if (result.findings.length === 0) {
    process.stdout.write(
      `[secrets] ok: ${result.scannedFiles} tracked files / ${result.stagedFiles} staged files scanned, 0 findings\n`,
    );
    return 0;
  }
  process.stderr.write(
    `[secrets] ${result.findings.length} potential secret(s) found in ${result.repositoryRoot}\n`,
  );
  for (const finding of result.findings) {
    process.stderr.write(`${formatFinding(finding, finding.sourceKind)}\n`);
  }
  process.stderr.write(
    "[secrets] Remove the value, rotate the credential if it was real, and keep user-local config outside the repository.\n",
  );
  return 1;
}

function isInvokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[secrets] scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
