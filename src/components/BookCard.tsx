import { memo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { isbnCoverUrl } from '../lib/openLibrary';
import type { Book, ScoredBook } from '../lib/types';
import { useImpressions, watchImpression } from '../store/impressions';
import { reportBook } from '../store/knowledge';
import { ownedLabel, useOwned } from '../store/owned';
import { hideBook, useDismissed, useSignals } from '../store/signals';
import { rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';
import { Cover } from './Cover';

export function bookPath(book: Book): string {
  return `/buch/${encodeURIComponent(book.id)}`;
}

interface BookCardProps {
  book: Book;
  scored?: ScoredBook;
  /** Wie viele Gründe höchstens angezeigt werden. */
  maxReasons?: number;
  index?: number;
  origin?: string;
  /** Zusätzlich zum Ausblenden (z. B. um das Buch aus einer Trefferliste zu nehmen). */
  onDismiss?: (book: Book) => void;
  showActions?: boolean;
  /** Ausblenden anbieten (überall ausser z. B. auf der Merkliste). */
  hideable?: boolean;
}

/** Hat das Werk bekannte Sprachen, aber keine deutsche Ausgabe? */
function notInGerman(book: Book): boolean {
  return book.languages.length > 0 && !book.languages.includes('ger') && book.preferredEditionLang !== 'ger';
}

export const BookCard = memo(function BookCard({ book, scored, maxReasons = 2, origin, onDismiss, showActions = true, hideable = true }: BookCardProps) {
  const saved = useWishlist((s) => Boolean(s.items[book.id]));
  const toggle = useWishlist((s) => s.toggle);
  const record = useSignals((s) => s.record);
  const owned = useOwned((s) => s.items[book.id]?.formats);
  const openRating = useUi((s) => s.openRating);
  const path = bookPath(book);
  const isbn = book.isbns?.[0];
  const ref = useRef<HTMLElement>(null);
  // Gesehen, aber nichts gemacht? Fliesst in die Rotation der Treffer ein (siehe lib/freshness)
  // … und landet im Wissensspeicher, aus dem der Algorithmus nachlernt
  useEffect(
    () => (ref.current ? watchImpression(ref.current, () => useImpressions.getState().see(book.id) && reportBook(book, 'seen')) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.id],
  );
  const engaged = () => useImpressions.getState().engage(book.id);
  // „Auf Deutsch“ ist der Normalfall – erwähnt wird nur, wenn es keine deutsche Ausgabe gibt
  const why = (scored?.reasons ?? []).filter((r) => r.kind !== 'ai' && r.kind !== 'german').slice(0, maxReasons).map((r) => r.label);
  if (notInGerman(book)) why.push('nicht auf Deutsch');
  const match = scored && scored.match > 0 ? scored.match : 0;

  return (
    <article className="book-card" ref={ref}>
      <div style={{ position: 'relative' }}>
        <Link
          to={path}
          className="cover-link"
          onClick={() => {
            rememberBook(book);
            engaged();
          }}
          aria-label={`${book.title} öffnen`}
        >
          <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} isbn={isbn} fallbacks={isbn ? [isbnCoverUrl(isbn)] : []} />
        </Link>
        {scored?.alreadyRead ? (
          <span className="read-badge tag" title="Steht in deiner Bibliothek">
            ✓ gelesen
          </span>
        ) : owned ? (
          <span className="read-badge tag" title="In deinem Besitz">
            {ownedLabel(owned)}
          </span>
        ) : null}
        {showActions && (
          <div className="card-actions">
            <button
              type="button"
              className={`mini-btn ${saved ? 'on' : ''}`}
              title={saved ? 'Von der Merkliste nehmen' : 'Auf die Merkliste'}
              aria-pressed={saved}
              onClick={() => {
                engaged();
                const added = toggle(book, origin);
                if (added) record(book, 'save');
                toast(added ? `„${book.title}“ gemerkt` : 'Von der Merkliste entfernt');
              }}
            >
              {saved ? '♥' : '♡'}
            </button>
            <button
              type="button"
              className="mini-btn"
              title="Schon gelesen"
              onClick={() => {
                engaged();
                openRating(book);
              }}
            >
              ✓
            </button>
            {hideable && (
              <button
                type="button"
                className="mini-btn"
                title="Ausblenden – nicht mehr vorschlagen"
                aria-label={`„${book.title}“ ausblenden`}
                onClick={() => {
                  const undo = hideBook(book);
                  onDismiss?.(book);
                  toast('Ausgeblendet', { label: 'Rückgängig', run: undo });
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      <div className="meta">
        <Link
          to={path}
          className="title"
          onClick={() => {
            rememberBook(book);
            engaged();
          }}
        >
          {book.title}
        </Link>
        <span className="author">
          {book.authors.slice(0, 2).join(', ') || 'Unbekannt'}
          {book.year ? ` · ${book.year}` : ''}
        </span>
        {scored?.reasons
          .filter((r) => r.kind === 'ai')
          .map((r) => (
            <p key={r.label} className="ai-why">
              {r.label}
            </p>
          ))}
        {(match > 0 || why.length > 0) && (
          <span className="why" title={[match ? `${match} % Übereinstimmung` : '', ...why].filter(Boolean).join(' · ')}>
            {match > 0 && <b>{match} %</b>}
            {match > 0 && why.length > 0 && ' · '}
            {why.join(' · ')}
          </span>
        )}
      </div>
    </article>
  );
});

const bookOf = (item: Book | ScoredBook) => ('book' in item ? item.book : item);

/** Ausgeblendetes und „Nicht meins“ verschwinden aus allen Vorschlägen – sofort, auch ohne neu zu laden. */
function useVisible(items: Array<Book | ScoredBook>, keepHidden?: boolean) {
  const dismissed = useDismissed();
  return keepHidden ? items : items.filter((item) => !dismissed.has(bookOf(item).id));
}

export function BookGrid({
  items,
  compact,
  maxReasons,
  origin,
  onDismiss,
  keepHidden,
}: {
  items: Array<Book | ScoredBook>;
  compact?: boolean;
  maxReasons?: number;
  origin?: string;
  onDismiss?: (book: Book) => void;
  /** Für eigene Listen wie die Merkliste: nichts ausblenden und kein Ausblenden anbieten. */
  keepHidden?: boolean;
}) {
  const visible = useVisible(items, keepHidden);
  return (
    <div className={`book-grid ${compact ? 'compact' : ''}`}>
      {visible.map((item, i) => {
        const scored = 'book' in item ? item : undefined;
        const book = bookOf(item);
        return <BookCard key={book.id} book={book} scored={scored} index={i} maxReasons={maxReasons} origin={origin} onDismiss={onDismiss} hideable={!keepHidden} />;
      })}
    </div>
  );
}

export function BookRow({
  title,
  subtitle,
  items,
  action,
  origin,
  keepHidden,
}: {
  title: string;
  subtitle?: string;
  items: Array<Book | ScoredBook>;
  action?: React.ReactNode;
  origin?: string;
  keepHidden?: boolean;
}) {
  const visible = useVisible(items, keepHidden);
  if (!visible.length) return null;
  return (
    <section className="shelf-row">
      <div className="shelf-row-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="scroller">
        {visible.map((item, i) => {
          const scored = 'book' in item ? item : undefined;
          const book = bookOf(item);
          return <BookCard key={book.id} book={book} scored={scored} index={i} maxReasons={2} origin={origin} hideable={!keepHidden} />;
        })}
      </div>
    </section>
  );
}
