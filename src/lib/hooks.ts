import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buildReadIndex, useLibrary } from '../store/library';
import { useNightShift } from '../store/nightShift';
import { useSignals } from '../store/signals';
import { buildProfile, type TasteProfile } from './profile';
import type { LibraryEntry } from './types';

export function useLibraryEntries(): LibraryEntry[] {
  const entries = useLibrary((s) => s.entries);
  return useMemo(() => Object.values(entries), [entries]);
}

export function useReadIndex() {
  const entries = useLibrary((s) => s.entries);
  return useMemo(() => buildReadIndex(entries), [entries]);
}

/** Geschmacksprofil aus Bibliothek + Signalen (neu berechnet, wenn sich etwas ändert). */
export function useProfile(): TasteProfile | undefined {
  const entries = useLibrary((s) => s.entries);
  const signals = useSignals(useShallow((s) => s.signals));
  // Schlagwörter, die die Nachtschicht ergänzt hat – vor allem für Bücher, die Open Library kaum kennt
  const themes = useNightShift((s) => s.results.themes);
  return useMemo(() => {
    const list = Object.values(entries).map((e) => {
      const extra = themes[e.id]?.subjects;
      return extra?.length ? { ...e, subjects: [...(e.subjects ?? []), ...extra.filter((x) => !e.subjects?.includes(x))] } : e;
    });
    if (!list.length && !signals.length) return undefined;
    return buildProfile(list, signals);
  }, [entries, signals, themes]);
}

/** Führt eine asynchrone Funktion aus, sobald sich die Abhängigkeiten ändern. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): { data?: T; error?: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fnRef
      .current(controller.signal)
      .then((data) => !controller.signal.aborted && setState({ data, loading: false }))
      .catch((error) => !controller.signal.aborted && setState({ error, loading: false }));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function errorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof DOMException && err.name === 'AbortError') return '';
  if (err instanceof Error) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(err.message)) return 'Keine Verbindung zu Open Library – bist du online?';
    if (/HTTP 5\d\d/.test(err.message)) return 'Open Library ist gerade überlastet. Versuch es gleich nochmal.';
    return err.message;
  }
  return String(err);
}
