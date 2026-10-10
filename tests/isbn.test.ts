import { describe, expect, it } from 'vitest';
import { cleanIsbn, isbn10to13, isbn13to10, isbnLanguageHint, isValidIsbn10, isValidIsbn13, toIsbn13 } from '../src/lib/isbn';

describe('ISBN', () => {
  it('bereinigt Goodreads-Formate', () => {
    expect(cleanIsbn('="3458171703"')).toBe('3458171703');
    expect(cleanIsbn('=""')).toBe('');
    expect(cleanIsbn('978-3-518-45800-6')).toBe('9783518458006');
  });

  it('prüft Prüfziffern', () => {
    expect(isValidIsbn10('3458171703')).toBe(true);
    expect(isValidIsbn10('3458171704')).toBe(false);
    expect(isValidIsbn13('9783458171706')).toBe(true);
    expect(isValidIsbn13('9783458171707')).toBe(false);
  });

  it('rechnet zwischen ISBN-10 und ISBN-13 um', () => {
    expect(isbn10to13('3458171703')).toBe('9783458171706');
    expect(isbn13to10('9783458171706')).toBe('3458171703');
    expect(toIsbn13('159017416X')).toBe('9781590174166');
    expect(toIsbn13('kaputt')).toBeUndefined();
  });

  it('erkennt den deutschen Sprachraum', () => {
    expect(isbnLanguageHint('9783458171706')).toBe('de');
    expect(isbnLanguageHint('9780439023481')).toBe('en');
  });
});
