/**
 * Google Gemini für Empfehlungen und den KI-Bibliothekar – direkt über die REST-Schnittstelle
 * (generateContent / streamGenerateContent), ohne zusätzliche Bibliothek.
 *
 * Schlüssel: GEMINI_API_KEY auf dem Server (der Browser spricht nur mit /api/gemini) oder ein
 * Schlüssel aus Google AI Studio in den Einstellungen. Im Gratis-Tarif gelten Minuten- und
 * Tageslimits; ist das Kontingent von „3.8 Flash“ erschöpft, antwortet „3.5 Flash-Lite“.
 */
import { z } from 'zod';
import {
  AiError,
  AiRecommendationSchema,
  BASE_SYSTEM,
  CHAT_INSTRUCTIONS,
  cleanRecommendation,
  recommendInstruction,
  vocabulary,
  type AiConfig,
  type AiRecommendResult,
  type ChatReply,
  type ChatTurn,
} from './aiPrompts';

export const GEMINI_MODELS: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
};
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const API = 'https://generativelanguage.googleapis.com';

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
}
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}
interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}
type Method = 'generateContent' | 'streamGenerateContent';

const modelName = (id: string) => GEMINI_MODELS[id] ?? id;

/** Fehlerantwort der Gemini-Schnittstelle (oder des eigenen Servers). */
export class GeminiError extends AiError {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
  }
}

function endpoint(config: AiConfig, model: string, method: Method): { url: string; headers: Record<string, string> } {
  const path = `/v1beta/models/${model}:${method}${method === 'streamGenerateContent' ? '?alt=sse' : ''}`;
  if (config.via === 'server') {
    const base = globalThis.location?.href ?? 'http://localhost/';
    return { url: new URL(`./api/gemini${path}`, base).toString(), headers: { 'content-type': 'application/json' } };
  }
  return { url: `${API}${path}`, headers: { 'content-type': 'application/json', 'x-goog-api-key': config.key.trim() } };
}

function friendlyMessage(http: number, status: string, message: string, config: AiConfig): string {
  // Meldungen des eigenen Servers (Schlüssel fehlt, Login nötig) unverändert zeigen
  if (config.via === 'server' && !status && message && (http === 403 || http === 503)) return message;
  if (/api key not valid|api_key_invalid|api key expired/i.test(message) || http === 401) {
    return 'Der Gemini-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen (aistudio.google.com/apikey).';
  }
  if (http === 403) return `Google hat den Gemini-Schlüssel abgelehnt${message ? ` („${message}“)` : ''}. Am einfachsten in Google AI Studio einen neuen Schlüssel erstellen.`;
  if (http === 429) {
    return 'Das Gratis-Kontingent von Gemini ist im Moment aufgebraucht. Nach einer Minute geht es meist wieder; das Tageslimit setzt sich um 9 Uhr (Schweizer Zeit) zurück.';
  }
  if (http === 404) return `Das Modell ${modelName(config.model)} ist für diesen Schlüssel nicht verfügbar – in den Einstellungen ein anderes wählen.`;
  if (http >= 500) return 'Gemini ist gerade überlastet – bitte gleich nochmal versuchen.';
  return `Gemini-Fehler (${http})${message ? `: ${message}` : ''}`;
}

async function errorFrom(res: Response, config: AiConfig): Promise<GeminiError> {
  let message = '';
  let status = '';
  try {
    const body = (await res.json()) as { error?: string | { message?: string; status?: string } };
    if (typeof body.error === 'string') message = body.error;
    else {
      message = body.error?.message ?? '';
      status = body.error?.status ?? '';
    }
  } catch {
    /* keine JSON-Antwort */
  }
  return new GeminiError(friendlyMessage(res.status, status, message, config), res.status, message);
}

/**
 * Schickt die Anfrage – und weicht bei erschöpftem Gratis-Kontingent (HTTP 429) einmal auf
 * Flash-Lite aus, das ein grösseres Kontingent hat.
 */
async function post(config: AiConfig, method: Method, body: unknown, signal?: AbortSignal): Promise<{ res: Response; model: string; note?: string }> {
  const attempt = async (model: string) => {
    const { url, headers } = endpoint(config, model, method);
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new AiError('Keine Verbindung zu Gemini.');
    }
  };
  const res = await attempt(config.model);
  if (res.ok) return { res, model: config.model };
  if (res.status === 429 && config.model !== GEMINI_FALLBACK_MODEL) {
    const second = await attempt(GEMINI_FALLBACK_MODEL);
    if (second.ok) {
      return {
        res: second,
        model: GEMINI_FALLBACK_MODEL,
        note: `Das Gratis-Kontingent von ${modelName(config.model)} ist gerade aufgebraucht – diese Antwort kommt von ${modelName(GEMINI_FALLBACK_MODEL)}.`,
      };
    }
    throw await errorFrom(second, { ...config, model: GEMINI_FALLBACK_MODEL });
  }
  throw await errorFrom(res, config);
}

const REFUSED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

function answerText(data: GenerateResponse): string {
  if (data.promptFeedback?.blockReason) throw new AiError('Gemini hat diese Anfrage abgelehnt. Formuliere den Wunsch bitte etwas anders.');
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new AiError('Die Antwort war zu lang und wurde abgeschnitten. Bitte nochmal versuchen.');
  if (!text && candidate?.finishReason && REFUSED.has(candidate.finishReason)) throw new AiError('Gemini hat diese Anfrage abgelehnt. Formuliere den Wunsch bitte etwas anders.');
  if (!text) throw new AiError('Gemini hat keine Antwort geliefert. Bitte nochmal versuchen.');
  return text;
}

/**
 * JSON-Schema für Gemini: ohne `$schema` und mit `anyOf` statt Typ-Listen wie ["number", "null"] –
 * so bleibt es im dokumentierten Teil von JSON Schema, den Gemini versteht.
 */
export function geminiSchema(schema: z.ZodType): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== '$schema') out[k] = walk(v);
    if (Array.isArray(out.type)) {
      const { type, description, ...rest } = out;
      return { ...(description ? { description } : {}), anyOf: (type as string[]).map((t) => (t === 'null' ? { type: t } : { ...rest, type: t })) };
    }
    return out;
  };
  return walk(z.toJSONSchema(schema));
}

/** Fehlende optionale Felder ergänzen, bevor das Schema streng prüft. */
function withDefaults(raw: unknown): unknown {
  const r = cleanRecommendation(raw) as { recommendations?: Array<Record<string, unknown>>; search?: Record<string, unknown> } | undefined;
  if (!r || typeof r !== 'object') return r;
  r.search = { genres: [], moods: [], places: [], eras: [], keywords: [], pages_max: null, pages_min: null, ...(r.search ?? {}) };
  r.recommendations = (r.recommendations ?? []).map((x) => ({ original_title: null, year: null, german_edition: false, tags: [], why: '', ...x }));
  return r;
}

export function parseRecommendation(text: string): AiRecommendResult {
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new AiError('Die Antwort von Gemini konnte nicht gelesen werden. Bitte nochmal versuchen.');
  }
  const parsed = AiRecommendationSchema.safeParse(withDefaults(data));
  if (!parsed.success) throw new AiError('Die Antwort von Gemini hatte nicht das erwartete Format. Bitte nochmal versuchen.');
  return parsed.data;
}

function system(parts: string[]) {
  return { parts: parts.map((text) => ({ text })) };
}

export async function geminiRecommend(
  wish: string,
  config: AiConfig,
  context: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<AiRecommendResult> {
  const schema = geminiSchema(AiRecommendationSchema);
  const base = {
    systemInstruction: system([`${BASE_SYSTEM}\n\nVokabular für die Suchparameter:\n${vocabulary()}`, `Lesekontext der Person:\n${context}`]),
    contents: [{ role: 'user', parts: [{ text: recommendInstruction(wish, options.count ?? 8) }] }] satisfies Content[],
  };
  const thinking = { maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'MEDIUM' } };
  let result: { res: Response; model: string; note?: string };
  try {
    result = await post(config, 'generateContent', { ...base, generationConfig: { ...thinking, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } } }, options.signal);
  } catch (err) {
    // Ältere Fassung der Schnittstelle: Schema über responseMimeType/responseJsonSchema
    if (!(err instanceof GeminiError) || err.status !== 400 || !/responseFormat|unknown name|invalid json payload/i.test(err.detail)) throw err;
    result = await post(config, 'generateContent', { ...base, generationConfig: { ...thinking, responseMimeType: 'application/json', responseJsonSchema: schema } }, options.signal);
  }
  const data = (await result.res.json()) as GenerateResponse;
  const parsed = parseRecommendation(answerText(data));
  return result.note ? { ...parsed, note: result.note } : parsed;
}

/** Eigene frühere Antworten mit Rohform (Denk-Signatur) zurückgeben, fremde als Text. */
function toContents(history: ChatTurn[]): Content[] {
  return history.map((t) =>
    t.role === 'assistant'
      ? { role: 'model', parts: t.provider === 'gemini' && Array.isArray(t.raw) ? (t.raw as Part[]) : [{ text: t.text }] }
      : { role: 'user', parts: [{ text: t.text }] },
  );
}

/** Zerlegt einen Server-Sent-Events-Strom in die einzelnen `data:`-Inhalte. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = function* (final: boolean) {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : (blocks.pop() ?? '');
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data.trim()) yield data;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    yield* take(false);
  }
  buffer += decoder.decode();
  yield* take(true);
}

export async function geminiChat(history: ChatTurn[], config: AiConfig, context: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  return streamText(config, [`${BASE_SYSTEM}\n\n${CHAT_INSTRUCTIONS}`, `Lesekontext der Person:\n${context}`], toContents(history), onText, signal);
}

/** Ein einzelner Auftrag mit freier Textantwort (z. B. die Kurzbeschreibung auf der Buchseite). */
export async function geminiText(config: AiConfig, systemParts: string[], prompt: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  return streamText(config, systemParts, [{ role: 'user', parts: [{ text: prompt }] }], onText, signal);
}

async function streamText(config: AiConfig, systemParts: string[], contents: Content[], onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  const body = {
    systemInstruction: system(systemParts),
    contents,
    generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'LOW' } },
  };
  const { res, model, note } = await post(config, 'streamGenerateContent', body, signal);
  if (!res.body) throw new AiError('Gemini hat keine Antwort geliefert.');
  let text = '';
  let signature: string | undefined;
  let finish: string | undefined;
  let blocked = false;
  for await (const data of sseData(res.body)) {
    let chunk: GenerateResponse;
    try {
      chunk = JSON.parse(data) as GenerateResponse;
    } catch {
      continue;
    }
    if (chunk.error) throw new GeminiError(friendlyMessage(chunk.error.code ?? 500, chunk.error.status ?? '', chunk.error.message ?? '', config), chunk.error.code ?? 500, chunk.error.message ?? '');
    if (chunk.promptFeedback?.blockReason) blocked = true;
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thoughtSignature) signature = part.thoughtSignature;
      if (part.thought || !part.text) continue;
      text += part.text;
      onText(part.text);
    }
    if (candidate?.finishReason) finish = candidate.finishReason;
  }
  if (!text) {
    if (blocked || (finish && REFUSED.has(finish))) throw new AiError('Gemini hat diese Anfrage abgelehnt.');
    throw new AiError('Gemini hat keine Antwort geliefert. Bitte nochmal versuchen.');
  }
  const cut = finish === 'MAX_TOKENS' ? 'Die Antwort wurde wegen ihrer Länge abgeschnitten.' : undefined;
  return {
    text,
    raw: [{ text, ...(signature ? { thoughtSignature: signature } : {}) }],
    provider: 'gemini',
    model,
    note: [note, cut].filter(Boolean).join(' ') || undefined,
  };
}
