import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLocalApiHandler, fetchGoodreadsRss } from '../server/localApi';

function fakeRes() {
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  return Object.assign(res, {
    setHeader: (k: string, v: string) => (res.headers[k] = v),
    end: (b?: string) => (res.body = b ?? ''),
  }) as unknown as ServerResponse & { body: string; headers: Record<string, string> };
}

function fakeReq(url: string, remoteAddress = '127.0.0.1') {
  return { url, method: 'GET', headers: {}, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('Lokale API', () => {
  it('meldet ihren Status', async () => {
    const res = fakeRes();
    await createLocalApiHandler({ anthropicApiKey: 'x' })(fakeReq('/api/status'), res, () => undefined);
    expect(JSON.parse(res.body)).toEqual({ goodreads: true, ai: true, gemini: false, llm: { mistral: false, groq: false, openrouter: false }, sync: false, blurbs: false, user: null });
  });

  it('ist nur lokal erreichbar', async () => {
    const res = fakeRes();
    await createLocalApiHandler({})(fakeReq('/api/status', '192.168.1.20'), res, () => undefined);
    expect(res.statusCode).toBe(403);
  });

  it('reicht andere Pfade weiter', async () => {
    let called = false;
    await createLocalApiHandler({})(fakeReq('/index.html'), fakeRes(), () => (called = true));
    expect(called).toBe(true);
  });

  it('lehnt ungültige Goodreads-Parameter ab, ohne Goodreads zu fragen', async () => {
    expect((await fetchGoodreadsRss(new URLSearchParams({ user: 'abc' }))).status).toBe(400);
    expect((await fetchGoodreadsRss(new URLSearchParams({ user: '1', shelf: 'x y' }))).status).toBe(400);
    expect((await fetchGoodreadsRss(new URLSearchParams({ user: '1', page: '500' }))).status).toBe(400);
  });

  it('gibt ohne Schlüssel keinen Claude-Zugang', async () => {
    const res = fakeRes();
    await createLocalApiHandler({})({ ...fakeReq('/api/anthropic/v1/messages'), method: 'POST' } as IncomingMessage, res, () => undefined);
    expect(res.statusCode).toBe(503);
  });
});
