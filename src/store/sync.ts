/**
 * Geräte-Synchronisation im Browser: verbindet die Daten-Stores mit der SyncEngine und dem
 * Server (/api/sync). Läuft nur, wenn der Server sie anbietet (Docker-Installation).
 *
 * Abgeglichen werden Bibliothek, Merkliste, Swipe-Geschmack und die Einstellungen zu Region,
 * Shop, Sprache, Anna’s Archive, Goodreads-Profil und KI-Modell. API-Schlüssel und Design
 * bleiben auf dem jeweiligen Gerät.
 */
import { create } from 'zustand';
import { localApiStatus } from '../lib/goodreads';
import { emptyMeta, SyncEngine, type SyncAdapter, type SyncMeta } from '../lib/syncEngine';
import type { SyncCollection, SyncMismatch, SyncRequest, SyncResponse } from '../lib/syncProtocol';
import type { LibraryEntry, TasteSignal, WishlistItem } from '../lib/types';
import { idbStorage } from './idbStorage';
import { useLibrary } from './library';
import { useSettings, type SettingsState } from './settings';
import { MAX_SIGNALS, useSignals } from './signals';
import { onBulkChange } from './syncIntent';
import { toast } from './ui';
import { useWishlist } from './wishlist';

export type SyncPhase = 'checking' | 'unavailable' | 'off' | 'syncing' | 'ok' | 'offline' | 'error';

interface SyncState {
  phase: SyncPhase;
  user?: string | null;
  lastSync?: number;
  counts?: Record<SyncCollection, number>;
  pending: number;
  error?: string;
  /** Erster Abgleich vorbei (oder nicht möglich) – bis dahin wartet z. B. die Begrüssung. */
  settled: boolean;
}

export const useSync = create<SyncState>(() => ({ phase: 'checking', pending: 0, settled: false }));

export const SYNCED_SETTINGS = ['region', 'preferredShop', 'language', 'annasBase', 'goodreadsUserId', 'aiProvider', 'aiModel', 'geminiModel'] as const;
type SyncedSetting = (typeof SYNCED_SETTINGS)[number];

const META_KEY = 'lesekompass.sync';
const POLL_MS = 45_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function replaceRecords<T>(current: Record<string, T>, upserts: Record<string, unknown>, deletes: string[]): Record<string, T> {
  const next = { ...current, ...(upserts as Record<string, T>) };
  for (const id of deletes) delete next[id];
  return next;
}

const adapters: SyncAdapter[] = [
  {
    name: 'library',
    read: () => useLibrary.getState().entries,
    write: (upserts, deletes) => useLibrary.setState({ entries: replaceRecords<LibraryEntry>(useLibrary.getState().entries, upserts, deletes) }),
    accepts: (id, v) => isObj(v) && v.id === id && typeof v.title === 'string' && Array.isArray(v.authors) && typeof v.shelf === 'string',
  },
  {
    name: 'wishlist',
    read: () => useWishlist.getState().items,
    write: (upserts, deletes) => useWishlist.setState({ items: replaceRecords<WishlistItem>(useWishlist.getState().items, upserts, deletes) }),
    accepts: (id, v) => isObj(v) && isObj(v.book) && v.book.id === id && typeof v.book.title === 'string' && Array.isArray(v.book.authors) && Array.isArray(v.book.subjects),
  },
  {
    name: 'signals',
    read: () => Object.fromEntries(useSignals.getState().signals.map((s) => [s.bookId, s])),
    write: (upserts, deletes) => {
      const byBook = new Map(useSignals.getState().signals.map((s) => [s.bookId, s]));
      for (const id of deletes) byBook.delete(id);
      for (const [id, v] of Object.entries(upserts)) byBook.set(id, v as TasteSignal);
      const signals = Array.from(byBook.values())
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-MAX_SIGNALS);
      useSignals.setState({ signals });
    },
    accepts: (id, v) => isObj(v) && v.bookId === id && typeof v.at === 'string' && Array.isArray(v.subjects) && Array.isArray(v.authors),
  },
  {
    name: 'settings',
    read: () => {
      const s = useSettings.getState();
      return Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]]));
    },
    // Einstellungen werden nie gelöscht, nur überschrieben
    write: (upserts) => {
      const patch: Partial<Pick<SettingsState, SyncedSetting>> = {};
      for (const k of SYNCED_SETTINGS) if (Object.hasOwn(upserts, k)) Object.assign(patch, { [k]: upserts[k] });
      if (Object.keys(patch).length) useSettings.getState().set(patch);
    },
    accepts: (id, v) => (SYNCED_SETTINGS as readonly string[]).includes(id) && typeof v === 'string',
  },
];

class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function transport(req: SyncRequest): Promise<SyncResponse | SyncMismatch> {
  const body = JSON.stringify(req);
  const res = await fetch('./api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    cache: 'no-store',
    // Kleine Änderungen sollen auch noch ankommen, wenn der Tab gerade geschlossen wird (Browser erlauben dafür max. 64 KB)
    keepalive: body.length < 20_000,
  });
  if (res.ok || res.status === 409) return (await res.json()) as SyncResponse | SyncMismatch;
  let message = `Der Server antwortet mit Fehler ${res.status}.`;
  if (res.status === 401) message = 'Bitte neu anmelden (Seite neu laden).';
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) message = j.error;
  } catch {
    /* keine JSON-Antwort */
  }
  throw new SyncHttpError(res.status, message);
}

let engine: SyncEngine | undefined;
let started = false;
let detectTimer: ReturnType<typeof setTimeout> | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

function hydrated(store: { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = store.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

async function loadMeta(): Promise<SyncMeta> {
  try {
    const raw = await idbStorage.getItem(META_KEY);
    if (raw) return { ...emptyMeta(), ...(JSON.parse(raw) as Partial<SyncMeta>) };
  } catch {
    /* beschädigt oder nicht lesbar – neu beginnen */
  }
  return emptyMeta();
}

function active(): SyncEngine | undefined {
  return engine && !engine.meta.disabled ? engine : undefined;
}

function scheduleDetect() {
  if (!active()) return;
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => {
    const e = active();
    if (!e) return;
    if (e.detectChanges()) {
      useSync.setState({ pending: e.pendingCount() });
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => void runSync(), 1500);
    }
  }, 400);
}

function afterSync() {
  // Neues Gerät, aber Daten vom Server bekommen: die Begrüssung ist dann überflüssig
  const s = useSettings.getState();
  if (!s.onboarded && (Object.keys(useLibrary.getState().entries).length || Object.keys(useWishlist.getState().items).length)) {
    s.set({ onboarded: true });
  }
}

/** Gleicht jetzt ab (falls aktiv). */
export async function runSync(): Promise<void> {
  const e = active();
  if (!e) return;
  clearTimeout(pushTimer);
  useSync.setState({ phase: 'syncing' });
  try {
    const report = await e.sync();
    useSync.setState({ phase: 'ok', error: undefined, user: e.meta.user, lastSync: e.meta.lastSync, counts: e.meta.counts, pending: e.pendingCount(), settled: true });
    if (report.replaced) toast('Anderes Login erkannt – die Bibliothek dieses Kontos ist geladen');
    if (report.restored?.length) toast('Fehlende Daten wurden vom Server zurückgeholt');
    afterSync();
  } catch (err) {
    // Netzwerkfehler = offline (wird nachgeholt); eine Antwort mit Fehler = echtes Problem
    const httpError = err instanceof SyncHttpError ? err : undefined;
    useSync.setState({ phase: httpError ? 'error' : 'offline', error: httpError?.message, pending: e.pendingCount(), settled: true });
  }
}

/** Abgleich auf diesem Gerät ein- oder ausschalten. */
export function setSyncEnabled(on: boolean) {
  if (!engine) return;
  engine.meta.disabled = on ? undefined : true;
  void idbStorage.setItem(META_KEY, JSON.stringify(engine.meta));
  if (on) void runSync();
  else useSync.setState({ phase: 'off' });
}

/** Alles nochmals vom Server holen (Datensätze ohne eigene, neuere Änderung werden überschrieben). */
export function pullEverything() {
  engine?.requestFullPull();
  void runSync();
}

async function boot() {
  const status = await localApiStatus();
  if (!status.sync) {
    useSync.setState({ phase: 'unavailable', settled: true });
    return;
  }
  useSync.setState({ user: status.user });
  await Promise.all([hydrated(useLibrary), hydrated(useWishlist), hydrated(useSignals), hydrated(useSettings)]);
  const meta = await loadMeta();
  engine = new SyncEngine({ adapters, transport, meta, saveMeta: (m) => void idbStorage.setItem(META_KEY, JSON.stringify(m)) });
  onBulkChange(() => engine?.allowBulkChanges());
  useSync.setState({ lastSync: meta.lastSync, counts: meta.counts, pending: engine.pendingCount() });

  useLibrary.subscribe((s, prev) => s.entries !== prev.entries && scheduleDetect());
  useWishlist.subscribe((s, prev) => s.items !== prev.items && scheduleDetect());
  useSignals.subscribe((s, prev) => s.signals !== prev.signals && scheduleDetect());
  useSettings.subscribe((s, prev) => SYNCED_SETTINGS.some((k) => s[k] !== prev[k]) && scheduleDetect());

  setInterval(() => document.visibilityState === 'visible' && void runSync(), POLL_MS);
  document.addEventListener('visibilitychange', () => void runSync());
  window.addEventListener('online', () => void runSync());

  if (meta.disabled) useSync.setState({ phase: 'off', settled: true });
  else await runSync();
}

/** Einmal beim App-Start aufrufen. */
export function startSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Die Begrüssung nicht ewig zurückhalten, falls der Server trödelt
  setTimeout(() => useSync.setState({ settled: true }), 6000);
  boot().catch(() => useSync.setState({ phase: 'error', error: 'Synchronisation konnte nicht starten.', settled: true }));
}
