/**
 * Optionale KI-Funktionen mit Claude (Anthropic).
 *
 * Zwei Wege zum Schlüssel:
 *  - Lokaler Server: ANTHROPIC_API_KEY in `.env` – der Schlüssel bleibt auf dem Server,
 *    der Browser spricht nur mit /api/anthropic.
 *  - Browser: Schlüssel in den Einstellungen (wird nur in diesem Browser gespeichert).
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AiVia } from './aiStatus';
import type { TasteProfile } from './profile';
import { ERAS, GENRES, MOODS, PLACES } from './taxonomy';
import type { LibraryEntry } from './types';
import type { AiModel } from '../store/settings';

export type { AiVia } from './aiStatus';
export { aiAvailability, resetAiStatus } from './aiStatus';

function makeClient(via: AiVia, key: string): Anthropic {
  if (via === 'server') {
    return new Anthropic({
      // Der lokale Server ersetzt diesen Platzhalter durch den echten Schlüssel.
      apiKey: 'lokaler-server',
      baseURL: new URL('./api/anthropic', window.location.href).toString().replace(/\/$/, ''),
      dangerouslyAllowBrowser: true,
    });
  }
  return new Anthropic({ apiKey: key.trim(), dangerouslyAllowBrowser: true });
}

export interface AiConfig {
  via: AiVia;
  key: string;
  model: AiModel;
}

/** Server-seitiger Fallback bei Ablehnungen – nicht für Haiku verfügbar. */
function fallbackParams(model: AiModel): { betas?: string[]; fallbacks?: 'default' } {
  if (model === 'claude-haiku-5-5') return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Der Claude-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Der Schlüssel hat keinen Zugriff auf dieses Modell.';
  if (err instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen an Claude – bitte kurz warten.';
  if (err instanceof Anthropic.BadRequestError) return `Claude hat die Anfrage abgelehnt: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Claude.';
  if (err instanceof Anthropic.APIError) return `Claude-Fehler (${err.status ?? '?'}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Lese-Kontext                                                          */
/* ------------------------------------------------------------------ */

/** Kompakte, stabile Zusammenfassung der Bibliothek für den System-Prompt. */
export function readingContext(entries: LibraryEntry[], profile?: TasteProfile): string {
  const read = entries.filter((e) => e.shelf === 'read');
  if (!read.length && !profile) return 'Es liegen keine Informationen über bisher gelesene Bücher vor.';
  const byDate = [...read].sort((a, b) => (b.dateRead ?? b.dateAdded ?? '').localeCompare(a.dateRead ?? a.dateAdded ?? ''));
  const favorites = read.filter((e) => e.rating >= 5).slice(0, 40);
  const liked = read.filter((e) => e.rating === 4).slice(0, 30);
  const disliked = read.filter((e) => e.rating > 0 && e.rating <= 2).slice(0, 20);
  const fmt = (e: LibraryEntry) => `${e.title.replace(/\s*\(.*?#\d+.*?\)/, '')} – ${e.authors[0] ?? '?'}${e.rating ? ` (${e.rating}★)` : ''}`;
  const lines: string[] = [];
  lines.push(`Gelesene Bücher insgesamt: ${read.length}.`);
  if (favorites.length) lines.push(`Lieblingsbücher (5★): ${favorites.map(fmt).join('; ')}`);
  if (liked.length) lines.push(`Gut gefallen (4★): ${liked.map(fmt).join('; ')}`);
  if (disliked.length) lines.push(`Nicht gefallen (1–2★): ${disliked.map(fmt).join('; ')}`);
  lines.push(`Zuletzt gelesen: ${byDate.slice(0, 12).map(fmt).join('; ')}`);
  if (profile) {
    if (profile.favoriteAuthors.length) lines.push(`Lieblingsautor:innen: ${profile.favoriteAuthors.slice(0, 12).map((a) => a.name).join(', ')}`);
    if (profile.topConcepts.length) lines.push(`Starke Themen im Profil: ${profile.topConcepts.slice(0, 15).map((c) => c.label).join(', ')}`);
    if (profile.dislikedConcepts.length) lines.push(`Eher ungeliebte Themen: ${profile.dislikedConcepts.slice(0, 8).map((c) => c.label).join(', ')}`);
  }
  const wantToRead = entries.filter((e) => e.shelf === 'to-read').slice(0, 30);
  if (wantToRead.length) lines.push(`Auf der Will-ich-lesen-Liste: ${wantToRead.map(fmt).join('; ')}`);
  // Alle gelesenen Titel, damit nichts Gelesenes empfohlen wird
  lines.push(`Bereits gelesen (nicht empfehlen): ${byDate.slice(0, 500).map((e) => e.title.replace(/\s*\(.*?\)/, '')).join(' | ')}`);
  return lines.join('\n');
}

const BASE_SYSTEM = `Du bist der KI-Bibliothekar von „Lesekompass“, einer App zum Entdecken von Büchern. Du bist belesen, warmherzig und präzise – wie eine Buchhändlerin, die ihre Stammkundschaft kennt.

Regeln:
- Empfiehl nur Bücher, die es wirklich gibt. Wenn du unsicher bist, ob ein Buch existiert, empfiehl es nicht.
- Die Person liest primär Deutsch. Gibt es eine deutsche Übersetzung, nenne den deutschen Titel. Nur wenn es keine deutsche Ausgabe gibt, nenne den englischen Titel und sag das.
- Empfiehl keine Bücher, die die Person schon gelesen hat (siehe Lesekontext).
- Begründe Empfehlungen konkret: was am Buch zum Wunsch passt und – falls bekannt – welche ihrer bisherigen Lieblingsbücher ähnlich sind.
- Antworte auf Deutsch (Schweizer Rechtschreibung mit „ss“ statt „ß“ ist willkommen).`;

/* ------------------------------------------------------------------ */
/* Wunsch → Empfehlungen (strukturiert)                                  */
/* ------------------------------------------------------------------ */

const ids = <T extends { id: string }>(list: T[]) => list.map((x) => x.id) as [string, ...string[]];

export const AiRecommendationSchema = z.object({
  understanding: z.string().describe('Ein Satz: So hast du den Wunsch verstanden.'),
  search: z.object({
    genres: z.array(z.enum(ids(GENRES))),
    moods: z.array(z.enum(ids(MOODS))),
    places: z.array(z.enum(ids(PLACES))),
    eras: z.array(z.enum(ids(ERAS))),
    keywords: z.array(z.string()).describe('Englische Open-Library-Schlagwörter, die zum Wunsch passen (z. B. "lighthouses", "grief")'),
    pages_max: z.number().nullable(),
    pages_min: z.number().nullable(),
  }),
  recommendations: z.array(
    z.object({
      title: z.string().describe('Deutscher Titel, falls es eine deutsche Ausgabe gibt, sonst Originaltitel'),
      original_title: z.string().nullable(),
      author: z.string(),
      year: z.number().nullable(),
      german_edition: z.boolean(),
      why: z.string().describe('1–2 Sätze, warum es passt'),
      tags: z.array(z.string()).describe('2–4 kurze Stichworte, z. B. "düster", "Island", "Familiengeheimnis"'),
    }),
  ),
});

export type AiRecommendation = z.infer<typeof AiRecommendationSchema>;

export async function aiRecommend(
  wish: string,
  config: AiConfig,
  context: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<AiRecommendation> {
  const client = makeClient(config.via, config.key);
  const count = options.count ?? 8;
  const vocabulary = [
    `Genre-IDs: ${GENRES.map((g) => `${g.id} (${g.label})`).join(', ')}`,
    `Stimmungs-IDs: ${MOODS.map((m) => `${m.id} (${m.label})`).join(', ')}`,
    `Schauplatz-IDs: ${PLACES.map((p) => `${p.id} (${p.label})`).join(', ')}`,
    `Epochen-IDs: ${ERAS.map((e) => `${e.id} (${e.label})`).join(', ')}`,
  ].join('\n');

  const response = await client.beta.messages.parse(
    {
      model: config.model,
      max_tokens: 16000,
      ...fallbackParams(config.model),
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium', format: betaZodOutputFormat(AiRecommendationSchema) },
      system: [
        { type: 'text', text: `${BASE_SYSTEM}\n\nVokabular für die Suchparameter:\n${vocabulary}` },
        { type: 'text', text: `Lesekontext der Person:\n${context}` },
      ],
      messages: [
        {
          role: 'user',
          content: `Mein Wunsch: ${wish}\n\nGib ${count} passende, abwechslungsreiche Empfehlungen (nicht nur die offensichtlichsten Bestseller, gern auch ein, zwei Geheimtipps) und übersetze den Wunsch zusätzlich in Suchparameter aus dem Vokabular.`,
        },
      ],
    },
    { signal: options.signal },
  );
  if (response.stop_reason === 'refusal') throw new AiError('Claude hat diese Anfrage abgelehnt. Formuliere den Wunsch bitte etwas anders.');
  if (response.stop_reason === 'max_tokens') throw new AiError('Die Antwort war zu lang und wurde abgeschnitten. Bitte nochmal versuchen.');
  const parsed = response.parsed_output;
  if (!parsed) throw new AiError('Die Antwort von Claude konnte nicht gelesen werden.');
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Chat (KI-Bibliothekar)                                                */
/* ------------------------------------------------------------------ */

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

export const CHAT_INSTRUCTIONS = `Du führst ein Gespräch über Bücher. Stelle bei vagen Wünschen gern eine kurze Rückfrage, aber liefere meist direkt 3–6 Vorschläge.
Formatiere jede Buchempfehlung als [[Titel|Autor]] (deutscher Titel, falls vorhanden) – die App macht daraus anklickbare Karten. Danach in einem kurzen Satz, warum es passt.
Nutze einfache Markdown-Formatierung (Absätze, **fett**, Aufzählungen), keine Tabellen. Fasse dich eher kurz.`;

export async function aiChat(
  history: ChatMessage[],
  config: AiConfig,
  context: string,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<Anthropic.Beta.BetaMessage> {
  const client = makeClient(config.via, config.key);
  const stream = client.beta.messages.stream(
    {
      model: config.model,
      max_tokens: 64000,
      ...fallbackParams(config.model),
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: `${BASE_SYSTEM}\n\n${CHAT_INSTRUCTIONS}` },
        { type: 'text', text: `Lesekontext der Person:\n${context}` },
      ],
      messages: history,
    },
    { signal },
  );
  stream.on('text', (delta) => onText(delta));
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new AiError('Claude hat diese Anfrage abgelehnt.');
  return message;
}

/** Zerlegt eine Antwort in Text und [[Titel|Autor]]-Buchverweise. */
export function parseBookRefs(text: string): Array<{ type: 'text'; text: string } | { type: 'book'; title: string; author: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'book'; title: string; author: string }> = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    parts.push({ type: 'book', title: m[1].trim(), author: m[2].trim() });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}
