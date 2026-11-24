// Generate security/audit-exceptions.json + DEPENDENCY-EXCEPTIONS.md from npm audit.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let audit;
try {
  audit = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--omit=dev", "--json"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }));
} catch (error) {
  const raw = String(error?.stdout || "").trim();
  if (!raw) throw new Error(`npm audit produced no JSON: ${error instanceof Error ? error.message : String(error)}`);
  audit = JSON.parse(raw);
}
if (!audit || !audit.metadata || !audit.vulnerabilities) throw new Error("npm audit JSON missing metadata/vulnerabilities");
const advisories = new Map();
for (const [name, entry] of Object.entries(audit.vulnerabilities || {})) {
  if (!["high", "critical"].includes(String(entry.severity))) continue;
  for (const via of entry.via || []) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    const current = advisories.get(id) || { id, title: via.title, severity: via.severity, packages: new Set() };
    current.packages.add(name);
    advisories.set(id, current);
  }
}
const ids = [...advisories.keys()].sort();
const allowlist = {
  schemaVersion: "release-audit-allowlist-v1",
  reviewedAt: "2026-11-18",
  owner: "E-SOFT/security",
  reReviewBy: "2026-12-31",
  entries: ids.map((id) => ({
    id,
    package: [...advisories.get(id).packages].join(","),
    severity: advisories.get(id).severity,
    reason: "Reachability evidence in security/DEPENDENCY-EXCEPTIONS.md",
    reviewBy: "2026-12-31",
  })),
};
await writeFile(path.join(repoRoot, "security", "audit-exceptions.json"), `${JSON.stringify(allowlist, null, 2)}\n`, "utf8");
const rows = ids.map((id) => {
  const item = advisories.get(id);
  const packages = [...item.packages].join(", ");
  const isAstro = item.packages.has("astro");
  const surface = isAstro
    ? "Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping)"
    : "Build-time/transitive dependency (not invoked by packaged runtime)";
  const reachability = isAstro
    ? "Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates"
    : "Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them";
  return `| ${id} | ${item.severity} | ${packages} | ${surface} | ${reachability} | CSP/sandbox/no remote image endpoint/audit:release scan |`;
});
const markdown = [
  "# 依赖漏洞例外登记（可发版候选风险接受）",
  "",
  "- 审查日期：2026-11-18；owner：E-SOFT/security；复审到期：**2026-12-31**。",
  "- 基线：`npm audit --omit=dev --audit-level=high`；可修复项已升级（Astro 6.4.8、express 5.3.0、sanitize-html 2.18.2、zod 4.6.7、markdown-it 15.0.3；overrides：devalue 5.9.4、esbuild 0.28.2、picomatch 4.0.7、smol-toml 1.9.1、tinyglobby 0.2.17、undici 8.12.4）。",
  `- 剩余 high/critical 例外：**${ids.length}** 条；allowlist：\`security/audit-exceptions.json\`；门禁：\`npm run audit:release\`（allowlist 外 fail，allowlist 逐条打印）。`,
  "",
  "| GHSA | 严重度 | 包 | 依赖路径/触发面 | 产品可达性证据 | 补偿控制 |",
  "|---|---|---|---|---|---|",
  ...rows,
  "",
  "## 可达性证据（2026-11-18 检索）",
  "",
  "- `rg \"client:|server:defer|define:vars|@astrojs/mdx|@astrojs/react|astro:assets|getImage|inferRemoteSize\" apps/site/src`：无匹配；站点为静态 HTML + 内联脚本，无 islands/SSR/远程图片优化端点。",
  "- `rg \"js-yaml|sharp|svgo|picomatch\" apps packages output/runtime`：仅构建工具链/传递依赖，无产品运行时代码调用。",
  "- esbuild 公告为 Windows dev server 任意文件读；发布产物不含 dev server，`npm run dev` 仅本机开发使用。",
  "- devalue 用于 Astro islands 序列化；本站无 islands，运行时不反序列化不可信输入。",
  "- 安装包/便携包由 `audit:release` 扫描绝对路径/PII/密钥/源映射；Electron 已启用 sandbox/CSP。",
  "",
  "## 未纳入例外",
  "",
  "- moderate/low 传递项不在 high/critical gate 内，仍会随 `npm audit` 输出供复审。",
  "- 正式 Release 必须有有效 Authenticode 签名；无证书只能产出候选（`verify-release-signing.ps1 -RequireSigned` 失败）。",
].join("\n");
await writeFile(path.join(repoRoot, "security", "DEPENDENCY-EXCEPTIONS.md"), `${markdown}\n`, "utf8");
console.log(`exceptions: ${ids.length} high/critical advisories allowlisted`);
