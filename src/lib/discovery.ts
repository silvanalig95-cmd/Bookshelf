/**
 * Die Entdecken-Suche: übersetzt viele weiche und harte Kriterien in mehrere
 * Open-Library-Anfragen, führt die Treffer zusammen und bewertet jedes Buch
 * nachvollziehbar (Trefferquote + Begründungen).
 */
import { searchGoogleBooks } from './googleBooks';
import { settle } from './http';
import type { WishLookup } from './lookup';
import { docToBook, searchWorks, type OLSort } from './openLibrary';
import { tasteMatch, type TasteProfile } from './profile';
import { conceptsOf } from './profile';
import type { ReadIndex } from '../store/library';
import {
  countMatches,
  eraById,
  ERAS,
  genreById,
  genreMatches,
  GENRES,
  moodById,
  MOODS,
  placeById,
  PLACES,
  subjectLabel,
} from './taxonomy';
import { bookFingerprint, clamp, contentWords, normalize, solrPhrase, uniq } from './text';
import type { Book, LanguagePreference, Reason, ScoredBook } from './types';

export interface SimilarRef {
  id: string;
  title: string;
  authors: string[];
  authorKeys?: string[];
  subjects: string[];
}

export type DiscoverySort = 'match' | 'rating' | 'popular' | 'new' | 'old' | 'random';

export interface DiscoveryParams {
  /** Stichwörter, Titel oder Autor – freie Suche. */
  text: string;
  /** Freier Wunsch / Kommentar in eigenen Worten. */
  wish: string;
  genres: string[];
  moods: string[];
  excludeGenres: string[];
  /** −2 (ruhig) … +2 (rasant), 0 = egal */
  tempo: number;
  /** −2 (leicht) … +2 (anspruchsvoll), 0 = egal */
  depth: number;
  /** −2 (Geheimtipp) … +2 (Bestseller), 0 = egal */
  fame: number;
  pagesMin?: number;
  pagesMax?: number;
  yearFrom?: number;
  yearTo?: number;
  places: string[];
  placeText: string;
  eras: string[];
  character: string;
  author: string;
  similarTo: SimilarRef[];
  excludeWords: string[];
  minRating: number;
  language: LanguagePreference;
  hideRead: boolean;
  useTaste: boolean;
  sort: DiscoverySort;
}

export const DEFAULT_PARAMS: DiscoveryParams = {
  text: '',
  wish: '',
  genres: [],
  moods: [],
  excludeGenres: [],
  tempo: 0,
  depth: 0,
  fame: 0,
  places: [],
  placeText: '',
  eras: [],
  character: '',
  author: '',
  similarTo: [],
  excludeWords: [],
  minRating: 0,
  language: 'de-first',
  hideRead: true,
  useTaste: true,
  sort: 'match',
};

/* ------------------------------------------------------------------ */
/* Wunsch in eigenen Worten verstehen (ohne KI)                          */
/* ------------------------------------------------------------------ */

export interface WishInterpretation {
  genres: string[];
  moods: string[];
  places: string[];
  eras: string[];
  keywords: string[];
  pagesMin?: number;
  pagesMax?: number;
  fame?: number;
  tempo?: number;
  depth?: number;
  similarTitles: string[];
  excludeWords: string[];
  excludeGenres: string[];
  /** Im Wunsch erkanntes Buch bzw. erkannte Autor:in (siehe lookup.ts). */
  found?: { title?: string; author?: string };
  /** Ausdrücklich ein Roman / eine Erzählung gewünscht – Sachbücher passen dann nicht. */
  fiction?: boolean;
}

/** Auslöser-Wörter (normalisiert, Präfix-Abgleich) → Kategorie. */
const WISH_LEXICON: Array<{ words: string[]; genre?: string; mood?: string; place?: string; era?: string }> = [
  { words: ['krimi', 'detektiv', 'ermittl', 'kommissar', 'mord', 'crime', 'mystery', 'whodunit'], genre: 'krimi' },
  { words: ['thriller', 'psychothriller', 'nervenkitzel'], genre: 'thriller' },
  { words: ['fantasy', 'drache', 'zauber', 'magier', 'elfen', 'hexe'], genre: 'fantasy' },
  { words: ['science fiction', 'sciencefiction', 'scifi', 'sci fi', 'weltraum', 'raumschiff', 'roboter', 'ausserirdisch', 'zukunft'], genre: 'scifi' },
  { words: ['dystop', 'apokalyp', 'endzeit', 'uberwachungsstaat'], genre: 'dystopie' },
  { words: ['horror', 'grusel', 'gespenst', 'vampir', 'geister', 'unheimlich'], genre: 'horror', mood: 'gruselig' },
  { words: ['historisch', 'histori', 'geschichtlich'], genre: 'historisch' },
  { words: ['liebesroman', 'romance', 'liebesgeschicht', 'romanze'], genre: 'liebe', mood: 'romantisch' },
  { words: ['humor', 'lustig', 'witzig', 'komisch', 'lachen', 'satire', 'funny'], genre: 'humor', mood: 'humorvoll' },
  { words: ['abenteuer', 'expedition', 'piraten', 'schatzsuche'], genre: 'abenteuer', mood: 'abenteuerlich' },
  { words: ['klassiker', 'klassisch', 'weltliteratur'], genre: 'klassiker' },
  { words: ['jugendbuch', 'young adult', 'teenager', 'jugendlich'], genre: 'jugend' },
  { words: ['kinderbuch', 'vorlesen', 'fur kinder'], genre: 'kinder' },
  { words: ['comic', 'graphic novel', 'manga'], genre: 'comic' },
  { words: ['magischer realismus', 'surreal'], genre: 'magischer-realismus' },
  { words: ['mythos', 'mytholog', 'marchen', 'sagen', 'gotter'], genre: 'mythen' },
  { words: ['kurzgeschicht', 'erzahlungen', 'short stor'], genre: 'kurzgeschichten' },
  { words: ['familie', 'familiensaga', 'generationen', 'geschwister'], genre: 'familie' },
  { words: ['krieg', 'weltkrieg', 'soldat'], genre: 'krieg' },
  { words: ['spion', 'geheimdienst', 'agent'], genre: 'spionage' },
  { words: ['gedicht', 'lyrik', 'poesie'], genre: 'lyrik' },
  { words: ['biografie', 'biographie', 'memoir', 'autobiograf', 'lebensgeschichte'], genre: 'biografie' },
  { words: ['sachbuch', 'wissenschaft', 'physik', 'biologie', 'evolution', 'gehirn'], genre: 'wissenschaft' },
  { words: ['philosoph', 'sinn des lebens', 'ethik'], genre: 'philosophie', mood: 'nachdenklich' },
  { words: ['psycholog'], genre: 'psychologie' },
  { words: ['politik', 'gesellschaft', 'feminis', 'demokratie'], genre: 'gesellschaft' },
  { words: ['wirtschaft', 'business', 'karriere', 'finanzen'], genre: 'wirtschaft' },
  { words: ['natur', 'umwelt', 'klima', 'wald', 'tiere'], genre: 'natur' },
  { words: ['reisebericht', 'reisen'], genre: 'reise' },
  { words: ['ratgeber', 'selbsthilfe', 'gewohnheit', 'achtsam', 'gluck'], genre: 'ratgeber' },
  { words: ['spannend', 'fesselnd', 'pageturner', 'page turner', 'packend', 'mitreissend'], mood: 'spannend' },
  { words: ['duster', 'dunkel', 'noir', 'abgrund', 'bose'], mood: 'duester' },
  { words: ['herzerwarmend', 'wohlfuhl', 'feelgood', 'feel good', 'warmherzig', 'hoffnungsvoll', 'tröstlich', 'trostlich'], mood: 'herzerwaermend' },
  { words: ['nachdenklich', 'tiefgrund', 'philosophisch', 'tiefsinnig'], mood: 'nachdenklich' },
  { words: ['traurig', 'emotional', 'beruhrend', 'weinen', 'trauer', 'bewegend'], mood: 'emotional' },
  { words: ['magisch', 'verzaubert', 'marchenhaft'], mood: 'magisch' },
  { words: ['romantisch', 'liebe', 'verliebt'], mood: 'romantisch' },
  { words: ['ratsel', 'geheimnis', 'mysterios', 'wendung', 'plot twist'], mood: 'raetselhaft' },
  { words: ['ruhig', 'gemutlich', 'entspannend', 'entschleunig', 'cozy', 'leise'], mood: 'ruhig' },
  { words: ['rasant', 'action', 'temporeich', 'schnell erzahlt'], mood: 'rasant' },
  { words: ['skurril', 'absurd', 'schrag', 'verruckt'], mood: 'skurril' },
  { words: ['inspirierend', 'mutmachend', 'motivierend', 'ermutigend'], mood: 'inspirierend' },
  { words: ['lehrreich', 'etwas lernen', 'bildend'], mood: 'lehrreich' },
  { words: ['nostalgisch', 'kindheit', 'erinnerung'], mood: 'nostalgisch' },
  { words: ['gesellschaftskrit', 'sozialkrit', 'politisch'], mood: 'gesellschaftskritisch' },
  ...PLACES.map((p) => ({ words: [normalize(p.label), ...p.match.filter((m) => !m.endsWith('*'))], place: p.id })),
  { words: ['antike', 'romisch', 'griechisch'], era: 'antike' },
  { words: ['mittelalter', 'ritter', 'wikinger'], era: 'mittelalter' },
  { words: ['renaissance', 'barock'], era: 'fruehe-neuzeit' },
  { words: ['18 jahrhundert', 'aufklarung', 'franzosische revolution'], era: '18jh' },
  { words: ['19 jahrhundert', 'viktorianisch', 'kaiserzeit'], era: '19jh' },
  { words: ['zwanziger', '20er jahre', 'weimar', 'nazi', 'zweiten weltkrieg', 'ersten weltkrieg'], era: 'weltkriege' },
  { words: ['nachkriegs', 'kalter krieg', 'ddr', '60er', '70er', '80er'], era: 'nachkrieg' },
  { words: ['gegenwart', 'heute', 'modern'], era: 'gegenwart' },
];

const SHORT_WORDS = ['kurz', 'dunn', 'schnell gelesen', 'fur zwischendurch', 'kurzweilig', 'novelle', 'wenige seiten'];
const LONG_WORDS = ['dick', 'lang', 'walzer', 'epos', 'episch', 'zum versinken', 'viele seiten', 'reihe'];
const HIDDEN_WORDS = ['geheimtipp', 'unbekannt', 'nicht so bekannt', 'wenig bekannt', 'unterschatzt', 'perle', 'hidden gem'];
const FAMOUS_WORDS = ['bestseller', 'bekannt', 'beliebt', 'popular', 'erfolgreich', 'hype'];
const LIGHT_WORDS = ['leicht', 'locker', 'easy', 'unterhaltsam', 'seicht', 'zum abschalten'];
const DEEP_WORDS = ['anspruchsvoll', 'literarisch', 'komplex', 'fordernd', 'sprachgewaltig', 'tiefgrundig'];

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text));
}

export function interpretWish(wish: string): WishInterpretation {
  const result: WishInterpretation = { genres: [], moods: [], places: [], eras: [], keywords: [], similarTitles: [], excludeWords: [], excludeGenres: [] };
  if (!wish.trim()) return result;

  // "wie <Titel>" / "ähnlich wie <Titel>" / "like <title>"
  const similar = wish.matchAll(/(?:ähnlich wie|aehnlich wie|so wie|wie|like)\s+[„"»“]?([^,.;!?„"«»“”]+?)[“"«”]?(?=[,.;!?]|\s+(?:aber|nur|und|mit|von)\b|$)/gi);
  for (const m of similar) {
    const t = m[1].trim();
    if (t.split(/\s+/).length <= 8 && t.length > 2 && !/^(ein|eine|einen|etwas|das|die|der)$/i.test(t)) result.similarTitles.push(t);
  }

  // "ohne X" / "kein X" / "nicht zu X"
  for (const m of wish.matchAll(/\b(?:ohne|keine?n?|nicht zu|bitte keine?)\s+([a-zäöüß-]{4,})/gi)) {
    result.excludeWords.push(normalize(m[1]));
  }

  const text = ` ${normalize(wish)} `;
  for (const entry of WISH_LEXICON) {
    if (!includesAny(text, entry.words.map(normalize))) continue;
    // Wörter aus der Ausschlussliste nicht positiv werten – „ohne Romanze“ schliesst das Genre aus
    if (entry.words.some((w) => result.excludeWords.some((x) => x.startsWith(normalize(w)) || normalize(w).startsWith(x)))) {
      if (entry.genre) result.excludeGenres.push(entry.genre);
      continue;
    }
    if (entry.genre) result.genres.push(entry.genre);
    if (entry.mood) result.moods.push(entry.mood);
    if (entry.place) result.places.push(entry.place);
    if (entry.era) result.eras.push(entry.era);
  }
  // „Roman“, „Liebesroman“, „Novelle“, „novel“ … → nur Belletristik
  if (/(roman|romane|novelle|novellen|erzahlung|erzahlungen)\b|\bnovels?\b/.test(text)) result.fiction = true;
  if (includesAny(text, SHORT_WORDS)) result.pagesMax = 280;
  if (includesAny(text, LONG_WORDS)) result.pagesMin = 450;
  if (includesAny(text, HIDDEN_WORDS)) result.fame = -2;
  else if (includesAny(text, FAMOUS_WORDS)) result.fame = 2;
  if (includesAny(text, LIGHT_WORDS)) result.depth = -1;
  if (includesAny(text, DEEP_WORDS)) result.depth = 2;
  if (result.moods.includes('rasant')) result.tempo = 2;
  if (result.moods.includes('ruhig')) result.tempo = -2;

  const consumed = new Set(
    WISH_LEXICON.flatMap((e) => e.words.map(normalize)).concat(SHORT_WORDS, LONG_WORDS, HIDDEN_WORDS, FAMOUS_WORDS, LIGHT_WORDS, DEEP_WORDS).flatMap((w) => w.split(' ')),
  );
  const similarWords = new Set(result.similarTitles.flatMap((t) => contentWords(t)));
  const excludeSet = new Set(result.excludeWords);
  result.keywords = uniq(
    contentWords(wish).filter(
      (w) => !similarWords.has(w) && !excludeSet.has(w) && !Array.from(consumed).some((c) => c.length > 3 && (w.startsWith(c) || c.startsWith(w))),
    ),
  ).slice(0, 6);
  result.genres = uniq(result.genres);
  result.moods = uniq(result.moods);
  result.places = uniq(result.places);
  result.eras = uniq(result.eras);
  return result;
}

/* ------------------------------------------------------------------ */
/* Anfragen planen                                                       */
/* ------------------------------------------------------------------ */

export interface QueryPlan {
  label: string;
  q: string;
  sort: OLSort;
  limit: number;
}

export interface DiscoveryContext {
  profile?: TasteProfile;
  readIndex?: ReadIndex;
  wish?: WishInterpretation;
  /** Aufgelöste Vergleichsbücher (aus `similarTo` und Wunsch-Titeln). */
  similar?: SimilarRef[];
  /** Im Wunsch erkanntes Buch / erkannte Autor:in. */
  lookup?: WishLookup;
  googleApiKey?: string;
  region?: string;
  /** Bücher, die eine Anfrage mit dem Suchtext / der genannten Autor:in geliefert hat. */
  directIds?: Set<string>;
}

/** Vereinigt die expliziten Parameter mit dem interpretierten Wunsch. */
export function effectiveParams(p: DiscoveryParams, wish?: WishInterpretation): DiscoveryParams {
  if (!wish) return p;
  return {
    ...p,
    moods: uniq([...p.moods, ...wish.moods]),
    places: uniq([...p.places, ...wish.places]),
    eras: uniq([...p.eras, ...wish.eras]),
    pagesMin: p.pagesMin ?? wish.pagesMin,
    pagesMax: p.pagesMax ?? wish.pagesMax,
    fame: p.fame || wish.fame || 0,
    tempo: p.tempo || wish.tempo || 0,
    depth: p.depth || wish.depth || 0,
    excludeWords: uniq([...p.excludeWords, ...wish.excludeWords]),
    excludeGenres: uniq([...p.excludeGenres, ...wish.excludeGenres]),
    genres: uniq([...p.genres, ...wish.genres]).filter((g) => !wish.excludeGenres.includes(g)),
  };
}

function or(field: string, terms: string[]): string {
  const clean = uniq(terms.map((t) => t.trim()).filter(Boolean));
  if (!clean.length) return '';
  return `${field}:(${clean.map(solrPhrase).join(' OR ')})`;
}

function textTerms(text: string): string {
  // Freitext unverändert übergeben, aber Solr-Sonderzeichen entschärfen
  return text.replace(/[:()[\]{}^~"\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hasCriteria(p: DiscoveryParams): boolean {
  return Boolean(
    p.text.trim() ||
      p.wish.trim() ||
      p.genres.length ||
      p.moods.length ||
      p.places.length ||
      p.placeText.trim() ||
      p.eras.length ||
      p.character.trim() ||
      p.author.trim() ||
      p.similarTo.length ||
      p.yearFrom ||
      p.yearTo ||
      p.pagesMin ||
      p.pagesMax ||
      p.tempo ||
      p.depth ||
      p.fame,
  );
}

export function buildQueryPlans(p: DiscoveryParams, ctx: DiscoveryContext = {}): QueryPlan[] {
  const genres = p.genres.map(genreById).filter(Boolean) as NonNullable<ReturnType<typeof genreById>>[];
  const moods = p.moods.map(moodById).filter(Boolean) as NonNullable<ReturnType<typeof moodById>>[];
  const places = p.places.map(placeById).filter(Boolean) as NonNullable<ReturnType<typeof placeById>>[];
  const eras = p.eras.map(eraById).filter(Boolean) as NonNullable<ReturnType<typeof eraById>>[];
  const excludeGenres = p.excludeGenres.map(genreById).filter(Boolean) as NonNullable<ReturnType<typeof genreById>>[];

  const lang = p.language === 'de-only' || p.language === 'de-first' ? 'language:ger' : '';
  const genreClause = or('subject', genres.flatMap((g) => g.subjects.slice(0, 3)));
  const moodClause = or('subject', moods.flatMap((m) => m.subjects));
  const placeClause = or('place', [...places.flatMap((pl) => pl.places), ...(p.placeText.trim() ? [p.placeText.trim()] : [])]);
  const eraClause = or('time', eras.flatMap((e) => e.times));
  const yearClause = p.yearFrom || p.yearTo ? `first_publish_year:[${p.yearFrom ?? '*'} TO ${p.yearTo ?? '*'}]` : '';
  const pagesClause = p.pagesMin || p.pagesMax ? `number_of_pages_median:[${p.pagesMin ?? '*'} TO ${p.pagesMax ?? '*'}]` : '';
  const authorClause = p.author.trim() ? `author:${solrPhrase(p.author)}` : '';
  const personClause = p.character.trim() ? `person:${solrPhrase(p.character)}` : '';
  const text = textTerms(p.text);
  const fameClause = p.fame <= -2 ? 'readinglog_count:[0 TO 120]' : '';
  const exclusion = [
    ...excludeGenres.flatMap((g) => g.subjects.slice(0, 2).map((s) => `-subject:${solrPhrase(s)}`)),
    ...p.excludeWords.filter(Boolean).map((w) => `-${solrPhrase(w)}`),
  ].join(' ');

  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
  const hard = join(text, authorClause, personClause, yearClause, pagesClause, exclusion);
  const popularSort: OLSort = p.fame >= 1 ? 'readinglog' : p.fame <= -1 ? 'rating' : text ? 'relevance' : 'readinglog';
  const plans: QueryPlan[] = [];
  const add = (label: string, q: string, sort: OLSort = popularSort, limit = 40) => {
    if (q.trim() && !plans.some((x) => x.q === q && x.sort === sort)) plans.push({ label, q, sort, limit });
  };

  // 0) Genannte Autor:in bzw. Autor:in des genannten Buchs
  const lookupAuthor = ctx.lookup?.author?.key ?? ctx.lookup?.book?.authorKeys?.[0];
  if (lookupAuthor) add('Mehr von dieser Autor:in', join(`author_key:${solrPhrase(lookupAuthor)}`, exclusion), 'readinglog', 30);
  // 1) Alles zusammen – aber nie nur „irgendwas auf Deutsch“
  const core = join(hard, genreClause, moodClause, placeClause, eraClause, fameClause);
  if (core) add('Alle Kriterien', join(core, lang));
  // 2) Stimmungen nur weich werten
  if (moodClause) add('Genre & Rahmen', join(hard, genreClause, placeClause, eraClause, fameClause, lang));
  // 3) Ort/Epoche lockern
  if (placeClause || eraClause) add('Ohne Ort/Epoche', join(hard, genreClause, moodClause || '', fameClause, lang));
  // 4) Bestbewertete im Genre (ergänzt die beliebtesten)
  if (genreClause || moodClause) add('Bestbewertet', join(hard, genreClause || moodClause, placeClause, lang), 'rating', 30);
  // 5) Ähnlich wie … (bei „wie <Titel>“ auch weitere Bücher derselben Autor:in)
  const refAuthor = [...(ctx.similar ?? []), ...p.similarTo].find((r) => r.authorKeys?.length)?.authorKeys?.[0];
  if (refAuthor && refAuthor !== lookupAuthor) add('Mehr von der Autor:in des Vergleichsbuchs', join(`author_key:${solrPhrase(refAuthor)}`, exclusion), 'readinglog', 15);
  for (const ref of [...(ctx.similar ?? []), ...p.similarTo].slice(0, 3)) {
    const subjects = distinctiveSubjects(ref.subjects, 5);
    if (subjects.length) add(`Ähnlich wie ${ref.title}`, join(or('subject', subjects), yearClause, pagesClause, exclusion, lang), 'readinglog', 30);
  }
  // 6) Wunsch-Stichwörter
  const kw = ctx.wish?.keywords ?? [];
  if (kw.length) add('Dein Wunsch', join(`(${kw.map((k) => textTerms(k)).filter(Boolean).join(' OR ')})`, genreClause, placeClause, yearClause, exclusion, lang), 'relevance', 30);
  // 7) Dein Geschmack – nur, wenn die Suche Spielraum lässt (Genre, Stimmung …), nicht bei einem konkreten Buch oder Stichwort
  const soft = Boolean(genreClause || moodClause || placeClause || eraClause);
  const concrete = Boolean(text || authorClause || kw.length || ctx.lookup || ctx.similar?.length || p.similarTo.length);
  if (p.useTaste && ctx.profile && ctx.profile.querySubjects.length >= 3 && (soft || !concrete)) {
    add('Dein Geschmack', join(or('subject', ctx.profile.querySubjects.slice(0, 6)), genreClause, placeClause, eraClause, yearClause, pagesClause, exclusion, lang), 'rating', 30);
  }
  // 8) Bei „Deutsch bevorzugt“ zusätzlich ohne Sprachfilter (englische Originale)
  const withLang = plans.find((x) => x.q.includes('language:ger'));
  if (p.language === 'de-first' && withLang) add('Auch ohne deutsche Ausgabe', withLang.q.replace(/\s*language:ger/, '').trim(), popularSort, 25);

  // Fallback: gar keine Kriterien → beliebte deutsche Bücher
  if (!plans.length) add('Beliebt', join('language:ger', exclusion), 'trending', 40);
  return plans.slice(0, 7);
}

/** Unterscheidungskräftige Schlagwörter (ohne generische wie „Fiction“). */
export function distinctiveSubjects(subjects: string[], max: number): string[] {
  const generic = /^(fiction|roman|novel|literature|general|large type books|accessible book|protected daisy|in library|juvenile fiction|english|american)/i;
  return uniq(subjects.filter((s) => s.length < 40 && !generic.test(s) && !/\d{4}/.test(s) && !/nyt:|new york times/i.test(s))).slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Bewerten                                                              */
/* ------------------------------------------------------------------ */

const TEMPO_FAST = ['thriller*', 'suspense', 'action', 'adventure*', 'chase', 'crime', 'murder'];
const TEMPO_SLOW = ['literary', 'philosoph*', 'nature', 'family', 'families', 'domestic fiction', 'memory', 'poetry', 'country life'];
const DEPTH_HIGH = ['classic*', 'literary', 'philosoph*', 'nobel', 'existential*', 'modernism', 'experimental', 'psychological fiction'];
const DEPTH_LOW = ['young adult', 'juvenile', 'humor*', 'romance', 'chick lit', 'cozy', 'children*', 'teenage*'];

const FICTION_MARK =
  /\b(fiction|novels?|romane?(?! (?:empire|history|law|art|antiquities|period|catholic|republic|emperors|britain))|novellen?|erzahlung(?:en)?|short stories|stories|tales|marchen|fairy tales|belletristik|drama|plays|poetry|gedichte|lyrik|kriminalroman)\b/;
const NONFICTION_MARK =
  /\b(biograph|autobiograph|memoir|history\b|politic|government|foreign relations|international relations|national socialism|nationalsozialismus|sociolog|economic|nonfiction|sachbuch|essays|congresses|exhibitions|catalogs|textbooks|study and teaching|dictionaries|handbooks|guidebooks|description and travel|antiquities|statistics)/;

/** Roman oder Sachbuch? Nur aus den Schlagwörtern – Klappentexte erzählen auch bei Sachbüchern „Geschichten“. */
export function bookKind(book: Book): 'fiction' | 'nonfiction' | 'unknown' {
  const subjects = normalize(book.subjects.join(' | '));
  if (!subjects) return 'unknown';
  if (FICTION_MARK.test(subjects)) return 'fiction';
  if (NONFICTION_MARK.test(subjects)) return 'nonfiction';
  return 'unknown';
}

export function bookText(book: Book): string {
  return normalize(
    [
      book.title,
      book.originalTitle ?? '',
      book.subtitle ?? '',
      ...book.subjects.slice(0, 60),
      ...(book.places ?? []).slice(0, 20),
      ...(book.times ?? []).slice(0, 20),
      ...(book.people ?? []).slice(0, 20),
      book.description?.slice(0, 1500) ?? '',
      book.firstSentence ?? '',
    ].join(' '),
  );
}

export function hasGerman(book: Book): boolean {
  return book.languages.includes('ger') || book.preferredEditionLang === 'ger';
}

export function popularityLevel(book: Book): number {
  return Math.log10(1 + (book.popularity ?? 0));
}

export function bayesRating(book: Book): number | undefined {
  if (!book.rating || !book.ratingsCount) return undefined;
  const prior = 3.75;
  const k = 4;
  return (book.rating * book.ratingsCount + prior * k) / (book.ratingsCount + k);
}

export function scoreBook(book: Book, p: DiscoveryParams, ctx: DiscoveryContext = {}): ScoredBook | undefined {
  const text = bookText(book);
  const reasons: Reason[] = [];
  let s = 0;
  let bonus = 0;
  let potential = 0;
  // Sammelbände mit hunderten Schlagwörtern „passen“ scheinbar auf alles –
  // Textübereinstimmungen zählen bei ihnen weniger.
  const subjectCount = book.subjects.length + (book.places?.length ?? 0) + (book.times?.length ?? 0);
  const spec = 1 / (1 + Math.max(0, subjectCount - 45) / 55);

  // Ausschlüsse
  if (p.excludeWords.some((w) => w && new RegExp(`\\b${normalize(w)}`).test(text))) return undefined;
  for (const id of p.excludeGenres) {
    const g = genreById(id);
    if (g && genreMatches(text, g)) return undefined;
  }
  const alreadyRead = ctx.readIndex?.has(book) ?? false;
  if (alreadyRead && p.hideRead) return undefined;
  const german = hasGerman(book);
  if (p.language === 'de-only' && !german) return undefined;
  // „Deutsch bevorzugt, sonst Englisch“: Werke nur auf Italienisch, Türkisch … helfen nicht weiter
  if (p.language === 'de-first' && !german && book.languages.length && !book.languages.includes('eng')) return undefined;
  const kind = bookKind(book);
  const wantsNonfiction = p.genres.some((id) => genreById(id)?.group === 'nonfiction');
  if (ctx.wish?.fiction && !wantsNonfiction && kind === 'nonfiction') return undefined;
  const bayes = bayesRating(book);
  if (p.minRating && book.rating && (book.ratingsCount ?? 0) >= 5 && book.rating < p.minRating) return undefined;
  if (p.yearFrom && book.year && book.year < p.yearFrom - 1) return undefined;
  if (p.yearTo && book.year && book.year > p.yearTo + 1) return undefined;

  // Genres
  if (p.genres.length) {
    potential += 30;
    const matched = p.genres.map(genreById).filter((g) => g && genreMatches(text, g)) as NonNullable<ReturnType<typeof genreById>>[];
    if (matched.length) {
      s += (30 + Math.min(10, (matched.length - 1) * 5)) * spec;
      for (const g of matched.slice(0, 2)) reasons.push({ kind: 'genre', label: `${g.emoji} ${g.label}` });
    } else s -= 12;
  }
  // Stimmungen
  for (const id of p.moods) {
    const m = moodById(id);
    if (!m) continue;
    potential += 14;
    const hits = countMatches(text, m.match);
    if (hits) {
      s += 14 * Math.min(1, 0.6 + hits * 0.2) * spec;
      reasons.push({ kind: 'mood', label: `${m.emoji} ${m.label}` });
    }
  }
  // Schauplatz
  const placeTerms = [...p.places.flatMap((id) => placeById(id)?.match ?? []), ...(p.placeText.trim() ? [normalize(p.placeText) + '*'] : [])];
  if (placeTerms.length) {
    potential += 18;
    if (countMatches(text, placeTerms) > 0) {
      s += 18 * spec;
      const label = p.placeText.trim() || p.places.map((id) => placeById(id)?.label).filter(Boolean).join(', ');
      reasons.push({ kind: 'place', label: `📍 ${label}` });
    }
  }
  // Epoche
  if (p.eras.length) {
    potential += 14;
    const matched = p.eras.map(eraById).find((e) => e && countMatches(text, e.match) > 0);
    if (matched) {
      s += 14 * spec;
      reasons.push({ kind: 'era', label: `${matched.emoji} ${matched.label}` });
    }
  }
  // Figur
  if (p.character.trim()) {
    potential += 14;
    if (text.includes(normalize(p.character))) {
      s += 14;
      reasons.push({ kind: 'character', label: `🎭 ${p.character}` });
    }
  }
  // Konkrete Angaben (Stichwörter, Autor:in, Vergleichsbuch): Wer keine davon erfüllt, ist kein guter Treffer –
  // egal wie gut Geschmack oder Bewertung passen.
  let contentCriteria = false;
  let contentHit = false;
  // Autor:in
  if (p.author.trim()) {
    potential += 20;
    contentCriteria = true;
    const a = normalize(p.author);
    if (book.authors.some((x) => normalize(x).includes(a))) {
      s += 20;
      contentHit = true;
      reasons.push({ kind: 'author', label: `✍️ ${book.authors[0]}` });
    }
  }
  // Im Wunsch genannte Autor:in (oder Autor:in des genannten Buchs)
  const lookupAuthor = ctx.lookup?.author?.key ?? ctx.lookup?.book?.authorKeys?.[0];
  if (lookupAuthor) {
    const named = Boolean(ctx.lookup?.author);
    if (named) {
      potential += 20;
      contentCriteria = true;
    }
    if (book.authorKeys?.includes(lookupAuthor)) {
      s += named ? 20 : 8;
      contentHit = true;
      reasons.push({ kind: 'author', label: `✍️ ${ctx.wish?.found?.author ?? 'gleiche Autor:in'}` });
    }
  }
  // Stichwörter
  const explained = new Set(ctx.lookup?.consumed ?? []);
  const keywords = uniq([...contentWords(p.text), ...(ctx.wish?.keywords ?? [])])
    .filter((k) => !explained.has(k))
    .slice(0, 6);
  for (const k of keywords) {
    potential += 8;
    contentCriteria = true;
    if (new RegExp(`\\b${k}`).test(text)) {
      s += 8 * spec;
      contentHit = true;
      if (reasons.filter((r) => r.kind === 'keyword').length < 2) reasons.push({ kind: 'keyword', label: `„${k}“` });
    }
  }
  // Ähnlich wie …
  const refs = [...(ctx.similar ?? []), ...p.similarTo];
  if (refs.length) {
    potential += 25;
    const bookConcepts = new Set(conceptsOf(book.subjects));
    let best = 0;
    let bestRef: SimilarRef | undefined;
    for (const ref of refs) {
      if (ref.id === book.id || bookFingerprint(ref.title, ref.authors) === bookFingerprint(book.title, book.authors)) return undefined;
      // Zu einem Roman passt kein Sachbuch über dieselbe Zeit („Schachnovelle“ ≠ Geschichtsbuch über den Nationalsozialismus)
      const refKind = bookKind({ subjects: ref.subjects } as Book);
      const refConcepts = conceptsOf(ref.subjects);
      const overlap = refConcepts.filter((c) => bookConcepts.has(c)).length;
      let v = Math.min(1, overlap / 4);
      const sameAuthor = ref.authors.some((a) => book.authors.includes(a)) || Boolean(ref.authorKeys?.some((k) => book.authorKeys?.includes(k)));
      if (refKind === 'fiction' && kind === 'nonfiction' && !sameAuthor) v *= 0.25;
      if (sameAuthor) v = Math.max(v, 0.6);
      if (v > best) {
        best = v;
        bestRef = ref;
      }
    }
    s += 25 * best;
    contentCriteria = true;
    if (best >= 0.4) contentHit = true;
    if (bestRef && best >= 0.4) reasons.push({ kind: 'similar', label: `≈ ${bestRef.title}` });
  }
  // Geschmacksprofil
  if (p.useTaste && ctx.profile && ctx.profile.topConcepts.length >= 3) {
    // Bei einer konkreten Suche (Buch, Autor:in, Stichwort) entscheidet der Geschmack nur noch bei Gleichstand
    const weight = contentCriteria ? 8 : 20;
    potential += weight;
    const tm = tasteMatch(ctx.profile, book);
    const t = clamp(tm.similarity / 0.3, -1, 1);
    s += weight * t;
    bonus += Math.min(8, tm.authorBonus * 2);
    if (t > 0.35 && tm.shared.length) reasons.push({ kind: 'taste', label: `💛 dein Geschmack: ${tm.shared.slice(0, 2).join(', ')}` });
    else if (tm.authorBonus > 1) reasons.push({ kind: 'taste', label: `💛 ${book.authors[0]} magst du` });
  }
  // Tempo & Anspruch
  const genresOfBook = GENRES.filter((g) => genreMatches(text, g));
  if (p.tempo) {
    potential += 10;
    const fast = countMatches(text, TEMPO_FAST);
    const slow = countMatches(text, TEMPO_SLOW);
    const gTempo = genresOfBook.reduce((a, g) => a + (g.tempo ?? 0), 0) / Math.max(1, genresOfBook.length);
    const bookTempo = clamp(gTempo + (fast - slow) * 0.5, -2, 2);
    const fit = 1 - Math.abs(p.tempo - bookTempo) / 4;
    s += 10 * (fit * 2 - 1);
    if (fit > 0.8) reasons.push({ kind: 'mood', label: p.tempo > 0 ? '⚡ temporeich' : '🍃 ruhig erzählt' });
  }
  if (p.depth) {
    potential += 10;
    const high = countMatches(text, DEPTH_HIGH);
    const low = countMatches(text, DEPTH_LOW);
    const gDepth = genresOfBook.reduce((a, g) => a + (g.depth ?? 0), 0) / Math.max(1, genresOfBook.length);
    const pagesFactor = book.pages ? (book.pages > 480 ? 0.5 : book.pages < 220 ? -0.5 : 0) : 0;
    const bookDepth = clamp(gDepth + (high - low) * 0.6 + pagesFactor, -2, 2);
    const fit = 1 - Math.abs(p.depth - bookDepth) / 4;
    s += 10 * (fit * 2 - 1);
    if (fit > 0.85) reasons.push({ kind: 'mood', label: p.depth > 0 ? '🎓 anspruchsvoll' : '🛋️ leicht zu lesen' });
  }
  // Bekanntheit
  const pop = popularityLevel(book);
  if (p.fame) {
    potential += 10;
    const target = { '-2': 0.6, '-1': 1.3, '1': 2.4, '2': 3.1 }[String(p.fame)] ?? 2;
    const fit = 1 - Math.min(1, Math.abs(pop - target) / 1.6);
    s += 10 * (fit * 2 - 1);
    if (p.fame < 0 && pop < 1.6 && (bayes ?? 0) >= 3.9) reasons.push({ kind: 'fame', label: '💎 Geheimtipp' });
    if (p.fame > 0 && pop > 2.7) reasons.push({ kind: 'fame', label: '🔥 sehr beliebt' });
  }
  // Länge
  if ((p.pagesMin || p.pagesMax) && book.pages) {
    potential += 6;
    const inRange = (!p.pagesMin || book.pages >= p.pagesMin) && (!p.pagesMax || book.pages <= p.pagesMax);
    if (inRange) {
      s += 6;
      reasons.push({ kind: 'length', label: `📏 ${book.pages} S.` });
    } else s -= 12;
  }
  // Deutsch
  if (p.language !== 'any') {
    potential += 8;
    if (german) {
      s += 8;
      reasons.push({ kind: 'german', label: '🇩🇪 auf Deutsch' });
    }
  }
  // Bewertung (Bonus)
  if (bayes) {
    bonus += (bayes - 3.75) * 12;
    if (bayes >= 4.05 && (book.ratingsCount ?? 0) >= 5) reasons.push({ kind: 'rating', label: `★ ${book.rating!.toFixed(1)}` });
  }
  // Datenqualität
  if (!book.coverId && !book.coverUrl) bonus -= 5;
  if (!book.subjects.length && !book.description) bonus -= 4;
  bonus += Math.min(4, pop); // leichte Bevorzugung bekannterer Werke bei Gleichstand

  // Direkt über den Suchtext gefundene Bücher erfüllen ihn, auch wenn das Wort nicht in den Schlagwörtern steht
  if (ctx.directIds?.has(book.id)) contentHit = true;
  const missesEverything = contentCriteria && !contentHit;
  if (missesEverything) s -= potential * 0.35;

  let match: number;
  if (potential > 0) {
    // Trefferquote nur aus den Kriterien – Bewertung/Beliebtheit fliessen leicht ein
    match = Math.round(clamp(25 + (70 * s) / potential + bonus * 0.25, 3, missesEverything ? 30 : 99));
  } else {
    match = Math.round(clamp(62 + ((bayes ?? 3.75) - 3.75) * 25 + pop * 4, 35, 96));
  }
  return { book, score: s + bonus - (missesEverything ? 1000 : 0), match, reasons: dedupeReasons(reasons), alreadyRead, weak: missesEverything || undefined };
}

function dedupeReasons(reasons: Reason[]): Reason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    if (seen.has(r.label)) return false;
    seen.add(r.label);
    return true;
  });
}

/** Führt Bücher aus mehreren Quellen zusammen (gleiches Werk bzw. gleicher Titel/Autor). */
export function mergeBooks(lists: Book[][]): Book[] {
  const byKey = new Map<string, Book>();
  const byPrint = new Map<string, string>();
  for (const list of lists) {
    for (const book of list) {
      const print = bookFingerprint(book.title, book.authors);
      const origPrint = book.originalTitle ? bookFingerprint(book.originalTitle, book.authors) : undefined;
      const existingKey = byKey.has(book.id) ? book.id : byPrint.get(print) ?? (origPrint ? byPrint.get(origPrint) : undefined);
      if (existingKey) {
        const existing = byKey.get(existingKey)!;
        byKey.set(existingKey, combine(existing, book));
      } else {
        byKey.set(book.id, book);
        byPrint.set(print, book.id);
        if (origPrint) byPrint.set(origPrint, book.id);
      }
    }
  }
  return Array.from(byKey.values());
}

function combine(a: Book, b: Book): Book {
  // Das „reichere“ Werk (mehr Ausgaben) gewinnt, fehlende Felder werden ergänzt.
  const [main, other] = (a.editionCount ?? 0) >= (b.editionCount ?? 0) ? [a, b] : [b, a];
  return {
    ...other,
    ...main,
    description: main.description ?? other.description,
    coverId: main.coverId ?? other.coverId,
    coverUrl: main.coverUrl ?? other.coverUrl,
    subjects: main.subjects.length >= other.subjects.length ? main.subjects : uniq([...main.subjects, ...other.subjects]),
    languages: uniq([...main.languages, ...other.languages]),
    isbns: uniq([...(main.isbns ?? []), ...(other.isbns ?? [])]),
    title: main.preferredEditionLang === 'ger' || other.preferredEditionLang !== 'ger' ? main.title : other.title,
    googleId: main.googleId ?? other.googleId,
  };
}

/* ------------------------------------------------------------------ */
/* Ausführen                                                             */
/* ------------------------------------------------------------------ */

const LATIN = /^[\p{Script=Latin}\p{P}\s]+$/u;

/** „Фёдор Достоевский“, „Fiódor Dostoievski“ … → einheitlich so, wie die Person den Namen geschrieben hat (nur für die gesuchte Autor:in). */
function withReadableAuthor(book: Book, ctx: DiscoveryContext): Book {
  const key = ctx.lookup?.author?.key ?? ctx.lookup?.book?.authorKeys?.[0];
  const name = ctx.wish?.found?.author;
  if (!key || !name || !LATIN.test(name) || !book.authorKeys) return book;
  const i = book.authorKeys.indexOf(key);
  if (i < 0 || !book.authors[i] || book.authors[i] === name) return book;
  const authors = [...book.authors];
  authors[i] = name;
  return { ...book, authors };
}

export interface DiscoveryResult {
  results: ScoredBook[];
  plans: QueryPlan[];
  total: number;
  /** Rohe Kandidatenzahl vor Filterung. */
  candidates: number;
}

export async function runDiscovery(
  params: DiscoveryParams,
  ctx: DiscoveryContext,
  page = 0,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  const p = effectiveParams(params, ctx.wish);
  const plans = buildQueryPlans(p, ctx);
  // Treffer einer Anfrage mit dem Suchtext erfüllen ihn (Autor:innen zählen über ihren Schlüssel, siehe scoreBook)
  const isDirect = (plan: QueryPlan) => Boolean(p.text.trim() && plan.q.includes(textTerms(p.text)));
  const responses = await Promise.all(
    plans.map((plan) =>
      settle(
        searchWorks(plan.q, { sort: plan.sort, limit: plan.limit, offset: page * plan.limit, lang: 'de', signal }).then((r) => ({
          total: r.numFound,
          books: r.docs.map((d) => docToBook(d)),
        })),
      ),
    ),
  );
  const lists = responses.map((r) => r?.books ?? []);

  // Google Books ergänzt deutschsprachige Titel, die Open Library nicht kennt
  if (page === 0 && p.language !== 'any') {
    const gbQuery = buildGoogleQuery(p, ctx);
    if (gbQuery) {
      const gb = await settle(searchGoogleBooks(gbQuery, { apiKey: ctx.googleApiKey, langRestrict: 'de', maxResults: 20, country: ctx.region, signal }));
      if (gb?.length) lists.push(gb.map((r) => r.book));
    }
  }

  const directIds = new Set(plans.flatMap((plan, i) => (isDirect(plan) ? lists[i].map((b) => b.id) : [])));
  const wanted = page === 0 ? ctx.lookup?.book : undefined;
  if (wanted) lists.unshift([wanted]);
  const merged = mergeBooks(lists).map((b) => withReadableAuthor(b, ctx));
  const pinned = wanted && merged.find((b) => b.id === wanted.id);
  const scoringCtx = { ...ctx, directIds };
  let scored = merged
    .filter((b) => b !== pinned)
    .map((b) => scoreBook(b, p, scoringCtx))
    .filter((x): x is ScoredBook => Boolean(x));
  // Bücher, die nichts von dem erfüllen, wonach konkret gefragt wurde, nur zeigen, wenn es sonst gar nichts gibt
  if (pinned || scored.some((r) => !r.weak)) scored = scored.filter((r) => !r.weak);
  sortResults(scored, p.sort);
  // Das ausdrücklich gesuchte Buch steht immer zuerst – auch wenn es schon gelesen ist
  if (pinned) {
    const reasons: Reason[] = [{ kind: 'keyword', label: '🎯 Dein gesuchtes Buch' }];
    if (hasGerman(pinned)) reasons.push({ kind: 'german', label: '🇩🇪 auf Deutsch' });
    scored.unshift({ book: pinned, score: Number.MAX_SAFE_INTEGER, match: 99, reasons, alreadyRead: ctx.readIndex?.has(pinned) ?? false });
  }
  const total = Math.max(0, ...responses.map((r) => r?.total ?? 0));
  return { results: scored, plans, total, candidates: merged.length };
}

export function sortResults(list: ScoredBook[], sort: DiscoverySort) {
  switch (sort) {
    case 'rating':
      list.sort((a, b) => (bayesRating(b.book) ?? 0) - (bayesRating(a.book) ?? 0));
      break;
    case 'popular':
      list.sort((a, b) => (b.book.popularity ?? 0) - (a.book.popularity ?? 0));
      break;
    case 'new':
      list.sort((a, b) => (b.book.year ?? 0) - (a.book.year ?? 0));
      break;
    case 'old':
      list.sort((a, b) => (a.book.year ?? 9999) - (b.book.year ?? 9999));
      break;
    case 'random':
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      break;
    default:
      list.sort((a, b) => b.score - a.score);
  }
}

function buildGoogleQuery(p: DiscoveryParams, ctx: DiscoveryContext): string {
  const parts: string[] = [];
  if (p.text.trim()) parts.push(p.text.trim());
  if (p.author.trim()) parts.push(`inauthor:${p.author.trim()}`);
  const kw = ctx.wish?.keywords ?? [];
  if (kw.length) parts.push(kw.slice(0, 3).join(' '));
  const g = p.genres.map(genreById)[0];
  if (g) parts.push(`subject:${g.subjects[0].split(',')[0]}`);
  const place = p.places.map(placeById)[0];
  if (place) parts.push(place.places[0]);
  return parts.join(' ').trim();
}

/** Findet zu einem normalisierten Stichwort die ursprüngliche Schreibweise im Text. */
export function originalWord(text: string, normalized: string): string {
  for (const token of text.split(/[\s,.;:!?„“"()]+/)) if (normalize(token) === normalized) return token;
  return normalized;
}

/** Kurze, lesbare Zusammenfassung der aktuellen Suche (für „Du suchst …“). */
export function describeSearch(params: DiscoveryParams, wish?: WishInterpretation): string[] {
  const p = effectiveParams(params, wish);
  const bits: string[] = [];
  if (wish?.found?.title) bits.push(`📖 „${wish.found.title}“ und Ähnliches`);
  if (wish?.found?.author) bits.push(`✍️ ${wish.found.title ? 'mehr von ' : ''}${wish.found.author}`);
  const genres = p.genres.map((id) => genreById(id)).filter(Boolean).map((g) => `${g!.emoji} ${g!.label}`);
  if (genres.length) bits.push(genres.join(' oder '));
  const moods = p.moods.map((id) => moodById(id)?.label).filter(Boolean) as string[];
  if (moods.length) bits.push(moods.join(' & '));
  if (p.tempo) bits.push(p.tempo > 0 ? 'temporeich' : 'ruhig erzählt');
  if (p.depth) bits.push(p.depth > 0 ? 'anspruchsvoll' : 'leicht zu lesen');
  const places = [...p.places.map((id) => placeById(id)?.label), p.placeText.trim()].filter(Boolean);
  if (places.length) bits.push(`spielt in ${places.join(' oder ')}`);
  const eras = p.eras.map((id) => eraById(id)?.label).filter(Boolean);
  if (eras.length) bits.push(`Epoche: ${eras.join(' oder ')}`);
  if (p.character.trim()) bits.push(`mit ${p.character.trim()}`);
  if (p.author.trim()) bits.push(`von ${p.author.trim()}`);
  if (p.similarTo.length) bits.push(`ähnlich wie „${p.similarTo.map((s) => s.title).join('“, „')}“`);
  if (wish?.similarTitles.length) bits.push(`ähnlich wie „${wish.similarTitles.join('“, „')}“`);
  if (p.pagesMin && p.pagesMax) bits.push(`${p.pagesMin}–${p.pagesMax} Seiten`);
  else if (p.pagesMax) bits.push(`unter ${p.pagesMax} Seiten`);
  else if (p.pagesMin) bits.push(`über ${p.pagesMin} Seiten`);
  if (p.yearFrom && p.yearTo) bits.push(`erschienen ${p.yearFrom}–${p.yearTo}`);
  else if (p.yearFrom) bits.push(`erschienen ab ${p.yearFrom}`);
  else if (p.yearTo) bits.push(`erschienen bis ${p.yearTo}`);
  if (p.fame < 0) bits.push('eher Geheimtipp');
  if (p.fame > 0) bits.push('gern Bestseller');
  if (p.minRating) bits.push(`ab ★ ${p.minRating}`);
  if (p.language === 'de-only') bits.push('nur auf Deutsch');
  if (p.text.trim()) bits.push(`„${p.text.trim()}“`);
  if (wish?.keywords.length) bits.push(`Stichwörter: ${wish.keywords.map((k) => originalWord(params.wish, k)).join(', ')}`);
  if (p.excludeWords.length) bits.push(`ohne ${p.excludeWords.map((w) => originalWord(params.wish, w)).join(', ')}`);
  const excluded = p.excludeGenres.map((id) => genreById(id)?.label).filter(Boolean);
  if (excluded.length) bits.push(`kein ${excluded.join(', ')}`);
  return bits;
}

export { ERAS, GENRES, MOODS, PLACES, subjectLabel };
