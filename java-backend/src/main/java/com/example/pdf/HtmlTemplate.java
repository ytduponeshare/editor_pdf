package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/** The HTML envelope and stable DOM protocol remain the template source of truth. */
final class HtmlTemplate {
    private static final Set<String> TYPES = Set.of("text", "number", "date", "phone", "signature", "companySeal");
    static ObjectNode parse(JsonNode value) {
        Json.require(value != null && value.isObject() && Json.text(value, "format").equals("html")
            && value.path("formatVersion").asInt() == 1 && value.path("html").isTextual(), "仅支持 HTML 模板包 v1");
        var template = (ObjectNode) value.deepCopy();
        template.set("pageFurniture", PageFurniture.validate(value.path("pageFurniture")));
        JsonNode settings = template.path("pageSettings"), margins = settings.path("marginsMm");
        Json.require(Json.text(settings, "size").equals("A4") && Json.text(settings, "orientation").equals("portrait")
            && Json.text(settings, "printStyleVersion").equals("contract-a4-v2"), "模板页面设置无效");
        for (String side : Set.of("top", "right", "bottom", "left")) number(margins.path(side), 5, 40, "页边距必须在 5～40mm 之间");
        Json.require(template.path("roles").isArray() && template.path("fields").isArray() && template.path("fieldTables").isArray(), "模板元数据格式无效");
        var roles = new HashSet<String>(); var names = new HashSet<String>();
        for (JsonNode role : template.path("roles")) {
            String id = Json.text(role, "id"), name = Json.text(role, "name").trim();
            Json.require(!id.isBlank() && !name.isBlank() && name.length() <= 50 && roles.add(id) && names.add(name), "角色标识或名称无效、重复");
        }
        var fields = new HashMap<String, JsonNode>();
        for (JsonNode field : template.path("fields")) {
            String id = Json.text(field, "id"), name = Json.text(field, "name"), type = Json.text(field, "type");
            Json.require(!id.isBlank() && !name.isBlank() && name.length() <= 50 && TYPES.contains(type) && fields.put(id, field) == null, "模板字段无效或重复");
            Json.require(!field.has("roleId") || roles.contains(Json.text(field, "roleId")), "字段角色不存在");
            if (field.has("binding")) validateBinding(field.path("binding"), type);
        }
        String html = Json.text(template, "html");
        Json.require(html.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= HtmlSanitizer.MAX_HTML_BYTES, "HTML 模板不能超过 5MB");
        Document original = Jsoup.parse(html);
        Json.require(original.select("script,iframe,object,embed,link,style,meta").isEmpty(), "HTML 模板包含不支持的内容");
        Document doc = Jsoup.parse(HtmlSanitizer.sanitize(html));
        var pageIds = new HashSet<String>();
        Json.require(!doc.select("section[data-contract-page]").isEmpty(), "HTML 模板至少需要一页");
        for (Element page : doc.select("section[data-contract-page]")) {
            String sectionId = page.hasAttr("data-section-id") ? page.attr("data-section-id") : "default";
            boolean knownSection = false;
            for (JsonNode section : template.path("pageFurniture").path("sections")) if (Json.text(section, "id").equals(sectionId)) knownSection = true;
            Json.require(knownSection, "页面引用的节不存在");
            Json.require(!page.attr("data-page-id").isBlank() && pageIds.add(page.attr("data-page-id")), "页面 ID 缺失或重复");
        }
        var refs = new HashSet<String>(); var tableFieldIds = new HashSet<String>();
        for (Element ref : doc.select("[data-contract-field],[data-contract-overlay]")) {
            JsonNode field = fields.get(ref.attr("data-field-id"));
            Json.require(field != null && !ref.attr("data-ref-id").isBlank() && refs.add(ref.attr("data-ref-id")), "HTML 字段引用不存在、缺失或重复");
            Json.require(ref.attr("data-field-type").equals(Json.text(field, "type")) && ref.closest("section[data-contract-page]") != null, "字段引用类型或位置无效");
            boolean overlay = ref.hasAttr("data-contract-overlay");
            double width = number(ref.attr("data-width"), Json.text(field, "type").equals("signature") ? 80 : 60, overlay ? 794 : 400, "字段宽度无效");
            if (overlay) {
                Json.require(Set.of("signature", "companySeal").contains(Json.text(field, "type")), "只有签名和企业章可以作为浮层");
                double height = number(ref.attr("data-height"), Json.text(field, "type").equals("signature") ? 40 : 60, 1123, "字段高度无效");
                String mode = ref.attr("data-position-mode");
                Json.require(Set.of("", "page", "anchor", "inline").contains(mode), "浮层定位方式无效");
                boolean inline = mode.equals("inline");
                Json.require(!inline || (ref.normalName().equals("span") && ref.closest("p,h1,h2,h3") != null), "行内签署锚点必须位于正文段落中");
                double x = number(ref.attr("data-x"), inline ? -794 : 0, 794, "浮层位置无效"), y = number(ref.attr("data-y"), inline ? -1123 : 0, 1123, "浮层位置无效");
                Json.require((inline ? width : x + width) <= (210 - margins.path("left").asDouble() - margins.path("right").asDouble()) * 96 / 25.4 + 1
                    && (inline ? height : y + height) <= (296 - margins.path("top").asDouble() - margins.path("bottom").asDouble()) * 96 / 25.4 + 1, "浮层超出页面安全区域");
                if (ref.attr("data-position-mode").equals("anchor")) {
                    Element anchor = find(doc, "[data-contract-anchor]", "data-anchor-id", ref.attr("data-anchor-id"));
                    Json.require(anchor != null && number(ref.attr("data-anchor-offset-y"), 0, 900, "锚点位置无效") + height <= Double.parseDouble(anchor.attr("data-reserved-height")), "浮层超出锚点预留区域");
                }
            }
            if (field.has("binding") && !field.has("roleId"))
                Json.require(ref.hasAttr("data-bound-column") && ref.closest("table[data-table-id]") != null, "未分配角色的绑定字段必须属于字段表格");
            if (ref.hasAttr("data-bound-column")) tableFieldIds.add(ref.attr("data-field-id"));
        }
        for (JsonNode field : template.path("fields"))
            Json.require(!field.has("binding") || field.has("roleId") || tableFieldIds.contains(Json.text(field, "id")), "未分配角色的绑定字段必须属于字段表格");
        var tables = new HashSet<String>();
        for (JsonNode descriptor : template.path("fieldTables")) {
            String id = Json.text(descriptor, "tableId"); JsonNode config = descriptor.path("config");
            Json.require(!id.isBlank() && tables.add(id), "字段表格 ID 无效或重复");
            validateTableConfig(config);
            Json.require(!config.has("roleId") || roles.contains(Json.text(config, "roleId")), "字段表格角色不存在");
            var matches = doc.select("table[data-table-id]").stream().filter(t -> t.attr("data-table-id").equals(id)).toList();
            Json.require(matches.size() == 1 && matches.get(0).select("tr").size() > 1, "字段表格缺失或重复");
            var columns = new HashSet<String>(); config.path("columns").forEach(c -> columns.add(Json.text(c, "id")));
            for (Element ref : matches.get(0).select("[data-bound-column]")) Json.require(columns.contains(ref.attr("data-bound-column")), "字段表格包含未知绑定列");
        }
        normalizeSigningAreas(doc, margins);
        var areaIds = new HashSet<String>();
        for (Element area : doc.select("[data-signing-area]")) {
            Json.require(area.parent().hasAttr("data-contract-page") && !area.attr("data-area-id").isBlank() && areaIds.add(area.attr("data-area-id")), "签署区域位置或 ID 无效");
            Json.require(area.children().stream().allMatch(child -> child.hasAttr("data-contract-overlay")), "签署区域只能包含签名和印章");
            double height = signingAreaHeight(area);
            Json.require(height <= (296 - margins.path("top").asDouble() - margins.path("bottom").asDouble()) * 96 / 25.4 - 16, "签署区域高度超出单页，请减小控件尺寸或分开布局");
        }
        doc.outputSettings().prettyPrint(false);
        template.put("html", doc.body().html());
        return template;
    }
    private static double signingAreaHeight(Element area) {
        double height = number(area.hasAttr("data-min-height") ? area.attr("data-min-height") : "40", 40, 900, "签署区域高度无效");
        for (Element field : area.children()) height = Math.max(height, Double.parseDouble(field.attr("data-y")) + Double.parseDouble(field.attr("data-height")) + 12);
        return height;
    }
    private static void normalizeSigningAreas(Document doc, JsonNode margins) {
        double safeWidth = (210 - margins.path("left").asDouble() - margins.path("right").asDouble()) * 96 / 25.4;
        for (Element anchor : doc.select("[data-contract-anchor]")) {
            var area = new Element("div").attr("data-signing-area", "true").attr("data-area-id", anchor.attr("data-anchor-id"))
                .attr("data-min-height", anchor.attr("data-reserved-height"));
            String anchorId = anchor.attr("data-anchor-id");
            for (Element field : doc.select("[data-contract-overlay][data-position-mode=anchor]")) {
                if (!field.attr("data-anchor-id").equals(anchorId)) continue;
                double width = Double.parseDouble(field.attr("data-width"));
                String align = field.attr("data-anchor-align");
                double baseX = align.equals("center") ? (safeWidth - width) / 2 : align.equals("right") ? safeWidth - width : 0;
                field.attr("data-x", String.valueOf(Math.round(baseX + Double.parseDouble(field.attr("data-anchor-offset-x")))))
                    .attr("data-y", field.attr("data-anchor-offset-y"));
                clearAnchor(field); area.appendChild(field);
            }
            anchor.replaceWith(area);
        }
        for (Element page : doc.select("section[data-contract-page]")) {
            var fields = page.children().stream().filter(child -> child.hasAttr("data-contract-overlay")).toList();
            if (fields.isEmpty()) continue;
            var area = new Element("div").attr("data-signing-area", "true").attr("data-area-id", "area-" + java.util.UUID.randomUUID()).attr("data-min-height", "40");
            double firstY = fields.stream().mapToDouble(field -> Double.parseDouble(field.attr("data-y"))).min().orElse(0);
            for (Element field : fields) {
                double y = 12 + Double.parseDouble(field.attr("data-y")) - firstY;
                clearAnchor(field); field.attr("data-y", String.valueOf(y)); area.appendChild(field);
            }
            page.appendChild(area);
        }
    }
    private static void clearAnchor(Element field) {
        field.removeAttr("data-position-mode").removeAttr("data-anchor-id").removeAttr("data-anchor-align").removeAttr("data-anchor-offset-x").removeAttr("data-anchor-offset-y");
    }
    private static void validateBinding(JsonNode b, String type) {
        Json.require(b.isObject() && b.path("version").asInt() == 1, "字段绑定无效");
        for (String key : Set.of("sourceId", "fieldId", "sourceName", "fieldName")) Json.require(!Json.text(b, key).isBlank(), "字段绑定无效");
        String kind = Json.text(b, "kind");
        Json.require(kind.equals("category") ? !b.has("record") : kind.equals("record") && b.path("record").isIntegralNumber() && b.path("record").asInt() >= 1, "字段绑定无效");
        String expectedType = type.equals("signature") ? "signatureImage" : type.equals("companySeal") ? "sealImage" : type;
        Json.require(Json.text(b, "type").equals(expectedType), "字段绑定类型无效");
        if (Json.text(b, "sourceId").equals("system")) {
            Json.require(type.equals("text") && kind.equals("category"), "系统字段绑定无效"); validateInput(b);
        }
    }
    static void validateTableConfig(JsonNode c) {
        String mode = Json.text(c, "mode"), source = Json.text(c, "sourceId");
        Json.require(c.path("version").asInt() == 1 && Set.of("list", "category", "custom").contains(mode)
            && c.path("sourceId").isTextual() && (mode.equals("custom") || !source.isBlank()) && c.path("rows").isIntegralNumber()
            && c.path("rows").asInt() >= 1 && c.path("rows").asInt() <= 20 && (!mode.equals("list") || c.path("rows").asInt() == 1)
            && c.path("columns").isArray() && c.path("columns").size() >= 1 && c.path("columns").size() <= 12, "字段表格配置无效");
        var ids = new HashSet<String>();
        for (JsonNode col : c.path("columns")) {
            String title = Json.text(col, "title"), type = Json.text(col, "type"); JsonNode binding = col.path("binding"); String kind = Json.text(binding, "kind");
            Json.require(!Json.text(col, "id").isBlank() && ids.add(Json.text(col, "id")) && !title.isBlank() && title.length() <= 50 && Set.of("text", "number", "date", "phone").contains(type), "字段表格列无效");
            if (kind.equals("control")) Json.require(mode.equals("custom") && Json.text(binding, "type").equals(type), "表格控件绑定无效");
            else if (kind.equals("system")) { Json.require(type.equals("text"), "表格系统字段无效"); validateInput(binding); }
            else {
                Json.require(!Json.text(binding, "sourceId").isBlank() && !Json.text(binding, "fieldId").isBlank(), "表格绑定无效");
                Json.require(mode.equals("list") ? kind.equals("current") && Json.text(binding, "sourceId").equals(source)
                    : mode.equals("category") ? kind.equals("category") && Json.text(binding, "sourceId").equals(source)
                    : kind.equals("category") || kind.equals("record") && binding.path("record").isIntegralNumber() && binding.path("record").asInt() >= 1, "表格绑定模式无效");
            }
        }
    }
    private static void validateInput(JsonNode binding) {
        String type = Json.text(binding, "inputType"); Json.require(Set.of("text", "date", "select").contains(type), "系统输入类型无效");
        if (type.equals("select")) {
            Json.require(binding.path("options").isArray() && !binding.path("options").isEmpty(), "系统选项无效");
            binding.path("options").forEach(option -> Json.require(option.isTextual() && !option.asText().isBlank(), "系统选项无效"));
        } else Json.require(!binding.has("options"), "系统选项无效");
    }
    private static double number(JsonNode n, double min, double max, String message) { Json.require(n.isNumber(), message); return number(n.asText(), min, max, message); }
    private static double number(String n, double min, double max, String message) {
        try { double value = Double.parseDouble(n); Json.require(Double.isFinite(value) && value >= min && value <= max, message); return value; }
        catch (NumberFormatException error) { throw new IllegalArgumentException(message); }
    }
    private static Element find(Element root, String selector, String attribute, String value) {
        return root.select(selector).stream().filter(e -> e.attr(attribute).equals(value)).findFirst().orElse(null);
    }
    private static void style(Element element, String value) { element.attr("style", element.attr("style") + ";" + value); }
    static String render(JsonNode template, JsonNode signed) throws IOException {
        Document doc = Jsoup.parse(Json.text(template, "html"));
        normalizeSigningAreas(doc, template.path("pageSettings").path("marginsMm"));
        var fields = new HashMap<String, JsonNode>(); template.path("fields").forEach(f -> fields.put(Json.text(f, "id"), f));
        var values = new HashMap<String, String>(); signed.path("fields").forEach(f -> values.put(Json.text(f, "fieldId"), Json.text(f, "value")));
        var images = new HashMap<String, String>();
        for (String kind : Set.of("signatures", "seals")) for (JsonNode item : signed.path(kind)) {
            String url = Json.text(item, "dataUrl"); Json.require(ImageData.valid(url, kind.equals("signatures")), "图片数据无效"); images.put(Json.text(item, "fieldId"), url);
        }
        var cells = new HashMap<String, String>();
        signed.path("tableValues").forEach(cell -> cells.put(cellKey(cell), Json.text(cell, "value")));
        for (JsonNode descriptor : template.path("fieldTables")) {
            String tableId = Json.text(descriptor, "tableId"); Element table = find(doc, "table[data-table-id]", "data-table-id", tableId);
            if (table == null) continue;
            var rows = new java.util.ArrayList<>(table.select("tr")); if (rows.size() < 2) continue;
            Element prototype = rows.get(1).clone();
            var rowIds = new LinkedHashSet<String>();
            signed.path("tableValues").forEach(cell -> { if (Json.text(cell, "tableId").equals(tableId)) rowIds.add(Json.text(cell, "rowId")); });
            if (rowIds.isEmpty()) continue;
            rows.subList(1, rows.size()).forEach(Element::remove);
            Element body = table.selectFirst("tbody"); if (body == null) body = table.appendElement("tbody");
            for (String rowId : rowIds) {
                Element row = prototype.clone().attr("data-row-id", rowId);
                for (Element ref : row.select("[data-bound-column]")) ref.attr("data-field-id", tableId + ":" + rowId + ":" + ref.attr("data-bound-column"));
                body.appendChild(row);
            }
        }
        for (Element area : doc.select("[data-signing-area]")) {
            area.attr("class", "pdf-signing-area"); style(area, "height:" + signingAreaHeight(area) + "px");
        }
        for (Element page : doc.select("section[data-contract-page]")) page.attr("class", "pdf-page");
        for (Element anchor : doc.select("[data-contract-anchor]")) { anchor.attr("class", "pdf-layout-anchor"); style(anchor, "height:" + anchor.attr("data-reserved-height") + "px"); }
        for (Element ref : doc.select("[data-contract-field]")) {
            String id = ref.attr("data-field-id"), value = values.getOrDefault(id, "");
            if (ref.hasAttr("data-bound-column")) {
                Element table = ref.closest("table[data-table-id]"), row = ref.closest("tr[data-row-id]");
                if (table != null && row != null) value = cells.getOrDefault(table.attr("data-table-id") + ":" + row.attr("data-row-id") + ":" + ref.attr("data-bound-column"), "");
            }
            ref.attr("class", "pdf-inline-field" + (!value.isEmpty() ? " pdf-inline-field--signed" : ""));
            style(ref, ref.hasAttr("data-bound-column") ? "width:100%;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere" : !value.isEmpty() && ref.attr("data-field-type").equals("text") && !ref.hasAttr("data-bound-column")
                ? "display:inline;width:auto;white-space:pre-wrap;overflow-wrap:anywhere" : "width:" + ref.attr("data-width") + "px");
            ref.text(value.isEmpty() ? "\u00a0" : value);
            if (ref.hasAttr("data-bound-column") && !value.isEmpty()) {
                ref.empty().appendElement("span").attr("class", "pdf-inline-field__value").text(value);
            }
        }
        for (Element overlay : doc.select("[data-contract-overlay]")) {
            String id = overlay.attr("data-field-id"); JsonNode field = fields.get(id);
            boolean inline = overlay.attr("data-position-mode").equals("inline");
            overlay.attr("class", inline ? "pdf-floating-anchor" : "pdf-page-overlay").empty();
            style(overlay, "--field-width:" + overlay.attr("data-width") + "px;--field-height:" + overlay.attr("data-height") + "px;--field-x:" + overlay.attr("data-x") + "px;--field-y:" + overlay.attr("data-y") + "px");
            Element box = inline ? overlay.appendElement("span").attr("class", "pdf-floating-box") : overlay;
            if (images.containsKey(id)) box.appendElement("img").attr("class", Json.text(field, "type").equals("companySeal") ? "pdf-seal-image" : "pdf-signature-image").attr("src", images.get(id)).attr("alt", Json.text(field, "name"));
            else box.appendElement("span").attr("class", "pdf-field-placeholder").text(Json.text(field, "name"));
        }
        String css = Json.resourceText("/print.css"); JsonNode margins = template.path("pageSettings").path("marginsMm");
        for (String side : Set.of("top", "right", "bottom", "left")) css = css.replace("{{" + side + "}}", margins.path(side).asText());
        PageFurniture.decorate(doc, PageFurniture.validate(template.path("pageFurniture")), margins);
        doc.head().empty().appendElement("meta").attr("charset", "UTF-8"); doc.head().appendElement("style").text(css);
        doc.outputSettings().prettyPrint(false);
        return HtmlSanitizer.sanitize(doc.outerHtml());
    }
    static String cellKey(JsonNode cell) { return Json.text(cell, "tableId") + ":" + Json.text(cell, "rowId") + ":" + Json.text(cell, "columnId"); }
}
