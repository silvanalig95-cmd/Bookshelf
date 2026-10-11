import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Stars } from '../components/Stars';
import { hasGerman } from '../lib/discovery';
import { useAsync, useProfile, useReadIndex } from '../lib/hooks';
import { settle } from '../lib/http';
import { getWork, isbnCoverUrl } from '../lib/openLibrary';
import { isProfileUsable } from '../lib/profile';
import { drawDeck, type DeckCard } from '../lib/swipeDeck';
import { buildSwipeModel, MODERN_FROM, summarizeModel } from '../lib/swipeModel';
import { displaySubjects, languageLabel } from '../lib/taxonomy';
import { shuffle, truncate } from '../lib/text';
import type { Book, SignalVerdict } from '../lib/types';
import { readBlurb } from '../lib/blurbCache';
import { contentSummary, germanWikipediaSummary, guessLanguage, type WikiSummary } from '../lib/wikipedia';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';
import { rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

const THRESHOLD = 110;
const DECK_SIZE = 16;

interface SessionState {
  liked: Book[];
  count: number;
}


export default function Swipe() {
  const language = useSettings((s) => s.language);
  const record = useSignals((s) => s.record);
  const signals = useSignals((s) => s.signals);
  const addWish = useWishlist((s) => s.add);
  const toggleWish = useWishlist((s) => s.toggle);
  const wishItems = useWishlist((s) => s.items);
  const openRating = useUi((s) => s.openRating);
  const profile = useProfile();
  const readIndex = useReadIndex();
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [leaving, setLeaving] = useState<SignalVerdict | null>(null);
  const [session, setSession] = useState<SessionState>({ liked: [], count: 0 });
  // Alle bisherigen Entscheidungen – auch aus früheren Runden und von anderen Geräten
  const model = useMemo(() => buildSwipeModel(signals), [signals]);
  const summary = useMemo(() => summarizeModel(model), [model]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const seen = useRef(new Set(signals.map((s) => s.bookId)));
  const fetching = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const langClause = language === 'any' ? '' : ' language:ger';

  /** Holt neue Karten: Genre-Mix per Thompson-Sampling aus dem Swipe-Modell, dazu Neuland. */
  const refill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const cards = await drawDeck(modelRef.current, {
        size: DECK_SIZE,
        langClause,
        librarySubjects: isProfileUsable(profile) ? shuffle(profile.querySubjects.slice(0, 8)).slice(0, 3) : [],
        usable: (b) => !seen.current.has(b.id) && !readIndex.has(b) && Boolean(b.coverId || b.coverUrl),
        markSeen: (b) => seen.current.add(b.id),
      });
      setDeck((d) => [...d, ...cards]);
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [profile, readIndex, langClause]);

  useEffect(() => {
    if (deck.length < 4) refill();
  }, [deck.length, refill]);

  const current = deck[0]?.book;
  const currentWhy = deck[0]?.why;
  const next = deck[1]?.book;

  const decide = useCallback(
    (verdict: SignalVerdict) => {
      if (!current || leaving) return;
      setLeaving(verdict);
      const book = current;
      record(book, verdict);
      if (verdict === 'save') {
        addWish(book, 'Swipe');
        toast('Auf der Merkliste ♥');
      }
      if (verdict === 'read') openRating(book);
      // Das Modell lernt über die gespeicherten Signale; hier nur die Runde mitzählen
      setSession((s) => ({ liked: verdict === 'like' || verdict === 'save' ? [book, ...s.liked] : s.liked, count: s.count + 1 }));
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

  const recentLikes = useMemo(
    () =>
      signals
        .filter((x) => x.verdict === 'like' || x.verdict === 'save')
        .slice(-6)
        .reverse(),
    [signals],
  );

  const exitX = leaving === 'like' ? 700 : leaving === 'dislike' ? -700 : 0;
  const exitY = leaving === 'save' ? -700 : leaving === 'read' ? 700 : 0;
  const tx = leaving ? exitX : drag.x;
  const ty = leaving ? exitY : drag.y;
  const hint = drag.x > 40 ? 'like' : drag.x < -40 ? 'dislike' : drag.y < -40 ? 'save' : null;

  return (
    <div>
      <div className="page-head">
        <h1>Bücher-Swipe</h1>
        <p>
          Rechts = <b>klingt spannend</b> (mehr in diese Richtung), hoch = <b>merken</b> (dieses Buch will ich lesen – kommt zusätzlich auf die Merkliste),
          links = nicht meins. Jede Entscheidung wird gespeichert und fliesst in den nächsten Stapel und in alle Empfehlungen ein. Tastatur: <kbd>←</kbd>{' '}
          <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
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
              <SwipeCardContent book={current} why={currentWhy} />
            </div>
          )}
          <div className="swipe-actions">
            <span className="swipe-action">
              <button className="swipe-btn nope" onClick={() => decide('dislike')} title="Nicht meins (←)" aria-label="Nicht meins">
                ✕
              </button>
              Nicht meins
            </span>
            <span className="swipe-action">
              <button className="swipe-btn read" onClick={() => decide('read')} title="Schon gelesen (↓)" aria-label="Schon gelesen">
                ✓
              </button>
              Gelesen
            </span>
            <span className="swipe-action">
              <button className="swipe-btn save" onClick={() => decide('save')} title="Merken – auf die Merkliste (↑)" aria-label="Merken">
                <Icon name="heart" size={24} />
              </button>
              Merken
            </span>
            <span className="swipe-action">
              <button className="swipe-btn like" onClick={() => decide('like')} title="Klingt spannend – mehr davon (→)" aria-label="Klingt spannend">
                <Icon name="thumb" size={26} />
              </button>
              Spannend
            </span>
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <h3>Was ich gelernt habe</h3>
            {summary.genres.length ? (
              <div className="bar-list">
                {summary.genres.slice(0, 7).map((g) => (
                  <div key={g.id} className="bar-row" title={`${Math.round(g.evidence)} Entscheidungen`}>
                    <span className="bar-label">{g.label}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${Math.round(g.affinity * 100)}%`, background: 'var(--ink-2)' }} />
                    </span>
                    <span className="bar-value">{Math.round(g.affinity * 100)} %</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted mb-0">Nach ein paar Karten siehst du hier, welche Genres und Themen dich anziehen.</p>
            )}
            {summary.liked.length > 0 && (
              <p className="small mt-1 mb-0">
                <span className="muted">Reizt dich: </span>
                {summary.liked.map((c) => c.label).join(', ')}
              </p>
            )}
            {summary.disliked.length > 0 && (
              <p className="small mt-1 mb-0">
                <span className="muted">Eher nicht: </span>
                {summary.disliked.map((c) => c.label).join(', ')}
              </p>
            )}
            {summary.toExplore.length > 0 && (
              <p className="small mt-1 mb-0">
                <span className="muted">Noch zu entdecken: </span>
                {summary.toExplore.slice(0, 6).join(', ')}
                {summary.toExplore.length > 6 ? ' …' : ''}
              </p>
            )}
            <p className="small mt-1 mb-0">
              <span className="muted">Neu und älter: </span>
              etwa {Math.round(summary.modern * 100)} % seit {MODERN_FROM} erschienen
              {model.eras.neu.pos + model.eras.neu.neg + model.eras.alt.pos + model.eras.alt.neg >= 6 ? ' (nach deinen Swipes angepasst)' : ''}, bei Weltliteratur mehr Älteres
            </p>
            <p className="tiny muted mt-2 mb-0">
              {model.total.toLocaleString('de-CH')} Entscheidungen gespeichert · {session.count} in dieser Runde. Jeder Stapel: etwa drei Viertel nach deinem
              Geschmack, ein Viertel Neuland, kein Genre über 30 %.
            </p>
          </div>
          <div className="card">
            <h3>{session.liked.length ? 'Deine Treffer' : 'Zuletzt gemocht'}</h3>
            {session.liked.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {session.liked.slice(0, 8).map((b) => {
                  const saved = Boolean(wishItems[b.id]);
                  return (
                    <div key={b.id} className="row" style={{ gap: 10 }}>
                      <Link to={bookPath(b)} onClick={() => rememberBook(b)} className="row" style={{ color: 'var(--ink)', flex: 1, minWidth: 0 }}>
                        <Cover title={b.title} coverId={b.coverId} size="S" style={{ width: 34 }} />
                        <span className="small" style={{ lineHeight: 1.25 }}>
                          <b>{b.title}</b>
                          <br />
                          <span className="muted">{b.authors[0]}</span>
                        </span>
                      </Link>
                      {/* „Spannend“ lässt sich hier nachträglich zu „Merken“ machen – und umgekehrt */}
                      <button
                        className={`mini-btn ${saved ? 'on' : ''}`}
                        style={{ boxShadow: 'none', border: '1px solid var(--line)', flexShrink: 0 }}
                        title={saved ? 'Von der Merkliste nehmen' : 'Doch merken'}
                        aria-pressed={saved}
                        onClick={() => {
                          const added = toggleWish(b, 'Swipe');
                          record(b, added ? 'save' : 'like');
                          toast(added ? `„${b.title}“ gemerkt` : 'Von der Merkliste entfernt');
                        }}
                      >
                        {saved ? '♥' : '♡'}
                      </button>
                    </div>
                  );
                })}
                <Link to="/fuer-dich" className="btn btn-sm btn-soft">
                  Passende Empfehlungen →
                </Link>
              </div>
            ) : recentLikes.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {recentLikes.map((x) => (
                  <Link key={x.bookId} to={`/buch/${encodeURIComponent(x.bookId)}`} className="small" style={{ color: 'var(--ink)' }}>
                    <b>{x.title}</b> <span className="muted">· {x.authors[0]}</span>
                  </Link>
                ))}
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

function SwipeCardContent({ book, preview = false, why }: { book: Book; preview?: boolean; why?: string }) {
  const work = useAsync(async (signal) => (preview ? undefined : settle(getWork(book.id, signal))), [book.id, preview]);
  const wikidataId = work.data?.wikidataId;
  const wiki = useAsync(
    async (signal) =>
      preview || work.loading ? undefined : germanWikipediaSummary({ wikidataId, titles: [book.title], author: book.authors[0] }, signal).catch(() => undefined),
    [book.id, preview, work.loading, wikidataId],
  );
  const subjects = displaySubjects(book.subjects, 6);
  const about = describe(book, wiki.data, work.data?.description);
  const isbn = book.isbns?.[0];
  return (
    <div className="swipe-content">
      <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} size="L" fallbacks={isbn ? [isbnCoverUrl(isbn, 'L')] : []} className="swipe-cover" />
      <div className="swipe-info">
        <div className="small muted">
          {[why, book.year, book.pages ? `${book.pages} Seiten` : undefined, hasGerman(book) ? undefined : 'nicht auf Deutsch'].filter(Boolean).join(' · ')}
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
            {about && (
              <p className="swipe-text">
                <span className="swipe-src">{about.label}</span>
                {truncate(about.text, 420)}
              </p>
            )}
            <Link to={bookPath(book)} onClick={() => rememberBook(book)} className="btn btn-sm btn-ghost">
              Details & Angebote →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Was auf der Karte steht – der Inhalt zuerst: KI-Kurzfassung (falls schon erzeugt), Ausgangslage
 * aus dem Wikipedia-Abschnitt „Handlung“, inhaltliche Sätze der Einleitung, Klappentext. Angaben
 * zu Verlag und Erfolg nur, wenn es sonst nichts gibt.
 */
function describe(book: Book, wiki: WikiSummary | undefined, blurb: string | undefined): { label: string; text: string } | undefined {
  const ai = readBlurb(book.id);
  if (ai) return { label: 'Worum es geht', text: ai.text };
  const content = wiki ? contentSummary(wiki, 420) : undefined;
  if (content) return { label: 'Worum es geht', text: content.text };
  if (blurb) {
    const lang = guessLanguage(blurb);
    return { label: lang && lang !== 'ger' ? `Klappentext (${languageLabel(lang)})` : 'Klappentext', text: blurb };
  }
  if (wiki) return { label: 'Über das Buch', text: wiki.extract };
  if (book.firstSentence) return { label: 'So beginnt es', text: `„${book.firstSentence}“` };
  return undefined;
}
