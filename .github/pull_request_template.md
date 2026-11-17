## 变更摘要

<!-- 说明改了什么、为什么、对用户/发布的影响。关联 issue/task 编号。 -->

## 测试

- [ ] `npm run check`（如本机存在已知 `shared-assets` 环境失败，请注明并附证据）
- [ ] 目标测试：`npx vitest run <相关文件>`（附通过数字）
- [ ] `npm run build`（如涉及站点/种子/导出）
- [ ] `npm run check:long-paths`（如新增/重命名文件）
- [ ] 手工验证/截图（如涉及 GUI、安装、导出；注明或标 UNVERIFIED）

## 安全与公开边界

- [ ] `npm run audit:secrets` 通过（0 findings），无密钥/凭据/本机绝对路径进入 diff
- [ ] `npm run public:audit` 通过；未把官方库原始数据、`review-queue`/`entity-vitals-review` 等内部工件、QQ 等联系方式带入公开仓库/站点
- [ ] 导出/发布变更已检查 public 模式（本地链接剥离、内部路径过滤）
- [ ] 官方库/安装版/站点产物没有被直接覆盖或提交二进制

## 版本与元数据

- [ ] 版本单一来源未被绕开（`package.json` / `app/version.py` / pyproject 动态版本）
- [ ] 若涉及 RRS：内嵌仓库已提交且父仓库快照对齐（文件集合与 blob 一致），`requirements`/build-info 同步
- [ ] 发布相关内容已更新 `docs/release/`（验收记录/发布说明/边界文档）
- [ ] `core.longpaths` 相关工作区配置已确认（跨仓库改动时）

## 风险与回滚

- [ ] 已说明数据/兼容性风险（默认库、导出、安装升级、迁移）
- [ ] 已说明回滚方式（revert 提交、重新导出、恢复备份）
- [ ] 未 push 前由验收方复核；不启用新的强制 CI 门槛（main 分支保护已由 D9a 处理）
