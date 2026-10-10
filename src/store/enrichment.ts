import { create } from 'zustand';
import { enrichEntries } from '../lib/goodreads';
import { useLibrary } from './library';

interface EnrichmentState {
  running: boolean;
  done: number;
  total: number;
  matched: number;
  /** Ordnet alle noch nicht zugeordneten Bibliothekseinträge Open-Library-Werken zu. */
  start: () => void;
  cancel: () => void;
}

let controller: AbortController | undefined;

/** Läuft im Hintergrund weiter, auch wenn man die Seite wechselt. */
export const useEnrichment = create<EnrichmentState>()((set, get) => ({
  running: false,
  done: 0,
  total: 0,
  matched: 0,
  start: () => {
    if (get().running) return;
    const entries = Object.values(useLibrary.getState().entries).filter((e) => e.matchState !== 'matched');
    if (!entries.length) return;
    controller = new AbortController();
    set({ running: true, done: 0, total: entries.length, matched: 0 });
    enrichEntries(
      entries,
      (patches) => useLibrary.getState().updateMany(patches),
      (p) => set({ done: p.done, total: p.total, matched: p.matched }),
      controller.signal,
    ).finally(() => set({ running: false }));
  },
  cancel: () => {
    controller?.abort();
    set({ running: false });
  },
}));
