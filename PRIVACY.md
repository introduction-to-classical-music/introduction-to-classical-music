# 隐私说明

- 不全书为本地优先桌面应用，**不包含遥测/分析上报**，不向项目方服务器发送使用数据。
- 资料库、站点构建产物、日志与运行状态保存在本机（默认 `%APPDATA%\buquanshu` 与用户选择的库目录）。
- LLM API key：桌面设置与 RRS 配置使用 Windows DPAPI（CurrentUser）加密存储；owner 前端仅内存保存，不写 localStorage；GET/POST 不回传可还原 key。
- 检索服务仅在本机 loopback 运行；打开维护工具时由桌面主进程启动并把本机 URL 通过环境变量传给 owner。
- 发布产物审计会扫描绝对路径/PII/邮箱/QQ/密钥；发现即阻断（`npm run audit:release`）。
