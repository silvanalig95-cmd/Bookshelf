import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Stars } from '../components/Stars';
import { hasGerman } from '../lib/discovery';
import { useAsync, useProfile, useReadIndex } from '../lib/hooks';
import { settle } from '../lib/http';
import { docToBook, getWork, isbnCoverUrl, searchWorks } from '../lib/openLibrary';
import { conceptsOf, isProfileUsable } from '../lib/profile';
import { displaySubjects, GENRES, subjectLabel } from '../lib/taxonomy';
import { shuffle, solrPhrase, truncate } from '../lib/text';
import type { Book, SignalVerdict } from '../lib/types';
import { germanWikipediaSummary } from '../lib/wikipedia';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';
import { rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

const FICTION = GENRES.filter((g) => g.group === 'fiction' && !['kinder', 'lyrik', 'kurzgeschichten'].includes(g.id));
const THRESHOLD = 110;

interface SessionState {
  liked: Book[];
  concepts: Map<string, { label: string; weight: number; subject: string }>;
  count: number;
}

export default function Swipe() {
  const language = useSettings((s) => s.language);
  const record = useSignals((s) => s.record);
  const signals = useSignals((s) => s.signals);
  const addWish = useWishlist((s) => s.add);
  const openRating = useUi((s) => s.openRating);
  const profile = useProfile();
  const readIndex = useReadIndex();
  const [deck, setDeck] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [leaving, setLeaving] = useState<SignalVerdict | null>(null);
  const [session, setSession] = useState<SessionState>({ liked: [], concepts: new Map(), count: 0 });
  const seen = useRef(new Set(signals.map((s) => s.bookId)));
  const fetching = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const langClause = language === 'any' ? '' : ' language:ger';

  /** Holt neue Karten: teils nach gelerntem Geschmack, teils quer durch die Genres. */
  const refill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const learned = Array.from(session.concepts.values())
        .filter((c) => c.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)
        .map((c) => c.subject);
      const profileSubjects = isProfileUsable(profile) ? profile.querySubjects.slice(0, 6) : [];
      const queries: Array<{ q: string; sort: 'readinglog' | 'rating' }> = [];
      if (learned.length >= 2) queries.push({ q: `subject:(${learned.map(solrPhrase).join(' OR ')})${langClause}`, sort: 'readinglog' });
      if (profileSubjects.length) queries.push({ q: `subject:(${shuffle(profileSubjects).slice(0, 3).map(solrPhrase).join(' OR ')})${langClause}`, sort: 'rating' });
      // Exploration: zufällige Genres
      for (const g of shuffle(FICTION).slice(0, learned.length >= 2 ? 1 : 3)) {
        queries.push({ q: `subject:(${g.subjects.slice(0, 2).map(solrPhrase).join(' OR ')})${langClause}`, sort: Math.random() < 0.5 ? 'readinglog' : 'rating' });
      }
      const results = await Promise.all(
        queries.map((x) => settle(searchWorks(x.q, { sort: x.sort, limit: 12, offset: Math.floor(Math.random() * 8) * 12, lang: 'de' }))),
      );
      const fresh: Book[] = [];
      for (const r of results) {
        for (const d of shuffle(r?.docs ?? [])) {
          const b = docToBook(d);
          if (seen.current.has(b.id) || readIndex.has(b) || (!b.coverId && !b.coverUrl)) continue;
          seen.current.add(b.id);
          fresh.push(b);
          if (fresh.length >= 16) break;
        }
      }
      setDeck((d) => [...d, ...shuffle(fresh)]);
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [session.concepts, profile, readIndex, langClause]);

  useEffect(() => {
    if (deck.length < 4) refill();
  }, [deck.length, refill]);

  const current = deck[0];
  const next = deck[1];

  const decide = useCallback(
    (verdict: SignalVerdict) => {
      if (!current || leaving) return;
      setLeaving(verdict);
      const book = current;
      record(book, verdict);
      if (verdict === 'save') {
        addWish(book, 'Swipe');
        toast('♥ Auf der Merkliste');
      }
      if (verdict === 'read') openRating(book);
      // Sitzungsgeschmack aktualisieren
      setSession((s) => {
        const concepts = new Map(s.concepts);
        const w = verdict === 'like' ? 1 : verdict === 'save' ? 1.3 : verdict === 'dislike' ? -0.8 : 0.4;
        for (const subj of book.subjects.slice(0, 30)) {
          for (const c of conceptsOf([subj])) {
            const prev = concepts.get(c) ?? { label: subjectLabel(subj), weight: 0, subject: subj };
            concepts.set(c, { ...prev, weight: prev.weight + w });
          }
        }
        return { liked: verdict === 'like' || verdict === 'save' ? [book, ...s.liked] : s.liked, concepts, count: s.count + 1 };
      });
      setTimeout(() => {
        setDeck((d) => d.slice(1));
        setLeaving(null);
        setDrag({ x: 0, y: 0, active: false });
      }, 260);
    },
    [current, leaving, record, addWish, openRating],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || document.querySelector('.modal')) return;
      if (e.key === 'ArrowLeft') decide('dislike');
      else if (e.key === 'ArrowRight') decide('like');
      else if (e.key === 'ArrowUp') decide('save');
      else if (e.key === 'ArrowDown') decide('read');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    start.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: 0, y: 0, active: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (drag.x > THRESHOLD) decide('like');
    else if (drag.x < -THRESHOLD) decide('dislike');
    else if (drag.y < -THRESHOLD) decide('save');
    else setDrag({ x: 0, y: 0, active: false });
  };

  const learned = useMemo(
    () =>
      Array.from(session.concepts.values())
        .filter((c) => c.weight > 0.9)
        .sort((a, b) => b.weight - a.weight)
        .filter((c, i, arr) => arr.findIndex((x) => x.label === c.label) === i)
        .slice(0, 8),
    [session.concepts],
  );
  const maxLearned = learned[0]?.weight ?? 1;

  const exitX = leaving === 'like' ? 700 : leaving === 'dislike' ? -700 : 0;
  const exitY = leaving === 'save' ? -700 : leaving === 'read' ? 700 : 0;
  const tx = leaving ? exitX : drag.x;
  const ty = leaving ? exitY : drag.y;
  const hint = drag.x > 40 ? 'like' : drag.x < -40 ? 'dislike' : drag.y < -40 ? 'save' : null;

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Spielen · Bücher-Swipe</p>
        <h1>Wisch dich zum nächsten Buch</h1>
        <p>
          Rechts = klingt spannend, links = nicht meins, hoch = merken. Der Stapel lernt mit jeder Karte, was dich reizt – und deine Entscheidungen fliessen in alle
          Empfehlungen ein. Tastatur: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
        </p>
      </div>

      <div className="swipe-layout">
        <div className="swipe-stage">
          {!current && (
            <div className="swipe-card swipe-empty">
              <span className="spinner" /> {loading ? 'Neue Bücher werden gemischt …' : 'Keine Karten mehr – lade nach …'}
            </div>
          )}
          {next && (
            <div className="swipe-card behind" aria-hidden="true">
              <SwipeCardContent book={next} preview />
            </div>
          )}
          {current && (
            <div
              key={current.id}
              className={`swipe-card ${drag.active ? 'dragging' : ''}`}
              style={{ transform: `translate(${tx}px, ${ty}px) rotate(${tx / 18}deg)`, opacity: leaving ? 0 : 1 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {hint && (
                <div className={`swipe-stamp ${hint}`}>{hint === 'like' ? 'SPANNEND' : hint === 'dislike' ? 'NÖ' : 'MERKEN'}</div>
              )}
              <SwipeCardContent book={current} />
            </div>
          )}
          <div className="swipe-actions">
            <button className="swipe-btn nope" onClick={() => decide('dislike')} title="Nicht meins (←)" aria-label="Nicht meins">
              ✕
            </button>
            <button className="swipe-btn read" onClick={() => decide('read')} title="Schon gelesen (↓)" aria-label="Schon gelesen">
              ✓
            </button>
            <button className="swipe-btn save" onClick={() => decide('save')} title="Merken (↑)" aria-label="Merken">
              ★
            </button>
            <button className="swipe-btn like" onClick={() => decide('like')} title="Klingt spannend (→)" aria-label="Klingt spannend">
              ♥
            </button>
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <h3>🧠 Was ich gelernt habe</h3>
            {learned.length ? (
              <div className="bar-list">
                {learned.map((c) => (
                  <div key={c.label} className="bar-row">
                    <span className="bar-label">{c.label}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(c.weight / maxLearned) * 100}%`, background: 'var(--rose)' }} />
                    </span>
                    <span className="bar-value">{Math.round(c.weight)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted mb-0">Nach ein paar ♥ siehst du hier, welche Themen dich anziehen. Die nächsten Karten richten sich danach.</p>
            )}
            <p className="tiny muted mt-1 mb-0">{session.count} Karten in dieser Runde · insgesamt {signals.length} Entscheidungen gespeichert</p>
          </div>
          <div className="card">
            <h3>♥ Deine Treffer</h3>
            {session.liked.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {session.liked.slice(0, 8).map((b) => (
                  <Link key={b.id} to={bookPath(b)} onClick={() => rememberBook(b)} className="row" style={{ color: 'var(--ink)' }}>
                    <Cover title={b.title} coverId={b.coverId} size="S" style={{ width: 34 }} />
                    <span className="small" style={{ lineHeight: 1.25 }}>
                      <b>{b.title}</b>
                      <br />
                      <span className="muted">{b.authors[0]}</span>
                    </span>
                  </Link>
                ))}
                <Link to="/fuer-dich" className="btn btn-sm btn-soft">
                  Passende Empfehlungen →
                </Link>
              </div>
            ) : (
              <p className="small muted mb-0">Noch nichts – wisch los!</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SwipeCardContent({ book, preview = false }: { book: Book; preview?: boolean }) {
  const work = useAsync(async (signal) => (preview ? undefined : settle(getWork(book.id, signal))), [book.id, preview]);
  const wiki = useAsync(
    async (signal) => (preview ? undefined : germanWikipediaSummary({ titles: [book.title], author: book.authors[0] }, signal).catch(() => undefined)),
    [book.id, preview],
  );
  const subjects = displaySubjects(book.subjects, 6);
  const text = wiki.data?.extract ?? work.data?.description ?? book.firstSentence;
  const isbn = book.isbns?.[0];
  return (
    <div className="swipe-content">
      <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} size="L" fallbacks={isbn ? [isbnCoverUrl(isbn, 'L')] : []} className="swipe-cover" />
      <div className="swipe-info">
        <div className="row wrap" style={{ gap: 6 }}>
          {hasGerman(book) && <span className="tag teal">🇩🇪 auf Deutsch</span>}
          {book.year && <span className="tag">{book.year}</span>}
          {book.pages && <span className="tag">{book.pages} S.</span>}
        </div>
        <h2 className="mt-1">{book.title}</h2>
        <div className="muted">{book.authors.slice(0, 2).join(', ')}</div>
        {book.rating && (book.ratingsCount ?? 0) >= 3 ? (
          <div className="mt-1">
            <Stars value={book.rating} />
          </div>
        ) : null}
        {!preview && (
          <>
            <div className="chips mt-1">
              {subjects.map((s) => (
                <span key={s} className="tag">
                  {s}
                </span>
              ))}
            </div>
            {text && <p className="swipe-text">{truncate(text, 420)}</p>}
            <Link to={bookPath(book)} onClick={() => rememberBook(book)} className="btn btn-sm btn-ghost">
              Details & Angebote →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

