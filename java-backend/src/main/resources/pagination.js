(() => {
  globalThis.__name || (globalThis.__name = (target) => target);
  return (() => {
    const EPSILON = 1;
    const PRINT_BOTTOM_SAFETY_PX = 16;
    const MAX_RUNTIME_PAGES = 500;
    let pageSequence = 0;
    let rowSequence = 0;
    let tableFragments = 0;
    let splitRows = 0;
    const anchoredOverlays = [];
    const initialPages = document.querySelectorAll(".pdf-page").length;
    const runtimeStyle = document.createElement("style");
    runtimeStyle.textContent = `
      .pdf-page {
        height: 296mm !important;
        break-before: page !important;
        page-break-before: always !important;
        overflow: hidden !important;
      }
      .pdf-page:first-child {
        break-before: auto !important;
        page-break-before: auto !important;
      }
      .pdf-page table[data-table-id] {
        width: 100% !important;
        max-width: 100% !important;
        table-layout: fixed !important;
      }
      .pdf-page table[data-table-id] th,
      .pdf-page table[data-table-id] td {
        min-width: 0 !important;
        max-width: 0;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      .pdf-page table[data-table-id] tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    `;
    document.head.appendChild(runtimeStyle);
    const pageBounds = (pageElement) => {
      const rect = pageElement.getBoundingClientRect();
      const style = getComputedStyle(pageElement);
      return {
        top: rect.top + Number.parseFloat(style.paddingTop || "0"),
        right: rect.right - Number.parseFloat(style.paddingRight || "0"),
        bottom: rect.bottom - Number.parseFloat(style.paddingBottom || "0") - PRINT_BOTTOM_SAFETY_PX,
        left: rect.left + Number.parseFloat(style.paddingLeft || "0")
      };
    };
    const isFlowElement = (element) => {
      if (!(element instanceof HTMLElement))
        return false;
      const position = getComputedStyle(element).position;
      return position !== "absolute" && position !== "fixed";
    };
    const flowChildren = (pageElement) => Array.from(pageElement.children).filter(isFlowElement);
    const createContinuationPage = (source) => {
      if (document.querySelectorAll(".pdf-page").length >= MAX_RUNTIME_PAGES) {
        throw new Error("\u52A8\u6001\u5185\u5BB9\u8D85\u8FC7 500 \u9875\uFF0C\u5DF2\u505C\u6B62 PDF \u5206\u9875");
      }
      const continuation = source.cloneNode(false);
      continuation.removeAttribute("data-overflow");
      continuation.dataset.pageId = `${source.dataset.pageId || "page"}-runtime-${++pageSequence}`;
      continuation.dataset.breakType = "auto";
      continuation.dataset.runtimePage = "true";
      source.querySelectorAll(":scope > [data-page-furniture]").forEach(region => continuation.appendChild(region.cloneNode(true)));
      source.insertAdjacentElement("afterend", continuation);
      return continuation;
    };
    const followingFlowSiblings = (element) => {
      const siblings = [];
      let sibling = element.nextElementSibling;
      while (sibling) {
        const next = sibling.nextElementSibling;
        if (isFlowElement(sibling))
          siblings.push(sibling);
        sibling = next;
      }
      return siblings;
    };
    const headerRows = (table) => {
      const headers = [];
      for (const row of Array.from(table.rows)) {
        if (row.querySelector("th") || row.dataset.repeatedHeader === "true")
          headers.push(row);
        else
          break;
      }
      return headers;
    };
    const createTableContinuation = (table) => {
      const continuation = table.cloneNode(false);
      continuation.dataset.continuation = "true";
      continuation.dataset.fragmentId = `${table.dataset.fragmentId || table.dataset.tableId || "table"}-runtime-${++pageSequence}`;
      Array.from(table.children).filter((child) => child.tagName === "COLGROUP").forEach((colgroup) => continuation.appendChild(colgroup.cloneNode(true)));
      const head = document.createElement("thead");
      const headers = headerRows(table);
      headers.forEach((row) => {
        const clone = row.cloneNode(true);
        clone.dataset.repeatedHeader = "true";
        head.appendChild(clone);
      });
      continuation.appendChild(head);
      const body = document.createElement("tbody");
      continuation.appendChild(body);
      return { table: continuation, body };
    };
    const originalRowText = /* @__PURE__ */ new Map();
    document.querySelectorAll("table[data-table-id]").forEach((table) => {
      const headers = new Set(headerRows(table));
      Array.from(table.rows).forEach((row) => {
        if (headers.has(row))
          return;
        const sourceId = `runtime-row-${++rowSequence}`;
        row.dataset.runtimeSourceRow = sourceId;
        originalRowText.set(sourceId, Array.from(row.cells).map((cell) => cell.textContent || ""));
      });
    });
    const splitOversizedTextRow = (row, bottom) => {
      const cells = Array.from(row.cells);
      if (!cells.length || cells.some((cell) => cell.querySelector("img, table, ul, ol")))
        return false;
      const texts = cells.map((cell) => cell.textContent || "");
      if (!texts.some(Boolean))
        return false;
      const remainder = row.cloneNode(true);
      const remainderCells = Array.from(remainder.cells);
      cells.forEach((cell) => {
        cell.textContent = "";
      });
      let progressed = false;
      texts.forEach((text, cellIndex) => {
        let low = 0;
        let high = text.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          cells[cellIndex].textContent = text.slice(0, middle);
          if (row.getBoundingClientRect().bottom <= bottom + EPSILON)
            low = middle;
          else
            high = middle - 1;
        }
        cells[cellIndex].textContent = text.slice(0, low);
        remainderCells[cellIndex].textContent = text.slice(low);
        if (low > 0)
          progressed = true;
      });
      if (!progressed || !remainderCells.some((cell) => (cell.textContent || "").length > 0)) {
        cells.forEach((cell, index) => {
          cell.textContent = texts[index];
        });
        return false;
      }
      row.dataset.runtimeRowPart = "start";
      remainder.dataset.runtimeRowPart = "continuation";
      row.insertAdjacentElement("afterend", remainder);
      splitRows += 1;
      return true;
    };
    const moveWholeTable = (table, sourcePage) => {
      const following = followingFlowSiblings(table);
      const continuationPage = createContinuationPage(sourcePage);
      continuationPage.appendChild(table);
      following.forEach((element) => continuationPage.appendChild(element));
      return table;
    };
    const splitTable = (table, sourcePage) => {
      const bounds = pageBounds(sourcePage);
      const headers = headerRows(table);
      const bodyRows = Array.from(table.rows).filter((row) => !headers.includes(row));
      if (!bodyRows.length || table.getBoundingClientRect().bottom <= bounds.bottom + EPSILON)
        return null;
      const fittingRows = bodyRows.filter((row) => row.getBoundingClientRect().bottom <= bounds.bottom + EPSILON).length;
      if (fittingRows === 0) {
        if (table.getBoundingClientRect().top > bounds.top + EPSILON)
          return moveWholeTable(table, sourcePage);
        if (!splitOversizedTextRow(bodyRows[0], bounds.bottom)) {
          throw new Error("\u52A8\u6001\u8868\u683C\u5B58\u5728\u65E0\u6CD5\u5728\u5355\u9875\u5BB9\u7EB3\u7684\u590D\u6742\u884C\uFF0C\u8BF7\u7F29\u77ED\u5185\u5BB9\u6216\u62C6\u5206\u4E1A\u52A1\u8BB0\u5F55");
        }
      }
      const refreshedHeaders = headerRows(table);
      const refreshedRows = Array.from(table.rows).filter((row) => !refreshedHeaders.includes(row));
      const splitIndex = refreshedRows.findIndex((row) => row.getBoundingClientRect().bottom > bounds.bottom + EPSILON);
      if (splitIndex < 0)
        return null;
      const following = followingFlowSiblings(table);
      const continuationPage = createContinuationPage(sourcePage);
      const continuation = createTableContinuation(table);
      refreshedRows.slice(splitIndex).forEach((row) => continuation.body.appendChild(row));
      continuationPage.appendChild(continuation.table);
      following.forEach((element) => continuationPage.appendChild(element));
      tableFragments += 1;
      return continuation.table;
    };
    const pendingTables = Array.from(document.querySelectorAll("table[data-table-id]"));
    for (const initialTable of pendingTables) {
      let table = initialTable;
      let attempts = 0;
      while (table) {
        if (++attempts > MAX_RUNTIME_PAGES)
          throw new Error("\u52A8\u6001\u8868\u683C\u5206\u9875\u672A\u80FD\u6536\u655B");
        const ownerPage = table.closest(".pdf-page");
        if (!ownerPage)
          throw new Error("\u52A8\u6001\u8868\u683C\u5FC5\u987B\u4F4D\u4E8E PDF \u9875\u9762\u5185");
        table = splitTable(table, ownerPage);
      }
    }
    let blocksMoved = true;
    let blockPasses = 0;
    while (blocksMoved) {
      if (++blockPasses > MAX_RUNTIME_PAGES)
        throw new Error("PDF \u5185\u5BB9\u5206\u9875\u672A\u80FD\u6536\u655B");
      blocksMoved = false;
      for (const pageElement of Array.from(document.querySelectorAll(".pdf-page"))) {
        const bounds = pageBounds(pageElement);
        const overflowing = flowChildren(pageElement).find((element) => element.getBoundingClientRect().bottom > bounds.bottom + EPSILON);
        if (!overflowing)
          continue;
        if (overflowing.matches("table[data-table-id]")) {
          const nextTable = splitTable(overflowing, pageElement);
          if (nextTable) {
            blocksMoved = true;
            break;
          }
        }
        if (overflowing.getBoundingClientRect().top <= bounds.top + EPSILON) {
          throw new Error("\u5B58\u5728\u65E0\u6CD5\u5728\u5355\u9875\u5BB9\u7EB3\u7684\u5185\u5BB9\u5757");
        }
        const continuationPage = createContinuationPage(pageElement);
        const following = followingFlowSiblings(overflowing);
        continuationPage.appendChild(overflowing);
        following.forEach((element) => continuationPage.appendChild(element));
        blocksMoved = true;
        break;
      }
    }
    const anchorElements = /* @__PURE__ */ new Map();
    document.querySelectorAll("[data-contract-anchor][data-anchor-id]").forEach((anchor) => {
      const anchorId = anchor.dataset.anchorId || "";
      if (!anchorId || anchorElements.has(anchorId))
        throw new Error("PDF \u6A21\u677F\u5305\u542B\u7F3A\u5931\u6216\u91CD\u590D\u7684\u5E03\u5C40\u951A\u70B9");
      anchorElements.set(anchorId, anchor);
    });
    document.querySelectorAll('.pdf-page-overlay[data-position-mode="anchor"]').forEach((overlay) => {
      const anchorId = overlay.dataset.anchorId || "";
      const anchor = anchorElements.get(anchorId);
      const targetPage = anchor?.closest(".pdf-page");
      if (!anchor || !targetPage)
        throw new Error("\u7B7E\u7F72\u63A7\u4EF6\u5F15\u7528\u7684\u5E03\u5C40\u951A\u70B9\u4E0D\u5B58\u5728");
      const bounds = pageBounds(targetPage);
      const anchorRect = anchor.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const width = overlayRect.width;
      const height = overlayRect.height;
      const align = overlay.dataset.anchorAlign || "left";
      const offsetX = Number(overlay.dataset.anchorOffsetX || 0);
      const offsetY = Number(overlay.dataset.anchorOffsetY || 0);
      const baseX = align === "center" ? (bounds.right - bounds.left - width) / 2 : align === "right" ? bounds.right - bounds.left - width : 0;
      const x = baseX + offsetX;
      const y = anchorRect.top - bounds.top + offsetY;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -EPSILON || y < -EPSILON || x + width > bounds.right - bounds.left + EPSILON || y + height > bounds.bottom - bounds.top + EPSILON) {
        throw new Error("\u951A\u70B9\u7B7E\u7F72\u63A7\u4EF6\u8D85\u51FA\u9875\u9762\u5B89\u5168\u533A\u57DF");
      }
      overlay.style.setProperty("--field-x", `${Math.round(x)}px`);
      overlay.style.setProperty("--field-y", `${Math.round(y)}px`);
      targetPage.appendChild(overlay);
      anchoredOverlays.push({
        anchorId,
        pageId: targetPage.dataset.pageId || "",
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      });
    });
    const pages = Array.from(document.querySelectorAll(".pdf-page"));
    const seenSections = new Set();
    pages.forEach((page, index) => {
      const first = !seenSections.has(page.dataset.sectionId || 'default');
      seenSections.add(page.dataset.sectionId || 'default');
      const variant = first && page.dataset.differentFirst === 'true' ? 'first' : (index + 1) % 2 === 0 && page.dataset.differentEven === 'true' ? 'even' : 'default';
      page.querySelectorAll(':scope > [data-page-furniture]').forEach(region => { region.style.display = region.dataset.furnitureVariant === variant ? 'block' : 'none'; });
      page.querySelectorAll('[data-page-counter]').forEach(counter => { counter.textContent = String(counter.dataset.pageCounter === 'page' ? index + 1 : pages.length); });
    });
    let overflowViolations = 0;
    let widthViolations = 0;
    pages.forEach((pageElement) => {
      const bounds = pageBounds(pageElement);
      pageElement.querySelectorAll(':scope > [data-page-furniture]').forEach(region => {
        if (region.style.display !== 'none' && (region.scrollHeight > region.clientHeight + EPSILON || region.scrollWidth > region.clientWidth + EPSILON)) overflowViolations += 1;
      });
      flowChildren(pageElement).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > bounds.bottom + EPSILON)
          overflowViolations += 1;
        if (rect.right > bounds.right + EPSILON || rect.left < bounds.left - EPSILON)
          widthViolations += 1;
      });
    });
    let lostTextRows = 0;
    originalRowText.forEach((expectedCells, sourceId) => {
      const parts = Array.from(document.querySelectorAll(`tr[data-runtime-source-row="${sourceId}"]`));
      const actualCells = expectedCells.map((_, cellIndex) => parts.map((row) => row.cells[cellIndex]?.textContent || "").join(""));
      if (actualCells.some((text, index) => text !== expectedCells[index]))
        lostTextRows += 1;
    });
    document.querySelectorAll("[data-runtime-source-row], [data-runtime-row-part]").forEach((element) => {
      element.removeAttribute("data-runtime-source-row");
      element.removeAttribute("data-runtime-row-part");
    });
    const pageReports = pages.map((pageElement) => {
      const bounds = pageBounds(pageElement);
      const table = pageElement.querySelector("table[data-table-id]");
      const headers = table ? headerRows(table) : [];
      const dataRows = table ? Array.from(table.rows).filter((row) => !headers.includes(row)) : [];
      const tableRect = table?.getBoundingClientRect();
      return {
        pageId: pageElement.dataset.pageId || "",
        headerRows: headers.length,
        firstDataRow: dataRows[0]?.dataset.rowId || "",
        lastDataRow: dataRows[dataRows.length - 1]?.dataset.rowId || "",
        tableTop: tableRect ? Math.round(tableRect.top - bounds.top) : 0,
        tableBottom: tableRect ? Math.round(tableRect.bottom - bounds.top) : 0,
        contentBottom: Math.round(bounds.bottom - bounds.top)
      };
    });
    document.querySelectorAll('.pdf-floating-anchor').forEach(anchor => {
      const page = anchor.closest('.pdf-page');
      const box = anchor.querySelector('.pdf-floating-box, .pdf-field-placeholder');
      if (!page || !box) return;
      const rect = anchor.getBoundingClientRect();
      const bounds = pageBounds(page);
      const size = box.getBoundingClientRect();
      const x = Number.parseFloat(anchor.dataset.x || getComputedStyle(anchor).getPropertyValue('--field-x')) || 0;
      const y = Number.parseFloat(anchor.dataset.y || getComputedStyle(anchor).getPropertyValue('--field-y')) || 0;
      anchor.style.setProperty('--field-x', `${Math.round(Math.max(bounds.left - rect.left, Math.min(x, bounds.right - size.width - rect.left)))}px`);
      anchor.style.setProperty('--field-y', `${Math.round(Math.max(bounds.top - rect.top, Math.min(y, bounds.bottom + PRINT_BOTTOM_SAFETY_PX - size.height - rect.top)))}px`);
    });
    return {
      initialPages,
      finalPages: pages.length,
      tableFragments,
      splitRows,
      overflowViolations,
      widthViolations,
      lostTextRows,
      anchoredOverlays,
      pages: pageReports
    };
  })();
})();
