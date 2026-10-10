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
| 页面和控件 | A4、页边距、自动分页、角色和数据库字段绑定、文档流签署区域、区域内签名/企业章 |
| 页眉页脚 | 富文本编辑、字号和对齐、页码/总页数、首页不同、奇偶页不同、独立分节、Word 页眉页脚导入 |
| 模板 | HTML 模板包导入/下载、本地自动保存与恢复、服务端模板库、新建/编辑/保存、示例模板 |
| 发送合同 | 角色分配、员工/归属/协议明细数据源、稳定行 ID、发送时固化模板和表格数据快照 |
| 签署 | 演示用户切换、按角色依次签署、字段权限、日期和枚举校验、Word 式文本换行、表格填写 |
| 签名与印章 | 手写签名、清除和重签、个人签名库、按需加载印章库、直接签署时上传企业章 |
| 合同记录 | 用户合同列表、当前签署进度、继续签署、查看当前 PDF、下载最终 PDF、重启后恢复 |
| PDF | 模板导出、签署中预览、每次签署保存 PDF、动态长表格展开、超高行拆分、续页表头、签署区域整体随正文移动 |

管理员入口管理模板和发送合同；张三/李四入口查看各自合同并签署。“本地编辑与签署”保留独立编辑器的直接发起签署和合同记录入口。

四个 HTML 示例覆盖归属确认、85 行静态长表格、30 条动态协议明细和文档流签署区域。原来 JSON/HTML 成对的示例统一保留 HTML 版本。

## 模板和渲染协议

### Word 导入

编辑器工具栏的“导入模板 / Word”支持 `.docx`（最大 5MB）和现有 JSON 模板包。
Word 通过 Mammoth 在浏览器中解析，导入后可以继续编辑、手动添加签署控件、保存模板并导出 PDF。
保留标题、段落、空段落、列表、加粗、斜体、下划线、合并单元格和可解码的嵌入图片；直接设置的对齐、支持的字体和字号会映射到现有编辑器格式。
图片转为内嵌 PNG，按后端资源限制缩小到不超过 1600×1200，单张不超过 2MB；不支持的图片会给出提示。导入后的 HTML 同样限制为 5MB。
Word 的分节、普通/首页/偶数页页眉页脚会单独读取，再由 Mammoth 转换内容；支持 PAGE、NUMPAGES 页码域和嵌入图片，以及缺省页眉页脚继承上一节。
Mammoth 不完整保留 Word 排版：颜色、段落间距、复杂表格样式、图片原始摆放尺寸及原始分页等可能变化，页面由现有 A4 分页重新计算。连续或奇偶分节会转为另起一页；旧版 `.doc` 需先转换为 `.docx`。
转换失败或取消覆盖确认时保留当前文档。正文图片同时纳入模板保存、恢复和 Java PDF 渲染的校验；已有 Java 服务需要重启后使用更新后的图片模板支持。

启动服务后运行 `npm run test:word-import`，验证真实 DOCX 的导入、编辑、自动分页、本地恢复、服务端保存及 PDF 导出。该测试会创建演示模板，建议使用独立测试数据库。

### 页眉页脚

右侧“页眉页脚”面板可分别启用页眉和页脚，编辑文本、字号和对齐，插入 `{page}` 和 `{pages}`。页码按整份文档连续计算，PDF 会根据最终分页重新计算总页数。
每节支持“首页不同”和“奇偶页不同”，首页设置优先于奇偶页设置。先把正文光标放到目标页，再点击“从当前页开始新节”；新节继承该页所属节的设置，后续可独立修改，也可复制上一节设置。
页眉页脚高度范围为 5～40mm，启用后正文会预留相应空间并重新分页；内容超高会提示页面溢出，导出 PDF 时会拒绝裁切内容。页眉页脚配置随本地保存、模板下载、服务端保存和签署预览保留，旧模板默认关闭。
运行 `npm run test:page-furniture` 验证配置和模板协议；启动服务后运行 `npm run test:furniture-ui` 验证 Word 分节导入、编辑恢复、保存和 PDF 自动续页。测试会写入演示模板，建议使用独立测试数据库。已有 Java 服务需重启以加载新渲染逻辑。

可编辑模板包使用 `.json` 文件承载元数据，正文为受限 HTML：

```ts
{
  format: 'html',
  formatVersion: 1,
  html: '<section data-contract-page="true" data-page-id="page-1">...</section>',
  pageSettings: { /* A4 规格和页边距 */ },
  roles: [],
  fields: [],
  fieldTables: [],
  pageFurniture: { sections: [/* 节标识、页眉页脚各页面类型及高度 */] }
}
```

Tiptap JSON 用于浏览器内部编辑与历史命令。模板保存、合同快照和签署渲染均使用 HTML 模板包；不提供原方案的 `/api/pdf/json` 代理或 Node PDF 服务。本地保存键为 `editor_pdf:html-template:v1`。旧版 Tiptap JSON 模板可在前端导入并转换为 HTML 模板包，随后保存和导出统一使用 HTML。

- 设计器的 `POST /api/pdf/html` 接收打印 HTML，限制 5MB。
- 签署预览的 `POST /api/pdf/template` 接收 HTML 模板包和当前填充数据；预览不会改变合同记录。
- 发送和签署接口从服务端保存的模板与快照生成 PDF；请求体限制 16MB。
- Java 使用 Jsoup 校验页面、字段、角色、绑定、表格和签署区域协议，文本通过 `Element.text` 填充，图片仅接受经过检查的 data URL。
- Chromium 执行仓库内受控分页代码，再检查高度、宽度和文字完整性。续页重复表头，超高纯文本行拆分，签署区域随正文整体换页。
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
POST /api/pdf/template/render
```

保留 `/api/signing/submissions` 的创建、已完成记录列表、详情和 PDF 兼容入口。演示合同签署使用 `X-Demo-User-Id`，服务端核对发送时的角色分配并使用已分配用户姓名。

### 后端签署控件最终坐标

Java 在 Chromium 完成字体/图片加载、分页和控件位置调整后，读取实际签名/盖章框的位置，再从同一个页面生成 PDF。`ChromiumPdf.Result.signingPositions()` 提供坐标数组，包含行内锚点、签署区域及页面浮层；没有签署控件时返回空数组。

`POST /api/pdf/template/render` 的请求体与 `/api/pdf/template` 相同：`{ template, signed }`，返回 JSON：

```json
{
  "pdfBase64": "JVBERi0...",
  "pdfPageCount": 3,
  "signingPositions": [
    {
      "fieldId": "signature-party-a",
      "refId": "ref-signature-party-a",
      "fieldType": "signature",
      "pageNumber": 3,
      "x": 95.59,
      "y": 560.25,
      "width": 80,
      "height": 40,
      "unit": "px",
      "origin": "top-left"
    }
  ]
}
```

`pageNumber` 从 1 开始；`x/y` 相对整张纸左上角，包含页边距，使用 CSS 像素且保留小数。`width/height` 表示控件框，而非签名图片内部的实际墨迹范围。`fieldType` 为 `signature` 或 `companySeal`；`refId` 区分同一字段的不同引用。需要 PDF 点单位时使用 `pt = px × 72 / 96`。预览不会写入合同，原 `/api/pdf/template` 仍返回 PDF 二进制。

发送合同及每次签署成功后，`signingPositions`、`pdfPageCount` 与该次 PDF 一起原子写入 SQLite。创建/签署响应、合同详情、签署视图及已完成提交详情提供这两个字段。后续填充导致重排时会重新计算；旧合同不会自动重新生成 PDF，未重新生成前没有这两个字段。部署后需要重启 Java 服务加载新代码。

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

签名和企业章插入正文时自动创建签署区域；同一区域内的控件保持相对位置。正文输入或数据填充使内容增高时，区域自然下移，剩余空间不足时整体换页。旧模板中的锚点和页面浮层会在加载时转换，无需再配置锚点绑定。
