import { useEffect, useRef, useState } from 'react';
import { createId } from '../editor/id';

interface ToolbarSelectProps {
  label: string;
  title?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export function ToolbarSelect({ label, title, value, options, onChange }: ToolbarSelectProps) {
  const [id] = useState(() => createId('toolbar-select'));
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const selectedIndex = options.findIndex(option => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    const option = list?.children.item(highlighted);
    if (!list || !(option instanceof HTMLElement)) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [open, highlighted]);

  const showOptions = () => {
    setHighlighted(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const choose = (nextValue: string) => {
    setOpen(false);
    if (nextValue !== value) onChange(nextValue);
  };

  return (
    <div ref={rootRef} className="toolbar-select">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${highlighted}` : undefined}
        title={title || label}
        className={`toolbar-select__trigger${open ? ' is-open' : ''}`}
        onClick={() => open ? setOpen(false) : showOptions()}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            setOpen(false);
            if (event.key === 'Escape') event.preventDefault();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) showOptions();
            else setHighlighted(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (open && (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            setHighlighted(event.key === 'Home' ? 0 : options.length - 1);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(options[highlighted].value);
            else showOptions();
          }
        }}
      >
        <span>{options[selectedIndex]?.label || label}</span>
        <span className="toolbar-select__arrow" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul ref={listRef} id={id} role="listbox" aria-label={label} className="toolbar-select__options">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`${option.value === value ? 'is-selected' : ''}${index === highlighted ? ' is-highlighted' : ''}`}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
