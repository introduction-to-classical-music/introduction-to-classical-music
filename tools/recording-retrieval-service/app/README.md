# Recording Retrieval Service

本目录承载独立工具 `Recording Retrieval Service`，中文名统一为“版本自动检索工具”。

> 历史披露：公开软件仓库/RRS 历史中仍含已轮换/作废的旧 LLM key（D2-A 不重写历史），详见父仓库 `SECURITY.md`；当前树/打包产物不含该文件。

它同时服务两种入口：

- `Contract Surface`（合同面）：供父项目 owner 通过本地 HTTP 协议调用。
- `Standalone Surface`（独立面）：工具自身提供 `Web UI`（网页界面），用户可直接启动并手工提交检索任务。

## 目录用途

- 存放工具自己的源码、依赖、缓存、日志、下载产物和打包脚本。
- 不直接读写主项目的 `apps/`、`packages/`、`data/` 或 `apps/site/public/`。
- 与父项目的唯一正式集成面仍是 [`PROTOCOL.md`](../PROTOCOL.md) 定义的本地 HTTP 协议。

## 阅读顺序

1. [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md)
2. [`PROTOCOL.md`](../PROTOCOL.md)
3. 本文件

## 当前实现

- 后端：`Python + FastAPI`（快速接口框架）
- 启动模式：
  - `python -m app.main --mode service`
  - `python -m app.main --mode ui`
- 默认地址：`http://127.0.0.1:4780`
- 协议版本：`v1`
- 当前检索器：规则检索管线 `RetrievalPipeline`
- 默认来源：`materials/source-profiles/`
- 可选 LLM 配置：`config/llm.local.json`

## 本地开发

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m app.main --mode service
.\.venv\Scripts\python.exe -m app.main --mode ui
```

也可以使用包装脚本：

```powershell
.\start-service.cmd
.\start-ui.cmd
.\install-windows.cmd
.\build-portable.cmd
.\scripts\start-service.cmd
.\scripts\start-ui.cmd
```

推荐优先双击根目录的 `start-ui.cmd` 或 `start-service.cmd`。

## 目录结构

```text
tools/recording-retrieval-service/
  README.md
  PROJECT_CONTEXT.md
  PROTOCOL.md
  pyproject.toml
  app/
    main.py
    models/
    services/
    ui/
  tests/
  scripts/
  packaging/
  materials/
  config/
  cache/
  logs/
  downloads/
```

## Standalone UI

独立 UI 首版只提供：

- 原始文本 + 关键字段提示的混合输入
- 粗条目解析预览
- 原始请求 JSON 预览
- 任务状态轮询
- 字段级 before / after（变更前后）对比
- 证据、候选链接、warnings、logs 展示
- 终态结果展示

不提供：

- owner 候选审查
- 项目数据写回
- batch 模板解析

## Windows 便携分发

便携包脚本位于 `packaging/build-portable.ps1`，当前策略是：

- 使用 `PyInstaller onedir`（单目录可执行包）生成 `recording-retrieval-service.exe`
- 数据文件只打包 `packaging/materials-whitelist.json` 白名单内的非敏感材料（来源规则/别名文件）；**不打包**整个 `materials/`，用户本地配置、密钥、缓存与下载目录一律不进包
- 附带 `start-service.cmd` 与 `start-ui.cmd`
- 每次输出新的发布目录到 `dist/releases/`
- 同时刷新 `dist/portable/`，它始终指向当前最新的一份便携目录
- 同时生成一个可直接交付的 `dist/recording-retrieval-service-portable-<timestamp>.zip`
- 构建后在包内写入 `build-info.json`（应用版本、git commit/worktree 状态、Python/PyInstaller 版本、materials 白名单与 `requirements.lock` 哈希、包目录摘要），并在 zip 旁生成 `<zip>.build-info.json`（附 zip SHA256）

## 版本、依赖与构建追溯

- 版本单一来源：`app/version.py` 的 `APP_VERSION`；`pyproject.toml` 通过 `dynamic = ["version"]` 读取，`/health` 与 `PROTOCOL.md` 示例一致（由 `tests/test_build_info.py` 断言）。
- 依赖：`requirements.in` 记录直接依赖范围；`requirements.lock` 是由已验证离线构建 venv 通过 `python -m pip freeze --exclude-editable` 生成的**真实精确 pin**（含传递依赖，无 hashes；生成环境与验证结果写在文件头注释，重新生成方法见注释）。
- 内嵌仓库为可追溯的干净提交：父仓库 `tools/recording-retrieval-service/app/**` 快照与内嵌仓库 HEAD 对齐（见父仓库 `docs/` 与 remediation 证据）。
- 离线回归：`.github/workflows/ci.yml` 在安装 `[dev]` 依赖后运行 `python -m compileall -q app` 与 `python -m pytest -m "not network" -q`；真实平台测试应标记 `@pytest.mark.network`（标记已在 `pyproject.toml` 声明）。
- 本地凭据：`config/*.local.json`、旧路径 `materials/source-profiles/LLM config.txt` 已在 `.gitignore` 排除，禁止提交。

启动建议：

- 在源码目录中，优先双击根目录的 `start-ui.cmd` 或 `start-service.cmd`
- 在便携目录中，优先双击同目录下的 `start-ui.cmd` 或 `start-service.cmd`
- 如果端口 `4780` 已被占用，脚本会保留错误信息并暂停，避免窗口瞬间关闭

## 规则与配置

- 高质量来源与流媒体来源规则位于 `materials/source-profiles/`
- 规则采用纯文本格式：一行一个 URL 或 hostname，上到下为优先级
- LLM 配置文件使用 `config/llm.local.json`，格式与父项目现有 OpenAI-compatible 配置一致：
- 平台搜索 API 配置使用 `config/platform-search.local.json`，示例文件为 `config/platform-search.example.json`
- 平台配置与人工介入步骤见 `docs/platform-api-setup-checklist.md`

```json
{
  "enabled": true,
  "baseUrl": "https://your-llm-endpoint/v1",
  "apiKey": "your-secret",
  "model": "your-model",
  "timeoutMs": 30000
}
```

## owner 调用前提

- 服务已启动
- `GET /health` 可达
- `protocolVersion === "v1"`

## 父项目评测数据（parent-work eval）

`app/services/parent_work_eval.py` 默认向上查找父项目的 `data/library/works.json`。在**独立 checkout**（例如 RRS standalone CI）中没有父项目目录时，用环境变量显式指定父项目工作区根目录：

```powershell
$env:RRS_WORKSPACE_ROOT = "<parent-project-root>"
python -m pytest -m "not network" -q
```

RRS CI 会 checkout 公开父仓库到 `parent/` 并设置 `RRS_WORKSPACE_ROOT=${{ github.workspace }}/parent`；未设置该变量时保留原有“向上查找父项目”的行为，父仓库内运行时无需配置。

## 非目标

- 不直接修改项目数据文件
- 不直接写入 owner 的 `AutomationRun`
- 不直接维护候选审查状态
- 不直接解析批量导入模板文本
