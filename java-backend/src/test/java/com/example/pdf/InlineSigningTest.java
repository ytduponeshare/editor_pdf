package com.example.pdf;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class InlineSigningTest {
    private ObjectNode template() throws Exception {
        var source = (ObjectNode) Json.resource("/templates/template-demo-html-001.json").path("template").deepCopy();
        var doc = Jsoup.parse(Json.text(source, "html"));
        var overlay = doc.selectFirst("[data-contract-overlay]");
        assertNotNull(overlay);
        overlay.remove();
        overlay.tagName("span").attr("data-position-mode", "inline").attr("data-x", "-10").attr("data-y", "12");
        var paragraph = doc.selectFirst("section[data-contract-page]").appendElement("p").text("签署位置：");
        paragraph.appendChild(overlay).appendText("后续正文");
        source.put("html", doc.body().html());
        return source;
    }

    @Test void acceptsRelativeOffsetsAndRendersZeroSizeAnchor() throws Exception {
        var parsed = HtmlTemplate.parse(template());
        var doc = Jsoup.parse(HtmlTemplate.render(parsed, Json.object()));
        var anchor = doc.selectFirst(".pdf-floating-anchor");
        assertNotNull(anchor);
        assertEquals("p", anchor.parent().normalName());
        assertTrue(anchor.attr("style").contains("--field-x:-10"));
        assertNotNull(anchor.selectFirst(".pdf-floating-box > .pdf-field-placeholder"));
        assertTrue(anchor.parent().text().endsWith("后续正文"));
        assertTrue(doc.selectFirst("style").data().contains("width: 0; height: 0"));
    }

    @Test void rejectsInvalidInlineCoordinatesAndPlacement() throws Exception {
        var source = template();
        source.put("html", Json.text(source, "html").replace("data-x=\"-10\"", "data-x=\"NaN\""));
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(source));
        var misplaced = template();
        var doc = Jsoup.parse(Json.text(misplaced, "html"));
        var anchor = doc.selectFirst("[data-position-mode=inline]");
        anchor.remove();
        doc.selectFirst("section[data-contract-page]").appendChild(anchor);
        misplaced.put("html", doc.body().html());
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(misplaced));
    }
}
