# 方案二拆分记录

来源：`/Users/esop/Desktop/pdf-editor` 当前工作区，Git HEAD 为 `4cf8642deb0d281556ef92750e78bfc6e14ed8d2`。拆分日期为 2026-09-29。原工作区包含 Word 式文本换行修改，本仓库同时保留这些修改。

本仓库是独立源码快照，没有复制原 Git 历史、运行数据库或依赖目录；原仓库的源码和已有未提交改动保持原状。

## 功能对应

| 原实现 | 独立仓库实现 |
| --- | --- |
| React/Tiptap 编辑器、页面、表格、字段、角色、锚点 | 保留原组件与编辑器扩展 |
| `DemoPortal`、`SigningFlow`、`ContractRecordsDialog` | 保留完整入口和交互，统一使用 HTML 模板 |
| `SignaturePad`、`SignatureChooser`、`SealPicker`、`SealUpload` | 保留手写、签名库、演示印章库和直接上传 |
| Node `demo.ts` | Java `BusinessHandler` / `ContractService` 提供模板库、发送快照、用户列表和资源库 |
| Node `signing.ts` | Java 负责角色顺序、系统值与图片校验、表格权限和签署结果 |
| Node SQLite 业务库 | Java `ContractStore` 使用独立 SQLite，原子保存合同状态和 PDF |
| Node `htmlTemplate.ts` | Java `HtmlTemplate` / Jsoup 验证 HTML 协议并填充文本、图片和动态表格 |
| Node `pdfPagination.ts` | 保留浏览器 DOM 分页算法，作为 Java 资源 `pagination.js` 执行 |
| Puppeteer PDF 浏览器 | Java `ChromiumPdf` 直接使用 CDP 控制 Chromium，后端无需 Node |
| Java JSON → Node 代理、重复 JSON 示例与出口 | 移除；模板正文、签署渲染和 PDF 统一走受限 HTML |

首次拆分曾只迁移编辑器，遗漏签署与业务流程；现已按完整功能基线补齐，范围以本记录和 README 的功能表为准。

## 模板和数据

模板库只保存 `format: html`、`formatVersion: 1` 的元数据包。内含 `html`、`pageSettings`、`roles`、`fields`、`fieldTables`。浏览器内部仍通过 Tiptap 文档执行编辑命令和分页；旧 JSON 模板导入时先校验并转换成 HTML 包，后端协议保持统一。

发送合同固化模板、用户角色分配、表格记录与行 ID。后续签署基于快照，不重新读取业务来源来改变既有合同。数据源的初始记录来自资源文件，保存于独立 SQLite。

每次签署校验当前角色和演示用户，拒绝未授权字段、预设单元格、其他角色数据、重复单元格、无效图片和重复签署。先生成 PDF，再按预期角色索引更新 SQLite；失败时不推进合同状态。

打印 HTML 的 DOMPurify 设置显式关闭自动放行全部 `data-*`，Java 再次验证；正文和标题打印样式保留前次拆分的修正。填充后的普通文本采用 inline / pre-wrap / overflow-wrap，延续 Word 式换行。

PDF 使用受控二次分页：表格续页、重复表头、超高行拆分、正文后的锚点组移动。分页过程中检查文字、宽度和高度；不可拆分的复杂超高内容会返回错误。

默认前端端口 3002、Java 端口 3202，与原仓库分开。验证使用单独的 3003/3203 端口与测试数据库。

## 验证证据

- 前端构建，以及角色、字段表格和 HTML 模板往返检查通过。
- Java 单元测试覆盖 HTML 清洗、DOM 元数据、签名图片、SVG、绑定、快照、SQLite 恢复和过期状态更新。
- 实际接口验证模板新建/更新、发送、用户授权、两人顺序签署、签名库、印章库和最终 PDF。
- 拒绝请求不改变合同状态；同一角色并发签署只有一次成功。
- 85 行静态表格实际输出 15 页，30 条动态记录实际输出 7 页，均保留超高行的 45 段重复文字和完整记录。
- 三个签署锚点随动态表格后的正文移动到同一页。
- 修正表格填充值沿用固定控件宽度导致跨列的问题，文字受单元格宽度约束。
- 修正模板导入未同步文档根节点元数据的问题，字段、角色和页边距在刷新恢复后保留。
- 浏览器验证与截图、PDF 证据存于 `output/verification/`；这些产物不提交到 Git。

这仍是本地演示应用：用户切换沿用原演示身份，尚未对接真实身份服务或电子签名供应商。
