/**
 * Startseite: Entdeckungen statt der allerbekanntesten Bücher.
 *
 * Der Vorrat stammt aus dem „bekannt, aber nicht riesig“-Band von Open Library (ein paar Dutzend
 * Bewertungen, einige hundert Leselisten-Einträge) und wird täglich neu gemischt (random.daily).
 * Gut Bewertetes kommt nach vorn; kürzlich gesehene Bücher machen Platz (staleness) und dürfen nach
 * ein, zwei Wochen wiederkommen – lange Ignoriertes nur noch selten.
 */
import { ageWeight, bayesRating, discoveryPrior, hasGerman } from './discovery';
import { rotate } from './freshness';
import { settle } from './http';
import { docToBook, searchWorks } from './openLibrary';
import type { TasteProfile } from './profile';
import type { ReadIndex } from '../store/library';
import { scoreForProfile } from './recommend';
import { detectGenres } from './taxonomy';
import { normalize, solrPhrase } from './text';
import type { Book, LanguagePreference, Reason, ScoredBook } from './types';

/** Bekannt genug, um gut zu sein – aber weit weg von den Welt-Bestsellern. */
export const DISCOVERY_BAND = 'ratings_count:[12 TO 400] readinglog_count:[30 TO 2500]';

const langClause = (language: LanguagePreference) => (language === 'any' ? '' : ' language:ger');

async function pool(q: string, limit: number, signal?: AbortSignal, offset = 0): Promise<Book[]> {
  const res = await settle(searchWorks(q, { sort: 'random.daily', limit, offset, lang: 'de', signal }));
  return res?.docs.map((d) => docToBook(d)) ?? [];
}

/** Gut gelesene, gut bewertete Bücher seit 1950 – täglich anders gemischt. */
export function discoveryPool(language: LanguagePreference, signal?: AbortSignal): Promise<Book[]> {
  return pool(`${DISCOVERY_BAND} first_publish_year:[1950 TO *]${langClause(language)}`, 100, signal);
}

/** Dasselbe Band, aber zu den Themen deines Profils. */
export function tastePool(subjects: string[], language: LanguagePreference, signal?: AbortSignal): Promise<Book[]> {
  if (!subjects.length) return Promise.resolve([]);
  return pool(`subject:(${subjects.map(solrPhrase).join(' OR ')}) ${DISCOVERY_BAND}${langClause(language)}`, 80, signal);
}

/** Neuerscheinungen der letzten Jahre, die schon ein paar Leute lesen – noch nicht überall. */
export function newReleasesPool(language: LanguagePreference, signal?: AbortSignal, now = new Date()): Promise<Book[]> {
  const from = now.getFullYear() - 3;
  // Mindestens ein paar Dutzend Leselisten-Einträge – darunter tummeln sich Selbstverlags-Fluten mit 5★ von Bekannten
  return pool(`first_publish_year:[${from} TO *] readinglog_count:[30 TO 3000]${langClause(language)}`, 80, signal);
}

export interface HomeRankContext {
  profile?: TasteProfile;
  readIndex: ReadIndex;
  language: LanguagePreference;
  /** 0 = frisch … 1.6 = kürzlich gesehen / oft ignoriert */
  staleness: (id: string) => number;
  /** Schon in einer anderen Reihe gezeigt */
  exclude?: Set<string>;
  max?: number;
  /** Mindest-Bewertung (Bayes-geglättet); neue Bücher haben oft noch zu wenige Bewertungen. */
  minRating?: number;
  day?: string;
}

/** Bilderbücher & Co. nur, wenn das Profil sie mag. */
function childrens(book: Book): boolean {
  return detectGenres(normalize(book.subjects.join(' | '))).includes('kinder');
}

export function rankForHome(books: Book[], ctx: HomeRankContext): ScoredBook[] {
  const likesKids = Boolean(ctx.profile?.genres.get('kinder'));
  const seen = new Set<string>();
  const authors = new Set<string>();
  const candidates = books.filter((b) => {
    if (seen.has(b.id) || ctx.exclude?.has(b.id) || ctx.readIndex.has(b)) return false;
    seen.add(b.id);
    if (!b.coverId && !b.coverUrl) return false;
    if (ctx.language === 'de-only' && !hasGerman(b)) return false;
    if (!likesKids && childrens(b)) return false;
    if (ctx.minRating && (bayesRating(b) ?? 0) < ctx.minRating) return false;
    return true;
  });
  const scored = candidates.map((b): ScoredBook => {
    const bayes = bayesRating(b) ?? 3.7;
    const base = (bayes - 3.8) * 1.2 + discoveryPrior(b) * 0.4 + ageWeight(b).adj * 0.5;
    const taste = ctx.profile ? scoreForProfile(b, { profile: ctx.profile, readIndex: ctx.readIndex, language: ctx.language }) : undefined;
    const reasons: Reason[] = taste?.reasons.filter((r) => r.kind === 'taste' || r.kind === 'rating') ?? [];
    if (!taste && bayes >= 4.05 && (b.ratingsCount ?? 0) >= 5) reasons.push({ kind: 'rating', label: `★ ${b.rating!.toFixed(1)}` });
    return { book: b, score: base + (taste ? taste.score * 3 : 0), match: 0, reasons };
  });
  const rotated = rotate(scored, ctx.staleness, { day: ctx.day, jitter: 0.25 }).sort((a, b) => b.score - a.score);
  // Höchstens ein Buch je Autor:in pro Reihe
  const out: ScoredBook[] = [];
  for (const s of rotated) {
    const author = normalize(s.book.authors[0] ?? s.book.id);
    if (authors.has(author)) continue;
    authors.add(author);
    out.push(s);
    if (out.length >= (ctx.max ?? 16)) break;
  }
  return out;
}
