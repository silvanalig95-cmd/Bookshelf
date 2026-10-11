/**
 * Claude (Anthropic) für Empfehlungen und den KI-Bibliothekar – über das offizielle SDK.
 *
 * Zwei Wege zum Schlüssel:
 *  - Server: ANTHROPIC_API_KEY – der Browser spricht nur mit /api/anthropic.
 *  - Browser: Schlüssel in den Einstellungen (wird nur in diesem Browser gespeichert).
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  AiError,
  AiRecommendationSchema,
  BASE_SYSTEM,
  CHAT_INSTRUCTIONS,
  recommendInstruction,
  vocabulary,
  type AiConfig,
  type AiRecommendResult,
  type ChatReply,
  type ChatTurn,
} from './aiPrompts';

function makeClient(config: AiConfig): Anthropic {
  if (config.via === 'server') {
    return new Anthropic({
      // Der Server ersetzt diesen Platzhalter durch den echten Schlüssel.
      apiKey: 'lokaler-server',
      baseURL: new URL('./api/anthropic', window.location.href).toString().replace(/\/$/, ''),
      dangerouslyAllowBrowser: true,
    });
  }
  return new Anthropic({ apiKey: config.key.trim(), dangerouslyAllowBrowser: true });
}

/** Server-seitiger Fallback bei Ablehnungen – nicht für Haiku verfügbar. */
function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
  if (model === 'claude-haiku-5-5') return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

/** Übersetzt SDK-Fehler in verständliche Meldungen. */
function friendly(err: unknown): unknown {
  if (err instanceof AiError || (err instanceof Error && err.name === 'AbortError')) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError('Der Claude-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError('Der Schlüssel hat keinen Zugriff auf dieses Modell.');
  if (err instanceof Anthropic.RateLimitError) return new AiError('Zu viele Anfragen an Claude – bitte kurz warten.');
  if (err instanceof Anthropic.BadRequestError) return new AiError(`Claude hat die Anfrage abgelehnt: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Keine Verbindung zu Claude.');
  if (err instanceof Anthropic.APIError) return new AiError(`Claude-Fehler (${err.status ?? '?'}): ${err.message}`);
  return err;
}

export async function claudeRecommend(
  wish: string,
  config: AiConfig,
  context: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<AiRecommendResult> {
  const client = makeClient(config);
  try {
    const response = await client.beta.messages.parse(
      {
        model: config.model,
        max_tokens: 16000,
        ...fallbackParams(config.model),
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'medium', format: betaZodOutputFormat(AiRecommendationSchema) },
        system: [
          { type: 'text', text: `${BASE_SYSTEM}\n\nVokabular für die Suchparameter:\n${vocabulary()}` },
          { type: 'text', text: `Lesekontext der Person:\n${context}` },
        ],
        messages: [{ role: 'user', content: recommendInstruction(wish, options.count ?? 8) }],
      },
      { signal: options.signal },
    );
    if (response.stop_reason === 'refusal') throw new AiError('Claude hat diese Anfrage abgelehnt. Formuliere den Wunsch bitte etwas anders.');
    if (response.stop_reason === 'max_tokens') throw new AiError('Die Antwort war zu lang und wurde abgeschnitten. Bitte nochmal versuchen.');
    const parsed = response.parsed_output;
    if (!parsed) throw new AiError('Die Antwort von Claude konnte nicht gelesen werden.');
    return parsed;
  } catch (err) {
    throw friendly(err);
  }
}

type Message = Anthropic.Beta.BetaMessageParam;

/** Eigene frühere Antworten vollständig zurückgeben (inkl. Denkblöcke), fremde als Text. */
function toMessages(history: ChatTurn[]): Message[] {
  return history.map((t) =>
    t.role === 'assistant' && t.provider === 'claude' && Array.isArray(t.raw)
      ? { role: 'assistant', content: t.raw as Message['content'] }
      : { role: t.role, content: t.text },
  );
}

export async function claudeChat(history: ChatTurn[], config: AiConfig, context: string, onText: (delta: string) => void, signal?: AbortSignal): Promise<ChatReply> {
  const client = makeClient(config);
  try {
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
        messages: toMessages(history),
      },
      { signal },
    );
    stream.on('text', (delta) => onText(delta));
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new AiError('Claude hat diese Anfrage abgelehnt.');
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, raw: message.content, provider: 'claude', model: config.model };
  } catch (err) {
    throw friendly(err);
  }
}
