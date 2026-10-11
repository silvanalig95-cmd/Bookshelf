import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncInputError, SyncStore, syncFileName } from '../server/syncStore';
import type { SyncChange, SyncResponse } from '../src/lib/syncProtocol';

function setup(start = Date.UTC(2026, 9, 1, 12)) {
  const dir = mkdtempSync(join(tmpdir(), 'lesekompass-sync-'));
  let now = start;
  const store = new SyncStore(dir, () => now);
  const ok = (user: string | null, body: unknown): SyncResponse => {
    const r = store.sync(user, body);
    if (r.status !== 200) throw new Error('unerwartet: anderer Datenbestand');
    return r.body;
  };
  return { dir, store, ok, advance: (ms: number) => (now += ms), now: () => now };
}

const book = (id: string, title: string, at: number, extra: Record<string, unknown> = {}): SyncChange => ({
  c: 'library',
  id,
  at,
  v: { id, title, authors: ['A'], shelf: 'read', rating: 0, ...extra },
});

describe('SyncStore', () => {
  it('nimmt Neues an und liefert es anderen Geräten, ohne es dem Absender zurückzuschicken', () => {
    const { ok } = setup();
    const a = ok(null, { since: 0, changes: [book('gr:1', 'Eins', 100), book('gr:2', 'Zwei', 100)] });
    expect(a.accepted).toBe(2);
    expect(a.changes).toEqual([]);
    expect(a.rev).toBe(2);
    expect(a.counts.library).toBe(2);
    const b = ok(null, { since: 0, changes: [] });
    expect(b.changes.map((c) => c.id).sort()).toEqual(['gr:1', 'gr:2']);
    expect(ok(null, { since: b.rev, changes: [] }).changes).toEqual([]);
  });

  it('behält pro Datensatz die jüngere Änderung und meldet dem Verlierer die gültige Fassung', () => {
    const { ok } = setup();
    ok(null, { since: 0, changes: [book('gr:1', 'Neu', 200)] });
    const late = ok(null, { since: 1, changes: [book('gr:1', 'Alt', 150)] });
    expect(late.accepted).toBe(0);
    expect(late.changes).toEqual([book('gr:1', 'Neu', 200)]);
    // Gleichstand: was schon da ist, bleibt
    const tie = ok(null, { since: 1, changes: [book('gr:1', 'Gleich alt', 200)] });
    expect(tie.changes[0].v).toMatchObject({ title: 'Neu' });
  });

  it('gibt Löschungen als Markierung weiter', () => {
    const { ok } = setup();
    ok(null, { since: 0, changes: [book('gr:1', 'Eins', 100)] });
    ok(null, { since: 1, changes: [{ c: 'library', id: 'gr:1', at: 300, d: true }] });
    const other = ok(null, { since: 1, changes: [] });
    expect(other.changes).toEqual([{ c: 'library', id: 'gr:1', at: 300, d: true }]);
    expect(other.counts.library).toBe(0);
  });

  it('zählt unveränderte Inhalte nicht als neue Revision', () => {
    const { ok } = setup();
    ok(null, { since: 0, changes: [book('gr:1', 'Eins', 100)] });
    const again = ok(null, { since: 1, changes: [book('gr:1', 'Eins', 500)] });
    expect(again.accepted).toBe(1);
    expect(again.rev).toBe(1);
    // Der neuere Zeitstempel zählt trotzdem
    expect(ok(null, { since: 1, changes: [book('gr:1', 'Anders', 400)] }).accepted).toBe(0);
  });

  it('lässt Zeitstempel aus der Zukunft nicht ewig gewinnen', () => {
    const { ok, now } = setup();
    ok(null, { since: 0, changes: [book('gr:1', 'Falsche Uhr', now() + 365 * 86_400_000)] });
    const fixed = ok(null, { since: 1, changes: [book('gr:1', 'Richtig', now() + 1000)] });
    expect(fixed.accepted).toBe(1);
  });

  it('trennt die Daten pro Login und speichert sie dauerhaft', () => {
    const { dir, ok } = setup();
    ok('ich', { since: 0, changes: [book('gr:1', 'Meins', 100)] });
    ok('partner', { since: 0, changes: [book('gr:2', 'Deins', 100)] });
    expect(ok('ich', { since: 0, changes: [] }).changes.map((c) => c.id)).toEqual(['gr:1']);
    expect(ok(null, { since: 0, changes: [] }).changes).toEqual([]);
    expect(existsSync(join(dir, `${syncFileName('ich')}.json`))).toBe(true);

    const reopened = new SyncStore(dir);
    const r = reopened.sync('partner', { since: 0, changes: [] });
    expect(r.status === 200 && r.body.changes.map((c) => c.id)).toEqual(['gr:2']);
  });

  it('bildet sichere, eindeutige Dateinamen', () => {
    expect(syncFileName(null)).toBe('gemeinsam');
    expect(syncFileName('Silvan')).toMatch(/^login-silvan-[0-9a-f]{8}$/);
    expect(syncFileName('../../etc/passwd')).toMatch(/^login-_etc_passwd-[0-9a-f]{8}$/);
    expect(syncFileName('silvan')).not.toBe(syncFileName('Silvan'));
  });

  it('meldet einen anderen Datenbestand und ob er leer ist', () => {
    const { store, ok } = setup();
    const first = ok('ich', { since: 0, changes: [] });
    const other = store.sync('ich', { serverId: 'etwas-anderes', since: 5, changes: [book('gr:1', 'X', 1)] });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ ok: false, serverId: first.serverId, user: 'ich', empty: true });
    // Die Änderungen aus der abgelehnten Anfrage wurden nicht übernommen
    expect(ok('ich', { since: 0, changes: [] }).changes).toEqual([]);
  });

  it('schickt alles, wenn ein Gerät eine neuere Revision kennt als der Server', () => {
    const { ok } = setup();
    ok(null, { since: 0, changes: [book('gr:1', 'Eins', 100)] });
    expect(ok(null, { since: 99, changes: [] }).changes).toHaveLength(1);
  });

  it('legt täglich eine Sicherung an und behält 14', () => {
    const { dir, ok, advance } = setup();
    for (let day = 0; day < 20; day++) {
      ok('ich', { since: 0, changes: [book('gr:1', `Tag ${day}`, 1000 + day)] });
      ok('ich', { since: 0, changes: [book('gr:1', `Tag ${day} später`, 2000 + day)] });
      advance(86_400_000);
    }
    const backups = readdirSync(join(dir, 'sicherungen'));
    expect(backups).toHaveLength(14);
    expect(backups.every((f) => f.startsWith(syncFileName('ich')))).toBe(true);
  });

  it('weist kaputte Anfragen ab und ignoriert gefährliche IDs', () => {
    const { store, ok } = setup();
    expect(() => store.sync(null, 'quatsch')).toThrow(SyncInputError);
    expect(() => store.sync(null, { since: -1, changes: [] })).toThrow(SyncInputError);
    expect(() => store.sync(null, { since: 0, changes: [{ c: 'passwoerter', id: 'x', at: 1, v: 1 }] })).toThrow(/Unbekannte Sammlung/);
    expect(() => store.sync(null, { since: 0, changes: [{ c: 'library', id: 'x', at: 1 }] })).toThrow(/ohne Inhalt/);
    expect(() => store.sync(null, { since: 0, changes: [{ c: 'library', id: 'x', at: 1, v: 'x'.repeat(300_000) }] })).toThrow(/zu gross/);
    const r = ok(null, { since: 0, changes: [{ c: 'library', id: '__proto__', at: 1, v: { polluted: true } }] });
    expect(r.accepted).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('überschreibt eine beschädigte Datei nie', () => {
    const { dir } = setup();
    const file = join(dir, `${syncFileName('ich')}.json`);
    writeFileSync(file, '{ kaputt');
    const store = new SyncStore(dir);
    expect(() => store.sync('ich', { since: 0, changes: [book('gr:1', 'X', 1)] })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{ kaputt');
  });
});
