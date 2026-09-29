import type { ContractTemplateSource, PdfExportResult } from '../editor/types';

interface PdfPreviewData {
  fields: Array<{ fieldId: string; value: string }>;
  signatures: Array<{ fieldId: string; dataUrl: string }>;
  seals: Array<{ fieldId: string; dataUrl: string }>;
  tableValues: Array<{ tableId: string; rowId: string; columnId: string; value: string }>;
}

export interface PdfExportService {
  exportTemplatePdf(template: ContractTemplateSource, signed: PdfPreviewData): Promise<PdfExportResult>;
  exportHtmlPdf(html: string): Promise<PdfExportResult>;
}

class HttpPdfExportService implements PdfExportService {
  private async request(path: string, body: BodyInit, contentType: string): Promise<PdfExportResult> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF 服务连接超时'
        : '无法连接 PDF 服务');
    } finally {
      window.clearTimeout(timeout);
    }
    const responseContentType = response.headers.get('Content-Type') || '';
    if (!response.ok || !responseContentType.includes('application/pdf')) {
      let message = 'PDF 导出失败';
      try {
        const error = await response.clone().json() as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // Keep the fallback message when the server did not return JSON.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'contract-template.pdf';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { ok: true, requestId: response.headers.get('X-Request-Id') || '' };
  }

  exportTemplatePdf(template: ContractTemplateSource, signed: PdfPreviewData): Promise<PdfExportResult> {
    return this.request('/api/pdf/template', JSON.stringify({ template, signed }), 'application/json');
  }

  exportHtmlPdf(html: string): Promise<PdfExportResult> {
    return this.request('/api/pdf/html', html, 'text/html; charset=utf-8');
  }
}

export const pdfExportService: PdfExportService = new HttpPdfExportService();
