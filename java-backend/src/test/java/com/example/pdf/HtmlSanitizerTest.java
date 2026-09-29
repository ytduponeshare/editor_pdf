package com.example.pdf;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class HtmlSanitizerTest {
    @Test
    void preservesSupportedContractMarkupAndPrintCss() {
        String clean = HtmlSanitizer.sanitize("""
            <!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
            @page { size: A4 portrait; margin: 0; }
            .pdf-page { width: 210mm; height: 297mm; }
            </style></head><body>
            <section class="pdf-page" data-contract-page="true" data-page-id="page-1">
              <table><tbody><tr data-row-id="row-1"><td colspan="2"><p>合同正文</p></td></tr></tbody></table>
              <div data-contract-anchor="true" data-anchor-id="sign-area" data-anchor-name="签署区域" data-reserved-height="140"></div>
              <div class="pdf-page-overlay" data-position-mode="anchor" data-anchor-id="sign-area" data-anchor-align="left" data-anchor-offset-x="20" data-anchor-offset-y="16"></div>
            </section></body></html>
            """);

        assertTrue(clean.contains("data-page-id=\"page-1\""));
        assertTrue(clean.contains("colspan=\"2\""));
        assertTrue(clean.contains("@page"));
        assertTrue(clean.contains("data-contract-anchor="));
        assertTrue(clean.contains("data-position-mode="));
    }

    @Test
    void rejectsExecutableElementsAndEventHandlers() {
        assertThrows(IllegalArgumentException.class,
            () -> HtmlSanitizer.sanitize("<html><body><script>alert(1)</script></body></html>"));
        assertThrows(IllegalArgumentException.class,
            () -> HtmlSanitizer.sanitize("<html><body><p onclick=\"alert(1)\">x</p></body></html>"));
    }

    @Test
    void rejectsExternalResourcesAndDangerousCss() {
        assertThrows(IllegalArgumentException.class,
            () -> HtmlSanitizer.sanitize("<html><body><img src=\"https://example.com/a.png\"></body></html>"));
        assertThrows(IllegalArgumentException.class,
            () -> HtmlSanitizer.sanitize("<html><head><style>p{background:url(https://example.com/x)}</style></head><body><p>x</p></body></html>"));
    }

    @Test
    void removesCommentsFromAcceptedOutput() {
        String clean = HtmlSanitizer.sanitize("<html><body><!-- internal --><p>正文</p></body></html>");
        assertFalse(clean.contains("internal"));
    }

    @Test
    void rejectsDanglingOrMalformedAnchorConfiguration() {
        assertThrows(IllegalArgumentException.class, () -> HtmlSanitizer.sanitize("""
            <html><body><section data-contract-page="true" data-page-id="p1">
              <div data-position-mode="anchor" data-anchor-id="missing" data-anchor-align="left" data-anchor-offset-x="0" data-anchor-offset-y="0"></div>
            </section></body></html>
            """));
        assertThrows(IllegalArgumentException.class, () -> HtmlSanitizer.sanitize("""
            <html><body><section data-contract-page="true" data-page-id="p1">
              <div data-contract-anchor="true" data-anchor-id="bad id" data-anchor-name="签署区" data-reserved-height="140"></div>
            </section></body></html>
            """));
    }
}
