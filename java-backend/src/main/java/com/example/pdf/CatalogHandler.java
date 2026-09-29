package com.example.pdf;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Editor sample catalogs. Replace the resource data with business data at integration time. */
final class CatalogHandler implements HttpHandler {
    private final Map<String, byte[]> responses = new HashMap<>();

    CatalogHandler() throws IOException {
        load("/api/system-fields", "system-fields.json");
        load("/api/field-tables/sources", "sources.json");
        for (String source : new String[]{"long-contract-items", "vesting", "grants", "employee", "company"}) {
            load("/api/field-tables/sources/" + source + "/fields", source + "-fields.json");
            load("/api/field-tables/sources/" + source + "/records", source + "-records.json");
        }
    }

    private void load(String path, String resource) throws IOException {
        try (var input = CatalogHandler.class.getResourceAsStream("/catalog/" + resource)) {
            if (input == null) throw new IOException("Missing catalog resource: " + resource);
            responses.put(path, input.readAllBytes());
        }
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        byte[] body = responses.get(exchange.getRequestURI().getPath());
        int status = body == null ? 404 : 200;
        if (body == null) body = "{\"message\":\"字段来源不存在\"}".getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
