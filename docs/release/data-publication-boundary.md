# 数据公开边界（W9c）

本文明确哪些数据可以进入公开仓库/公开站点，哪些必须保持私有，以及发布前如何检查。它补充 [PROJECT_BOUNDARIES.md](PROJECT_BOUNDARIES.md)（安装版/便携版/站点部署的边界）与仓库根目录 [SECURITY.md](../../SECURITY.md)（凭据与安全披露）。

## 1. 数据分级

| 类别 | 典型位置 | 公开性 | 说明 |
|---|---|---|---|
| 官方资料库（内容/资产/审查状态） | `repositories/library/Salon_library`（私有库仓库） | **私有** | 唯一权威内容源；仅允许通过导出流程生成公开站点产物，**不得**把 `content/`、`assets/`、`review-queue`、`entity-vitals-review` 等原始文件复制进公开仓库或直接上传 |
| 公开站点产物 | 站点部署仓库的 `site/`/Pages 输出 | 公开 | 只包含 public 模式导出结果（本地链接已剥离、无本机路径、无内部状态文件） |
| 默认库发布快照 | `release-default-library/v*`（空库 + 使用手册） | 公开 | 用于安装包种子与发布 provenance；不含任何真实条目 |
| 用户本地数据 | `%APPDATA%\buquanshu`（活动库、审阅状态、日志、备份） | **私有** | 属于用户本人；只在用户本机，**不得**进入仓库、不得上传、不得打包进便携包 |
| 内部自动化状态 | `data/automation/**`（batches/runs）、`review-queue.json`、`entity-vitals-review.json`、`person-links.json`、`.library-commit.json`、`runtime/`、`build/`、`exports/` | **不公开** | 审计/事务/生成态数据；导出与同步时统一过滤（W6），不得随站点或库 bundle 发布 |
| 联系/身份信息（如 QQ/邮箱/微信等） | 文档、站点配置、提交信息、Issue | **不公开**（除 SECURITY 指定的私下渠道） | 不写入公开站点、公开仓库文档或示例配置；站点 `contact` 字段在公开数据中必须为空 |
| 凭据/密钥/本机绝对路径 | 任何位置 | **永不公开** | API key、cookie、token、本机用户名/盘符路径一律不入库、不入包；发现即轮换并按 SECURITY 处理 |

## 2. 决策记录

1. **官方库保持私有**（D6-B/项目边界）：公开内容仅来自导出产物；官方库仓库本身不公开镜像。
2. **review-queue / entity-vitals-review 等内部工件不公开**：它们是审查与质量流程状态，不是内容；公开站点/发布快照/安装包均不得包含（W6 已把 `.library-commit.json` 移出内容面并在 6 条导出/同步面统一过滤）。
3. **QQ 等联系方式不公开**：不在公开页面展示；维护者联系方式仅通过 `SECURITY.md` 描述的私下渠道提供，且不在本文/示例中记录具体账号。站点配置中的 `contact.label/value` 必须为空，`public:audit` 会校验。
4. **公开产物范围**：GitHub Pages 站点、`release-default-library` 空库快照、GitHub Release 的安装版/便携版二进制、公开源码仓库中的代码与文档。根站点/正式域名、OSS/CDN 等按 D6-B 不在本轮范围。

## 3. 强制检查（发布/合并前）

| 检查 | 命令 | 期望 |
|---|---|---|
| 公开边界审计 | `npm run public:audit` | `ok: true`、`errors: []`；仓库 `data/library/*.json` 计数为 0，`person-links` 为空，站点配置无 `lastImportedAt`/`contact` |
| 密钥扫描 | `npm run audit:secrets` | `0 findings`（扫描 git 已跟踪 + 暂存区） |
| 公开导出 | 站点导出使用 public 模式（`export-site-release`、默认库构建） | manifest 记录 `siteOutputMode=public`、`strippedLocalLinks`、`sourceLocalResourceLinks=0`；产物无本机绝对路径/AppData 路径/内部状态文件 |
| 库同步/导出过滤 | `sync-library-source`、bundle/目录/zip 导出、站点产物 | 不包含 `review-queue.json`、`entity-vitals-review.json`、`.library-commit.json`、`runtime|build|exports` 等内部路径 |
| RRS 打包 | `npm run retrieval:portable:build` + `assert-portable-bundle.ps1` | 仅 5 个白名单 materials 文件；无 `LLM config.txt`/`*.local.json`/密钥 |
| 长路径/私密路径 | `npm run check:long-paths` | tracked 路径未超过阈值；`public:audit` 同时拒绝 `materials/archive`、`tools/OwnerLauncher`、`data/automation`（除 `.gitkeep`）被跟踪 |

- 公开 manifest（`site-release-manifest.json`）仅包含：`libraryId`/`libraryName`/`appVersion`/`builtAt`/`siteBase`/`siteOutputMode`/`strippedLocalLinks`/`sourceLocalResourceLinks`/`sourceDigest`/`siteDigest`；不含用户数据、密钥、本机路径或联系方式。

发布记录需附上述命令的日志或摘要；PR 使用 [.github/pull_request_template.md](../../.github/pull_request_template.md) 的公开边界检查项。

## 4. 边界被破坏时的处置

1. 停止发布/推送，保留现场证据（日志、提交 SHA、产物路径）。
2. 若涉及凭据：先轮换/作废，再按 [SECURITY.md](../../SECURITY.md) 披露流程处理；不要在 Issue/提交信息中复述密钥值。
3. 若内部数据进入公开产物：撤回/覆盖发布产物（Pages/Release），在公开仓库中删除并评估历史（D2-A：不重写历史，但需披露残余风险）。
4. 修复根因（过滤规则/导出模式/白名单/忽略规则）并补测试，避免同一路径再次泄漏。

## 5. 相关文档

- [SECURITY.md](../../SECURITY.md)：安全策略、凭据泄露处置与历史残余披露
- [PROJECT_BOUNDARIES.md](PROJECT_BOUNDARIES.md)：安装版、便携版、互联网部署的边界
- [site-release-digest.md](../site-release-digest.md)：公开站点的 digest/provenance 语义
- [windows-long-paths.md](../windows-long-paths.md)：长路径与工作区约定
- [release/README.md](README.md)：发布文档索引
