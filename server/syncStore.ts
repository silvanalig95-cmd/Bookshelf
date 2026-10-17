/**
 * Geräte-Synchronisation: hält Bibliothek, Merkliste, Swipe-Geschmack und Einstellungen pro
 * Login in einer JSON-Datei und gleicht Änderungen Datensatz für Datensatz ab.
 *
 * - Die jüngere Änderung gewinnt; bei Gleichstand bleibt, was schon da ist.
 * - Löschungen bleiben als Markierung erhalten, damit sie auch Geräte erreichen, die länger offline waren.
 * - Vor der ersten Änderung eines Tages wird eine Sicherungskopie angelegt (die letzten 14 bleiben).
 */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncChange, SyncCollection, SyncMismatch, SyncResponse } from '../src/lib/syncProtocol.ts';

export const SYNC_COLLECTIONS: readonly SyncCollection[] = ['library', 'wishlist', 'signals', 'settings'];
export const MAX_SYNC_CHANGES = 5000;
const MAX_ID_LENGTH = 300;
const MAX_VALUE_LENGTH = 256 * 1024;
/** Zeitstempel aus der Zukunft (falsch gehende Uhr) zählen höchstens als „jetzt“. */
const FUTURE_SLACK = 5 * 60_000;
const KEEP_BACKUPS = 14;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

interface StoredRecord {
  at: number;
  rev: number;
  v?: unknown;
  d?: true;
}

interface UserData {
  format: 1;
  serverId: string;
  user: string | null;
  rev: number;
  createdAt: string;
  collections: Record<SyncCollection, Record<string, StoredRecord>>;
}

export type SyncResult = { status: 200; body: SyncResponse } | { status: 409; body: SyncMismatch };

/** Fehler in der Anfrage des Geräts (→ HTTP 400). */
export class SyncInputError extends Error {}

/** Dateiname (ohne Endung) für ein Login; ohne Login teilen sich alle Geräte einen Bestand. */
export function syncFileName(user: string | null): string {
  if (user === null) return 'gemeinsam';
  const slug = user.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40) || 'login';
  return `login-${slug}-${createHash('sha256').update(user).digest('hex').slice(0, 8)}`;
}

function emptyCollections(): UserData['collections'] {
  return { library: {}, wishlist: {}, signals: {}, settings: {} };
}

function parseRequest(input: unknown): { serverId?: string; since: number; changes: SyncChange[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SyncInputError('Ungültige Anfrage');
  const r = input as Record<string, unknown>;
  const since = r.since ?? 0;
  if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) throw new SyncInputError('Ungültige Revision');
  if (r.serverId !== undefined && (typeof r.serverId !== 'string' || r.serverId.length > 100)) throw new SyncInputError('Ungültige Bestands-Kennung');
  const raw = r.changes ?? [];
  if (!Array.isArray(raw)) throw new SyncInputError('Ungültige Änderungsliste');
  if (raw.length > MAX_SYNC_CHANGES) throw new SyncInputError(`Höchstens ${MAX_SYNC_CHANGES} Änderungen pro Anfrage`);
  const changes: SyncChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new SyncInputError('Ungültige Änderung');
    const { c, id, at, v, d } = item as Record<string, unknown>;
    if (!SYNC_COLLECTIONS.includes(c as SyncCollection)) throw new SyncInputError(`Unbekannte Sammlung „${String(c).slice(0, 40)}“`);
    if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) throw new SyncInputError('Ungültige Datensatz-ID');
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw new SyncInputError('Ungültiger Zeitstempel');
    if (FORBIDDEN_IDS.has(id)) continue;
    if (d === true) {
      changes.push({ c: c as SyncCollection, id, at, d: true });
      continue;
    }
    if (v === undefined) throw new SyncInputError('Änderung ohne Inhalt');
    if (JSON.stringify(v).length > MAX_VALUE_LENGTH) throw new SyncInputError(`Datensatz ${id.slice(0, 60)} ist zu gross`);
    changes.push({ c: c as SyncCollection, id, at, v });
  }
  return { serverId: r.serverId as string | undefined, since, changes };
}

function sameContent(rec: StoredRecord, ch: SyncChange): boolean {
  if (rec.d || ch.d) return Boolean(rec.d) === Boolean(ch.d);
  return JSON.stringify(rec.v) === JSON.stringify(ch.v);
}

function toWire(c: SyncCollection, id: string, rec: StoredRecord): SyncChange {
  return rec.d ? { c, id, at: rec.at, d: true } : { c, id, at: rec.at, v: rec.v };
}

export class SyncStore {
  readonly dir: string;
  private readonly clock: () => number;
  private cache = new Map<string, UserData>();

  // Ohne Parameter-Eigenschaften: Node führt diese Datei ohne Übersetzung aus
  constructor(dir: string, clock: () => number = Date.now) {
    this.dir = dir;
    this.clock = clock;
  }

  private file(name: string): string {
    return join(this.dir, `${name}.json`);
  }

  private load(user: string | null): UserData {
    const name = syncFileName(user);
    const cached = this.cache.get(name);
    if (cached) return cached;
    const file = this.file(name);
    let data: UserData;
    if (existsSync(file)) {
      // Eine kaputte Datei nie überschreiben: lieber jeden Abgleich ablehnen (Sicherungen liegen daneben)
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as UserData;
      if (parsed.format !== 1 || typeof parsed.serverId !== 'string' || typeof parsed.rev !== 'number') {
        throw new Error(`${file} hat ein unbekanntes Format`);
      }
      data = { ...parsed, collections: { ...emptyCollections(), ...parsed.collections } };
    } else {
      data = { format: 1, serverId: randomUUID(), user, rev: 0, createdAt: new Date(this.clock()).toISOString(), collections: emptyCollections() };
    }
    this.cache.set(name, data);
    return data;
  }

  private save(data: UserData) {
    mkdirSync(this.dir, { recursive: true });
    const name = syncFileName(data.user);
    const file = this.file(name);
    this.backup(name, file);
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, JSON.stringify(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  }

  private backup(name: string, file: string) {
    if (!existsSync(file)) return;
    const dir = join(this.dir, 'sicherungen');
    const target = join(dir, `${name}-${new Date(this.clock()).toISOString().slice(0, 10)}.json`);
    if (existsSync(target)) return;
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, target);
    const all = readdirSync(dir)
      .filter((f) => f.startsWith(`${name}-`) && f.endsWith('.json'))
      .sort();
    for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) rmSync(join(dir, f), { force: true });
  }

  /** Aktuelle Datensätze einer Sammlung (ohne gelöschte) – nur lesend, z. B. für die Nachtschicht. */
  records(user: string | null, collection: SyncCollection): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, rec] of Object.entries(this.load(user).collections[collection])) if (!rec.d) out[id] = rec.v;
    return out;
  }

  /** Stand des Bestands – ändert sich mit jeder Änderung. */
  revision(user: string | null): number {
    return this.load(user).rev;
  }

  counts(user: string | null): Record<SyncCollection, number> {
    const data = this.load(user);
    const counts = { library: 0, wishlist: 0, signals: 0, settings: 0 };
    for (const c of SYNC_COLLECTIONS) for (const rec of Object.values(data.collections[c])) if (!rec.d) counts[c]++;
    return counts;
  }

  /** Nimmt die Änderungen eines Geräts entgegen und liefert ihm, was andere Geräte geändert haben. */
  sync(user: string | null, input: unknown): SyncResult {
    const req = parseRequest(input);
    const now = this.clock();
    const data = this.load(user);
    if (req.serverId && req.serverId !== data.serverId) {
      const empty = Object.values(this.counts(user)).every((n) => n === 0);
      return { status: 409, body: { ok: false, reason: 'other-dataset', serverId: data.serverId, user, empty, now } };
    }
    // Kennt das Gerät eine neuere Revision als der Server (Daten aus einer Sicherung zurückgespielt)? Dann alles schicken.
    const since = req.since > data.rev ? 0 : req.since;
    const accepted = new Set<string>();
    const rejected: Array<[SyncCollection, string]> = [];
    let dirty = false;
    for (const ch of req.changes) {
      const coll = data.collections[ch.c];
      const cur = Object.hasOwn(coll, ch.id) ? coll[ch.id] : undefined;
      const at = ch.at > now + FUTURE_SLACK ? now : ch.at;
      if (cur && at <= cur.at) {
        rejected.push([ch.c, ch.id]);
        continue;
      }
      accepted.add(`${ch.c}\n${ch.id}`);
      dirty = true;
      if (cur && sameContent(cur, ch)) {
        cur.at = at; // gleicher Inhalt, nur später nochmals gespeichert – andere Geräte müssen nichts holen
        continue;
      }
      data.rev += 1;
      coll[ch.id] = ch.d ? { at, rev: data.rev, d: true } : { at, rev: data.rev, v: ch.v };
    }

    const changes: SyncChange[] = [];
    const sent = new Set<string>();
    for (const c of SYNC_COLLECTIONS) {
      for (const [id, rec] of Object.entries(data.collections[c])) {
        const key = `${c}\n${id}`;
        if (rec.rev > since && !accepted.has(key)) {
          changes.push(toWire(c, id, rec));
          sent.add(key);
        }
      }
    }
    // Abgelehnte Änderungen: dem Gerät die gültige Fassung zurückgeben
    for (const [c, id] of rejected) {
      const key = `${c}\n${id}`;
      if (sent.has(key)) continue;
      changes.push(toWire(c, id, data.collections[c][id]));
      sent.add(key);
    }

    if (dirty) this.save(data);
    return {
      status: 200,
      body: { ok: true, serverId: data.serverId, user, rev: data.rev, now, changes, accepted: accepted.size, counts: this.counts(user) },
    };
  }
}
