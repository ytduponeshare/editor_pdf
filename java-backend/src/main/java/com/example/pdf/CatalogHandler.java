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

    private final ContractStore store;

    CatalogHandler(ContractStore store) throws IOException {
        this.store = store;
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
        if (!exchange.getRequestMethod().equals("GET")) {
            BusinessHandler.json(exchange, 405, Json.object().put("message", "Method Not Allowed")); return;
        }
        String path = exchange.getRequestURI().getPath();
        byte[] body = responses.get(path);
        if (body != null && path.endsWith("/records")) {
            try {
                var data = (com.fasterxml.jackson.databind.node.ObjectNode) Json.parse(new String(body, StandardCharsets.UTF_8));
                String source = path.split("/")[4];
                data.set("records", Json.MAPPER.valueToTree(store.records(source)));
                body = data.toString().getBytes(StandardCharsets.UTF_8);
            } catch (java.sql.SQLException error) { throw new IOException(error); }
        }
        int status = body == null ? 404 : 200;
        if (body == null) body = "{\"message\":\"字段来源不存在\"}".getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
