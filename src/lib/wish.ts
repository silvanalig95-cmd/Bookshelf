/**
 * Bereitet einen Suchauftrag der Entdecken-Seite vor: Wunsch deuten, „wie <Titel>“ auflösen
 * und erkennen, ob ein konkretes Buch oder eine Autor:in gemeint ist.
 */
import { interpretWish, originalWord, type DiscoveryParams, type SimilarRef, type WishInterpretation } from './discovery';
import { lookupWish, worthLookingUp, type WishLookup } from './lookup';
import { resolveBook } from './resolve';
import { normalize } from './text';
import type { Book } from './types';

export function toRef(book: Book): SimilarRef {
  return { id: book.id, title: book.title, authors: book.authors.slice(0, 2), authorKeys: book.authorKeys?.slice(0, 2), subjects: book.subjects.slice(0, 40) };
}

const LATIN = /^[\p{Script=Latin}\p{P}\s]+$/u;
const latin = (name?: string) => (name && LATIN.test(name) ? name : undefined);

export interface PreparedWish {
  wish?: WishInterpretation;
  similar: SimilarRef[];
  lookup?: WishLookup;
}

export async function understandWish(p: DiscoveryParams, signal?: AbortSignal): Promise<PreparedWish> {
  let wish = p.wish.trim() ? interpretWish(p.wish) : undefined;
  const similar: SimilarRef[] = [];
  for (const t of wish?.similarTitles.slice(0, 2) ?? []) {
    const b = await resolveBook(t, '', signal).catch(() => undefined);
    if (b) similar.push(toRef(b));
  }

  // Nennt der Wunsch ein Buch oder eine Autor:in („Aufzeichnungen aus dem Untergrund Dostojewski“)? Dann genau danach suchen –
  // sonst das Feld „Stichwörter, Titel oder Autor:in“.
  const pure = !(wish?.genres.length || wish?.moods.length || wish?.places.length || wish?.eras.length);
  const fromWish = Boolean(wish?.keywords.length && !wish.similarTitles.length);
  const source = fromWish ? (pure ? p.wish : wish!.keywords.join(' ')) : !p.wish.trim() && worthLookingUp(p.text) ? p.text : '';
  if (!source) return { wish, similar };
  // Stehen schon Genres/Stimmungen im Wunsch, nur nach Autor:innen suchen (sonst wird aus „Krimi mit Leuchtturm“ ein Buchtitel) –
  // und nur, wenn sie wie ein Name eingeleitet sind („Krimi von Mankell“)
  const descriptive = fromWish && !pure;
  const cues = descriptive ? Array.from(p.wish.matchAll(/\b(?:von|by)\s+([\p{L}'’-]+)/giu), (m) => normalize(m[1])) : undefined;
  const found = await lookupWish(source, { books: !descriptive, cues, signal }).catch(() => undefined);
  if (!found || (!found.book && !found.author)) return { wish, similar };

  // Den Namen so zeigen, wie er eingegeben wurde – sonst nur in lateinischer Schrift (nicht „Фёдор Достоевский“)
  const typed = fromWish ? p.wish : p.text;
  const author = found.authorWords.length
    ? found.authorWords.map((w) => originalWord(typed, w)).join(' ')
    : (latin(found.author?.name) ?? found.book?.authors.map(latin).find(Boolean));
  const base = wish ?? interpretWish('');
  wish = { ...base, keywords: base.keywords.filter((k) => !found.consumed.includes(k)), found: { title: found.book?.title, author } };
  if (found.book) similar.unshift(toRef({ ...found.book, subjects: found.similarSubjects ?? found.book.subjects }));
  return { wish, similar, lookup: found };
}
