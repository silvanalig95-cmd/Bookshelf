import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Stars } from '../components/Stars';
import { hasGerman } from '../lib/discovery';
import { useAsync, useProfile, useReadIndex } from '../lib/hooks';
import { settle } from '../lib/http';
import { coverUrl, getWork, isbnCoverUrl } from '../lib/openLibrary';
import { isProfileUsable } from '../lib/profile';
import { drawDeck, type DeckCard } from '../lib/swipeDeck';
import { buildSwipeModel, MODERN_FROM, summarizeModel } from '../lib/swipeModel';
import { displaySubjects, languageLabel } from '../lib/taxonomy';
import { shuffle, truncate } from '../lib/text';
import type { Book, SignalVerdict, TasteSignal } from '../lib/types';
import { readBlurb } from '../lib/blurbCache';
import { contentSummary, germanWikipediaSummary, guessLanguage, type WikiSummary } from '../lib/wikipedia';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';
import { rememberBook, toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

const DECK_SIZE = 16;

interface SessionState {
  liked: Book[];
  count: number;
}

/** Letzte Entscheidung – für „Rückgängig“. */
interface LastDecision {
  card: DeckCard;
  verdict: SignalVerdict;
  previous?: TasteSignal;
  wasSaved: boolean;
}

const ACTIONS: Array<{ verdict: SignalVerdict; label: string; key: string; title: string }> = [
  { verdict: 'dislike', label: 'Nicht meins', key: '←', title: 'Nicht meins – weniger davon' },
  { verdict: 'read', label: 'Gelesen', key: '↓', title: 'Schon gelesen – bewerten' },
  { verdict: 'save', label: 'Merken', key: '↑', title: 'Merken – dieses Buch will ich lesen' },
  { verdict: 'like', label: 'Spannend', key: '→', title: 'Klingt spannend – mehr in diese Richtung' },
];


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
  const [leaving, setLeaving] = useState<SignalVerdict | null>(null);
  const [last, setLast] = useState<LastDecision>();
  const restore = useSignals((s) => s.restore);
  const removeWish = useWishlist((s) => s.remove);
  const [session, setSession] = useState<SessionState>({ liked: [], count: 0 });
  // Alle bisherigen Entscheidungen – auch aus früheren Runden und von anderen Geräten
  const model = useMemo(() => buildSwipeModel(signals), [signals]);
  const summary = useMemo(() => summarizeModel(model), [model]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const seen = useRef(new Set(signals.map((s) => s.bookId)));
  const fetching = useRef(false);

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

  // Das Cover der nächsten Karte schon laden, damit sie sofort da ist
  useEffect(() => {
    const url = next?.coverUrl ?? coverUrl(next?.coverId, 'L');
    if (url) new Image().src = url;
  }, [next?.id]);

  const decide = useCallback(
    (verdict: SignalVerdict) => {
      if (!current || leaving) return;
      setLeaving(verdict);
      const book = current;
      setLast({ card: deck[0], verdict, previous: useSignals.getState().signals.find((x) => x.bookId === book.id), wasSaved: Boolean(useWishlist.getState().items[book.id]) });
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
      }, 180);
    },
    [current, deck, leaving, record, addWish, openRating],
  );

  /** Die letzte Entscheidung zurücknehmen – die Karte liegt danach wieder oben. */
  const undo = useCallback(() => {
    if (!last || leaving) return;
    const book = last.card.book;
    restore(book.id, last.previous);
    if (last.verdict === 'save' && !last.wasSaved) removeWish(book.id);
    setSession((s) => ({ liked: s.liked.filter((b) => b.id !== book.id), count: Math.max(0, s.count - 1) }));
    setDeck((d) => [last.card, ...d.filter((c) => c.book.id !== book.id)]);
    setLast(undefined);
    toast('Rückgängig gemacht');
  }, [last, leaving, restore, removeWish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || document.querySelector('.modal') || e.metaKey || e.ctrlKey || e.altKey) return;
      const keys: Record<string, SignalVerdict> = { ArrowLeft: 'dislike', ArrowRight: 'like', ArrowUp: 'save', ArrowDown: 'read' };
      if (keys[e.key]) {
        e.preventDefault();
        decide(keys[e.key]);
      } else if (e.key === 'z' || e.key === 'Backspace') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, undo]);

  const recentLikes = useMemo(
    () =>
      signals
        .filter((x) => x.verdict === 'like' || x.verdict === 'save')
        .slice(-6)
        .reverse(),
    [signals],
  );

  return (
    <div>
      <div className="page-head">
        <h1>Bücher-Stapel</h1>
        <p className="muted mobile-only small">Spannend = mehr in diese Richtung · Merken = auf die Merkliste</p>
        <p className="muted desk-only">
          Eine Karte nach der anderen: <b>Spannend</b> heisst „mehr in diese Richtung“, <b>Merken</b> legt das Buch zusätzlich auf die Merkliste. Jede
          Entscheidung wird gespeichert und fliesst in alle Empfehlungen ein.
          <span>
            {' '}
            Tastatur: <kbd>←</kbd> <kbd>↓</kbd> <kbd>↑</kbd> <kbd>→</kbd>, rückgängig mit <kbd>Z</kbd>.
          </span>
        </p>
      </div>

      <div className="swipe-layout">
        <div className="deck">
          {current ? (
            <article key={current.id} className={`deck-card ${leaving ? `leaving ${leaving}` : ''}`} aria-live="polite">
              <SwipeCardContent book={current} why={currentWhy} />
            </article>
          ) : (
            <div className="deck-card deck-empty">
              <span className="spinner" /> {loading ? 'Neue Bücher werden gemischt …' : 'Keine Karten mehr – lade nach …'}
            </div>
          )}
          <div className="deck-actions" role="group" aria-label="Entscheidung zu diesem Buch">
            {ACTIONS.map((a) => (
              <button key={a.verdict} className={`deck-btn ${a.verdict}`} onClick={() => decide(a.verdict)} disabled={!current || Boolean(leaving)} title={`${a.title} (${a.key})`}>
                <span className="deck-icon" aria-hidden="true">
                  {a.verdict === 'dislike' ? '✕' : a.verdict === 'read' ? '✓' : <Icon name={a.verdict === 'save' ? 'heart' : 'thumb'} size={22} />}
                </span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
          <div className="deck-sub">
            {last ? (
              <button className="btn btn-sm btn-ghost" onClick={undo}>
                ↺ Rückgängig
              </button>
            ) : (
              <span />
            )}
            <span className="tiny muted">
              {model.total.toLocaleString('de-CH')} Entscheidungen gespeichert{session.count ? ` · ${session.count} in dieser Runde` : ''}
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
              {model.eras.neu.pos + model.eras.neu.neg + model.eras.alt.pos + model.eras.alt.neg >= 6 ? ' (nach deinen Entscheidungen angepasst)' : ''}, bei Weltliteratur mehr Älteres
            </p>
            <p className="tiny muted mt-2 mb-0">Jeder Stapel: etwa drei Viertel nach deinem Geschmack, ein Viertel Neuland, kein Genre über 30 %.</p>
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
              <p className="small muted mb-0">Noch nichts – leg los!</p>
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
  const subjects = displaySubjects(book.subjects, 5);
  const about = describe(book, wiki.data, work.data?.description);
  const isbn = book.isbns?.[0];
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [book.id]);
  return (
    <div className="swipe-content">
      <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} size="L" fallbacks={isbn ? [isbnCoverUrl(isbn, 'L')] : []} className="swipe-cover" />
      <div className="swipe-head-info">
        <div className="small muted">
          {[why, book.year, book.pages ? `${book.pages} Seiten` : undefined, hasGerman(book) ? undefined : 'nicht auf Deutsch'].filter(Boolean).join(' · ')}
        </div>
        <h2>{book.title}</h2>
        <div className="muted">{book.authors.slice(0, 2).join(', ')}</div>
        {book.rating && (book.ratingsCount ?? 0) >= 3 ? (
          <div className="mt-1">
            <Stars value={book.rating} />
          </div>
        ) : null}
      </div>
      {!preview && (
        <div className="swipe-body">
          {subjects.length > 0 && (
            <div className="chips">
              {subjects.map((x) => (
                <span key={x} className="tag">
                  {x}
                </span>
              ))}
            </div>
          )}
          {about && (
            <p className={`swipe-text ${expanded ? 'open' : ''}`} onClick={() => setExpanded(true)}>
              <span className="swipe-src">{about.label}</span>
              {expanded ? about.text : truncate(about.text, 600)}
            </p>
          )}
          <Link to={bookPath(book)} onClick={() => rememberBook(book)} className="small">
            Details & Angebote →
          </Link>
        </div>
      )}
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
