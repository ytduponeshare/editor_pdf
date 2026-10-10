package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.TextNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

final class PageFurniture {
    private static final Set<String> SLOT_ATTRIBUTES = Set.of("class", "style", "src", "alt", "colspan", "rowspan", "colwidth");
    private static final Pattern COUNTERS = Pattern.compile("\\{(page|pages)\\}");

    static ObjectNode validate(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            var result = Json.MAPPER.createObjectNode();
            var section = result.putArray("sections").addObject();
            section.put("id", "default").put("name", "第 1 节").put("differentFirstPage", false).put("differentOddEven", false)
                .put("headerEnabled", false).put("footerEnabled", false).put("headerHeightMm", 12).put("footerHeightMm", 12);
            for (String kind : new String[]{"header", "footer"}) section.putObject(kind).put("default", "").put("first", "").put("even", "");
            return result;
        }
        Json.require(value.isObject() && value.path("sections").isArray() && value.path("sections").size() > 0 && value.path("sections").size() <= 100, "分节配置无效");
        var result = (ObjectNode) value.deepCopy();
        var ids = new HashSet<String>();
        int total = 0;
        for (JsonNode item : result.path("sections")) {
            Json.require(item.isObject(), "分节配置无效");
            var section = (ObjectNode) item;
            String id = Json.text(section, "id"), name = Json.text(section, "name").trim();
            Json.require(id.matches("[A-Za-z0-9_-]{1,80}") && ids.add(id) && !name.isEmpty() && name.length() <= 50, "节标识或名称无效");
            for (String key : new String[]{"differentFirstPage", "differentOddEven", "headerEnabled", "footerEnabled"}) Json.require(section.path(key).isBoolean(), "页眉页脚开关无效");
            for (String kind : new String[]{"header", "footer"}) {
                var height = section.path(kind + "HeightMm");
                Json.require(height.isNumber() && Double.isFinite(height.asDouble()) && height.asDouble() >= 5 && height.asDouble() <= 40, "页眉页脚高度必须在 5～40mm 之间");
                Json.require(section.path(kind).isObject(), "页眉页脚内容无效");
                for (String variant : new String[]{"default", "first", "even"}) {
                    var slot = section.path(kind).path(variant);
                    Json.require(slot.isTextual() && slot.asText().length() <= 1_000_000, "页眉页脚内容过大或无效");
                    String html = slot.asText();
                    total += html.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                    Document original = Jsoup.parse(html);
                    Json.require(original.select("section,div,script,iframe,object,embed,style,link,meta").isEmpty(), "页眉页脚包含不支持的内容");
                    for (Element element : original.body().getAllElements()) for (var attribute : element.attributes()) Json.require(SLOT_ATTRIBUTES.contains(attribute.getKey()), "页眉页脚属性不受支持");
                    if (!html.isBlank()) {
                        Document clean = Jsoup.parse(HtmlSanitizer.sanitize(html));
                        clean.outputSettings().prettyPrint(false);
                        html = clean.body().html();
                    }
                    ((ObjectNode) section.path(kind)).put(variant, html.isBlank() ? "" : html);
                }
            }
        }
        Json.require(total <= HtmlSanitizer.MAX_HTML_BYTES, "页眉页脚内容不能超过 5MB");
        return result;
    }

    static void decorate(Document document, JsonNode furniture, JsonNode margins) {
        var pages = document.select("section[data-contract-page]");
        var seen = new HashSet<String>();
        for (int index = 0; index < pages.size(); index++) {
            Element page = pages.get(index);
            String id = page.hasAttr("data-section-id") ? page.attr("data-section-id") : "default";
            JsonNode section = null;
            for (JsonNode candidate : furniture.path("sections")) if (Json.text(candidate, "id").equals(id)) { section = candidate; break; }
            Json.require(section != null, "页面引用的节不存在");
            boolean first = seen.add(id), even = (index + 1) % 2 == 0;
            String selected = first && section.path("differentFirstPage").asBoolean() ? "first" : even && section.path("differentOddEven").asBoolean() ? "even" : "default";
            page.attr("data-section-id", id).attr("data-different-first", section.path("differentFirstPage").asText()).attr("data-different-even", section.path("differentOddEven").asText());
            double header = section.path("headerEnabled").asBoolean() ? section.path("headerHeightMm").asDouble() : 0;
            double footer = section.path("footerEnabled").asBoolean() ? section.path("footerHeightMm").asDouble() : 0;
            page.attr("data-header-height", String.valueOf(header)).attr("data-footer-height", String.valueOf(footer));
            page.attr("style", page.attr("style") + ";padding-top:" + (margins.path("top").asDouble() + (header > 0 ? header + 3 : 0)) + "mm;padding-bottom:" + (margins.path("bottom").asDouble() + (footer > 0 ? footer + 3 : 0)) + "mm");
            for (String kind : new String[]{"header", "footer"}) {
                if (!section.path(kind + "Enabled").asBoolean()) continue;
                for (String variant : new String[]{"default", "first", "even"}) {
                    Element region = page.appendElement("div").attr("class", "page-furniture page-furniture--" + kind).attr("data-page-furniture", kind).attr("data-furniture-variant", variant);
                    region.attr("style", "position:absolute;left:" + margins.path("left").asText() + "mm;right:" + margins.path("right").asText() + "mm;" + (kind.equals("header") ? "top:" + margins.path("top").asText() : "bottom:" + margins.path("bottom").asText()) + "mm;height:" + section.path(kind + "HeightMm").asText() + "mm;display:" + (selected.equals(variant) ? "block" : "none"));
                    region.html(Json.text(section.path(kind), variant));
                    var nodes = new ArrayList<TextNode>();
                    for (Element element : region.getAllElements()) nodes.addAll(element.textNodes());
                    for (TextNode node : nodes) {
                        String text = node.getWholeText(); var matcher = COUNTERS.matcher(text); int last = 0;
                        while (matcher.find()) {
                            node.before(new TextNode(text.substring(last, matcher.start())));
                            node.before(new Element("span").attr("data-page-counter", matcher.group(1)).text(String.valueOf(matcher.group(1).equals("page") ? index + 1 : pages.size())));
                            last = matcher.end();
                        }
                        if (last > 0) { node.before(new TextNode(text.substring(last))); node.remove(); }
                    }
                }
            }
        }
    }
}
