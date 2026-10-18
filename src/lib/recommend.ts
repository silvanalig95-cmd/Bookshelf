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
import { rotate, spreadAuthors } from './freshness';
import { ageWeight, bayesRating, discoveryPrior, distinctiveSubjects, hasGerman, MIN_RATINGS, mergeBooks } from './discovery';
import { settle } from './http';
import { docToBook, getSubject, searchWorks, subjectKey, type OLSort } from './openLibrary';
import { conceptsOf, tasteMatch, type TasteProfile } from './profile';
import type { ReadIndex } from '../store/library';
import { isNoiseSubject, subjectLabel } from './taxonomy';
import { authorSurname, clamp, solrPhrase } from './text';
import type { Book, LanguagePreference, LibraryEntry, Reason, ScoredBook } from './types';

export interface RecSection {
  id: string;
  title: string;
  subtitle?: string;
  items: ScoredBook[];
}

interface RecContext {
  profile: TasteProfile;
  readIndex: ReadIndex;
  language: LanguagePreference;
  dismissed?: Set<string>;
  /** Abzug für lange ignorierte Bücher (0–1), siehe lib/freshness. */
  fatigue?: (id: string) => number;
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
  // Bekanntheit als spürbarer Zuschlag – Obskures rutscht nach hinten (ausser in „Geheimtipps“, siehe hiddenGems)
  const age = ageWeight(book);
  const score = tm.similarity + quality * 0.25 + german + Math.min(0.15, tm.authorBonus * 0.04) + discoveryPrior(book) * 0.08 + age.adj * 0.12;
  const reasons: Reason[] = [...extraReasons];
  if (tm.shared.length) reasons.push({ kind: 'taste', label: tm.shared.slice(0, 2).join(', ') });
  if (german) reasons.push({ kind: 'german', label: 'auf Deutsch' });
  if ((bayesRating(book) ?? 0) >= 4.05 && (book.ratingsCount ?? 0) >= 5) reasons.push({ kind: 'rating', label: `★ ${book.rating!.toFixed(1)}` });
  if (age.classic) reasons.push({ kind: 'fame', label: 'Klassiker' });
  const match = Math.round(clamp(45 + (tm.similarity / 0.35) * 45 + quality * 8, 5, 99));
  return { book, score, match, reasons };
}

/** Gesehenes macht Platz (ctx.fatigue), dann höchstens `perAuthor` Bücher pro Autor:in. */
function freshOrder(scored: ScoredBook[], ctx: RecContext, perAuthor: number): ScoredBook[] {
  const rotated = ctx.fatigue ? rotate(scored, ctx.fatigue) : scored;
  return spreadAuthors(rotated.sort((a, b) => b.score - a.score), perAuthor);
}

function rank(books: Book[], ctx: RecContext, extra: Reason[] = [], max = 18, perAuthor = 1): ScoredBook[] {
  const scored = books.map((b) => scoreForProfile(b, ctx, extra)).filter((x): x is ScoredBook => Boolean(x));
  return freshOrder(scored, ctx, perAuthor).slice(0, max);
}

/** Bei jedem Besuch eine andere Seite der Trefferliste – damit nicht immer dieselben Bücher vorne liegen. */
const someOffset = () => [0, 0, 20, 40][Math.floor(Math.random() * 4)];

/** Bücher, die Lieblingsbüchern ähneln („Weil du X mochtest“). */
export async function becauseYouLiked(entry: LibraryEntry, ctx: RecContext): Promise<RecSection | undefined> {
  // Was macht gerade dieses Buch aus? Themen, die in deinem Profil ohnehin dominieren,
  // sind hier wenig aussagekräftig – die spezifischeren zuerst.
  const common = new Set(ctx.profile.topConcepts.slice(0, 6).map((c) => c.concept));
  const candidates = distinctiveSubjects((entry.subjects ?? []).filter((s) => !isNoiseSubject(s)), 20);
  const specific = candidates.filter((s) => !conceptsOf([s]).every((c) => common.has(c)));
  const subjects = (specific.length >= 2 ? specific : candidates).slice(0, 5);
  if (subjects.length < 2) return undefined;
  const q = `subject:(${subjects.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`;
  const books = mergeBooks(await Promise.all([query(q, 'readinglog', 50, someOffset()), query(q, 'random.hourly', 30)]));
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
    .filter((x): x is ScoredBook => Boolean(x));
  const ordered = freshOrder(items, ctx, 2).slice(0, 14);
  if (ordered.length < 3) return undefined;
  return {
    id: `because-${entry.id}`,
    title: `Weil du „${entry.title.replace(/\s*\(.*?\)\s*/g, ' ').trim()}“ mochtest`,
    subtitle: `${'★'.repeat(entry.rating || 0)} · ${subjects.slice(0, 3).map(subjectLabel).join(', ')}`,
    items: ordered,
  };
}

export async function topMatches(ctx: RecContext): Promise<RecSection | undefined> {
  const subjects = ctx.profile.querySubjects;
  if (subjects.length < 3) return undefined;
  const groups = [subjects.slice(0, 4), subjects.slice(4, 8), subjects.slice(8, 12)].filter((g) => g.length);
  const lists = await Promise.all(
    groups.flatMap((g) => [
      query(`subject:(${g.map(solrPhrase).join(' OR ')}) ratings_count:[${MIN_RATINGS} TO *]${langClause(ctx.language)}`, 'rating', 40, someOffset()),
      query(`subject:(${g.map(solrPhrase).join(' OR ')})${langClause(ctx.language)}`, 'readinglog', 40, someOffset()),
      // Zufällige Auswahl, die stündlich wechselt – bringt Bücher nach vorne, die sonst nie oben landen
      query(`subject:(${g.map(solrPhrase).join(' OR ')}) ratings_count:[${MIN_RATINGS} TO *]${langClause(ctx.language)}`, 'random.hourly', 40),
    ]),
  );
  const items = rank(mergeBooks(lists), ctx, [], 24);
  if (!items.length) return undefined;
  return { id: 'top', title: 'Deine Top-Treffer', subtitle: 'Ähnlichkeit zu deinem Geschmacksprofil × Bewertung', items };
}

export async function favoriteAuthorsSection(ctx: RecContext): Promise<RecSection | undefined> {
  // Jedes Mal eine andere Auswahl aus den Lieblingsautor:innen
  const authors = [...ctx.profile.favoriteAuthors.slice(0, 14)].sort(() => Math.random() - 0.5).slice(0, 7);
  if (!authors.length) return undefined;
  const lists = await Promise.all(authors.map((a) => query(`author:${solrPhrase(a.name)}${langClause(ctx.language)}`, 'readinglog', 12)));
  const items = lists
    .flatMap((list, i) =>
      list
        .filter((b) => b.authors.some((x) => x.toLowerCase().includes(authors[i].name.split(' ').pop()!.toLowerCase())))
        .map((b) => scoreForProfile(b, ctx, [{ kind: 'author', label: 'Lieblingsautor:in' }]))
        .filter((x): x is ScoredBook => Boolean(x)),
    );
  const ordered = freshOrder(items, ctx, 2);
  if (!ordered.length) return undefined;
  return { id: 'authors', title: 'Mehr von deinen Lieblingsautor:innen', subtitle: authors.map((a) => a.name).slice(0, 5).join(' · '), items: ordered.slice(0, 18) };
}

export async function hiddenGems(ctx: RecContext): Promise<RecSection | undefined> {
  const subjects = ctx.profile.querySubjects.slice(0, 6);
  if (subjects.length < 2) return undefined;
  const q = `subject:(${subjects.map(solrPhrase).join(' OR ')}) readinglog_count:[1 TO 150] ratings_count:[3 TO *]${langClause(ctx.language)}`;
  const books = mergeBooks(await Promise.all([query(q, 'rating', 50, someOffset()), query(q, 'random.hourly', 40)]));
  const items = rank(books, ctx, [{ kind: 'fame', label: 'Geheimtipp' }], 16).filter((s) => (bayesRating(s.book) ?? 0) >= 3.9);
  if (items.length < 3) return undefined;
  return { id: 'gems', title: 'Geheimtipps für dich', subtitle: 'Sehr gut bewertet, aber kaum bekannt', items };
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
  const books = await query(`subject:(${fresh.map(solrPhrase).join(' OR ')}) ratings_count:[${MIN_RATINGS} TO *]${langClause(ctx.language)}`, 'rating', 40);
  const items = books
    .filter((b) => !ctx.readIndex.has(b))
    .map((b) => {
      const s = scoreForProfile(b, ctx, [{ kind: 'similar', label: `Neuland: ${subjectLabel(fresh.find((f) => b.subjects.includes(f)) ?? fresh[0])}` }]);
      if (s) s.score = (bayesRating(b) ?? 3.5) + Math.random() * 0.3;
      return s;
    })
    .filter((x): x is ScoredBook => Boolean(x));
  const ordered = freshOrder(items, ctx, 1).slice(0, 14);
  if (ordered.length < 3) return undefined;
  return { id: 'edge', title: 'Über den Tellerrand', subtitle: `Verwandt mit „${subjectLabel(seed)}“, aber neu für dich: ${fresh.map(subjectLabel).join(', ')}`, items: ordered };
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
  // Über alle Reihen höchstens drei Bücher pro Autor:in (ausser in „Mehr von deinen Lieblingsautor:innen“)
  const perAuthor = new Map<string, number>();
  return sorted
    .map((s) => {
      const unique = s.items.filter((i) => (seen.has(i.book.id) ? false : (seen.add(i.book.id), true)));
      if (s.id === 'authors') return { ...s, items: unique };
      const kept = unique.filter((i) => {
        const a = authorSurname(i.book.authors[0] ?? '');
        const n = perAuthor.get(a) ?? 0;
        if (a && n >= 3) return false;
        perAuthor.set(a, n + 1);
        return true;
      });
      return { ...s, items: kept };
    })
    .filter((s) => s.items.length >= 3);
}

