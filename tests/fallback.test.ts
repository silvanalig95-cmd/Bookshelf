import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlurbStore } from '../server/blurbStore';
import { createLocalApiHandler } from '../server/localApi';
import { aiRecommend, aiText } from '../src/lib/ai';
import type { AiConfig } from '../src/lib/aiPrompts';
import { aiAvailability, aiConfigFor, resetAiStatus, type AiSettings } from '../src/lib/aiStatus';
import { pickModel } from '../src/lib/openaiCompat';

const answer = {
  understanding: 'Heiter.',
  search: { genres: ['humor'], moods: [], places: [], eras: [], keywords: [], pages_max: null, pages_min: null },
  recommendations: [{ title: 'Momo', original_title: null, author: 'Michael Ende', year: 1973, german_edition: true, why: 'Weil.', tags: [] }],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, any>;
}

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body)) : undefined };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const quota = () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 429);

const gemini: AiConfig = { provider: 'gemini', via: 'browser', key: 'g', model: 'gemini-3.8-flash' };
const mistral: AiConfig = { provider: 'mistral', via: 'browser', key: 'm', model: '' };

afterEach(() => {
  vi.unstubAllGlobals();
  resetAiStatus();
});

describe('Ausweich-Kanäle', () => {
  it('springt nach erschöpftem Gemini-Kontingent (alle Modelle) auf Mistral um', async () => {
    const calls = stubFetch((c) => {
      if (c.url.includes('generativelanguage')) return quota();
      if (c.url.endsWith('/models')) return json({ data: [{ id: 'mistral-large-latest' }, { id: 'mistral-small-latest' }] });
      return sse({ model: 'mistral-small-2609', choices: [{ delta: { content: 'Hallo ' } }] }, { choices: [{ delta: { content: 'Welt' }, finish_reason: 'stop' }] }, '[DONE]');
    });
    let streamed = '';
    const reply = await aiText({ ...gemini, fallbacks: [mistral] }, ['System'], 'Prompt', (d) => (streamed += d), { light: true });
    expect(calls.filter((c) => c.url.includes('generativelanguage'))).toHaveLength(4);
    const chat = calls.at(-1)!;
    expect(chat.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(chat.headers.authorization).toBe('Bearer m');
    expect(chat.body).toMatchObject({ model: 'mistral-small-latest', stream: true, messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Prompt' }] });
    expect(reply).toMatchObject({ text: 'Hallo Welt', provider: 'mistral', model: 'mistral-small-2609' });
    expect(streamed).toBe('Hallo Welt');
    expect(reply.note).toContain('Gemini antwortet gerade nicht (Kontingent aufgebraucht)');
    expect(reply.note).toContain('Mistral');
  });

  it('wechselt nicht mehr, wenn schon Text angezeigt wurde', async () => {
    const calls = stubFetch(() =>
      sse({ candidates: [{ content: { parts: [{ text: 'Halb' }] } }] }, { error: { code: 500, status: 'INTERNAL', message: 'kaputt' } }),
    );
    await expect(aiText({ ...gemini, fallbacks: [mistral] }, ['S'], 'P', () => {})).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('fragt Empfehlungen als JSON an und liest sie auch mit Code-Zaun', async () => {
    const calls = stubFetch((c) =>
      c.url.endsWith('/models') ? json({ data: [] }) : json({ model: 'openai/gpt-oss-120b', choices: [{ message: { content: '```json\n' + JSON.stringify(answer) + '\n```' } }] }),
    );
    const r = await aiRecommend('heiter', { provider: 'groq', via: 'browser', key: 'q', model: '' }, 'Kontext');
    expect(r.recommendations[0].title).toBe('Momo');
    expect(calls.at(-1)!.body).toMatchObject({ model: 'openai/gpt-oss-120b', response_format: { type: 'json_object' }, stream: false });
  });

  it('meldet, wenn alle Kanäle versagen', async () => {
    stubFetch((c) => (c.url.includes('generativelanguage') ? quota() : c.url.endsWith('/models') ? json({ data: [] }) : json({ error: { message: 'rate limit' } }, 429)));
    await expect(aiText({ ...gemini, fallbacks: [mistral] }, ['S'], 'P', () => {})).rejects.toThrow(/Gratis-Kontingent.*Auch die Ausweich-Kanäle \(Mistral\)/);
  });

  it('geht über den eigenen Server, wenn einer läuft – mit oder ohne Browser-Schlüssel', async () => {
    const calls = stubFetch(() => sse({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]'));
    await aiText({ provider: 'openrouter', via: 'browser', key: 'or', model: 'openrouter/free', relay: true }, ['S'], 'P', () => {});
    expect(calls[0].url).toBe('http://localhost/api/llm/openrouter/chat/completions');
    expect(calls[0].headers['x-llm-key']).toBe('or');
    await aiText({ provider: 'groq', via: 'server', key: '', model: 'x' }, ['S'], 'P', () => {});
    expect(calls[1].url).toBe('http://localhost/api/llm/groq/chat/completions');
    expect(calls[1].headers['x-llm-key']).toBeUndefined();
  });

  it('wählt das erste vorhandene Wunschmodell oder ein verwandtes', () => {
    expect(pickModel(['a-latest', 'b'], ['x', 'b'])).toBe('b');
    expect(pickModel(['mistral-small-latest'], ['mistral-small-2609', 'codestral'])).toBe('mistral-small-2609');
    expect(pickModel(['openrouter/free'], [])).toBe('openrouter/free');
  });

  it('ordnet die Kanäle: Hauptanbieter, Gratis-Ausweichkanäle, anderer Hauptanbieter', async () => {
    stubFetch(() => json({ goodreads: true, ai: true, gemini: true, llm: { groq: true } }));
    const s: AiSettings = { aiProvider: 'gemini', aiApiKey: '', aiModel: 'claude-opus-5-5', geminiApiKey: '', geminiModel: 'gemini-3.8-flash', mistralApiKey: 'm' };
    const access = await aiAvailability(s);
    expect(access.channels).toEqual([
      { provider: 'gemini', via: 'server' },
      { provider: 'mistral', via: 'browser' },
      { provider: 'groq', via: 'server' },
      { provider: 'claude', via: 'server' },
    ]);
    const config = aiConfigFor(access, s)!;
    expect(config.fallbacks?.map((f) => f.provider)).toEqual(['mistral', 'groq', 'claude']);
    expect(config.fallbacks?.[0]).toMatchObject({ key: 'm', relay: true });
    resetAiStatus();
    expect((await aiAvailability({ ...s, fallbackChannels: false })).channels?.map((c) => c.provider)).toEqual(['gemini', 'claude']);
  });
});

/* ---------- Server ---------- */

function request(url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const stream = Readable.from(opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]);
  return Object.assign(stream, { url, method: opts.method ?? 'GET', headers: opts.headers ?? {}, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
}

async function respond(handler: ReturnType<typeof createLocalApiHandler>, req: IncomingMessage) {
  const out = new PassThrough();
  const res = Object.assign(out, { statusCode: 0, headers: {} as Record<string, string>, setHeader: (k: string, v: string) => ((res.headers[k] = v), res) });
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise((r) => out.on('end', r));
  await handler(req, res as unknown as ServerResponse, () => undefined);
  await done;
  return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') };
}

describe('Server: Ausweich-Kanäle und Kurzbeschreibungen', () => {
  it('reicht Anfragen an Mistral & Co. weiter – mit Server- oder Browser-Schlüssel', async () => {
    const calls = stubFetch(() => sse({ choices: [{ delta: { content: 'ok' } }] }));
    const handler = createLocalApiHandler({ llmKeys: { mistral: 'server-key' } });
    const chatReq = (headers: Record<string, string> = {}) =>
      request('/api/llm/mistral/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: { model: 'm', messages: [] } });

    const viaServer = await respond(handler, chatReq());
    expect(viaServer.status).toBe(200);
    expect(viaServer.body).toContain('"ok"');
    expect(calls[0]).toMatchObject({ url: 'https://api.mistral.ai/v1/chat/completions', method: 'POST' });
    expect(calls[0].headers.authorization).toBe('Bearer server-key');

    await respond(handler, chatReq({ 'x-llm-key': 'browser-key' }));
    expect(calls[1].headers.authorization).toBe('Bearer browser-key');

    const noKey = await respond(createLocalApiHandler({}), request('/api/llm/groq/models'));
    expect(noKey.status).toBe(503);
    const foreign = await respond(handler, request('/api/llm/mistral/chat/completions', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: {} }));
    expect(foreign.status).toBe(405);
    expect(calls).toHaveLength(2);
  });

  it('merkt sich Kurzbeschreibungen je Login und schreibt sie in den Datenordner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lk-blurbs-'));
    try {
      const store = new BlurbStore(dir);
      const handler = createLocalApiHandler({ blurbs: store, userOf: (req) => (req.headers['x-user'] as string) ?? null });
      const post = await respond(
        handler,
        request('/api/blurbs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'anna' }, body: { id: 'OL1W', text: 'Worum es geht.', model: 'Gemini' } }),
      );
      expect(post.status).toBe(200);
      const got = await respond(handler, request('/api/blurbs?id=OL1W', { headers: { 'x-user': 'anna' } }));
      expect(JSON.parse(got.body)).toMatchObject({ text: 'Worum es geht.', model: 'Gemini' });
      expect((await respond(handler, request('/api/blurbs?id=OL1W', { headers: { 'x-user': 'ben' } }))).status).toBe(404);
      store.flush();
      expect(JSON.parse(readFileSync(join(dir, 'kurzbeschreibungen.json'), 'utf8'))['anna|OL1W'].text).toBe('Worum es geht.');
      expect(new BlurbStore(dir).get('anna', 'OL1W')?.text).toBe('Worum es geht.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
