package com.example.pdf;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.DocumentType;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Safelist;

import java.util.Locale;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class HtmlSanitizer {
    static final int MAX_HTML_BYTES = 5 * 1024 * 1024;

    private static final Set<String> ALLOWED_TAGS = Set.of(
        "html", "head", "meta", "style", "body", "section", "p", "h1", "h2", "h3",
        "strong", "em", "u", "s", "ul", "ol", "li", "br", "span", "div", "table",
        "tbody", "thead", "tr", "th", "td", "colgroup", "col"
    );
    private static final Set<String> GLOBAL_ATTRIBUTES = Set.of(
        "class", "style", "data-contract-page", "data-page-id", "data-break-type",
        "data-table-id", "data-fragment-id", "data-continuation", "data-row-id",
        "data-repeated-header", "data-source-row-id", "data-contract-anchor",
        "data-anchor-id", "data-anchor-name", "data-reserved-height", "data-position-mode",
        "data-anchor-align", "data-anchor-offset-x", "data-anchor-offset-y"
    );
    private static final Set<String> TABLE_ATTRIBUTES = Set.of("colspan", "rowspan", "colwidth");
    private static final Pattern CSS_COMMENT = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);
    private static final Pattern ANCHOR_ID = Pattern.compile("^[A-Za-z0-9_-]{1,80}$");
    private static final Pattern CSS_AT_RULE = Pattern.compile("@([a-z-]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern UNSAFE_CSS = Pattern.compile(
        "(?:url\\s*\\(|expression\\s*\\(|image-set\\s*\\(|javascript\\s*:|vbscript\\s*:|data\\s*:|"
            + "-moz-binding|behavior\\s*:|<|\\\\)",
        Pattern.CASE_INSENSITIVE
    );

    private HtmlSanitizer() {
    }

    static String sanitize(String rawHtml) {
        if (rawHtml == null || rawHtml.isBlank()) {
            throw new IllegalArgumentException("HTML is required");
        }

        Document source = Jsoup.parse(rawHtml);
        validateStructure(source);

        StringBuilder css = new StringBuilder();
        for (Element style : source.head().select("style")) {
            String stylesheet = style.data();
            validateCss(stylesheet);
            if (!stylesheet.isBlank()) css.append(stylesheet).append('\n');
        }

        Safelist bodySafelist = new Safelist()
            .addTags("section", "p", "h1", "h2", "h3", "strong", "em", "u", "s", "ul", "ol",
                "li", "br", "span", "div", "table", "tbody", "thead", "tr", "th", "td", "colgroup", "col")
            .addAttributes(":all", GLOBAL_ATTRIBUTES.toArray(String[]::new))
            .addAttributes("th", TABLE_ATTRIBUTES.toArray(String[]::new))
            .addAttributes("td", TABLE_ATTRIBUTES.toArray(String[]::new))
            .addAttributes("col", "span", "style");

        Document.OutputSettings outputSettings = new Document.OutputSettings()
            .charset("UTF-8")
            .prettyPrint(false);
        String cleanBody = Jsoup.clean(source.body().html(), "", bodySafelist, outputSettings);

        Document clean = Document.createShell("");
        clean.outputSettings(outputSettings);
        clean.prependChild(new DocumentType("html", "", ""));
        clean.selectFirst("html").attr("lang", "zh-CN");
        clean.head().appendElement("meta").attr("charset", "UTF-8");
        if (!css.isEmpty()) clean.head().appendElement("style").text(css.toString());
        clean.body().html(cleanBody);
        return clean.outerHtml();
    }

    private static void validateStructure(Document document) {
        for (Element element : document.getAllElements()) {
            String tag = element.normalName();
            if (tag.equals("#root")) continue;
            if (!ALLOWED_TAGS.contains(tag)) {
                throw new IllegalArgumentException("Unsupported HTML element: " + tag);
            }
            for (Attribute attribute : element.attributes()) {
                String name = attribute.getKey().toLowerCase(Locale.ROOT);
                if (isAllowedAttribute(tag, name)) {
                    if (name.equals("style")) validateCss(attribute.getValue());
                    continue;
                }
                throw new IllegalArgumentException("Unsupported HTML attribute: " + name);
            }
        }
        Set<String> anchorIds = new HashSet<>();
        for (Element anchor : document.select("[data-contract-anchor]")) {
            String anchorId = anchor.attr("data-anchor-id");
            String anchorName = anchor.attr("data-anchor-name").trim();
            double reservedHeight = finiteNumber(anchor.attr("data-reserved-height"), "anchor height");
            if (!ANCHOR_ID.matcher(anchorId).matches() || !anchorIds.add(anchorId)) {
                throw new IllegalArgumentException("Invalid or duplicate anchor id");
            }
            if (anchorName.isEmpty() || anchorName.length() > 50 || reservedHeight < 40 || reservedHeight > 900) {
                throw new IllegalArgumentException("Invalid anchor configuration");
            }
        }
        for (Element overlay : document.select("[data-position-mode]")) {
            String mode = overlay.attr("data-position-mode");
            if (!mode.equals("page") && !mode.equals("anchor")) {
                throw new IllegalArgumentException("Invalid overlay position mode");
            }
            if (!mode.equals("anchor")) continue;
            String anchorId = overlay.attr("data-anchor-id");
            String align = overlay.attr("data-anchor-align");
            double offsetX = finiteNumber(overlay.attr("data-anchor-offset-x"), "anchor offset x");
            double offsetY = finiteNumber(overlay.attr("data-anchor-offset-y"), "anchor offset y");
            if (!anchorIds.contains(anchorId) || !Set.of("left", "center", "right").contains(align)
                || offsetX < -794 || offsetX > 794 || offsetY < 0 || offsetY > 900) {
                throw new IllegalArgumentException("Invalid anchored overlay configuration");
            }
        }
    }

    private static double finiteNumber(String value, String label) {
        try {
            double parsed = Double.parseDouble(value);
            if (!Double.isFinite(parsed)) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid " + label);
        }
    }

    private static boolean isAllowedAttribute(String tag, String name) {
        if (GLOBAL_ATTRIBUTES.contains(name)) return true;
        if ((tag.equals("th") || tag.equals("td")) && TABLE_ATTRIBUTES.contains(name)) return true;
        if (tag.equals("col") && (name.equals("span") || name.equals("style"))) return true;
        if (tag.equals("html") && name.equals("lang")) return true;
        return tag.equals("meta") && name.equals("charset");
    }

    private static void validateCss(String css) {
        String withoutComments = CSS_COMMENT.matcher(css).replaceAll("");
        if (UNSAFE_CSS.matcher(withoutComments).find()) {
            throw new IllegalArgumentException("HTML contains unsafe CSS");
        }
        Matcher atRule = CSS_AT_RULE.matcher(withoutComments);
        while (atRule.find()) {
            if (!atRule.group(1).equalsIgnoreCase("page")) {
                throw new IllegalArgumentException("Unsupported CSS at-rule: @" + atRule.group(1));
            }
        }
    }
}
