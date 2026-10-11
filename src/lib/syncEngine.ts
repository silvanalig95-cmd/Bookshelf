/**
 * Abgleich zwischen diesem Gerät und dem Lesekompass-Server.
 *
 * Jede Sammlung (Bibliothek, Merkliste, …) besteht aus Datensätzen mit ID. Das Gerät merkt sich
 * zu jedem Datensatz, welche Fassung es zuletzt mit dem Server geteilt hat („Schatten“, als
 * Prüfsumme). Weicht der aktuelle Stand davon ab, ist das eine lokale Änderung: Sie wird mit
 * Zeitstempel verschickt, und der Server behält pro Datensatz die jüngste Fassung.
 *
 * Diese Datei kennt weder React noch fetch – Sammlungen und Übertragung werden hineingereicht.
 */
import type { SyncChange, SyncCollection, SyncMismatch, SyncRequest, SyncResponse } from './syncProtocol';

export interface SyncAdapter {
  name: SyncCollection;
  /** Aktueller Stand: ID → Datensatz. */
  read(): Record<string, unknown>;
  /** Änderungen vom Server übernehmen. */
  write(upserts: Record<string, unknown>, deletes: string[]): void;
  /** Taugt ein Datensatz vom Server für diese Sammlung? Ungültiges wird nicht übernommen. */
  accepts?(id: string, value: unknown): boolean;
}

export interface SyncMeta {
  serverId?: string;
  /** Login, mit dem zuletzt abgeglichen wurde (null = ohne Login). */
  user?: string | null;
  rev: number;
  /** Serveruhr minus Geräteuhr in ms – damit eine falsch gehende Uhr nicht ständig gewinnt. */
  offset: number;
  /** Zuletzt geteilte Fassung je Datensatz. Fehlt eine Sammlung, wurde sie noch nie abgeglichen. */
  shadow: Partial<Record<SyncCollection, Record<string, string>>>;
  /** Noch nicht übertragene lokale Änderungen: ID → Zeitstempel. */
  pending: Partial<Record<SyncCollection, Record<string, number>>>;
  lastSync?: number;
  counts?: Record<SyncCollection, number>;
  /** Auf diesem Gerät ausgeschaltet. */
  disabled?: boolean;
}

export function emptyMeta(): SyncMeta {
  return { rev: 0, offset: 0, shadow: {}, pending: {} };
}

export type SyncTransport = (req: SyncRequest) => Promise<SyncResponse | SyncMismatch>;

export interface SyncReport {
  sent: number;
  received: number;
  /** Anderes Login: die Daten dieses Geräts wurden durch die des Kontos ersetzt. */
  replaced?: boolean;
  /** Sammlungen, die nach einem verdächtigen Massenlöschen vom Server zurückgeholt wurden. */
  restored?: SyncCollection[];
}

export interface SyncEngineOptions {
  adapters: SyncAdapter[];
  transport: SyncTransport;
  meta: SyncMeta;
  saveMeta: (meta: SyncMeta) => void;
  now?: () => number;
  /** Höchstens so viele Änderungen pro Anfrage (der Rest folgt in weiteren Runden). */
  chunkSize?: number;
}

/**
 * Zeitstempel für Daten, die schon vor dem ersten Abgleich auf dem Gerät lagen: Sie füllen
 * nur Lücken und überschreiben nichts, was der Server schon kennt.
 */
export const BASELINE_AT = 1;
/** Ab so vielen Löschungen auf einmal (und mehr als der Hälfte) wird nachgefragt, ob das gewollt war. */
const BULK_DELETE_MIN = 20;
const MAX_ROUNDS = 25;

/** Kurze Prüfsumme (cyrb53) über die JSON-Form eines Datensatzes. */
export function hashValue(value: unknown): string {
  const str = JSON.stringify(value) ?? 'undefined';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class SyncEngine {
  readonly meta: SyncMeta;
  private readonly adapters: SyncAdapter[];
  /** Zuletzt gesehene Objekte je Datensatz – unveränderte Objekte müssen nicht neu geprüft werden. */
  private refs = new Map<SyncCollection, Map<string, unknown>>();
  private bulkAllowedUntil = 0;
  private fullPull = false;
  private restored = new Set<SyncCollection>();
  private running?: Promise<SyncReport>;
  private again = false;

  constructor(private readonly opts: SyncEngineOptions) {
    this.meta = opts.meta;
    this.adapters = opts.adapters;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private stamp(): number {
    return Math.round(this.now() + this.meta.offset);
  }

  private refsFor(name: SyncCollection): Map<string, unknown> {
    let refs = this.refs.get(name);
    if (!refs) this.refs.set(name, (refs = new Map()));
    return refs;
  }

  private save() {
    this.opts.saveMeta(this.meta);
  }

  /** Der nächste grosse Löschvorgang ist gewollt (Bibliothek leeren, Sicherung zurückspielen). */
  allowBulkChanges(ms = 15_000) {
    this.bulkAllowedUntil = this.now() + ms;
  }

  /** Beim nächsten Abgleich alles neu vom Server holen. */
  requestFullPull() {
    this.fullPull = true;
  }

  pendingCount(): number {
    let n = 0;
    for (const p of Object.values(this.meta.pending)) n += Object.keys(p ?? {}).length;
    return n;
  }

  /** Vergleicht den aktuellen Stand mit dem zuletzt geteilten. true = es gibt Neues zu übertragen. */
  detectChanges(): boolean {
    let changed = false;
    for (const a of this.adapters) changed = this.detect(a) || changed;
    if (changed) this.save();
    return changed;
  }

  private detect(a: SyncAdapter): boolean {
    const current = a.read();
    const pending = (this.meta.pending[a.name] ??= {});
    const refs = this.refsFor(a.name);
    let shadow = this.meta.shadow[a.name];
    if (!shadow) {
      // Erster Abgleich dieser Sammlung: alles Vorhandene anbieten, aber ohne Vorrang vor dem Server
      shadow = this.meta.shadow[a.name] = {};
      for (const [id, v] of Object.entries(current)) {
        shadow[id] = hashValue(v);
        refs.set(id, v);
        pending[id] ??= BASELINE_AT;
      }
      return Object.keys(current).length > 0;
    }

    const at = this.stamp();
    let changed = false;
    for (const [id, v] of Object.entries(current)) {
      if (refs.get(id) === v && Object.hasOwn(shadow, id)) continue;
      refs.set(id, v);
      const h = hashValue(v);
      if (shadow[id] === h) continue;
      shadow[id] = h;
      pending[id] = at;
      changed = true;
    }

    const gone = Object.keys(shadow).filter((id) => !Object.hasOwn(current, id));
    if (!gone.length) return changed;
    const suspicious = gone.length >= BULK_DELETE_MIN && gone.length * 2 > Object.keys(shadow).length && this.now() > this.bulkAllowedUntil;
    for (const id of gone) {
      delete shadow[id];
      refs.delete(id);
      if (suspicious) delete pending[id];
      else pending[id] = at;
    }
    if (suspicious) {
      // Sieht nach verlorenen lokalen Daten aus, nicht nach Absicht: nichts löschen, sondern vom Server zurückholen
      this.fullPull = true;
      this.restored.add(a.name);
    }
    return true;
  }

  /** Ein vollständiger Abgleich (bei Bedarf in mehreren Runden). Parallele Aufrufe teilen sich einen Lauf. */
  sync(): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = { sent: 0, received: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      this.again = false;
      this.detectChanges();
      const since = this.fullPull ? 0 : this.meta.rev;
      this.fullPull = false;
      const batch = this.takeBatch();
      const t0 = this.now();
      const res = await this.opts.transport({ serverId: this.meta.serverId, since, changes: batch });
      const t1 = this.now();
      if (!res.ok) {
        if (this.handleMismatch(res)) report.replaced = true;
        continue;
      }
      this.meta.offset = Math.round(res.now - (t0 + t1) / 2);
      this.detectChanges(); // was sich während der Anfrage geändert hat, nicht überschreiben
      this.settle(batch);
      report.received += this.applyRemote(res.changes);
      report.sent += batch.length;
      Object.assign(this.meta, { serverId: res.serverId, user: res.user, rev: res.rev, lastSync: Date.now(), counts: res.counts });
      this.save();
      if (!this.again && !this.fullPull && this.pendingCount() === 0) break;
    }
    if (this.restored.size) {
      report.restored = Array.from(this.restored);
      this.restored.clear();
    }
    return report;
  }

  private takeBatch(): SyncChange[] {
    const out: SyncChange[] = [];
    const limit = this.opts.chunkSize ?? 1000;
    for (const a of this.adapters) {
      const ids = Object.keys(this.meta.pending[a.name] ?? {});
      if (!ids.length) continue;
      const pending = this.meta.pending[a.name]!;
      const current = a.read();
      for (const id of ids) {
        if (out.length >= limit) return out;
        out.push(Object.hasOwn(current, id) ? { c: a.name, id, at: pending[id], v: current[id] } : { c: a.name, id, at: pending[id], d: true });
      }
    }
    return out;
  }

  /** Übertragene Änderungen abhaken – ausser sie wurden inzwischen nochmals geändert. */
  private settle(batch: SyncChange[]) {
    for (const ch of batch) {
      const pending = this.meta.pending[ch.c];
      if (pending && pending[ch.id] === ch.at) delete pending[ch.id];
    }
  }

  private applyRemote(changes: SyncChange[]): number {
    let applied = 0;
    for (const a of this.adapters) {
      const mine = changes.filter((ch) => ch.c === a.name);
      if (!mine.length) continue;
      if (!this.meta.shadow[a.name]) this.detect(a);
      const shadow = this.meta.shadow[a.name]!;
      const pending = (this.meta.pending[a.name] ??= {});
      const refs = this.refsFor(a.name);
      const current = a.read();
      const upserts: Record<string, unknown> = {};
      const deletes: string[] = [];
      for (const ch of mine) {
        const local = pending[ch.id];
        if (local !== undefined && local > ch.at) continue; // eigene, jüngere Änderung geht gleich raus
        if (ch.d) {
          delete pending[ch.id];
          delete shadow[ch.id];
          refs.delete(ch.id);
          if (Object.hasOwn(current, ch.id)) deletes.push(ch.id);
          applied++;
          continue;
        }
        if (a.accepts && !a.accepts(ch.id, ch.v)) continue;
        delete pending[ch.id];
        const h = hashValue(ch.v);
        shadow[ch.id] = h;
        applied++;
        if (Object.hasOwn(current, ch.id) && hashValue(current[ch.id]) === h) {
          refs.set(ch.id, current[ch.id]); // schon genau so vorhanden
          continue;
        }
        refs.set(ch.id, ch.v);
        upserts[ch.id] = ch.v;
      }
      if (deletes.length || Object.keys(upserts).length) a.write(upserts, deletes);
    }
    return applied;
  }

  /** Der Server hat einen anderen Datenbestand als beim letzten Abgleich. Gibt true zurück, wenn lokal ersetzt wurde. */
  private handleMismatch(res: SyncMismatch): boolean {
    const otherAccount = this.meta.serverId !== undefined && this.meta.user !== undefined && res.user !== this.meta.user && !res.empty;
    this.refs.clear();
    this.meta.serverId = undefined;
    this.meta.rev = 0;
    this.meta.pending = {};
    this.meta.user = res.user;
    if (otherAccount) {
      // Anderes Login: Was hier liegt, gehört zum bisherigen Konto – durch die Daten des neuen ersetzen
      for (const a of this.adapters) {
        this.meta.shadow[a.name] = {};
        const ids = Object.keys(a.read());
        if (ids.length) a.write({}, ids);
      }
    } else {
      // Server neu aufgesetzt oder zurückgespielt: alles Vorhandene als Lückenfüller anbieten
      this.meta.shadow = {};
    }
    this.save();
    return otherAccount;
  }
}
