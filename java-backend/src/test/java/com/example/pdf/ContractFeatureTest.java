package com.example.pdf;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.jsoup.Jsoup;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

final class ContractFeatureTest {
    @TempDir Path directory;
    private ObjectNode template() throws Exception { return (ObjectNode) Json.resource("/templates/template-demo-html-001.json").path("template").deepCopy(); }
    @Test void preservesHtmlMetadataAndRejectsDuplicateFieldReferences() throws Exception {
        var source = template(); var parsed = HtmlTemplate.parse(source);
        assertEquals(source.path("fields"), parsed.path("fields")); assertEquals(source.path("fieldTables"), parsed.path("fieldTables"));
        source.put("html", Json.text(source, "html").replace("ref-name-party-b", "ref-name-party-a"));
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(source));
    }
    @Test void rejectsInvalidBindingsAndUnknownTableColumns() throws Exception {
        var source = template(); ((ObjectNode) source.path("fields").get(0).path("binding")).put("type", "signatureImage");
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(source));
        var unknown = template(); unknown.put("html", Json.text(unknown, "html").replace("data-bound-column=\"date\"", "data-bound-column=\"unknown\""));
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(unknown));
    }
    @Test void rejectsExecutableMarkupAndOutOfBoundsOverlays() throws Exception {
        var unsafe = template(); unsafe.put("html", Json.text(unsafe, "html") + "<script>alert(1)</script>");
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(unsafe));
        var outside = template(); outside.put("html", Json.text(outside, "html").replace("data-x=\"400\"", "data-x=\"700\""));
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(outside));
    }
    @Test void validatesSignatureInkAndSafeSvg() throws Exception {
        var image = new BufferedImage(120, 60, BufferedImage.TYPE_INT_ARGB); var bytes = new ByteArrayOutputStream(); ImageIO.write(image, "png", bytes);
        assertFalse(ImageData.valid("data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray()), true));
        image.setRGB(10, 10, 0xff112233); bytes.reset(); ImageIO.write(image, "png", bytes);
        assertTrue(ImageData.valid("data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray()), true));
        assertTrue(ImageData.valid(ContractService.SEAL, false));
        for (String malicious : new String[]{"<svg><script>1</script></svg>", "<svg><image href=\"file:///etc/passwd\"/></svg>", "<svg onload=\"alert(1)\"/>"})
            assertFalse(ImageData.valid("data:image/svg+xml;base64," + Base64.getEncoder().encodeToString(malicious.getBytes(java.nio.charset.StandardCharsets.UTF_8)), false));
    }
    @Test void snapshotsDoNotChangeWhenSourceRecordsChange() throws Exception {
        Path path = directory.resolve("snapshot.sqlite");
        try (var store = new ContractStore(path)) {
            var service = new ContractService(store); var source = HtmlTemplate.parse(template()); var snapshot = service.snapshot(source);
            assertEquals(6, snapshot.size());
            String original = snapshot.toString();
            try (var database = DriverManager.getConnection("jdbc:sqlite:" + path); var statement = database.createStatement()) {
                statement.executeUpdate("UPDATE catalog_records SET data='{" + "\"id\":\"vesting-001\",\"values\":{\"date\":\"2099-01-01\",\"quantity\":\"9999\"}}' WHERE source_id='vesting' AND id='vesting-001'");
            }
            assertEquals(original, snapshot.toString()); assertNotEquals(original, service.snapshot(source).toString());
        }
    }
    @Test void storesPdfAndRejectsStaleContractUpdatesAfterRestart() throws Exception {
        Path path = directory.resolve("contract.sqlite");
        var view = Json.object().put("contractId", "test").put("status", "pending").put("currentRoleIndex", 0).put("updatedAt", "2026-09-29");
        try (var store = new ContractStore(path)) { store.insertContract(view, new byte[]{1, 2}); }
        try (var store = new ContractStore(path)) {
            assertArrayEquals(new byte[]{1, 2}, store.contract("test").pdf());
            var updated = view.deepCopy().put("currentRoleIndex", 1); assertTrue(store.updateContract(updated, new byte[]{3, 4}, 0));
            assertFalse(store.updateContract(updated, new byte[]{5, 6}, 0)); assertArrayEquals(new byte[]{3, 4}, store.contract("test").pdf());
        }
    }
    @Test void renderedDataUsesTextNodesAndKeepsWordWrapping() throws Exception {
        var source = HtmlTemplate.parse(template()); var signed = Json.object();
        signed.set("fields", Json.array().add(Json.object().put("fieldId", "name-party-a").put("value", "<script>李四</script>")));
        String html = HtmlTemplate.render(source, signed); var document = Jsoup.parse(html);
        assertEquals(0, document.select("script").size()); assertTrue(html.contains("&lt;script&gt;"));
        var field = document.select("[data-field-id=name-party-a]").first(); assertNotNull(field);
        assertTrue(field.attr("style").contains("display:inline")); assertTrue(field.attr("style").contains("overflow-wrap:anywhere"));
    }
    @Test void tableValuesFitTheirCellInsteadOfKeepingDesignControlWidth() throws Exception {
        var source = HtmlTemplate.parse(template()); var signed = Json.object();
        signed.set("tableValues", Json.array().add(Json.object().put("tableId", "vesting-table").put("rowId", "vesting-001").put("columnId", "date").put("value", "2026-01-15")));
        var doc = Jsoup.parse(HtmlTemplate.render(source, signed));
        var field = doc.select("[data-bound-column=date]").first(); assertNotNull(field);
        assertTrue(field.attr("style").contains("max-width:100%"));
    }
    @Test void rejectsInvalidSystemDateBeforeGeneratingPdf() throws Exception {
        try (var store = new ContractStore(directory.resolve("date.sqlite"))) {
            var source = template(); var binding = (ObjectNode) source.path("fields").get(0).path("binding"); binding.put("fieldId", "birthday").put("fieldName", "生日").put("inputType", "date");
            var body = Json.object(); body.set("template", source); body.set("signer", Json.object().put("name", "张三").put("roleId", "party-a"));
            body.set("values", Json.object().put("name-party-a", "2026-02-30")); body.set("signatures", Json.object()); body.set("seals", Json.object());
            var error = assertThrows(IllegalArgumentException.class, () -> new ContractService(store).create(body)); assertTrue(error.getMessage().contains("格式无效"));
            assertTrue(store.contracts().isEmpty());
        }
    }
    @Test void convertsLegacyAnchorsIntoFlowAreasWithoutLosingControls() throws Exception {
        var source = HtmlTemplate.parse(Json.resource("/templates/template-demo-html-anchor-dynamic-long-table-001.json").path("template"));
        var document = Jsoup.parse(Json.text(source, "html"));
        assertEquals(0, document.select("[data-contract-anchor], [data-anchor-id]").size());
        var area = document.selectFirst("[data-signing-area]"); assertNotNull(area);
        assertEquals(3, area.select("[data-contract-overlay]").size());
        assertEquals("section", area.parent().tagName());
        var signature = area.selectFirst("[data-field-id=dynamic-signature-party-a]"); assertNotNull(signature);
        assertEquals(20, Double.parseDouble(signature.attr("data-x")));
        assertEquals(30, Double.parseDouble(signature.attr("data-y")));
        var rendered = Jsoup.parse(HtmlTemplate.render(source, Json.object()));
        assertEquals(3, rendered.select(".pdf-signing-area .pdf-page-overlay").size());
    }
    @Test void rejectsSigningAreasThatCannotFitOnOnePage() throws Exception {
        var source = HtmlTemplate.parse(template());
        var document = Jsoup.parse(Json.text(source, "html"));
        document.selectFirst("[data-signing-area]").attr("data-min-height", "900");
        ((ObjectNode) source.path("pageSettings").path("marginsMm")).put("top", 40).put("bottom", 40);
        ((ObjectNode) source).put("html", document.body().html());
        assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(source));
    }
}
