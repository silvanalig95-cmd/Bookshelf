import { describe, expect, it } from 'vitest';
import { annasArchiveUrl, buildOffers, priceHint } from '../src/lib/shops';

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

  it('verlinkt Anna’s Archive per ISBN und per Titel', () => {
    const archive = buildOffers({ ...base, isbn13: '9783518458006', region: 'DE' }).find((g) => g.kind === 'archive')!.links;
    expect(archive[0].url).toBe('https://annas-archive.gl/search?q=9783518458006');
    expect(archive[1].url).toContain('lang=de');
    expect(annasArchiveUrl('https://annas-archive.li/', 'a b')).toBe('https://annas-archive.li/search?q=a+b');
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
