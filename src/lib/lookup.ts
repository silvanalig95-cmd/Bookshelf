/**
 * Erkennt, ob ein Wunsch eigentlich ein konkretes Buch und/oder eine Autorin nennt –
 * z. B. „Aufzeichnungen aus dem Untergrund Fyodor Dostoevsky“ oder „Dostojewski“.
 * Dann sucht die Entdecken-Seite genau danach (plus Ähnliches), statt die Wörter
 * einzeln als Stichwörter zu behandeln.
 */
import { docToBook, searchAuthors, searchWorks, type OLAuthorDoc } from './openLibrary';
import { contentWords, normalize, similarWord, uniq } from './text';
import type { Book } from './types';

export interface FoundAuthor {
  key: string;
  name: string;
  workCount: number;
}

export interface WishLookup {
  /** Das gesuchte Buch. */
  book?: Book;
  author?: FoundAuthor;
  /** Wörter des Wunschs, die durch Buch/Autor erklärt sind (keine Stichwörter mehr). */
  consumed: string[];
  /** Die Wörter, mit denen die Autor:in genannt wurde (normalisiert) – für die Anzeige in der eigenen Schreibweise. */
  authorWords: string[];
  /** Themen, nach denen „Ähnliches“ gesucht wird (bei themenlosen Ausgaben die der bekanntesten Werke). */
  similarSubjects?: string[];
}

const MAX_WORDS = 10;
const MIN_AUTHOR_WORKS = 3;
/** Personennamen haben selten mehr als vier Teile – „Gesellschaft für Deutsch-Sowjetische Freundschaft“ ist keine Autorin. */
const MAX_NAME_PARTS = 4;
const ORGANISATION = /\b(gesellschaft|verlag|verein|institut|museum|universitat|university|society|association|press|publishing|ministerium|bibliothek|library|kommission|committee|staff|editors)\b/;

function nameTokens(doc: OLAuthorDoc): string[] {
  return uniq([doc.name, ...(doc.alternate_names ?? [])].flatMap((n) => normalize(n).split(' ')).filter((t) => t.length >= 3));
}

function titleTokens(book: Book): string[][] {
  return [book.title, book.originalTitle]
    .filter((t): t is string => Boolean(t))
    .map((t) => contentWords(t.split(/[:.]/)[0]))
    .filter((t) => t.length > 0);
}

const covered = (tokens: string[], pool: string[]) => tokens.every((t) => pool.some((q) => similarWord(t, q)));

/** Welche Wörter der Anfrage passen zu dieser Autorin? */
export function authorMatch(doc: OLAuthorDoc, query: string[]): string[] {
  const names = nameTokens(doc);
  return query.filter((q) => q.length >= 4 && names.some((n) => similarWord(q, n)));
}

/** Wählt aus Werk- und Autorensuche das Passende (rein, ohne Netz – für Tests). */
export interface LookupOptions {
  /** false: nur nach Autor:innen suchen (der Wunsch nennt schon Genres/Stimmungen). */
  books?: boolean;
  /**
   * Wörter direkt nach „von“/„by“. Ist die Liste gesetzt, zählt eine Autor:in nur, wenn sie so eingeleitet
   * oder mit Vor- und Nachnamen genannt wird – sonst wäre in „Roman über Freundschaft“ jedes Substantiv ein Name.
   */
  cues?: string[];
}

const personLike = (a: OLAuthorDoc) => {
  const name = normalize(a.name);
  return name.split(' ').length <= MAX_NAME_PARTS && !ORGANISATION.test(name);
};

export function pickLookup(query: string[], books: Book[], authors: OLAuthorDoc[], opts: LookupOptions = {}): WishLookup {
  const authorHits = authors
    .filter((a) => (a.work_count ?? 0) >= MIN_AUTHOR_WORKS && personLike(a))
    .map((a) => ({ doc: a, matched: authorMatch(a, query) }))
    .filter((a) => a.matched.length > 0 && (!opts.cues || a.matched.length >= 2 || a.matched.some((m) => opts.cues!.includes(m))))
    .sort((a, b) => b.matched.length - a.matched.length || (b.doc.work_count ?? 0) - (a.doc.work_count ?? 0));
  let author: (typeof authorHits)[number] | undefined = authorHits[0];

  // Buch: alle Titelwörter kommen in der Anfrage vor. Ein-Wort-Titel nur bei kurzer Anfrage und
  // bekanntem Werk – sonst wird aus „Leuchtturm“ ein zufälliges Buch namens „Der Leuchtturm“.
  const titleHits =
    opts.books === false
      ? []
      : books.filter((b) => titleTokens(b).some((t) => covered(t, query) && (t.length >= 2 || (query.length <= 2 && (b.editionCount ?? 0) >= 5))));
  const byAuthor = (b: Book) => Boolean(author && b.authorKeys?.includes(author.doc.key));
  let book: Book | undefined = titleHits.find(byAuthor) ?? titleHits[0];
  const bookTitle = book ? (titleTokens(book).find((t) => covered(t, query)) ?? []) : [];

  if (book && author && !byAuthor(book)) {
    if (covered(bookTitle, author.matched)) book = undefined; // „Fyodor Dostoevsky“ ist die Autorin, nicht das Buch über sie
    else if (covered(author.matched, bookTitle)) author = undefined; // „Wolf Hall“: das Buch, nicht Christa Wolf
  }

  // Autorin des gefundenen Buchs übernehmen, wenn sie in der Anfrage steht
  const consumed = uniq([...(book ? query.filter((q) => bookTitle.some((t) => similarWord(t, q))) : []), ...(author?.matched ?? [])]);
  return {
    book,
    author: author ? { key: author.doc.key, name: author.doc.name, workCount: author.doc.work_count ?? 0 } : undefined,
    consumed,
    authorWords: author?.matched ?? [],
  };
}

/** Nur für kurze Anfragen ohne erkannte Stimmungen/Genres sinnvoll. */
export function worthLookingUp(text: string): boolean {
  const words = contentWords(text);
  return words.length > 0 && words.length <= MAX_WORDS;
}

/** `books: false`, wenn der Wunsch schon Genres/Stimmungen nennt – dann nur nach Autor:innen suchen. */
export async function lookupWish(text: string, opts: LookupOptions & { signal?: AbortSignal } = {}): Promise<WishLookup> {
  const { signal } = opts;
  const query = contentWords(text);
  if (!query.length || query.length > MAX_WORDS) return { consumed: [], authorWords: [] };
  const clean = (t: string) => t.replace(/[:()[\]{}^~"\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const findWorks = (q: string) =>
    searchWorks(clean(q), { limit: 8, lang: 'de', signal })
      .then((r) => r.docs.map((d) => docToBook(d)))
      .catch(() => [] as Book[]);
  const findAuthors = (q: string) => searchAuthors(clean(q), { limit: 6, signal }).catch(() => [] as OLAuthorDoc[]);

  let [books, authors] = await Promise.all([findWorks(text), findAuthors(text)]);
  let found = pickLookup(query, books, authors, opts);
  // „Titel + Autor“ findet die Autorensuche als Ganzes nicht – die übrigen Wörter einzeln versuchen
  const rest = () => query.filter((q) => !found.consumed.includes(q));
  if (!found.author && rest().length && rest().length < query.length) {
    authors = await findAuthors(rest().join(' '));
    found = pickLookup(query, books, authors, opts);
  }
  // Und umgekehrt: Autor erkannt, aber kein Titel – den Titel ohne die Autorenwörter suchen
  if (opts.books !== false && !found.book && found.author && rest().length) {
    books = await findWorks(rest().join(' '));
    found = pickLookup(query, books, authors, opts);
  }
  // Manche (v. a. deutsche Einzel-)Ausgaben haben keine Themen – dann die der bekanntesten Werke derselben Autor:in nehmen,
  // damit „Ähnliches“ trotzdem gefunden wird
  const authorKey = found.author?.key ?? found.book?.authorKeys?.[0];
  if (found.book && found.book.subjects.length < 3 && authorKey) {
    const top = await searchWorks(`author_key:${authorKey}`, { sort: 'readinglog', limit: 4, signal }).catch(() => undefined);
    const subjects = uniq((top?.docs ?? []).flatMap((d) => (d.subject ?? []).slice(0, 15)));
    if (subjects.length) found = { ...found, similarSubjects: uniq([...found.book.subjects, ...subjects]).slice(0, 40) };
  }
  return found;
}
