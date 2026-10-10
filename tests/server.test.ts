import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    expect(JSON.parse(r.body)).toEqual({ goodreads: true, ai: false });
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
