/**
 * Zugriff auf die freie Open-Library-API (keine Anmeldung, CORS erlaubt).
 * Doku: https://openlibrary.org/developers/api
 */
import { fetchJson } from './http';
import { toIsbn13 } from './isbn';
import { iso1to2 } from './taxonomy';
import { stripHtml, uniq } from './text';
import type { Book, Edition, FormatKind, LangCode } from './types';

export const OL_BASE = 'https://openlibrary.org';

/** Gültige Sortierungen der Open-Library-Suche (ungültige liefern HTTP 500). */
export type OLSort =
  | 'relevance'
  | 'rating'
  | 'readinglog'
  | 'want_to_read'
  | 'trending'
  | 'new'
  | 'old'
  | 'editions'
  | 'random'
  | 'random.hourly';

const EDITION_FIELDS = ['key', 'title', 'subtitle', 'language', 'isbn', 'cover_i', 'publisher', 'publish_date', 'publish_year'];
/** Ab diesem Jahr gilt das Cover einer deutschen Ausgabe als zeitgemäss (ältere sind oft Scans der Titelseite). */
const FRESH_COVER_YEAR = 1990;

export const SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'author_key',
  'first_publish_year',
  'language',
  'subject',
  'place',
  'time',
  'person',
  'cover_i',
  'edition_count',
  'number_of_pages_median',
  'ratings_average',
  'ratings_count',
  'readinglog_count',
  'want_to_read_count',
  'first_sentence',
  'id_goodreads',
  'editions',
  ...EDITION_FIELDS.map((f) => `editions.${f}`),
].join(',');

export interface OLEditionDoc {
  key: string;
  title?: string;
  subtitle?: string;
  language?: string[];
  isbn?: string[];
  cover_i?: number;
  publish_year?: number[];
  publisher?: string[];
  publish_date?: string[];
}

export interface OLSearchDoc {
  key: string;
  title: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  language?: string[];
  subject?: string[];
  place?: string[];
  time?: string[];
  person?: string[];
  cover_i?: number;
  edition_count?: number;
  number_of_pages_median?: number;
  ratings_average?: number;
  ratings_count?: number;
  readinglog_count?: number;
  want_to_read_count?: number;
  first_sentence?: string[];
  id_goodreads?: string[];
  isbn?: string[];
  editions?: { numFound: number; docs: OLEditionDoc[] };
}

export interface OLSearchResponse {
  numFound: number;
  start: number;
  docs: OLSearchDoc[];
}

export interface SearchOptions {
  sort?: OLSort;
  limit?: number;
  offset?: number;
  /** ISO-639-1-Sprache für die bevorzugte Ausgabe, z. B. "de". */
  lang?: string;
  fields?: string;
  signal?: AbortSignal;
}

export function workIdFromKey(key: string): string {
  return key.replace(/^\/works\//, '');
}

export function coverUrl(coverId: number | undefined, size: 'S' | 'M' | 'L' = 'M'): string | undefined {
  if (!coverId || coverId < 0) return undefined;
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

export function isbnCoverUrl(isbn: string, size: 'S' | 'M' | 'L' = 'M'): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg?default=false`;
}

export async function searchWorks(q: string, opts: SearchOptions = {}): Promise<OLSearchResponse> {
  const params = new URLSearchParams({
    q,
    fields: opts.fields ?? SEARCH_FIELDS,
    limit: String(opts.limit ?? 30),
  });
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.sort && opts.sort !== 'relevance') params.set('sort', opts.sort);
  if (opts.lang) params.set('lang', opts.lang);
  const url = `${OL_BASE}/search.json?${params.toString()}`;
  // Zufalls-Sortierungen nicht zwischenspeichern
  const ttl = opts.sort?.startsWith('random') ? 0 : 30 * 60_000;
  return fetchJson<OLSearchResponse>(url, { ttl, signal: opts.signal });
}

export interface OLAuthorDoc {
  key: string;
  name: string;
  alternate_names?: string[];
  work_count?: number;
  top_work?: string;
}

/** Autor:innen-Suche (findet auch Schreibvarianten wie Dostojewski/Dostoevsky). */
export async function searchAuthors(q: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<OLAuthorDoc[]> {
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 5), fields: 'key,name,alternate_names,work_count,top_work' });
  const d = await fetchJson<{ docs?: OLAuthorDoc[] }>(`${OL_BASE}/search/authors.json?${params.toString()}`, { ttl: 60 * 60_000, signal: opts.signal });
  return d.docs ?? [];
}

/** Wandelt ein Suchergebnis in ein Buch um – bevorzugt die passende (deutsche) Ausgabe. */
export function docToBook(doc: OLSearchDoc, preferLang: LangCode = 'ger'): Book {
  const edition = doc.editions?.docs?.[0];
  const editionLangs = edition?.language ?? [];
  const useEditionTitle = Boolean(edition?.title) && (editionLangs.includes(preferLang) || editionLangs.length === 0);
  const title = useEditionTitle && edition?.title ? edition.title : doc.title;
  // Alte deutsche Ausgaben (z. B. 1921) haben meist nur einen Scan der Titelseite – dann lieber das Hauptcover des Werks
  const editionYear = Math.max(0, ...(edition?.publish_year ?? []));
  const freshEditionCover = editionYear >= FRESH_COVER_YEAR || !doc.cover_i;
  const isbns = uniq((edition?.isbn ?? []).map((i) => toIsbn13(i)).filter((i): i is string => Boolean(i)));
  return {
    id: workIdFromKey(doc.key),
    workKey: doc.key,
    title,
    originalTitle: title !== doc.title ? doc.title : undefined,
    subtitle: useEditionTitle ? edition?.subtitle : doc.subtitle,
    authors: doc.author_name ?? [],
    authorKeys: doc.author_key,
    year: doc.first_publish_year,
    coverId: (useEditionTitle && freshEditionCover ? edition?.cover_i : undefined) || doc.cover_i || edition?.cover_i,
    subjects: doc.subject ?? [],
    places: doc.place,
    times: doc.time,
    people: doc.person,
    languages: doc.language ?? [],
    pages: doc.number_of_pages_median,
    rating: doc.ratings_average,
    ratingsCount: doc.ratings_count,
    popularity: doc.readinglog_count,
    editionCount: doc.edition_count,
    firstSentence: pickFirstSentence(doc.first_sentence),
    isbns,
    preferredEditionKey: edition?.key,
    preferredEditionLang: editionLangs[0],
    source: 'openlibrary',
  };
}

/** Bevorzugt einen deutschen ersten Satz, falls Open Library mehrere kennt. */
export function pickFirstSentence(list: string[] | undefined): string | undefined {
  if (!list?.length) return undefined;
  const de = /\b(der|die|das|und|ich|nicht|ein|eine|war|ist|mit|sich|auf|zu)\b/gi;
  const en = /\b(the|and|was|is|of|with|his|her|that|to|a)\b/gi;
  const german = list.find((s) => (s.match(de)?.length ?? 0) >= 2 && (s.match(de)?.length ?? 0) > (s.match(en)?.length ?? 0));
  return german ?? list[0];
}

export async function searchBooks(q: string, opts: SearchOptions = {}): Promise<{ total: number; books: Book[] }> {
  const res = await searchWorks(q, { lang: 'de', ...opts });
  const preferLang = iso1to2(opts.lang ?? 'de') ?? 'ger';
  return { total: res.numFound, books: res.docs.map((d) => docToBook(d, preferLang)) };
}

/* ------------------------------------------------------------------ */
/* Werke & Ausgaben                                                     */
/* ------------------------------------------------------------------ */

interface OLWork {
  key: string;
  title: string;
  subtitle?: string;
  description?: string | { value: string };
  subjects?: string[];
  subject_places?: string[];
  subject_times?: string[];
  subject_people?: string[];
  covers?: number[];
  authors?: Array<{ author?: { key: string } }>;
  first_publish_date?: string;
  excerpts?: Array<{ excerpt?: string | { value: string } }>;
  links?: Array<{ title: string; url: string }>;
  identifiers?: { wikidata?: string[] };
}

export interface WorkDetails {
  key: string;
  title: string;
  description?: string;
  subjects: string[];
  places: string[];
  times: string[];
  people: string[];
  covers: number[];
  authorKeys: string[];
  excerpt?: string;
  links: Array<{ title: string; url: string }>;
  wikidataId?: string;
}

function textValue(v: string | { value: string } | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === 'string' ? v : v.value;
}

/** Entfernt Quellenhinweise und Markdown-Links aus OL-Beschreibungen. */
export function cleanDescription(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = stripHtml(raw)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\r/g, '')
    .split(/\n-{3,}\n|\n\*{3,}\n/)[0]
    .replace(/\(\[source\]\[\d+\]\)/gi, '')
    .replace(/^\s*\[\d+\]:.*$/gm, '')
    .trim();
  return text || undefined;
}

export async function getWork(workId: string, signal?: AbortSignal): Promise<WorkDetails> {
  const w = await fetchJson<OLWork>(`${OL_BASE}/works/${workId}.json`, { signal, ttl: 60 * 60_000 });
  return {
    key: w.key,
    title: w.title,
    description: cleanDescription(textValue(w.description)),
    subjects: w.subjects ?? [],
    places: w.subject_places ?? [],
    times: w.subject_times ?? [],
    people: w.subject_people ?? [],
    covers: (w.covers ?? []).filter((c) => c > 0),
    authorKeys: (w.authors ?? []).map((a) => a.author?.key).filter((k): k is string => Boolean(k)),
    excerpt: textValue(w.excerpts?.[0]?.excerpt),
    links: w.links ?? [],
    wikidataId: w.identifiers?.wikidata?.[0],
  };
}

export async function getAuthorName(authorKey: string): Promise<string | undefined> {
  const id = authorKey.replace(/^\/authors\//, '');
  const a = await fetchJson<{ name?: string; personal_name?: string }>(`${OL_BASE}/authors/${id}.json`, { ttl: 24 * 60 * 60_000 });
  return a.name ?? a.personal_name;
}

export interface Ratings {
  average?: number;
  count: number;
  counts: Record<string, number>;
}

export async function getRatings(workId: string): Promise<Ratings> {
  const r = await fetchJson<{ summary?: { average?: number; count?: number }; counts?: Record<string, number> }>(
    `${OL_BASE}/works/${workId}/ratings.json`,
    { ttl: 60 * 60_000 },
  );
  return { average: r.summary?.average, count: r.summary?.count ?? 0, counts: r.counts ?? {} };
}

interface OLEditionEntry {
  key: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  languages?: Array<{ key: string }>;
  isbn_13?: string[];
  isbn_10?: string[];
  number_of_pages?: number;
  physical_format?: string;
  covers?: number[];
  edition_name?: string;
  translation_of?: string;
}

export function formatKind(format: string | undefined): FormatKind {
  const f = (format ?? '').toLowerCase();
  if (!f) return 'other';
  if (/e-?book|kindle|epub|electronic|digital|online|pdf/.test(f)) return 'ebook';
  if (/audio|hörbuch|horbuch|cd|mp3|cassette/.test(f)) return 'audio';
  if (/hard|gebunden|hc|leinen|cloth|board/.test(f)) return 'hardcover';
  if (/paper|taschenbuch|tb|broschiert|soft|mass market|kartoniert|trade/.test(f)) return 'paperback';
  return 'other';
}

export function parseYear(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const m = date.match(/(1[5-9]\d{2}|20\d{2})/);
  return m ? Number(m[1]) : undefined;
}

export function editionFromEntry(e: OLEditionEntry): Edition {
  const isbn13 = e.isbn_13?.map((i) => toIsbn13(i)).find(Boolean) ?? e.isbn_10?.map((i) => toIsbn13(i)).find(Boolean);
  return {
    key: e.key,
    title: e.title ?? '',
    subtitle: e.subtitle,
    publishers: e.publishers ?? [],
    publishDate: e.publish_date,
    year: parseYear(e.publish_date),
    languages: (e.languages ?? []).map((l) => l.key.replace('/languages/', '')),
    isbn13,
    isbn10: e.isbn_10?.[0],
    pages: e.number_of_pages,
    format: e.physical_format,
    formatKind: formatKind(e.physical_format),
    coverId: e.covers?.find((c) => c > 0),
    editionName: e.edition_name,
    translationOf: e.translation_of,
  };
}

/** Lädt alle Ausgaben eines Werks (bis `max`). */
export async function getEditions(workId: string, max = 400, signal?: AbortSignal): Promise<{ total: number; editions: Edition[] }> {
  const pageSize = 100;
  const first = await fetchJson<{ size: number; entries: OLEditionEntry[] }>(
    `${OL_BASE}/works/${workId}/editions.json?limit=${pageSize}`,
    { signal, ttl: 60 * 60_000 },
  );
  const entries = [...first.entries];
  const total = first.size ?? entries.length;
  const pages: Promise<{ entries: OLEditionEntry[] }>[] = [];
  for (let offset = pageSize; offset < Math.min(total, max); offset += pageSize) {
    pages.push(
      fetchJson<{ entries: OLEditionEntry[] }>(`${OL_BASE}/works/${workId}/editions.json?limit=${pageSize}&offset=${offset}`, {
        signal,
        ttl: 60 * 60_000,
      }),
    );
  }
  for (const p of await Promise.allSettled(pages)) if (p.status === 'fulfilled') entries.push(...p.value.entries);
  return { total, editions: entries.map(editionFromEntry) };
}

/** Findet das Werk zu einer ISBN (über die Ausgaben-Seite). */
export async function workForIsbn(isbn: string): Promise<string | undefined> {
  try {
    const res = await searchWorks(`isbn:${isbn}`, { fields: 'key', limit: 1 });
    return res.docs[0] ? workIdFromKey(res.docs[0].key) : undefined;
  } catch {
    return undefined;
  }
}

/** Lädt ein Werk als Buch (Suchindex-Daten inkl. bevorzugter Ausgabe). */
export async function getBookByWorkId(workId: string, signal?: AbortSignal): Promise<Book | undefined> {
  const res = await searchWorks(`key:/works/${workId}`, { lang: 'de', limit: 1, signal });
  const doc = res.docs[0];
  return doc ? docToBook(doc) : undefined;
}

/* ------------------------------------------------------------------ */
/* Themen (Subjects)                                                    */
/* ------------------------------------------------------------------ */

export interface SubjectFacet {
  key: string;
  name: string;
  count: number;
}

export interface SubjectDetails {
  key: string;
  name: string;
  workCount: number;
  works: Book[];
  subjects: SubjectFacet[];
  places: SubjectFacet[];
  people: SubjectFacet[];
  times: SubjectFacet[];
  authors: SubjectFacet[];
}

interface OLSubjectWork {
  key: string;
  title: string;
  edition_count?: number;
  cover_id?: number;
  subject?: string[];
  authors?: Array<{ key: string; name: string }>;
  first_publish_year?: number;
}

/** "Science fiction" → "science_fiction"; Orte/Zeiten mit Präfix "place:"/"time:". */
export function subjectKey(name: string, kind: 'subject' | 'place' | 'time' | 'person' = 'subject'): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_');
  return kind === 'subject' ? slug : `${kind}:${slug}`;
}

/** Zählt Schlagwörter/Orte/Zeiten/Figuren über eine Trefferliste (Ersatz für fehlende Facetten). */
function facetsFromDocs(docs: OLSearchDoc[], field: 'subject' | 'place' | 'time' | 'person', prefix: string, max = 20): SubjectFacet[] {
  const counts = new Map<string, number>();
  for (const d of docs) for (const v of new Set(d[field] ?? [])) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name, count]) => ({ name, count, key: `/subjects/${prefix}${name.toLowerCase().replace(/\s+/g, '_')}` }));
}

export async function getSubject(key: string, limit = 24, signal?: AbortSignal): Promise<SubjectDetails> {
  const clean = key.replace(/^\/subjects\//, '');
  const d = await fetchJson<{
    key: string;
    name: string;
    work_count?: number | null;
    works?: OLSubjectWork[];
    subjects?: SubjectFacet[];
    places?: SubjectFacet[];
    people?: SubjectFacet[];
    times?: SubjectFacet[];
    authors?: SubjectFacet[];
  }>(`${OL_BASE}/subjects/${encodeURIComponent(clean)}.json?details=true&limit=${limit}`, { signal, ttl: 6 * 60 * 60_000, timeout: 30_000 });
  const details: SubjectDetails = {
    key: d.key,
    name: d.name,
    workCount: d.work_count ?? 0,
    works: (d.works ?? []).map((w) => ({
      id: workIdFromKey(w.key),
      workKey: w.key,
      title: w.title,
      authors: (w.authors ?? []).map((a) => a.name),
      year: w.first_publish_year,
      coverId: w.cover_id,
      subjects: w.subject ?? [],
      languages: [],
      editionCount: w.edition_count,
      source: 'openlibrary',
    })),
    subjects: d.subjects ?? [],
    places: d.places ?? [],
    people: d.people ?? [],
    times: d.times ?? [],
    authors: d.authors ?? [],
  };
  // Open Library lässt die Facetten unter Last manchmal weg – dann selbst berechnen.
  if (!details.subjects.length || !details.workCount) {
    const kind = clean.match(/^(place|time|person):/)?.[1];
    const value = clean.replace(/^(place|time|person):/, '');
    const field = kind ? `${kind}_key` : 'subject_key';
    const res = await searchWorks(`${field}:"${value.replace(/"/g, '')}"`, {
      fields: 'key,subject,place,time,person,author_name,author_key',
      limit: 100,
      sort: 'readinglog',
      signal,
    });
    details.workCount ||= res.numFound;
    if (!details.subjects.length) {
      details.subjects = facetsFromDocs(res.docs, 'subject', '');
      details.places = facetsFromDocs(res.docs, 'place', 'place:');
      details.times = facetsFromDocs(res.docs, 'time', 'time:');
      details.people = facetsFromDocs(res.docs, 'person', 'person:');
      const authors = new Map<string, SubjectFacet>();
      for (const doc of res.docs) {
        const name = doc.author_name?.[0];
        const k = doc.author_key?.[0];
        if (!name || !k) continue;
        const a = authors.get(k) ?? { key: `/authors/${k}`, name, count: 0 };
        a.count++;
        authors.set(k, a);
      }
      details.authors = Array.from(authors.values()).sort((a, b) => b.count - a.count).slice(0, 12);
    }
  }
  return details;
}

export async function getTrending(period: 'daily' | 'weekly' | 'monthly' = 'weekly', limit = 40): Promise<Book[]> {
  const d = await fetchJson<{ works: OLSearchDoc[] }>(`${OL_BASE}/trending/${period}.json?limit=${limit}`, { ttl: 60 * 60_000 });
  return d.works.map((w) => docToBook(w));
}
