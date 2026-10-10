import { describe, expect, it } from 'vitest';
import { AiRecommendationSchema, parseBookRefs, readingContext } from '../src/lib/ai';
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
