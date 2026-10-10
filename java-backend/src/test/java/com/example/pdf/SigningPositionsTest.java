package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

/** Integration coverage uses the same real Chromium renderer as production. */
final class SigningPositionsTest {
    @TempDir Path directory;

    private ObjectNode template() throws Exception {
        return HtmlTemplate.parse(Json.resource("/templates/template-demo-html-001.json").path("template"));
    }

    @Test void measuresInlineBoxAfterOffsetClampingIncludingPaperMargins() throws Exception {
        var source = template();
        var doc = Jsoup.parse(Json.text(source, "html"));
        var control = doc.selectFirst("[data-contract-overlay]");
        assertNotNull(control);
        String id = control.attr("data-field-id");
        control.remove();
        control.tagName("span").attr("data-position-mode", "inline").attr("data-x", "-700").attr("data-y", "-900");
        doc.selectFirst("section[data-contract-page]").appendElement("p").text("签署：").appendChild(control);
        source.put("html", doc.body().html());
        var result = ChromiumPdf.render(HtmlTemplate.render(HtmlTemplate.parse(source), Json.object()));
        JsonNode position = null;
        for (JsonNode item : result.signingPositions()) if (id.equals(item.path("fieldId").asText())) position = item;
        assertNotNull(position);
        double marginPx = 20 * 96.0 / 25.4;
        assertEquals(marginPx, position.path("x").asDouble(), 1);
        assertEquals(marginPx, position.path("y").asDouble(), 1);
        assertEquals(Double.parseDouble(control.attr("data-width")), position.path("width").asDouble(), .1);
        assertEquals(Double.parseDouble(control.attr("data-height")), position.path("height").asDouble(), .1);
        assertEquals("px", position.path("unit").asText());
        assertEquals("top-left", position.path("origin").asText());
        assertEquals(1, position.path("pageNumber").asInt());
        assertTrue(new String(result.pdf(), 0, 5, java.nio.charset.StandardCharsets.US_ASCII).startsWith("%PDF-"));
    }

    @Test void dynamicTablePushesControlsAndPersistsCoordinatesWithPdfAcrossRestart() throws Exception {
        Path database = directory.resolve("positions.sqlite");
        ObjectNode issued;
        byte[] pdf;
        try (var store = new ContractStore(database)) {
            var request = Json.object().put("templateId", "template-demo-html-anchor-dynamic-long-table-001");
            request.set("assignments", Json.array()
                .add(Json.object().put("roleId", "party-a").put("userId", "user-zhang"))
                .add(Json.object().put("roleId", "party-b").put("userId", "user-li")));
            issued = new ContractService(store).issue(request);
            assertTrue(issued.path("pdfPageCount").asInt() > 1);
            assertEquals(3, issued.path("signingPositions").size());
            for (JsonNode position : issued.path("signingPositions")) {
                assertTrue(position.path("pageNumber").asInt() > 1);
                assertTrue(position.path("pageNumber").asInt() <= issued.path("pdfPageCount").asInt());
                assertTrue(position.path("x").asDouble() >= 0);
                assertTrue(position.path("y").asDouble() >= 0);
            }
            // Signing generates another PDF and must replace, rather than reuse, old coordinates.
            var saved = store.contract(Json.text(issued, "contractId"));
            saved.view().set("signingPositions", Json.array().add(Json.object().put("fieldId", "stale")));
            assertTrue(store.updateContract(saved.view(), saved.pdf(), 0));
            var image = new java.awt.image.BufferedImage(120, 60, java.awt.image.BufferedImage.TYPE_INT_ARGB);
            image.setRGB(10, 10, 0xff112233);
            var bytes = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(image, "png", bytes);
            var sign = Json.object();
            sign.set("signer", Json.object().put("roleId", "party-a").put("name", "张三"));
            sign.set("values", Json.object().put("dynamic-name-party-a", "张三"));
            sign.set("signatures", Json.object().put("dynamic-signature-party-a", "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray())));
            sign.set("seals", Json.object().put("dynamic-seal-party-a", ContractService.SEAL));
            issued = new ContractService(store).sign(Json.text(issued, "contractId"), sign, "user-zhang");
            assertEquals(3, issued.path("signingPositions").size());
            for (JsonNode position : issued.path("signingPositions")) assertNotEquals("stale", position.path("fieldId").asText());
            pdf = store.contract(Json.text(issued, "contractId")).pdf();
        }
        try (var store = new ContractStore(database)) {
            var saved = store.contract(Json.text(issued, "contractId"));
            assertEquals(issued.path("signingPositions"), saved.view().path("signingPositions"));
            assertArrayEquals(pdf, saved.pdf());
        }
    }

    @Test void renderApiReturnsMatchingPdfAndPositionsWithoutCreatingContract() throws Exception {
        try (var store = new ContractStore(directory.resolve("api.sqlite"))) {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/api/pdf/template", new BusinessHandler(store));
            server.start();
            try {
                var body = Json.object(); body.set("template", template()); body.set("signed", Json.object());
                var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api/pdf/template/render"))
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
                var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
                assertEquals(200, response.statusCode(), response.body());
                var data = Json.parse(response.body());
                assertEquals(3, data.path("signingPositions").size());
                assertTrue(data.path("pdfPageCount").asInt() > 0);
                assertTrue(Base64.getDecoder().decode(data.path("pdfBase64").asText()).length > 100);
                assertTrue(store.contracts().isEmpty());
            } finally { server.stop(0); }
        }
    }

    @Test void documentsWithoutSigningControlsReturnEmptyPositions() throws Exception {
        var source = template();
        var doc = Jsoup.parse(HtmlTemplate.render(source, Json.object()));
        doc.select("[data-contract-overlay]").remove();
        var result = ChromiumPdf.render(doc.outerHtml());
        assertTrue(result.signingPositions().isArray());
        assertEquals(0, result.signingPositions().size());
    }
}
