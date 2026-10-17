import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isSameOriginJson } from '../server/localApi';
import { createAppServer, parseUsers, selftest, type ServerConfig } from '../server/server';

const dist = mkdtempSync(join(tmpdir(), 'lesekompass-dist-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="./assets/app.js"></script>');
writeFileSync(join(dist, 'assets', 'app.js'), `console.log(${JSON.stringify('x'.repeat(5000))});`);
writeFileSync(join(dist, '..', 'geheim.txt'), 'nicht ausliefern');

function config(patch: Partial<ServerConfig> = {}): ServerConfig {
  return { port: 0, host: '127.0.0.1', dist, build: 'abc123', version: '1.0.0', users: new Map(), ...patch };
}

interface Res {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function call(server: Server, path: string, opts: { auth?: string; headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<Res> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.auth) headers.authorization = `Basic ${Buffer.from(opts.auth).toString('base64')}`;
    const req = request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

async function start(cfg: ServerConfig): Promise<Server> {
  const server = createAppServer(cfg);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return server;
}

describe('Server ohne Login', () => {
  let server: Server;
  beforeAll(async () => (server = await start(config())));
  afterAll(() => server.close());

  it('meldet Build und Version unter /healthz', async () => {
    const r = await call(server, '/healthz');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, app: 'lesekompass', version: '1.0.0', build: 'abc123' });
  });

  it('liefert die App mit passenden Cache-Regeln aus', async () => {
    const page = await call(server, '/');
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['x-frame-options']).toBe('DENY');
    const js = await call(server, '/assets/app.js');
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.headers['cache-control']).toContain('immutable');
  });

  it('komprimiert grössere Dateien', async () => {
    const r = await call(server, '/assets/app.js', { headers: { 'accept-encoding': 'gzip' } });
    expect(r.headers['content-encoding']).toBe('gzip');
  });

  it('gibt nichts ausserhalb von dist/ heraus', async () => {
    expect((await call(server, '/../geheim.txt')).body).not.toContain('nicht ausliefern');
    const encoded = await call(server, '/%2e%2e/geheim.txt');
    expect(encoded.status).not.toBe(200);
    expect(encoded.body).not.toContain('nicht ausliefern');
    expect((await call(server, '/fehlt.js')).status).toBe(404);
  });

  it('hat die lokale API', async () => {
    const r = await call(server, '/api/status');
    expect(JSON.parse(r.body)).toEqual({ goodreads: true, ai: false, gemini: false, llm: { mistral: false, groq: false, openrouter: false }, sync: false, blurbs: false, nightShift: false, user: null });
  });
});

describe('Server mit Login', () => {
  let server: Server;
  beforeAll(async () => (server = await start(config({ users: parseUsers('ich:geheim; partner:auch-geheim'), anthropicApiKey: 'sk-test' }))));
  afterAll(() => server.close());

  it('verlangt einen Login – ausser für /healthz', async () => {
    expect((await call(server, '/healthz')).status).toBe(200);
    const r = await call(server, '/');
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toContain('Basic');
    expect((await call(server, '/', { auth: 'ich:geheim' })).status).toBe(200);
    expect((await call(server, '/', { auth: 'partner:auch-geheim' })).status).toBe(200);
    expect((await call(server, '/', { auth: 'ich:falsch' })).status).toBe(401);
  });

  it('gibt den Claude-Schlüssel nur angemeldet und nur für die eigene Seite frei', async () => {
    const status = await call(server, '/api/status', { auth: 'ich:geheim' });
    expect(JSON.parse(status.body).ai).toBe(true);
    const foreign = await call(server, '/api/anthropic/v1/messages', {
      auth: 'ich:geheim',
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://boese.example' },
      body: '{}',
    });
    expect(foreign.status).toBe(403);
  });

  it('sperrt nach fünf falschen Passwörtern kurz', async () => {
    const locked = await start(config({ users: parseUsers('a:b') }));
    for (let i = 0; i < 5; i++) await call(locked, '/', { auth: 'a:falsch' });
    expect((await call(locked, '/', { auth: 'a:b' })).status).toBe(429);
    locked.close();
  });
});

describe('Geräte-Abgleich über HTTP', () => {
  let server: Server;
  const dataDir = mkdtempSync(join(tmpdir(), 'lesekompass-data-'));
  const json = { 'content-type': 'application/json' };
  const post = (auth: string, body: unknown, headers: Record<string, string> = json) =>
    call(server, '/api/sync', { auth, method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const entry = (id: string) => ({ c: 'library', id, at: 10, v: { id, title: `Buch ${id}`, authors: ['A'], shelf: 'read', rating: 4 } });

  beforeAll(async () => (server = await start(config({ users: parseUsers('ich:geheim; partner:auch-geheim'), dataDir }))));
  afterAll(() => server.close());

  it('meldet Abgleich und Login im Status', async () => {
    const r = await call(server, '/api/status', { auth: 'ich:geheim' });
    expect(JSON.parse(r.body)).toMatchObject({ sync: true, user: 'ich' });
  });

  it('hält die Daten pro Login getrennt', async () => {
    const pushed = await post('ich:geheim', { since: 0, changes: [entry('gr:1')] });
    expect(pushed.status).toBe(200);
    expect(JSON.parse(pushed.body)).toMatchObject({ ok: true, accepted: 1, user: 'ich' });
    expect(JSON.parse((await post('partner:auch-geheim', { since: 0, changes: [] })).body).changes).toEqual([]);
    expect(JSON.parse((await post('ich:geheim', { since: 0, changes: [] })).body).changes).toHaveLength(1);
    expect(readdirSync(dataDir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('verlangt Login, eigene Herkunft, JSON und POST', async () => {
    expect((await call(server, '/api/sync', { method: 'POST', headers: json, body: '{}' })).status).toBe(401);
    expect((await post('ich:geheim', { since: 0 }, { ...json, origin: 'https://boese.example' })).status).toBe(403);
    expect((await post('ich:geheim', { since: 0 }, { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await call(server, '/api/sync', { auth: 'ich:geheim' })).status).toBe(405);
    expect((await post('ich:geheim', '{ kaputt')).status).toBe(400);
    const bad = await post('ich:geheim', { since: 0, changes: [{ c: 'geheim', id: 'x', at: 1, v: 1 }] });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error).toContain('Unbekannte Sammlung');
  });

  it('komprimiert grosse Antworten', async () => {
    await post('ich:geheim', { since: 0, changes: Array.from({ length: 80 }, (_, i) => entry(`gr:z${i}`)) });
    const r = await call(server, '/api/sync', { auth: 'ich:geheim', method: 'POST', headers: { ...json, 'accept-encoding': 'gzip' }, body: '{"since":0,"changes":[]}' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
  });

  it('gibt es ohne Datenordner nicht', async () => {
    const plain = await start(config());
    const r = await call(plain, '/api/sync', { method: 'POST', headers: json, body: '{}' });
    expect(r.status).toBe(404);
    plain.close();
  });

  it('prüft den Abgleich im Selbsttest, ohne echte Daten anzufassen', async () => {
    const untouched = mkdtempSync(join(tmpdir(), 'lesekompass-echt-'));
    expect(await selftest(config({ dataDir: untouched, users: parseUsers('ich:geheim') }))).toEqual([]);
    expect(readdirSync(untouched)).toEqual([]);
    expect(existsSync(join(untouched, 'sicherungen'))).toBe(false);
  });
});

describe('Gemini über den Server', () => {
  let server: Server;
  const upstream: Array<{ url: string; key?: string; body: string }> = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      upstream.push({ url, key: (init.headers as Record<string, string>)['x-goog-api-key'], body: new TextDecoder().decode(init.body as Uint8Array) });
      return new Response('data: {"candidates":[]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    server = await start(config({ users: parseUsers('ich:geheim'), geminiApiKey: 'server-key' }));
  });
  afterAll(() => {
    server.close();
    vi.unstubAllGlobals();
  });
  const path = '/api/gemini/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse';

  it('meldet den Gemini-Schlüssel nur angemeldet', async () => {
    expect(JSON.parse((await call(server, '/api/status', { auth: 'ich:geheim' })).body)).toMatchObject({ gemini: true, ai: false });
  });

  it('reicht Anfragen mit dem Server-Schlüssel an Google weiter und streamt die Antwort zurück', async () => {
    const r = await call(server, path, { auth: 'ich:geheim', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"contents":[]}' });
    expect(r.status).toBe(200);
    expect(r.body).toContain('data: {"candidates":[]}');
    expect(upstream.at(-1)).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
      key: 'server-key',
      body: '{"contents":[]}',
    });
  });

  it('lässt nur bekannte Pfade, eigene Herkunft und Login durch', async () => {
    const before = upstream.length;
    const post = (p: string, headers: Record<string, string> = { 'content-type': 'application/json' }, auth = 'ich:geheim') => call(server, p, { auth, method: 'POST', headers, body: '{}' });
    expect((await post('/api/gemini/v1beta/models/gemini-3.8-flash:countTokens')).status).toBe(404);
    expect((await post('/api/gemini/v1beta/models/../../v1/files')).status).toBe(404);
    expect((await post('/api/gemini/v1beta/models/other-model:generateContent')).status).toBe(404);
    expect((await post(path, { 'content-type': 'application/json', origin: 'https://boese.example' })).status).toBe(403);
    expect((await post(path, { 'content-type': 'application/json' }, 'ich:falsch')).status).toBe(401);
    expect(upstream.length).toBe(before);
  });
});

describe('Hilfen', () => {
  it('liest Logins', () => {
    expect(Array.from(parseUsers('ich:pa:ss;; du:x;kaputt;:leer;leer:').entries())).toEqual([
      ['ich', 'pa:ss'],
      ['du', 'x'],
    ]);
  });

  it('erkennt Anfragen der eigenen Seite', () => {
    const req = (headers: Record<string, string>) => ({ headers }) as never;
    expect(isSameOriginJson(req({ 'content-type': 'application/json', host: 'pc:8080', origin: 'http://pc:8080' }))).toBe(true);
    expect(isSameOriginJson(req({ 'content-type': 'application/json', host: 'pc:8080' }))).toBe(true);
    expect(isSameOriginJson(req({ 'content-type': 'application/json', host: 'pc:8080', origin: 'http://evil:8080' }))).toBe(false);
    expect(isSameOriginJson(req({ 'content-type': 'text/plain', host: 'pc:8080' }))).toBe(false);
  });

  it('besteht den Selbsttest mit einer gültigen App', async () => {
    expect(await selftest(config())).toEqual([]);
    expect(await selftest(config({ dist: join(dist, 'gibts-nicht') }))).toHaveLength(1);
  });
});
