/**
 * Goodreads-Anbindung.
 *
 * Goodreads vergibt seit 2020 keine API-Schlüssel mehr. Es gibt zwei Wege:
 *  1. CSV-Export (Meine Bücher → Import/Export → „Export Library“) – funktioniert immer.
 *  2. Öffentlicher RSS-Feed eines Regals – braucht ein öffentliches Profil und
 *     den lokalen Server (Goodreads erlaubt keinen direkten Browser-Zugriff).
 */
import Papa from 'papaparse';
import { fetchText } from './http';
import { cleanIsbn, toIsbn13 } from './isbn';
import { searchWorks, type OLSearchDoc } from './openLibrary';
import { authorSurname, bookFingerprint, normalize, normalizeTitle, stripHtml, truncate } from './text';
import type { LibraryEntry, Shelf } from './types';

/* ------------------------------------------------------------------ */
/* CSV                                                                   */
/* ------------------------------------------------------------------ */

type CsvRow = Record<string, string>;

function shelfFrom(exclusive: string): { shelf: Shelf; extraTag?: string } {
  const s = exclusive.trim().toLowerCase();
  if (s === 'read') return { shelf: 'read' };
  if (s === 'to-read') return { shelf: 'to-read' };
  if (s === 'currently-reading') return { shelf: 'currently-reading' };
  // Eigene exklusive Regale (z. B. „did-not-finish“) zählen als gelesen + Tag
  return { shelf: 'read', extraTag: s };
}

function gDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const m = v.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined;
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface CsvParseResult {
  entries: LibraryEntry[];
  skipped: number;
  errors: string[];
}

export function parseGoodreadsCsv(csv: string): CsvParseResult {
  const parsed = Papa.parse<CsvRow>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  const errors = parsed.errors.slice(0, 5).map((e) => `Zeile ${e.row}: ${e.message}`);
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes('Title') || !fields.includes('Author')) {
    return { entries: [], skipped: 0, errors: ['Das sieht nicht nach einem Goodreads-Export aus (Spalten „Title“ und „Author“ fehlen).'] };
  }
  const entries: LibraryEntry[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const title = row['Title']?.trim();
    const author = row['Author']?.trim();
    if (!title) {
      skipped++;
      continue;
    }
    const additional = (row['Additional Authors'] ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const { shelf, extraTag } = shelfFrom(row['Exclusive Shelf'] ?? 'read');
    const tags = (row['Bookshelves'] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !['read', 'to-read', 'currently-reading'].includes(t));
    if (extraTag && !tags.includes(extraTag)) tags.push(extraTag);
    const goodreadsId = row['Book Id']?.trim();
    const isbn = cleanIsbn(row['ISBN']);
    const isbn13 = toIsbn13(row['ISBN13']) ?? toIsbn13(isbn);
    entries.push({
      id: goodreadsId ? `gr:${goodreadsId}` : `m:${normalize(title).slice(0, 40)}`,
      goodreadsId: goodreadsId || undefined,
      title,
      authors: [author, ...additional].filter(Boolean) as string[],
      isbn: isbn || undefined,
      isbn13,
      rating: Number(row['My Rating'] ?? 0) || 0,
      shelf,
      tags: tags.length ? tags : undefined,
      dateRead: gDate(row['Date Read']),
      dateAdded: gDate(row['Date Added']),
      pages: num(row['Number of Pages']),
      year: num(row['Original Publication Year']) ?? num(row['Year Published']),
      avgRating: num(row['Average Rating']),
      matchState: 'pending',
      source: 'goodreads-csv',
    });
  }
  return { entries, skipped, errors };
}

/* ------------------------------------------------------------------ */
/* RSS                                                                   */
/* ------------------------------------------------------------------ */

/** Extrahiert die numerische Nutzer-ID aus einer Profil-URL oder ID. */
export function parseGoodreadsUserId(input: string): string | undefined {
  const v = input.trim();
  if (/^\d{1,12}$/.test(v)) return v;
  const m = v.match(/goodreads\.com\/(?:user\/show|review\/list(?:_rss)?|user\/\w+)\/(\d{1,12})/i);
  return m?.[1];
}

function childText(item: Element, tag: string): string {
  const el = item.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? '';
}

export function parseGoodreadsRss(xml: string, shelf: Shelf): LibraryEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Der Goodreads-Feed konnte nicht gelesen werden.');
  const items = Array.from(doc.getElementsByTagName('item'));
  return items.map((item): LibraryEntry => {
    const bookId = childText(item, 'book_id');
    const title = childText(item, 'title');
    const author = childText(item, 'author_name');
    const isbnRaw = childText(item, 'isbn');
    const image = childText(item, 'book_large_image_url') || childText(item, 'book_medium_image_url');
    const pages = Number(item.getElementsByTagName('num_pages')[0]?.textContent ?? '');
    const tags = childText(item, 'user_shelves')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const description = stripHtml(childText(item, 'book_description'));
    return {
      id: bookId ? `gr:${bookId}` : `m:${normalize(title).slice(0, 40)}`,
      goodreadsId: bookId || undefined,
      title,
      authors: author ? [author] : [],
      isbn: cleanIsbn(isbnRaw) || undefined,
      isbn13: toIsbn13(isbnRaw),
      rating: Number(childText(item, 'user_rating')) || 0,
      shelf,
      tags: tags.length ? tags : undefined,
      dateRead: gDate(childText(item, 'user_read_at')),
      dateAdded: gDate(childText(item, 'user_date_added')),
      pages: Number.isFinite(pages) && pages > 0 ? pages : undefined,
      year: Number(childText(item, 'book_published')) || undefined,
      avgRating: Number(childText(item, 'average_rating')) || undefined,
      coverUrl: image && !/nophoto/.test(image) ? image : undefined,
      description: description ? truncate(description, 700) : undefined,
      matchState: 'pending',
      source: 'goodreads-rss',
    };
  });
}

export interface RssProgress {
  shelf: Shelf;
  page: number;
  count: number;
}

/** Lädt alle Seiten der Regale über den lokalen Server. */
export async function fetchGoodreadsShelves(
  userId: string,
  shelves: Shelf[] = ['read', 'currently-reading', 'to-read'],
  onProgress?: (p: RssProgress) => void,
): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (const shelf of shelves) {
    for (let page = 1; page <= 40; page++) {
      const url = `./api/goodreads/rss?user=${encodeURIComponent(userId)}&shelf=${encodeURIComponent(shelf)}&page=${page}&per_page=200`;
      const xml = await fetchText(url, { ttl: 0, timeout: 45_000, retries: 1 });
      const entries = parseGoodreadsRss(xml, shelf);
      all.push(...entries);
      onProgress?.({ shelf, page, count: all.length });
      if (entries.length < 200) break;
    }
  }
  return all;
}

export interface LocalApiStatus {
  goodreads: boolean;
  /** Claude-Schlüssel des Servers nutzbar. */
  ai: boolean;
  /** Gemini-Schlüssel des Servers nutzbar. */
  gemini: boolean;
  /** Geräte-Synchronisation verfügbar. */
  sync: boolean;
  /** Angemeldeter Name (null = ohne Login). */
  user: string | null;
  /** Cover und Verlagstexte aus Apple Books über den Server. */
  bookInfo?: boolean;
  /** Schlüssel der Ausweich-Kanäle auf dem Server (Mistral, Groq, OpenRouter). */
  llm?: Partial<Record<'mistral' | 'groq' | 'openrouter', boolean>>;
  /** Server merkt sich KI-Kurzbeschreibungen für alle Geräte. */
  blurbs?: boolean;
}

export async function localApiStatus(): Promise<LocalApiStatus> {
  const none: LocalApiStatus = { goodreads: false, ai: false, gemini: false, sync: false, user: null };
  try {
    const res = await fetch('./api/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return none;
    return { ...none, ...((await res.json()) as Partial<LocalApiStatus>) };
  } catch {
    return none;
  }
}

/* ------------------------------------------------------------------ */
/* Abgleich mit Open Library (Themen, Sprachen, Cover)                   */
/* ------------------------------------------------------------------ */

const ENRICH_FIELDS = 'key,title,author_name,subject,place,time,language,cover_i,first_publish_year,number_of_pages_median,id_goodreads,isbn';

function patchFromDoc(doc: OLSearchDoc, entry: LibraryEntry): Partial<LibraryEntry> {
  return {
    workKey: doc.key,
    subjects: (doc.subject ?? []).slice(0, 40),
    places: (doc.place ?? []).slice(0, 12),
    times: (doc.time ?? []).slice(0, 8),
    languages: (doc.language ?? []).slice(0, 12),
    coverId: entry.coverUrl ? entry.coverId : doc.cover_i,
    year: entry.year ?? doc.first_publish_year,
    pages: entry.pages ?? doc.number_of_pages_median,
    matchState: 'matched',
  };
}

function plausible(doc: OLSearchDoc, entry: LibraryEntry): boolean {
  const a = authorSurname(entry.authors[0] ?? '');
  if (!a) return true;
  return (doc.author_name ?? []).some((n) => authorSurname(n) === a || normalize(n).includes(a));
}

export interface EnrichProgress {
  done: number;
  total: number;
  matched: number;
}

/**
 * Ordnet Einträgen Open-Library-Werke zu: zuerst gebündelt über Goodreads-IDs,
 * dann über ISBNs, zuletzt einzeln über Titel + Autor.
 */
export async function enrichEntries(
  entries: LibraryEntry[],
  onPatch: (patches: Array<{ id: string; patch: Partial<LibraryEntry> }>) => void,
  onProgress?: (p: EnrichProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = new Map(entries.filter((e) => e.matchState !== 'matched').map((e) => [e.id, e]));
  const total = pending.size;
  let matched = 0;
  const report = () => onProgress?.({ done: total - pending.size, total, matched });
  const apply = (patches: Array<{ id: string; patch: Partial<LibraryEntry> }>) => {
    if (!patches.length) return;
    for (const p of patches) {
      pending.delete(p.id);
      if (p.patch.matchState === 'matched') matched++;
    }
    onPatch(patches);
    report();
  };
  report();

  // 1) Goodreads-IDs gebündelt
  const withGr = Array.from(pending.values()).filter((e) => e.goodreadsId);
  for (let i = 0; i < withGr.length; i += 40) {
    if (signal?.aborted) return;
    const batch = withGr.slice(i, i + 40);
    try {
      const res = await searchWorks(`id_goodreads:(${batch.map((e) => e.goodreadsId).join(' OR ')})`, { fields: ENRICH_FIELDS.replace(',isbn', ''), limit: 60, signal });
      const patches: Array<{ id: string; patch: Partial<LibraryEntry> }> = [];
      for (const e of batch) {
        const doc = res.docs.find((d) => d.id_goodreads?.includes(e.goodreadsId!));
        if (doc) patches.push({ id: e.id, patch: patchFromDoc(doc, e) });
      }
      apply(patches);
    } catch {
      /* weiter mit nächster Methode */
    }
  }

  // 2) ISBNs gebündelt
  const withIsbn = Array.from(pending.values()).filter((e) => e.isbn13 || e.isbn);
  for (let i = 0; i < withIsbn.length; i += 30) {
    if (signal?.aborted) return;
    const batch = withIsbn.slice(i, i + 30);
    const isbns = batch.flatMap((e) => [e.isbn13, e.isbn].filter(Boolean) as string[]);
    try {
      const res = await searchWorks(`isbn:(${isbns.join(' OR ')})`, { fields: ENRICH_FIELDS, limit: 60, signal });
      const patches: Array<{ id: string; patch: Partial<LibraryEntry> }> = [];
      for (const e of batch) {
        const doc = res.docs.find((d) => d.isbn?.some((x) => x === e.isbn13 || x === e.isbn));
        if (doc) patches.push({ id: e.id, patch: patchFromDoc(doc, e) });
      }
      apply(patches);
    } catch {
      /* weiter */
    }
  }

  // 3) Einzeln über Titel + Autor
  const rest = Array.from(pending.values());
  let cursor = 0;
  const worker = async () => {
    while (cursor < rest.length) {
      if (signal?.aborted) return;
      const e = rest[cursor++];
      const title = normalizeTitle(e.title);
      const surname = authorSurname(e.authors[0] ?? '');
      let patch: Partial<LibraryEntry> = { matchState: 'unmatched' };
      if (title) {
        try {
          const res = await searchWorks(`title:(${title})${surname ? ` author:(${surname})` : ''}`, {
            fields: ENRICH_FIELDS.replace(',isbn', ''),
            limit: 5,
            signal,
          });
          const target = bookFingerprint(e.title, e.authors);
          const doc =
            res.docs.find((d) => bookFingerprint(d.title, d.author_name ?? []) === target) ??
            res.docs.find((d) => plausible(d, e));
          if (doc) patch = patchFromDoc(doc, e);
        } catch {
          /* bleibt unmatched */
        }
      }
      apply([{ id: e.id, patch }]);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
