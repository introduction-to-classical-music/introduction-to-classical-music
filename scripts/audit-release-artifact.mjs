// Release artifact audit gate (task-40): dependency allowlist + artifact privacy/version checks.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const allowlistPath = path.join(repoRoot, "security", "audit-exceptions.json");
const failures = [];
const warnings = [];
const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
const allowById = new Map((allowlist.entries || []).map((entry) => [entry.id, entry]));

function runAudit() {
  try {
    const raw = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--omit=dev", "--json"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    return JSON.parse(raw);
  } catch (error) {
    const raw = error?.stdout ? String(error.stdout) : "";
    if (!raw.trim()) throw new Error(`npm audit produced no JSON: ${error instanceof Error ? error.message : String(error)}`);
    return JSON.parse(raw);
  }
}

const audit = runAudit();
if (!audit || !audit.metadata || !audit.vulnerabilities) {
  console.error("[audit:release] npm audit JSON missing metadata/vulnerabilities");
  process.exit(2);
}
const highIds = new Set();
for (const entry of Object.values(audit.vulnerabilities || {})) {
  const severity = String(entry.severity || "");
  if (!["high", "critical"].includes(severity)) continue;
  for (const via of entry.via || []) {
    if (typeof via === "object" && via.url) highIds.add(via.url.split("/").pop());
  }
}
console.log(`[audit:release] dependency high/critical advisories: ${highIds.size}`);
for (const id of [...highIds].sort()) {
  const allowed = allowById.get(id);
  if (allowed) console.log(`  ALLOWED ${id} (${allowed.package}) — ${allowed.reason}`);
  else failures.push(`dependency advisory not allowlisted: ${id}`);
}
if (!existsSync(allowlistPath)) failures.push("missing security/audit-exceptions.json");

const releasesDir = path.join(repoRoot, "output", "releases");
const portableDirs = [
  path.join(repoRoot, "tools", "recording-retrieval-service", "app", "dist", "portable"),
  path.join(releasesDir, "win-unpacked", "resources", "recording-retrieval-service"),
];
const forbiddenPath = /(?:^|[\\/])(?:tests?|docs?|coverage|\.cache)(?:[\\/]|$)|\.map$|\.d\.ts$/;
const piiPatterns = [/\b[A-Za-z]:[\\/](?:Users|personal|Workspace)[\\/]/i, /\/Users\/[^/\s]+/, /HIT-IVAFFR/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /QQ\s*[:：]?\s*\d{5,}/i];
const secretPatterns = [/sk-[A-Za-z0-9]{16,}/, /apiKey"\s*:\s*"[A-Za-z0-9_-]{8,}/];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function scanTextFile(file, label) {
  if (!/\.(?:json|js|mjs|cjs|yml|yaml|txt|md|html|cmd)$/i.test(file)) return;
  const text = await readFile(file, "utf8");
  for (const pattern of piiPatterns) if (pattern.test(text)) failures.push(`${label}: PII/absolute-path pattern ${pattern}`);
  for (const pattern of secretPatterns) if (pattern.test(text)) failures.push(`${label}: secret pattern ${pattern}`);
}

const rrsDir = portableDirs.find((dir) => existsSync(dir));
if (rrsDir) {
  const buildInfo = path.join(rrsDir, "build-info.json");
  if (existsSync(buildInfo)) {
    const info = JSON.parse(await readFile(buildInfo, "utf8"));
    if (info.bundle?.path) failures.push("RRS build-info still contains bundle.path");
    if (!info.git?.commit) failures.push("RRS build-info missing git commit");
    await scanTextFile(buildInfo, "rrs build-info");
  }
  for (const file of await walk(rrsDir)) {
    const rel = path.relative(rrsDir, file);
    if (forbiddenPath.test(rel) && !rel.split(path.sep).join("/").includes("_internal/playwright/driver/")) failures.push(`RRS bundle contains non-runtime file: ${rel}`);
  }
} else {
  warnings.push("RRS portable/win-unpacked not found; artifact scan skipped");
}

const installerFiles = existsSync(releasesDir)
  ? (await readdir(releasesDir)).filter((name) => /setup-[\d.]+\.exe$/i.test(name) || name.endsWith(".exe"))
  : [];
for (const name of installerFiles) {
  const full = path.join(releasesDir, name);
  const size = (await stat(full)).size;
  console.log(`[audit:release] installer candidate: ${name} (${size} bytes)`);
}
const latestYml = path.join(releasesDir, "latest.yml");
if (existsSync(latestYml)) {
  const latest = await readFile(latestYml, "utf8");
  const version = (latest.match(/^version:\s*(\S+)/m) || [])[1];
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  if (version !== pkg.version) failures.push(`latest.yml version ${version} != package.json ${pkg.version}`);
  if (!/url:\s*buquanshu-setup-\$\{?version\}?|url:\s*buquanshu-setup-0\.1\.2\.exe/.test(latest)) {
    warnings.push("latest.yml artifact url may not match ASCII artifactName (verify after build)");
  }
} else {
  warnings.push("output/releases/latest.yml not found (build artifacts not produced yet)");
}

const requireSigned = args.has("--require-signed");
if (installerFiles.length > 0 && process.platform === "win32") {
  const script = path.join(repoRoot, "scripts", "verify-release-signing.ps1");
  const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-InstallerPath", path.join(releasesDir, installerFiles[0])].concat(requireSigned ? ["-RequireSigned"] : []), { encoding: "utf8" });
  console.log(result.trim());
}

for (const warning of warnings) console.warn(`[audit:release] WARN ${warning}`);
if (failures.length) {
  console.error("[audit:release] FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("[audit:release] PASS (allowlisted advisories printed above)");
}
