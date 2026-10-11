import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookKind, buildQueryPlans, DEFAULT_PARAMS, describeSearch, interpretWish, runDiscovery, scoreBook, type DiscoveryParams } from '../src/lib/discovery';
import { pickLookup } from '../src/lib/lookup';
import type { OLAuthorDoc } from '../src/lib/openLibrary';
import { contentWords, editDistance, similarWord } from '../src/lib/text';
import { book } from './helpers';

const dostoevsky: OLAuthorDoc = {
  key: 'OL22242A',
  name: 'Fiódor Dostoievski',
  alternate_names: ['Фёдор Миха́йлович Достое́вский', 'Dostoevesky', 'Dostoevski', 'Dostoevskii', 'Dostoevskij'],
  work_count: 2822,
};
const duplicate: OLAuthorDoc = { key: 'OL16224933A', name: 'Fyodor Dostoevsky', work_count: 11 };
const untergrund = book({ id: 'OL24249321W', title: 'Aufzeichnungen aus dem Untergrund', authors: ['Фёдор Михайлович Достоевский'], authorKeys: ['OL22242A'] });
const spieler = book({ id: 'OL9055831W', title: 'Der Spieler. Späte Romane und Novellen', authors: ['Фёдор Михайлович Достоевский'], authorKeys: ['OL22242A'] });
const biography = book({ id: 'OL1191597W', title: 'Fyodor Dostoevsky', authors: ['John Arthur Thomas Lloyd'], authorKeys: ['OL1A'] });

describe('Schreibvarianten', () => {
  it('erkennt Namen in anderer Umschrift, aber keine zufälligen Wörter', () => {
    expect(editDistance('dostoevsky', 'dostoevski')).toBe(1);
    expect(similarWord('dostojewski', 'dostoievski')).toBe(true);
    expect(similarWord('fyodor', 'fiodor')).toBe(true);
    expect(similarWord('schatten', 'schattenberg')).toBe(false);
    expect(similarWord('wolf', 'woolf')).toBe(false);
  });
});

describe('Buch oder Autor:in im Wunsch erkennen', () => {
  it('findet Titel und Autor aus „Aufzeichnungen aus dem Untergrund Fyodor Dostoevsky“', () => {
    const query = contentWords('Aufzeichnungen aus dem Untergrund Fyodor Dostoevsky');
    const found = pickLookup(query, [spieler, untergrund], [duplicate, dostoevsky]);
    expect(found.book?.id).toBe('OL24249321W');
    expect(found.author?.key).toBe('OL22242A'); // die „echte“ Autorin mit den meisten Werken, nicht die Dublette
    expect(found.consumed.sort()).toEqual(['aufzeichnungen', 'dostoevsky', 'fyodor', 'untergrund']);
    expect(found.authorWords).toEqual(['fyodor', 'dostoevsky']);
  });

  it('hält „Fyodor Dostoevsky“ für die Autorin, nicht für das gleichnamige Buch über sie', () => {
    const found = pickLookup(contentWords('Fyodor Dostoevsky'), [biography], [dostoevsky]);
    expect(found.book).toBeUndefined();
    expect(found.author?.key).toBe('OL22242A');
  });

  it('hält „Wolf Hall“ für ein Buch, nicht für Christa Wolf', () => {
    const wolfHall = book({ id: 'OL2W', title: 'Wolf Hall', authors: ['Hilary Mantel'], authorKeys: ['OL9A'] });
    const found = pickLookup(contentWords('Wolf Hall'), [wolfHall], [{ key: 'OL7A', name: 'Christa Wolf', work_count: 80 }]);
    expect(found.book?.id).toBe('OL2W');
    expect(found.author).toBeUndefined();
  });

  it('nimmt weder Organisationen noch Allerweltswörter als Autor:in', () => {
    const org: OLAuthorDoc = { key: 'OL5A', name: 'Gesellschaft für Deutsch-Sowjetische Freundschaft', work_count: 300 };
    expect(pickLookup(contentWords('Roman über Freundschaft'), [], [org]).author).toBeUndefined();
    const mankell: OLAuthorDoc = { key: 'OL45364A', name: 'Henning Mankell', work_count: 400 };
    // In einem beschreibenden Wunsch zählt ein Name nur mit „von“ oder mit Vor- und Nachname
    expect(pickLookup(['krimi', 'mankell'], [], [mankell], { books: false, cues: [] }).author).toBeUndefined();
    expect(pickLookup(['krimi', 'mankell'], [], [mankell], { books: false, cues: ['mankell'] }).author?.key).toBe('OL45364A');
    expect(pickLookup(['krimi', 'henning', 'mankell'], [], [mankell], { books: false, cues: [] }).author?.key).toBe('OL45364A');
  });

  it('macht aus einem einzelnen Wort nur bei bekannten Werken einen Buchtitel', () => {
    const obscure = book({ id: 'OL3W', title: 'Der Leuchtturm', editionCount: 1 });
    const famous = book({ id: 'OL4W', title: 'Schachnovelle', editionCount: 120 });
    expect(pickLookup(['leuchtturm'], [obscure], []).book).toBeUndefined();
    expect(pickLookup(['schachnovelle'], [famous], []).book?.id).toBe('OL4W');
    expect(pickLookup(['schachnovelle'], [famous], [], { books: false }).book).toBeUndefined();
  });
});

describe('Konkrete Suche statt Geschmacks-Füllmaterial', () => {
  const lookup = { book: untergrund, author: { key: 'OL22242A', name: 'Fiódor Dostoievski', workCount: 2822 }, consumed: ['aufzeichnungen', 'untergrund', 'fyodor', 'dostoevsky'], authorWords: ['fyodor', 'dostoevsky'] };
  const wish = { ...interpretWish('Aufzeichnungen aus dem Untergrund Fyodor Dostoevsky'), keywords: [], found: { title: untergrund.title, author: 'Fyodor Dostoevsky' } };
  const params: DiscoveryParams = { ...DEFAULT_PARAMS, wish: 'Aufzeichnungen aus dem Untergrund Fyodor Dostoevsky' };
  const profile = { topConcepts: [1, 2, 3].map((i) => ({ label: `x${i}` })), querySubjects: ['fantasy', 'magic', 'dragons'] } as never;

  it('sucht nach der Autor:in und nie nur „irgendwas auf Deutsch“ oder nach dem Geschmack', () => {
    const plans = buildQueryPlans(params, { wish, lookup, profile });
    expect(plans[0].q).toContain('author_key:"OL22242A"');
    expect(plans.some((p) => p.q.trim() === 'language:ger')).toBe(false);
    expect(plans.some((p) => p.label === 'Dein Geschmack')).toBe(false);
    expect(describeSearch(params, wish).slice(0, 2)).toEqual(['📖 „Aufzeichnungen aus dem Untergrund“ und Ähnliches', '✍️ mehr von Fyodor Dostoevsky']);
  });

  it('bewertet Bücher der Autor:in hoch und Unpassendes schwach', () => {
    const crime = book({ id: 'OL5W', title: 'Schuld und Sühne', authors: ['Fiódor Dostoievski'], authorKeys: ['OL22242A'], languages: ['ger'], subjects: ['Fiction', 'Murder'] });
    const fantasy = book({ id: 'OL6W', title: 'Der Weg der Könige', authors: ['Brandon Sanderson'], authorKeys: ['OL8A'], languages: ['ger'], subjects: ['Fantasy fiction'], rating: 4.6, ratingsCount: 500 });
    const ctx = { wish, lookup, similar: [{ id: untergrund.id, title: untergrund.title, authors: untergrund.authors, authorKeys: ['OL22242A'], subjects: ['Fiction', 'Russian literature'] }] };
    const good = scoreBook(crime, params, ctx)!;
    const bad = scoreBook(fantasy, params, ctx)!;
    expect(good.match).toBeGreaterThanOrEqual(80);
    expect(good.weak).toBeFalsy();
    expect(bad.weak).toBe(true);
    expect(bad.match).toBeLessThanOrEqual(30);
    expect(bad.score).toBeLessThan(good.score - 500);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('stellt das gesuchte Buch an den Anfang und lässt Unpassendes weg', async () => {
    const doc = (key: string, title: string, author: string, authorKey: string, subject: string[]) => ({
      key: `/works/${key}`, title, author_name: [author], author_key: [authorKey], subject, language: ['ger'], cover_i: 1, edition_count: 5,
    });
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          numFound: 2,
          docs: [doc('OL5W', 'Schuld und Sühne', 'Fiódor Dostoievski', 'OL22242A', ['Fiction']), doc('OL6W', 'Der Weg der Könige', 'Brandon Sanderson', 'OL8A', ['Fantasy fiction'])],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await runDiscovery(params, { wish, lookup, similar: [] });
    expect(res.results[0].book.id).toBe('OL24249321W');
    expect(res.results[0].match).toBe(99);
    expect(res.results.map((r) => r.book.title)).toEqual(['Aufzeichnungen aus dem Untergrund', 'Schuld und Sühne']);
    // Der Name erscheint so, wie er gesucht wurde
    expect(res.results.every((r) => r.book.authors[0] === 'Fyodor Dostoevsky')).toBe(true);
  });
});

describe('Roman oder Sachbuch', () => {
  it('erkennt den Wunsch nach einem Roman', () => {
    expect(interpretWish('ein ruhiger Roman über Freundschaft').fiction).toBe(true);
    expect(interpretWish('ein Liebesroman für den Urlaub').fiction).toBe(true);
    expect(interpretWish('Sachbuch über Bienen').fiction).toBeFalsy();
  });

  it('unterscheidet anhand der Schlagwörter', () => {
    expect(bookKind(book({ id: 'a', title: 'x', subjects: ['Chess', 'Fiction'] }))).toBe('fiction');
    expect(bookKind(book({ id: 'b', title: 'x', subjects: ['National socialism', 'Germany, politics and government'] }))).toBe('nonfiction');
    expect(bookKind(book({ id: 'c', title: 'x', subjects: ['Rome, history, Roman Empire'] }))).toBe('nonfiction');
    expect(bookKind(book({ id: 'd', title: 'x' }))).toBe('unknown');
  });

  it('zeigt bei einem Roman-Wunsch keine Sachbücher und findet zu Romanen keine Sachbücher als „ähnlich“', () => {
    const params = { ...DEFAULT_PARAMS, wish: 'ein Roman über Freundschaft' };
    const essay = book({ id: 'e', title: 'Freundschaft zweier Völker', subjects: ['Foreign relations', 'Friendship'], languages: ['ger'] });
    expect(scoreBook(essay, params, { wish: interpretWish(params.wish) })).toBeUndefined();

    const ref = { id: 'r', title: 'Schachnovelle', authors: ['Stefan Zweig'], subjects: ['Chess', 'Fiction', 'Nazis', 'World War, 1939-1945', 'Austria'] };
    const history = book({ id: 'h', title: 'Geschichte', authors: ['Jemand'], languages: ['ger'], subjects: ['Nazis', 'World War, 1939-1945', 'Austria', 'History'] });
    const novel = book({ id: 'n', title: 'Roman', authors: ['Jemand'], languages: ['ger'], subjects: ['Nazis', 'World War, 1939-1945', 'Austria', 'Fiction'] });
    const p = { ...DEFAULT_PARAMS, similarTo: [ref] };
    expect(scoreBook(novel, p, {})!.weak).toBeFalsy();
    expect(scoreBook(history, p, {})!.weak).toBe(true);
  });
});
