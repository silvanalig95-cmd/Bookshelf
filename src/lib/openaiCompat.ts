/**
 * Ausweich-Kanäle mit OpenAI-kompatibler Schnittstelle: Mistral, Groq und OpenRouter – alle mit
 * Gratis-Kontingent. Sie springen ein, wenn Gemini (oder Claude) gerade nicht antwortet.
 *
 * Die Modellnamen dieser Anbieter wechseln oft. Ist kein Modell eingestellt, fragt die App die
 * aktuelle Modellliste ab und nimmt das erste aus der Wunschliste, das es gibt.
 */
import {
  AiError,
  AiRecommendationSchema,
  BASE_SYSTEM,
  CHAT_INSTRUCTIONS,
  parseRecommendationJson,
  recommendInstruction,
  vocabulary,
  type AiConfig,
  type AiRecommendResult,
  type AiTaskOptions,
  type ChatReply,
  type ChatTurn,
  type CompatProvider,
} from './aiPrompts';
import { sseData } from './sse';
import { z } from 'zod';

export interface CompatInfo {
  name: string;
  base: string;
  /** Wo man einen (Gratis-)Schlüssel bekommt. */
  keyUrl: string;
  /** Bevorzugte Modelle, das erste vorhandene gewinnt. */
  prefer: string[];
  note: string;
}

export const COMPAT: Record<CompatProvider, CompatInfo> = {
  mistral: {
    name: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    prefer: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-small-4', 'mistral-large-latest'],
    note: 'Gratis-Plan „Experiment“, sehr gutes Deutsch',
  },
  groq: {
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    prefer: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'],
    note: 'Gratis, sehr schnell, Tageslimit je Modell',
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    prefer: ['openrouter/free'],
    note: 'Gratis-Modelle über den „Free Router“, rund 50 Anfragen pro Tag',
  },
};

export const COMPAT_PROVIDERS = Object.keys(COMPAT) as CompatProvider[];

export class CompatError extends AiError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function target(config: AiConfig, path: string): { url: string; headers: Record<string, string> } {
  const provider = config.provider as CompatProvider;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Über den eigenen Server: Server-Schlüssel – oder der Browser-Schlüssel wird nur durchgereicht
  if (config.via === 'server' || config.relay) {
    if (config.via === 'browser') headers['x-llm-key'] = config.key.trim();
    const base = globalThis.location?.href ?? 'http://localhost/';
    return { url: new URL(`./api/llm/${provider}${path}`, base).toString(), headers };
  }
  headers.authorization = `Bearer ${config.key.trim()}`;
  if (provider === 'openrouter') headers['x-title'] = 'Lesekompass';
  return { url: `${COMPAT[provider].base}${path}`, headers };
}

function friendly(status: number, message: string, name: string): string {
  if (status === 401 || /invalid api key|unauthorized|invalid_api_key/i.test(message)) return `Der ${name}-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.`;
  if (status === 429) return `Das Gratis-Kontingent von ${name} ist gerade aufgebraucht.`;
  if (status === 402) return `${name} verlangt für dieses Modell ein Guthaben.`;
  if (status === 404) return `Das gewählte ${name}-Modell gibt es nicht (mehr).`;
  if (status >= 500) return `${name} ist gerade überlastet.`;
  return `${name}-Fehler (${status})${message ? `: ${message.slice(0, 200)}` : ''}`;
}

async function request(config: AiConfig, path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<Response> {
  const name = COMPAT[config.provider as CompatProvider].name;
  const { url, headers } = target(config, path);
  let res: Response;
  try {
    res = await fetch(url, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new CompatError(`Keine Verbindung zu ${name}.`, 0);
  }
  if (res.ok) return res;
  let message = '';
  try {
    const body = (await res.json()) as { error?: string | { message?: string }; message?: string; detail?: string };
    message = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? body.detail ?? '');
  } catch {
    /* keine JSON-Antwort */
  }
  // Meldungen des eigenen Servers (kein Schlüssel hinterlegt …) unverändert zeigen
  if (config.via === 'server' && (res.status === 503 || res.status === 403) && message) throw new CompatError(message, res.status);
  throw new CompatError(friendly(res.status, message, name), res.status);
}

const modelCache = new Map<string, Promise<string>>();

/** Eingestelltes Modell oder das erste vorhandene aus der Wunschliste. */
export function resolveModel(config: AiConfig, signal?: AbortSignal): Promise<string> {
  if (config.model.trim()) return Promise.resolve(config.model.trim());
  const info = COMPAT[config.provider as CompatProvider];
  const key = `${config.provider}|${config.via}`;
  let found = modelCache.get(key);
  if (!found) {
    found = request(config, '/models', { method: 'GET', signal })
      .then((r) => r.json() as Promise<{ data?: Array<{ id: string }> }>)
      .then((d) => pickModel(info.prefer, (d.data ?? []).map((m) => m.id)))
      .catch(() => info.prefer[0]);
    modelCache.set(key, found);
    // Schlug die Abfrage fehl, beim nächsten Mal neu versuchen
    found.then((m) => m === info.prefer[0] && modelCache.delete(key));
  }
  return found;
}

export function pickModel(prefer: string[], available: string[]): string {
  if (!available.length) return prefer[0];
  for (const p of prefer) if (available.includes(p)) return p;
  // Verwandtes Modell derselben Familie (z. B. eine neuere Version)
  for (const p of prefer) {
    const family = p.replace(/-latest$|-\d[\w.-]*$/, '');
    const match = available.find((a) => a.startsWith(family));
    if (match) return match;
  }
  return prefer[0];
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Completion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string; code?: number | string };
}

async function chat(config: AiConfig, messages: Message[], onText: (delta: string) => void, opts: AiTaskOptions & { json?: boolean } = {}): Promise<ChatReply> {
  const info = COMPAT[config.provider as CompatProvider];
  const model = await resolveModel(config, opts.signal);
  const body = {
    model,
    messages,
    stream: !opts.json,
    max_tokens: opts.light ? 1200 : 4000,
    temperature: opts.json ? 0.4 : 0.7,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await request(config, '/chat/completions', { method: 'POST', body, signal: opts.signal });
  let text = '';
  let served = model;
  let finish: string | null | undefined;
  if (opts.json) {
    const data = (await res.json()) as Completion;
    text = data.choices?.[0]?.message?.content ?? '';
    served = data.model ?? model;
    finish = data.choices?.[0]?.finish_reason;
  } else {
    if (!res.body) throw new CompatError(`${info.name} hat keine Antwort geliefert.`, 502);
    for await (const data of sseData(res.body)) {
      if (data.trim() === '[DONE]') break;
      let chunk: Completion;
      try {
        chunk = JSON.parse(data) as Completion;
      } catch {
        continue;
      }
      if (chunk.error) throw new CompatError(`${info.name}: ${chunk.error.message ?? 'Fehler'}`, Number(chunk.error.code) || 500);
      if (chunk.model) served = chunk.model;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onText(delta);
      }
      finish = chunk.choices?.[0]?.finish_reason ?? finish;
    }
  }
  // Manche Modelle schreiben ihr „Nachdenken“ in <think>…</think> – das gehört nicht in die Antwort
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  if (!text) throw new CompatError(`${info.name} hat keine Antwort geliefert.`, 502);
  return { text, raw: undefined, provider: config.provider, model: served, note: finish === 'length' ? 'Die Antwort wurde wegen ihrer Länge abgeschnitten.' : undefined };
}

export function compatText(config: AiConfig, systemParts: string[], prompt: string, onText: (delta: string) => void, opts: AiTaskOptions = {}): Promise<ChatReply> {
  return chat(config, [{ role: 'system', content: systemParts.join('\n\n') }, { role: 'user', content: prompt }], onText, opts);
}

export function compatChat(history: ChatTurn[], config: AiConfig, context: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  const messages: Message[] = [
    { role: 'system', content: `${BASE_SYSTEM}\n\n${CHAT_INSTRUCTIONS}\n\nLesekontext der Person:\n${context}` },
    ...history.map((t): Message => ({ role: t.role, content: t.text })),
  ];
  return chat(config, messages, onText, { signal });
}

export async function compatRecommend(wish: string, config: AiConfig, context: string, options: { count?: number; signal?: AbortSignal } = {}): Promise<AiRecommendResult> {
  const info = COMPAT[config.provider as CompatProvider];
  const schema = JSON.stringify(z.toJSONSchema(AiRecommendationSchema));
  const reply = await chat(
    config,
    [
      { role: 'system', content: `${BASE_SYSTEM}\n\nVokabular für die Suchparameter:\n${vocabulary()}\n\nLesekontext der Person:\n${context}` },
      {
        role: 'user',
        content: `${recommendInstruction(wish, options.count ?? 8)}\n\nAntworte ausschliesslich mit einem JSON-Objekt nach diesem JSON-Schema (ohne Erklärtext):\n${schema}`,
      },
    ],
    () => {},
    { signal: options.signal, json: true },
  );
  return parseRecommendationJson(reply.text, info.name);
}
