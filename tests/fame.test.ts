import { describe, expect, it } from 'vitest';
import { buildQueryPlans, DEFAULT_PARAMS, famePrior, fameScore, scoreBook } from '../src/lib/discovery';
import { docToBook } from '../src/lib/openLibrary';
import { book } from './helpers';

const bestseller = book({ id: 'b', title: 'Bekannt', subjects: ['Detective and mystery stories', 'Police'], languages: ['ger'], popularity: 20000, ratingsCount: 800, editionCount: 150, rating: 4.1, coverId: 1 });
const obscure = book({ id: 'o', title: 'Unbekannt', subjects: ['Detective and mystery stories', 'Police'], languages: ['ger'], popularity: 2, ratingsCount: 1, editionCount: 1, rating: 5, coverId: 2 });

describe('Bekanntheit', () => {
  it('misst Bekanntheit über Leselisten, Bewertungen und Ausgaben', () => {
    expect(fameScore(bestseller)).toBeGreaterThan(3.5);
    expect(fameScore(obscure)).toBeLessThan(0.8);
    expect(famePrior(bestseller)).toBe(1);
    expect(famePrior(obscure)).toBeLessThan(-0.5);
  });

  it('bevorzugt bei „ausgewogen“ bekannte Bücher – trotz 5 Sternen von einer einzigen Person', () => {
    const params = { ...DEFAULT_PARAMS, genres: ['krimi'] };
    const known = scoreBook(bestseller, params)!;
    const unknown = scoreBook(obscure, params)!;
    expect(known.score).toBeGreaterThan(unknown.score + 10);
    expect(known.match).toBeGreaterThan(unknown.match);
    expect(known.reasons.map((r) => r.label)).toContain('🔥 viel gelesen');
  });

  it('dreht das bei „Geheimtipp“ um', () => {
    const params = { ...DEFAULT_PARAMS, genres: ['krimi'], fame: -2 };
    expect(scoreBook(obscure, params)!.score).toBeGreaterThan(scoreBook(bestseller, params)!.score);
  });

  it('sortiert „nach Bewertung“ nur Bücher mit genug Bewertungen – ausser bei Geheimtipps', () => {
    const rated = (fame: number) => buildQueryPlans({ ...DEFAULT_PARAMS, genres: ['krimi'], fame }).find((p) => p.sort === 'rating')!.q;
    expect(rated(0)).toContain('ratings_count:[15 TO *]');
    expect(rated(-1)).not.toContain('ratings_count');
  });
});

describe('Genre ernst nehmen', () => {
  it('zählt einen Fantasy-Roman mit Mord nur halb als Krimi', () => {
    const params = { ...DEFAULT_PARAMS, genres: ['krimi'] };
    const crime = book({ id: 'c', title: 'Krimi', subjects: ['Detective and mystery stories', 'Murder'], languages: ['ger'], popularity: 500 });
    const fantasy = book({ id: 'f', title: 'Fantasy', subjects: ['Fantasy fiction', 'Magic', 'Dragons', 'Wizards', 'Murder'], languages: ['ger'], popularity: 500 });
    expect(scoreBook(crime, params)!.score).toBeGreaterThan(scoreBook(fantasy, params)!.score + 10);
  });
});

describe('Cover', () => {
  const doc = (year: number | undefined, workCover?: number) =>
    docToBook({
      key: '/works/OL1W',
      title: 'Crime and Punishment',
      author_name: ['F. M. Dostojewski'],
      cover_i: workCover,
      editions: { numFound: 1, start: 0, numFoundExact: true, docs: [{ key: '/books/OL2M', title: 'Schuld und Sühne', language: ['ger'], cover_i: 99, publish_year: year ? [year] : undefined }] },
    } as never);

  it('nimmt bei alten deutschen Ausgaben das Hauptcover des Werks, bei neueren das deutsche', () => {
    expect(doc(1921, 7).coverId).toBe(7);
    expect(doc(2013, 7).coverId).toBe(99);
    expect(doc(1921).coverId).toBe(99); // kein anderes Cover vorhanden
    expect(doc(1921, 7).title).toBe('Schuld und Sühne'); // der Titel bleibt deutsch
  });
});
