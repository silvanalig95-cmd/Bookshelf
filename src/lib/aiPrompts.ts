/**
 * Gemeinsame Bausteine der KI-Funktionen – unabhängig davon, ob Claude oder Gemini antwortet:
 * Lesekontext, Anweisungen, Antwortschema und das Zerlegen von Buchverweisen.
 */
import { z } from 'zod';
import type { TasteProfile } from './profile';
import { ERAS, GENRES, MOODS, PLACES } from './taxonomy';
import type { LibraryEntry } from './types';

/** Hauptanbieter (wählbar) und Ausweich-Kanäle mit OpenAI-kompatibler Schnittstelle. */
export type AiProvider = 'gemini' | 'claude' | CompatProvider;
export type CompatProvider = 'mistral' | 'groq' | 'openrouter';
export type AiVia = 'server' | 'browser';

export interface AiConfig {
  provider: AiProvider;
  /** Über den Lesekompass-Server (Schlüssel bleibt dort) oder mit einem Schlüssel aus dem Browser. */
  via: AiVia;
  /** Browser-Schlüssel (bei via = 'server' ungenutzt). */
  key: string;
  /** Leer = automatisch wählen (Ausweich-Kanäle). */
  model: string;
  /** Läuft ein Lesekompass-Server, der Anfragen mit Browser-Schlüssel weiterreicht? */
  relay?: boolean;
  /** Der Reihe nach versuchen, wenn dieser Kanal nicht antwortet (Kontingent, Überlastung …). */
  fallbacks?: AiConfig[];
}

export interface AiTaskOptions {
  signal?: AbortSignal;
  /** Kleine Aufgabe (z. B. Kurzbeschreibung): günstiges Modell, kaum „Nachdenken“, kurze Antwort. */
  light?: boolean;
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

/** Fehlende optionale Felder ergänzen, bevor das Schema streng prüft. */
function withDefaults(raw: unknown): unknown {
  const r = cleanRecommendation(raw) as { recommendations?: Array<Record<string, unknown>>; search?: Record<string, unknown> } | undefined;
  if (!r || typeof r !== 'object') return r;
  r.search = { genres: [], moods: [], places: [], eras: [], keywords: [], pages_max: null, pages_min: null, ...(r.search ?? {}) };
  r.recommendations = (r.recommendations ?? []).map((x) => ({ original_title: null, year: null, german_edition: false, tags: [], why: '', ...x }));
  return r;
}

/** JSON-Antwort einer KI (auch mit ```json-Zaun oder Vortext) prüfen und in Empfehlungen umwandeln. */
export function parseRecommendationJson(text: string, providerName: string): AiRecommendation {
  let json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start > 0 && end > start) json = json.slice(start, end + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new AiError(`Die Antwort von ${providerName} konnte nicht gelesen werden. Bitte nochmal versuchen.`);
  }
  const parsed = AiRecommendationSchema.safeParse(withDefaults(data));
  if (!parsed.success) throw new AiError(`Die Antwort von ${providerName} hatte nicht das erwartete Format. Bitte nochmal versuchen.`);
  return parsed.data;
}

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
/* Kurzbeschreibung für die Buchseite                                    */
/* ------------------------------------------------------------------ */

/**
 * Knapper Lesekontext für kleine Aufgaben wie die Kurzbeschreibung: Statt der ganzen
 * Bibliothek (bis zu 500 Titel) nur, was für „passt zu dir?“ nötig ist – spart viele Tokens.
 */
export function compactReadingContext(entries: LibraryEntry[], profile?: TasteProfile): string {
  const read = entries.filter((e) => e.shelf === 'read');
  if (!read.length && !profile) return 'Es liegen keine Informationen über bisher gelesene Bücher vor.';
  const fmt = (e: LibraryEntry) => `${e.title.replace(/\s*\(.*?\)/, '')} – ${e.authors[0] ?? '?'}`;
  const lines: string[] = [];
  const favorites = read.filter((e) => e.rating >= 5).slice(0, 12);
  const disliked = read.filter((e) => e.rating > 0 && e.rating <= 2).slice(0, 6);
  if (favorites.length) lines.push(`Lieblingsbücher: ${favorites.map(fmt).join('; ')}`);
  if (disliked.length) lines.push(`Nicht gefallen: ${disliked.map(fmt).join('; ')}`);
  if (profile?.topConcepts.length) lines.push(`Starke Themen: ${profile.topConcepts.slice(0, 10).map((c) => c.label).join(', ')}`);
  if (profile?.dislikedConcepts.length) lines.push(`Eher ungeliebt: ${profile.dislikedConcepts.slice(0, 5).map((c) => c.label).join(', ')}`);
  return lines.join('\n') || 'Es liegen kaum Informationen über bisher gelesene Bücher vor.';
}

export const BLURB_SYSTEM = `${BASE_SYSTEM}

Du schreibst deutsche Kurzbeschreibungen für die Buchseite und den Bücher-Stapel der App: konkret und gehaltvoll, ohne Werbesprache.`;

export interface BlurbInput {
  title: string;
  author: string;
  year?: number;
  originalTitle?: string;
  description?: string;
  /** Inhalt aus der deutschsprachigen Wikipedia (Handlung oder Einleitung). */
  wiki?: string;
  subjects: string[];
}

/**
 * Der Auftrag – gleich lautend in server/nightShift.ts (die Nachtschicht schreibt dieselben
 * Beschreibungen auf Vorrat; ein Test prüft, dass beide übereinstimmen).
 */
export const BLURB_INSTRUCTIONS = [
  'Schreib auf Deutsch zwei Absätze:',
  '1. Worum es geht – 4 bis 6 Sätze, spoilerfrei: Ausgangslage und Hauptfiguren, Schauplatz und Zeit, worum es im Kern geht, Ton und Stil – und was das Buch besonders macht. Konkret statt allgemein; keine Wendungen, kein Ende.',
  '2. Ein Satz, der mit „Passt zu dir, weil …“ oder „Eher nicht dein Fall, weil …“ beginnt und sich auf den Lesekontext stützt. Ohne Lesekontext: „Für alle, die …“.',
  'Kennst du das Buch nicht sicher, stütze dich nur auf das Material oben und sag ehrlich, wenn es dünn ist. Keine Überschriften, keine Aufzählung, kein [[…]]-Format. Schweizer Rechtschreibung (ss statt ß).',
];

export function blurbPrompt(b: BlurbInput): string {
  return [
    `Buch: „${b.title}“ von ${b.author}${b.year ? ` (${b.year})` : ''}${b.originalTitle && b.originalTitle !== b.title ? `, Originaltitel „${b.originalTitle}“` : ''}.`,
    b.wiki ? `Aus der deutschsprachigen Wikipedia:\n${b.wiki.slice(0, 2500)}` : '',
    b.description ? `Klappentext (evtl. in einer anderen Sprache):\n${b.description.slice(0, 2000)}` : '',
    b.subjects.length ? `Schlagwörter: ${b.subjects.slice(0, 15).join(', ')}` : '',
    '',
    ...BLURB_INSTRUCTIONS,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Der Satz „Passt zu dir, weil …“ aus einer Kurzbeschreibung (für die Anzeige neben anderen Texten). */
export function fitSentence(blurb: string): string | undefined {
  const parts = blurb.split(/\n\s*\n/).map((p) => p.trim());
  return parts.find((p) => /^(Passt zu dir|Eher nicht dein Fall|Für alle, die)/.test(p));
}

/* ------------------------------------------------------------------ */
/* Chat (KI-Bibliothekar)                                                */
/* ------------------------------------------------------------------ */

export const CHAT_INSTRUCTIONS = `Du führst ein Gespräch über Bücher. Stelle bei vagen Wünschen gern eine kurze Rückfrage, aber liefere meist direkt 3–6 Vorschläge.
Schreibe JEDES Buch, das du nennst – auch nebenbei im Fliesstext –, als [[Titel|Autor]] (deutscher Titel, falls vorhanden), z. B. [[Der Schatten des Windes|Carlos Ruiz Zafón]]. Nie als **Titel** oder „Titel“. Die App macht daraus Links zur Buchseite. Danach in einem kurzen Satz, warum es passt.
Nutze einfache Markdown-Formatierung (Absätze, **fett**, Aufzählungen), keine Tabellen. Fasse dich eher kurz.`;

type RefPart = { type: 'text'; text: string } | { type: 'book'; title: string; author: string };

/**
 * Hält sich die KI nicht an [[Titel|Autor]], erkennt die App auch die üblichen Schreibweisen
 * **Titel** von Autor, *Titel* von Autor, „Titel“ von Autor, "Titel" von Autor, »Titel« von Autor (auch „by“).
 * Der Name muss gross beginnen – „**Tipp** von mir“ bleibt Text.
 */
const LOOSE_REF =
  /(?:\*\*([^*\n]{2,90})\*\*|\*([^*\n]{2,90})\*|„([^“”\n]{2,90})[“”]|"([^"\n]{2,90})"|»([^«\n]{2,90})«)\s*(?:\(\s*)?(?:,\s*)?(?:von|by)\s+(\p{Lu}[\p{L}.'’-]*(?:\s+(?!(?:Der|Die|Das|Den|Dem|Ein|Eine|Er|Sie|Es|Ich|Du|Wir|Ihr|In|Im|Am|Mit|Und|Aber|Auch|Ist|War|Roman|Buch|Novelle|Klassiker|Hier|Dort|Dann|Danach)\b)(?:\p{Lu}[\p{L}.'’-]*|von|van|de|der|da|di|del|le|la|y|ibn|bin)){0,3})/gu;

function splitLoose(text: string): RefPart[] {
  const parts: RefPart[] = [];
  let last = 0;
  for (const m of text.matchAll(LOOSE_REF)) {
    const title = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim().replace(/[.,;:]+$/, '');
    if (!title) continue;
    if (m.index! > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    // Ein Punkt nach dem Namen beendet den Satz – ausser nach einer Initiale („J. K. Rowling“)
    const sentenceEnd = /\p{L}{2,}\.$/u.test(m[6]) ? 1 : 0;
    parts.push({ type: 'book', title, author: m[6].slice(0, m[6].length - sentenceEnd).trim() });
    last = m.index! + m[0].length - sentenceEnd;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

/** Zerlegt eine Antwort in Text und Buchverweise ([[Titel|Autor]] und übliche Schreibweisen). */
export function parseBookRefs(text: string): RefPart[] {
  const parts: RefPart[] = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(...splitLoose(text.slice(last, m.index)));
    parts.push({ type: 'book', title: m[1].trim(), author: m[2].trim() });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(...splitLoose(text.slice(last)));
  return parts;
}
