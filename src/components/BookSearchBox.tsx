import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks';
import { docToBook, searchWorks } from '../lib/openLibrary';
import type { Book } from '../lib/types';
import { Cover } from './Cover';

interface Props {
  onPick: (book: Book) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Eingabefeld mit Live-Vorschlägen aus Open Library. */
export function BookSearchBox({ onPick, placeholder = 'Titel oder Autor:in …', autoFocus }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q, 350);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.trim().length < 3) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    searchWorks(debounced.trim(), { limit: 7, lang: 'de', signal: controller.signal })
      .then((r) => {
        setResults(r.docs.map((d) => docToBook(d)));
        setActive(0);
        setOpen(true);
      })
      .catch(() => undefined)
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [debounced]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (b: Book) => {
    onPick(b);
    setQ('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <input
        className="input"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {loading && <span className="spinner" style={{ position: 'absolute', right: 12, top: 11, width: 18, height: 18 }} />}
      {open && results.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 30,
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            maxHeight: 380,
            overflowY: 'auto',
          }}
        >
          {results.map((b, i) => (
            <button
              key={b.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(b)}
              className="row"
              style={{
                width: '100%',
                border: 0,
                textAlign: 'left',
                padding: 6,
                borderRadius: 10,
                cursor: 'pointer',
                background: i === active ? 'var(--surface-3)' : 'transparent',
              }}
            >
              <Cover title={b.title} coverId={b.coverId} size="S" style={{ width: 34 }} />
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: '0.92rem', lineHeight: 1.25 }}>{b.title}</b>
                <span className="muted small">
                  {b.authors[0]}
                  {b.year ? ` · ${b.year}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
