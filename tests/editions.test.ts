import { describe, expect, it } from 'vitest';
import { editionLabel, filterEditions, pickDefaultEdition, summarizeEditions } from '../src/lib/editions';
import { editionFromEntry, formatKind, parseYear } from '../src/lib/openLibrary';
import { edition } from './helpers';

describe('Ausgaben', () => {
  const list = [
    edition({ key: 'en', title: 'The Shadow of the Wind', languages: ['eng'], isbn13: '9780143034902', coverId: 1, year: 2005, formatKind: 'paperback' }),
    edition({ key: 'de-alt', title: 'Der Schatten des Windes', languages: ['ger'], isbn13: '9783458171706', coverId: 2, year: 2003, formatKind: 'hardcover', publishers: ['Insel'] }),
    edition({ key: 'de-neu', title: 'Der Schatten des Windes', languages: ['ger'], isbn13: '9783518458006', coverId: 3, year: 2007, formatKind: 'paperback', publishers: ['Suhrkamp'] }),
    edition({ key: 'de-ohne', title: 'Der Schatten des Windes', languages: ['ger'], year: 2010 }),
    edition({ key: 'es', title: 'La sombra del viento', languages: ['spa'], isbn13: '9788408163435', coverId: 4, year: 2016 }),
  ];

  it('wählt die beste deutsche Ausgabe', () => {
    expect(pickDefaultEdition(list, 'de-first')?.key).toBe('de-neu');
  });

  it('zählt und filtert nach Sprache und Format', () => {
    const s = summarizeEditions(list);
    expect(s.german).toBe(3);
    expect(s.english).toBe(1);
    expect(filterEditions(list, 'ger', 'all')).toHaveLength(3);
    expect(filterEditions(list, 'other', 'all').map((e) => e.key)).toEqual(['es']);
    expect(filterEditions(list, 'all', 'hardcover').map((e) => e.key)).toEqual(['de-alt']);
  });

  it('beschriftet Ausgaben auf Deutsch', () => {
    expect(editionLabel(list[2])).toBe('Suhrkamp · 2007 · Taschenbuch');
  });

  it('wandelt Open-Library-Einträge um', () => {
    const e = editionFromEntry({
      key: '/books/OL1M',
      title: 'Der Schatten des Windes',
      publishers: ['Suhrkamp'],
      publish_date: 'July 1, 2005',
      languages: [{ key: '/languages/ger' }],
      isbn_10: ['3518458000'],
      number_of_pages: 562,
      physical_format: 'Taschenbuch',
      covers: [-1, 15161017],
    });
    expect(e.isbn13).toBe('9783518458006');
    expect(e.year).toBe(2005);
    expect(e.languages).toEqual(['ger']);
    expect(e.formatKind).toBe('paperback');
    expect(e.coverId).toBe(15161017);
  });

  it('erkennt Formate und Jahre', () => {
    expect(formatKind('Mass Market Paperback')).toBe('paperback');
    expect(formatKind('Gebundene Ausgabe')).toBe('hardcover');
    expect(formatKind('Kindle Edition')).toBe('ebook');
    expect(formatKind('Audio CD')).toBe('audio');
    expect(parseYear('Jan 01, 2008')).toBe(2008);
    expect(parseYear('unbekannt')).toBeUndefined();
  });
});
