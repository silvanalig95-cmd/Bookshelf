import { describe, expect, it } from 'vitest';
import { homeStaleness } from '../src/lib/freshness';
import { rankForHome } from '../src/lib/homeFeed';
import type { ReadIndex } from '../src/store/library';
import { book } from './helpers';

const DAY = 86400000;
const NOW = Date.parse('2026-10-12T10:00:00Z');
const readIndex = { has: () => false, entryFor: () => undefined } as unknown as ReadIndex;
const novel = (id: string, author = `Autor ${id}`, extra: Partial<Parameters<typeof book>[0]> = {}) =>
  book({ id, title: id, authors: [author], subjects: ['Fiction', 'Families'], languages: ['ger'], coverId: 1, popularity: 400, ratingsCount: 60, editionCount: 15, rating: 4.1, ...extra });

describe('Startseite', () => {
  it('lässt kürzlich Gesehenes Platz machen und oft Ignoriertes selten zurückkommen', () => {
    expect(homeStaleness(1, NOW - DAY, NOW)).toBeGreaterThan(0.8);
    expect(homeStaleness(1, NOW - 10 * DAY, NOW)).toBeLessThan(0.4);
    expect(homeStaleness(1, NOW - 20 * DAY, NOW)).toBeLessThan(0.15);
    expect(homeStaleness(10, NOW - 20 * DAY, NOW)).toBeGreaterThan(0.9);
  });

  it('zeigt kürzlich gesehene Bücher erst einmal nicht mehr', () => {
    const books = Array.from({ length: 30 }, (_, i) => novel(`B${i}`, `Autor ${i}`, { rating: 4.4 - i * 0.01 }));
    const fresh = rankForHome(books, { readIndex, language: 'de-first', staleness: () => 0, max: 10, day: '2026-10-12' });
    const seenYesterday = new Set(fresh.map((s) => s.book.id));
    const next = rankForHome(books, {
      readIndex,
      language: 'de-first',
      staleness: (id) => (seenYesterday.has(id) ? homeStaleness(1, NOW - DAY, NOW) : 0),
      max: 10,
      day: '2026-10-13',
    });
    const repeated = next.filter((s) => seenYesterday.has(s.book.id)).length;
    expect(repeated).toBeLessThanOrEqual(2);
  });

  it('lässt Kinderbücher weg, nimmt jede Autor:in nur einmal und beachtet die Mindestbewertung', () => {
    const books = [
      novel('A1', 'Gleich'),
      novel('A2', 'Gleich'),
      novel('K', 'Kind', { subjects: ['Juvenile fiction', 'Picture books', "Children's stories"] }),
      novel('L', 'Lau', { rating: 3.1, ratingsCount: 80 }),
    ];
    const ids = rankForHome(books, { readIndex, language: 'de-first', staleness: () => 0, minRating: 3.8 }).map((s) => s.book.id);
    expect(ids).toHaveLength(1);
    expect(['A1', 'A2']).toContain(ids[0]);
  });

  it('stellt Gutbewertetes aus dem mittleren Band vor die Welt-Bestseller', () => {
    const solid = novel('S', 'S', { rating: 4.2 });
    const mega = novel('M', 'M', { rating: 4.2, popularity: 60000, ratingsCount: 4000, editionCount: 400 });
    const order = rankForHome([mega, solid], { readIndex, language: 'de-first', staleness: () => 0, day: 'x' }).map((s) => s.book.id);
    expect(order[0]).toBe('S');
  });
});
