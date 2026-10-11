/**
 * Optionale KI-Funktionen: Wunsch → Empfehlungen, der KI-Bibliothekar und Kurzbeschreibungen.
 *
 * Hauptanbieter ist Google Gemini (Gratis-Kontingent) oder Claude. Antwortet er nicht – meist,
 * weil das Gratis-Kontingent aufgebraucht ist –, kommen der Reihe nach die Ausweich-Kanäle zum
 * Zug (AiConfig.fallbacks: Mistral, Groq, OpenRouter, der jeweils andere Hauptanbieter).
 * Die Anbindungen werden erst geladen, wenn sie gebraucht werden.
 */
import { AiError, type AiConfig, type AiProvider, type AiRecommendResult, type AiTaskOptions, type ChatReply, type ChatTurn } from './aiPrompts';

export { AiError, BLURB_SYSTEM, blurbPrompt, compactReadingContext, parseBookRefs, readingContext, CHAT_INSTRUCTIONS } from './aiPrompts';
export type { AiConfig, AiProvider, AiRecommendation, AiRecommendResult, AiVia, ChatReply, ChatTurn } from './aiPrompts';
export { aiAvailability, aiConfigFor, providerName, resetAiStatus, AI_MODEL_NAMES } from './aiStatus';

const NAMES: Record<AiProvider, string> = { gemini: 'Gemini', claude: 'Claude', mistral: 'Mistral', groq: 'Groq', openrouter: 'OpenRouter' };

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Probiert die Kanäle der Reihe nach. Bei gestreamten Antworten nur, solange noch kein Text
 * angezeigt wurde – sonst stünden zwei halbe Antworten untereinander.
 */
export async function withFallback<T extends { note?: string }>(config: AiConfig, run: (c: AiConfig, markEmitted: () => void) => Promise<T>): Promise<T> {
  const channels = [config, ...(config.fallbacks ?? [])];
  const failed: Array<{ config: AiConfig; err: unknown }> = [];
  for (const channel of channels) {
    let emitted = false;
    try {
      const result = await run(channel, () => {
        emitted = true;
      });
      if (!failed.length) return result;
      const first = NAMES[failed[0].config.provider];
      const note = `${first} antwortet gerade nicht (${shortReason(failed[0].err)}) – diese Antwort kommt von ${NAMES[channel.provider]}.`;
      return { ...result, note: [note, result.note].filter(Boolean).join(' ') };
    } catch (err) {
      if (isAbort(err) || emitted) throw err;
      failed.push({ config: channel, err });
    }
  }
  const first = failed[0]?.err;
  if (failed.length > 1 && first instanceof Error) {
    throw new AiError(`${first.message} Auch die Ausweich-Kanäle (${failed.slice(1).map((f) => NAMES[f.config.provider]).join(', ')}) haben nicht geantwortet.`);
  }
  throw first;
}

function shortReason(err: unknown): string {
  const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: unknown }).status) : 0;
  if (status === 429) return 'Kontingent aufgebraucht';
  if (status >= 500) return 'überlastet';
  if (status === 401 || status === 403) return 'Schlüssel abgelehnt';
  if (status === 0 && err instanceof Error && /Verbindung/.test(err.message)) return 'keine Verbindung';
  return 'Fehler';
}

export async function aiRecommend(
  wish: string,
  config: AiConfig,
  context: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<AiRecommendResult> {
  return withFallback(config, async (c) => {
    if (c.provider === 'gemini') return (await import('./gemini')).geminiRecommend(wish, c, context, options);
    if (c.provider === 'claude') return (await import('./claude')).claudeRecommend(wish, c, context, options);
    return (await import('./openaiCompat')).compatRecommend(wish, c, context, options);
  });
}

export async function aiChat(history: ChatTurn[], config: AiConfig, context: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  return withFallback(config, async (c, markEmitted) => {
    const tracked = (delta: string) => {
      markEmitted();
      onText(delta);
    };
    if (c.provider === 'gemini') return (await import('./gemini')).geminiChat(history, c, context, tracked, signal);
    if (c.provider === 'claude') return (await import('./claude')).claudeChat(history, c, context, tracked, signal);
    return (await import('./openaiCompat')).compatChat(history, c, context, tracked, signal);
  });
}

/** Ein Auftrag mit freier Textantwort, gestreamt. */
export async function aiText(config: AiConfig, systemParts: string[], prompt: string, onText: (delta: string) => void, opts: AiTaskOptions = {}): Promise<ChatReply> {
  return withFallback(config, async (c, markEmitted) => {
    const tracked = (delta: string) => {
      markEmitted();
      onText(delta);
    };
    if (c.provider === 'gemini') return (await import('./gemini')).geminiText(c, systemParts, prompt, tracked, opts);
    if (c.provider === 'claude') return (await import('./claude')).claudeText(c, systemParts, prompt, tracked, opts);
    return (await import('./openaiCompat')).compatText(c, systemParts, prompt, tracked, opts);
  });
}

/** Alle Anbindungen werfen bereits verständliche Meldungen (AiError). */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return 'Abgebrochen.';
  if (err instanceof Error) return err.message;
  return String(err);
}
