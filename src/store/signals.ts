import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, SignalVerdict, TasteSignal } from '../lib/types';
import { announceBulkChange } from './syncIntent';

interface SignalsState {
  signals: TasteSignal[];
  record: (book: Book, verdict: SignalVerdict) => void;
  /** Rückgängig: Entscheidung zu einem Buch entfernen (oder die vorherige wiederherstellen). */
  restore: (bookId: string, previous?: TasteSignal) => void;
  clear: () => void;
}

/**
 * Obergrenze nur als Schutz für den Speicher – praktisch bleiben alle Entscheidungen erhalten
 * (pro Buch die letzte).
 */
export const MAX_SIGNALS = 20_000;

/** Geschmackssignale aus Swipe, Glücksrad & Co. – fliessen ins Profil ein. */
export const useSignals = create<SignalsState>()(
  persist(
    (set, get) => ({
      signals: [],
      record: (book, verdict) => {
        const signal: TasteSignal = {
          bookId: book.id,
          title: book.title,
          authors: book.authors.slice(0, 3),
          subjects: book.subjects.slice(0, 25),
          verdict,
          at: new Date().toISOString(),
          ...(book.year ? { year: book.year } : {}),
        };
        const rest = get().signals.filter((s) => s.bookId !== book.id);
        set({ signals: [...rest, signal].slice(-MAX_SIGNALS) });
      },
      restore: (bookId, previous) => {
        const rest = get().signals.filter((s) => s.bookId !== bookId);
        set({ signals: previous ? [...rest, previous] : rest });
      },
      clear: () => {
        announceBulkChange();
        set({ signals: [] });
      },
    }),
    { name: 'lesekompass.signals', version: 1 },
  ),
);
