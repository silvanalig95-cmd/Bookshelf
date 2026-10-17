/**
 * Ergebnisse der Nachtschicht vom Server: Lese-Analyse, Vorschläge über Nacht und zusätzliche
 * Schlagwörter für Bücher der Bibliothek (fliessen ins Geschmacksprofil ein). Siehe server/nightShift.ts.
 */
import { create } from 'zustand';

export interface NightSuggestion {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  coverId?: number;
  why: string;
  at: number;
}

export interface NightStatus {
  day: string;
  state: 'idle' | 'running' | 'paused' | 'done' | 'error';
  reason?: 'quota' | 'tasks' | 'window' | 'active' | 'errors';
  startedAt?: number;
  finishedAt?: number;
  requests: number;
  exhausted: string[];
  made: { blurbs: number; themes: number; analysis: number; suggestions: number };
  lastError?: string;
  window: { start: number; reset: number };
  startHour: number;
  timeZone: string;
  running: boolean;
}

export interface NightResults {
  themes: Record<string, { subjects: string[]; at: number }>;
  analysis?: { text: string; model: string; at: number };
  suggestions: NightSuggestion[];
}

interface NightShiftState {
  available: boolean;
  loaded: boolean;
  status?: NightStatus;
  results: NightResults;
  load: () => Promise<void>;
  start: () => Promise<string | undefined>;
}

const EMPTY: NightResults = { themes: {}, suggestions: [] };

export const useNightShift = create<NightShiftState>((set, get) => ({
  available: false,
  loaded: false,
  results: EMPTY,
  load: async () => {
    try {
      const res = await fetch('./api/nachtschicht', { cache: 'no-store' });
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return set({ loaded: true });
      const d = (await res.json()) as { available: boolean; status?: NightStatus; results?: NightResults };
      set({ available: d.available, status: d.status, results: d.results ?? EMPTY, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  start: async () => {
    try {
      const res = await fetch('./api/nachtschicht/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Fehler ${res.status}`;
      setTimeout(() => void get().load(), 1500);
      return undefined;
    } catch {
      return 'Server nicht erreichbar.';
    }
  },
}));

let started = false;
/** Einmal beim App-Start: Ergebnisse holen (und alle 30 Minuten auffrischen, solange die App offen ist). */
export function startNightShift() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void useNightShift.getState().load();
  setInterval(() => document.visibilityState === 'visible' && void useNightShift.getState().load(), 30 * 60_000);
}
