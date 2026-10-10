// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGoodreadsCsv, parseGoodreadsRss, parseGoodreadsUserId } from '../src/lib/goodreads';

const csv = readFileSync('tests/fixtures/goodreads_library_export.csv', 'utf8');
const rss = readFileSync('tests/fixtures/goodreads_rss.xml', 'utf8');

describe('Goodreads-CSV', () => {
  const { entries, errors } = parseGoodreadsCsv(csv);

  it('liest alle Zeilen', () => {
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(3);
  });

  it('übernimmt Bewertung, Datum, ISBN und Regale', () => {
    const zafon = entries[0];
    expect(zafon.id).toBe('gr:4218');
    expect(zafon.isbn13).toBe('9783518458006');
    expect(zafon.isbn).toBe('3518458000');
    expect(zafon.rating).toBe(5);
    expect(zafon.dateRead).toBe('2023-05-14');
    expect(zafon.year).toBe(2001);
    expect(zafon.pages).toBe(562);
    expect(zafon.authors).toEqual(['Carlos Ruiz Zafón', 'Peter Schwaar']);
    expect(zafon.tags).toEqual(['lieblinge', 'barcelona']);
    expect(zafon.shelf).toBe('read');
  });

  it('erkennt Will-ich-lesen und eigene exklusive Regale', () => {
    expect(entries[1].shelf).toBe('to-read');
    expect(entries[1].tags).toBeUndefined();
    expect(entries[2].shelf).toBe('read');
    expect(entries[2].tags).toContain('did-not-finish');
    expect(entries[2].isbn13).toBeUndefined();
  });

  it('meldet fremde Dateien', () => {
    expect(parseGoodreadsCsv('a,b\n1,2').errors[0]).toMatch(/Goodreads-Export/);
  });
});

describe('Goodreads-RSS', () => {
  const entries = parseGoodreadsRss(rss, 'read');

  it('liest Einträge mit allen Feldern', () => {
    expect(entries).toHaveLength(2);
    const e = entries[0];
    expect(e.id).toBe('gr:10081041');
    expect(e.title).toBe('The Long Ships');
    expect(e.authors).toEqual(['Frans G. Bengtsson']);
    expect(e.isbn13).toBe('9781590174166');
    expect(e.rating).toBe(5);
    expect(e.pages).toBe(528);
    expect(e.year).toBe(1941);
    expect(e.dateRead).toBe('2026-08-18');
    expect(e.tags).toEqual(['adventure', 'norway', 'historical-fiction']);
    expect(e.coverUrl).toContain('10081041.jpg');
    expect(e.description).toContain('The Long Ships');
    expect(e.description).not.toContain('<i>');
  });

  it('ignoriert Platzhalter-Cover und leere Felder', () => {
    const e = entries[1];
    expect(e.coverUrl).toBeUndefined();
    expect(e.pages).toBeUndefined();
    expect(e.rating).toBe(0);
    expect(e.isbn13).toBeUndefined();
  });
});

describe('Goodreads-Profil', () => {
  it('liest die Nutzer-ID aus URLs', () => {
    expect(parseGoodreadsUserId('https://www.goodreads.com/user/show/12345678-max-muster')).toBe('12345678');
    expect(parseGoodreadsUserId('https://www.goodreads.com/review/list/987-name?shelf=read')).toBe('987');
    expect(parseGoodreadsUserId(' 42 ')).toBe('42');
    expect(parseGoodreadsUserId('https://example.com')).toBeUndefined();
  });
});
