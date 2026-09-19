# Changelog

本项目遵循 `SemVer`（语义化版本）。

## [0.1.1] - 2026-09-19

### Fixed

- 修复启动器与维护工具活动库不同步的问题。
- 修复连续多条 library 冲突合并在第二条后被误取消的问题。
- 改进冲突条目编辑，支持显示双方完整信息并保存最终 JSON。
- 修复 `.icmlibrary` 文件导入选择器和库目录改名。
- 修复本地静态网站导出资源路径，直接打开 `index.html` 时可加载样式。
- 将目录详情导出升级为可折叠的 HTML 条目树。

### Changed

- 维护工具导出网站直接选择目标目录。
- 开发版、安装版和活动 library 的隔离检查纳入人工复测流程。

## [0.1.0] - 2026-04-19

### Added

- 建立公共发布仓库结构
- 引入 `Apache-2.0` 代码许可证与独立内容许可说明
- 新增 `bootstrap:windows`、`doctor:windows`、`package:windows` 命令
- 将 `tools/recording-retrieval-service/app/` 纳入公共仓库版本控制
- 增加 Windows 打包与环境检查 CI

### Changed

- 公共默认数据调整为空资料库
- 默认库首次启动仅注入《不全书使用手册》专栏
- Windows 公共 Release 固定为安装版，不公开个人资料库便携版
- 安装升级策略固定为同 `AppId` 覆盖安装并保留 `%APPDATA%` 用户数据

### Removed

- 从公共发布目标中移除便携版应用程序产物

### Notes

- 首发版本不提供应用内自动更新
