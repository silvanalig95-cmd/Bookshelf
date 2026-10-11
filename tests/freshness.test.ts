import { describe, expect, it } from 'vitest';
import { decayedCount, fatigueFromCount, HALF_LIFE_DAYS, rotate } from '../src/lib/freshness';
import { fatigue, useImpressions } from '../src/store/impressions';
import type { Book, ScoredBook } from '../src/lib/types';

const DAY = 86400000;
const item = (id: string, score: number): ScoredBook => ({ book: { id, title: id, authors: [], subjects: [], languages: [], source: 'openlibrary' } as Book, score, match: 50, reasons: [] });

describe('Rotation', () => {
  it('lässt Gesehenes abklingen und stuft erst ab dem dritten Mal zurück', () => {
    expect(decayedCount(4, 0, HALF_LIFE_DAYS * DAY)).toBeCloseTo(2, 5);
    expect(fatigueFromCount(1)).toBe(0);
    expect(fatigueFromCount(2)).toBe(0);
    expect(fatigueFromCount(3)).toBeCloseTo(0.1, 5);
    expect(fatigueFromCount(20)).toBe(1);
  });

  it('schiebt lange Ignoriertes hinter frische Treffer, lässt Angepinntes und Verworfenes stehen', () => {
    const list = [item('pinned', Number.MAX_SAFE_INTEGER), item('top', 100), ...Array.from({ length: 8 }, (_, i) => item(`b${i}`, 90 - i * 5)), item('weak', -1000)];
    const tired = (id: string) => (id === 'top' ? 1 : 0);
    const ranked = rotate(list, tired, { day: '2026-10-11', jitter: 0 }).sort((a, b) => b.score - a.score);
    expect(ranked[0].book.id).toBe('pinned');
    expect(ranked.findIndex((x) => x.book.id === 'top')).toBeGreaterThan(4);
    expect(ranked.at(-1)!.book.id).toBe('weak');
  });

  it('rotiert täglich leicht, bleibt innerhalb eines Tages stabil', () => {
    const list = Array.from({ length: 30 }, (_, i) => item(`b${i}`, 50));
    const order = (day: string) => rotate(list, () => 0, { day }).sort((a, b) => b.score - a.score).map((x) => x.book.id).join();
    expect(order('2026-10-11')).toBe(order('2026-10-11'));
    expect(order('2026-10-12')).not.toBe(order('2026-10-11'));
  });
});

describe('Gesehene Bücher', () => {
  it('zählt höchstens alle 6 Stunden, setzt bei Interesse zurück', () => {
    const { see, engage } = useImpressions.getState();
    const t0 = Date.now();
    see('OL1W', t0);
    see('OL1W', t0 + 3600_000);
    expect(useImpressions.getState().seen.OL1W[0]).toBe(1);
    for (let i = 1; i <= 5; i++) see('OL1W', t0 + i * 7 * 3600_000);
    expect(fatigue('OL1W', t0 + 36 * 3600_000)).toBeGreaterThan(0.2);
    engage('OL1W');
    expect(fatigue('OL1W')).toBe(0);
  });
});
