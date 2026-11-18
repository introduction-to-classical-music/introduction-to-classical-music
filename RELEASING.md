# 发布流程

## 发布目标

公共 Release 只发布两类内容：

- 源代码仓库
- `不全书 Setup <version>.exe`

开发者个人资料库便携版不进入公共 Release。

## 发布前检查

1. 运行 `npm run bootstrap:windows`
2. 运行 `npm run doctor:windows`
3. 运行 `npm run check`（其中包含实体生命体征审计、参考库审计与审计门禁自测；任一审计 issue 会以非零退出码失败）
4. 运行 `npm run build`
5. 运行 `npm run package:windows`（仅本地打包校验，不会发布到 GitHub Release）
6. 检查安装、启动、覆盖升级、卸载和用户数据保留
7. 更新 `CHANGELOG.md`、`docs/release/*` 和 Release Notes

## 打包结果

打包完成后，Windows 安装版默认位于：

- `output/releases/`

本地打包命令只用于确认安装包可构建，不负责发布流程。

## CI 发布触发规则

- 普通 `push` / `pull_request`：执行 Windows 打包校验，不发布 Release
- 推送 `v*` Tag（例如 `v0.1.1`）：触发 GitHub Actions 自动发布
- 发布产物绑定到同名 Tag 的 GitHub Release

## 升级与卸载

- 使用稳定 `appId` 进行覆盖升级
- 卸载程序必须可用
- 卸载默认保留 `%APPDATA%\buquanshu`

## 发布后动作

- 从已通过检查的 `main` 创建并推送符合规范的 Tag（例如 `v0.1.1`）
- 确认 GitHub Actions 的 `windows-release` Job 成功
- 确认 GitHub Release 已绑定同名 Tag 且包含安装版 `Setup` 产物
- 发布或补充 Release Notes
- 在下一轮开发开始前确认公共仓库仍然不含私有资料、缓存和构建物

## 0.1.2 发布 gate（必须）

1. `npm run generate:exceptions && npm run generate:sbom`（lock 变更时）并确认 allowlist/许可证。
2. 从干净提交构建候选：`npm run desktop:dist`（默认 `signAndEditExecutable=false`，产出 unsigned 候选）；正式签名构建使用 `npm run desktop:dist:signed` 并设置 `CSC_LINK`/`CSC_KEY_PASSWORD`；随后 `npm run audit:release`（allowlist 外 high/critical fail；绝对路径/PII/密钥/源映射/版本/latest.yml 检查）。
3. `npm run verify:signing -- -InstallerPath <installer> -RequireSigned`：正式 Release 必须 Authenticode Valid；无证书只能产出 **候选**，tag 发布必须被 CI gate 阻止。
4. `npm run release:checksums` 生成 SHA256SUMS.txt/checksums.json；安装包/latest.yml/README 命名需一致（ASCII `buquanshu-setup-<version>.exe`）。
5. 证据与例外复审：`security/DEPENDENCY-EXCEPTIONS.md` 到期前复审；安装/升级/卸载/GUI 验收另由 E-VERIFY 执行。
