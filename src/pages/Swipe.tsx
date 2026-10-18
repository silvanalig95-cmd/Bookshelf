import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Stars } from '../components/Stars';
import { hasGerman } from '../lib/discovery';
import { useAiConfig, useAsync, useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { coverUrl, isbnCoverUrl } from '../lib/openLibrary';
import { isProfileUsable } from '../lib/profile';
import { drawDeck, type DeckCard } from '../lib/swipeDeck';
import { buildSwipeModel, MODERN_FROM, summarizeModel } from '../lib/swipeModel';
import { displaySubjects, languageLabel } from '../lib/taxonomy';
import { shuffle, truncate } from '../lib/text';
import type { Book, SignalVerdict, TasteSignal } from '../lib/types';
import { fitSentence } from '../lib/aiPrompts';
import { loadBookTexts, richGermanText, wikiMaterial, type BookTexts } from '../lib/bookTexts';
import { contentSummary, guessLanguage } from '../lib/wikipedia';
import { autoBlurb, autoBlurbPaused, prepareBlurb, useBlurbs, type BlurbView } from '../store/blurbs';
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
  { verdict: 'save', label: 'Merken', key: '↑', title: 'Merken – dieses Buch will ich lesen: kommt auf die Merkliste und zählt auch als „mehr davon“' },
  { verdict: 'like', label: 'Mehr davon', key: '→', title: 'Mehr davon – die Richtung stimmt, das Buch selbst muss es nicht sein' },
];


export default function Swipe() {
  const language = useSettings((s) => s.language);
  const googleApiKey = useSettings((s) => s.googleApiKey);
  const region = useSettings((s) => s.region);
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

  // Beschreibungen für die oberste und die zwei nächsten Karten vorbereiten: deutsche Texte suchen und –
  // nur wo keiner taugt – die KI eine deutsche Kurzbeschreibung schreiben lassen (eine nach der anderen)
  const aiConfig = useAiConfig();
  const autoOn = useSettings((s) => s.autoBlurb);
  const entries = useLibraryEntries();
  const upcoming = useRef(new Set<string>());
  upcoming.current = new Set(deck.slice(0, 3).map((c) => c.book.id));
  const jobBase = useRef({ aiConfig, entries, profile, googleApiKey, region });
  jobBase.current = { aiConfig, entries, profile, googleApiKey, region };
  const top3 = deck
    .slice(0, 3)
    .map((c) => c.book.id)
    .join('|');
  useEffect(() => {
    for (const card of deck.slice(0, 3)) {
      const book = card.book;
      prepareBlurb(async () => {
        if (!upcoming.current.has(book.id)) return; // schon weitergeblättert
        const base = jobBase.current;
        const texts = await loadBookTexts(book, { googleApiKey: base.googleApiKey, country: base.region });
        const needsAi = !richGermanText(texts);
        await autoBlurb(
          book,
          needsAi && base.aiConfig && upcoming.current.has(book.id)
            ? { config: base.aiConfig, entries: base.entries, profile: base.profile, description: texts.description, wiki: wikiMaterial(texts.wiki) }
            : undefined,
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top3, Boolean(aiConfig)]);
  const aiPossible = Boolean(aiConfig) && autoOn && !autoBlurbPaused();

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
        <p className="muted mobile-only small">Mehr davon = die Richtung stimmt · Merken = dieses Buch will ich lesen (zählt auch als „mehr davon“)</p>
        <p className="muted desk-only">
          Eine Entscheidung pro Karte. <b>Mehr davon</b>: Die Richtung stimmt – das Buch selbst muss es nicht sein. <b>Merken</b>: Dieses Buch willst du
          lesen; es kommt auf die Merkliste und zählt auch als „mehr davon“, sogar etwas stärker. Beides zusammen braucht es nie. Jede Entscheidung wird
          gespeichert und fliesst in alle Empfehlungen ein.
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
              <SwipeCardContent book={current} why={currentWhy} aiPossible={aiPossible} />
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
                        <Cover title={b.title} coverId={b.coverId} isbn={b.isbns?.[0]} size="S" style={{ width: 34 }} />
                        <span className="small" style={{ lineHeight: 1.25 }}>
                          <b>{b.title}</b>
                          <br />
                          <span className="muted">{b.authors[0]}</span>
                        </span>
                      </Link>
                      {/* „Mehr davon“ lässt sich hier nachträglich zu „Merken“ machen – und umgekehrt */}
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

function SwipeCardContent({ book, preview = false, why, aiPossible = false }: { book: Book; preview?: boolean; why?: string; aiPossible?: boolean }) {
  const { googleApiKey, region } = useSettings();
  const texts = useAsync(async (signal) => (preview ? undefined : loadBookTexts(book, { googleApiKey, country: region, signal })), [book.id, preview]);
  const view = useBlurbs((s) => s.items[book.id]);
  const subjects = displaySubjects(book.subjects, 5);
  const about = preview ? undefined : cardText(book, texts.data, texts.loading, view, aiPossible);
  const isbn = book.isbns?.[0];
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [book.id]);
  return (
    <div className="swipe-content">
      <Cover title={book.title} author={book.authors[0]} coverId={book.coverId} src={book.coverUrl} isbn={isbn} size="L" fallbacks={isbn ? [isbnCoverUrl(isbn, 'L')] : []} className="swipe-cover" />
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
          {about === 'waiting' ? (
            <p className="swipe-text muted">
              <span className="spinner" /> {texts.loading ? 'Beschreibung wird gesucht …' : 'Deutsche Kurzbeschreibung wird geschrieben …'}
            </p>
          ) : about ? (
            <div className={`swipe-text ${expanded ? 'open' : ''}`} onClick={() => setExpanded(true)}>
              <span className="swipe-src">{about.label}</span>
              {(expanded ? about.text : truncate(about.text, 750))
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((p, i) => (
                  <p key={i} className="mb-0">
                    {p.trim()}
                  </p>
                ))}
              {about.fit && <p className="swipe-fit mb-0">{about.fit}</p>}
              {about.source && <span className="tiny muted">{about.source}</span>}
            </div>
          ) : null}
          {/* In einem neuen Tab – der Stapel bleibt, wo er ist */}
          <Link to={bookPath(book)} target="_blank" rel="noopener" onClick={() => rememberBook(book)} className="small">
            Details & Angebote ↗
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Was auf der Karte steht – der Inhalt zuerst, auf Deutsch:
 *   1. ein gehaltvoller deutscher Text (Wikipedia, deutscher Klappentext), dazu – falls schon
 *      vorhanden – der Satz „Passt zu dir, weil …“ aus der KI-Kurzbeschreibung
 *   2. sonst die KI-Kurzbeschreibung (wird bei Bedarf geschrieben – kurz warten)
 *   3. erst ohne KI (Kontingent aufgebraucht): was es sonst gibt, auch Fremdsprachiges
 */
function cardText(
  book: Book,
  texts: BookTexts | undefined,
  loading: boolean,
  view: BlurbView | undefined,
  aiPossible: boolean,
): { label: string; text: string; fit?: string; source?: string } | 'waiting' | undefined {
  if (!texts && loading) return view?.text ? { label: 'Worum es geht', text: view.text, source: 'KI-Kurzbeschreibung' } : 'waiting';
  const rich = texts ? richGermanText(texts, 800) : undefined;
  if (rich) return { label: rich.label, text: rich.text, fit: view?.text ? fitSentence(view.text) : undefined, source: rich.source };
  if (view?.text) return { label: 'Worum es geht', text: view.text, source: view.busy ? undefined : `KI-Kurzbeschreibung${view.model ? ` · ${view.model}` : ''}` };
  if (aiPossible && !view?.error && (view?.busy || view?.pending || !view?.checked)) return 'waiting';
  return fallbackText(book, texts);
}

function fallbackText(book: Book, texts: BookTexts | undefined): { label: string; text: string; source?: string } | undefined {
  const wiki = texts?.wiki;
  const content = wiki ? contentSummary(wiki, 700) : undefined;
  if (content) return { label: 'Worum es geht', text: content.text, source: 'Wikipedia' };
  const blurb = texts?.description;
  if (blurb) {
    const lang = guessLanguage(blurb);
    return { label: lang && lang !== 'ger' ? `Klappentext (${languageLabel(lang)})` : 'Klappentext', text: blurb };
  }
  if (wiki) return { label: 'Über das Buch', text: wiki.extract, source: 'Wikipedia' };
  if (book.firstSentence) return { label: 'So beginnt es', text: `„${book.firstSentence}“` };
  return undefined;
}
