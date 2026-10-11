/**
 * Optionale KI-Funktionen: Wunsch → Empfehlungen und der KI-Bibliothekar.
 * Anbieter ist Google Gemini (mit Gratis-Kontingent) oder Claude von Anthropic – die
 * jeweilige Anbindung wird erst geladen, wenn sie gebraucht wird.
 */
import type { AiConfig, AiRecommendResult, ChatReply, ChatTurn } from './aiPrompts';

export { AiError, parseBookRefs, readingContext, CHAT_INSTRUCTIONS } from './aiPrompts';
export type { AiConfig, AiProvider, AiRecommendation, AiRecommendResult, AiVia, ChatReply, ChatTurn } from './aiPrompts';
export { aiAvailability, aiConfigFor, resetAiStatus, AI_MODEL_NAMES } from './aiStatus';

export async function aiRecommend(
  wish: string,
  config: AiConfig,
  context: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<AiRecommendResult> {
  if (config.provider === 'gemini') return (await import('./gemini')).geminiRecommend(wish, config, context, options);
  return (await import('./claude')).claudeRecommend(wish, config, context, options);
}

export async function aiChat(history: ChatTurn[], config: AiConfig, context: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  if (config.provider === 'gemini') return (await import('./gemini')).geminiChat(history, config, context, onText, signal);
  return (await import('./claude')).claudeChat(history, config, context, onText, signal);
}

/** Beide Anbindungen werfen bereits verständliche Meldungen (AiError). */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return 'Abgebrochen.';
  if (err instanceof Error) return err.message;
  return String(err);
}
