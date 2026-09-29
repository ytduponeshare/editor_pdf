package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Comparator;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Java owns the Chromium process and speaks CDP directly; no Node service or driver. */
final class ChromiumPdf {
    private static final Semaphore SLOTS = new Semaphore(2);
    private static final String EXECUTABLE = System.getenv().getOrDefault("CHROMIUM_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    private static final String PAGINATION;
    static {
        try { PAGINATION = Json.resourceText("/pagination.js"); }
        catch (IOException error) { throw new ExceptionInInitializerError(error); }
    }
    record Result(byte[] pdf, JsonNode pagination) {}

    static Result render(String html) throws Exception {
        if (!SLOTS.tryAcquire(30, TimeUnit.SECONDS)) throw new IOException("PDF 服务繁忙");
        Path directory = Files.createTempDirectory("editor-pdf-");
        Process process = null;
        try {
            process = new ProcessBuilder(EXECUTABLE, "--headless", "--disable-gpu", "--disable-background-networking",
                "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
                "--user-data-dir=" + directory, "about:blank").redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            Path activePort = directory.resolve("DevToolsActivePort");
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            while (!Files.exists(activePort) && process.isAlive() && System.nanoTime() < deadline) Thread.sleep(50);
            if (!Files.exists(activePort)) throw new IOException("Chromium 启动失败");
            var lines = Files.readAllLines(activePort);
            try (var cdp = new Cdp(URI.create("ws://127.0.0.1:" + lines.get(0) + lines.get(1)))) {
                String target = cdp.call("Target.createTarget", Map.of("url", "about:blank"), null).path("targetId").asText();
                String session = cdp.call("Target.attachToTarget", Map.of("targetId", target, "flatten", true), null).path("sessionId").asText();
                cdp.call("Page.enable", Map.of(), session);
                cdp.call("Emulation.setEmulatedMedia", Map.of("media", "print"), session);
                String frame = cdp.call("Page.getFrameTree", Map.of(), session).path("frameTree").path("frame").path("id").asText();
                // Templates cannot access the network; only validated data images and inline styles render.
                html = html.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline';\">");
                cdp.call("Page.setDocumentContent", Map.of("frameId", frame, "html", html), session);
                cdp.evaluate("(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.complete ? Promise.resolve() : new Promise(r => {i.onload=r; i.onerror=r;}))); return true; })()", session);
                JsonNode report = cdp.evaluate(PAGINATION, session);
                if (!report.isObject()) throw new IOException("PDF 分页未返回校验结果");
                if (report.path("overflowViolations").asInt() != 0 || report.path("widthViolations").asInt() != 0 || report.path("lostTextRows").asInt() != 0)
                    throw new IOException("PDF 分页校验失败: " + report);
                JsonNode result = cdp.call("Page.printToPDF", Map.of("printBackground", true, "preferCSSPageSize", true,
                    "paperWidth", 8.2677, "paperHeight", 11.6929, "marginTop", 0, "marginRight", 0, "marginBottom", 0, "marginLeft", 0), session);
                return new Result(Base64.getDecoder().decode(result.path("data").asText()), report);
            }
        } finally {
            if (process != null) {
                process.destroy();
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly().waitFor(2, TimeUnit.SECONDS);
            }
            try (var paths = Files.walk(directory)) {
                paths.sorted(Comparator.reverseOrder()).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) {} });
            } finally { SLOTS.release(); }
        }
    }

    private static final class Cdp implements WebSocket.Listener, AutoCloseable {
        private final AtomicInteger sequence = new AtomicInteger();
        private final Map<Integer, CompletableFuture<JsonNode>> pending = new ConcurrentHashMap<>();
        private final StringBuilder incoming = new StringBuilder();
        private final HttpClient client = HttpClient.newHttpClient();
        private final WebSocket socket;
        Cdp(URI uri) { socket = client.newWebSocketBuilder().buildAsync(uri, this).join(); }
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public java.util.concurrent.CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            incoming.append(data);
            if (last) {
                JsonNode message = Json.parse(incoming.toString()); incoming.setLength(0);
                var result = pending.remove(message.path("id").asInt(-1));
                if (result != null) result.complete(message);
            }
            socket.request(1); return null;
        }
        @Override public void onError(WebSocket socket, Throwable error) { pending.values().forEach(future -> future.completeExceptionally(error)); }
        JsonNode call(String method, Map<String, ?> params, String session) throws Exception {
            int id = sequence.incrementAndGet();
            var message = Json.object().put("id", id).put("method", method);
            message.set("params", Json.MAPPER.valueToTree(params));
            if (session != null) message.put("sessionId", session);
            var future = new CompletableFuture<JsonNode>(); pending.put(id, future);
            try {
                socket.sendText(message.toString(), true).join();
                JsonNode response = future.get(30, TimeUnit.SECONDS);
                if (response.has("error")) throw new IOException(response.path("error").toString());
                return response.path("result");
            } finally { pending.remove(id); }
        }
        JsonNode evaluate(String expression, String session) throws Exception {
            JsonNode result = call("Runtime.evaluate", Map.of("expression", expression, "awaitPromise", true, "returnByValue", true), session);
            if (result.has("exceptionDetails")) throw new IOException("分页失败: " + result.path("exceptionDetails"));
            return result.path("result").path("value");
        }
        @Override public void close() { socket.abort(); }
    }
}
