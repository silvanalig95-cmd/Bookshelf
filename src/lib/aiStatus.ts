/** Leichtgewichtige Prüfung, welche KI verfügbar ist – ohne eine KI-Anbindung zu laden. */
import type { AiConfig, AiProvider, AiVia } from './aiPrompts';
import { localApiStatus } from './goodreads';

export type { AiProvider, AiVia } from './aiPrompts';

export const AI_MODEL_NAMES: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export interface AiSettings {
  aiProvider: AiProvider;
  aiApiKey: string;
  aiModel: string;
  geminiApiKey: string;
  geminiModel: string;
}

export interface AiAccess {
  available: boolean;
  provider?: AiProvider;
  via?: AiVia;
}

let serverStatus: Promise<Record<AiProvider, boolean>> | undefined;

/**
 * Bevorzugt den gewählten Anbieter (Server-Schlüssel vor Browser-Schlüssel) und weicht auf den
 * anderen aus, wenn nur für ihn ein Schlüssel da ist.
 */
export async function aiAvailability(s: AiSettings): Promise<AiAccess> {
  serverStatus ??= localApiStatus().then((st) => ({ claude: st.ai, gemini: st.gemini }));
  const server = await serverStatus;
  const order: AiProvider[] = s.aiProvider === 'claude' ? ['claude', 'gemini'] : ['gemini', 'claude'];
  for (const provider of order) {
    if (server[provider]) return { available: true, provider, via: 'server' };
    if ((provider === 'claude' ? s.aiApiKey : s.geminiApiKey).trim()) return { available: true, provider, via: 'browser' };
  }
  return { available: false };
}

export function aiConfigFor(access: AiAccess, s: AiSettings): AiConfig | undefined {
  if (!access.available || !access.provider || !access.via) return undefined;
  const claude = access.provider === 'claude';
  return { provider: access.provider, via: access.via, key: claude ? s.aiApiKey : s.geminiApiKey, model: claude ? s.aiModel : s.geminiModel };
}

/** Server-Status neu abfragen (z. B. nach Änderungen in den Einstellungen). */
export function resetAiStatus() {
  serverStatus = undefined;
}
