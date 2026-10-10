package com.example.pdf;

import org.junit.jupiter.api.Test;
import org.jsoup.Jsoup;
import com.fasterxml.jackson.databind.node.ObjectNode;
import static org.junit.jupiter.api.Assertions.*;

final class PageFurnitureTest {
    @Test void validatesSectionsAndRendersAllVariantsWithReservedSpace() throws Exception {
        var template = (ObjectNode) Json.resource("/templates/template-demo-html-001.json").path("template").deepCopy();
        var furniture = PageFurniture.validate(null);
        var section = (ObjectNode) furniture.path("sections").get(0);
        section.put("headerEnabled", true).put("footerEnabled", true).put("differentFirstPage", true).put("differentOddEven", true);
        ((ObjectNode) section.path("header")).put("default", "<p>普通页</p>").put("first", "<p>首页</p>").put("even", "<p>偶数页</p>");
        ((ObjectNode) section.path("footer")).put("default", "<p>第 {page} 页 / 共 {pages} 页</p>");
        template.set("pageFurniture", furniture);
        var parsed = HtmlTemplate.parse(template);
        var printed = Jsoup.parse(HtmlTemplate.render(parsed, Json.MAPPER.createObjectNode()));
        assertTrue(printed.selectFirst("section").attr("style").contains("padding-top:35.0mm"));
        assertEquals("首页", printed.selectFirst("[data-page-furniture=header][data-furniture-variant=first]").text());
        assertFalse(printed.select("[data-page-counter=pages]").isEmpty());
        assertFalse(Json.text(parsed, "html").contains("data-page-furniture"));
        section.put("headerHeightMm", 100); template.set("pageFurniture", furniture);
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(template));
    }

    @Test void rejectsUnknownSectionsAndUntrustedFurnitureMarkup() throws Exception {
        var template = (ObjectNode) Json.resource("/templates/template-demo-html-001.json").path("template").deepCopy();
        template.put("html", Json.text(template, "html").replace("data-page-id=", "data-section-id=\"unknown\" data-page-id="));
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(template));
        var furniture = PageFurniture.validate(null);
        var header = (ObjectNode) furniture.path("sections").get(0).path("header");
        for (String html : new String[]{"<script>1</script>", "<p onclick=\"alert(1)\">x</p>", "<img src=\"https://example.com/a.png\">", "<p data-contract-field=\"true\">x</p>"}) {
            header.put("default", html);
            assertThrows(IllegalArgumentException.class, () -> PageFurniture.validate(furniture));
        }
    }
}
