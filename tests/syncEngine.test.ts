import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncStore } from '../server/syncStore';
import { emptyMeta, SyncEngine, type SyncAdapter, type SyncMeta } from '../src/lib/syncEngine';
import type { SyncCollection, SyncMismatch, SyncRequest, SyncResponse } from '../src/lib/syncProtocol';

type Records = Record<string, unknown>;

/** Ein simuliertes Gerät mit eigenen Sammlungen, eigener Uhr und eigenem Login. */
class Device {
  data: Record<SyncCollection, Records> = { library: {}, wishlist: {}, signals: {}, settings: { region: 'CH' }, owned: {} };
  meta: SyncMeta = emptyMeta();
  saved = 0;
  online = true;
  clockSkew = 0;
  duringRequest?: () => void;
  engine: SyncEngine;

  constructor(
    public server: { store: SyncStore; now: () => number },
    public user: string | null = 'ich',
    chunkSize?: number,
  ) {
    const adapters: SyncAdapter[] = (['library', 'wishlist', 'signals', 'settings'] as const).map((name) => ({
      name,
      read: () => this.data[name],
      write: (upserts, deletes) => {
        const next = { ...this.data[name], ...upserts };
        if (name !== 'settings') for (const id of deletes) delete next[id];
        this.data[name] = next;
      },
      accepts: name === 'settings' ? (_id, v) => typeof v === 'string' : (id, v) => typeof v === 'object' && v !== null && (v as { id?: string }).id === id,
    }));
    this.engine = new SyncEngine({
      adapters,
      transport: (req) => this.send(req),
      meta: this.meta,
      saveMeta: () => this.saved++,
      now: () => this.server.now() + this.clockSkew,
      chunkSize,
    });
  }

  private async send(req: SyncRequest): Promise<SyncResponse | SyncMismatch> {
    if (!this.online) throw new TypeError('Failed to fetch');
    const body = JSON.parse(JSON.stringify(req)) as unknown;
    this.duringRequest?.();
    const r = this.server.store.sync(this.user, body);
    return JSON.parse(JSON.stringify(r.body)) as SyncResponse | SyncMismatch;
  }

  set(c: SyncCollection, id: string, patch: Record<string, unknown> | null) {
    const next = { ...this.data[c] };
    if (patch === null) delete next[id];
    else next[id] = { ...(next[id] as object), id, ...patch };
    this.data[c] = next;
  }

  get(id: string, c: SyncCollection = 'library') {
    return this.data[c][id] as Record<string, unknown> | undefined;
  }

  sync() {
    return this.engine.sync();
  }
}

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'lesekompass-engine-'));
  let t = Date.UTC(2026, 9, 1, 8);
  const server = { store: new SyncStore(dir, () => t), now: () => t };
  return { server, dir, tick: (ms = 1000) => (t += ms) };
}

const books = (n: number, prefix = 'gr:') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { id: `${prefix}${i}`, title: `Buch ${i}`, authors: ['A'], rating: 0, shelf: 'read' }]));

describe('Geräte-Abgleich', () => {
  it('bringt die Bibliothek eines Geräts auf ein neues Gerät', async () => {
    const { server } = world();
    const pc = new Device(server);
    pc.data.library = books(3);
    await pc.sync();
    const phone = new Device(server);
    const report = await phone.sync();
    expect(Object.keys(phone.data.library).sort()).toEqual(['gr:0', 'gr:1', 'gr:2']);
    expect(report.received).toBeGreaterThanOrEqual(3);
    expect(phone.engine.pendingCount()).toBe(0);
  });

  it('überträgt Bewertungen, Merkliste und Löschungen in beide Richtungen', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    const phone = new Device(server);
    pc.data.library = books(2);
    await pc.sync();
    await phone.sync();

    tick();
    phone.set('library', 'gr:1', { rating: 5 });
    phone.set('wishlist', 'OL1W', { book: { title: 'Gemerkt' } });
    await phone.sync();
    tick();
    pc.set('library', 'gr:0', null);
    pc.data.settings = { region: 'DE' };
    await pc.sync();
    await phone.sync();

    expect(pc.get('gr:1')?.rating).toBe(5);
    expect(pc.get('OL1W', 'wishlist')).toBeDefined();
    expect(phone.get('gr:0')).toBeUndefined();
    expect(phone.data.settings.region).toBe('DE');
    // Nichts mehr offen, nichts pendelt hin und her
    expect(pc.engine.pendingCount() + phone.engine.pendingCount()).toBe(0);
    const before = server.store.sync('ich', { since: 0, changes: [] });
    await pc.sync();
    await phone.sync();
    expect(server.store.sync('ich', { since: 0, changes: [] }).body).toMatchObject({ rev: (before.body as SyncResponse).rev });
  });

  it('lässt bei gleichzeitigen Änderungen die jüngere gewinnen – auch mit falsch gehender Uhr', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    const phone = new Device(server);
    pc.data.library = books(1);
    await pc.sync();
    await phone.sync();
    phone.clockSkew = -3_600_000; // Handy-Uhr eine Stunde zurück
    await phone.sync(); // lernt den Uhrenversatz

    tick();
    pc.set('library', 'gr:0', { rating: 2 });
    pc.engine.detectChanges();
    tick();
    phone.set('library', 'gr:0', { rating: 4 }); // später geändert
    phone.engine.detectChanges();
    await pc.sync();
    await phone.sync();
    await pc.sync();
    expect(pc.get('gr:0')?.rating).toBe(4);
    expect(phone.get('gr:0')?.rating).toBe(4);
  });

  it('holt offline Geändertes später nach', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    const phone = new Device(server);
    await pc.sync();
    await phone.sync();
    phone.online = false;
    tick();
    phone.set('library', 'm:1', { title: 'Im Zug gelesen', authors: ['B'], shelf: 'read', rating: 4 });
    await expect(phone.sync()).rejects.toThrow('Failed to fetch');
    expect(phone.engine.pendingCount()).toBe(1);
    phone.online = true;
    await phone.sync();
    await pc.sync();
    expect(pc.get('m:1')?.title).toBe('Im Zug gelesen');
  });

  it('überschreibt beim ersten Abgleich nichts Neueres mit alten lokalen Daten', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    pc.data.library = books(2);
    await pc.sync();
    tick();
    pc.set('library', 'gr:0', { rating: 5 });
    await pc.sync();

    // Altes Gerät mit eigenem Goodreads-Import von früher (ohne Bewertung) und einem Buch, das sonst keiner hat
    tick(60_000);
    const laptop = new Device(server);
    laptop.data.library = { ...books(2), 'gr:99': { id: 'gr:99', title: 'Nur hier', authors: ['C'], shelf: 'read', rating: 3 } };
    await laptop.sync();
    await pc.sync();
    expect(laptop.get('gr:0')?.rating).toBe(5);
    expect(pc.get('gr:0')?.rating).toBe(5);
    expect(pc.get('gr:99')?.title).toBe('Nur hier');
  });

  it('löscht nicht überall, wenn lokal plötzlich fast alles fehlt – sondern holt es zurück', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    const phone = new Device(server);
    pc.data.library = books(50);
    await pc.sync();
    await phone.sync();

    tick();
    pc.data.library = {}; // z. B. Browser-Speicher verloren
    const report = await pc.sync();
    expect(report.restored).toEqual(['library']);
    expect(Object.keys(pc.data.library)).toHaveLength(50);
    await phone.sync();
    expect(Object.keys(phone.data.library)).toHaveLength(50);

    // Absichtlich geleert (angekündigt): dann gilt es für alle Geräte
    tick();
    pc.engine.allowBulkChanges();
    pc.data.library = {};
    await pc.sync();
    await phone.sync();
    expect(Object.keys(phone.data.library)).toHaveLength(0);
  });

  it('verliert keine Änderung, die während der Übertragung passiert', async () => {
    const { server, tick } = world();
    const pc = new Device(server);
    const phone = new Device(server);
    pc.data.library = books(1);
    await pc.sync();
    await phone.sync();
    tick();
    phone.set('library', 'gr:0', { rating: 1 });
    await phone.sync();

    tick();
    pc.duringRequest = () => {
      pc.duringRequest = undefined;
      tick();
      pc.set('library', 'gr:0', { rating: 3, shelf: 'to-read' });
    };
    await pc.sync();
    expect(pc.get('gr:0')).toMatchObject({ rating: 3, shelf: 'to-read' });
    await phone.sync();
    expect(phone.get('gr:0')).toMatchObject({ rating: 3, shelf: 'to-read' });
  });

  it('überträgt grosse Bibliotheken in Etappen', async () => {
    const { server } = world();
    const pc = new Device(server, 'ich', 1000);
    pc.data.library = books(2500);
    const report = await pc.sync();
    expect(report.sent).toBeGreaterThanOrEqual(2500);
    expect(pc.engine.pendingCount()).toBe(0);
    const phone = new Device(server);
    await phone.sync();
    expect(Object.keys(phone.data.library)).toHaveLength(2500);
  });

  it('ersetzt die Daten, wenn sich jemand anderes anmeldet, der schon Daten hat', async () => {
    const { server } = world();
    const partnerPhone = new Device(server, 'partner');
    partnerPhone.data.library = books(2, 'p:');
    await partnerPhone.sync();

    const shared = new Device(server, 'ich');
    shared.data.library = books(3);
    await shared.sync();
    shared.user = 'partner';
    const report = await shared.sync();
    expect(report.replaced).toBe(true);
    expect(Object.keys(shared.data.library).sort()).toEqual(['p:0', 'p:1']);
    // Die Daten von „ich“ bleiben auf dem Server unberührt
    expect((server.store.sync('ich', { since: 0, changes: [] }).body as SyncResponse).counts.library).toBe(3);
  });

  it('nimmt die Daten mit, wenn erst später ein Login eingerichtet wird', async () => {
    const { server } = world();
    const pc = new Device(server, null);
    pc.data.library = books(4);
    await pc.sync();
    pc.user = 'ich'; // neues, noch leeres Login
    const report = await pc.sync();
    expect(report.replaced).toBeFalsy();
    expect((server.store.sync('ich', { since: 0, changes: [] }).body as SyncResponse).counts.library).toBe(4);
  });

  it('füllt einen neu aufgesetzten Server wieder auf', async () => {
    const { server } = world();
    const pc = new Device(server);
    pc.data.library = books(5);
    await pc.sync();
    const fresh = world(); // Datenordner verloren
    pc.server = fresh.server;
    await pc.sync();
    expect((fresh.server.store.sync('ich', { since: 0, changes: [] }).body as SyncResponse).counts.library).toBe(5);
    expect(Object.keys(pc.data.library)).toHaveLength(5);
  });

  it('teilt sich bei gleichzeitigen Aufrufen einen Lauf', async () => {
    const { server } = world();
    const pc = new Device(server);
    pc.data.library = books(3);
    const [a, b] = await Promise.all([pc.sync(), pc.sync()]);
    expect(a).toBe(b);
    expect(pc.engine.pendingCount()).toBe(0);
  });

  it('übernimmt keine ungültigen Datensätze vom Server', async () => {
    const { server } = world();
    server.store.sync('ich', { since: 0, changes: [{ c: 'library', id: 'gr:1', at: 5, v: { id: 'falsch' } }, { c: 'settings', id: 'region', at: 5, v: 42 }] });
    const pc = new Device(server);
    await pc.sync();
    expect(pc.get('gr:1')).toBeUndefined();
    expect(pc.data.settings.region).toBe('CH');
  });
});
