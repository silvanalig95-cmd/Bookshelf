import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookCard, BookGrid } from '../components/BookCard';
import { BookSearchBox } from '../components/BookSearchBox';
import { Empty, SkeletonGrid } from '../components/Feedback';
import type { AiRecommendResult } from '../lib/ai';
import { aiAvailability, aiConfigFor, type AiAccess } from '../lib/aiStatus';
import {
  DEFAULT_PARAMS,
  describeSearch,
  hasCriteria,
  interpretWish,
  runDiscovery,
  type DiscoveryParams,
  type DiscoverySort,
} from '../lib/discovery';
import { errorMessage, useDebounced, useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { getBookByWorkId } from '../lib/openLibrary';
import { resolveBook } from '../lib/resolve';
import { toRef, understandWish } from '../lib/wish';
import { ERAS, GENRES, MOODS, PLACES } from '../lib/taxonomy';
import { pickRandom, shuffle, uniqBy } from '../lib/text';
import type { Book, ScoredBook } from '../lib/types';
import { useDiscover } from '../store/discover';
import { useSettings } from '../store/settings';
import { recallBook, rememberBook } from '../store/ui';

const LENGTH_PRESETS = [
  { id: 'novelle', label: '🪶 Novelle', min: undefined, max: 180 },
  { id: 'kurz', label: '⏱️ Kurz', min: undefined, max: 300 },
  { id: 'mittel', label: '📘 Mittel', min: 250, max: 450 },
  { id: 'dick', label: '📚 Dick', min: 450, max: undefined },
  { id: 'waelzer', label: '🧱 Wälzer', min: 700, max: undefined },
] as const;

const YEAR = new Date().getFullYear();
const YEAR_PRESETS = [
  { id: 'neu', label: '✨ Neuerscheinungen', from: YEAR - 2, to: undefined },
  { id: '21', label: '📱 Seit 2000', from: 2000, to: undefined },
  { id: 'modern', label: '📻 1945–1999', from: 1945, to: 1999 },
  { id: 'alt', label: '🎩 Vor 1945', from: undefined, to: 1944 },
] as const;


function Section({ title, count, children, open = false }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="filter-section" open={open}>
      <summary>
        <span>
          {title}
          {count ? <span className="count">{count}</span> : null}
        </span>
      </summary>
      <div className="fs-body">{children}</div>
    </details>
  );
}

function Slider({
  label,
  left,
  right,
  middle = 'egal',
  help,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  middle?: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const names = [`sehr ${left}`, left, middle, right, `sehr ${right}`];
  return (
    <div className="slider-row" style={{ marginBottom: 14 }}>
      <div className="row between">
        <span className="label">{label}</span>
        <span className={`tag ${value ? 'accent' : ''}`}>{names[value + 2]}</span>
      </div>
      <input className="range" type="range" min={-2} max={2} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <div className="slider-labels">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      {help && <span className="help">{help}</span>}
    </div>
  );
}

function randomParams(base: DiscoveryParams): DiscoveryParams {
  const genre = pickRandom(GENRES.filter((g) => g.group === 'fiction'))!;
  const moods = shuffle(MOODS).slice(0, 1 + Math.floor(Math.random() * 2));
  return {
    ...DEFAULT_PARAMS,
    language: base.language,
    hideRead: base.hideRead,
    useTaste: base.useTaste,
    genres: [genre.id],
    moods: moods.map((m) => m.id),
    places: Math.random() < 0.35 ? [pickRandom(PLACES)!.id] : [],
    eras: Math.random() < 0.25 ? [pickRandom(ERAS)!.id] : [],
    tempo: Math.random() < 0.5 ? Math.floor(Math.random() * 5) - 2 : 0,
    fame: Math.random() < 0.3 ? -1 : 0,
  };
}

interface AiState {
  loading: boolean;
  error?: string;
  result?: AiRecommendResult;
  books: ScoredBook[];
  forWish?: string;
}

export default function Discover() {
  const { params, setParams, replaceParams, results, resultKey, page, total, wish, setResults, dismiss, reset } = useDiscover();
  const settings = useSettings();
  const entries = useLibraryEntries();
  const profile = useProfile();
  const readIndex = useReadIndex();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [wishDraft, setWishDraft] = useState(params.wish);
  const [textDraft, setTextDraft] = useState(params.text);
  const [excludeDraft, setExcludeDraft] = useState('');
  const [ai, setAi] = useState<AiAccess>({ available: false });
  const aiName = ai.provider === 'claude' ? 'Claude' : 'Gemini';
  const [aiState, setAiState] = useState<AiState>({ loading: false, books: [] });
  const [visible, setVisible] = useState(40);
  const controllerRef = useRef<AbortController | null>(null);
  const hasProfile = Boolean(profile && profile.topConcepts.length >= 3);

  useEffect(() => {
    aiAvailability(settings).then(setAi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.aiProvider, settings.aiApiKey, settings.geminiApiKey]);
  useEffect(() => setWishDraft(params.wish), [params.wish]);
  useEffect(() => setTextDraft(params.text), [params.text]);

  // URL-Parameter (von der Startseite, Buchseiten usw.) einmalig übernehmen
  useEffect(() => {
    const q = searchParams.get('q');
    const m = searchParams.get('m');
    const g = searchParams.get('g');
    const autor = searchParams.get('autor');
    const aehnlich = searchParams.get('aehnlich');
    if (!q && !m && !g && !autor && !aehnlich) return;
    const next: DiscoveryParams = { ...DEFAULT_PARAMS, language: settings.language, hideRead: params.hideRead, useTaste: params.useTaste };
    if (q) {
      const interp = interpretWish(q);
      const looksLikeWish = interp.genres.length + interp.moods.length + interp.places.length + interp.eras.length > 0 || interp.similarTitles.length > 0 || q.trim().split(/\s+/).length > 5;
      if (looksLikeWish) next.wish = q;
      else next.text = q;
    }
    if (m) next.moods = [m];
    if (g) next.genres = [g];
    if (autor) next.author = autor;
    replaceParams(next);
    setWishDraft(next.wish);
    setTextDraft(next.text);
    if (aehnlich) {
      const cached = recallBook(aehnlich);
      if (cached) setParams({ similarTo: [toRef(cached)] });
      else getBookByWorkId(aehnlich).then((b) => b && setParams({ similarTo: [toRef(b)] }));
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileKey = hasProfile ? `${profile!.itemCount}:${profile!.signalCount}` : 'none';
  const key = useMemo(() => JSON.stringify({ ...params, sort: undefined }) + '|' + profileKey, [params, profileKey]);
  const debouncedKey = useDebounced(key, 650);

  const run = useCallback(
    async (pageNum: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      pageNum === 0 ? setLoading(true) : setLoadingMore(true);
      setError('');
      try {
        const p = useDiscover.getState().params;
        const { wish: interp, similar, lookup } = await understandWish(p, controller.signal);
        const res = await runDiscovery(
          p,
          { profile: hasProfile ? profile : undefined, readIndex, wish: interp, similar, lookup, googleApiKey: settings.googleApiKey, region: settings.region },
          pageNum,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const dismissedSet = new Set(useDiscover.getState().dismissed);
        const fresh = res.results.filter((r) => !dismissedSet.has(r.book.id));
        fresh.forEach((r) => rememberBook(r.book));
        const list = pageNum === 0 ? fresh : uniqBy([...useDiscover.getState().results, ...fresh], (r) => r.book.id);
        setResults(debouncedKey, list, res.total, pageNum, interp);
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedKey, hasProfile, profile, readIndex, settings.googleApiKey, settings.region, setResults],
  );

  useEffect(() => {
    if (debouncedKey === resultKey && results.length) return;
    setVisible(40);
    run(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey]);

  // Sortierung ohne neue Anfrage anwenden
  const sorted = useMemo(() => {
    const list = [...results];
    const s = params.sort;
    if (s === 'match') return list.sort((a, b) => b.score - a.score);
    if (s === 'rating') return list.sort((a, b) => (b.book.rating ?? 0) * Math.min(1, (b.book.ratingsCount ?? 0) / 5) - (a.book.rating ?? 0) * Math.min(1, (a.book.ratingsCount ?? 0) / 5));
    if (s === 'popular') return list.sort((a, b) => (b.book.popularity ?? 0) - (a.book.popularity ?? 0));
    if (s === 'new') return list.sort((a, b) => (b.book.year ?? 0) - (a.book.year ?? 0));
    if (s === 'old') return list.sort((a, b) => (a.book.year ?? 9999) - (b.book.year ?? 9999));
    return shuffle(list);
  }, [results, params.sort]);

  const askAi = async () => {
    const w = (wishDraft || params.wish || params.text).trim();
    const config = aiConfigFor(ai, settings);
    if (!w || !config) return;
    setAiState({ loading: true, books: [], forWish: w });
    // Die KI-Anbindung erst bei Bedarf laden
    const { aiErrorMessage, aiRecommend, readingContext } = await import('../lib/ai');
    try {
      const context = readingContext(entries, profile);
      const result = await aiRecommend(w, config, context);
      const resolved = await Promise.all(
        result.recommendations.map(async (rec) => {
          const book = await resolveBook(rec.title, rec.author).catch(() => undefined);
          const fallback: Book = {
            id: `ai:${rec.title}`,
            title: rec.title,
            authors: [rec.author],
            year: rec.year ?? undefined,
            subjects: [],
            languages: rec.german_edition ? ['ger'] : [],
            source: 'ai',
          };
          const b = book ?? fallback;
          rememberBook(b);
          const scored: ScoredBook = {
            book: b,
            score: 0,
            match: 0,
            reasons: [{ kind: 'ai', label: `✨ ${rec.why}` }, ...rec.tags.slice(0, 2).map((t) => ({ kind: 'keyword' as const, label: t }))],
            alreadyRead: readIndex.has(b),
          };
          return scored;
        }),
      );
      setAiState({ loading: false, result, books: resolved.filter((r) => !r.alreadyRead), forWish: w });
    } catch (err) {
      setAiState({ loading: false, books: [], error: aiErrorMessage(err), forWish: w });
    }
  };

  const applyAiParams = () => {
    const s = aiState.result?.search;
    if (!s) return;
    setParams({
      genres: s.genres,
      moods: s.moods,
      places: s.places,
      eras: s.eras,
      pagesMax: s.pages_max ?? undefined,
      pagesMin: s.pages_min ?? undefined,
      text: s.keywords.slice(0, 2).join(' '),
    });
    setTextDraft(s.keywords.slice(0, 2).join(' '));
  };

  const toggleGenre = (id: string) => {
    if (params.genres.includes(id)) setParams({ genres: params.genres.filter((x) => x !== id), excludeGenres: [...params.excludeGenres, id] });
    else if (params.excludeGenres.includes(id)) setParams({ excludeGenres: params.excludeGenres.filter((x) => x !== id) });
    else setParams({ genres: [...params.genres, id] });
  };
  const toggleIn = (field: 'moods' | 'places' | 'eras', id: string) => {
    const list = params[field];
    setParams({ [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } as Partial<DiscoveryParams>);
  };
  const commitWish = () => wishDraft !== params.wish && setParams({ wish: wishDraft });
  const commitText = () => textDraft !== params.text && setParams({ text: textDraft });

  const favoritesForSimilar = useMemo(
    () =>
      entries
        .filter((e) => e.shelf === 'read' && e.rating >= 5 && e.subjects?.length)
        .sort((a, b) => (b.dateRead ?? '').localeCompare(a.dateRead ?? ''))
        .slice(0, 8),
    [entries],
  );

  const summary = describeSearch(params, wish);
  const criteria = hasCriteria(params);
  const lengthActive = LENGTH_PRESETS.find((l) => l.min === params.pagesMin && l.max === params.pagesMax)?.id;
  const yearActive = YEAR_PRESETS.find((y) => y.from === params.yearFrom && y.to === params.yearTo)?.id;

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Ausführliche Suche</p>
        <h1>Was möchtest du lesen?</h1>
        <p>Kombiniere so viele Angaben, wie du magst – jede Änderung aktualisiert die Treffer sofort. Die Prozentzahl zeigt, wie gut ein Buch zu allem passt.</p>
      </div>

      <div className="discover">
        <aside className="filters card" aria-label="Suchkriterien" style={{ padding: '6px 18px' }}>
          <Section title="💬 Dein Wunsch & Stichwörter" open count={(params.wish ? 1 : 0) + (params.text ? 1 : 0)}>
            <div className="field">
              <label htmlFor="wish">In eigenen Worten</label>
              <textarea
                id="wish"
                className="textarea"
                value={wishDraft}
                placeholder="z. B. „Etwas wie Der Schatten des Windes, aber in Wien und nicht so lang – gern mit Buchhandlung“"
                onChange={(e) => setWishDraft(e.target.value)}
                onBlur={commitWish}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitWish();
                }}
              />
              <div className="row between wrap">
                <button className="btn btn-sm btn-dark" onClick={commitWish} disabled={wishDraft === params.wish}>
                  Wunsch anwenden
                </button>
                {ai.available ? (
                  <button className="btn btn-sm btn-soft" onClick={askAi} disabled={aiState.loading || !(wishDraft || params.wish || params.text).trim()}>
                    ✨ {aiState.loading ? `${aiName} denkt nach …` : 'KI fragen'}
                  </button>
                ) : (
                  <Link to="/einstellungen#ki" className="small">
                    ✨ KI-Empfehlungen aktivieren
                  </Link>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="text">Stichwörter, Titel oder Autor:in</label>
              <input
                id="text"
                className="input"
                value={textDraft}
                placeholder="z. B. Leuchtturm, Bibliothek, Zafón …"
                onChange={(e) => setTextDraft(e.target.value)}
                onBlur={commitText}
                onKeyDown={(e) => e.key === 'Enter' && commitText()}
              />
            </div>
          </Section>

          <Section title="🎭 Genres" open count={params.genres.length + params.excludeGenres.length}>
            <p className="help" style={{ marginTop: 0 }}>
              1× tippen = will ich · 2× = bitte nicht · 3× = egal
            </p>
            <div className="chips">
              {GENRES.map((g) => (
                <button
                  key={g.id}
                  className={`chip ${params.genres.includes(g.id) ? 'on' : params.excludeGenres.includes(g.id) ? 'off' : ''}`}
                  onClick={() => toggleGenre(g.id)}
                  aria-pressed={params.genres.includes(g.id)}
                >
                  {g.emoji} {g.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="🌈 Stimmung" open count={params.moods.length}>
            <div className="chips">
              {MOODS.map((m) => (
                <button key={m.id} className={`chip ${params.moods.includes(m.id) ? 'on' : ''}`} onClick={() => toggleIn('moods', m.id)} title={m.hint} aria-pressed={params.moods.includes(m.id)}>
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="🎚️ Tempo, Anspruch & Bekanntheit" count={[params.tempo, params.depth, params.fame].filter(Boolean).length}>
            <Slider label="Tempo" left="ruhig" right="rasant" value={params.tempo} onChange={(v) => setParams({ tempo: v })} />
            <Slider label="Anspruch" left="leicht" right="anspruchsvoll" value={params.depth} onChange={(v) => setParams({ depth: v })} />
            <Slider
              label="Bekanntheit"
              left="Geheimtipp"
              right="Bestseller"
              middle="ausgewogen"
              help="„Ausgewogen“ bevorzugt bekannte, oft gelesene Bücher. Nach links für Unbekanntes und Geheimtipps."
              value={params.fame}
              onChange={(v) => setParams({ fame: v })}
            />
          </Section>

          <Section title="📏 Länge" count={params.pagesMin || params.pagesMax ? 1 : 0}>
            <div className="chips">
              {LENGTH_PRESETS.map((l) => (
                <button
                  key={l.id}
                  className={`chip ${lengthActive === l.id ? 'on' : ''}`}
                  onClick={() => setParams(lengthActive === l.id ? { pagesMin: undefined, pagesMax: undefined } : { pagesMin: l.min, pagesMax: l.max })}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="row mt-1">
              <input
                className="input"
                type="number"
                min={0}
                placeholder="min. Seiten"
                value={params.pagesMin ?? ''}
                onChange={(e) => setParams({ pagesMin: e.target.value ? Number(e.target.value) : undefined })}
                aria-label="Mindestens Seiten"
              />
              <span className="muted">–</span>
              <input
                className="input"
                type="number"
                min={0}
                placeholder="max. Seiten"
                value={params.pagesMax ?? ''}
                onChange={(e) => setParams({ pagesMax: e.target.value ? Number(e.target.value) : undefined })}
                aria-label="Höchstens Seiten"
              />
            </div>
          </Section>

          <Section title="📍 Schauplatz" count={params.places.length + (params.placeText ? 1 : 0)}>
            <div className="chips">
              {PLACES.map((p) => (
                <button key={p.id} className={`chip ${params.places.includes(p.id) ? 'on' : ''}`} onClick={() => toggleIn('places', p.id)}>
                  {p.emoji} {p.label}
                </button>
              ))}
            </div>
            <input
              className="input mt-1"
              placeholder="Eigener Ort (englisch, z. B. Lisbon, Vienna) …"
              defaultValue={params.placeText}
              onBlur={(e) => e.target.value !== params.placeText && setParams({ placeText: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && setParams({ placeText: (e.target as HTMLInputElement).value })}
            />
          </Section>

          <Section title="🕰️ Epoche & Erscheinungsjahr" count={params.eras.length + (params.yearFrom || params.yearTo ? 1 : 0)}>
            <div className="label">Die Handlung spielt …</div>
            <div className="chips mt-1">
              {ERAS.map((e) => (
                <button key={e.id} className={`chip ${params.eras.includes(e.id) ? 'on' : ''}`} onClick={() => toggleIn('eras', e.id)}>
                  {e.emoji} {e.label}
                </button>
              ))}
            </div>
            <div className="label mt-2">Erschienen …</div>
            <div className="chips mt-1">
              {YEAR_PRESETS.map((y) => (
                <button
                  key={y.id}
                  className={`chip ${yearActive === y.id ? 'on' : ''}`}
                  onClick={() => setParams(yearActive === y.id ? { yearFrom: undefined, yearTo: undefined } : { yearFrom: y.from, yearTo: y.to })}
                >
                  {y.label}
                </button>
              ))}
            </div>
            <div className="row mt-1">
              <input className="input" type="number" placeholder="von" value={params.yearFrom ?? ''} onChange={(e) => setParams({ yearFrom: e.target.value ? Number(e.target.value) : undefined })} aria-label="Erschienen ab" />
              <span className="muted">–</span>
              <input className="input" type="number" placeholder="bis" value={params.yearTo ?? ''} onChange={(e) => setParams({ yearTo: e.target.value ? Number(e.target.value) : undefined })} aria-label="Erschienen bis" />
            </div>
          </Section>

          <Section title="🔁 Ähnlich wie …" count={params.similarTo.length}>
            <BookSearchBox placeholder="Buch suchen und hinzufügen …" onPick={(b) => setParams({ similarTo: uniqBy([...params.similarTo, toRef(b)], (r) => r.id) })} />
            {params.similarTo.length > 0 && (
              <div className="chips mt-1">
                {params.similarTo.map((r) => (
                  <button key={r.id} className="chip on" onClick={() => setParams({ similarTo: params.similarTo.filter((x) => x.id !== r.id) })}>
                    {r.title} <span className="x">✕</span>
                  </button>
                ))}
              </div>
            )}
            {favoritesForSimilar.length > 0 && (
              <>
                <div className="help mt-1">Aus deinen 5★-Büchern:</div>
                <div className="chips mt-1">
                  {favoritesForSimilar.map((e) => (
                    <button
                      key={e.id}
                      className="chip"
                      onClick={() =>
                        setParams({
                          similarTo: uniqBy([...params.similarTo, { id: e.workKey?.replace('/works/', '') ?? e.id, title: e.title, authors: e.authors, subjects: e.subjects ?? [] }], (r) => r.id),
                        })
                      }
                    >
                      ＋ {e.title.length > 34 ? `${e.title.slice(0, 32)}…` : e.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Section>

          <Section title="✍️ Autor:in & Figuren" count={(params.author ? 1 : 0) + (params.character ? 1 : 0)}>
            <div className="field">
              <label htmlFor="author">Autor:in</label>
              <input id="author" className="input" defaultValue={params.author} key={`a-${params.author}`} placeholder="z. B. Juli Zeh" onBlur={(e) => setParams({ author: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && setParams({ author: (e.target as HTMLInputElement).value })} />
            </div>
            <div className="field">
              <label htmlFor="character">Figur / Person</label>
              <input id="character" className="input" defaultValue={params.character} placeholder="z. B. Sherlock Holmes, Napoleon" onBlur={(e) => setParams({ character: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && setParams({ character: (e.target as HTMLInputElement).value })} />
            </div>
          </Section>

          <Section title="🚫 Ausschliessen" count={params.excludeWords.length + params.excludeGenres.length}>
            <div className="input-group">
              <input
                className="input"
                value={excludeDraft}
                placeholder="Wort ausschliessen, z. B. vampire"
                onChange={(e) => setExcludeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && excludeDraft.trim()) {
                    setParams({ excludeWords: [...params.excludeWords, excludeDraft.trim()] });
                    setExcludeDraft('');
                  }
                }}
              />
            </div>
            <div className="chips mt-1">
              {params.excludeWords.map((w) => (
                <button key={w} className="chip off" onClick={() => setParams({ excludeWords: params.excludeWords.filter((x) => x !== w) })}>
                  {w} ✕
                </button>
              ))}
              {params.excludeGenres.map((id) => (
                <button key={id} className="chip off" onClick={() => setParams({ excludeGenres: params.excludeGenres.filter((x) => x !== id) })}>
                  {GENRES.find((g) => g.id === id)?.label} ✕
                </button>
              ))}
            </div>
            <p className="help">Englische Begriffe treffen die Schlagwörter von Open Library am besten.</p>
          </Section>

          <Section title="⚙️ Sprache, Bewertung & Mehr">
            <div className="label">Sprache</div>
            <div className="segmented mt-1">
              {(
                [
                  ['de-first', 'Deutsch bevorzugt'],
                  ['de-only', 'Nur Deutsch'],
                  ['any', 'Egal'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={params.language === id ? 'on' : ''} onClick={() => setParams({ language: id })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="label mt-2">Mindestbewertung</div>
            <div className="segmented mt-1">
              {[0, 3.5, 4, 4.3].map((r) => (
                <button key={r} className={params.minRating === r ? 'on' : ''} onClick={() => setParams({ minRating: r })}>
                  {r ? `★ ${r}+` : 'egal'}
                </button>
              ))}
            </div>
            <div className="stack mt-2" style={{ gap: 10 }}>
              <label className="toggle">
                <input type="checkbox" checked={params.hideRead} onChange={(e) => setParams({ hideRead: e.target.checked })} />
                Gelesene Bücher ausblenden
              </label>
              <label className="toggle">
                <input type="checkbox" checked={params.useTaste} onChange={(e) => setParams({ useTaste: e.target.checked })} disabled={!hasProfile} />
                Mein Geschmacksprofil einbeziehen {!hasProfile && <span className="muted small">(Bibliothek fehlt)</span>}
              </label>
            </div>
          </Section>
        </aside>

        <section aria-label="Treffer">
          <div className="summary-bar">
            <span className="lead">{criteria ? 'Du suchst:' : 'Noch keine Kriterien –'}</span>
            {criteria ? summary.map((s) => <span key={s} className="tag accent">{s}</span>) : <span className="muted">hier sind beliebte Bücher auf Deutsch. Wähle links, was dich reizt!</span>}
            <span className="spacer" />
            <button className="btn btn-sm btn-soft" onClick={() => replaceParams(randomParams(params))} title="Zufällige Kombination">
              🎲 Würfeln
            </button>
            {criteria && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  reset();
                  setWishDraft('');
                  setTextDraft('');
                  setAiState({ loading: false, books: [] });
                }}
              >
                ↺ Zurücksetzen
              </button>
            )}
          </div>

          {(aiState.loading || aiState.result || aiState.error) && (
            <div className="card" style={{ marginBottom: 22, borderColor: 'var(--violet)', background: 'linear-gradient(135deg, var(--violet-soft), transparent 60%), var(--surface)' }}>
              <div className="row between wrap">
                <span className="ai-badge">✨ {aiName} empfiehlt</span>
                {aiState.result && (
                  <button className="btn btn-sm" onClick={applyAiParams}>
                    Suchparameter übernehmen
                  </button>
                )}
              </div>
              {aiState.loading && (
                <div className="loading-line">
                  <span className="spinner" /> {aiName} blättert durch die Regale und denkt über „{aiState.forWish}“ nach …
                </div>
              )}
              {aiState.error && <p className="mt-1" style={{ color: 'var(--rose)' }}>{aiState.error}</p>}
              {aiState.result && (
                <>
                  <p className="mt-1" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.05rem' }}>
                    {aiState.result.understanding}
                  </p>
                  {aiState.result.note && <p className="small muted">ℹ️ {aiState.result.note}</p>}
                  <div className="book-grid">
                    {aiState.books.map((s, i) => (
                      <BookCard key={s.book.id} book={s.book} scored={{ ...s, match: 0 }} index={i} maxReasons={3} origin="KI-Wunsch" />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="results-head">
            <span className="muted small">
              {loading ? 'Suche läuft …' : `${sorted.length} passende Bücher${total > sorted.length ? ` · ${total.toLocaleString('de-CH')} Kandidaten in Open Library` : ''}`}
            </span>
            <label className="row small" style={{ gap: 8 }}>
              Sortieren:
              <select className="select" style={{ width: 'auto', padding: '7px 12px' }} value={params.sort} onChange={(e) => setParams({ sort: e.target.value as DiscoverySort })}>
                <option value="match">Beste Übereinstimmung</option>
                <option value="rating">Bewertung</option>
                <option value="popular">Beliebtheit</option>
                <option value="new">Neueste</option>
                <option value="old">Älteste</option>
                <option value="random">Zufall</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="notice rose" style={{ marginBottom: 16 }}>
              <span className="notice-icon">⚠️</span>
              <div>
                {error}{' '}
                <button className="btn btn-sm" onClick={() => run(0)}>
                  Nochmal
                </button>
              </div>
            </div>
          )}

          {loading && !sorted.length ? (
            <SkeletonGrid count={12} />
          ) : sorted.length ? (
            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
              <BookGrid
                items={sorted.slice(0, visible)}
                origin="Entdecken"
                onDismiss={(b) => {
                  dismiss(b.id);
                  setResults(resultKey, results.filter((r) => r.book.id !== b.id), total, page, wish);
                }}
              />
              <div className="center mt-3">
                {visible < sorted.length ? (
                  <button className="btn btn-lg" onClick={() => setVisible((v) => v + 40)}>
                    Mehr anzeigen ({sorted.length - visible} weitere)
                  </button>
                ) : (
                  <button
                    className="btn btn-lg"
                    onClick={() => {
                      setVisible((v) => v + 40);
                      run(page + 1);
                    }}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Lädt …' : 'Weitere Bücher suchen'}
                  </button>
                )}
              </div>
            </div>
          ) : !error ? (
            <Empty icon="🔍" title="Keine passenden Bücher gefunden">
              <p>Versuch es mit weniger Kriterien – oder lass dich mit 🎲 überraschen.</p>
            </Empty>
          ) : null}
        </section>
      </div>
    </div>
  );
}
