# editor_pdf

独立合同模板编辑器，采用 **方案二：受限 HTML → Java/Jsoup → Chromium → PDF**。

前端使用 React 17、TypeScript、Tiptap/ProseMirror 和 Vite；PDF 服务使用 Java 17、Jsoup 与本机 Chrome/Chromium。PDF 生成只经过 Java 服务。

## 启动

需要 Node.js 22、JDK 17 或以上、Maven，以及 Chrome/Chromium。

```bash
cd ~/Desktop/editor_pdf
npm ci
npm run dev:all
```

编辑器地址：http://localhost:3002；Java 服务地址：http://127.0.0.1:3202。

也可分别启动：

```bash
npm run dev:client
npm run dev:java
```

默认 Chromium 路径为 macOS Google Chrome：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

使用其他浏览器或端口时：

```bash
CHROMIUM_PATH=/path/to/chromium JAVA_PDF_PORT=3203 \
JAVA_PDF_URL=http://127.0.0.1:3203 VITE_DEV_PORT=3003 npm run dev:all
```

## 保留的功能

- 富文本、字体、字号、颜色、行距、列表和对齐。
- A4 页面、页边距、自动分页、普通表格和字段表格。
- 角色管理、字段绑定、签名/企业章占位控件和布局锚点。
- HTML 模板包导入、下载和浏览器自动保存。
- 打印 HTML 下载，以及 Java PDF 导出。

当前独立范围是模板编辑和 PDF 导出。原项目的演示门户、合同发起、签署状态机、签名/印章上传及历史合同存储未迁入。

## 模板与 PDF 协议

可编辑模板采用 `format: "html"`、`formatVersion: 1` 的版本化模板包：

```ts
{
  format: 'html',
  formatVersion: 1,
  html: '<section data-contract-page="true">...</section>',
  pageSettings: { /* A4 规格和页边距 */ },
  roles: [],
  fields: [],
  fieldTables: []
}
```

模板包使用 `.json` 文件作为元数据容器，正文保存在 `html` 字段。Tiptap JSON 仅用于浏览器内部编辑、验证和历史命令，不是 PDF 后端的输入协议。本地保存键为 `editor_pdf:html-template:v1`。

点击“导出 PDF”时，前端生成已分页的打印 HTML，经 DOMPurify 清洗后提交：

```http
POST /api/pdf/html
Content-Type: text/html; charset=utf-8
```

Java 使用 Jsoup 二次验证和清洗，将 HTML 写入临时目录，然后直接调用 Chromium 输出 PDF。成功响应为 `application/pdf`，前端下载 `contract-template.pdf`。请求上限为 5MB，Chromium 超时为 20 秒。

签名和企业章当前导出为占位区域；接口不接收图片或外部资源。分页由浏览器编辑器完成，Java 路径没有动态业务数据填充后的二次分页服务。

## 字段目录

Java 提供以下接口，保留原编辑器的请求路径和响应结构：

```text
GET /api/health
GET /api/system-fields
GET /api/field-tables/sources
GET /api/field-tables/sources/{sourceId}/fields
GET /api/field-tables/sources/{sourceId}/records
```

示例字段和记录位于 `java-backend/src/main/resources/catalog/`。当前包含系统字段、员工信息、企业信息、归属记录、授予记录和协议明细；这些是本地示例数据，接入业务时应替换为受权限控制的数据源。

## 验证

```bash
npm run build
npm run test:roles
npm run test:field-tables
npm run test:html-template
npm run test:java
```

启动 Java 后执行真实 PDF 冒烟测试：

```bash
npm run test:pdf
```

输出位于 `java-backend/target/smoke/html-java-chromium.pdf`，不进入 Git。

## 目录

```text
src/                 编辑器、模板协议和前端服务
java-backend/        Java HTTP 服务、Jsoup 清洗和 Chromium 调用
scripts/             前端协议和配置回归检查
docs/extraction.md   拆分来源、范围和验证记录
```

Java 清洗沿用原型的 HTML/CSS 白名单，尚未包含业务鉴权、任务队列、并发限流和 Chromium 容器隔离。
