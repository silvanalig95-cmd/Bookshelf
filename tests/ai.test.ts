import { describe, expect, it } from 'vitest';
import { AiRecommendationSchema, parseBookRefs, readingContext } from '../src/lib/aiPrompts';
import { entry } from './helpers';

describe('KI-Hilfen', () => {
  it('zerlegt [[Titel|Autor]]-Verweise', () => {
    const parts = parseBookRefs('Lies [[Der Name der Rose|Umberto Eco]] und dann [[Momo|Michael Ende]]!');
    expect(parts).toEqual([
      { type: 'text', text: 'Lies ' },
      { type: 'book', title: 'Der Name der Rose', author: 'Umberto Eco' },
      { type: 'text', text: ' und dann ' },
      { type: 'book', title: 'Momo', author: 'Michael Ende' },
      { type: 'text', text: '!' },
    ]);
  });

  it('fasst die Bibliothek für Claude zusammen', () => {
    const ctx = readingContext([
      entry({ id: '1', title: 'Momo', authors: ['Michael Ende'], rating: 5, dateRead: '2024-01-01' }),
      entry({ id: '2', title: 'Langweilig', authors: ['X'], rating: 1, dateRead: '2023-01-01' }),
      entry({ id: '3', title: 'Später', authors: ['Y'], shelf: 'to-read' }),
    ]);
    expect(ctx).toContain('Lieblingsbücher (5★): Momo – Michael Ende');
    expect(ctx).toContain('Nicht gefallen');
    expect(ctx).toContain('Will-ich-lesen');
    expect(ctx).toContain('Bereits gelesen (nicht empfehlen): Momo');
  });

  it('validiert strukturierte Antworten', () => {
    const ok = AiRecommendationSchema.safeParse({
      understanding: 'x',
      search: { genres: ['krimi'], moods: [], places: [], eras: [], keywords: [], pages_max: null, pages_min: null },
      recommendations: [{ title: 'Momo', original_title: null, author: 'Michael Ende', year: 1973, german_edition: true, why: 'weil', tags: [] }],
    });
    expect(ok.success).toBe(true);
    const bad = AiRecommendationSchema.safeParse({ understanding: 'x', search: { genres: ['gibts-nicht'] }, recommendations: [] });
    expect(bad.success).toBe(false);
  });
});

describe('Buchverweise in KI-Antworten', () => {
  const books = (text: string) => parseBookRefs(text).filter((p) => p.type === 'book');

  it('erkennt auch übliche Schreibweisen, falls die KI das Format vergisst', () => {
    expect(books('Lies **Stoner** von John Williams – ein stilles Meisterwerk.')).toEqual([{ type: 'book', title: 'Stoner', author: 'John Williams' }]);
    expect(books('„Hunger“ von Knut Hamsun Der Roman ist kurz.')).toEqual([{ type: 'book', title: 'Hunger', author: 'Knut Hamsun' }]);
    expect(books('*Der Meister und Margarita* (von Michail Bulgakow)')).toEqual([{ type: 'book', title: 'Der Meister und Margarita', author: 'Michail Bulgakow' }]);
    expect(books('»Hundert Jahre Einsamkeit« von Gabriel García Márquez')).toEqual([{ type: 'book', title: 'Hundert Jahre Einsamkeit', author: 'Gabriel García Márquez' }]);
    expect(books('"Normal People" by Sally Rooney')).toEqual([{ type: 'book', title: 'Normal People', author: 'Sally Rooney' }]);
  });

  it('lässt gewöhnliches Fett und Anführungszeichen in Ruhe', () => {
    expect(books('**Tipp** von mir: lies mehr.')).toEqual([]);
    expect(books('Das ist „spannend“ und **wichtig**.')).toEqual([]);
  });

  it('mischt beide Formate', () => {
    const parts = parseBookRefs('Erst [[Momo|Michael Ende]], dann **Die Wand** von Marlen Haushofer.');
    expect(parts.filter((p) => p.type === 'book').map((p) => (p as { title: string }).title)).toEqual(['Momo', 'Die Wand']);
    expect(parts.map((p) => (p.type === 'text' ? p.text : `[${p.title}]`)).join('')).toBe('Erst [Momo], dann [Die Wand].');
  });
});
