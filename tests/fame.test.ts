import { describe, expect, it } from 'vitest';
import { ageWeight, buildQueryPlans, DEFAULT_PARAMS, ERAS, famePrior, fameScore, scoreBook } from '../src/lib/discovery';
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

describe('Alter', () => {
  const now = 2026;
  const fantasy = (year: number, popularity: number, ratingsCount: number, editionCount: number) =>
    book({ id: `f${year}${popularity}`, title: 'Fantasy', year, subjects: ['Fantasy fiction', 'Magic', 'Dragons'], languages: ['ger'], popularity, ratingsCount, editionCount });

  it('lässt ältere, wenig bekannte Genre-Bücher zurückfallen – Klassiker nicht', () => {
    expect(ageWeight(fantasy(2015, 50, 5, 3), now).adj).toBe(0);
    expect(ageWeight(fantasy(1975, 50, 5, 3), now).adj).toBe(-1);
    expect(ageWeight(fantasy(1986, 50, 5, 3), now).adj).toBeCloseTo(-0.75);
    const classic = ageWeight(fantasy(1954, 40000, 2000, 300), now);
    expect(classic.adj).toBe(0);
    expect(classic.classic).toBe(true);
  });

  it('lässt Weltliteratur und Literarisches altern, ohne Abzug', () => {
    const kafka = book({ id: 'k', title: 'Das Schloss', year: 1926, subjects: ['Bureaucracy', 'Fiction', 'Classic Literature'], languages: ['ger'], popularity: 300, ratingsCount: 30, editionCount: 40 });
    expect(ageWeight(kafka, now).adj).toBe(0);
    const saramago = book({ id: 's', title: 'Die Stadt der Blinden', year: 1995, subjects: ['Dystopias', 'Fiction, literary', 'Blindness'], languages: ['ger'], popularity: 200, ratingsCount: 20, editionCount: 30 });
    expect(ageWeight(saramago, now).adj).toBe(0);
  });

  it('wirkt in der Suche – ausser wenn ausdrücklich nach Älterem gefragt wird', () => {
    const old = fantasy(1980, 300, 20, 10);
    const fresh = fantasy(2018, 300, 20, 10);
    const p = { ...DEFAULT_PARAMS, genres: ['fantasy'] };
    expect(scoreBook(fresh, p)!.score).toBeGreaterThan(scoreBook(old, p)!.score + 8);
    const eraParams = { ...p, eras: [ERAS[0].id] }; // Epoche gewählt = ausdrücklich Älteres erwünscht
    expect(Math.abs(scoreBook(fresh, eraParams)!.score - scoreBook(old, eraParams)!.score)).toBeLessThan(1);
  });
});
