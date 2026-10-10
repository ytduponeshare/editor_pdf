import { useLayoutEffect, useRef } from 'react';

interface InlineTextInputProps {
  value: string;
  label: string;
  invalid: boolean;
  width: number;
  onChange: (value: string) => void;
}

// A native input is one indivisible box. Editable inline text can instead
// continue on the next paragraph line together with the surrounding text.
export function InlineTextInput({ value, label, invalid, width, onChange }: InlineTextInputProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const composingRef = useRef(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element && element.textContent !== value && !composingRef.current) {
      element.textContent = value;
    }
  }, [value]);

  const commit = () => {
    const element = elementRef.current;
    if (!element || composingRef.current) return;
    const text = (element.textContent || '').replace(/[\r\n]+/g, ' ');
    if (element.textContent !== text || !text && element.childNodes.length > 0) {
      element.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    onChange(text);
  };

  const paste = (event: React.ClipboardEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const element = elementRef.current;
    const selection = window.getSelection();
    if (!element || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const text = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    commit();
  };

  return <span
    ref={elementRef}
    className="signing-field__text"
    style={!value ? { display: 'inline-block', minWidth: `${width}px` } : undefined}
    contentEditable
    suppressContentEditableWarning
    role="textbox"
    aria-label={label}
    aria-multiline={false}
    aria-invalid={invalid}
    data-placeholder={label}
    onInput={commit}
    onBeforeInput={event => {
      const native = event.nativeEvent;
      if (native instanceof InputEvent && ['insertParagraph', 'insertLineBreak'].includes(native.inputType)) event.preventDefault();
    }}
    onPaste={paste}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; commit(); }}
    onKeyDown={event => {
      if (event.key === 'Enter' && !composingRef.current) event.preventDefault();
    }}
  />;
}
