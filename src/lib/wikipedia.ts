/**
 * Deutschsprachige Zusammenfassungen aus der Wikipedia.
 * Weg 1: Wikidata-ID des Werks (von Open Library) → deutscher Artikel.
 * Weg 2: Artikel mit dem deutschen Titel (auch „Titel (Roman)“), sofern der
 *        Text den Nachnamen der Autorin / des Autors nennt.
 */
import { fetchJson, HttpError } from './http';
import { authorSurname, normalize } from './text';

/** Wikimedia bittet API-Nutzer um eine Kennung (Browser dürfen dafür diesen Header setzen). */
const HEADERS = { 'Api-User-Agent': 'Lesekompass/1.0 (persoenliche Lese-App; https://github.com/silvanalig95-cmd/Bookshelf)' };

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
  /** Abschnitt zum Inhalt (Handlung, Inhaltsangabe …) – verrät oft das Ende. */
  plot?: { heading: string; text: string };
}

const PLOT_HEADING = /^(inhalt|handlung|inhaltsangabe|zusammenfassung|plot|die handlung|inhalt und aufbau|handlung und aufbau|aufbau und inhalt|inhalt und form)\b/i;
const MAX_PLOT = 4000;

/** Sucht im vollen Artikeltext (explaintext, exsectionformat=wiki) den Abschnitt zum Inhalt. */
export function extractPlot(article: string): WikiSummary['plot'] {
  const parts = article.split(/\n==[ \t]*([^=\n]+?)[ \t]*==[ \t]*\n/);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    if (!PLOT_HEADING.test(heading)) continue;
    const text = (parts[i + 1] ?? '')
      .replace(/\n={3,}[ \t]*([^=\n]+?)[ \t]*={3,}[ \t]*\n/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length < 80) continue;
    return { heading, text: text.length > MAX_PLOT ? `${text.slice(0, text.lastIndexOf(' ', MAX_PLOT))} …` : text };
  }
  return undefined;
}

// Abkürzungen, nach denen ein Punkt keinen Satz beendet („z. B.“, „Dr.“, „St.“ …)
const ABBREVIATIONS = new Set(['z', 'b', 'd', 'h', 'u', 'a', 'o', 'dr', 'st', 'nr', 'bzw', 'ca', 'vgl', 'etc', 'usw', 'sog', 'geb', 'jh', 'jhd', 'mio', 'mrd', 'prof', 'hl', 'chr', 'evtl', 'ggf', 'inkl', 'mr', 'mrs', 'ms', 'jr', 'sr', 'vs', 'bd', 'ff', 'v']);

/** Zerlegt Fliesstext in Sätze – robust gegen Abkürzungen, Initialen und Ordnungszahlen („19. Jahrhundert“). */
export function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  const re = /[.!?…]+["“”»«']?\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const word = (flat.slice(start, m.index).match(/(\S+)$/)?.[1] ?? '').replace(/^[(„"»]/, '').toLowerCase();
    const next = flat[m.index + m[0].length] ?? '';
    const abbreviation = flat[m.index] === '.' && (ABBREVIATIONS.has(word) || /^\d+$/.test(word) || /^\p{L}$/u.test(word));
    if (abbreviation || !/[\p{Lu}„"»(\d]/u.test(next)) continue;
    out.push(flat.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  const rest = flat.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Fügt ganze Sätze aneinander, bis etwa `max` Zeichen erreicht sind (mindestens einen). */
function upTo(list: string[], max: number): string {
  let text = '';
  for (const sentence of list) {
    if (text && text.length + sentence.length + 1 > max) break;
    text = text ? `${text} ${sentence}` : sentence;
  }
  return text.length > max * 1.6 ? `${text.slice(0, text.lastIndexOf(' ', max))} …` : text;
}

/** Die ersten Sätze der Handlung: die Ausgangslage, meist ohne das Ende zu verraten. */
export function premise(plot: string, max = 480): string {
  return upTo(sentences(plot), max);
}

// Sätze, die vom Inhalt erzählen – im Unterschied zu Angaben über Erscheinen, Verlag, Erfolg
const CONTENT = /\b(handelt|handeln|erzählt|erzählen|geht es|schildert|schildern|beschreibt|im mittelpunkt|protagonist\w*|hauptfigur\w*|ich-erzähler\w*|spielt (in|im|auf|an|während)|folgt|begleitet|dreht sich|geschichte (eines|einer|von|des|der))\b/i;
const META = /\b(erschien|erschienen|veröffentlicht\w*|verlag|übersetz\w*|bestseller\w*|verfilm\w*|auflage|ausgezeichnet|preis|debüt\w*|sprachen|exemplare|rezension\w*|bestsellerliste)\b/i;

/** Inhaltliche Sätze aus einer Einleitung (ohne Erscheinungs- und Erfolgsangaben). */
export function contentSentences(text: string): string[] {
  return sentences(text).filter((x) => CONTENT.test(x) && !(META.test(x) && !/\b(handelt|erzählt|geht es|schildert)\b/i.test(x)));
}

/** Worum es im Buch geht – aus dem Handlungsabschnitt oder den inhaltlichen Sätzen der Einleitung. */
export function contentSummary(w: WikiSummary, max = 480): { text: string; source: 'plot' | 'intro' } | undefined {
  if (w.plot) return { text: premise(w.plot.text, max), source: 'plot' };
  const content = contentSentences(w.extract);
  return content.length ? { text: upTo(content, max), source: 'intro' } : undefined;
}

async function withPlot(w: WikiSummary, signal?: AbortSignal): Promise<WikiSummary> {
  try {
    const d = await fetchJson<{ query?: { pages?: Record<string, { extract?: string }> } }>(
      `https://de.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&origin=*&titles=${encodeURIComponent(w.title)}`,
      { signal, ttl: 24 * 60 * 60_000, retries: 0, headers: HEADERS },
    );
    const text = Object.values(d.query?.pages ?? {})[0]?.extract;
    const plot = text ? extractPlot(`\n${text}`) : undefined;
    return plot ? { ...w, plot } : w;
  } catch {
    return w; // Der Inhalt ist eine Zugabe – ohne ihn bleibt die Zusammenfassung
  }
}

interface RestSummary {
  type?: string;
  title: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source: string };
}

async function summary(title: string, signal?: AbortSignal): Promise<RestSummary | undefined> {
  try {
    return await fetchJson<RestSummary>(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {
      signal,
      ttl: 24 * 60 * 60_000,
      retries: 0,
      headers: HEADERS,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  }
}

function toWiki(s: RestSummary): WikiSummary | undefined {
  if (!s.extract || s.type === 'disambiguation') return undefined;
  return { title: s.title, extract: s.extract, url: s.content_urls?.desktop?.page ?? `https://de.wikipedia.org/wiki/${encodeURIComponent(s.title)}`, thumbnail: s.thumbnail?.source };
}

const BOOKISH = /\b(roman|romans|buch|novelle|erzahlung|kriminalroman|thriller|sachbuch|kinderbuch|jugendbuch|trilogie|reihe|band|werk|schriftsteller|autorin|autor)\b/;

export async function germanWikipediaSummary(
  opts: { wikidataId?: string; titles: string[]; author?: string },
  signal?: AbortSignal,
): Promise<WikiSummary | undefined> {
  if (opts.wikidataId) {
    try {
      const d = await fetchJson<{ entities?: Record<string, { sitelinks?: { dewiki?: { title: string } } }> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(opts.wikidataId)}&props=sitelinks&sitefilter=dewiki&format=json&origin=*`,
        { signal, ttl: 24 * 60 * 60_000, retries: 0, headers: HEADERS },
      );
      const title = d.entities?.[opts.wikidataId]?.sitelinks?.dewiki?.title;
      if (title) {
        const s = await summary(title, signal);
        const w = s && toWiki(s);
        if (w) return withPlot(w, signal);
      }
    } catch {
      /* Wikidata nicht erreichbar – weiter mit Titelsuche */
    }
  }
  const surname = opts.author ? authorSurname(opts.author) : '';
  const tried = new Set<string>();
  for (const t of opts.titles) {
    for (const candidate of [t, `${t} (Roman)`]) {
      if (!candidate.trim() || tried.has(candidate)) continue;
      tried.add(candidate);
      const s = await summary(candidate, signal).catch(() => undefined);
      const w = s && toWiki(s);
      if (!w) continue;
      const text = normalize(w.extract);
      const authorOk = !surname || text.includes(surname);
      if (authorOk && BOOKISH.test(text)) return withPlot(w, signal);
    }
  }
  return undefined;
}

/** Grobe Spracherkennung für kurze Beschreibungen. */
export function guessLanguage(text: string): 'ger' | 'eng' | 'spa' | 'fre' | 'ita' | undefined {
  const words = normalize(text).split(' ').slice(0, 200);
  const count = (list: string[]) => words.filter((w) => list.includes(w)).length;
  const scores: Array<['ger' | 'eng' | 'spa' | 'fre' | 'ita', number]> = [
    ['ger', count(['der', 'die', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'sich', 'auf', 'den', 'das', 'wird'])],
    ['eng', count(['the', 'and', 'is', 'of', 'with', 'his', 'her', 'that', 'this', 'from', 'was'])],
    ['spa', count(['el', 'los', 'las', 'que', 'y', 'una', 'por', 'del', 'con', 'para', 'su'])],
    ['fre', count(['le', 'les', 'et', 'est', 'une', 'des', 'du', 'dans', 'pour', 'qui', 'sur'])],
    ['ita', count(['il', 'gli', 'che', 'una', 'della', 'nel', 'per', 'sono', 'di', 'non'])],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 3 ? scores[0][0] : undefined;
}

export function deeplUrl(text: string, from?: string): string {
  const map: Record<string, string> = { eng: 'en', spa: 'es', fre: 'fr', ita: 'it', ger: 'de' };
  const src = (from && map[from]) || 'auto';
  return `https://www.deepl.com/translator#${src}/de/${encodeURIComponent(text.slice(0, 1800))}`;
}
