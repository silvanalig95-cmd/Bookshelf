import { describe, expect, it } from 'vitest';
import { authorSurname, bookFingerprint, contentWords, normalize, normalizeTitle, seededShuffle, truncate } from '../src/lib/text';

describe('Text', () => {
  it('normalisiert Umlaute und Sonderzeichen', () => {
    expect(normalize('Düstere Straße!')).toBe('dustere strasse');
  });

  it('vergleicht Titel ohne Artikel und Reihenangaben', () => {
    expect(normalizeTitle('Der Schatten des Windes (Friedhof der vergessenen Bücher, #1)')).toBe('schatten des windes');
    expect(normalizeTitle('The Hunger Games: Special Edition')).toBe('hunger games');
  });

  it('findet Nachnamen auch in „Nachname, Vorname“', () => {
    expect(authorSurname('Carlos Ruiz Zafón')).toBe('zafon');
    expect(authorSurname('Zafón, Carlos Ruiz')).toBe('zafon');
  });

  it('erzeugt gleiche Fingerabdrücke für dasselbe Buch', () => {
    expect(bookFingerprint('Der Schatten des Windes', ['Carlos Ruiz Zafón'])).toBe(bookFingerprint('Schatten des Windes (Roman)', ['C. R. Zafón']));
  });

  it('entfernt Stoppwörter (auch mit Umlauten)', () => {
    expect(contentWords('ein düsterer Krimi, der in Skandinavien spielt')).toEqual(['dusterer', 'krimi', 'skandinavien']);
    expect(contentWords('Etwas, das ich mögen würde')).toEqual([]);
  });

  it('kürzt an Wortgrenzen', () => {
    expect(truncate('Eins zwei drei vier fünf', 14)).toBe('Eins zwei…');
  });

  it('mischt deterministisch mit Seed', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 42)).toEqual(seededShuffle([1, 2, 3, 4, 5], 42));
  });
});
