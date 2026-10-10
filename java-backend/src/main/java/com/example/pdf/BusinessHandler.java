package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

final class BusinessHandler implements HttpHandler {
    private final ContractService service;
    BusinessHandler(ContractStore store) throws Exception { service = new ContractService(store); }
    @Override public void handle(HttpExchange exchange) throws IOException {
        try { route(exchange); }
        catch (ContractService.ApiError error) { json(exchange, error.status, Json.object().put("message", error.getMessage())); }
        catch (IllegalArgumentException error) { json(exchange, 400, Json.object().put("message", error.getMessage())); }
        catch (Exception error) { error.printStackTrace(); json(exchange, 500, Json.object().put("message", "服务处理失败")); }
    }
    private void route(HttpExchange e) throws Exception {
        String path = e.getRequestURI().getPath(), method = e.getRequestMethod();
        List<String> parts = java.util.Arrays.stream(path.split("/")).filter(s -> !s.isEmpty()).toList();
        ContractStore store = service.store;
        if (path.equals("/api/demo/users")) { method(e, "GET"); json(e, 200, Json.object().set("users", ContractService.USERS)); return; }
        if (path.equals("/api/demo/templates")) {
            if (method.equals("POST")) { json(e, 201, service.saveTemplate(body(e), null)); return; }
            method(e, "GET"); var list = Json.array(); for (JsonNode row : store.templates()) list.add(service.templateSummary(row));
            json(e, 200, Json.object().set("templates", list)); return;
        }
        if (parts.size() == 4 && parts.get(2).equals("templates")) {
            String id = parts.get(3);
            if (method.equals("PUT")) { json(e, 200, service.saveTemplate(body(e), id)); return; }
            method(e, "GET"); ObjectNode row = store.template(id); ContractService.check(row != null, 404, "模板不存在");
            ObjectNode detail = service.templateSummary(row); detail.set("template", row.path("template")); json(e, 200, detail); return;
        }
        if (path.equals("/api/demo/contracts")) { method(e, "POST"); json(e, 201, service.issue(body(e))); return; }
        if (parts.size() == 5 && parts.get(1).equals("demo") && parts.get(2).equals("users")) {
            String userId = parts.get(3), action = parts.get(4); ContractService.check(ContractService.user(userId) != null, 404, "演示用户不存在");
            if (action.equals("contracts")) {
                method(e, "GET"); var list = Json.array();
                for (JsonNode view : store.contracts()) { boolean assigned = false; for (JsonNode a : view.path("demo").path("assignments")) if (Json.text(a, "userId").equals(userId)) assigned = true; if (assigned) list.add(ContractService.summary(view)); }
                json(e, 200, Json.object().set("contracts", list)); return;
            }
            if (action.equals("signatures")) {
                if (method.equals("POST")) {
                    String url = Json.text(body(e), "dataUrl"); Json.require(ImageData.valid(url, true), "签名数据无效");
                    var item = Json.object().put("id", UUID.randomUUID().toString()).put("name", "我的签名 " + java.time.LocalDate.now()).put("dataUrl", url).put("createdAt", Instant.now().toString());
                    store.saveSignature(userId, item); json(e, 201, Json.object().put("id", Json.text(item, "id"))); return;
                }
                method(e, "GET"); json(e, 200, Json.object().set("signatures", Json.MAPPER.valueToTree(store.signatures(userId)))); return;
            }
        }
        if (parts.size() == 5 && parts.get(1).equals("demo") && parts.get(2).equals("contracts")) {
            String id = parts.get(3), action = parts.get(4), userId = query(e, "userId"); method(e, "GET");
            if (action.equals("signing-view")) { json(e, 200, service.signingView(id, userId)); return; }
            if (action.equals("available-seals")) {
                var stored = store.contract(id); ContractService.check(stored != null && stored.view().has("demo"), 404, "合同不存在"); ContractService.authorizeView(stored.view(), userId);
                var seals = Json.array(); String roleId = Json.text(stored.view().path("currentRole"), "id");
                boolean hasSeal = false; for (JsonNode field : stored.view().path("template").path("fields")) if (Json.text(field, "roleId").equals(roleId) && Json.text(field, "type").equals("companySeal")) hasSeal = true;
                if (hasSeal) seals.add(Json.object().put("id", "seal-demo-company").put("name", "演示企业合同专用章").put("dataUrl", ContractService.SEAL));
                json(e, 200, Json.object().set("seals", seals)); return;
            }
        }
        if (parts.size() >= 3 && parts.get(1).equals("signing") && Set.of("contracts", "submissions").contains(parts.get(2))) {
            boolean submissions = parts.get(2).equals("submissions");
            if (parts.size() == 3) {
                if (method.equals("POST")) { json(e, 201, service.create(body(e))); return; }
                method(e, "GET"); var list = Json.array();
                for (JsonNode view : store.contracts()) {
                    if (!submissions) list.add(ContractService.summary(view));
                    else if (Json.text(view, "status").equals("completed")) list.add(submission(view));
                }
                json(e, 200, Json.object().set(submissions ? "files" : "contracts", list)); return;
            }
            String id = parts.get(3);
            if (parts.size() == 5 && parts.get(4).equals("sign")) { method(e, "POST"); json(e, 200, service.sign(id, body(e), e.getRequestHeaders().getFirst("X-Demo-User-Id"))); return; }
            var stored = store.contract(id); ContractService.check(stored != null, 404, "合同不存在"); method(e, "GET");
            if (parts.size() == 5 && parts.get(4).equals("pdf")) { pdf(e, stored.pdf(), null); return; }
            if (parts.size() == 4) {
                if (!submissions) json(e, 200, ContractService.publicView(stored.view()));
                else {
                    ObjectNode result = submission(stored.view()); result.set("fields", stored.view().path("fields")); result.put("signatureCount", stored.view().path("signatures").size()).put("sealCount", stored.view().path("seals").size());
                    if (stored.view().has("signingPositions")) {
                        result.set("signingPositions", stored.view().path("signingPositions"));
                        result.set("pdfPageCount", stored.view().path("pdfPageCount"));
                    }
                    var ids = Json.array(); stored.view().path("signatures").forEach(s -> ids.add(Json.text(s, "fieldId"))); result.set("signedFieldIds", ids); json(e, 200, result);
                }
                return;
            }
        }
        if (path.equals("/api/pdf/template") || path.equals("/api/pdf/template/render")) {
            method(e, "POST"); JsonNode body = body(e); ObjectNode template = HtmlTemplate.parse(body.path("template"));
            JsonNode signed = body.path("signed"); Json.require(signed.isObject(), "预览数据格式无效");
            // Preview is a render-only operation: it cannot change any contract state or stored PDF.
            var result = ChromiumPdf.render(HtmlTemplate.render(template, signed));
            if (path.endsWith("/render")) {
                var response = Json.object().put("pdfBase64", java.util.Base64.getEncoder().encodeToString(result.pdf()))
                    .put("pdfPageCount", result.pagination().path("finalPages").asInt());
                response.set("signingPositions", result.signingPositions());
                json(e, 200, response);
            } else pdf(e, result.pdf(), result.pagination());
            return;
        }
        throw new ContractService.ApiError(404, "接口不存在");
    }
    private static ObjectNode submission(JsonNode view) {
        JsonNode signer = view.path("signers").get(0); var result = Json.object().put("submissionId", Json.text(view, "contractId")).put("signerName", Json.text(signer, "signerName"))
            .put("submittedAt", Json.text(view, "updatedAt")).put("pdfUrl", "/api/signing/submissions/" + Json.text(view, "contractId") + "/pdf");
        result.set("role", signer == null ? Json.object() : Json.object().put("id", Json.text(signer, "roleId")).put("name", Json.text(signer, "roleName"))); return result;
    }
    private static String query(HttpExchange e, String key) {
        String query = e.getRequestURI().getRawQuery(); if (query == null) return "";
        for (String pair : query.split("&")) { String[] entry = pair.split("=", 2); if (URLDecoder.decode(entry[0], StandardCharsets.UTF_8).equals(key)) return entry.length == 2 ? URLDecoder.decode(entry[1], StandardCharsets.UTF_8) : ""; } return "";
    }
    static JsonNode body(HttpExchange e) throws IOException {
        byte[] bytes = e.getRequestBody().readNBytes(16 * 1024 * 1024 + 1); ContractService.check(bytes.length <= 16 * 1024 * 1024, 413, "请求不能超过 16MB");
        JsonNode body = Json.parse(new String(bytes, StandardCharsets.UTF_8)); Json.require(body != null && body.isObject(), "请求格式无效"); return body;
    }
    static void method(HttpExchange e, String expected) { if (!e.getRequestMethod().equals(expected)) { e.getResponseHeaders().set("Allow", expected); throw new ContractService.ApiError(405, "Method Not Allowed"); } }
    static void json(HttpExchange e, int status, JsonNode body) throws IOException { e.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8"); send(e, status, body.toString().getBytes(StandardCharsets.UTF_8)); }
    static void pdf(HttpExchange e, byte[] pdf, JsonNode report) throws IOException {
        e.getResponseHeaders().set("Content-Type", "application/pdf"); e.getResponseHeaders().set("Content-Disposition", "inline; filename=contract.pdf");
        if (report != null && report.isObject()) {
            e.getResponseHeaders().set("X-Pdf-Pages", report.path("finalPages").asText()); e.getResponseHeaders().set("X-Pdf-Split-Rows", report.path("splitRows").asText());
            e.getResponseHeaders().set("X-Pdf-Anchored-Overlays", report.path("anchoredOverlays").size() + "");
        }
        send(e, 200, pdf);
    }
    static void send(HttpExchange e, int status, byte[] body) throws IOException { e.sendResponseHeaders(status, body.length); try (var out = e.getResponseBody()) { out.write(body); } }
}
