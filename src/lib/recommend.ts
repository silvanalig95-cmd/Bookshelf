/**
 * „Für dich“: algorithmische Empfehlungen aus Bibliothek und Geschmacksprofil.
 *
 *  - Top-Treffer: Kandidaten aus deinen stärksten Themen, gerankt nach
 *    Kosinus-Ähnlichkeit zu deinem Profil × Qualität (geglättete Bewertung).
 *  - Weil du X mochtest: Bücher mit ähnlichen Themen wie deine Lieblinge.
 *  - Lieblingsautor:innen: Werke, die du noch nicht gelesen hast.
 *  - Geheimtipps: gut bewertet, aber kaum bekannt – in deinen Themen.
 *  - Über den Tellerrand: verwandte Themen, die du selten liest (Serendipität).
 */
import { bayesRating, distinctiveSubjects, hasGerman, mergeBooks, popularityLevel } from './discovery';
import { settle } from './http';
import { docToBook, getSubject, searchWorks, subjectKey, type OLSort } from './openLibrary';
import { conceptsOf, tasteMatch, type TasteProfile } from './profile';
import type { ReadIndex } from '../store/library';
import { isNoiseSubject, subjectLabel } from './taxonomy';
import { clamp, solrPhrase } from './text';
import type { Book, LanguagePreference, LibraryEntry, Reason, ScoredBook } from './types';

export interface RecSection {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  items: ScoredBook[];
}

interface RecContext {
  profile: TasteProfile;
  readIndex: ReadIndex;
  language: LanguagePreference;
  dismissed?: Set<string>;
}

function langClause(language: LanguagePreference): string {
  return language === 'any' ? '' : ' language:ger';
}

async function query(q: string, sort: OLSort, limit: number, offset = 0): Promise<Book[]> {
  const res = await settle(searchWorks(q, { sort, limit, offset, lang: 'de' }));
  return res?.docs.map((d) => docToBook(d)) ?? [];
}

export function scoreForProfile(book: Book, ctx: RecContext, extraReasons: Reason[] = []): ScoredBook | undefined {
  if (ctx.readIndex.has(book)) return undefined;
  if (ctx.dismissed?.has(book.id)) return undefined;
  if (ctx.language === 'de-only' && !hasGerman(book)) return undefined;
  const tm = tasteMatch(ctx.profile, book);
  const bayes = bayesRating(book) ?? 3.75;
  const quality = (bayes - 3.75) * 0.6;
  const german = hasGerman(book) ? 0.08 : 0;
  const score = tm.similarity + quality * 0.25 + german + Math.min(0.15, tm.authorBonus * 0.04) + popularityLevel(book) * 0.01;
  const reasons: Reason[] = [...extraReasons];
  if (tm.shared.length) reasons.push({ kind: 'taste', label: `💛 ${tm.shared.slice(0, 2).join(', ')}` });
  if (german) reasons.push({ kind: 'german', label: '🇩🇪 auf Deutsch' });
  if ((bayesRating(book) ?? 0) >= 4.05 && (book.ratingsCount ?? 0) >= 5) reasons.push({ kind: 'rating', label: `★ ${book.rating!.toFixed(1)}` });
  const match = Math.round(clamp(45 + (tm.similarity / 0.35) * 45 + quality * 8, 5, 99));
  return { book, score, match, reasons };
}

function rank(books: Book[], ctx: RecContext, extra: Reason[] = [], max = 18): ScoredBook[] {
  return books
    .map((b) => scoreForProfile(b, ctx, extra))
    .filter((x): x is ScoredBook => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/** Bücher, die Lieblingsbüchern ähneln („Weil du X mochtest“). */
export async function becauseYouLiked(entry: LibraryEntry, ctx: RecContext): Promise<RecSection | undefined> {
  // Was macht gerade dieses Buch aus? Themen, die in deinem Profil ohnehin dominieren,
  // sind hier wenig aussagekräftig – die spezifischeren zuerst.
  const common = new Set(ctx.profile.topConcepts.slice(0, 6).map((c) => c.concept));
  const candidates = distinctiveSubjects((entry.subjects ?? []).filter((s) => !isNoiseSubject(s)), 20);
  const specific = candidates.filter((s) => !conceptsOf([s]).every((c) => common.has(c)));
  const subjects = (specific.length >= 2 ? specific : candidates).slice(0, 5);
  if (subjects.length < 2) return undefined;
  const books = await query(`subject:(${subjects.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`, 'readinglog', 50);
  const refConcepts = new Set(conceptsOf(subjects));
  const items = books
    .filter((b) => b.workKey !== entry.workKey)
    .map((b) => {
      const scored = scoreForProfile(b, ctx);
      if (!scored) return undefined;
      const overlap = conceptsOf(b.subjects).filter((c) => refConcepts.has(c)).length;
      if (!overlap) return undefined;
      scored.score = scored.score * 0.5 + Math.min(4, overlap) * 0.15;
      return scored;
    })
    .filter((x): x is ScoredBook => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
  if (items.length < 3) return undefined;
  return {
    id: `because-${entry.id}`,
    title: `Weil du „${entry.title.replace(/\s*\(.*?\)\s*/g, ' ').trim()}“ mochtest`,
    subtitle: `${'★'.repeat(entry.rating || 0)} · ${subjects.slice(0, 3).map(subjectLabel).join(', ')}`,
    icon: '💛',
    items,
  };
}

export async function topMatches(ctx: RecContext): Promise<RecSection | undefined> {
  const subjects = ctx.profile.querySubjects;
  if (subjects.length < 3) return undefined;
  const groups = [subjects.slice(0, 4), subjects.slice(4, 8), subjects.slice(8, 12)].filter((g) => g.length);
  const lists = await Promise.all(
    groups.flatMap((g) => [
      query(`subject:(${g.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`, 'rating', 40),
      query(`subject:(${g.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`, 'readinglog', 40),
    ]),
  );
  const items = rank(mergeBooks(lists), ctx, [], 24);
  if (!items.length) return undefined;
  return { id: 'top', title: 'Deine Top-Treffer', subtitle: 'Ähnlichkeit zu deinem Geschmacksprofil × Bewertung', icon: '🎯', items };
}

export async function favoriteAuthorsSection(ctx: RecContext): Promise<RecSection | undefined> {
  const authors = ctx.profile.favoriteAuthors.slice(0, 8);
  if (!authors.length) return undefined;
  const lists = await Promise.all(authors.map((a) => query(`author:${solrPhrase(a.name)}${langClause(ctx.language)}`, 'readinglog', 12)));
  const items = lists
    .flatMap((list, i) =>
      list
        .filter((b) => b.authors.some((x) => x.toLowerCase().includes(authors[i].name.split(' ').pop()!.toLowerCase())))
        .map((b) => scoreForProfile(b, ctx, [{ kind: 'author', label: `✍️ ${authors[i].name}` }]))
        .filter((x): x is ScoredBook => Boolean(x))
        .slice(0, 3),
    )
    .sort((a, b) => b.score - a.score);
  if (!items.length) return undefined;
  return { id: 'authors', title: 'Mehr von deinen Lieblingsautor:innen', subtitle: authors.map((a) => a.name).slice(0, 5).join(' · '), icon: '✍️', items };
}

export async function hiddenGems(ctx: RecContext): Promise<RecSection | undefined> {
  const subjects = ctx.profile.querySubjects.slice(0, 6);
  if (subjects.length < 2) return undefined;
  const books = await query(
    `subject:(${subjects.map(solrPhrase).join(' OR ')}) readinglog_count:[1 TO 150] ratings_count:[3 TO *]${langClause(ctx.language)}`,
    'rating',
    50,
  );
  const items = rank(books, ctx, [{ kind: 'fame', label: '💎 Geheimtipp' }], 16).filter((s) => (bayesRating(s.book) ?? 0) >= 3.9);
  if (items.length < 3) return undefined;
  return { id: 'gems', title: 'Geheimtipps für dich', subtitle: 'Sehr gut bewertet, aber kaum bekannt', icon: '💎', items };
}

/** Serendipität: verwandte Themen deines Lieblingsthemas, die in deinem Profil kaum vorkommen. */
export async function beyondTheEdge(ctx: RecContext): Promise<RecSection | undefined> {
  const seed = ctx.profile.querySubjects[0];
  if (!seed) return undefined;
  const details = await settle(getSubject(subjectKey(seed), 6));
  if (!details) return undefined;
  const known = new Set(ctx.profile.topConcepts.slice(0, 20).map((c) => c.concept));
  const fresh = details.subjects
    .filter((s) => !conceptsOf([s.name]).some((c) => known.has(c)) && !/fiction|juvenile|general|accessible|large type/i.test(s.name))
    .slice(0, 4)
    .map((s) => s.name);
  if (!fresh.length) return undefined;
  const books = await query(`subject:(${fresh.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`, 'rating', 40);
  const items = books
    .filter((b) => !ctx.readIndex.has(b))
    .map((b) => {
      const s = scoreForProfile(b, ctx, [{ kind: 'similar', label: `🧭 Neuland: ${subjectLabel(fresh.find((f) => b.subjects.includes(f)) ?? fresh[0])}` }]);
      if (s) s.score = (bayesRating(b) ?? 3.5) + Math.random() * 0.3;
      return s;
    })
    .filter((x): x is ScoredBook => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
  if (items.length < 3) return undefined;
  return { id: 'edge', title: 'Über den Tellerrand', subtitle: `Verwandt mit „${subjectLabel(seed)}“, aber neu für dich: ${fresh.map(subjectLabel).join(', ')}`, icon: '🧭', items };
}

/** Die Lieblingsbücher, für die „Weil du X mochtest“-Reihen gebaut werden. */
export function pickFavorites(entries: LibraryEntry[], max = 4): LibraryEntry[] {
  const candidates = entries
    .filter((e) => e.shelf === 'read' && e.rating >= 4 && (e.subjects?.length ?? 0) >= 3)
    .sort((a, b) => b.rating - a.rating || (b.dateRead ?? '').localeCompare(a.dateRead ?? ''));
  // Etwas Abwechslung: aus den besten 12 zufällig wählen, Autor:innen nicht doppeln
  const pool = candidates.slice(0, 12).sort(() => Math.random() - 0.5);
  const out: LibraryEntry[] = [];
  const authors = new Set<string>();
  for (const e of pool) {
    if (authors.has(e.authors[0])) continue;
    authors.add(e.authors[0]);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

export interface RecommendationRun {
  sections: RecSection[];
}

export async function buildRecommendations(entries: LibraryEntry[], ctx: RecContext, onSection: (s: RecSection) => void): Promise<void> {
  const tasks: Array<Promise<RecSection | undefined>> = [topMatches(ctx), favoriteAuthorsSection(ctx), hiddenGems(ctx), beyondTheEdge(ctx)];
  for (const fav of pickFavorites(entries)) tasks.push(becauseYouLiked(fav, ctx));
  await Promise.all(tasks.map((t) => settle(t).then((s) => s && s.items.length && onSection(s))));
}

export function uniqueAcrossSections(sections: RecSection[]): RecSection[] {
  const seen = new Set<string>();
  const order = ['top', 'authors', 'gems', 'edge'];
  const sorted = [...sections].sort((a, b) => {
    const ia = order.indexOf(a.id) === -1 ? 1.5 : order.indexOf(a.id);
    const ib = order.indexOf(b.id) === -1 ? 1.5 : order.indexOf(b.id);
    return ia - ib;
  });
  return sorted
    .map((s) => ({ ...s, items: s.items.filter((i) => (seen.has(i.book.id) ? false : (seen.add(i.book.id), true))) }))
    .filter((s) => s.items.length >= 3);
}

