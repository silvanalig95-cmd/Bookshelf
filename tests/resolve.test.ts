import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBook } from '../src/lib/resolve';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const work = (key: string, title: string, author: string, authorKey: string, editions: number, germanTitle?: string) => ({
  key: `/works/${key}`,
  title,
  author_name: [author],
  author_key: [authorKey],
  edition_count: editions,
  language: ['ger', 'rus'],
  editions: germanTitle ? { numFound: 1, start: 0, numFoundExact: true, docs: [{ key: '/books/X', title: germanTitle, language: ['ger'] }] } : undefined,
});

afterEach(() => vi.unstubAllGlobals());

describe('KI-Buchverweise auflösen', () => {
  it('erkennt die Autorin über ihre Schreibvarianten und nimmt das passende Hauptwerk', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/search/authors.json')) {
        return json({ docs: [{ key: 'OL22242A', name: 'Fiódor Dostoievski', alternate_names: ['Dostoevski', 'Dostoevskij'], work_count: 2822 }] });
      }
      return json({
        numFound: 3,
        docs: [
          work('OL1W', 'Verbrechen und Strafe', 'Eberhard Schmidhäuser', 'OL9A', 3, 'Verbrechen und Strafe'), // gleicher Titel, andere Person
          work('OL2W', 'Verbrechen und Strafe', 'Фёдор Михайлович Достоевский', 'OL22242A', 1, 'Verbrechen und Strafe'),
          work('OL166894W', 'Преступление и наказание', 'Фёдор Михайлович Достоевский', 'OL22242A', 1178, 'Verbrechen und Strafe'),
          work('OL3W', 'Der Spieler', 'Фёдор Михайлович Достоевский', 'OL22242A', 300, 'Der Spieler'), // andere Werke zählen nicht
        ],
      });
    });
    const b = await resolveBook('Verbrechen und Strafe', 'Fjodor Dostojewski');
    expect(b?.id).toBe('OL166894W');
    expect(b?.authors[0]).toBe('Fjodor Dostojewski'); // so, wie die KI ihn nennt – nicht kyrillisch
  });

  it('liefert lieber nichts als ein falsches Buch derselben Autorin', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/search/authors.json') ? json({ docs: [] }) : json({ numFound: 1, docs: [work('OL3W', 'Der Spieler', 'Fjodor Dostojewski', 'OL22242A', 300)] }),
    );
    expect(await resolveBook('Die Dämonen', 'Fjodor Dostojewski')).toBeUndefined();
  });
});
