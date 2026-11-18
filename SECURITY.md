# 安全策略

## 支持范围

当前仅对最新公共版本和默认分支上的安全问题进行响应。

## 报告方式

如果你发现以下问题，请不要直接公开提交带利用细节的 Issue：

- 任意代码执行
- 本地文件越权读取
- 安装器篡改或提权
- 默认端口暴露导致的未授权访问
- 凭据、密钥或用户数据泄露

请通过私下渠道联系维护者，并至少提供：

- 影响版本
- 复现步骤
- 预期结果与实际结果
- 日志、截图或最小 PoC（概念验证）

**报告疑似凭据泄露时不要附上完整密钥值**；如已公开，请先轮换/作废该凭据。

## 处理原则

- 先修复，再公开披露
- 如需发布补丁版本，遵循 `SemVer`（语义化版本）并在 `CHANGELOG.md` 中记录
- 安全修复应优先保证升级可覆盖旧版本，并尽量保留用户数据

## 凭据泄露事件处置（2026-11-17）

公开仓库历史中曾出现两条真实 LLM API 密钥（来源：内嵌 RRS 仓库的旧 `materials/source-profiles/LLM config.txt`，以及父仓库引入/删除该文件的两次历史提交）。处置记录如下，本文不记录、不复述密钥值：

- **轮换/作废（W1a）**：两条旧密钥已由项目所有者于 2026-11-17 在服务商控制台轮换/作废（所有者书面确认；不提供密钥、不截图密钥）。
- **代码止血（W1b）**：PyInstaller 打包输入改为显式白名单 `tools/recording-retrieval-service/app/packaging/materials-whitelist.json`，不再打包整个 `materials/` 目录，该旧配置文件不进入便携包；`packaging/build-portable.ps1` 在构建后校验包内材料与白名单一致、不含敏感文件与密钥模式（失败即中止构建）。
- **提交门禁（W1b）**：新增 `npm run audit:secrets`，扫描 git 已跟踪文件与暂存区内容，命中即以非零退出码失败；已接入 `npm run check` 与 CI 的 `verify` job。

## 残余风险披露（历史与第三方副本）

- 本轮决策（D2-A）**不重写历史**：父仓库历史提交（`c03a011` 引入 / `f6b7505` 删除）、内嵌 RRS 仓库 HEAD `d765ec3` 与公开分支 `origin/codex/retrieval-pipeline-v1` 仍可读取到上述**已作废**的旧密钥；第三方 fork（如 `z1645444`）包含该提交血缘，即使重写历史也无法清除 fork 副本。
- 因此本项目**不声称“公开历史完全不含凭据”**；只声称“旧密钥已作废、当前快照与后续提交不含该密钥、构建产物不含该文件”。历史清理（就地重写或旧仓归档）需单独批准后执行。

## 用户密钥与私密信息隔离策略

- 用户凭据/私密信息与软件本体分离保存：运行时配置位于用户 AppData 下的本地配置（如 `retrieval-service/config/llm.local.json`），不进入仓库、不进入便携包、不进入日志与错误消息。
- 旧版本地路径 `materials/source-profiles/LLM config.txt` 在当前树已删除（仅历史/已作废旧密钥可见），并被打包白名单排除；任何情况下不得再写入真实密钥。
- 本机测试/演示使用的密钥不得写入任何仓库文件、测试夹具或导出物；示例配置只使用占位符（如 `YOUR_...`）。
- 2026-11-18 复审后：LLM 配置 GET/POST 响应只返回 `hasApiKey`/掩码，不回传原始 key；密钥仍以本地配置文件形式落盘（DPAPI/凭据管理器加固列后续，见 C-F07 残余）。
- 双防线：打包输入以 `packaging/materials-whitelist.json` 为唯一允许清单；仓库内容由 `scripts/audit-secrets.mjs` 扫描。两者都不以“构建后删除”作为唯一保护。

## 本地服务面与 Electron 残余风险（W3，2026-11-17）

- owner（`127.0.0.1:4322`）与本地站点（`127.0.0.1:4331`）仅回环监听。owner 使用 **per-session token**：`GET /?bootstrap=<token>` 换取 `HttpOnly; SameSite=Strict` 会话 cookie 并 302 回首页；所有 `/api/*` 请求必须携带该 cookie；`Host` 必须为 `127.0.0.1:<端口>`，存在 `Origin` 时必须同源（CSRF/DNS-rebinding 防护）。
- 桌面主进程每次启动 owner 服务时生成 32 字节随机 token 并经 spawn env 注入；独立开发模式（`npm run owner`）会打印一次性的 bootstrap URL，**不会静默放行**。
- 本地文件链接改由 Electron IPC（`desktop:open-local-resource`）打开：主进程只允许当前活动库已登记的 `localPath` 或库内资产，其他路径（含空路径）一律拒绝；旧的同源 `/__local-resource` HTTP 端点已删除，非 Electron 浏览器点击本地链接只显示提示。
- `/api/remote-image` 在请求前解析域名并阻断 loopback/私网/链路本地/多播地址（IPv4、IPv6、IPv4-mapped），限制响应 10MB、图片 content-type 白名单与独立超时，并对重定向后的最终地址再次校验。
- `/api/assets/upload` 使用 bucket 白名单、安全 slug、图片扩展名白名单，并解析路径做前缀包含校验；`/api/open-resource` 本地路径走上述白名单。站点导出目标拒绝盘符根/共享根、系统目录、用户主目录与活动库内部路径；已存在且非空的目录必须显式确认覆盖。`desktop:open-external` 仅允许 `http/https/mailto`。
- **残余风险**：桌面渲染窗口仍为 `sandbox:false`（为兼容当前 preload/asar 加载方式，本轮未启用 Chromium sandbox），依靠 `contextIsolation:true`、`nodeIntegration:false`、同源限制与 IPC 白名单降低风险；启用 sandbox 需改为 CJS preload 并回归全部窗口功能，列入后续工作。owner 会话为单进程共享 token（不区分标签页），同机进程若已获得 token 仍可调用；token 仅存在于进程内存/启动 URL 中，不写入日志或仓库。

## 提交与发布前检查

- 提交前运行 `npm run audit:secrets`；`npm run check` 与 CI `verify` job 会执行同一检查，命中即失败。
- 若扫描命中：工作树、暂存区与历史都要检查；真实凭据须先轮换/作废，再清理提交，不要仅从工作树删除。
- 发布/打包前确认便携包材料清单与白名单一致（`build-portable.ps1` 已自动校验）。

## 0.1.2 依赖例外与密钥加固（2026-11-18）

- LLM 密钥使用 Windows DPAPI（CurrentUser）落盘；旧明文自动迁移；无 plaintext fallback。
- 残余 high/critical 依赖公告按 `security/DEPENDENCY-EXCEPTIONS.md` 逐条可达性登记（astro/js-yaml/picomatch/sharp/svgo 等），allowlist 位于 `security/audit-exceptions.json`，复审到期 2026-12-31；`npm run audit:release` 对 allowlist 外项阻断。
- 正式 Release 必须有效 Authenticode 签名；无证书只能产出候选。
