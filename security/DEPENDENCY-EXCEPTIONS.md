# 依赖漏洞例外登记（可发版候选风险接受）

- 审查日期：2026-11-18；owner：E-SOFT/security；复审到期：**2026-12-31**。
- 基线：`npm audit --omit=dev --audit-level=high`；可修复项已升级（Astro 6.4.8、express 5.3.0、sanitize-html 2.18.2、zod 4.6.7、markdown-it 15.0.3；overrides：devalue 5.9.4、esbuild 0.28.2、picomatch 4.0.7、smol-toml 1.9.1、tinyglobby 0.2.17、undici 8.12.4）。
- 剩余 high/critical 例外：**19** 条；allowlist：`security/audit-exceptions.json`；门禁：`npm run audit:release`（allowlist 外 fail，allowlist 逐条打印）。

| GHSA | 严重度 | 包 | 依赖路径/触发面 | 产品可达性证据 | 补偿控制 |
|---|---|---|---|---|---|
| GHSA-26w7-cxv4-gfx2 | critical | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-2883-xcg3-v3hh | high | js-yaml | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-2p49-hgcm-8545 | high | svgo | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-376h-93r7-7g6f | moderate | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-4g3v-8h47-v7g6 | moderate | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-4vpr-x523-8j87 | moderate | svgo | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-52cp-r559-cp3m | high | js-yaml | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-5p4m-2wfm-xmqj | high | js-yaml | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-7pw4-f3q4-r2p2 | low | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-98hj-9722-w3j8 | moderate | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-f48w-9m4c-m7f5 | moderate | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-f88m-g3jw-g9cj | high | sharp | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-fc5q-39xc-vjpf | high | picomatch | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-h67p-54hq-rp68 | moderate | js-yaml | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-mh32-jxcr-mh9f | low | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-r3h5-4585-7x3w | moderate | astro | Astro build/SSR APIs (server islands, define:vars, JSX/MDX, AVIF/image optimization, base-path stripping) | Static `output: static` site; no server islands/define:vars/JSX/MDX/@astrojs/* integrations/astro:assets image endpoint; site base is build-time only; user input never compiled as Astro templates | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-rgj7-g3m4-5g8c | high | sharp | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-w27v-7q3p-w38r | high | svgo | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |
| GHSA-wq5f-xc86-pv6w | high | sharp | Build-time/transitive dependency (not invoked by packaged runtime) | Only used by build tools/dev server; packaged app runs built runtime, not these tools; no user-controlled input reaches them | CSP/sandbox/no remote image endpoint/audit:release scan |

## 可达性证据（2026-11-18 检索）

- `rg "client:|server:defer|define:vars|@astrojs/mdx|@astrojs/react|astro:assets|getImage|inferRemoteSize" apps/site/src`：无匹配；站点为静态 HTML + 内联脚本，无 islands/SSR/远程图片优化端点。
- `rg "js-yaml|sharp|svgo|picomatch" apps packages output/runtime`：仅构建工具链/传递依赖，无产品运行时代码调用。
- esbuild 公告为 Windows dev server 任意文件读；发布产物不含 dev server，`npm run dev` 仅本机开发使用。
- devalue 用于 Astro islands 序列化；本站无 islands，运行时不反序列化不可信输入。
- 安装包/便携包由 `audit:release` 扫描绝对路径/PII/密钥/源映射；Electron 已启用 sandbox/CSP。

## 未纳入例外

- moderate/low 传递项不在 high/critical gate 内，仍会随 `npm audit` 输出供复审。
- 正式 Release 必须有有效 Authenticode 签名；无证书只能产出候选（`verify-release-signing.ps1 -RequireSigned` 失败）。
