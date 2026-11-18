// Generate SBOM.md / THIRD_PARTY_NOTICES.md from package-lock production deps.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set([
  "0BSD","Apache-2.0","BSD-2-Clause","BSD-3-Clause","BlueOak-1.0.0","CC0-1.0","CC-BY-4.0","ISC","MIT","MIT-0",
  "Python-2.0","PSF-2.0","Unlicense","Zlib","MPL-2.0","(MIT OR CC0-1.0)","(Apache-2.0 OR MIT)","(BSD-2-Clause OR MIT OR Apache-2.0)",
]);
const lock = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
const root = lock.packages || {};
const packages = [];
for (const [key, meta] of Object.entries(root)) {
  if (!key || !meta || meta.dev || meta.optional) continue;
  const name = meta.name || key.replace(/^.*node_modules\//, "");
  packages.push({ name, version: meta.version || "", license: meta.license || "UNKNOWN", resolved: meta.resolved || "" });
}
packages.sort((a, b) => a.name.localeCompare(b.name));
const invalid = packages.filter((pkg) => !ALLOWED.has(pkg.license));
const generatedAt = new Date().toISOString();
const sbom = [
  "# SBOM（生产依赖）",
  "",
  `- 生成时间：${generatedAt}`,
  `- 生成方式：读取 package-lock.json（排除 dev/optional），并校验许可证 allowlist`,
  `- 生产依赖数：${packages.length}`,
  "",
  "| 包 | 版本 | 许可证 |",
  "|---|---|---|",
  ...packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} |`),
  "",
].join("\n");
const notices = [
  "# 第三方软件声明",
  "",
  `本文件由 \`node scripts/generate-sbom.mjs\` 生成（${generatedAt}），列出生产依赖及其许可证。`,
  "许可证 allowlist：0BSD、Apache-2.0、BSD-2/3-Clause、CC0/CC-BY、ISC、MIT、Unlicense、Zlib、MPL-2.0 等。",
  "",
  "| 包 | 版本 | 许可证 | 仓库/来源 |",
  "|---|---|---|---|",
  ...packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${pkg.resolved || "-"} |`),
  "",
].join("\n");
await writeFile(path.join(repoRoot, "SBOM.md"), `${sbom}\n`, "utf8");
await writeFile(path.join(repoRoot, "THIRD_PARTY_NOTICES.md"), `${notices}\n`, "utf8");
if (invalid.length > 0) {
  console.error("License allowlist violations:", invalid.map((pkg) => `${pkg.name}@${pkg.version}:${pkg.license}`).join(", "));
  process.exitCode = 1;
} else {
  console.log(`SBOM OK: ${packages.length} production packages, licenses allowlisted`);
}
void execFileSync;
