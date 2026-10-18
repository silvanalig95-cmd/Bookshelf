import { describe, expect, it } from 'vitest';
import { buildQueryPlans, DEFAULT_PARAMS, describeSearch, effectiveParams, interpretWish, isRareKind, limitRare, mergeBooks, scoreBook, type DiscoveryParams } from '../src/lib/discovery';
import { buildReadIndex } from '../src/store/library';
import { book, entry } from './helpers';

const params = (patch: Partial<DiscoveryParams>): DiscoveryParams => ({ ...DEFAULT_PARAMS, ...patch });

describe('Wunsch verstehen', () => {
  it('erkennt Genre, Stimmung und Ort – ohne Füllwörter', () => {
    const w = interpretWish('ein düsterer Krimi, der in Skandinavien spielt');
    expect(w.genres).toContain('krimi');
    expect(w.moods).toContain('duester');
    expect(w.places).toContain('skandinavien');
    expect(w.keywords).not.toContain('spielt');
  });

  it('liest „wie <Titel>“, Länge, Bekanntheit und Ausschlüsse', () => {
    const w = interpretWish('Etwas wie Der Schatten des Windes, aber kurz und eher ein Geheimtipp, ohne Vampire');
    expect(w.similarTitles).toContain('Der Schatten des Windes');
    expect(w.pagesMax).toBe(280);
    expect(w.fame).toBe(-2);
    expect(w.excludeWords).toContain('vampire');
    expect(w.genres).not.toContain('horror');
  });

  it('macht aus „ohne Romanze“ einen Genre-Ausschluss', () => {
    const w = interpretWish('Fantasy ohne Romanze');
    expect(w.genres).toEqual(['fantasy']);
    expect(w.excludeGenres).toContain('liebe');
    const p = effectiveParams(params({}), w);
    expect(p.excludeGenres).toContain('liebe');
    expect(p.genres).not.toContain('liebe');
  });

  it('übernimmt den Wunsch in die Parameter', () => {
    const p = effectiveParams(params({ genres: ['fantasy'] }), interpretWish('lustig und skurril'));
    expect(p.genres).toEqual(expect.arrayContaining(['fantasy', 'humor']));
    expect(p.moods).toEqual(expect.arrayContaining(['humorvoll', 'skurril']));
  });
});

describe('Anfragen planen', () => {
  it('baut Solr-Anfragen mit Sprache, Genre, Ort und Zeitraum', () => {
    const plans = buildQueryPlans(params({ genres: ['krimi'], moods: ['duester'], places: ['skandinavien'], yearFrom: 1990, pagesMax: 400 }));
    const q = plans[0].q;
    expect(q).toContain('subject:("detective and mystery stories"');
    expect(q).toContain('place:("Sweden"');
    expect(q).toContain('first_publish_year:[1990 TO *]');
    expect(q).toContain('number_of_pages_median:[* TO 400]');
    expect(q).toContain('language:ger');
    expect(plans.some((p) => !p.q.includes('language:ger'))).toBe(true); // auch Originale
    expect(plans.length).toBeLessThanOrEqual(7);
  });

  it('fällt ohne Kriterien auf beliebte deutsche Bücher zurück', () => {
    const plans = buildQueryPlans(params({}));
    expect(plans).toHaveLength(1);
    expect(plans[0].q).toContain('language:ger');
  });

  it('schliesst Genres und Wörter aus', () => {
    const q = buildQueryPlans(params({ genres: ['fantasy'], excludeGenres: ['liebe'], excludeWords: ['vampire'] }))[0].q;
    expect(q).toContain('-subject:"love stories"');
    expect(q).toContain('-"vampire"');
  });
});

describe('Bewerten', () => {
  const krimi = book({ id: 'OL1W', title: 'Die falsche Fährte', subjects: ['Detective and mystery stories', 'Murder', 'Police'], places: ['Sweden'], languages: ['ger', 'swe'], rating: 4.2, ratingsCount: 30, coverId: 1 });
  const romance = book({ id: 'OL2W', title: 'Liebe in Paris', subjects: ['Love stories', 'Romance'], places: ['Paris'], languages: ['eng'], coverId: 2 });

  it('bewertet passende Bücher höher und begründet', () => {
    const p = params({ genres: ['krimi'], places: ['skandinavien'] });
    const a = scoreBook(krimi, p)!;
    const b = scoreBook(romance, p)!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.match).toBeGreaterThan(b.match);
    expect(a.reasons.map((r) => r.kind)).toEqual(expect.arrayContaining(['genre', 'place', 'german']));
  });

  it('filtert Ausschlüsse, „nur Deutsch“ und Gelesenes', () => {
    expect(scoreBook(krimi, params({ excludeWords: ['murder'] }))).toBeUndefined();
    expect(scoreBook(romance, params({ language: 'de-only' }))).toBeUndefined();
    const readIndex = buildReadIndex({ x: entry({ id: 'x', title: 'Die falsche Fährte', authors: ['Jemand'] }) });
    expect(scoreBook(krimi, params({}), { readIndex })).toBeUndefined();
    expect(scoreBook(krimi, params({ hideRead: false }), { readIndex })?.alreadyRead).toBe(true);
  });

  it('wertet Sammelbände mit sehr vielen Schlagwörtern ab', () => {
    const omnibus = { ...krimi, id: 'OL3W', subjects: [...krimi.subjects, ...Array.from({ length: 200 }, (_, i) => `Topic ${i}`)] };
    const p = params({ genres: ['krimi'], places: ['skandinavien'] });
    expect(scoreBook(omnibus, p)!.score).toBeLessThan(scoreBook(krimi, p)!.score);
  });
});

describe('Zusammenführen & Beschreiben', () => {
  it('führt dasselbe Werk aus mehreren Quellen zusammen', () => {
    const a = book({ id: 'OL1W', title: 'Der Schatten des Windes', authors: ['Carlos Ruiz Zafón'], editionCount: 99, languages: ['spa'] });
    const b = book({ id: 'gb:x', title: 'Der Schatten des Windes', authors: ['Carlos Ruiz Zafón'], description: 'Barcelona 1945 …', languages: ['ger'], source: 'google' });
    const merged = mergeBooks([[a], [b]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('OL1W');
    expect(merged[0].description).toBe('Barcelona 1945 …');
    expect(merged[0].languages).toEqual(expect.arrayContaining(['spa', 'ger']));
  });

  it('fasst die Suche lesbar zusammen', () => {
    const bits = describeSearch(params({ genres: ['krimi'], moods: ['duester'], places: ['skandinavien'], pagesMax: 300 }));
    expect(bits).toEqual(expect.arrayContaining(['Krimi', 'düster', 'spielt in Skandinavien', 'unter 300 Seiten']));
  });
});

describe('Ältere und wenig bekannte Bücher sind die Ausnahme', () => {
  const book = (id: string, year: number, popularity: number) => ({ book: { id, title: id, authors: ['A'], subjects: [], languages: [], year, popularity, ratingsCount: popularity / 10, editionCount: 5, source: 'openlibrary' as const } });
  it('lässt unter den ersten Plätzen nur wenige ältere oder obskure Bücher', () => {
    const list = [book('alt1', 1952, 3000), book('obskur1', 2015, 2), book('neu1', 2018, 3000), book('alt2', 1960, 3000), book('neu2', 2010, 900), book('obskur2', 2020, 1), book('neu3', 2021, 500)];
    expect(isRareKind(list[0].book)).toBe(true);
    expect(isRareKind(list[2].book)).toBe(false);
    const ordered = limitRare(list, 0.15, 7).map((x) => x.book.id);
    expect(ordered.slice(0, 4)).toEqual(['alt1', 'neu1', 'neu2', 'neu3']);
    expect(ordered).toHaveLength(7); // nichts geht verloren, es rutscht nur nach hinten
  });
});
