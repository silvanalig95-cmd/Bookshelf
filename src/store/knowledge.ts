/**
 * Verbindung zum Wissensspeicher des Servers (server/knowledge.ts): meldet, welche Bücher du
 * gesehen und geöffnet hast, und holt, was daraus gelernt wurde – KI-Schlagwörter für Bücher und
 * die Feinabstimmung der Bekanntheit. Ohne Server (z. B. GitHub Pages) passiert einfach nichts.
 */
import { create } from 'zustand';
import { fameScore } from '../lib/discovery';
import { setFameShift, setLearnedSubjects } from '../lib/learned';
import type { Book } from '../lib/types';

export interface KnowledgeSummary {
  books: number;
  learned: number;
  seen: number;
  opened: number;
}

export interface Tuning {
  fameShift: number;
  positives: number;
  negatives: number;
  meanPositive?: number;
  meanNegative?: number;
}

interface KnowledgeState {
  available?: boolean;
  summary?: KnowledgeSummary;
  tuning?: Tuning;
}

export const useKnowledge = create<KnowledgeState>(() => ({}));

type Event = 'seen' | 'opened';
const pending = new Map<string, Record<string, unknown>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let disabled = false;

/** Ein Buch melden – gesammelt und alle paar Sekunden in einem Rutsch geschickt. */
export function reportBook(book: Book, event: Event) {
  if (disabled || book.id.startsWith('ai:') || useKnowledge.getState().available === false) return;
  const known = book.popularity !== undefined || book.ratingsCount !== undefined || book.editionCount !== undefined;
  pending.set(`${event}:${book.id}`, {
    id: book.id,
    title: book.title.slice(0, 300),
    authors: book.authors.slice(0, 5),
    year: book.year,
    coverId: book.coverId,
    subjects: book.subjects.slice(0, 30),
    fame: known ? Math.round(fameScore(book) * 100) / 100 : undefined,
    event,
  });
  if (event === 'opened') void flush();
  else timer ??= setTimeout(() => void flush(), 15_000);
}

async function flush() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!pending.size || disabled) return;
  const books = Array.from(pending.values()).slice(0, 80);
  for (const [k, v] of pending) if (books.includes(v)) pending.delete(k);
  try {
    const res = await fetch('./api/wissen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ books }), keepalive: true });
    if (res.status === 404 || res.status === 405) disabled = true;
  } catch {
    /* offline – beim nächsten Mal */
  }
  if (pending.size) timer ??= setTimeout(() => void flush(), 5_000);
}

/** Holt, was der Server gelernt hat, und wendet es an. */
export async function loadKnowledge() {
  try {
    const res = await fetch('./api/wissen', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
      useKnowledge.setState({ available: false });
      return;
    }
    const d = (await res.json()) as { available: boolean; summary?: KnowledgeSummary; tuning?: Tuning };
    useKnowledge.setState({ available: d.available, summary: d.summary, tuning: d.tuning });
    if (!d.available) return;
    setFameShift(d.tuning?.fameShift ?? 0);
    const themes = await fetch('./api/wissen/themen', { cache: 'no-store' });
    if (themes.ok) setLearnedSubjects((await themes.json()) as Record<string, string[]>);
  } catch {
    useKnowledge.setState({ available: false });
  }
}

let started = false;
/** Einmal beim App-Start (und beim Verlassen der Seite das Gesammelte noch schicken). */
export function startKnowledge() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void loadKnowledge();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
