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
        if (w) return w;
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
      if (authorOk && BOOKISH.test(text)) return w;
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
