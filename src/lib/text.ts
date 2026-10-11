/** Hilfsfunktionen rund um Text-Normalisierung. */

const DIACRITICS = /[\u0300-\u036f]/g;

/** Kleinbuchstaben, ohne Akzente, ß→ss, nur Buchstaben/Ziffern/Leerzeichen. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Titel für Vergleiche: ohne Untertitel, Klammerzusätze und Artikel. */
export function normalizeTitle(title: string): string {
  const main = title
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .split(/[:;]| - | – /)[0];
  return normalize(main)
    .replace(/^(der|die|das|the|a|an|le|la|les|el|il|lo)\s+/, '')
    .trim();
}

/** Nachname (letztes Wort) eines Autornamens, normalisiert. */
export function authorSurname(name: string): string {
  const cleaned = name.includes(',') ? name.split(',')[0] : name;
  const parts = normalize(cleaned).split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  return name.includes(',') ? parts[0] : parts[parts.length - 1];
}

export function bookFingerprint(title: string, authors: string[]): string {
  return `${normalizeTitle(title)}|${authorSurname(authors[0] ?? '')}`;
}

const STOPWORDS = new Set(
  (
    'aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes auch auf aus bei bin bis bist da damit dann das dass dein deine dem den der des dessen dich die dies diese diesem diesen dieser dieses dir doch dort du durch ein eine einem einen einer eines einig einige einmal er es etwas euch euer für gegen gewesen hab habe haben hat hatte hätte ich ihm ihn ihnen ihr ihre im in indem ins ist jede jedem jeden jeder jedes jene kann kein keine keinem keinen können könnte machen man manche mein meine mich mir mit muss möchte nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich sie sind so solche soll sollte sondern sonst über um und uns unter viel vom von vor war waren warum was weil weiter welche wenn wer werde werden wie wieder will wir wird wo wollen würde zu zum zur zwar zwischen gerne gern bitte etwas ein paar mag mögen spielt spielen spielen handelt handeln geht gehen sein soll sollte darf dürfen suche buch bücher buecher lesen roman romane ähnlich aehnlich irgendwas irgendwie richtig wirklich eher ganz mal so total einfach gut gute guten neues neue neuen '
    + 'a about after all also an and any are as at be because been but by can could do does for from had has have he her his how i if in into is it its just like me more most my no not of on one or our out so some than that the their them then there these they this to too up us very was we were what when which who will with would you your book books read reading novel something want looking'
  )
    .split(/\s+/)
    .map((w) => normalize(w)),
);

/** Inhaltswörter (ohne Stoppwörter) eines Freitexts. */
export function contentWords(input: string): string[] {
  return normalize(input)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Editierdistanz (Levenshtein) – für Schreibvarianten wie „Dostojewski“/„Dostoevsky“. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Ähnlich genug geschrieben? Kurze Wörter müssen exakt passen, lange dürfen leicht abweichen. */
export function similarWord(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 5) return false;
  return editDistance(a, b) <= (len >= 9 ? 3 : len >= 7 ? 2 : 1);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/** Entfernt HTML-Tags und dekodiert die häufigsten Entities. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

export function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Escaped einen Begriff für eine Solr-Phrase in Anführungszeichen. */
export function solrPhrase(term: string): string {
  return `"${term.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/** Deterministisches Mischen mit Seed (Mulberry32). */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let t = seed >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function shuffle<T>(items: T[]): T[] {
  return seededShuffle(items, Math.floor(Math.random() * 2 ** 31));
}

export function pickRandom<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}
