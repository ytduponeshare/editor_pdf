# Java HTML 合同后端

从仓库根目录运行 `npm run dev:java` 或 `mvn -f java-backend/pom.xml compile exec:java`。

Java 17、Jsoup、Jackson、SQLite JDBC 提供完整模板/合同演示 API。`HtmlTemplate` 校验受限 HTML 元数据、展开快照表格并绑定签署数据；`ChromiumPdf` 使用 Java WebSocket 直接调用 Chromium CDP，执行 `resources/pagination.js` 后打印。没有 Node 代理或 Playwright 驱动。

默认端口为 3202；可配置 `JAVA_PDF_PORT`、`CHROMIUM_PATH`、`SIGNING_DB_PATH`。请从仓库根目录启动，以便默认数据库落在 `java-backend/data/editor_pdf.sqlite`。

数据库在首次启动时从 `resources/templates/` 和 `resources/catalog/` 初始化，不读取原仓库数据库。正常关闭时停止 HTTP 工作线程并关闭 SQLite。

运行 `mvn -f java-backend/pom.xml test` 检查协议、图片和持久化；启动后执行 `npm run test:pdf`、`npm run test:demo-flow`、`npm run test:business-api` 检查实际 PDF 与签署流。接口、功能、环境要求和演示边界见根目录 README。
