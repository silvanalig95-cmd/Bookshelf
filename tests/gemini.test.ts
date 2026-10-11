import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiRecommendationSchema, type AiConfig, type ChatTurn } from '../src/lib/aiPrompts';
import { aiAvailability, aiConfigFor, resetAiStatus } from '../src/lib/aiStatus';
import { geminiChat, geminiRecommend, geminiSchema } from '../src/lib/gemini';

const browser: AiConfig = { provider: 'gemini', via: 'browser', key: 'test-key', model: 'gemini-3.8-flash' };
const answer = {
  understanding: 'Ein heiterer Sonntagsroman.',
  search: { genres: ['humor', 'erfunden'], moods: [], places: [], eras: [], keywords: ['sunday'], pages_max: 250, pages_min: null },
  recommendations: [{ title: 'Momo', original_title: null, author: 'Michael Ende', year: 1973, german_edition: true, why: 'Weil.', tags: ['zeitlos'] }],
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function stubFetch(responses: Array<() => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('keine Antwort mehr vorbereitet');
    return next();
  });
  return calls;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const candidate = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] });

afterEach(() => {
  vi.unstubAllGlobals();
  resetAiStatus();
});

describe('Gemini: Empfehlungen', () => {
  it('fragt mit Schema und Denkstufe an und liest die Antwort (ohne Gedanken, mit Code-Zaun)', async () => {
    const calls = stubFetch([json(candidate([{ text: 'Ich überlege …', thought: true }, { text: '```json\n' + JSON.stringify(answer) + '\n```' }]))]);
    const r = await geminiRecommend('ein heiterer Roman', browser, 'Kontext');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('test-key');
    expect(calls[0].body.systemInstruction.parts[1].text).toBe('Lesekontext der Person:\nKontext');
    expect(calls[0].body.contents[0]).toMatchObject({ role: 'user' });
    expect(calls[0].body.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON');
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(r.recommendations[0].title).toBe('Momo');
    expect(r.search.genres).toEqual(['humor']); // erfundene IDs fliegen raus
    expect(r.note).toBeUndefined();
  });

  it('weicht auf das ältere Schema-Feld aus, wenn die Schnittstelle responseFormat nicht kennt', async () => {
    const calls = stubFetch([
      json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "responseFormat" at generation_config' } }, 400),
      json(candidate([{ text: JSON.stringify(answer) }])),
    ]);
    const r = await geminiRecommend('x', browser, '');
    expect(calls[1].body.generationConfig.responseFormat).toBeUndefined();
    expect(calls[1].body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[1].body.generationConfig.responseJsonSchema).toBeDefined();
    expect(r.recommendations).toHaveLength(1);
  });

  it('nimmt Flash-Lite, wenn das Gratis-Kontingent von Flash aufgebraucht ist', async () => {
    const calls = stubFetch([json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 429), json(candidate([{ text: JSON.stringify(answer) }]))]);
    const r = await geminiRecommend('x', browser, '');
    expect(calls[1].url).toContain('/models/gemini-3.5-flash-lite:generateContent');
    expect(r.note).toContain('Gemini 3.5 Flash-Lite');
  });

  it('erklärt Fehler verständlich', async () => {
    stubFetch([json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }, 400)]);
    await expect(geminiRecommend('x', browser, '')).rejects.toThrow('Gemini-API-Schlüssel ist ungültig');

    stubFetch([json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429), json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429)]);
    await expect(geminiRecommend('x', browser, '')).rejects.toThrow('Gratis-Kontingent');

    stubFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })]);
    await expect(geminiRecommend('x', browser, '')).rejects.toThrow('abgelehnt');

    stubFetch([json(candidate([{ text: '{"halb' }], 'MAX_TOKENS'))]);
    await expect(geminiRecommend('x', browser, '')).rejects.toThrow('abgeschnitten');

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(geminiRecommend('x', browser, '')).rejects.toThrow('Keine Verbindung zu Gemini');
  });

  it('geht über den eigenen Server, ohne Schlüssel im Browser', async () => {
    const calls = stubFetch([json({ error: 'GEMINI_API_KEY ist auf dem Server nicht gesetzt.' }, 503)]);
    await expect(geminiRecommend('x', { ...browser, via: 'server', key: '' }, '')).rejects.toThrow('GEMINI_API_KEY ist auf dem Server nicht gesetzt.');
    expect(calls[0].url).toBe('http://localhost/api/gemini/v1beta/models/gemini-3.8-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBeUndefined();
  });

  it('übersetzt das Antwortschema in den von Gemini unterstützten Teil von JSON Schema', () => {
    const schema = JSON.stringify(geminiSchema(AiRecommendationSchema));
    expect(schema).not.toContain('$schema');
    expect(schema).not.toMatch(/"type":\[/);
    expect(schema).toContain('"anyOf":[{"type":"number"},{"type":"null"}]');
    expect(schema).toContain('"enum":["literatur"');
  });
});

describe('Gemini: KI-Bibliothekar', () => {
  function sse(chunks: string[]) {
    return () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
  }

  it('streamt die Antwort und merkt sich die Denk-Signatur für den nächsten Schritt', async () => {
    const first = `data: ${JSON.stringify(candidate([{ text: 'Gedanke', thought: true }]))}\r\n\r\n`;
    const second = `data: ${JSON.stringify(candidate([{ text: 'Lies ' }]))}\r\n\r\n`;
    const third = `data: ${JSON.stringify(candidate([{ text: '[[Momo|Michael Ende]]', thoughtSignature: 'sig-1' }], 'STOP'))}\r\n\r\n`;
    // absichtlich mitten im Ereignis zerschnitten
    const calls = stubFetch([sse([first + second.slice(0, 20), second.slice(20) + third])]);
    const history: ChatTurn[] = [
      { role: 'user', text: 'Hallo' },
      { role: 'assistant', text: 'Von Claude', provider: 'claude', raw: [{ type: 'thinking' }] },
      { role: 'user', text: 'Und jetzt?' },
    ];
    const deltas: string[] = [];
    const reply = await geminiChat(history, browser, 'Kontext', (d) => deltas.push(d));
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(calls[0].body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hallo' }] },
      { role: 'model', parts: [{ text: 'Von Claude' }] }, // Claude-Rohform passt nicht zu Gemini
      { role: 'user', parts: [{ text: 'Und jetzt?' }] },
    ]);
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(deltas).toEqual(['Lies ', '[[Momo|Michael Ende]]']);
    expect(reply).toMatchObject({ text: 'Lies [[Momo|Michael Ende]]', provider: 'gemini', model: 'gemini-3.8-flash' });
    expect(reply.raw).toEqual([{ text: 'Lies [[Momo|Michael Ende]]', thoughtSignature: 'sig-1' }]);

    // Die eigene Rohform geht beim nächsten Mal unverändert zurück
    const again = stubFetch([sse([third])]);
    await geminiChat([...history, { role: 'assistant', text: reply.text, provider: 'gemini', raw: reply.raw }, { role: 'user', text: 'Mehr' }], browser, '', () => undefined);
    expect(again[0].body.contents[3]).toEqual({ role: 'model', parts: [{ text: 'Lies [[Momo|Michael Ende]]', thoughtSignature: 'sig-1' }] });
  });

  it('meldet eine leere oder abgelehnte Antwort', async () => {
    stubFetch([sse([`data: ${JSON.stringify(candidate([], 'SAFETY'))}\n\n`])]);
    await expect(geminiChat([{ role: 'user', text: 'x' }], browser, '', () => undefined)).rejects.toThrow('abgelehnt');
  });
});

describe('Welche KI antwortet?', () => {
  const settings = { aiProvider: 'gemini' as const, aiApiKey: '', aiModel: 'claude-opus-5-5', geminiApiKey: '', geminiModel: 'gemini-3.8-flash' };
  const status = (ai: boolean, gemini: boolean) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ goodreads: true, ai, gemini, sync: false, user: null }), { headers: { 'content-type': 'application/json' } }));

  it('bevorzugt den gewählten Anbieter, Server vor Browser', async () => {
    status(true, true);
    expect(await aiAvailability(settings)).toEqual({ available: true, provider: 'gemini', via: 'server' });
    resetAiStatus();
    status(false, false);
    expect(await aiAvailability({ ...settings, geminiApiKey: 'k' })).toEqual({ available: true, provider: 'gemini', via: 'browser' });
  });

  it('weicht auf den anderen Anbieter aus, wenn nur dafür ein Schlüssel da ist', async () => {
    status(true, false);
    const access = await aiAvailability(settings);
    expect(access).toEqual({ available: true, provider: 'claude', via: 'server' });
    expect(aiConfigFor(access, settings)).toEqual({ provider: 'claude', via: 'server', key: '', model: 'claude-opus-5-5' });
    resetAiStatus();
    status(false, false);
    expect(await aiAvailability(settings)).toEqual({ available: false });
  });
});
