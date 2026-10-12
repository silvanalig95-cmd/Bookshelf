/**
 * Stellt einen neuen Swipe-Stapel zusammen: Genres und Neuland nach dem Swipe-Modell
 * (planDeck), je Genre Bücher aus zwei Töpfen – Beliebtes seit 1990 und Beliebtes aller Zeiten.
 * Ohne den neueren Topf bestünde der Stapel fast nur aus Klassikern, denn die meistgelesenen
 * Bücher auf Open Library sind Schullektüre und Weltliteratur.
 */
import { ageWeight, discoveryPrior } from './discovery';
import { settle } from './http';
import { docToBook, searchWorks } from './openLibrary';
import { bookFeatures, contentFit, interleave, MODERN_FROM, modernShare, planDeck, SWIPE_GENRES, type DeckSlot, type Rng, type SwipeModel } from './swipeModel';
import { normalize, seededShuffle, solrPhrase } from './text';
import type { Book } from './types';

export interface DeckCard {
  book: Book;
  /** Warum die Karte im Stapel liegt – macht das Lernen nachvollziehbar. */
  why: string;
}

export interface DrawOptions {
  size?: number;
  /** z. B. " language:ger" */
  langClause: string;
  /** Schlagwörter aus dem Gesamtprofil (Bibliothek & Co.) für zwei Karten „passt zu deinem Profil“. */
  librarySubjects?: string[];
  /** Schon gesehen, gelesen, ohne Cover …? */
  usable: (b: Book) => boolean;
  markSeen: (b: Book) => void;
  /** Austauschbar für Tests. */
  search?: (q: string, sort: 'readinglog' | 'rating', offset: number) => Promise<Book[]>;
  rng?: Rng;
}

/** Sammelgenres – für die Beschriftung einer Karte zählt das spezifischere Genre. */
const GENERIC = ['literatur', 'klassiker', 'jugend', 'kinder', 'familie', 'kurzgeschichten'];

const subjectClause = (subjects: string[]) => `subject:(${subjects.map(solrPhrase).join(' OR ')})`;

const defaultSearch = (q: string, sort: 'readinglog' | 'rating', offset: number) =>
  settle(searchWorks(q, { sort, limit: 20, offset, lang: 'de' })).then((r) => (r?.docs ?? []).map((d) => docToBook(d)));

/** Beschriftung nach dem Genre des Buchs selbst – die Suche nach einem Genre liefert auch Verwandtes. */
export function genreLabel(b: Book, slotGenre: string): string {
  const own = bookFeatures(b).genres;
  if (own.includes(slotGenre)) return SWIPE_GENRES.find((g) => g.id === slotGenre)!.label;
  const specific = SWIPE_GENRES.filter((g) => own.includes(g.id)).sort((x, y) => Number(GENERIC.includes(x.id)) - Number(GENERIC.includes(y.id)));
  return specific[0]?.label ?? SWIPE_GENRES.find((g) => g.id === slotGenre)?.label ?? '';
}

export async function drawDeck(model: SwipeModel, opts: DrawOptions): Promise<DeckCard[]> {
  const rng = opts.rng ?? Math.random;
  const search = opts.search ?? defaultSearch;
  const shuffle = <T>(xs: T[]) => seededShuffle(xs, Math.floor(rng() * 2 ** 31));
  const page = () => Math.floor(rng() * 3) * 20;
  const recent = ` first_publish_year:[${MODERN_FROM} TO *]`;
  const slots = planDeck(model, { size: opts.size ?? 16, rng });

  const fetchSlot = async (slot: DeckSlot): Promise<{ modern: Book[]; all: Book[] }> => {
    const genre = subjectClause(slot.genre.subjects.slice(0, 3));
    const focused = slot.focus.length ? `${genre} AND ${subjectClause(slot.focus)}` : genre;
    const offset = slot.kind === 'neuland' || slot.focus.length ? 0 : page();
    const wantsModern = modernShare(model, slot.genre.id) > 0;
    const [modern, all] = await Promise.all([
      wantsModern ? search(`${focused}${recent}${opts.langClause}`, 'readinglog', offset) : Promise.resolve([]),
      search(`${focused}${opts.langClause}`, 'readinglog', offset),
    ]);
    // Ein Fokus kann zu eng sein – dann ohne ihn nachlegen
    if (slot.focus.length && modern.length + all.length < slot.count * 3) {
      const plain = await search(`${genre}${wantsModern ? recent : ''}${opts.langClause}`, 'readinglog', page());
      return wantsModern ? { modern: [...modern, ...plain], all } : { modern, all: [...all, ...plain] };
    }
    return { modern, all };
  };

  const library = opts.librarySubjects?.length ? search(`${subjectClause(opts.librarySubjects)}${opts.langClause}`, 'rating', page()) : Promise.resolve([]);
  const [pools, libraryBooks] = await Promise.all([Promise.all(slots.map(fetchSlot)), library]);

  // Höchstens ein Buch je Autor:in pro Stapel – sonst kommen vier Bände derselben Reihe
  const authorsUsed = new Set<string>();
  const authorOf = (b: Book) => normalize(b.authors[0] ?? b.id);
  const pick = (books: Book[], count: number, fitWeight: number, why: (b: Book) => string): DeckCard[] => {
    if (count <= 0) return [];
    const ranked = books
      .filter(opts.usable)
      .filter((b) => !authorsUsed.has(authorOf(b)))
      .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id || authorOf(x) === authorOf(b)) === i)
      // Passung zu deinen Swipes + bekannte Bücher bevorzugt + etwas Zufall, damit der Stapel lebendig bleibt
      .map((b) => ({ b, s: contentFit(b, model) * fitWeight + discoveryPrior(b) * 0.6 + ageWeight(b).adj * 0.8 + rng() * 0.6 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, count);
    for (const { b } of ranked) {
      opts.markSeen(b);
      authorsUsed.add(authorOf(b));
    }
    return ranked.map(({ b }) => ({ book: b, why: why(b) }));
  };

  const lists = slots.map((slot, i) => {
    const fit = slot.kind === 'neuland' ? 0.4 : 1;
    const why = (b: Book) => (slot.kind === 'neuland' ? 'Neuland: ' : '') + genreLabel(b, slot.genre.id);
    const { modern, all } = pools[i];
    const newer = pick(
      [...modern, ...all].filter((b) => (b.year ?? 0) >= MODERN_FROM),
      Math.round(slot.count * modernShare(model, slot.genre.id)),
      fit,
      why,
    );
    const older = pick(
      all.filter((b) => b.year && b.year < MODERN_FROM),
      slot.count - newer.length,
      fit,
      why,
    );
    // Reicht ein Topf nicht, füllt der andere auf
    const rest = pick([...modern, ...all], slot.count - newer.length - older.length, fit, why);
    return shuffle([...newer, ...older, ...rest]);
  });
  if (libraryBooks.length) lists.push(pick(libraryBooks, 2, 1, () => 'passt zu deinem Profil'));
  return interleave(shuffle(lists));
}
