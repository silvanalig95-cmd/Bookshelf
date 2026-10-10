import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, SignalVerdict, TasteSignal } from '../lib/types';

interface SignalsState {
  signals: TasteSignal[];
  record: (book: Book, verdict: SignalVerdict) => void;
  clear: () => void;
}

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
        };
        const rest = get().signals.filter((s) => s.bookId !== book.id);
        set({ signals: [...rest, signal].slice(-600) });
      },
      clear: () => set({ signals: [] }),
    }),
    { name: 'lesekompass.signals', version: 1 },
  ),
);
