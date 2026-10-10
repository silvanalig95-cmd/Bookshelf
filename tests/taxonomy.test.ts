import { describe, expect, it } from 'vitest';
import { detectGenres, displaySubjects, genreById, genreMatches, isNoiseSubject, iso1to2, matchRegex, subjectConcepts, subjectLabel } from '../src/lib/taxonomy';
import { normalize } from '../src/lib/text';

describe('Taxonomie', () => {
  it('übersetzt und bereinigt Schlagwörter', () => {
    expect(subjectLabel('Fiction, science fiction, general')).toBe('Science-Fiction');
    expect(subjectLabel('Fantasy fiction')).toBe('Fantasy');
    expect(subjectLabel('Detective and mystery stories')).toBe('Krimi');
    expect(subjectLabel('Aging in fiction')).toBe('Aging');
    expect(subjectLabel('Hardy Boys (Fictitious characters)')).toBe('Hardy Boys');
  });

  it('filtert Rauschen', () => {
    expect(isNoiseSubject('Accessible book')).toBe(true);
    expect(isNoiseSubject('nyt:combined-print-and-e-book-fiction=2015-06-07')).toBe(true);
    expect(isNoiseSubject('collectionID:eaneschallenge')).toBe(true);
    expect(isNoiseSubject('Romans, nouvelles')).toBe(true);
    expect(isNoiseSubject('Dragons')).toBe(false);
    expect(displaySubjects(['Fiction', 'Accessible book', 'Magic', 'magic', 'Dragons'])).toEqual(['Magie', 'Drachen']);
  });

  it('zerlegt Schlagwörter in Konzepte', () => {
    expect(subjectConcepts('Fiction, fantasy, epic')).toEqual(['fantasy', 'epic']);
    expect(subjectConcepts('Detective and mystery stories')).toEqual(['mystery']);
  });

  it('erkennt Genres und respektiert Ausschlüsse', () => {
    const scifi = normalize('Science fiction, Space opera, Robots');
    expect(detectGenres(scifi)).toContain('scifi');
    expect(genreMatches(scifi, genreById('wissenschaft')!)).toBe(false);
    expect(genreMatches(normalize('History, Europe, Civilization'), genreById('geschichte')!)).toBe(true);
    expect(genreMatches(normalize('Historical fiction, History'), genreById('geschichte')!)).toBe(false);
    expect(genreMatches(normalize('Adventure stories'), genreById('kurzgeschichten')!)).toBe(false);
  });

  it('passt Präfix- und Pluralbegriffe', () => {
    expect(matchRegex('detective*').test('detectives and mysteries')).toBe(true);
    expect(matchRegex('dragon').test('dragons')).toBe(true);
    expect(matchRegex('war').test('warrior')).toBe(false);
  });

  it('übersetzt Sprachcodes', () => {
    expect(iso1to2('de')).toBe('ger');
    expect(iso1to2('en-GB')).toBe('eng');
  });
});
