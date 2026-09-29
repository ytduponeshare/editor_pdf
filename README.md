# editor_pdf

从 `pdf-editor` 剥离的独立合同编辑与签署演示仓库，采用 **方案二：受限 HTML → Java/Jsoup → Chromium → PDF**。

React 17、TypeScript、Tiptap/ProseMirror 提供编辑和签署页面。Java 17 提供模板库、字段目录、合同发送、签署状态机和 PDF；SQLite 保存合同快照、签名库与 PDF。Java 通过 Chromium DevTools Protocol 直接控制本机 Chromium，执行受控分页代码后打印，不依赖 Node/Express 服务。

## 启动

需要 Node.js 22、JDK 17+、Maven，以及 Chrome/Chromium：

```bash
cd ~/Desktop/editor_pdf
npm ci
npm run dev:all
```

打开 http://localhost:3002 。Java 服务运行在 http://127.0.0.1:3202 。也可分别执行 `npm run dev:client` 和 `npm run dev:java`。

默认 Chromium 路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。其他浏览器或端口可以这样启动：

```bash
CHROMIUM_PATH=/path/to/chromium JAVA_PDF_PORT=3203 \
JAVA_PDF_URL=http://127.0.0.1:3203 VITE_DEV_PORT=3003 npm run dev:all
```

数据库默认位于 `java-backend/data/editor_pdf.sqlite`，可通过 `SIGNING_DB_PATH` 指定绝对路径。数据库、PDF 和构建产物不进入 Git。

## 功能

| 模块 | 已保留功能 |
| --- | --- |
| 编辑器 | 富文本、字体、字号、颜色、行距、对齐、列表、撤销/重做、拖入控件、普通表格操作 |
| 页面和控件 | A4、页边距、自动分页、角色和数据库字段绑定、浮动签名/企业章、正文布局锚点 |
| 模板 | HTML 模板包导入/下载、本地自动保存与恢复、服务端模板库、新建/编辑/保存、示例模板 |
| 发送合同 | 角色分配、员工/归属/协议明细数据源、稳定行 ID、发送时固化模板和表格数据快照 |
| 签署 | 演示用户切换、按角色依次签署、字段权限、日期和枚举校验、Word 式文本换行、表格填写 |
| 签名与印章 | 手写签名、清除和重签、个人签名库、按需加载印章库、直接签署时上传企业章 |
| 合同记录 | 用户合同列表、当前签署进度、继续签署、查看当前 PDF、下载最终 PDF、重启后恢复 |
| PDF | 模板导出、签署中预览、每次签署保存 PDF、动态长表格展开、超高行拆分、续页表头、锚点随正文移动 |

管理员入口管理模板和发送合同；张三/李四入口查看各自合同并签署。“本地编辑与签署”保留独立编辑器的直接发起签署和合同记录入口。

四个 HTML 示例覆盖归属确认、85 行静态长表格、30 条动态协议明细和签署锚点。原来 JSON/HTML 成对的示例统一保留 HTML 版本。

## 模板和渲染协议

可编辑模板包使用 `.json` 文件承载元数据，正文为受限 HTML：

```ts
{
  format: 'html',
  formatVersion: 1,
  html: '<section data-contract-page="true" data-page-id="page-1">...</section>',
  pageSettings: { /* A4 规格和页边距 */ },
  roles: [],
  fields: [],
  fieldTables: []
}
```

Tiptap JSON 用于浏览器内部编辑与历史命令。模板保存、合同快照和签署渲染均使用 HTML 模板包；不提供原方案的 `/api/pdf/json` 代理或 Node PDF 服务。本地保存键为 `editor_pdf:html-template:v1`。旧版 Tiptap JSON 模板可在前端导入并转换为 HTML 模板包，随后保存和导出统一使用 HTML。

- 设计器的 `POST /api/pdf/html` 接收打印 HTML，限制 5MB。
- 签署预览的 `POST /api/pdf/template` 接收 HTML 模板包和当前填充数据；预览不会改变合同记录。
- 发送和签署接口从服务端保存的模板与快照生成 PDF；请求体限制 16MB。
- Java 使用 Jsoup 校验页面、字段、角色、绑定、表格和锚点协议，文本通过 `Element.text` 填充，图片仅接受经过检查的 data URL。
- Chromium 执行仓库内受控分页代码，再检查高度、宽度和文字完整性。续页重复表头，超高纯文本行拆分，锚点控件重新定位。
- 每次渲染使用独立 Chromium 配置目录，CSP 禁止页面访问外部资源；最多同时生成两份 PDF。CDP 操作超时 30 秒。
- PDF 生成成功后才写入合同状态；按当前角色索引条件更新，避免重复签署覆盖结果。

## 接口

```text
GET  /api/health
GET  /api/system-fields
GET  /api/field-tables/sources
GET  /api/field-tables/sources/{sourceId}/fields
GET  /api/field-tables/sources/{sourceId}/records
GET  /api/demo/users
GET  /api/demo/templates
GET  /api/demo/templates/{id}
POST /api/demo/templates
PUT  /api/demo/templates/{id}
POST /api/demo/contracts
GET  /api/demo/users/{userId}/contracts
GET  /api/demo/contracts/{id}/signing-view?userId=...
GET  /api/demo/contracts/{id}/available-seals?userId=...
GET  /api/demo/users/{userId}/signatures
POST /api/demo/users/{userId}/signatures
POST /api/signing/contracts
GET  /api/signing/contracts
GET  /api/signing/contracts/{id}
POST /api/signing/contracts/{id}/sign
GET  /api/signing/contracts/{id}/pdf
POST /api/pdf/html
POST /api/pdf/template
```

保留 `/api/signing/submissions` 的创建、已完成记录列表、详情和 PDF 兼容入口。演示合同签署使用 `X-Demo-User-Id`，服务端核对发送时的角色分配并使用已分配用户姓名。

此仓库沿用原项目的演示身份和示例业务数据，没有真实登录、租户隔离或法定电子签名服务。

## 验证

```bash
npm run build
npm run test:roles
npm run test:field-tables
npm run test:html-template
npm run test:java
```

启动服务后执行完整接口和浏览器验证：

```bash
npm run test:pdf
npm run test:demo-flow
npm run test:business-api
npm run test:ui
```

`test:business-api` 使用 `test:demo-flow` 创建的有效签名样本。测试创建演示模板、合同和签名记录；建议使用单独数据库。可分别设置 `DEMO_API_URL`、`EDITOR_URL` 和 `JAVA_PDF_URL`。浏览器验证使用 Puppeteer Core 开发依赖；后端运行不使用它。

回归 PDF、截图和状态快照保存在 `output/verification/`；HTML 冒烟 PDF 保存在 `java-backend/target/smoke/`。

## 目录

```text
src/                 编辑器、签署、演示门户和前端服务
java-backend/        Java API、SQLite、Jsoup 模板处理和 Chromium CDP
scripts/             协议、接口和浏览器回归测试
docs/extraction.md   拆分来源与功能对应关系
```
