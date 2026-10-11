/** Leichtgewichtige Prüfung, welche KI verfügbar ist – ohne eine KI-Anbindung zu laden. */
import type { AiConfig, AiProvider, AiVia, CompatProvider } from './aiPrompts';
import { localApiStatus } from './goodreads';

export type { AiProvider, AiVia } from './aiPrompts';

export const AI_MODEL_NAMES: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

const NAMES: Record<AiProvider, string> = { gemini: 'Gemini', claude: 'Claude', mistral: 'Mistral', groq: 'Groq', openrouter: 'OpenRouter' };
export const providerName = (p: AiProvider) => NAMES[p];

/** Reihenfolge der Ausweich-Kanäle: Mistral (gutes Deutsch), Groq (schnell), OpenRouter (Gratis-Router). */
export const COMPAT_ORDER: CompatProvider[] = ['mistral', 'groq', 'openrouter'];

export interface AiSettings {
  aiProvider: 'gemini' | 'claude';
  aiApiKey: string;
  aiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  fallbackChannels?: boolean;
  mistralApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
  mistralModel?: string;
  groqModel?: string;
  openrouterModel?: string;
}

export interface AiChannel {
  provider: AiProvider;
  via: AiVia;
}

export interface AiAccess {
  available: boolean;
  /** Erster (bevorzugter) Kanal. */
  provider?: AiProvider;
  via?: AiVia;
  /** Alle nutzbaren Kanäle in Versuchsreihenfolge. */
  channels?: AiChannel[];
  /** Läuft ein Lesekompass-Server, der Anfragen weiterreichen kann? */
  relay?: boolean;
}

interface ServerKeys {
  relay: boolean;
  keys: Partial<Record<AiProvider, boolean>>;
}

let serverStatus: Promise<ServerKeys> | undefined;

function browserKey(s: AiSettings, p: AiProvider): string {
  const keys: Record<AiProvider, string | undefined> = {
    gemini: s.geminiApiKey,
    claude: s.aiApiKey,
    mistral: s.mistralApiKey,
    groq: s.groqApiKey,
    openrouter: s.openrouterApiKey,
  };
  return (keys[p] ?? '').trim();
}

/**
 * Alle nutzbaren Kanäle: zuerst der gewählte Hauptanbieter (Server-Schlüssel vor Browser-Schlüssel),
 * dann die Gratis-Ausweich-Kanäle, zuletzt der andere Hauptanbieter.
 */
export async function aiAvailability(s: AiSettings): Promise<AiAccess> {
  serverStatus ??= localApiStatus().then((st) => ({ relay: st.goodreads, keys: { claude: st.ai, gemini: st.gemini, ...st.llm } }));
  const server = await serverStatus;
  const main: AiProvider[] = s.aiProvider === 'claude' ? ['claude', 'gemini'] : ['gemini', 'claude'];
  const order: AiProvider[] = s.fallbackChannels === false ? main : [main[0], ...COMPAT_ORDER, main[1]];
  const channels: AiChannel[] = [];
  for (const provider of order) {
    if (server.keys[provider]) channels.push({ provider, via: 'server' });
    else if (browserKey(s, provider)) channels.push({ provider, via: 'browser' });
  }
  if (!channels.length) return { available: false, relay: server.relay };
  return { available: true, provider: channels[0].provider, via: channels[0].via, channels, relay: server.relay };
}

function configFor(channel: AiChannel, s: AiSettings, relay: boolean): AiConfig {
  const models: Record<AiProvider, string | undefined> = {
    gemini: s.geminiModel,
    claude: s.aiModel,
    mistral: s.mistralModel,
    groq: s.groqModel,
    openrouter: s.openrouterModel,
  };
  return { provider: channel.provider, via: channel.via, key: browserKey(s, channel.provider), model: models[channel.provider] ?? '', relay };
}

/** Konfiguration des ersten Kanals – mit den übrigen als Ausweich-Kanäle. */
export function aiConfigFor(access: AiAccess, s: AiSettings): AiConfig | undefined {
  if (!access.available || !access.channels?.length) return undefined;
  const [first, ...rest] = access.channels.map((c) => configFor(c, s, Boolean(access.relay)));
  return { ...first, fallbacks: rest };
}

/** Server-Status neu abfragen (z. B. nach Änderungen in den Einstellungen). */
export function resetAiStatus() {
  serverStatus = undefined;
}
