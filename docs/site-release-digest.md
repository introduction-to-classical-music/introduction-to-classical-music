# 站点发布摘要（sourceDigest / siteDigest）语义

本文说明 `scripts/export-site-release.mjs` 生成的 `site-release-manifest.json` 中摘要字段的语义，以及 W10a 引入的确定性 EOL 规范化。

## 字段

| 字段 | 内容 |
|---|---|
| `sourceDigest` | 来源资料库 `library.manifest.json` + `content/` + `assets/` 的目录摘要 |
| `siteDigest` | 导出站点目录（排除 `site-release-manifest.json` 自身）的目录摘要 |
| `default library snapshotDigest` | `export-default-library.mjs` 对默认库快照计算的同类目录摘要 |

摘要算法：对每个文件分别计算 SHA-256，再对 `path\0sha256\n` 排序拼接后的文本计算 SHA-256；文件列表按相对路径排序。

## 文本 EOL 规范化（W10a）

**文本文件**（`.json/.md/.txt/.yml/.yaml/.css/.html/.js/.mjs/.xml/.csv/.tsv/.svg`）在哈希前先做确定性换行规范化：`CRLF`/`CR` → `LF`。因此：

- 同一内容在 Windows（`core.autocrlf=true`，工作树 CRLF）与 Linux/CI（LF checkout）上计算的 `sourceDigest` **相同**，可跨平台复算；
- 二进制文件（图片、音频等）仍按原始字节哈希，不做规范化；
- 已存在的、以 LF 存储的默认库快照摘要保持不变（规范化对 LF 内容是无操作）。

## 边界说明

- 摘要用于**完整性封条**（某个来源/站点树是否在字节级别等价），不是可复现构建证明：时间戳、生成顺序等仍会影响 `siteDigest`。
- 本规范化只影响摘要计算，不修改资料库内容、不写 `.gitattributes`，也不要求维护者改变 checkout 方式。
- 测试：`tests/unit/library-digest-eol.test.ts` 验证 CRLF/LF 同内容同摘要、二进制按字节哈希。
