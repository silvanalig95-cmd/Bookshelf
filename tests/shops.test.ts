import { describe, expect, it } from 'vitest';
import { annasArchiveLink, annasArchiveUrl, buildOffers, priceHint } from '../src/lib/shops';

describe('Angebote', () => {
  const base = { title: 'Der Schatten des Windes', author: 'Carlos Ruiz Zafón', annasBase: 'https://annas-archive.gl', language: 'ger' };

  it('zeigt Amazon.de in der Schweiz zuerst und hervorgehoben', () => {
    const groups = buildOffers({ ...base, isbn13: '9783518458006', region: 'CH', preferredShop: 'amazon-de' });
    const first = groups.find((g) => g.kind === 'new')!.links[0];
    expect(first.id).toBe('amazon-de');
    expect(first.featured).toBe(true);
    expect(first.url).toBe('https://www.amazon.de/s?k=9783518458006&i=stripbooks');
    expect(first.note).toContain('Schweiz');
    const shops = groups.find((g) => g.kind === 'new')!.links.map((l) => l.id);
    expect(shops).toEqual(expect.arrayContaining(['orellfuessli', 'exlibris']));
  });

  it('nutzt eurobuch.ch und swisscovery für die Schweiz', () => {
    const groups = buildOffers({ ...base, isbn13: '9783518458006', region: 'CH' });
    const links = groups.flatMap((g) => g.links);
    expect(links.find((l) => l.id === 'eurobuch')!.url).toBe('https://www.eurobuch.ch/buch/isbn/9783518458006.html');
    expect(links.some((l) => l.id === 'swisscovery')).toBe(true);
  });

  it('verlinkt Anna’s Archive gleich nach deutschen Ausgaben gefiltert, dazu ISBN-genau', () => {
    const archive = buildOffers({ ...base, isbn13: '9783518458006', region: 'DE' }).find((g) => g.kind === 'archive')!.links;
    expect(archive.map((l) => l.id)).toEqual(['annas-de', 'annas-isbn', 'annas-all']);
    expect(archive[0].url).toBe('https://annas-archive.gl/search?q=Der+Schatten+des+Windes+Carlos+Ruiz+Zaf%C3%B3n&lang=de');
    expect(archive[1].url).toBe('https://annas-archive.gl/search?q=9783518458006&lang=de');
    expect(archive[2].url).not.toContain('lang=');
    expect(annasArchiveUrl('https://annas-archive.li/', 'a b')).toBe('https://annas-archive.li/search?q=a+b');
  });

  it('sucht auf Anna’s Archive mit dem deutschen Titel, auch wenn eine fremdsprachige Ausgabe gewählt ist', () => {
    const link = annasArchiveLink({ annasBase: 'https://annas-archive.gl', title: 'La sombra del viento', author: 'Carlos Ruiz Zafón', language: 'spa', germanTitle: 'Der Schatten des Windes' });
    expect(link.id).toBe('annas-de');
    expect(link.url).toContain('q=Der+Schatten+des+Windes');
    expect(link.url).toContain('lang=de');
    const isbn = buildOffers({ ...base, title: 'La sombra del viento', language: 'spa', germanTitle: 'Der Schatten des Windes', isbn13: '9788408163435', region: 'CH' })
      .find((g) => g.kind === 'archive')!
      .links.find((l) => l.id === 'annas-isbn')!;
    expect(isbn.url).not.toContain('lang='); // eine spanische ISBN gibt es nicht auf Deutsch
  });

  it('sucht ohne bekannte deutsche Ausgabe in allen Sprachen', () => {
    const link = annasArchiveLink({ annasBase: 'https://annas-archive.gl', title: 'Piranesi', author: 'Susanna Clarke', language: 'eng' });
    expect(link.id).toBe('annas-any');
    expect(link.url).not.toContain('lang=');
  });

  it('sucht ohne ISBN über Titel und Autor', () => {
    const links = buildOffers({ ...base, region: 'DE' }).flatMap((g) => g.links);
    expect(links.find((l) => l.id === 'amazon-de')!.url).toContain(encodeURIComponent('Der Schatten des Windes Carlos Ruiz Zafón'));
    expect(links.find((l) => l.id === 'eurobuch')!.url).toContain('search.php?title=');
  });

  it('erklärt die Buchpreisbindung passend zur Region', () => {
    expect(priceHint('DE', 'ger')).toMatch(/Buchpreisbindung/);
    expect(priceHint('CH', 'ger')).toMatch(/keine Buchpreisbindung/);
    expect(priceHint('DE', 'eng')).toMatch(/nicht der Buchpreisbindung/);
  });
});
