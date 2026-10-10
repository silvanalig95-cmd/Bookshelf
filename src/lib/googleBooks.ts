/**
 * Google Books als Ergänzung: deutsche Klappentexte, E-Book-Preise (Google Play)
 * und Titel, die Open Library nicht kennt.
 *
 * Ohne eigenen API-Schlüssel teilt man sich ein Gratis-Kontingent mit allen
 * anderen, das meist erschöpft ist (HTTP 429). Google Books wird deshalb nur mit
 * eigenem (kostenlosem) Schlüssel abgefragt; bei Fehlern schaltet sich die Quelle
 * für 15 Minuten stumm und Lesekompass arbeitet mit Open Library weiter.
 */
import { fetchJson, HttpError } from './http';
import { toIsbn13 } from './isbn';
import { formatKind, parseYear } from './openLibrary';
import { iso1to2 } from './taxonomy';
import { stripHtml } from './text';
import type { Book, Edition } from './types';

const GB_BASE = 'https://www.googleapis.com/books/v1/volumes';

interface GBVolume {
  id: string;
  volumeInfo: {
    title: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: Array<{ type: string; identifier: string }>;
    pageCount?: number;
    categories?: string[];
    averageRating?: number;
    ratingsCount?: number;
    imageLinks?: { smallThumbnail?: string; thumbnail?: string };
    language?: string;
    infoLink?: string;
    previewLink?: string;
    canonicalVolumeLink?: string;
  };
  saleInfo?: {
    country?: string;
    saleability?: string;
    isEbook?: boolean;
    listPrice?: { amount: number; currencyCode: string };
    retailPrice?: { amount: number; currencyCode: string };
    buyLink?: string;
  };
}

export interface GBPrice {
  amount: number;
  currency: string;
  listAmount?: number;
  buyLink?: string;
  isEbook: boolean;
}

export interface GBResult {
  book: Book;
  isbn13?: string;
  publisher?: string;
  publishedDate?: string;
  price?: GBPrice;
  previewLink?: string;
  language?: string;
}

let blockedUntil = 0;
let lastError: string | undefined;

export function googleBooksStatus(): { available: boolean; reason?: string } {
  return blockedUntil > Date.now() ? { available: false, reason: lastError } : { available: true };
}

interface GBOptions {
  apiKey?: string;
  country?: string;
  langRestrict?: string;
  maxResults?: number;
  orderBy?: 'relevance' | 'newest';
  startIndex?: number;
  signal?: AbortSignal;
}

function httpsImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/^http:/, 'https:').replace('&edge=curl', '');
}

export function volumeToResult(v: GBVolume): GBResult {
  const info = v.volumeInfo;
  const ids = info.industryIdentifiers ?? [];
  const isbn13 =
    toIsbn13(ids.find((i) => i.type === 'ISBN_13')?.identifier) ?? toIsbn13(ids.find((i) => i.type === 'ISBN_10')?.identifier);
  const sale = v.saleInfo;
  const priceSource = sale?.retailPrice ?? sale?.listPrice;
  const lang = iso1to2(info.language);
  return {
    book: {
      id: `gb:${v.id}`,
      googleId: v.id,
      title: info.title,
      subtitle: info.subtitle,
      authors: info.authors ?? [],
      year: parseYear(info.publishedDate),
      coverUrl: httpsImage(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
      subjects: info.categories ?? [],
      languages: lang ? [lang] : [],
      pages: info.pageCount,
      rating: info.averageRating,
      ratingsCount: info.ratingsCount,
      description: info.description ? stripHtml(info.description) : undefined,
      isbns: isbn13 ? [isbn13] : [],
      preferredEditionLang: lang,
      source: 'google',
    },
    isbn13,
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    previewLink: info.previewLink ?? info.infoLink,
    language: lang,
    price:
      priceSource && sale?.saleability === 'FOR_SALE'
        ? {
            amount: priceSource.amount,
            currency: priceSource.currencyCode,
            listAmount: sale?.listPrice?.amount,
            buyLink: sale?.buyLink,
            isEbook: Boolean(sale?.isEbook),
          }
        : undefined,
  };
}

export function volumeToEdition(r: GBResult): Edition {
  return {
    key: r.book.id,
    title: r.book.title,
    subtitle: r.book.subtitle,
    publishers: r.publisher ? [r.publisher] : [],
    publishDate: r.publishedDate,
    year: r.book.year,
    languages: r.book.languages,
    isbn13: r.isbn13,
    pages: r.book.pages,
    format: r.price?.isEbook ? 'E-Book' : undefined,
    formatKind: r.price?.isEbook ? 'ebook' : formatKind(undefined),
    coverUrl: r.book.coverUrl,
  };
}

export async function searchGoogleBooks(q: string, opts: GBOptions = {}): Promise<GBResult[]> {
  // Ohne eigenen Schlüssel ist das geteilte Gratis-Kontingent praktisch immer
  // erschöpft (HTTP 429) – dann gar nicht erst fragen.
  if (!opts.apiKey || blockedUntil > Date.now()) return [];
  const params = new URLSearchParams({
    q,
    maxResults: String(opts.maxResults ?? 20),
    printType: 'books',
  });
  if (opts.langRestrict) params.set('langRestrict', opts.langRestrict);
  if (opts.orderBy) params.set('orderBy', opts.orderBy);
  if (opts.startIndex) params.set('startIndex', String(opts.startIndex));
  if (opts.country) params.set('country', opts.country);
  if (opts.apiKey) params.set('key', opts.apiKey);
  try {
    const res = await fetchJson<{ items?: GBVolume[] }>(`${GB_BASE}?${params.toString()}`, {
      signal: opts.signal,
      retries: 0,
      ttl: 60 * 60_000,
    });
    return (res.items ?? []).map(volumeToResult);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 429 || err.status === 403)) {
      blockedUntil = Date.now() + 15 * 60_000;
      lastError =
        err.status === 429
          ? 'Google Books hat das Gratis-Kontingent erreicht. Mit eigenem API-Schlüssel (Einstellungen) klappt es zuverlässig.'
          : 'Google Books hat den Zugriff verweigert – ist der API-Schlüssel gültig?';
      return [];
    }
    throw err;
  }
}

export async function googleBookByIsbn(isbn: string, opts: GBOptions = {}): Promise<GBResult | undefined> {
  const results = await searchGoogleBooks(`isbn:${isbn}`, { ...opts, maxResults: 1 });
  return results[0];
}

export async function googleVolume(id: string, opts: GBOptions = {}): Promise<GBResult | undefined> {
  if (!opts.apiKey || blockedUntil > Date.now()) return undefined;
  const params = new URLSearchParams();
  if (opts.apiKey) params.set('key', opts.apiKey);
  if (opts.country) params.set('country', opts.country);
  try {
    const v = await fetchJson<GBVolume>(`${GB_BASE}/${encodeURIComponent(id)}?${params.toString()}`, { signal: opts.signal, retries: 0, ttl: 60 * 60_000 });
    return volumeToResult(v);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 429 || err.status === 403)) {
      blockedUntil = Date.now() + 15 * 60_000;
      return undefined;
    }
    throw err;
  }
}
