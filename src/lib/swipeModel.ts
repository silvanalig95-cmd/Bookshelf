/**
 * Swipe-Geschmacksmodell: lernt aus *allen* gespeicherten Entscheidungen (Swipes, Merken,
 * „nicht meins“ …), welche Genres, Themen und Autor:innen dich reizen – und plant daraus
 * neue Karten, ohne sich auf wenige Genres festzufahren.
 *
 * Verfahren:
 *  - Jede Entscheidung zählt: „spannend“/„merken“ positiv, „nicht meins“ negativ. Ältere
 *    zählen etwas weniger, aber nie unter 40 % – vergessen wird nichts.
 *  - Genres: pro Genre eine Beta-Verteilung aus Zuspruch und Ablehnung. Der Genre-Mix eines
 *    Stapels wird per Thompson-Sampling gezogen: gut belegte Lieblingsgenres kommen oft,
 *    wenig erprobte haben eine breite Verteilung und kommen dadurch immer wieder zum Zug.
 *  - Leitplanken gegen die Filterblase: höchstens 30 % eines Stapels aus einem Genre,
 *    immer mehrere Genres und rund ein Viertel „Neuland“ (am wenigsten erprobte Genres).
 *  - Themen & Autor:innen: geglättete Log-Odds gegenüber deiner allgemeinen Zusagequote.
 *    Themen, die in fast allem stecken, heben sich so von selbst auf; übrig bleibt,
 *    was dich *besonders* anzieht oder abschreckt.
 */
import { conceptsOf } from './profile';
import { detectGenres, GENRES, isNoiseSubject, subjectLabel, type Genre } from './taxonomy';
import { normalize } from './text';
import type { Book, SignalVerdict, TasteSignal } from './types';

const NONFICTION_IN_DECK = ['biografie', 'geschichte', 'wissenschaft', 'philosophie', 'psychologie', 'gesellschaft', 'natur', 'reise'];

/** Genres, aus denen der Swipe-Stapel gemischt wird. */
export const SWIPE_GENRES: Genre[] = GENRES.filter(
  (g) => (g.group === 'fiction' && !['kinder', 'lyrik', 'kurzgeschichten'].includes(g.id)) || NONFICTION_IN_DECK.includes(g.id),
);

const POSITIVE: Record<SignalVerdict, number> = { like: 1, save: 1.4, read: 0.7, dislike: 0 };
const NEGATIVE: Record<SignalVerdict, number> = { like: 0, save: 0, read: 0, dislike: 1 };
const DAY = 24 * 3600 * 1000;
/** Glättung der Log-Odds: so viele „Schein-Beobachtungen“ zur allgemeinen Quote. */
const SMOOTHING = 3;

export interface GenreStat {
  id: string;
  label: string;
  pos: number;
  neg: number;
}

export interface ConceptStat {
  concept: string;
  label: string;
  /** Originalschlagwort, das das Konzept am häufigsten vertritt (für Suchanfragen). */
  subject: string;
  pos: number;
  neg: number;
  /** > 0: zieht dich an, < 0: schreckt ab (Log-Odds gegenüber deiner Grundquote). */
  score: number;
}

export interface AuthorStat {
  name: string;
  pos: number;
  neg: number;
  score: number;
}

export interface SwipeModel {
  /** Anzahl berücksichtigter Entscheidungen (ungewichtet). */
  total: number;
  likes: number;
  dislikes: number;
  /** Gewichtete Zusagequote über alles (0–1). */
  baseRate: number;
  genres: Map<string, GenreStat>;
  concepts: Map<string, ConceptStat>;
  authors: Map<string, AuthorStat>;
  /** Positiv gewichtete Konzepte je Genre – woraus „mehr davon“-Anfragen gebaut werden. */
  genreConcepts: Map<string, Map<string, number>>;
  /** Zuspruch zu neueren (ab 1990) und älteren Büchern. */
  eras: Record<Era, { pos: number; neg: number }>;
}

export type Era = 'neu' | 'alt';
export const MODERN_FROM = 1990;
export const eraOf = (year: number): Era => (year >= MODERN_FROM ? 'neu' : 'alt');

interface Features {
  genres: string[];
  concepts: Array<[concept: string, subject: string]>;
  authors: string[];
}

// Merkmale je Signal einmal berechnen – bei tausenden Swipes wird sonst jede Karte langsam
const featureCache = new Map<string, Features>();

function extractFeatures(subjects: string[], authors: string[]): Features {
  const clean = subjects.slice(0, 30);
  const concepts = new Map<string, string>();
  for (const s of clean) {
    if (isNoiseSubject(s) || s.length > 40) continue;
    for (const c of conceptsOf([s])) {
      const prev = concepts.get(c);
      if (!prev || s.length < prev.length) concepts.set(c, s);
    }
  }
  return {
    genres: detectGenres(normalize(clean.join(' | '))),
    concepts: Array.from(concepts),
    authors: authors.slice(0, 2).map((a) => a.trim()).filter(Boolean),
  };
}

function signalFeatures(s: TasteSignal): Features {
  const key = `${s.bookId}|${s.at}`;
  let f = featureCache.get(key);
  if (!f) {
    if (featureCache.size > 50_000) featureCache.clear();
    f = extractFeatures(s.subjects, s.authors);
    featureCache.set(key, f);
  }
  return f;
}

export function bookFeatures(book: Book): Features {
  return extractFeatures(book.subjects, book.authors);
}

function decay(at: string, now: number): number {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return 0.7;
  return Math.max(0.4, Math.pow(0.5, Math.max(0, now - t) / (365 * DAY)));
}

function logOdds(pos: number, neg: number, p: number): number {
  return Math.log((pos + SMOOTHING * p) / (neg + SMOOTHING * (1 - p))) - Math.log(p / (1 - p));
}

export function buildSwipeModel(signals: TasteSignal[], now = Date.now()): SwipeModel {
  const genres = new Map<string, GenreStat>(SWIPE_GENRES.map((g) => [g.id, { id: g.id, label: g.label, pos: 0, neg: 0 }]));
  const rawConcepts = new Map<string, { pos: number; neg: number; subjects: Map<string, number> }>();
  const rawAuthors = new Map<string, { name: string; pos: number; neg: number }>();
  const genreConcepts = new Map<string, Map<string, number>>();
  const eras: SwipeModel['eras'] = { neu: { pos: 0, neg: 0 }, alt: { pos: 0, neg: 0 } };
  let posSum = 0;
  let negSum = 0;
  let likes = 0;
  let dislikes = 0;

  for (const s of signals) {
    const w = decay(s.at, now);
    const pos = POSITIVE[s.verdict] * w;
    const neg = NEGATIVE[s.verdict] * w;
    if (!pos && !neg) continue;
    posSum += pos;
    negSum += neg;
    if (pos) likes++;
    else dislikes++;
    if (s.year) {
      eras[eraOf(s.year)].pos += pos;
      eras[eraOf(s.year)].neg += neg;
    }
    const f = signalFeatures(s);
    for (const g of f.genres) {
      const stat = genres.get(g);
      if (stat) {
        stat.pos += pos;
        stat.neg += neg;
      }
    }
    for (const [c, subject] of f.concepts) {
      const stat = rawConcepts.get(c) ?? { pos: 0, neg: 0, subjects: new Map<string, number>() };
      stat.pos += pos;
      stat.neg += neg;
      stat.subjects.set(subject, (stat.subjects.get(subject) ?? 0) + 1);
      rawConcepts.set(c, stat);
      if (pos) {
        for (const g of f.genres) {
          const m = genreConcepts.get(g) ?? new Map<string, number>();
          m.set(c, (m.get(c) ?? 0) + pos);
          genreConcepts.set(g, m);
        }
      }
    }
    for (const a of f.authors) {
      const key = normalize(a);
      const stat = rawAuthors.get(key) ?? { name: a, pos: 0, neg: 0 };
      stat.pos += pos;
      stat.neg += neg;
      rawAuthors.set(key, stat);
    }
  }

  const total = posSum + negSum;
  const baseRate = total ? Math.min(0.9, Math.max(0.1, posSum / total)) : 0.5;
  const concepts = new Map<string, ConceptStat>();
  for (const [c, r] of rawConcepts) {
    const subject = Array.from(r.subjects).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    concepts.set(c, { concept: c, label: subjectLabel(subject), subject, pos: r.pos, neg: r.neg, score: logOdds(r.pos, r.neg, baseRate) });
  }
  const authors = new Map<string, AuthorStat>();
  for (const [k, r] of rawAuthors) authors.set(k, { ...r, score: logOdds(r.pos, r.neg, baseRate) });

  return { total: likes + dislikes, likes, dislikes, baseRate, genres, concepts, authors, genreConcepts, eras };
}

/* ---------- Genre-Statistik ---------- */

/**
 * A-priori-Zusage eines noch unerprobten Genres: vorsichtiger als deine Grundquote (die meist
 * von deinen Lieblingsgenres geprägt ist), Sachbuch noch etwas zurückhaltender. Sonst würden
 * unerprobte Genres im Thompson-Sampling dauernd vor deinen echten Favoriten landen –
 * ausprobiert werden sie über die festen Neuland-Plätze.
 */
function priorMean(model: SwipeModel, genreId: string): number {
  const g = SWIPE_GENRES.find((x) => x.id === genreId);
  return model.baseRate * (g?.group === 'nonfiction' ? 0.45 : 0.6);
}

const PRIOR_STRENGTH = 3;

/** Erwartete Zusage zu einem Genre (Posterior-Mittel, 0–1). */
export function genreAffinity(model: SwipeModel, genreId: string): number {
  const s = model.genres.get(genreId);
  const p = priorMean(model, genreId);
  if (!s) return p;
  return (s.pos + PRIOR_STRENGTH * p) / (s.pos + s.neg + PRIOR_STRENGTH);
}

/** Wie oft ein Genre schon bewertet wurde (gewichtet). */
export function genreEvidence(model: SwipeModel, genreId: string): number {
  const s = model.genres.get(genreId);
  return s ? s.pos + s.neg : 0;
}

/* ---------- Neu und Alt ---------- */

// Genres, in denen ältere Bücher ausdrücklich willkommen sind (Weltliteratur) bzw. selten gefragt (Unterhaltung)
const TIMELESS = ['literatur', 'magischer-realismus', 'mythen', 'philosophie', 'geschichte', 'biografie'];
const AGING = ['krimi', 'thriller', 'fantasy', 'scifi', 'dystopie', 'horror', 'liebe', 'humor', 'abenteuer', 'jugend', 'spionage', 'familie'];

/**
 * Anteil neuerer Bücher (ab 1990) an den Karten eines Genres. Die meistgelesenen Bücher aller
 * Zeiten sind fast nur Klassiker – ohne diesen Ausgleich bestünde der Stapel grösstenteils aus
 * Weltliteratur. Ausgangswert zwei Drittel, angepasst an das, was du bei Neuem und Altem magst.
 */
export function modernShare(model: SwipeModel, genreId: string): number {
  if (genreId === 'klassiker') return 0;
  const affinity = (e: Era) => {
    const s = model.eras[e];
    const p = model.baseRate;
    return (s.pos + PRIOR_STRENGTH * p) / (s.pos + s.neg + PRIOR_STRENGTH);
  };
  const base = 0.65 * affinity('neu');
  let share = base / (base + 0.35 * affinity('alt'));
  share = Math.min(0.85, Math.max(0.35, share));
  if (TIMELESS.includes(genreId)) share -= 0.2;
  else if (AGING.includes(genreId)) share += 0.1;
  return Math.min(0.9, Math.max(0.15, share));
}

/* ---------- Zufall (austauschbar für Tests) ---------- */

export type Rng = () => number;

function gaussian(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Gamma(k, 1) nach Marsaglia & Tsang. */
function sampleGamma(k: number, rng: Rng): number {
  if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(rng() || 1e-12, 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rng: Rng = Math.random): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}

/* ---------- Stapel planen ---------- */

export interface DeckSlot {
  genre: Genre;
  /** favorit = nach deinem Geschmack, neuland = wenig erprobtes Genre zum Kennenlernen. */
  kind: 'favorit' | 'neuland';
  /** Wie viele Karten aus diesem Genre. */
  count: number;
  /** Schlagwörter, die dich innerhalb des Genres besonders reizen (für gezieltere Suche). */
  focus: string[];
}

export interface PlanOptions {
  size?: number;
  rng?: Rng;
  /** Höchstanteil eines Genres am Stapel. */
  maxShare?: number;
  /** Anteil „Neuland“. */
  exploreShare?: number;
}

export function planDeck(model: SwipeModel, opts: PlanOptions = {}): DeckSlot[] {
  const size = opts.size ?? 16;
  const rng = opts.rng ?? Math.random;
  const cap = Math.max(2, Math.ceil(size * (opts.maxShare ?? 0.3)));
  const exploreCount = Math.max(2, Math.round(size * (opts.exploreShare ?? 0.25)));

  // Thompson-Sampling: eine plausible Zusagequote je Genre ziehen
  const sampled = SWIPE_GENRES.map((g) => {
    const s = model.genres.get(g.id);
    const p = priorMean(model, g.id);
    const theta = sampleBeta((s?.pos ?? 0) + PRIOR_STRENGTH * p, (s?.neg ?? 0) + PRIOR_STRENGTH * (1 - p), rng);
    return { genre: g, theta, evidence: genreEvidence(model, g.id), affinity: genreAffinity(model, g.id) };
  });

  // Neuland: unter den am wenigsten erprobten Genres zufällig – deutlich Abgelehntes ausgenommen
  const rejected = (x: (typeof sampled)[number]) => x.evidence >= 5 && x.affinity < 0.2;
  const byEvidence = [...sampled].filter((x) => !rejected(x)).sort((a, b) => a.evidence - b.evidence || rng() - 0.5);
  const pool = byEvidence.slice(0, Math.max(3, Math.ceil(byEvidence.length / 3)));
  const explore: typeof sampled = [];
  while (explore.length < 2 && pool.length) explore.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);

  // Favoriten: die Genres mit den höchsten gezogenen Quoten, mindestens vier verschiedene
  const exploitCount = size - exploreCount;
  const favorites = sampled
    .filter((x) => !explore.includes(x))
    .sort((a, b) => b.theta - a.theta)
    .slice(0, Math.max(4, Math.ceil(exploitCount / cap)));
  const counts = allocate(
    favorites.map((f) => f.theta),
    exploitCount,
    cap,
  );

  const slots: DeckSlot[] = favorites
    .map((f, i) => ({ genre: f.genre, kind: 'favorit' as const, count: counts[i], focus: focusFor(model, f.genre.id) }))
    .filter((s) => s.count > 0);
  const perExplore = allocate(
    explore.map(() => 1),
    exploreCount,
    cap,
  );
  explore.forEach((e, i) => perExplore[i] > 0 && slots.push({ genre: e.genre, kind: 'neuland', count: perExplore[i], focus: [] }));
  return slots;
}

/** Verteilt `total` Karten proportional zu den Gewichten, höchstens `cap` je Eintrag. */
function allocate(weights: number[], total: number, cap: number): number[] {
  const out = weights.map(() => 0);
  if (!weights.length) return out;
  let left = total;
  while (left > 0) {
    const open = weights.map((w, i) => ({ w: Math.max(w, 0.01), i })).filter((x) => out[x.i] < cap);
    if (!open.length) break;
    const sum = open.reduce((a, x) => a + x.w, 0);
    // Jeweils eine Karte an den Eintrag, der seinem Soll-Anteil am meisten hinterherhinkt
    const next = open.sort((a, b) => out[a.i] - (total * a.w) / sum - (out[b.i] - (total * b.w) / sum))[0];
    out[next.i]++;
    left--;
  }
  return out;
}

/** Schlagwörter, die dich innerhalb eines Genres überdurchschnittlich anziehen. */
export function focusFor(model: SwipeModel, genreId: string, max = 3): string[] {
  const inGenre = model.genreConcepts.get(genreId);
  if (!inGenre) return [];
  const genreWords = new Set(SWIPE_GENRES.find((g) => g.id === genreId)?.subjects.flatMap((s) => conceptsOf([s])) ?? []);
  return Array.from(inGenre)
    .map(([c, pos]) => ({ stat: model.concepts.get(c), pos }))
    .filter((x): x is { stat: ConceptStat; pos: number } => Boolean(x.stat) && x.pos >= 1.5 && x.stat!.score > 0.25 && !genreWords.has(x.stat!.concept))
    .sort((a, b) => b.stat.score * Math.sqrt(b.pos) - a.stat.score * Math.sqrt(a.pos))
    .slice(0, max)
    .map((x) => x.stat.subject);
}

/* ---------- Karten bewerten ---------- */

/** Wie gut ein Buch zu deinen bisherigen Entscheidungen passt (≈ −2 … +2, 0 = unbekannt). */
export function contentFit(book: Book, model: SwipeModel): number {
  const f = bookFeatures(book);
  let sum = 0;
  let n = 0;
  for (const [c] of f.concepts) {
    const stat = model.concepts.get(c);
    if (!stat) continue;
    sum += stat.score;
    n++;
  }
  let fit = n ? sum / Math.sqrt(n + 2) : 0;
  for (const a of f.authors) {
    const stat = model.authors.get(normalize(a));
    if (stat) fit += stat.score * 0.8;
  }
  return Math.max(-2, Math.min(2, fit));
}

/** Verschränkt mehrere Listen reihum, damit nicht fünf Karten desselben Genres aufeinander folgen. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const queues = lists.map((l) => [...l]);
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/* ---------- Für die Anzeige ---------- */

export interface ModelSummary {
  /** Anteil neuerer Bücher (ab 1990), den der Stapel derzeit anstrebt (ohne Genre-Anpassung). */
  modern: number;
  genres: Array<{ id: string; label: string; affinity: number; evidence: number }>;
  toExplore: string[];
  liked: ConceptStat[];
  disliked: ConceptStat[];
}

export function summarizeModel(model: SwipeModel): ModelSummary {
  const genres = SWIPE_GENRES.map((g) => ({ id: g.id, label: g.label, affinity: genreAffinity(model, g.id), evidence: genreEvidence(model, g.id) }));
  const concepts = Array.from(model.concepts.values()).filter((c) => c.pos + c.neg >= 2);
  const uniqueLabels = (list: ConceptStat[]) => list.filter((c, i, arr) => arr.findIndex((x) => x.label === c.label) === i);
  return {
    modern: modernShare(model, ''),
    genres: genres.filter((g) => g.evidence >= 1.5).sort((a, b) => b.affinity - a.affinity),
    toExplore: genres.filter((g) => g.evidence < 1.5).map((g) => g.label),
    liked: uniqueLabels(concepts.filter((c) => c.score > 0.3).sort((a, b) => b.score * Math.sqrt(b.pos) - a.score * Math.sqrt(a.pos))).slice(0, 8),
    disliked: uniqueLabels(concepts.filter((c) => c.score < -0.3).sort((a, b) => a.score * Math.sqrt(a.neg) - b.score * Math.sqrt(b.neg))).slice(0, 5),
  };
}
