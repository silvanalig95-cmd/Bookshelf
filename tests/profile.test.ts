import { describe, expect, it } from 'vitest';
import { buildProfile, entryWeight, isProfileUsable, tasteMatch } from '../src/lib/profile';
import { computeStats, readingPersona } from '../src/lib/stats';
import { book, entry } from './helpers';

const fantasy = ['Fantasy fiction', 'Magic', 'Dragons', 'Wizards'];
const romance = ['Love stories', 'Romance', 'Man-woman relationships'];

const library = [
  entry({ id: '1', title: 'A', authors: ['Ursula K. Le Guin'], rating: 5, subjects: fantasy, dateRead: '2025-01-01', pages: 300, year: 1968 }),
  entry({ id: '2', title: 'B', authors: ['Ursula K. Le Guin'], rating: 5, subjects: [...fantasy, 'Islands'], dateRead: '2024-06-01', pages: 250, year: 1971 }),
  entry({ id: '3', title: 'C', authors: ['Terry Pratchett'], rating: 4, subjects: [...fantasy, 'Humor'], dateRead: '2023-03-01', pages: 400, year: 1987 }),
  entry({ id: '4', title: 'D', authors: ['Someone'], rating: 1, subjects: romance, dateRead: '2024-02-01', pages: 320, year: 2010 }),
  entry({ id: '5', title: 'E', authors: ['Other'], rating: 2, subjects: romance, dateRead: '2022-02-01', pages: 280, year: 2012 }),
  entry({ id: '6', title: 'F', authors: ['X'], shelf: 'to-read', subjects: ['Science fiction'] }),
];

describe('Geschmacksprofil', () => {
  const profile = buildProfile(library);

  it('gewichtet Bewertungen', () => {
    expect(entryWeight(library[0])).toBeGreaterThan(entryWeight(library[2]));
    expect(entryWeight(library[3])).toBeLessThan(0);
    expect(entryWeight(entry({ id: 'd', title: 'x', tags: ['did-not-finish'] }))).toBeLessThan(0);
  });

  it('erkennt Lieblingsthemen und Abneigungen', () => {
    expect(isProfileUsable(profile)).toBe(true);
    expect(profile.topConcepts.map((c) => c.concept)).toEqual(expect.arrayContaining(['fantasy', 'magic', 'dragons']));
    expect(profile.dislikedConcepts.map((c) => c.concept)).toEqual(expect.arrayContaining(['romance']));
    expect(profile.favoriteAuthors[0].name).toBe('Ursula K. Le Guin');
  });

  it('bevorzugt passende Bücher', () => {
    const likes = tasteMatch(profile, book({ id: 'a', title: 'x', subjects: ['Dragons', 'Magic', 'Quests'] }));
    const dislikes = tasteMatch(profile, book({ id: 'b', title: 'y', subjects: ['Love stories', 'Romance'] }));
    expect(likes.similarity).toBeGreaterThan(0);
    expect(dislikes.similarity).toBeLessThan(0);
    expect(likes.shared.length).toBeGreaterThan(0);
  });

  it('bezieht Swipe-Signale ein', () => {
    const withSignals = buildProfile(library, [{ bookId: 's', title: 's', authors: [], subjects: ['Pirates', 'Sea stories'], verdict: 'like', at: new Date().toISOString() }]);
    expect(withSignals.concepts.get('pirates')).toBeGreaterThan(0);
  });
});

describe('Lese-DNA', () => {
  const stats = computeStats(library);

  it('zählt Bücher, Seiten und Bewertungen', () => {
    expect(stats.read).toBe(5);
    expect(stats.toRead).toBe(1);
    expect(stats.pages).toBe(1550);
    expect(stats.avgRating).toBeCloseTo(3.4);
    expect(stats.ratings.find((r) => r.stars === 5)!.count).toBe(2);
    expect(stats.genres[0].id).toBe('fantasy');
    expect(stats.authors[0]).toMatchObject({ name: 'Ursula K. Le Guin', count: 2 });
    expect(stats.perYear.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025]);
  });

  it('beschreibt eine Lesepersönlichkeit ohne Geschlechtszuschreibung', () => {
    const persona = readingPersona(stats);
    expect(persona.title).toBe('Die Drachenseele');
    expect(persona.text.length).toBeGreaterThan(10);
  });
});
