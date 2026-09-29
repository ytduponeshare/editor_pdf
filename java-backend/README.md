# Java HTML PDF 服务

独立实现方案二：受限 HTML → Java/Jsoup → Chromium → PDF。

在仓库根目录运行 `npm run dev:java`，或在本目录运行：

```bash
mvn compile exec:java
```

默认监听 `127.0.0.1:3202`。`JAVA_PDF_PORT` 可修改端口；`CHROMIUM_PATH` 可指定 Chrome/Chromium 可执行文件。

服务提供 HTML PDF 导出、健康检查及编辑器示例字段目录。PDF 接口为 `POST /api/pdf/html`，请求体是完整打印 HTML，响应为 PDF。Java 使用 Jsoup 验证标签、属性、布局锚点和 CSS，再启动 Chromium CLI；没有 JSON PDF 代理或 Node 渲染服务。

```bash
mvn test
bash smoke-test.sh
```

`smoke-test.sh` 默认请求 `http://127.0.0.1:3202`，可以通过 `JAVA_PDF_URL` 覆盖。验证输出位于 `target/smoke/`。

详细模板协议、字段目录接口和安全边界见仓库根目录的 README。
