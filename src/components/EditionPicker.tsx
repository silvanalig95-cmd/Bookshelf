import { useEffect, useMemo, useRef, useState } from 'react';
import { editionLabel, filterEditions, FORMAT_LABELS, sortEditions, summarizeEditions, type EditionFormatFilter, type EditionLangFilter } from '../lib/editions';
import { isbnCoverUrl } from '../lib/openLibrary';
import { languageFlag, languageLabel } from '../lib/taxonomy';
import type { Edition, LanguagePreference } from '../lib/types';
import { Cover } from './Cover';

interface Props {
  editions: Edition[];
  total: number;
  selectedKey?: string;
  onSelect: (e: Edition) => void;
  language: LanguagePreference;
  loading?: boolean;
}

export function EditionPicker({ editions, total, selectedKey, onSelect, language, loading }: Props) {
  const summary = useMemo(() => summarizeEditions(editions), [editions]);
  const [lang, setLangState] = useState<EditionLangFilter>(() => (summary.german ? 'ger' : 'all'));
  const touched = useRef(false);
  const setLang = (l: EditionLangFilter) => {
    touched.current = true;
    setLangState(l);
  };
  // Sobald Ausgaben geladen sind: deutsche zuerst zeigen (ausser die Person hat selbst gewählt)
  useEffect(() => {
    if (touched.current) return;
    setLangState(summary.german && language !== 'any' ? 'ger' : 'all');
  }, [summary.german, language]);
  const [format, setFormat] = useState<EditionFormatFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const list = useMemo(() => sortEditions(filterEditions(editions, lang, format), language), [editions, lang, format, language]);
  const visible = showAll ? list : list.slice(0, 12);
  const otherCount = summary.total - summary.german - summary.english;

  const langOptions: Array<{ id: EditionLangFilter; label: string; count: number }> = [
    { id: 'ger', label: '🇩🇪 Deutsch', count: summary.german },
    { id: 'eng', label: '🇬🇧 Englisch', count: summary.english },
    { id: 'other', label: '🌐 Andere', count: Math.max(0, otherCount) },
    { id: 'all', label: 'Alle', count: summary.total },
  ];
  const formats = (Object.keys(FORMAT_LABELS) as Array<keyof typeof FORMAT_LABELS>).filter((f) => summary.byFormat[f] > 0 && f !== 'other');

  return (
    <div>
      <div className="row wrap between" style={{ marginBottom: 12 }}>
        <div className="segmented" role="tablist" aria-label="Sprache der Ausgaben">
          {langOptions
            .filter((o) => o.count > 0 || o.id === 'all')
            .map((o) => (
              <button key={o.id} className={lang === o.id ? 'on' : ''} onClick={() => setLang(o.id)} role="tab" aria-selected={lang === o.id}>
                {o.label} <span className="muted">{o.count}</span>
              </button>
            ))}
        </div>
        {formats.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={format} onChange={(e) => setFormat(e.target.value as EditionFormatFilter)} aria-label="Format">
            <option value="all">Alle Formate</option>
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]} ({summary.byFormat[f]})
              </option>
            ))}
          </select>
        )}
      </div>
      {loading && !editions.length ? (
        <p className="muted">Ausgaben werden geladen …</p>
      ) : list.length === 0 ? (
        <p className="muted">Keine Ausgaben mit diesem Filter.</p>
      ) : (
        <div className="editions" role="listbox" aria-label="Ausgaben">
          {visible.map((e) => (
            <button
              key={e.key}
              className={`edition ${e.key === selectedKey ? 'selected' : ''}`}
              onClick={() => onSelect(e)}
              role="option"
              aria-selected={e.key === selectedKey}
            >
              <Cover title={e.title} coverId={e.coverId} src={e.coverUrl} size="S" fallbacks={e.isbn13 ? [isbnCoverUrl(e.isbn13, 'S')] : []} />
              <div style={{ minWidth: 0 }}>
                <div className="e-title">{e.title}</div>
                <div className="e-meta">{editionLabel(e) || 'Keine Angaben'}</div>
                {e.isbn13 && <div className="e-meta">ISBN {e.isbn13}</div>}
              </div>
              <div className="row" style={{ gap: 4 }}>
                {e.languages.slice(0, 2).map((l) => (
                  <span key={l} title={languageLabel(l)}>
                    {languageFlag(l)}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
      {list.length > visible.length && (
        <button className="btn btn-ghost btn-sm mt-1" onClick={() => setShowAll(true)}>
          Alle {list.length} Ausgaben zeigen
        </button>
      )}
      {total > editions.length && <p className="tiny muted mt-1">{total} Ausgaben bei Open Library, {editions.length} geladen.</p>}
    </div>
  );
}
