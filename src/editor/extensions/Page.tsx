import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createId } from '../id';
import { normalizePageMargins } from '../types';
import { getSection, furnitureReserve, furnitureVariant, furnitureWithCounters, type PageFurniture } from '../pageFurniture';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contractPage: {
      addPageAfter: (position: number) => ReturnType;
      duplicatePage: (position: number) => ReturnType;
      deletePage: (position: number) => ReturnType;
      movePage: (position: number, direction: -1 | 1) => ReturnType;
    };
  }
}

function cloneNodeWithFreshIds(node: ProseMirrorNode): ProseMirrorNode {
  const json = node.toJSON() as JSONContent;
  const tableIds = new Map<string, string>();
  const anchorIds = new Map<string, string>();
  const refreshIds = (item: JSONContent) => {
    if (item.type === 'page') {
      item.attrs = {
        ...(item.attrs || {}),
        pageId: createId('page'),
        breakType: 'manual',
      };
    }
    if (item.type === 'signingArea') {
      item.attrs = { ...(item.attrs || {}), areaId: createId('area') };
    }
    if (item.type === 'layoutAnchor') {
      const sourceAnchorId = String(item.attrs?.anchorId || createId('anchor-source'));
      if (!anchorIds.has(sourceAnchorId)) anchorIds.set(sourceAnchorId, createId('anchor'));
      item.attrs = { ...(item.attrs || {}), anchorId: anchorIds.get(sourceAnchorId) };
    }
    if (item.type === 'inlineField' || item.type === 'floatingField' || item.type === 'pageOverlay') {
      const sourceAnchorId = typeof item.attrs?.anchorId === 'string' ? item.attrs.anchorId : null;
      item.attrs = {
        ...(item.attrs || {}),
        refId: createId('ref'),
        ...(sourceAnchorId && anchorIds.has(sourceAnchorId) ? { anchorId: anchorIds.get(sourceAnchorId) } : {}),
      };
    }
    if (item.type === 'paragraph' || item.type === 'heading' || item.type === 'bulletList' || item.type === 'orderedList') {
      item.attrs = { ...(item.attrs || {}), blockId: createId('block') };
      if (item.type === 'paragraph') item.attrs.flowId = createId('flow');
    }
    if (item.type === 'table') {
      const sourceTableId = String(item.attrs?.tableId || createId('table-source'));
      if (!tableIds.has(sourceTableId)) tableIds.set(sourceTableId, createId('table'));
      item.attrs = {
        ...(item.attrs || {}),
        tableId: tableIds.get(sourceTableId),
        fragmentId: createId('fragment'),
        continuation: false,
      };
    }
    if (item.type === 'tableRow') {
      item.attrs = {
        ...(item.attrs || {}),
        rowId: createId('row'),
        repeatedHeader: false,
        sourceRowId: null,
      };
    }
    item.content?.forEach(refreshIds);
  };
  refreshIds(json);
  return node.type.schema.nodeFromJSON(json);
}

function PageNodeView({ editor, getPos, node, selected }: NodeViewProps) {
  const wrapperRef = useRef<HTMLElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = wrapper?.querySelector<HTMLElement>('.contract-page__content');

    if (!wrapper || !content) {
      return undefined;
    }

    let animationFrame = 0;
    let disposed = false;
    const checkOverflow = () => {
      if (disposed) return;
      const contentBottom = content.getBoundingClientRect().bottom;
      const flowRoot = content.querySelector<HTMLElement>(':scope > [data-node-view-content-react]')
        || content;
      const flowBottom = Array.from(flowRoot.children)
        .filter((child) => (
          !child.matches('.node-pageOverlay')
          && !child.matches('[data-page-overlay]')
        ))
        .reduce((maximum, child) => {
        return Math.max(maximum, child.getBoundingClientRect().bottom);
      }, content.getBoundingClientRect().top);
      const furnitureOverflow = Array.from(wrapper.querySelectorAll<HTMLElement>(':scope > [data-page-furniture]')).some(region => region.scrollHeight > region.clientHeight + 1 || region.scrollWidth > region.clientWidth + 1);
      const overflowing = flowBottom > contentBottom + 1 || furnitureOverflow;
      wrapper.dataset.overflow = overflowing ? 'true' : 'false';
      setIsOverflowing(overflowing);
    };

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(content);
    wrapper.querySelectorAll<HTMLElement>(':scope > [data-page-furniture]').forEach(region => observer.observe(region));
    Array.from(content.children).forEach((child) => observer.observe(child));
    const mutationObserver = new MutationObserver(() => {
      Array.from(content.children).forEach((child) => observer.observe(child));
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(checkOverflow);
    });
    mutationObserver.observe(content, { childList: true, subtree: true, characterData: true });
    checkOverflow();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [node.content.size, editor.state.doc.attrs.pageFurniture, editor.state.doc.attrs.pageMargins]);

  const position = getPos();
  const pageIndex = typeof position === 'number'
    ? editor.state.doc.resolve(position).index(0)
    : 0;
  const pageCount = editor.state.doc.childCount;
  const isAutomaticPage = node.attrs.breakType === 'auto';
  const nextPageIsAutomatic = pageIndex < pageCount - 1
    && editor.state.doc.child(pageIndex + 1).attrs.breakType === 'auto';
  const isInAutomaticFlow = isAutomaticPage || nextPageIsAutomatic;
  const pageMargins = normalizePageMargins(editor.state.doc.attrs.pageMargins);
  const furniture = editor.state.doc.attrs.pageFurniture as PageFurniture | null;
  const section = getSection(furniture, node.attrs.sectionId);
  let firstInSection = true;
  editor.state.doc.forEach((page, _offset, index) => {
    if (index < pageIndex && page.attrs.sectionId === node.attrs.sectionId) firstInSection = false;
  });
  const variant = furnitureVariant(section, firstInSection, pageIndex + 1);
  const reserve = furnitureReserve(section);
  const pageStyle = {
    '--page-margin-top': `${pageMargins.top}mm`,
    '--page-margin-right': `${pageMargins.right}mm`,
    '--page-margin-bottom': `${pageMargins.bottom}mm`,
    '--page-margin-left': `${pageMargins.left}mm`,
    '--page-body-top': `${pageMargins.top + reserve.header}mm`,
    '--page-body-bottom': `${pageMargins.bottom + reserve.footer}mm`,
  } as CSSProperties;

  const runPageCommand = (command: () => boolean) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    command();
  };

  const deleteCurrentPage = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (pageCount <= 1) {
      return;
    }

    if (window.confirm(`确定删除第 ${pageIndex + 1} 页吗？`)) {
      editor.commands.deletePage(position as number);
    }
  };

  return (
    <NodeViewWrapper
      as="section"
      className={`contract-page${selected ? ' is-selected' : ''}`}
      data-page-id={node.attrs.pageId}
      data-section-id={node.attrs.sectionId}
      data-break-type={node.attrs.breakType}
      style={pageStyle}
      ref={(element: HTMLElement | null) => {
        wrapperRef.current = element;
      }}
    >
      <div className="contract-page__number" contentEditable={false}>
        第 {pageIndex + 1} 页{isAutomaticPage ? ' · 自动分页' : ''}
      </div>
      {editor.isEditable ? <div className="contract-page__actions" contentEditable={false}>
        <button
          type="button"
          title="向上移动页面"
          disabled={pageIndex === 0 || isInAutomaticFlow}
          onMouseDown={runPageCommand(() => editor.commands.movePage(position as number, -1))}
        >
          ↑
        </button>
        <button
          type="button"
          title="向下移动页面"
          disabled={pageIndex === pageCount - 1 || isInAutomaticFlow}
          onMouseDown={runPageCommand(() => editor.commands.movePage(position as number, 1))}
        >
          ↓
        </button>
        <button
          type="button"
          title="复制页面"
          disabled={isInAutomaticFlow}
          onMouseDown={runPageCommand(() => editor.commands.duplicatePage(position as number))}
        >
          复制
        </button>
        <button
          type="button"
          title="删除页面"
          disabled={pageCount <= 1 || isInAutomaticFlow}
          onMouseDown={deleteCurrentPage}
        >
          删除
        </button>
        <button
          type="button"
          title="在后面新增页面"
          disabled={isInAutomaticFlow}
          onMouseDown={runPageCommand(() => editor.commands.addPageAfter(position as number))}
        >
          ＋页
        </button>
      </div> : null}
      {(['header', 'footer'] as const).map(kind => section[`${kind}Enabled`] ? <div
        key={kind}
        className={`page-furniture page-furniture--${kind}`}
        contentEditable={false}
        data-page-furniture={kind}
        style={{ height: `${section[`${kind}HeightMm`]}mm` }}
        dangerouslySetInnerHTML={{ __html: furnitureWithCounters(section[kind][variant], pageIndex + 1, pageCount) }}
      /> : null)}
      <NodeViewContent className="contract-page__content" />
      {isOverflowing ? (
        <div className="contract-page__overflow" contentEditable={false}>
          存在无法自动分页的超高内容，请调整尺寸或拆分内容
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export const Page = Node.create({
  name: 'page',
  group: 'page',
  content: 'block+ pageOverlay*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      sectionId: {
        default: 'default',
        parseHTML: element => element.getAttribute('data-section-id') || 'default',
        renderHTML: attributes => ({ 'data-section-id': attributes.sectionId }),
      },
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-id'),
        renderHTML: (attributes) => ({ 'data-page-id': attributes.pageId }),
      },
      breakType: {
        default: 'manual',
        parseHTML: (element) => element.getAttribute('data-break-type') || 'manual',
        renderHTML: (attributes) => ({ 'data-break-type': attributes.breakType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-contract-page]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-contract-page': 'true' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageNodeView);
  },

  addCommands() {
    return {
      addPageAfter:
        (position) =>
        ({ state, dispatch }) => {
          const page = state.doc.nodeAt(position);
          if (!page || page.type.name !== this.name) {
            return false;
          }

          const paragraph = state.schema.nodes.paragraph.create();
          const nextPage = this.type.create(
            { pageId: createId('page'), breakType: 'manual', sectionId: page.attrs.sectionId },
            paragraph,
          );
          dispatch?.(state.tr.insert(position + page.nodeSize, nextPage).scrollIntoView());
          return true;
        },
      duplicatePage:
        (position) =>
        ({ state, dispatch }) => {
          const page = state.doc.nodeAt(position);
          if (!page || page.type.name !== this.name) {
            return false;
          }

          const duplicate = cloneNodeWithFreshIds(page);
          dispatch?.(state.tr.insert(position + page.nodeSize, duplicate).scrollIntoView());
          return true;
        },
      deletePage:
        (position) =>
        ({ state, dispatch }) => {
          if (state.doc.childCount <= 1) {
            return false;
          }

          const page = state.doc.nodeAt(position);
          if (!page || page.type.name !== this.name) {
            return false;
          }

          dispatch?.(state.tr.delete(position, position + page.nodeSize).scrollIntoView());
          return true;
        },
      movePage:
        (position, direction) =>
        ({ state, dispatch }) => {
          const pages: ProseMirrorNode[] = [];
          let currentIndex = -1;

          state.doc.forEach((page, offset, index) => {
            pages.push(page);
            if (offset === position) {
              currentIndex = index;
            }
          });

          const targetIndex = currentIndex + direction;
          if (currentIndex < 0 || targetIndex < 0 || targetIndex >= pages.length) {
            return false;
          }

          const reordered = [...pages];
          const [currentPage] = reordered.splice(currentIndex, 1);
          reordered.splice(targetIndex, 0, currentPage);

          dispatch?.(
            state.tr
              .replaceWith(0, state.doc.content.size, Fragment.fromArray(reordered))
              .scrollIntoView(),
          );
          return true;
        },
    };
  },
});
