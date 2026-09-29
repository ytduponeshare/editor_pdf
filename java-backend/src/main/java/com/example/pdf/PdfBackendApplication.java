package com.example.pdf;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.Executors;

public final class PdfBackendApplication {
    private PdfBackendApplication() {}
    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("JAVA_PDF_PORT", "3202"));
        var store = new ContractStore(Path.of(System.getenv().getOrDefault("SIGNING_DB_PATH", "java-backend/data/editor_pdf.sqlite")));
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        var workers = Executors.newFixedThreadPool(4); server.setExecutor(workers);
        server.createContext("/api/health", e -> { try { BusinessHandler.method(e, "GET"); BusinessHandler.json(e, 200, Json.object().put("ok", true)); } catch (ContractService.ApiError error) { BusinessHandler.json(e, error.status, Json.object().put("message", error.getMessage())); } });
        server.createContext("/api/pdf/health", e -> BusinessHandler.json(e, 200, Json.object().put("ok", true)));
        server.createContext("/api/pdf/html", PdfBackendApplication::htmlPdf);
        var catalog = new CatalogHandler(store);
        server.createContext("/api/system-fields", catalog); server.createContext("/api/field-tables/sources", catalog);
        var business = new BusinessHandler(store);
        server.createContext("/api/demo", business); server.createContext("/api/signing", business); server.createContext("/api/pdf/template", business);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(1); workers.shutdownNow(); try { store.close(); } catch (Exception ignored) {}
        }));
        server.start(); System.out.printf("editor_pdf Java backend listening on http://127.0.0.1:%d%n", port);
    }
    private static void htmlPdf(HttpExchange exchange) throws IOException {
        try {
            BusinessHandler.method(exchange, "POST");
            byte[] bytes = exchange.getRequestBody().readNBytes(HtmlSanitizer.MAX_HTML_BYTES + 1);
            ContractService.check(bytes.length <= HtmlSanitizer.MAX_HTML_BYTES, 413, "HTML must not exceed 5MB");
            String html = HtmlSanitizer.sanitize(new String(bytes, StandardCharsets.UTF_8));
            var result = ChromiumPdf.render(html); BusinessHandler.pdf(exchange, result.pdf(), result.pagination());
        } catch (ContractService.ApiError error) { BusinessHandler.json(exchange, error.status, Json.object().put("message", error.getMessage())); }
        catch (IllegalArgumentException error) { BusinessHandler.json(exchange, 400, Json.object().put("message", "Unsafe or unsupported HTML")); }
        catch (Exception error) { error.printStackTrace(); BusinessHandler.json(exchange, 500, Json.object().put("message", "HTML PDF export failed")); }
    }
}
