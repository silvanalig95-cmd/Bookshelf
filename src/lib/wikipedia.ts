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
