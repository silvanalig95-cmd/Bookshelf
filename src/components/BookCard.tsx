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
  /** Wie viele Begründungs-Chips höchstens angezeigt werden. */
  maxReasons?: number;
  index?: number;
  origin?: string;
  onDismiss?: (book: Book) => void;
  showActions?: boolean;
}

function matchColor(match: number): string {
  if (match >= 80) return 'var(--teal)';
  if (match >= 60) return 'var(--gold)';
  return 'var(--muted)';
}

export const BookCard = memo(function BookCard({ book, scored, maxReasons = 3, index = 0, origin, onDismiss, showActions = true }: BookCardProps) {
  const saved = useWishlist((s) => Boolean(s.items[book.id]));
  const toggle = useWishlist((s) => s.toggle);
  const record = useSignals((s) => s.record);
  const openRating = useUi((s) => s.openRating);
  const path = bookPath(book);
  const isbn = book.isbns?.[0];

  return (
    <article className="book-card" style={{ animationDelay: `${Math.min(index, 16) * 35}ms` }}>
      <div style={{ position: 'relative' }}>
        <Link to={path} className="cover-link" onClick={() => rememberBook(book)} aria-label={`${book.title} öffnen`}>
          <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} fallbacks={isbn ? [isbnCoverUrl(isbn)] : []} />
        </Link>
        {scored && scored.match > 0 && (
          <span className="match-badge" title="Wie gut das Buch zu deiner Suche passt">
            <span className="match-ring" style={{ '--p': scored.match, '--ring': matchColor(scored.match) } as React.CSSProperties} />
            {scored.match}%
          </span>
        )}
        {scored?.alreadyRead && (
          <span className="read-badge tag teal" title="Steht in deiner Bibliothek">
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
        {scored && scored.reasons.some((r) => r.kind !== 'ai') && (
          <div className="reasons">
            {scored.reasons
              .filter((r) => r.kind !== 'ai')
              .slice(0, maxReasons)
              .map((r) => (
              <span key={r.label} className={`tag ${r.kind === 'taste' ? 'gold' : r.kind === 'german' ? 'teal' : r.kind === 'ai' ? 'violet' : r.kind === 'fame' ? 'rose' : ''}`}>
                {r.label}
              </span>
            ))}
          </div>
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
  icon,
  items,
  action,
  origin,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  items: Array<Book | ScoredBook>;
  action?: React.ReactNode;
  origin?: string;
}) {
  return (
    <section className="shelf-row">
      <div className="shelf-row-head">
        <div>
          <h2>
            {icon && <span>{icon}</span>} {title}
          </h2>
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
