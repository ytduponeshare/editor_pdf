package com.example.pdf;

import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

final class WordImageTest {
    @Test void preservesEmbeddedWordImagesAcrossTemplateSaveAndPrint() throws Exception {
        var image = new BufferedImage(20, 10, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, 0xffcc3333);
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        String source = "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray());
        var template = Json.resource("/templates/template-demo-html-001.json").path("template").deepCopy();
        var object = (com.fasterxml.jackson.databind.node.ObjectNode) template;
        object.put("html", Json.text(template, "html").replace("</section>", "<p><img class=\"contract-document-image\" src=\"" + source + "\" alt=\"Word 图片\"></p></section>"));
        var parsed = HtmlTemplate.parse(object);
        assertTrue(Json.text(parsed, "html").contains(source));
        assertTrue(HtmlTemplate.render(parsed, Json.MAPPER.createObjectNode()).contains(source));
        for (String invalid : new String[]{"https://example.com/image.png", "data:image/png;base64,aGVsbG8="}) {
            object.put("html", Json.text(parsed, "html").replace(source, invalid));
            assertThrows(IllegalArgumentException.class, () -> HtmlTemplate.parse(object));
        }
    }
}
