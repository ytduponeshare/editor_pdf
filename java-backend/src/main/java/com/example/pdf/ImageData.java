package com.example.pdf;

import org.jsoup.Jsoup;
import org.jsoup.parser.Parser;
import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Set;

final class ImageData {
    static boolean valid(String value, boolean signature) {
        try {
            if (value == null || value.length() > (signature ? 1_400_000 : 2_800_000)) return false;
            var match = java.util.regex.Pattern.compile("^data:(image/(?:png|jpeg|jpg|svg\\+xml));base64,([A-Za-z0-9+/=]+)$").matcher(value);
            if (!match.matches() || (signature && !match.group(1).equals("image/png"))) return false;
            byte[] bytes = Base64.getDecoder().decode(match.group(2));
            if (bytes.length == 0 || bytes.length > (signature ? 1_000_000 : 2_000_000)) return false;
            if (match.group(1).equals("image/svg+xml")) {
                String svg = new String(bytes, StandardCharsets.UTF_8);
                if (svg.contains("<!") || svg.contains("<?")) return false;
                var doc = Jsoup.parse(svg, "", Parser.xmlParser());
                var root = doc.children().first();
                if (root == null || !root.normalName().equals("svg")) return false;
                Set<String> tags = Set.of("svg", "g", "circle", "ellipse", "rect", "path", "line", "polyline", "polygon", "text", "tspan", "title");
                for (var element : doc.getAllElements()) {
                    if (!element.normalName().equals("#root") && !tags.contains(element.normalName())) return false;
                    for (var attr : element.attributes()) {
                        String key = attr.getKey().toLowerCase();
                        String content = attr.getValue().toLowerCase();
                        if (key.startsWith("on") || key.equals("href") || key.equals("src") || key.endsWith(":href")
                            || content.contains("url(") || content.contains("javascript:") || content.contains("@import") || content.contains("\\")) return false;
                    }
                }
                return true;
            }
            try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) return false;
                var reader = readers.next();
                try {
                    reader.setInput(input);
                    if (reader.getWidth(0) > 1600 || reader.getHeight(0) > 1200) return false;
                    var image = reader.read(0);
                    if (signature && !image.getColorModel().hasAlpha()) return false;
                    for (int y = 0; y < image.getHeight(); y++)
                        for (int x = 0; x < image.getWidth(); x++)
                            if ((image.getRGB(x, y) >>> 24) > 0) return true;
                    return false;
                } finally { reader.dispose(); }
            }
        } catch (Exception error) { return false; }
    }
}
