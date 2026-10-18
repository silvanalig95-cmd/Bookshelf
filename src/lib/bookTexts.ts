/**
 * Woher die Beschreibung eines Buchs kommt. Gute deutsche Texte anderer Quellen (Wikipedia,
 * deutscher Klappentext) haben Vorrang – eine KI-Kurzbeschreibung braucht es nur, wenn es keine
 * gibt oder sie zu dünn sind. So reicht das KI-Kontingent für die Bücher, bei denen es zählt.
 */
import { googleBookByIsbn } from './googleBooks';
import { settle } from './http';
import { getWork } from './openLibrary';
import type { Book } from './types';
import { contentSummary, germanWikipediaSummary, guessLanguage, type WikiSummary } from './wikipedia';

export interface BookTexts {
  wiki?: WikiSummary;
  /** Klappentext von Open Library (oft englisch). */
  description?: string;
  /** Deutscher Klappentext von Google Books (nur mit eigenem Schlüssel). */
  gbGerman?: string;
}

/** Ab dieser Länge gilt ein deutscher Text als gehaltvoll – etwa drei, vier inhaltliche Sätze. */
export const RICH_GERMAN = 280;

export interface RichText {
  label: string;
  text: string;
  source: string;
}

/** Ein gehaltvoller deutscher Text zum Inhalt – oder nichts, dann ist die KI gefragt. */
export function richGermanText(t: BookTexts, max = 800): RichText | undefined {
  const content = t.wiki ? contentSummary(t.wiki, max) : undefined;
  if (content && content.text.length >= RICH_GERMAN) return { label: 'Worum es geht', text: content.text, source: 'Wikipedia' };
  const german = t.gbGerman ?? (t.description && guessLanguage(t.description) === 'ger' ? t.description : undefined);
  if (german && german.length >= RICH_GERMAN) return { label: 'Klappentext', text: german, source: t.gbGerman ? 'Google Books' : 'Open Library' };
  return undefined;
}

/** Material für die KI: Handlung bzw. Einleitung aus Wikipedia (gekürzt). */
export function wikiMaterial(wiki?: WikiSummary): string | undefined {
  if (!wiki) return undefined;
  return (wiki.plot ? `${wiki.extract}\n\n${wiki.plot.text}` : wiki.extract).slice(0, 2500);
}

/** Holt alles, was es zum Buch an Text gibt (die Abfragen werden zwischengespeichert). */
export async function loadBookTexts(book: Book, opts: { googleApiKey?: string; country?: string; signal?: AbortSignal } = {}): Promise<BookTexts> {
  const work = /^OL\d+W$/.test(book.id) ? await settle(getWork(book.id, opts.signal)) : undefined;
  const isbn = book.isbns?.[0];
  const [wiki, gb] = await Promise.all([
    germanWikipediaSummary({ wikidataId: work?.wikidataId, titles: [book.title], author: book.authors[0] }, opts.signal).catch(() => undefined),
    isbn && opts.googleApiKey ? settle(googleBookByIsbn(isbn, { apiKey: opts.googleApiKey, country: opts.country, signal: opts.signal })) : undefined,
  ]);
  return {
    wiki,
    description: work?.description ?? book.description,
    gbGerman: gb?.language === 'ger' ? gb.book.description : undefined,
  };
}
