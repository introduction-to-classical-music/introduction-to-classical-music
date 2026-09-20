# 项目维护总览

本文件是项目维护的唯一入口。软件源码、官方资料库、安装运行态和静态站点必须保持为四个独立边界。

`0.1.1` 的当前进度、验证证据和后续任务见 [里程碑](./0.1.1-milestone.md)。发布说明见 [发布索引](../release/README.md)。

## 当前边界

| 内容 | 唯一来源 | 禁止写入 |
| --- | --- | --- |
| 软件源码 | 本仓库 `dev` / `main` | 官方 library、AppData、站点仓库 |
| 官方资料库 | 私有 `Salon_library` | 本仓库 `data/library` |
| 安装工作副本 | `buquanshu` AppData | 软件源码工作树 |
| 根域名静态站点 | 站点仓库 `main` 的 `site/v*` 与 `site/current` | 软件源码与官方 library |
| GitHub Pages 镜像 | 站点仓库 `pages` | 私有资料库源文件 |

## 开发分支

- `main` 是发行线，必须保持空资料库并通过完整检查。
- `dev` 是集成线，只允许代码、文档和匿名测试夹具。
- 功能分支从 `dev` 创建，不在 `main` 直接开发。

## 维护入口

- [资料库工作流](./library-workflow.md)
- [站点发布工作流](./site-publish-workflow.md)
- [仓库与安装隔离计划](../plans/2026-09-11-repository-library-installation-isolation.md)

## 不可违反的检查

1. 公开仓库的 `data/library` 必须为空。
2. 官方资料库同步前必须通过 `npm run library:audit`。
3. 站点发布前必须通过站点仓库的 `audit-site.ps1`。
4. 自动化脚本默认只生成差异报告，不自动提交或推送。

默认发行库快照先运行 `npm run build`，再运行 `node scripts/export-default-library.mjs --out "<snapshot-dir>"` 生成；Windows 路径含空格时要保留引号。它不是官方资料库，也不是编辑入口。
