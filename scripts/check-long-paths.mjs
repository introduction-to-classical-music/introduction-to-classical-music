// Windows long-path hygiene checker (W9b / D7-C).
//
// Scans the tracked files of one or more git repositories and reports how close
// their absolute paths are to the classic Windows MAX_PATH limit. The check is
// intentionally read-only: it never renames assets (renaming is deferred to a
// content update window per D7-C).
//
// Usage:
//   node scripts/check-long-paths.mjs [--repo <path>]... [--threshold 240]
//     [--limit 260] [--warn-only] [--json] [--max-report 10]
//
// Exit code: 1 when any tracked path reaches `--limit` (260) unless
// `--warn-only` is given; warnings at `--threshold` (240) never fail.
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

function printHelp() {
  process.stdout.write(`Usage: node scripts/check-long-paths.mjs [options]\n\nOptions:\n  --repo <path>        Repository to scan (repeatable; default: current directory)\n  --threshold <n>      Warning threshold for absolute path length (default: 240)\n  --limit <n>          Failure limit for absolute path length (default: 260)\n  --warn-only          Never fail; report only\n  --json               Emit machine-readable JSON instead of text\n  --max-report <n>     Number of longest paths to print per repository (default: 10)\n  --help               Show this help\n`);
}

function parseArgs(argv) {
  const options = { repos: [], threshold: 240, limit: 260, warnOnly: false, json: false, maxReport: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repos.push(argv[(index += 1)]);
    } else if (token === "--threshold") {
      options.threshold = Number.parseInt(argv[(index += 1)], 10);
    } else if (token === "--limit") {
      options.limit = Number.parseInt(argv[(index += 1)], 10);
    } else if (token === "--warn-only") {
      options.warnOnly = true;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--max-report") {
      options.maxReport = Number.parseInt(argv[(index += 1)], 10);
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${token}\n`);
      printHelp();
      process.exit(2);
    }
  }
  if (!options.repos.length) {
    options.repos.push(process.cwd());
  }
  if (!Number.isFinite(options.threshold) || !Number.isFinite(options.limit) || !Number.isFinite(options.maxReport)) {
    process.stderr.write("--threshold/--limit/--max-report must be numbers\n");
    process.exit(2);
  }
  return options;
}

function runGit(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function scanRepo(repoArg, options) {
  const requested = path.resolve(repoArg);
  let topLevel;
  try {
    topLevel = runGit(requested, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    return {
      repo: requested,
      error: `not a git repository or git unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const repo = path.resolve(topLevel);
  const tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const entries = tracked
    .map((relativePath) => ({
      relativePath,
      relativeLength: relativePath.length,
      absoluteLength: path.resolve(repo, relativePath).length,
    }))
    .sort((left, right) => right.absoluteLength - left.absoluteLength || right.relativeLength - left.relativeLength);
  const longest = entries.slice(0, options.maxReport);
  const overThreshold = entries.filter((entry) => entry.absoluteLength >= options.threshold).length;
  const overLimit = entries.filter((entry) => entry.absoluteLength >= options.limit).length;
  let longpathsConfig = "";
  try {
    longpathsConfig = runGit(repo, ["config", "--local", "--get", "core.longpaths"]) || "";
  } catch {
    longpathsConfig = "";
  }
  return {
    repo,
    trackedFiles: entries.length,
    maxAbsoluteLength: entries[0]?.absoluteLength ?? 0,
    maxRelativeLength: entries[0]?.relativeLength ?? 0,
    overThreshold,
    overLimit,
    coreLongpaths: longpathsConfig === "true",
    longest,
  };
}

const options = parseArgs(process.argv.slice(2));
const results = options.repos.map((repoArg) => scanRepo(repoArg, options));
const failures = results.filter((result) => result.error || result.overLimit > 0);
const ok = failures.length === 0 || options.warnOnly;

if (options.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "long-path-check-v1",
        ok,
        threshold: options.threshold,
        limit: options.limit,
        warnOnly: options.warnOnly,
        repos: results,
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(`Long-path check (WIN MAX_PATH threshold=${options.threshold}, limit=${options.limit}${options.warnOnly ? ", warn-only" : ""})\n`);
  for (const result of results) {
    if (result.error) {
      process.stdout.write(`\n[${result.repo}]\n  ERROR: ${result.error}\n`);
      continue;
    }
    process.stdout.write(
      `\n[${result.repo}]\n  tracked=${result.trackedFiles} max=${result.maxAbsoluteLength} overThreshold(${options.threshold})=${result.overThreshold} overLimit(${options.limit})=${result.overLimit} core.longpaths=${result.coreLongpaths ? "true" : "(unset/false)"}\n`,
    );
    for (const entry of result.longest) {
      process.stdout.write(`  ${String(entry.absoluteLength).padStart(3)} ${entry.relativePath}\n`);
    }
  }
  const failedRepos = results.filter((result) => result.error || result.overLimit > 0);
  process.stdout.write(
    `\nRESULT: ${ok ? "PASS" : "FAIL"} (${failedRepos.length} repo(s) with errors or paths >= ${options.limit}${options.warnOnly ? "; warnings only" : ""})\n`,
  );
}

// `--warn-only` turns limit violations into warnings; git/config errors still fail
// so a broken invocation cannot masquerade as a clean result.
if (results.some((result) => result.error) || (!options.warnOnly && results.some((result) => result.overLimit > 0))) {
  process.exitCode = 1;
}
void repoRoot;
