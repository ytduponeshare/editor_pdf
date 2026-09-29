package com.example.pdf;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;

public final class PdfBackendApplication {
    private static final int PORT = Integer.parseInt(System.getenv().getOrDefault("JAVA_PDF_PORT", "3202"));
    private static final String CHROMIUM_PATH = System.getenv().getOrDefault(
        "CHROMIUM_PATH",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );

    private PdfBackendApplication() {
    }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
        server.createContext("/api/health", method("GET", exchange -> sendJson(exchange, 200, "{\"ok\":true}")));
        server.createContext("/api/pdf/html", method("POST", new HtmlPdfHandler()));
        CatalogHandler catalog = new CatalogHandler();
        server.createContext("/api/system-fields", method("GET", catalog));
        server.createContext("/api/field-tables/sources", method("GET", catalog));
        server.start();
        System.out.printf("Java PDF backend listening on http://127.0.0.1:%d%n", PORT);
    }

    private static HttpHandler method(String expectedMethod, HttpHandler handler) {
        return exchange -> {
            if (!expectedMethod.equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", expectedMethod);
                sendJson(exchange, 405, "{\"message\":\"Method Not Allowed\"}");
                return;
            }
            handler.handle(exchange);
        };
    }

    private static final class HtmlPdfHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            final String html;
            try {
                byte[] requestBody = readLimited(exchange.getRequestBody(), HtmlSanitizer.MAX_HTML_BYTES);
                html = HtmlSanitizer.sanitize(new String(requestBody, StandardCharsets.UTF_8));
            } catch (PayloadTooLargeException error) {
                sendJson(exchange, 413, "{\"message\":\"HTML must not exceed 5MB\"}");
                return;
            } catch (IllegalArgumentException error) {
                sendJson(exchange, 400, "{\"message\":\"Unsafe or unsupported HTML\"}");
                return;
            }

            Path workDirectory = Files.createTempDirectory("java-html-pdf-");
            Path htmlFile = workDirectory.resolve("template.html");
            Path pdfFile = workDirectory.resolve("template.pdf");
            Path profileDirectory = workDirectory.resolve("chrome-profile");
            Files.writeString(htmlFile, html, StandardCharsets.UTF_8);

            try {
                Process process = new ProcessBuilder(
                    CHROMIUM_PATH,
                    "--headless",
                    "--disable-gpu",
                    "--disable-background-networking",
                    "--no-first-run",
                    "--no-pdf-header-footer",
                    "--user-data-dir=" + profileDirectory,
                    "--print-to-pdf=" + pdfFile,
                    htmlFile.toUri().toString()
                )
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .start();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                long previousSize = -1;
                while (System.nanoTime() < deadline) {
                    if (Files.isRegularFile(pdfFile)) {
                        long currentSize = Files.size(pdfFile);
                        if (currentSize > 0 && currentSize == previousSize) break;
                        previousSize = currentSize;
                    }
                    if (!process.isAlive() && !Files.isRegularFile(pdfFile)) {
                        throw new IOException("Chromium PDF export failed with exit code " + process.exitValue());
                    }
                    Thread.sleep(200);
                }
                if (!Files.isRegularFile(pdfFile) || Files.size(pdfFile) == 0) {
                    process.destroyForcibly();
                    throw new IOException("Chromium PDF export timed out");
                }
                byte[] pdf = Files.readAllBytes(pdfFile);
                process.destroy();
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
                exchange.getResponseHeaders().set("Content-Type", "application/pdf");
                exchange.getResponseHeaders().set(
                    "Content-Disposition",
                    "attachment; filename=contract-template-java.pdf"
                );
                send(exchange, 200, pdf);
            } catch (Exception error) {
                error.printStackTrace();
                sendJson(exchange, 500, "{\"message\":\"HTML PDF export failed\"}");
            } finally {
                deleteRecursively(workDirectory);
            }
        }
    }

    private static byte[] readLimited(InputStream input, int maximumBytes) throws IOException {
        byte[] body = input.readNBytes(maximumBytes + 1);
        if (body.length > maximumBytes) throw new PayloadTooLargeException();
        return body;
    }

    private static final class PayloadTooLargeException extends IOException {
    }

    private static void deleteRecursively(Path path) {
        try (var paths = Files.walk(path)) {
            paths.sorted(Comparator.reverseOrder()).forEach(item -> {
                try {
                    Files.deleteIfExists(item);
                } catch (IOException ignored) {
                    // This flow sample does not fail a successful PDF response for temp cleanup.
                }
            });
        } catch (IOException ignored) {
            // Best-effort temporary directory cleanup.
        }
    }

    private static void sendJson(HttpExchange exchange, int status, String body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        send(exchange, status, body.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange exchange, int status, byte[] body) throws IOException {
        exchange.sendResponseHeaders(status, body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
