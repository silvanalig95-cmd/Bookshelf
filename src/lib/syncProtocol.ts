/**
 * Gemeinsame Typen für die Geräte-Synchronisation (Browser ↔ server/syncStore.ts).
 * Nur Typen: der Server bindet diese Datei mit `import type` ein.
 */

export type SyncCollection = 'library' | 'wishlist' | 'signals' | 'settings';

/** Ein Datensatz auf dem Weg zwischen Gerät und Server. */
export interface SyncChange {
  c: SyncCollection;
  id: string;
  /** Zeitpunkt der Änderung (ms, Serverzeit); die jüngere Änderung gewinnt. */
  at: number;
  /** Inhalt – fehlt bei Löschungen. */
  v?: unknown;
  /** Gelöscht. */
  d?: true;
}

export interface SyncRequest {
  /** Kennung des Datenbestands, mit dem das Gerät zuletzt abgeglichen hat. */
  serverId?: string;
  /** Letzte bekannte Revision des Servers – geliefert wird alles danach. */
  since: number;
  changes: SyncChange[];
}

export interface SyncResponse {
  ok: true;
  serverId: string;
  user: string | null;
  rev: number;
  now: number;
  /** Änderungen anderer Geräte seit `since` sowie die Serverfassung abgelehnter Änderungen. */
  changes: SyncChange[];
  accepted: number;
  counts: Record<SyncCollection, number>;
}

/** Das Gerät hat zuletzt mit einem anderen Datenbestand abgeglichen (anderes Login, Server neu aufgesetzt). */
export interface SyncMismatch {
  ok: false;
  reason: 'other-dataset';
  serverId: string;
  user: string | null;
  empty: boolean;
  now: number;
}
