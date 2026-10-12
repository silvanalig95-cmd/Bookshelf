/**
 * Rotation der Treffer: Bücher, die du immer wieder gesehen, aber nie geöffnet, gemerkt, bewertet
 * oder weggeklickt hast, rutschen schrittweise nach hinten. Wer eine Weile nicht mehr auftaucht,
 * erholt sich (Halbwertszeit 30 Tage) und darf später wiederkommen. Dazu ein kleiner, täglich
 * wechselnder Zufall, damit die Reihenfolge nicht jeden Tag dieselbe ist.
 */
import type { Book } from './types';

const DAY = 24 * 3600 * 1000;
export const HALF_LIFE_DAYS = 30;
/** Ein Buch zählt höchstens alle 6 Stunden als „gesehen“. */
export const SIGHTING_GAP = 6 * 3600 * 1000;

/** Wie oft ein Buch (abklingend) gesehen wurde. */
export function decayedCount(count: number, last: number, now = Date.now()): number {
  return count * Math.pow(0.5, Math.max(0, now - last) / (HALF_LIFE_DAYS * DAY));
}

/**
 * Strengere Variante für die Startseite: Wer kürzlich schon da war, macht Platz für Neues –
 * schon nach dem ersten Mal. Nach ein, zwei Wochen darf ein Buch wiederkommen; wer immer wieder
 * ignoriert wird, kommt nur noch selten (abklingend über HALF_LIFE_DAYS).
 */
export function homeStaleness(count: number, last: number, now = Date.now()): number {
  const days = Math.max(0, now - last) / DAY;
  const recent = days < 3 ? 0.8 : days < 7 ? 0.45 : days < 14 ? 0.2 : 0;
  return Math.min(1.6, recent + decayedCount(count, last, now) * 0.15);
}

/** 0 = frisch … 1 = lange ignoriert (ab etwa zwölfmal gesehen). Die ersten zwei Male sind frei. */
export function fatigueFromCount(count: number): number {
  return Math.min(1, Math.max(0, (count - 2) * 0.1));
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Passt die Punktzahlen einer Trefferliste an (sortiert nicht selbst). Der Abzug ist relativ zur
 * Streuung der Liste: „1“ heisst, das Buch rutscht um die ganze Spanne zwischen guten und
 * schwachen Treffern nach hinten. Angepinnte (gesuchtes Buch) und verworfene Treffer bleiben, wo sie sind.
 */
export function rotate<T extends { book: Book; score: number }>(items: T[], fatigue: (id: string) => number, opts: { day?: string; jitter?: number } = {}): T[] {
  const regular = new Set(items.filter((x) => Number.isFinite(x.score) && x.score > -500 && x.score < 1e12));
  if (regular.size < 2) return items;
  const scores = Array.from(regular, (x) => x.score).sort((a, b) => a - b);
  const at = (p: number) => scores[Math.round(p * (scores.length - 1))];
  const spread = at(0.9) - at(0.1) || Math.abs(at(0.5)) || 1;
  const day = opts.day ?? todayKey();
  const jitter = opts.jitter ?? 0.08;
  return items.map((x) =>
    regular.has(x) ? { ...x, score: x.score - fatigue(x.book.id) * spread + (hash01(`${day}|${x.book.id}`) - 0.5) * jitter * spread } : x,
  );
}
