import { memo } from 'react';
import { Link } from 'react-router-dom';
import { isbnCoverUrl } from '../lib/openLibrary';
import type { Book, ScoredBook } from '../lib/types';
import { useSignals } from '../store/signals';
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
  onDismiss?: (book: Book) => void;
  showActions?: boolean;
}

/** Hat das Werk bekannte Sprachen, aber keine deutsche Ausgabe? */
function notInGerman(book: Book): boolean {
  return book.languages.length > 0 && !book.languages.includes('ger') && book.preferredEditionLang !== 'ger';
}

export const BookCard = memo(function BookCard({ book, scored, maxReasons = 2, origin, onDismiss, showActions = true }: BookCardProps) {
  const saved = useWishlist((s) => Boolean(s.items[book.id]));
  const toggle = useWishlist((s) => s.toggle);
  const record = useSignals((s) => s.record);
  const openRating = useUi((s) => s.openRating);
  const path = bookPath(book);
  const isbn = book.isbns?.[0];
  // „Auf Deutsch“ ist der Normalfall – erwähnt wird nur, wenn es keine deutsche Ausgabe gibt
  const why = (scored?.reasons ?? []).filter((r) => r.kind !== 'ai' && r.kind !== 'german').slice(0, maxReasons).map((r) => r.label);
  if (notInGerman(book)) why.push('nicht auf Deutsch');
  const match = scored && scored.match > 0 ? scored.match : 0;

  return (
    <article className="book-card">
      <div style={{ position: 'relative' }}>
        <Link to={path} className="cover-link" onClick={() => rememberBook(book)} aria-label={`${book.title} öffnen`}>
          <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} fallbacks={isbn ? [isbnCoverUrl(isbn)] : []} />
        </Link>
        {scored?.alreadyRead && (
          <span className="read-badge tag" title="Steht in deiner Bibliothek">
            ✓ gelesen
          </span>
        )}
        {showActions && (
          <div className="card-actions">
            <button
              type="button"
              className={`mini-btn ${saved ? 'on' : ''}`}
              title={saved ? 'Von der Merkliste nehmen' : 'Auf die Merkliste'}
              aria-pressed={saved}
              onClick={() => {
                const added = toggle(book, origin);
                if (added) record(book, 'save');
                toast(added ? `„${book.title}“ gemerkt` : 'Von der Merkliste entfernt');
              }}
            >
              {saved ? '♥' : '♡'}
            </button>
            <button type="button" className="mini-btn" title="Schon gelesen" onClick={() => openRating(book)}>
              ✓
            </button>
            {onDismiss && (
              <button
                type="button"
                className="mini-btn"
                title="Nicht meins – weniger davon"
                onClick={() => {
                  record(book, 'dislike');
                  onDismiss(book);
                  toast('Verstanden – weniger davon');
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      <div className="meta">
        <Link to={path} className="title" onClick={() => rememberBook(book)}>
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

export function BookGrid({
  items,
  compact,
  maxReasons,
  origin,
  onDismiss,
}: {
  items: Array<Book | ScoredBook>;
  compact?: boolean;
  maxReasons?: number;
  origin?: string;
  onDismiss?: (book: Book) => void;
}) {
  return (
    <div className={`book-grid ${compact ? 'compact' : ''}`}>
      {items.map((item, i) => {
        const scored = 'book' in item ? item : undefined;
        const book = 'book' in item ? item.book : item;
        return <BookCard key={book.id} book={book} scored={scored} index={i} maxReasons={maxReasons} origin={origin} onDismiss={onDismiss} />;
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
}: {
  title: string;
  subtitle?: string;
  items: Array<Book | ScoredBook>;
  action?: React.ReactNode;
  origin?: string;
}) {
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
        {items.map((item, i) => {
          const scored = 'book' in item ? item : undefined;
          const book = 'book' in item ? item.book : item;
          return <BookCard key={book.id} book={book} scored={scored} index={i} maxReasons={2} origin={origin} />;
        })}
      </div>
    </section>
  );
}
