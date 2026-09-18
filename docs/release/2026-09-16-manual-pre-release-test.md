# 不全书人工复测手册

## 1. 本轮目标与准备状态

本手册验证安装版、开发版、library 协作和静态站点发布彼此隔离。复测前置材料已经生成，不需要手工制作测试库或修改 JSON。

固定根目录：`F:\personal\Sunhaoran\Introduction to Classical Music`

| 项目 | 路径 |
| --- | --- |
| 安装目录 | `local-install\buquanshu` |
| 安装版 AppData | `%APPDATA%\buquanshu` |
| 软件仓库 | `repositories\software\Introduction to Classical Music` |
| 官方 library | `repositories\library\Salon_library` |
| 站点仓库 | `repositories\site-deploy\introduction-to-classical-music-site-deploy` |
| 复测沙箱 | `manual-test` |
| 清理前备份 | `archives\pretest-20260918-final` |

开始前确认不全书已关闭。测试产生的数据只能写入 AppData 或 `manual-test`，不要直接修改三个正式仓库，除非步骤明确要求检查只读状态。

## 2. 干净安装与首次启动

1. 打开 `local-install\buquanshu\不全书.exe`。
2. 在启动器右下角查看版本号，应显示 `版本 0.1.0`；该版本来自当前安装包，不是 library 版本。
3. 在启动器中查看库详情，库名称应为“默认资料库”。
4. 点击“打开库目录”。资源管理器应打开 `%APPDATA%\buquanshu\libraries\default-library`。若资源管理器地址栏因窗口宽度压缩了反斜杠，请同时打开 `%APPDATA%\buquanshu\state.json`，确认 `activeLibraryPath` 以 `...\AppData\Roaming\buquanshu\libraries\default-library` 结尾。
5. 失败条件：库路径指向 `local-install\buquanshu\library`。该目录只能作为只读种子，不能作为活动库。
6. 确认作曲家、人物、作品和版本数量均为 0；默认使用手册专栏可以存在。
7. 关闭并重新启动程序，确认版本、路径和数量不变。

## 3. Library 载体兼容性

预置材料：

- 压缩 A：`manual-test\fixtures\library-a.icmlibrary`
- 压缩 B：`manual-test\fixtures\library-b.icmlibrary`
- 目录 A：`manual-test\fixtures\library-a-directory.icmlibrary`
- 目录 B：`manual-test\fixtures\library-b-directory.icmlibrary`

执行：

1. 点击“导入库”，在“请选择资料库载体”窗口选择“选择 .icmlibrary 文件”，然后选择压缩 A 文件。若要导入目录包，则选择“选择资料库目录”。
2. 确认库名称为 `library-a`，条目数量为作曲家 2、人物 3、作品 3、版本 3。
3. 再次导入目录 A，确认数量与压缩 A 完全一致。
4. 点击“修改库名称”，输入 `library-a-renamed`，刷新并重启，确认名称保留；点击“打开库目录”，路径末级目录也必须变为 `library-a-renamed`。
5. 点击“导出库”，选择 `1`，目标选择 `manual-test\exports\compressed`，确认生成单文件 `.icmlibrary`。
6. 点击“导出库”，选择 `2`，目标选择 `manual-test\exports\directory`，确认生成目录 `.icmlibrary`。
7. 分别重新导入两个导出结果，确认名称、library ID 和实体数量一致。

## 4. 全面差异检查与合并

测试库覆盖作曲家、人物、作品组、作品和版本五种实体，并包含图片、链接和备注字段差异。

1. 导入压缩 A，使其成为当前库。
2. 打开维护工具，点击“检查/合并库”，选择压缩 B。
3. 差异摘要必须显示：对方新增 5、本地独有 5、字段冲突 4、完全相同 5。
4. 第一次在自定义“确认合并库”对话框选择“取消”，确认当前库没有新增 B 独有条目。维护工具不使用浏览器 `prompt()`/`confirm()`，若出现该错误说明运行的不是最新安装包。
5. 再次执行比较并确认合并。
6. 工具按冲突条目逐个显示：冲突字段对照、本地完整信息、对方完整信息和“最终保存信息”JSON 编辑区。可点击任一侧作为编辑起点，再直接修改最终 JSON；点击“保存此条并继续”进入下一条。
7. 完成后确认：B 独有作曲家、人物、作品组、作品和版本均已加入；A 独有条目仍然存在；冲突人物名称为“冲突人物-B”。
8. 版本冲突页应同时突出标题、图片、链接和备注字段。选择对方信息为起点，再按需修改其中一个字段，确认最终条目与编辑区内容一致。
9. 检查 AppData 的 `libraries\merge-backups`，必须存在合并前时间戳备份。
10. 对目录 B 重复一次“检查/合并库”，确认压缩载体与目录载体得到相同差异语义。

## 5. 目录详情导出

1. 在维护工具点击“导出目录详情”。
2. 打开下载的 HTML 文件。首次打开时只显示折叠的作曲家列表。
3. 逐层展开作曲家和作品，确认结构为“作曲家 → 作品 → 指挥/演奏者 → 版本”，版本信息包含参与者、乐团、地点、演出时间、发行时间、专辑、厂牌和备注中实际存在的字段。
4. 确认刚合并的 A 独有、B 独有和共享条目均可检索。

## 6. 官方库导出沙箱

1. 导入官方 library：`repositories\library\Salon_library`。
2. 确认名称为“Salon Library 官方资料库”，数量为作曲家 8、人物 227、作品 16、版本 206。
3. 不要在正式库中保存测试条目。
4. 点击“导出库”，选择任一载体形式，目标选择 `manual-test\repository-target\Salon_library-test`。
5. 该目标是预置的独立 Git 沙箱。确认 `.git` 仍存在，`library.manifest.json`、`content` 和 `assets` 已更新。
6. 确认目标旁生成 `.backup-时间戳` 目录，且目标中没有 `build`、`runtime`、`exports`。
7. 正式维护时才选择真实 `repositories\library\Salon_library`，并在推送前使用 Git 客户端人工审查差异。

## 7. 静态网站导出沙箱

1. 保持官方 library 为当前库。
2. 点击“导出网站”，目标选择 `manual-test\site-export\current`。维护工具会使用相对资源路径 `./`，因此可直接双击 `index.html` 检查样式。
3. 等待构建完成，不要在构建过程中关闭程序。
4. 打开目标目录中的 `index.html`，并通过维护工具“打开不全书”检查首页、搜索、作曲家目录、人物页、作品页、版本页、图片、CSS 和 404 页面。
5. 确认导出目录没有本机绝对路径、AppData 路径、测试密钥或 `runtime` 数据。
6. 本步骤不修改正式站点仓库；正式发布前再将已审计目录交给站点仓库。

## 8. 开发版隔离

1. 关闭安装版。
2. 在软件仓库运行开发版 `npm run desktop:dev`。
3. 开发 AppData 必须位于仓库的 `output\desktop-dev-appdata`，开发库必须位于 `output\desktop-dev-library`。
4. 导入 A 并进行一次改名，然后关闭开发版。
5. 重新打开安装版，确认安装版当前库、官方 library 和站点沙箱均未变化。
6. 检查软件仓库 `data\library` 的实体 JSON 仍全部为空。

## 9. 通过标准与回滚

全部条件满足才通过：

- 安装版活动库始终位于 AppData；
- 压缩和目录 `.icmlibrary` 可互相等价导入；
- 五种实体的新增、本地独有、相同和字段冲突均正确报告；
- 逐字段选择结果正确，合并前有备份；
- 官方库沙箱保留 Git 元数据且只更新规范内容；
- 站点构建成功且不泄漏本机路径；
- 安装版、开发版、官方库和站点仓库互不写入。

任一步骤失败时停止后续写入。清理前 AppData 和旧安装相关资料保存在 `archives\pretest-20260918-final`；更早的历史运行态仍保存在 `C:\Users\HIT-IVAFFR\AppData\Roaming\buquanshu-preinstall-20260912`。
