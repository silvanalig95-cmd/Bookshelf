import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlurbStore } from '../server/blurbStore';
import { cleanReport, KnowledgeStore } from '../server/knowledge';
import { BLURB_INSTRUCTIONS as SERVER_INSTRUCTIONS, NightShift } from '../server/nightShift';
import { SyncStore } from '../server/syncStore';
import { BLURB_INSTRUCTIONS } from '../src/lib/aiPrompts';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'lk-wissen-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rep = (id: string, event: 'seen' | 'opened', fame = 2.5) => ({ id, title: `Buch ${id}`, authors: ['Autorin'], subjects: ['Fiction'], fame, event });

describe('Wissensspeicher', () => {
  it('nimmt nur Brauchbares an', () => {
    const clean = cleanReport({ books: [rep('OL1W', 'seen'), { id: 'ai:x', title: 'KI', event: 'seen' }, { id: 'OL2W', event: 'seen' }, { id: '../etc', title: 'x', event: 'seen' }] });
    expect(clean.map((b) => b.id)).toEqual(['OL1W']);
  });

  it('zählt Sichtungen und Öffnungen, merkt sich Bücher und Gelerntes – auch über einen Neustart', () => {
    const k = new KnowledgeStore(dir, () => 1000);
    k.report('anna', [rep('OL1W', 'seen'), rep('OL1W', 'seen'), rep('OL1W', 'opened')]);
    k.learn('OL1W', ['Magical realism'], 'gemini-3.5-flash-lite');
    k.flush();
    const again = new KnowledgeStore(dir);
    expect(again.stats('anna').OL1W).toMatchObject({ seen: 2, opened: 1 });
    expect(again.learnedSubjects()).toEqual({ OL1W: ['Magical realism'] });
    expect(again.summary('anna')).toEqual({ books: 1, learned: 1, seen: 1, opened: 1 });
    expect(again.stats('bert')).toEqual({});
  });

  it('lernt aus dem Verhalten, wie bekannt die Vorschläge sein sollen', () => {
    const k = new KnowledgeStore(dir);
    // Geöffnet werden die bekannteren, übergangen die unbekannten
    for (let i = 0; i < 12; i++) k.report(null, [rep(`OL${i}W`, 'opened', 3.2)]);
    for (let i = 20; i < 32; i++) k.report(null, [rep(`OL${i}W`, 'seen', 1.6), rep(`OL${i}W`, 'seen', 1.6)]);
    const t = k.tuning(null);
    expect(t.fameShift).toBeGreaterThan(0.3);
    // Ausgeblendetes zählt auch
    const k2 = new KnowledgeStore(join(dir, 'b'));
    for (let i = 0; i < 12; i++) k2.report(null, [rep(`OL${i}W`, 'opened', 1.5)]);
    for (let i = 20; i < 32; i++) k2.report(null, [rep(`OL${i}W`, 'seen', 3.5)]);
    const hidden = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`OL${i + 20}W`, { verdict: 'hide' }]));
    expect(k2.tuning(null, hidden).fameShift).toBeLessThan(-0.3);
    // Zu wenig Beobachtungen: nichts verändern
    expect(new KnowledgeStore(join(dir, 'c')).tuning(null).fameShift).toBe(0);
  });
});

describe('Nachtschicht mit Wissensspeicher', () => {
  it('schreibt denselben Auftrag für Kurzbeschreibungen wie die App', () => {
    expect(SERVER_INSTRUCTIONS).toEqual(BLURB_INSTRUCTIONS);
  });

  it('beschreibt zuerst geöffnete Bücher, verschlagwortet dann Gesehenes und beschreibt es', async () => {
    const sync = new SyncStore(dir);
    const blurbs = new BlurbStore(dir);
    const knowledge = new KnowledgeStore(dir);
    knowledge.report(null, [rep('OL5W', 'seen'), rep('OL6W', 'seen'), rep('OL7W', 'seen'), rep('OL8W', 'seen'), rep('OL9W', 'opened')]);
    sync.sync(null, { since: 0, changes: [{ c: 'signals', id: 'OL8W', at: 1, v: { bookId: 'OL8W', title: 'Buch OL8W', authors: [], subjects: [], verdict: 'hide', at: '2026-10-01' } }] });
    const prompts: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (!String(url).includes('generativelanguage')) return new Response('{}', { status: 404 });
      const prompt = (JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
      prompts.push(prompt);
      const text = prompt.includes('Schlagwörter im Stil') ? JSON.stringify({ books: [1, 2, 3].map((nr) => ({ nr, subjects: ['Satire'] })) }) : 'Worum es geht … Passt zu dir, weil …';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }) as typeof fetch;
    let now = Date.parse('2026-10-17T20:30:00Z');
    const shift = new NightShift({ dir, geminiKey: 'k', users: [null], sync, blurbs, knowledge, fetchFn, clock: () => now, sleep: async (ms) => void (now += ms), paceMs: 0 });
    await shift.tick();
    expect(prompts[0]).toContain('Buch OL9W'); // geöffnet → zuerst
    expect(blurbs.get(null, 'OL9W')).toBeDefined();
    expect(knowledge.book('OL5W')?.learned?.subjects).toEqual(['Satire']);
    expect(blurbs.get(null, 'OL5W')).toBeDefined(); // gesehen → Kurzbeschreibung auf Vorrat
    expect(blurbs.get(null, 'OL8W')).toBeUndefined(); // ausgeblendet → nicht
    expect(shift.getStatus()).toMatchObject({ state: 'done', reason: 'tasks' });
  });
});
