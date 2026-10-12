/**
 * Welche Bücher du schon gesehen hast (mindestens eine Sekunde gut sichtbar) – für die Rotation
 * der Treffer. Bleibt auf dem Gerät; wer ein Buch öffnet, merkt, bewertet oder wegklickt, setzt
 * seinen Zähler zurück.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { decayedCount, fatigueFromCount, homeStaleness, SIGHTING_GAP } from '../lib/freshness';
import { idbStorage } from './idbStorage';

const MAX_ENTRIES = 6000;

interface ImpressionsState {
  /** bookId → [Anzahl, zuletzt gesehen (ms)] */
  seen: Record<string, [number, number]>;
  see: (id: string, now?: number) => void;
  engage: (id: string) => void;
}

export const useImpressions = create<ImpressionsState>()(
  persist(
    (set, get) => ({
      seen: {},
      see: (id, now = Date.now()) => {
        const prev = get().seen[id];
        if (prev && now - prev[1] < SIGHTING_GAP) return;
        const next = { ...get().seen, [id]: [(prev ? decayedCount(prev[0], prev[1], now) : 0) + 1, now] as [number, number] };
        const ids = Object.keys(next);
        if (ids.length > MAX_ENTRIES) {
          ids.sort((a, b) => next[a][1] - next[b][1]);
          for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[old];
        }
        set({ seen: next });
      },
      engage: (id) => {
        if (!get().seen[id]) return;
        const next = { ...get().seen };
        delete next[id];
        set({ seen: next });
      },
    }),
    { name: 'lesekompass.impressions', version: 1, storage: createJSONStorage(() => idbStorage) },
  ),
);

/** Wartet, bis die gespeicherten Sichtungen geladen sind (IndexedDB lädt asynchron). */
export function impressionsReady(timeoutMs = 1500): Promise<void> {
  const persist = useImpressions.persist;
  if (!persist || persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsub = persist.onFinishHydration(done);
  });
}

/** Wie stark ein Buch wegen wiederholten Ignorierens zurückgestuft wird (0–1). */
export function fatigue(id: string, now = Date.now()): number {
  const e = useImpressions.getState().seen[id];
  return e ? fatigueFromCount(decayedCount(e[0], e[1], now)) : 0;
}

/** Startseite: kürzlich Gesehenes macht Platz, oft Ignoriertes kommt nur noch selten (0–1.6). */
export function staleness(id: string, now = Date.now()): number {
  const e = useImpressions.getState().seen[id];
  return e ? homeStaleness(e[0], e[1], now) : 0;
}

/** Löst bei ausreichend langer Sichtbarkeit genau einmal `onSeen` aus (ein Beobachter für alle Karten). */
const callbacks = new Map<Element, () => void>();
const timers = new Map<Element, ReturnType<typeof setTimeout>>();
let observer: IntersectionObserver | undefined;

export function watchImpression(el: Element, onSeen: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const t = timers.get(entry.target);
        if (entry.isIntersecting) {
          if (!t) {
            timers.set(
              entry.target,
              setTimeout(() => {
                callbacks.get(entry.target)?.();
                unwatch(entry.target);
              }, 1000),
            );
          }
        } else if (t) {
          clearTimeout(t);
          timers.delete(entry.target);
        }
      }
    },
    { threshold: 0.6 },
  );
  callbacks.set(el, onSeen);
  observer.observe(el);
  return () => unwatch(el);
}

function unwatch(el: Element) {
  const t = timers.get(el);
  if (t) clearTimeout(t);
  timers.delete(el);
  callbacks.delete(el);
  observer?.unobserve(el);
}
