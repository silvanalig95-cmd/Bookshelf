/**
 * Gemeinsame Bausteine der KI-Funktionen – unabhängig davon, ob Claude oder Gemini antwortet:
 * Lesekontext, Anweisungen, Antwortschema und das Zerlegen von Buchverweisen.
 */
import { z } from 'zod';
import type { TasteProfile } from './profile';
import { ERAS, GENRES, MOODS, PLACES } from './taxonomy';
import type { LibraryEntry } from './types';

export type AiProvider = 'gemini' | 'claude';
export type AiVia = 'server' | 'browser';

export interface AiConfig {
  provider: AiProvider;
  /** Über den Lesekompass-Server (Schlüssel bleibt dort) oder direkt aus dem Browser. */
  via: AiVia;
  /** Browser-Schlüssel (bei via = 'server' ungenutzt). */
  key: string;
  model: string;
}

/** Ein Gesprächsschritt – neutral, damit ein Gespräch auch nach einem Anbieterwechsel weitergeht. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Wer die Antwort gegeben hat und ihre Rohform (z. B. mit Denk-Signaturen) – nur für denselben Anbieter wiederverwendbar. */
  provider?: AiProvider;
  raw?: unknown;
}

export interface ChatReply {
  text: string;
  raw: unknown;
  provider: AiProvider;
  model: string;
  /** Hinweis für die Anzeige, z. B. wenn auf ein anderes Modell ausgewichen wurde. */
  note?: string;
}

export type AiRecommendResult = AiRecommendation & { note?: string };

/** Fehler mit einer Meldung, die so in der App angezeigt werden kann. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

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

export const BASE_SYSTEM = `Du bist der KI-Bibliothekar von „Lesekompass“, einer App zum Entdecken von Büchern. Du bist belesen, warmherzig und präzise – wie eine Buchhändlerin, die ihre Stammkundschaft kennt.

Regeln:
- Empfiehl nur Bücher, die es wirklich gibt. Wenn du unsicher bist, ob ein Buch existiert, empfiehl es nicht.
- Die Person liest primär Deutsch. Gibt es eine deutsche Übersetzung, nenne den deutschen Titel. Nur wenn es keine deutsche Ausgabe gibt, nenne den englischen Titel und sag das.
- Empfiehl keine Bücher, die die Person schon gelesen hat (siehe Lesekontext).
- Begründe Empfehlungen konkret: was am Buch zum Wunsch passt und – falls bekannt – welche ihrer bisherigen Lieblingsbücher ähnlich sind.
- Antworte auf Deutsch (Schweizer Rechtschreibung mit „ss“ statt „ß“ ist willkommen).`;

/** Vokabular, aus dem die KI die Suchparameter wählt. */
export function vocabulary(): string {
  return [
    `Genre-IDs: ${GENRES.map((g) => `${g.id} (${g.label})`).join(', ')}`,
    `Stimmungs-IDs: ${MOODS.map((m) => `${m.id} (${m.label})`).join(', ')}`,
    `Schauplatz-IDs: ${PLACES.map((p) => `${p.id} (${p.label})`).join(', ')}`,
    `Epochen-IDs: ${ERAS.map((e) => `${e.id} (${e.label})`).join(', ')}`,
  ].join('\n');
}

export function recommendInstruction(wish: string, count: number): string {
  return `Mein Wunsch: ${wish}\n\nGib ${count} passende, abwechslungsreiche Empfehlungen (nicht nur die offensichtlichsten Bestseller, gern auch ein, zwei Geheimtipps) und übersetze den Wunsch zusätzlich in Suchparameter aus dem Vokabular.`;
}

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

/** Unbekannte IDs (z. B. erfundene Genres) entfernen, bevor das Schema prüft. */
export function cleanRecommendation(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as { search?: Record<string, unknown> };
  if (!r.search || typeof r.search !== 'object') return raw;
  const keep = (key: string, valid: Array<{ id: string }>) => {
    const list = r.search![key];
    if (Array.isArray(list)) r.search![key] = list.filter((x) => valid.some((v) => v.id === x));
  };
  keep('genres', GENRES);
  keep('moods', MOODS);
  keep('places', PLACES);
  keep('eras', ERAS);
  return raw;
}

/* ------------------------------------------------------------------ */
/* Chat (KI-Bibliothekar)                                                */
/* ------------------------------------------------------------------ */

export const CHAT_INSTRUCTIONS = `Du führst ein Gespräch über Bücher. Stelle bei vagen Wünschen gern eine kurze Rückfrage, aber liefere meist direkt 3–6 Vorschläge.
Formatiere jede Buchempfehlung als [[Titel|Autor]] (deutscher Titel, falls vorhanden) – die App macht daraus anklickbare Karten. Danach in einem kurzen Satz, warum es passt.
Nutze einfache Markdown-Formatierung (Absätze, **fett**, Aufzählungen), keine Tabellen. Fasse dich eher kurz.`;

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
