/**
 * Kauf-, Vergleichs-, Bibliotheks- und Archiv-Links für eine konkrete Ausgabe.
 *
 * Alle Links sind ISBN-genau, sofern eine ISBN vorliegt – sonst wird mit
 * Titel + Autor gesucht. Echte Live-Preise gibt es nur, wo eine freie
 * Schnittstelle sie liefert (Google Play über Google Books); für alles andere
 * führt der Link direkt zur Trefferseite des Shops bzw. Preisvergleichs.
 */
import type { Region } from './types';

export type OfferKind = 'new' | 'compare' | 'used' | 'ebook' | 'audio' | 'library' | 'archive' | 'info';

export interface OfferLink {
  id: string;
  name: string;
  url: string;
  kind: OfferKind;
  note?: string;
  /** Hervorgehobene Empfehlung (z. B. günstigster Weg). */
  featured?: boolean;
}

export interface OfferGroup {
  kind: OfferKind;
  title: string;
  icon: string;
  links: OfferLink[];
}

export interface OfferInput {
  isbn13?: string;
  isbn10?: string;
  title: string;
  author?: string;
  region: Region;
  /** Sprache der gewählten Ausgabe (ISO-639-2), z. B. "ger". */
  language?: string;
  annasBase: string;
  workId?: string;
  /** Lieblingsshop (ID), wird zuerst und hervorgehoben angezeigt. */
  preferredShop?: string;
}

export const ANNAS_ARCHIVE_MIRRORS = ['https://annas-archive.gl', 'https://annas-archive.li', 'https://annas-archive.gs', 'https://annas-archive.org'];

const enc = encodeURIComponent;

export function annasArchiveUrl(base: string, query: string, lang?: string): string {
  const root = (base || ANNAS_ARCHIVE_MIRRORS[0]).replace(/\/+$/, '');
  const params = new URLSearchParams({ q: query });
  if (lang) params.set('lang', lang);
  return `${root}/search?${params.toString()}`;
}

export function buildOffers(input: OfferInput): OfferGroup[] {
  const { isbn13, title, author, region } = input;
  const textQuery = [title, author].filter(Boolean).join(' ');
  const q = isbn13 ?? textQuery;
  const isGerman = input.language === 'ger';

  const newShops: OfferLink[] = [];
  const amazonDe: OfferLink = {
    id: 'amazon-de',
    name: 'Amazon.de',
    url: `https://www.amazon.de/s?k=${enc(q)}&i=stripbooks`,
    kind: 'new',
    note: region === 'CH' ? 'Lieferung in die Schweiz' : 'inkl. Marketplace-Angebote',
  };
  if (region === 'CH') {
    newShops.push(
      { id: 'orellfuessli', name: 'Orell Füssli', url: `https://www.orellfuessli.ch/suche?sq=${enc(q)}`, kind: 'new', note: 'Schweizer Buchhandlung' },
      { id: 'exlibris', name: 'Ex Libris', url: `https://www.exlibris.ch/de/suche/?q=${enc(q)}`, kind: 'new', note: 'oft günstige Preise' },
      amazonDe,
    );
  } else if (region === 'AT') {
    newShops.push(
      { id: 'thalia-at', name: 'Thalia.at', url: `https://www.thalia.at/suche?sq=${enc(q)}`, kind: 'new' },
      amazonDe,
    );
  } else {
    newShops.push(
      amazonDe,
      { id: 'thalia-de', name: 'Thalia', url: `https://www.thalia.de/suche?sq=${enc(q)}`, kind: 'new' },
      { id: 'hugendubel', name: 'Hugendubel', url: `https://www.hugendubel.de/de/search?q=${enc(q)}`, kind: 'new' },
    );
  }
  const preferred = input.preferredShop ?? 'amazon-de';
  const prefIndex = newShops.findIndex((l) => l.id === preferred);
  if (prefIndex >= 0) {
    const [pref] = newShops.splice(prefIndex, 1);
    newShops.unshift({ ...pref, featured: true, note: pref.note ? `Standard-Shop · ${pref.note}` : 'Standard-Shop' });
  }
  if (!isGerman) {
    newShops.push({ id: 'amazon-com', name: 'Amazon.com', url: `https://www.amazon.com/s?k=${enc(q)}&i=stripbooks`, kind: 'new', note: 'US-Ausgaben' });
  }

  const eurobuchDomain = region === 'CH' ? 'eurobuch.ch' : region === 'AT' ? 'eurobuch.at' : 'eurobuch.de';
  const compare: OfferLink[] = [
    {
      id: 'eurobuch',
      name: 'eurobuch',
      url: isbn13
        ? `https://www.${eurobuchDomain}/buch/isbn/${isbn13}.html`
        : `https://www.${eurobuchDomain}/search.php?title=${enc(title)}&author=${enc(author ?? '')}`,
      kind: 'compare',
      note: 'vergleicht >100 Shops, neu & gebraucht',
      featured: true,
    },
    {
      id: 'bookfinder',
      name: 'BookFinder',
      url: isbn13
        ? `https://www.bookfinder.com/search/?isbn=${isbn13}&mode=isbn&st=sr&ac=qr`
        : `https://www.bookfinder.com/search/?author=${enc(author ?? '')}&title=${enc(title)}&mode=basic&st=sr&ac=qr`,
      kind: 'compare',
      note: 'weltweiter Preisvergleich',
    },
  ];

  const used: OfferLink[] = [
    { id: 'booklooker', name: 'booklooker', url: isbn13 ? `https://www.booklooker.de/B%C3%BCcher/Angebote/isbn=${isbn13}` : `https://www.booklooker.de/B%C3%BCcher/Angebote/titel=${enc(title)}`, kind: 'used' },
    { id: 'medimops', name: 'medimops', url: `https://www.medimops.de/produkte-C0/?fcIsSearch=1&searchparam=${enc(q)}`, kind: 'used' },
    { id: 'rebuy', name: 'reBuy', url: `https://www.rebuy.de/kaufen/suchen?q=${enc(q)}`, kind: 'used' },
    { id: 'zvab', name: 'ZVAB', url: isbn13 ? `https://www.zvab.com/servlet/SearchResults?isbn=${isbn13}` : `https://www.zvab.com/servlet/SearchResults?tn=${enc(title)}&an=${enc(author ?? '')}`, kind: 'used', note: 'Antiquariate' },
  ];

  const ebook: OfferLink[] = [
    { id: 'kindle', name: 'Kindle-Shop', url: `https://www.amazon.de/s?k=${enc(textQuery)}&i=digital-text`, kind: 'ebook' },
    { id: 'kobo', name: 'Kobo', url: `https://www.kobo.com/${region === 'CH' ? 'ch' : region === 'AT' ? 'at' : 'de'}/de/search?query=${enc(textQuery)}`, kind: 'ebook' },
    { id: 'googleplay', name: 'Google Play Bücher', url: `https://play.google.com/store/search?q=${enc(textQuery)}&c=books`, kind: 'ebook' },
    { id: 'audible', name: 'Audible (Hörbuch)', url: `https://www.audible.de/search?keywords=${enc(textQuery)}`, kind: 'audio' },
  ];

  const library: OfferLink[] = [
    { id: 'worldcat', name: 'WorldCat', url: isbn13 ? `https://search.worldcat.org/search?q=bn:${isbn13}` : `https://search.worldcat.org/search?q=${enc(textQuery)}`, kind: 'library', note: 'Bibliotheken in deiner Nähe' },
  ];
  if (region === 'CH') {
    library.push({
      id: 'swisscovery',
      name: 'swisscovery',
      url: `https://swisscovery.slsp.ch/discovery/search?query=any,contains,${enc(q)}&vid=41SLSP_NETWORK:VU1_UNION`,
      kind: 'library',
      note: 'Schweizer Hochschul- & Kantonsbibliotheken',
    });
  } else {
    library.push({ id: 'dnb', name: 'Deutsche Nationalbibliothek', url: `https://portal.dnb.de/opac.htm?method=simpleSearch&query=${enc(q)}`, kind: 'library' });
  }
  library.push({ id: 'onleihe', name: 'Onleihe', url: 'https://www.onleihe.net/', kind: 'library', note: 'E-Books leihen mit Bibliotheksausweis' });

  const archive: OfferLink[] = [];
  if (isbn13) {
    archive.push({ id: 'annas-isbn', name: "Anna's Archive (ISBN)", url: annasArchiveUrl(input.annasBase, isbn13), kind: 'archive', note: 'genau diese Ausgabe' });
  }
  archive.push({
    id: 'annas-title',
    name: "Anna's Archive (Titel)",
    url: annasArchiveUrl(input.annasBase, textQuery, isGerman ? 'de' : undefined),
    kind: 'archive',
    note: isGerman ? 'alle deutschen Treffer' : 'alle Treffer',
  });

  const info: OfferLink[] = [
    { id: 'goodreads', name: 'Goodreads', url: `https://www.goodreads.com/search?q=${enc(q)}`, kind: 'info' },
  ];
  if (input.workId && /^OL\d+W$/.test(input.workId)) {
    info.push({ id: 'openlibrary', name: 'Open Library', url: `https://openlibrary.org/works/${input.workId}`, kind: 'info' });
  }

  return [
    { kind: 'new', title: 'Neu kaufen', icon: '🛒', links: newShops },
    { kind: 'compare', title: 'Preisvergleich', icon: '🏷️', links: compare },
    { kind: 'used', title: 'Gebraucht', icon: '♻️', links: used },
    { kind: 'ebook', title: 'E-Book & Hörbuch', icon: '📱', links: ebook },
    { kind: 'library', title: 'Ausleihen', icon: '🏛️', links: library },
    { kind: 'archive', title: 'Archiv', icon: '🗄️', links: archive },
    { kind: 'info', title: 'Mehr Infos', icon: 'ℹ️', links: info },
  ];
}

/** Kurzer Hinweis zur Preislage – abhängig von Region und Sprache. */
export function priceHint(region: Region, language?: string): string {
  const german = language === 'ger';
  if (region === 'CH') {
    return 'In der Schweiz gibt es keine Buchpreisbindung – die Preise für dasselbe Buch unterscheiden sich teils deutlich. Amazon.de zieht bei Lieferung in die Schweiz die deutsche MwSt. ab und rechnet Einfuhrabgaben direkt mit ein; den Endpreis siehst du im Warenkorb.';
  }
  if (german) {
    return 'In Deutschland und Österreich gilt die Buchpreisbindung: Neue deutschsprachige Bücher kosten überall gleich viel. Sparen kannst du mit gebrauchten Exemplaren oder E-Book-Aktionen.';
  }
  return 'Fremdsprachige Bücher unterliegen nicht der Buchpreisbindung – die Preise schwanken je nach Shop und Ausgabe.';
}
