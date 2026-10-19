import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artworkUrl, BookInfoStore, cleanDescription, matches } from '../server/bookInfo';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'lk-buchinfo-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const art = 'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/57/f4/9783641272838.jpg/100x100bb.jpg';
const apple = (results: unknown[]) => new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200, headers: { 'content-type': 'text/javascript' } });

describe('Apple Books: Cover und Verlagstexte', () => {
  it('nimmt nur Treffer, deren Titel und Autor:in wirklich passen', () => {
    expect(matches({ trackName: 'Der Astronaut', artistName: 'Andy Weir' }, 'Der Astronaut', 'Andy Weir')).toBe(true);
    expect(matches({ trackName: 'Der Marsianer', artistName: 'Andy Weir' }, 'Der Astronaut', 'Andy Weir')).toBe(false);
    expect(matches({ trackName: 'Der Astronaut', artistName: 'Jemand Anderes' }, 'Der Astronaut', 'Andy Weir')).toBe(false);
    expect(matches({ trackName: 'Harry Potter und die Kammer des Schreckens', artistName: 'J.K. Rowling' }, 'Harry Potter und der Stein der Weisen', 'J. K. Rowling')).toBe(false);
  });

  it('macht aus dem Verlagstext lesbaren Text und skaliert das Cover', () => {
    expect(cleanDescription('Ein Roman.<br />Über <b>Mut</b> &amp; Freundschaft – und noch viel mehr, was hier steht, damit es lang genug ist für einen Text.')).toBe(
      'Ein Roman.\nÜber Mut & Freundschaft – und noch viel mehr, was hier steht, damit es lang genug ist für einen Text.',
    );
    expect(artworkUrl('https://x/y.jpg/{w}x{h}bb.jpg', 400)).toBe('https://x/y.jpg/400x640bb.jpg');
  });

  it('schlägt jedes Buch nur einmal nach und merkt sich auch „nicht gefunden“', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('Astronaut')) return apple([{ kind: 'ebook', trackName: 'Der Astronaut', artistName: 'Andy Weir', artworkUrl100: art, description: 'Ryland Grace erwacht allein auf einem Raumschiff und weiss nicht mehr, wer er ist – nur, dass die Menschheit auf ihn zählt.' }]);
      return apple([]);
    }) as typeof fetch;
    const store = new BookInfoStore(dir, { fetchFn, gapMs: 0 });
    const hit = await store.resolve('Der Astronaut', 'Andy Weir', { wait: true });
    expect(hit?.artwork).toBe('https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/57/f4/9783641272838.jpg/{w}x{h}bb.jpg');
    expect(hit?.description).toContain('Ryland Grace');
    await store.resolve('Der Astronaut', 'Andy Weir', { wait: true });
    expect(urls).toHaveLength(1); // aus dem Speicher
    const miss = await store.resolve('Gibt es nicht', 'Niemand', { wait: true });
    expect(miss?.artwork).toBeUndefined();
    expect(urls).toHaveLength(3); // Schweiz und Deutschland versucht
    await store.resolve('Gibt es nicht', 'Niemand', { wait: true });
    expect(urls).toHaveLength(3);
    store.flush();
    // nach einem Neustart noch da
    expect(new BookInfoStore(dir, { fetchFn, gapMs: 0 }).cached('Der Astronaut', 'Andy Weir')?.artwork).toBeDefined();
  });

  it('wartet bei Drosselung und merkt sich dann nichts Falsches', async () => {
    const fetchFn = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const store = new BookInfoStore(dir, { fetchFn, gapMs: 0 });
    const r = await store.resolve('Der Astronaut', 'Andy Weir', { wait: true });
    expect(r?.artwork).toBeUndefined();
    expect(store.cached('Der Astronaut', 'Andy Weir')).toBeUndefined();
  });
});
