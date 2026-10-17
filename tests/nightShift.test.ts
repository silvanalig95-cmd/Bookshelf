import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlurbStore } from '../server/blurbStore';
import { inNightWindow, LIGHT_CHAIN, NightShift, nightWindow, quotaKind } from '../server/nightShift';
import { SyncStore } from '../server/syncStore';

const ZH = 'Europe/Zurich';

describe('Nachtschicht: Zeitfenster', () => {
  it('läuft von 22 Uhr bis zum Tageswechsel bei Google (9 Uhr Schweizer Zeit)', () => {
    const t = Date.parse('2026-10-17T20:30:00Z'); // 22:30 in Zürich
    const w = nightWindow(t, 22, ZH);
    expect(new Date(w.start).toISOString()).toBe('2026-10-17T20:00:00.000Z');
    expect(new Date(w.reset).toISOString()).toBe('2026-10-18T07:00:00.000Z'); // 09:00 in Zürich = Mitternacht in Los Angeles
    expect(w.day).toBe('2026-10-17');
    expect(inNightWindow(t, 22, ZH)).toBe(true);
    expect(inNightWindow(Date.parse('2026-10-18T06:30:00Z'), 22, ZH)).toBe(true); // 08:30
    expect(inNightWindow(Date.parse('2026-10-18T07:30:00Z'), 22, ZH)).toBe(false); // 09:30
    expect(inNightWindow(Date.parse('2026-10-17T12:00:00Z'), 22, ZH)).toBe(false); // 14:00
  });

  it('rechnet richtig, wenn Europa schon Winterzeit hat und die USA noch nicht', () => {
    const t = Date.parse('2026-10-28T21:30:00Z'); // 22:30 MEZ, Los Angeles noch Sommerzeit
    expect(new Date(nightWindow(t, 22, ZH).reset).toISOString()).toBe('2026-10-29T07:00:00.000Z'); // 08:00 MEZ
  });
});

describe('Nachtschicht: Kontingent', () => {
  it('unterscheidet Tages- von Minutenlimit', () => {
    const daily = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    const minute = {
      error: {
        code: 429,
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
        ],
      },
    };
    expect(quotaKind(daily).daily).toBe(true);
    expect(quotaKind(minute)).toEqual({ daily: false, retryMs: 37000 });
  });
});

/* ---------- Ein ganzer Durchlauf ---------- */

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'lk-nacht-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (text: string) => json({ candidates: [{ content: { parts: [{ text: 'Überlege …', thought: true }, { text }] } }] });
const dailyQuota = () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, 429);

function setup(geminiBudget: number) {
  const sync = new SyncStore(dir);
  const blurbs = new BlurbStore(dir);
  const at = Date.parse('2026-10-17T12:00:00Z');
  const entry = (id: string, title: string, author: string, rating: number, shelf: string, extra: Record<string, unknown> = {}) => ({
    c: 'library',
    id,
    at,
    v: { id, title, authors: [author], rating, shelf, source: 'goodreads-csv', subjects: [], ...extra },
  });
  sync.sync(null, {
    since: 0,
    changes: [
      entry('gr:1', 'Der Schatten des Windes', 'Carlos Ruiz Zafón', 5, 'read'),
      entry('gr:2', 'Hundert Jahre Einsamkeit', 'Gabriel García Márquez', 5, 'read'),
      entry('gr:3', 'Die Vermessung der Welt', 'Daniel Kehlmann', 4, 'read'),
      entry('gr:4', 'Der Name der Rose', 'Umberto Eco', 4, 'read'),
      entry('gr:5', 'Shades of Grey', 'E. L. James', 1, 'read'),
      entry('gr:6', 'Das Parfum', 'Patrick Süskind', 0, 'to-read', { workKey: '/works/OL6W' }),
      { c: 'wishlist', id: 'OL7W', at, v: { book: { id: 'OL7W', title: 'Stoner', authors: ['John Williams'], subjects: ['Fiction'] }, addedAt: '2026-10-01' } },
    ],
  });
  const calls: string[] = [];
  let gemini = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes('generativelanguage')) {
      if (++gemini > geminiBudget) return dailyQuota();
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseJsonSchema?: { properties: Record<string, unknown> } } };
      const prompt = body.contents[0].parts[0].text;
      if (prompt.includes('Schlagwörter im Stil')) return answer(JSON.stringify({ books: [1, 2, 3, 4, 5, 6].map((nr) => ({ nr, subjects: ['Magical realism', 'Families'] })) }));
      if (prompt.includes('Lese-Analyse')) return answer('## Was dich anzieht\nMagischer Realismus. [[Die Stadt der Wunder|Eduardo Mendoza]]');
      if (prompt.includes('Schlage 10 Bücher vor')) return answer(JSON.stringify({ books: [{ title: 'Die Stadt der Wunder', author: 'Eduardo Mendoza', why: 'Barcelona wie bei Zafón.' }] }));
      return answer('Worum es geht: eine Geschichte. Passt zu dir, weil …');
    }
    if (String(url).includes('/works/')) return json({ description: 'A novel.' });
    if (String(url).includes('search.json')) {
      return json({ docs: [{ key: '/works/OL99W', title: 'La ciudad de los prodigios', author_name: ['Eduardo Mendoza'], first_publish_year: 1986, cover_i: 5, editions: { docs: [{ title: 'Die Stadt der Wunder', language: ['ger'] }] } }] });
    }
    return json({}, 404);
  }) as typeof fetch;
  let now = Date.parse('2026-10-17T20:30:00Z');
  const shift = new NightShift({ dir, geminiKey: 'k', users: [null], sync, blurbs, fetchFn, clock: () => now, sleep: async (ms) => void (now += ms), paceMs: 7000 });
  return { shift, sync, blurbs, calls, advance: (ms: number) => (now += ms) };
}

describe('Nachtschicht: Durchlauf', () => {
  it('erweitert und analysiert die Bibliothek, bis das Kontingent aller Modelle aufgebraucht ist', async () => {
    const { shift, blurbs, calls } = setup(6);
    await shift.tick();
    const status = shift.getStatus();
    // 1. Kurzbeschreibungen für Merkliste und „Will ich lesen“
    expect(blurbs.get(null, 'OL7W')?.text).toContain('Worum es geht');
    expect(blurbs.get(null, 'OL6W')?.text).toContain('Worum es geht');
    // 2. Schlagwörter für alle sechs Bücher (ein Stapel)
    const results = shift.results(null);
    expect(Object.keys(results.themes)).toHaveLength(6);
    expect(results.themes['gr:1'].subjects).toContain('Magical realism');
    // 3. Analyse
    expect(results.analysis?.text).toContain('Was dich anzieht');
    // 4. Vorschlag – auf Open Library gefunden, mit deutschem Titel und eigener Kurzbeschreibung
    expect(results.suggestions[0]).toMatchObject({ id: 'OL99W', title: 'Die Stadt der Wunder', authors: ['Eduardo Mendoza'], year: 1986, coverId: 5 });
    expect(blurbs.get(null, 'OL99W')).toBeDefined();
    // Danach: alle Modelle erschöpft → fertig für heute
    expect(status).toMatchObject({ state: 'done', reason: 'quota', day: '2026-10-17' });
    expect(status.exhausted.sort()).toEqual([...LIGHT_CHAIN].sort());
    expect(status.made).toMatchObject({ blurbs: 3, themes: 6, analysis: 1, suggestions: 1 });
    // Nicht nochmals in derselben Nacht
    const before = calls.length;
    await shift.tick();
    expect(calls.length).toBe(before);
  });

  it('lässt der App den Vortritt und wartet ausserhalb des Fensters', async () => {
    const { shift, calls, advance } = setup(100);
    shift.noteActivity();
    await shift.tick();
    expect(calls).toHaveLength(0);
    advance(11 * 60_000); // zehn Minuten Ruhe
    advance(12 * 3600_000); // jetzt ist es 10:30 – ausserhalb
    await shift.tick();
    expect(calls).toHaveLength(0);
  });

  it('wartet beim Minutenlimit und versucht es dann nochmals mit demselben Modell', async () => {
    const sync = new SyncStore(dir);
    const blurbs = new BlurbStore(dir);
    let n = 0;
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(String(url));
      if (++n === 1) return json({ error: { code: 429, details: [{ violations: [{ quotaId: 'PerMinute' }] }, { retryDelay: '20s' }] } }, 429);
      return answer('ok');
    }) as typeof fetch;
    let now = 0;
    const slept: number[] = [];
    const shift = new NightShift({ dir, geminiKey: 'k', users: [null], sync, blurbs, fetchFn, clock: () => now, sleep: async (ms) => void (slept.push(ms), (now += ms)), paceMs: 0 });
    const r = await shift.gemini({ system: 's', prompt: 'p', chain: LIGHT_CHAIN, maxTokens: 100 });
    expect(r).toEqual({ text: 'ok', model: LIGHT_CHAIN[0] });
    expect(slept).toContain(20000);
    expect(urls.every((u) => u.includes(LIGHT_CHAIN[0]))).toBe(true);
  });
});

describe('Nachtschicht: nichts mehr zu tun', () => {
  it('hört auf, wenn keine Aufgabe mehr Neues bringt (statt Anfragen zu verschwenden)', async () => {
    const { shift } = setup(100);
    await shift.tick();
    expect(shift.getStatus()).toMatchObject({ state: 'done', reason: 'tasks' });
    expect(shift.getStatus().requests).toBeLessThan(10);
  });
});
