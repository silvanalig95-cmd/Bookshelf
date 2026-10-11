/**
 * Findet zu Titel + Autor (z. B. aus einer KI-Antwort) das passende Werk.
 *
 * Autor:innen werden auch über ihre Schreibvarianten erkannt („Dostojewski“ ↔ „Фёдор Достоевский“,
 * „Murakami“ ↔ „村上春樹“): Die Autorensuche von Open Library kennt die Varianten, und ihr Schlüssel
 * muss zum Werk passen. Unter den passenden Werken gewinnt der ähnlichste Titel, dann das Werk mit
 * den meisten Ausgaben.
 */
import { authorMatch } from './lookup';
import { docToBook, searchAuthors, searchWorks } from './openLibrary';
import { authorSurname, contentWords, normalize, normalizeTitle, similarWord } from './text';
import type { Book } from './types';

/** Anteil der gesuchten Titelwörter, die im Kandidaten vorkommen (0–1). */
function titleOverlap(wanted: string[], candidate: string): number {
  if (!wanted.length) return 0;
  const got = contentWords(normalizeTitle(candidate) || candidate);
  return wanted.filter((w) => got.some((g) => similarWord(w, g))).length / wanted.length;
}

export async function resolveBook(title: string, author: string, signal?: AbortSignal): Promise<Book | undefined> {
  const cleanTitle = normalizeTitle(title) || normalize(title);
  const wanted = contentWords(cleanTitle);
  const surname = authorSurname(author);
  const find = (q: string) =>
    searchWorks(q, { limit: 10, lang: 'de', signal })
      .then((r) => r.docs.map((d) => docToBook(d)))
      .catch(() => [] as Book[]);

  const [withAuthor, authors] = await Promise.all([
    find(`${cleanTitle} ${surname}`.trim()),
    author.trim() ? searchAuthors(author, { limit: 5, signal }).catch(() => []) : Promise.resolve([]),
  ]);
  // Steht der Name in der Suche anders als in Open Library, findet der Titel allein oft mehr
  const books = withAuthor.length ? withAuthor : await find(cleanTitle);

  const authorWords = contentWords(author);
  const keys = new Set(authors.filter((a) => authorMatch(a, authorWords).length > 0).map((a) => a.key));
  const byAuthor = (b: Book) =>
    !surname ||
    Boolean(b.authorKeys?.some((k) => keys.has(k))) ||
    b.authors.some((a) => {
      const s = authorSurname(a);
      return s === surname || normalize(a).includes(surname) || similarWord(s, surname);
    });

  const ranked = books
    .filter(byAuthor)
    .map((b) => ({ b, t: Math.max(titleOverlap(wanted, b.title), b.originalTitle ? titleOverlap(wanted, b.originalTitle) : 0) }))
    // Ohne passenden Titel lieber gar nichts als ein falsches Buch derselben Autor:in
    .filter((x) => x.t >= 0.5 || !wanted.length)
    .sort((x, y) => y.t - x.t || (y.b.editionCount ?? 0) - (x.b.editionCount ?? 0));
  const best = ranked[0]?.b;
  // „村上春樹“ → so, wie der Name genannt wurde („Haruki Murakami“)
  if (best && author.trim() && LATIN.test(author) && best.authors[0] && !LATIN.test(best.authors[0])) {
    return { ...best, authors: [author.trim(), ...best.authors.slice(1)] };
  }
  return best;
}

const LATIN = /^[\p{Script=Latin}\p{P}\s]+$/u;
