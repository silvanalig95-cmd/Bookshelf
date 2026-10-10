/** Findet zu Titel + Autor (z. B. aus einer KI-Antwort) das passende Werk. */
import { docToBook, searchWorks } from './openLibrary';
import { authorSurname, bookFingerprint, normalize, normalizeTitle } from './text';
import type { Book } from './types';

export async function resolveBook(title: string, author: string, signal?: AbortSignal): Promise<Book | undefined> {
  const surname = authorSurname(author);
  const q = `${normalizeTitle(title) || normalize(title)} ${surname}`.trim();
  const res = await searchWorks(q, { limit: 8, lang: 'de', signal });
  const books = res.docs.map((d) => docToBook(d));
  const target = bookFingerprint(title, [author]);
  const byAuthor = books.filter((b) => !surname || b.authors.some((a) => authorSurname(a) === surname || normalize(a).includes(surname)));
  return (
    byAuthor.find((b) => bookFingerprint(b.title, b.authors) === target || (b.originalTitle && bookFingerprint(b.originalTitle, b.authors) === target)) ??
    byAuthor.sort((a, b) => (b.editionCount ?? 0) - (a.editionCount ?? 0))[0]
  );
}
