# Windows 长路径说明（W9b / D7-C）

本仓库与配套仓库在 Windows 上大量使用中文文件名和较深目录（官方库资产、站点导出、RRS eval-sets）。当绝对路径接近或超过经典 Windows `MAX_PATH`（260 字符）时，`git status`、`checkout`、`add`、备份/恢复脚本以及部分第三方工具可能失败。本文记录当前策略、校验方法和已知超长路径。

## 1. 当前配置（2026-11-17）

已在本地仓库级设置 `git config core.longpaths true`（不改全局配置）：

| 仓库 | 配置来源 | 当前值 |
|---|---|---|
| 软件仓库（本仓库） | 仓库本地配置 | `true` |
| 官方库 `repositories/library/Salon_library` | 仓库本地配置 | `true` |
| 站点仓库 `repositories/site-deploy/introduction-to-classical-music-site-deploy` | 仓库本地配置 | `true` |
| 内嵌 RRS 仓库 `tools/recording-retrieval-service/app` | 仓库本地配置 | `true` |

检查命令（在各仓库根目录运行）：

```powershell
git config --local --get core.longpaths
```

- 官方库保持私有、只读发布边界（见 [data-publication-boundary.md](release/data-publication-boundary.md)），不要为了缩短路径而重命名资产；资产改名留到内容更新窗口（D7-C），且必须同步更新引用与导出审计。
- Windows 10/11 建议同时确认系统策略 `LongPathsEnabled=1`（本机已由项目所有者配置；该设置影响原生程序而不仅是 Git）。
- 克隆工作区时不要把仓库放在过深的目录下：绝对路径 = 工作区前缀 + 仓库相对路径。当前官方库最长 tracked 路径 229 字符，若工作区前缀再增加约 30 字符就会逼近 260。

## 2. 路径长度阈值与校验脚本

`scripts/check-long-paths.mjs` 扫描一个或多个 git 仓库的 **tracked** 文件，报告绝对/相对路径长度：

```powershell
# 当前仓库（失败阈值 260，警告阈值 240）
npm run check:long-paths

# 显式扫描多个仓库（--repo 可重复）
node scripts/check-long-paths.mjs --repo . --repo ../../library/Salon_library

# 只报告不失败（适合站点产物/官方库等已知长路径场景）
node scripts/check-long-paths.mjs --repo ../../site-deploy/introduction-to-classical-music-site-deploy --warn-only

# 机器可读输出 / 自定义阈值 / 报告条数
node scripts/check-long-paths.mjs --json --threshold 240 --limit 260 --max-report 20

# 工作区常用组合（警告模式，覆盖软件库/官方库/站点库/RRS）
npm run check:long-paths:workspace
```

退出码约定：

- 任一仓库存在 `>= --limit`（默认 260）的 tracked 路径且未给 `--warn-only` → exit 1；
- `>= --threshold`（默认 240）只警告，不影响退出码；
- 非 git 仓库/git 不可用 → exit 1（避免误报干净）；
- `--warn-only` 仅把“超限”降级为警告，git/配置错误仍然失败。

## 3. 2026-11-17 运行结果

| 仓库 | tracked | 最长绝对路径 | ≥240 | ≥260 | core.longpaths | 结果 |
|---|---:|---:|---:|---:|---|---|
| 软件仓库 | 481 | 233（`tools/recording-retrieval-service/app/docs/eval-sets/...`） | 0 | 0 | true | PASS |
| 官方库 `Salon_library` | 113 | 229（`assets/managed/people/...` 长英文资产名） | 0 | 0 | true | PASS |
| 站点仓库 | 1157 | 284（`site/current/library-assets/managed/people/...`） | 23 | 6 | true | FAIL（预期；产物目录名继承官方库资产名，可用 `--warn-only`） |
| 内嵌 RRS | 92 | 233（`docs/eval-sets/...`） | 0 | 0 | true | PASS |

说明：

- 官方库自身最长为 229（< 260），但站点仓库把同一资产放在 `site/current/...`、`site/v0.1.0/...` 下后绝对路径达到 284；这是站点产物目录结构的固有结果，不是路径配置缺陷。发布/导出机器保持 `core.longpaths=true` 并避免极深工作区前缀即可。
- 软件仓库/RRS 的长路径集中在 `docs/eval-sets/` 的英文描述性文件名（保留原名便于审计追溯），当前仍低于阈值。
- 后续若在更深的 clone 路径（例如多层 CI workspace）上运行，建议在 CI/本地先执行 `npm run check:long-paths`（warn 模式可用于站点产物）。

## 4. 已知限制

- `core.longpaths` 只影响 Git 自身；Node/Python/第三方工具、备份工具、部分压缩/解压工具对 260+ 路径的支持取决于其实现和系统策略。
- Git for Windows 在 `core.longpaths=false` 时对 >260 的路径会直接报错；本仓库群已统一设为 true，但新克隆需要重新设置（建议在 `bootstrap:windows` 后执行一次）。
- 重命名现有资产可能破坏历史导出/引用兼容性；本轮（D7-C）只做配置 + 文档 + 校验，不改名。
- 本脚本只检查 tracked 文件；`output/`、`node_modules/`、`.venv/` 等生成目录不在检查范围（其路径由本地工作区决定）。
