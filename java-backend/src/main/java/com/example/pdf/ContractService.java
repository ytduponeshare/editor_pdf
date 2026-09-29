package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jsoup.Jsoup;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

final class ContractService {
    final ContractStore store;
    static final ArrayNode USERS = (ArrayNode) Json.parse("[{\"id\":\"user-zhang\",\"name\":\"张三\",\"title\":\"甲方经办人\"},{\"id\":\"user-li\",\"name\":\"李四\",\"title\":\"乙方员工\"}]");
    static final String SEAL = "data:image/svg+xml;base64," + java.util.Base64.getEncoder().encodeToString((
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"180\" height=\"180\"><circle cx=\"90\" cy=\"90\" r=\"78\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"8\"/><circle cx=\"90\" cy=\"90\" r=\"48\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"3\"/><text x=\"90\" y=\"85\" text-anchor=\"middle\" fill=\"#dc2626\" font-size=\"18\">演示企业</text><text x=\"90\" y=\"112\" text-anchor=\"middle\" fill=\"#dc2626\" font-size=\"16\">合同专用章</text></svg>").getBytes(java.nio.charset.StandardCharsets.UTF_8));
    private final JsonNode systemFields;
    ContractService(ContractStore store) throws Exception { this.store = store; systemFields = Json.resource("/catalog/system-fields.json").path("fields"); }
    static final class ApiError extends RuntimeException {
        final int status;
        ApiError(int status, String message) { super(message); this.status = status; }
    }
    static void check(boolean condition, int status, String message) { if (!condition) throw new ApiError(status, message); }
    static JsonNode user(String id) { for (JsonNode user : USERS) if (Json.text(user, "id").equals(id)) return user; return null; }
    ObjectNode templateSummary(JsonNode row) {
        var result = Json.object();
        for (String key : Set.of("id", "name", "status", "updatedAt")) result.set(key, row.path(key));
        result.put("format", "html").put("fieldCount", row.path("template").path("fields").size()); result.set("roles", row.path("template").path("roles")); return result;
    }
    ObjectNode saveTemplate(JsonNode body, String id) throws Exception {
        ObjectNode template = HtmlTemplate.parse(body.path("template")); String name = Json.text(body, "name").trim();
        Json.require(!name.isEmpty() && name.length() <= 80, "模板名称不能为空且不能超过 80 个字符");
        if (id == null) id = UUID.randomUUID().toString();
        var row = Json.object().put("id", id).put("name", name).put("status", "published").put("updatedAt", Instant.now().toString());
        row.set("template", template); store.saveTemplate(row); return templateSummary(row);
    }
    ArrayNode roles(JsonNode template) {
        Set<String> used = new HashSet<>();
        for (JsonNode field : template.path("fields")) if (field.has("roleId") && (Set.of("signature", "companySeal").contains(Json.text(field, "type")) || Json.text(field.path("binding"), "sourceId").equals("system"))) used.add(Json.text(field, "roleId"));
        var roles = Json.array();
        for (JsonNode role : template.path("roles")) if (used.contains(Json.text(role, "id"))) {
            boolean credential = false;
            for (JsonNode field : template.path("fields")) if (Json.text(field, "roleId").equals(Json.text(role, "id"))) {
                if (Set.of("signature", "companySeal").contains(Json.text(field, "type"))) credential = true;
                if (Json.text(field.path("binding"), "sourceId").equals("system")) validateSystem(field);
            }
            Json.require(credential, Json.text(role, "name") + "没有企业章或签名区"); roles.add(role);
        }
        Json.require(!roles.isEmpty(), "模板中没有可签署角色"); return roles;
    }
    private JsonNode validateSystem(JsonNode field) {
        JsonNode b = field.path("binding"), preset = null;
        for (JsonNode option : systemFields) if (Json.text(option, "id").equals(Json.text(b, "fieldId"))) preset = option;
        Json.require(preset != null && Json.text(field, "type").equals("text") && Json.text(b, "kind").equals("category")
            && Json.text(b, "type").equals(Json.text(preset, "type")) && Json.text(b, "fieldName").equals(Json.text(preset, "name"))
            && Json.text(b, "inputType").equals(Json.text(preset, "inputType")) && b.path("options").equals(preset.path("options")), "字段 " + Json.text(field, "name") + " 的系统绑定无效");
        return preset;
    }
    ArrayNode snapshot(JsonNode template) throws Exception {
        var cells = Json.array();
        Set<String> sources = new HashSet<>(); Json.resource("/catalog/sources.json").path("sources").forEach(s -> sources.add(Json.text(s, "id")));
        for (JsonNode descriptor : template.path("fieldTables")) {
            JsonNode c = descriptor.path("config"); String source = Json.text(c, "sourceId");
            Json.require(source.isEmpty() || sources.contains(source), "字段表格来源不存在");
            var records = source.isEmpty() ? new java.util.ArrayList<JsonNode>() : store.records(source);
            if (records.isEmpty()) for (int i = 1; i <= c.path("rows").asInt(); i++) records.add(Json.object().put("id", "row-" + i).set("values", Json.object()));
            for (JsonNode record : records) for (JsonNode col : c.path("columns")) {
                String kind = Json.text(col.path("binding"), "kind"); boolean editable = kind.equals("control") || kind.equals("system");
                var cell = Json.object().put("tableId", Json.text(descriptor, "tableId")).put("rowId", Json.text(record, "id")).put("columnId", Json.text(col, "id"))
                    .put("value", editable ? "" : Json.text(record.path("values"), Json.text(col.path("binding"), "fieldId"))).put("editable", editable);
                if (c.has("roleId")) cell.set("roleId", c.path("roleId")); if (c.has("roleName")) cell.set("roleName", c.path("roleName"));
                if (!source.isEmpty()) cell.put("sourceId", source); cells.add(cell);
            }
        }
        return cells;
    }
    ObjectNode issue(JsonNode body) throws Exception {
        ObjectNode row = store.template(Json.text(body, "templateId")); Json.require(row != null, "请选择有效模板");
        ObjectNode template = HtmlTemplate.parse(row.path("template")); ArrayNode roles = roles(template);
        JsonNode assignments = body.path("assignments"); Json.require(assignments.isArray(), "角色分配格式无效"); var assigned = new HashSet<String>();
        for (JsonNode assignment : assignments) {
            String roleId = Json.text(assignment, "roleId"); boolean known = false;
            for (JsonNode role : roles) if (Json.text(role, "id").equals(roleId)) known = true;
            Json.require(known && assigned.add(roleId) && user(Json.text(assignment, "userId")) != null, "角色分配无效或重复");
        }
        for (JsonNode role : roles) Json.require(assigned.contains(Json.text(role, "id")), "请为" + Json.text(role, "name") + "选择签署用户");
        var view = newContract(template, roles); view.set("tableValues", snapshot(template));
        var meta = Json.object().put("templateId", Json.text(row, "id")).put("templateName", Json.text(row, "name")); meta.set("assignments", assignments.deepCopy()); view.set("demo", meta);
        byte[] pdf = pdf(view); store.insertContract(view, pdf); return publicView(view);
    }
    private ObjectNode newContract(ObjectNode template, ArrayNode roles) {
        String id = UUID.randomUUID().toString(), now = Instant.now().toString();
        var view = Json.object().put("contractId", id).put("status", "pending").put("currentRoleIndex", 0).put("createdAt", now).put("updatedAt", now)
            .putNull("completedAt").put("pdfUrl", "/api/signing/contracts/" + id + "/pdf");
        view.set("template", template); view.set("roleOrder", roles); view.set("currentRole", roles.get(0));
        for (String key : Set.of("fields", "signatures", "seals", "signers", "tableValues")) view.set(key, Json.array()); return view;
    }
    ObjectNode create(JsonNode body) throws Exception {
        ObjectNode template = HtmlTemplate.parse(body.path("template")); ArrayNode roles = roles(template); var view = newContract(template, roles); view.set("tableValues", snapshot(template));
        applySignature(view, body, ""); store.insertContract(view, pdf(view)); return publicView(view);
    }
    ObjectNode sign(String id, JsonNode body, String userId) throws Exception {
        ContractStore.Contract stored = store.contract(id); check(stored != null, 404, "合同不存在"); ObjectNode view = stored.view();
        check(Json.text(view, "status").equals("pending"), 409, "合同已完成，不能重复签署");
        Json.require(!body.has("template"), "后续签署不能修改合同模板"); int expected = view.path("currentRoleIndex").asInt();
        applySignature(view, body, userId); byte[] pdf = pdf(view);
        check(store.updateContract(view, pdf, expected), 409, "合同状态已变化，请重新打开后再签署"); return publicView(view);
    }
    private void applySignature(ObjectNode view, JsonNode body, String userId) {
        JsonNode role = view.path("currentRole"), template = view.path("template"); String roleId = Json.text(role, "id");
        Json.require(Json.text(body.path("signer"), "roleId").equals(roleId), "当前应由" + Json.text(role, "name") + "签署");
        String signer = Json.text(body.path("signer"), "name").trim();
        if (view.has("demo")) {
            boolean allowed = false;
            for (JsonNode assignment : view.path("demo").path("assignments")) if (Json.text(assignment, "roleId").equals(roleId) && Json.text(assignment, "userId").equals(userId)) allowed = true;
            check(allowed && user(userId) != null, 403, "当前用户无权以该角色签署"); signer = Json.text(user(userId), "name");
        }
        Json.require(!signer.isBlank() && signer.length() <= 50, "签署人姓名不能为空且不能超过 50 个字符");
        Json.require(body.path("values").isObject() && body.path("signatures").isObject() && (!body.has("seals") || body.path("seals").isObject()), "签署数据格式无效");
        var tableIds = new HashSet<String>(); Jsoup.parse(Json.text(template, "html")).select("[data-bound-column]").forEach(e -> tableIds.add(e.attr("data-field-id")));
        var allowed = new HashMap<String, Set<String>>(); for (String key : Set.of("values", "signatures", "seals")) allowed.put(key, new HashSet<>());
        for (JsonNode field : template.path("fields")) {
            String id = Json.text(field, "id"), type = Json.text(field, "type"); if (!Json.text(field, "roleId").equals(roleId)) continue;
            if (type.equals("text") && Json.text(field.path("binding"), "sourceId").equals("system") && !tableIds.contains(id)) {
                allowed.get("values").add(id); JsonNode preset = validateSystem(field); String value = Json.text(body.path("values"), id).trim();
                validateValue(value, Json.text(preset, "inputType"), preset.path("options"), Json.text(field, "name"));
                var item = fieldItem(field, role).put("systemFieldId", Json.text(preset, "id")).put("systemFieldName", Json.text(preset, "name")).put("inputType", Json.text(preset, "inputType")).put("value", value);
                ((ArrayNode) view.path("fields")).add(item);
            } else if (type.equals("signature") || type.equals("companySeal")) {
                String key = type.equals("signature") ? "signatures" : "seals"; allowed.get(key).add(id); String url = Json.text(body.path(key), id);
                Json.require(ImageData.valid(url, type.equals("signature")), "请完成" + Json.text(field, "name")); ((ArrayNode) view.path(key)).add(fieldItem(field, role).put("dataUrl", url));
            }
        }
        for (String key : allowed.keySet()) body.path(key).fieldNames().forEachRemaining(id -> Json.require(allowed.get(key).contains(id), "签署数据包含未授权字段"));
        collectTables(view, body.path("tableValues"), roleId);
        String now = Instant.now().toString(); ((ArrayNode) view.path("signers")).add(Json.object().put("roleId", roleId).put("roleName", Json.text(role, "name")).put("signerName", signer).put("signedAt", now));
        int next = view.path("currentRoleIndex").asInt() + 1; boolean completed = next >= view.path("roleOrder").size();
        view.put("currentRoleIndex", next).put("status", completed ? "completed" : "pending").put("updatedAt", now);
        if (completed) { view.putNull("currentRole").put("completedAt", now); } else view.set("currentRole", view.path("roleOrder").get(next));
    }
    private static ObjectNode fieldItem(JsonNode field, JsonNode role) {
        return Json.object().put("fieldId", Json.text(field, "id")).put("fieldName", Json.text(field, "name")).put("roleId", Json.text(role, "id")).put("roleName", Json.text(role, "name"));
    }
    private static void validateValue(String value, String type, JsonNode options, String name) {
        Json.require(!value.isBlank() && value.length() <= 200, "请填写" + name);
        if (type.equals("date")) {
            try { Json.require(value.matches("\\d{4}-\\d{2}-\\d{2}") && LocalDate.parse(value).toString().equals(value), name + "格式无效"); }
            catch (java.time.DateTimeException error) { throw new IllegalArgumentException(name + "格式无效"); }
        }
        if (type.equals("select")) { boolean matched = false; for (JsonNode option : options) if (option.asText().equals(value)) matched = true; Json.require(matched, name + "选项无效"); }
        if (type.equals("number")) {
            try { Json.require(Double.isFinite(Double.parseDouble(value)), name + "格式无效"); }
            catch (NumberFormatException error) { throw new IllegalArgumentException(name + "格式无效"); }
        }
        if (type.equals("phone")) Json.require(value.matches("[0-9+\\-() ]{6,30}"), name + "格式无效");
    }
    private void collectTables(ObjectNode view, JsonNode raw, String roleId) {
        Json.require(raw.isMissingNode() || raw.isArray(), "字段表格数据格式无效"); var incoming = new HashMap<String, JsonNode>();
        for (JsonNode cell : raw) {
            Json.require(cell.isObject() && cell.path("tableId").isTextual() && cell.path("rowId").isTextual() && cell.path("columnId").isTextual(), "字段表格数据格式无效");
            Json.require(incoming.put(HtmlTemplate.cellKey(cell), cell.path("value")) == null, "字段表格数据重复");
        }
        var columns = new HashMap<String, JsonNode>();
        for (JsonNode table : view.path("template").path("fieldTables")) for (JsonNode col : table.path("config").path("columns")) columns.put(Json.text(table, "tableId") + ":" + Json.text(col, "id"), col);
        for (JsonNode cell : view.path("tableValues")) {
            String key = HtmlTemplate.cellKey(cell); JsonNode value = incoming.remove(key);
            boolean editable = cell.path("editable").asBoolean() && Json.text(cell, "roleId").equals(roleId);
            Json.require(value == null || editable, "不能修改字段表格预设数据或其他角色数据");
            if (editable) {
                String text = value == null ? Json.text(cell, "value") : value.isTextual() ? value.asText().trim() : "";
                JsonNode col = columns.get(Json.text(cell, "tableId") + ":" + Json.text(cell, "columnId")); Json.require(col != null, "字段表格列不存在");
                String type = Json.text(col.path("binding"), "kind").equals("system") ? Json.text(col.path("binding"), "inputType") : Json.text(col, "type");
                validateValue(text, type, col.path("binding").path("options"), "表格字段" + Json.text(col, "title")); ((ObjectNode) cell).put("value", text);
            }
        }
        Json.require(incoming.isEmpty(), "字段表格包含未授权单元格");
    }
    private static byte[] pdf(JsonNode view) throws Exception {
        try { return ChromiumPdf.render(HtmlTemplate.render(view.path("template"), view)).pdf(); }
        catch (Exception error) { error.printStackTrace(); throw new ApiError(500, "签后文件生成失败"); }
    }
    static ObjectNode publicView(ObjectNode data) { ObjectNode result = data.deepCopy(); result.remove("demo"); return result; }
    static ObjectNode summary(JsonNode view) {
        var result = Json.object();
        for (String key : Set.of("contractId", "status", "currentRole", "roleOrder", "signers", "createdAt", "updatedAt", "completedAt", "pdfUrl")) result.set(key, view.path(key));
        if (view.has("demo")) for (String key : Set.of("templateId", "templateName", "assignments")) result.set(key, view.path("demo").path(key)); return result;
    }
    ObjectNode signingView(String id, String userId) throws Exception {
        var stored = store.contract(id); check(stored != null && stored.view().has("demo"), 404, "合同不存在"); ObjectNode view = stored.view();
        authorizeView(view, userId); ObjectNode result = publicView(view); result.set("currentUser", user(userId)); String roleId = Json.text(view.path("currentRole"), "id");
        var ids = Json.array(); boolean signatures = false, seals = false;
        for (JsonNode field : view.path("template").path("fields")) if (Json.text(field, "roleId").equals(roleId)) {
            ids.add(Json.text(field, "id")); signatures |= Json.text(field, "type").equals("signature"); seals |= Json.text(field, "type").equals("companySeal");
        }
        var cells = Json.array(); for (JsonNode cell : view.path("tableValues")) if (cell.path("editable").asBoolean() && Json.text(cell, "roleId").equals(roleId)) {
            var key = Json.object(); for (String name : Set.of("tableId", "rowId", "columnId")) key.set(name, cell.path(name)); cells.add(key);
        }
        var permissions = Json.object(); permissions.set("fieldIds", ids); permissions.set("editableTableCells", cells); result.set("permissions", permissions);
        result.set("resourceHints", Json.object().put("loadSignatureLibrary", signatures).put("loadSealLibrary", seals)); return result;
    }
    static void authorizeView(JsonNode view, String userId) {
        boolean allowed = false; String roleId = Json.text(view.path("currentRole"), "id");
        if (Json.text(view, "status").equals("pending")) for (JsonNode assignment : view.path("demo").path("assignments")) if (Json.text(assignment, "roleId").equals(roleId) && Json.text(assignment, "userId").equals(userId)) allowed = true;
        check(allowed && user(userId) != null, 403, "当前未轮到该用户签署");
    }
}
