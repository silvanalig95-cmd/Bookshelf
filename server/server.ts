/**
 * Lesekompass-Server für Docker & Co.: liefert die gebaute App (dist/) aus, stellt die
 * lokale API bereit (Goodreads-Import, Claude-Proxy, Geräte-Synchronisation) und meldet sich unter /healthz.
 *
 *   node server/server.ts              starten (Node 22.18+ führt TypeScript direkt aus)
 *   node server/server.ts --selftest   prüfen, ob dieser Stand lauffähig ist (für das Update-Skript)
 *
 * Einstellungen per Umgebungsvariable:
 *   LESEKOMPASS_PORT   Port (Standard 8080)
 *   LESEKOMPASS_HOST   Adresse (Standard 127.0.0.1; im Container 0.0.0.0)
 *   LESEKOMPASS_AUTH   Login, z. B. "ich:langes-passwort" – mehrere mit ";" getrennt
 *   ANTHROPIC_API_KEY  optionaler Claude-Schlüssel (nur für angemeldete Personen nutzbar)
 *   GEMINI_API_KEY     optionaler Gemini-Schlüssel von Google AI Studio (ebenso)
 *   LESEKOMPASS_NACHTSCHICHT     "0" schaltet die Nachtschicht aus (nutzt sonst mit GEMINI_API_KEY und Datenordner
 *                                das restliche Gemini-Tageskontingent für die Bibliothek, siehe nightShift.ts)
 *   LESEKOMPASS_NACHTSCHICHT_AB  ab welcher Stunde Ortszeit (Standard 22)
 *   LESEKOMPASS_TZ               Zeitzone dafür (Standard Europe/Zurich)
 *   MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
 *                      optionale Gratis-Ausweich-Kanäle, wenn das Gemini-Kontingent aufgebraucht ist
 *   LESEKOMPASS_DIST   Ordner mit der gebauten App (Standard ../dist)
 *   LESEKOMPASS_DATA   Ordner für die synchronisierten Daten (Standard $LESEKOMPASS_HOME/data;
 *                      ohne beides gibt es keine Synchronisation)
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createLocalApiHandler, isLocalRequest } from './localApi.ts';
import { BlurbStore } from './blurbStore.ts';
import { KnowledgeStore } from './knowledge.ts';
import { NightShift } from './nightShift.ts';
import { SyncStore } from './syncStore.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

export interface ServerConfig {
  port: number;
  host: string;
  dist: string;
  build: string;
  version: string;
  /** name → Passwort */
  users: Map<string, string>;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  llmKeys?: { mistral?: string; groq?: string; openrouter?: string };
  /** Nachtschicht: ab welcher Stunde (Ortszeit) das restliche Gemini-Kontingent genutzt wird; false = aus. */
  nightShift?: { startHour: number; timeZone: string } | false;
  /** Ordner für die Geräte-Synchronisation (fehlt = keine Synchronisation). */
  dataDir?: string;
}

export function parseUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const part of (raw ?? '').split(/[;\n]/)) {
    const entry = part.trim();
    const i = entry.indexOf(':');
    if (i <= 0) continue;
    const name = entry.slice(0, i).trim();
    const pass = entry.slice(i + 1);
    if (name && pass) users.set(name, pass);
  }
  return users;
}

function readBuild(): string {
  if (process.env.LESEKOMPASS_BUILD) return process.env.LESEKOMPASS_BUILD;
  try {
    return readFileSync(join(APP_ROOT, 'BUILD'), 'utf8').trim() || 'local';
  } catch {
    return 'local';
  }
}

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0';
  } catch {
    return '0';
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.LESEKOMPASS_PORT ?? env.PORT ?? 8080),
    host: env.LESEKOMPASS_HOST ?? '127.0.0.1',
    dist: resolve(env.LESEKOMPASS_DIST ?? join(APP_ROOT, 'dist')),
    build: readBuild(),
    version: readVersion(),
    users: parseUsers(env.LESEKOMPASS_AUTH),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    llmKeys: {
      mistral: env.MISTRAL_API_KEY?.trim() || undefined,
      groq: env.GROQ_API_KEY?.trim() || undefined,
      openrouter: env.OPENROUTER_API_KEY?.trim() || undefined,
    },
    dataDir: env.LESEKOMPASS_DATA ? resolve(env.LESEKOMPASS_DATA) : env.LESEKOMPASS_HOME ? join(resolve(env.LESEKOMPASS_HOME), 'data') : undefined,
    nightShift:
      env.LESEKOMPASS_NACHTSCHICHT === '0'
        ? false
        : {
            startHour: Math.min(23, Math.max(0, Number.parseInt(env.LESEKOMPASS_NACHTSCHICHT_AB ?? '22', 10) || 22)),
            timeZone: env.LESEKOMPASS_TZ?.trim() || 'Europe/Zurich',
          },
  };
}

/* ------------------------------------------------------------------ */
/* Login (HTTP Basic) mit kurzer Sperre nach Fehlversuchen               */
/* ------------------------------------------------------------------ */

type Failures = Map<string, { count: number; until: number }>;

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/** Gibt den angemeldeten Namen zurück – oder undefined, wenn Name/Passwort nicht stimmen. */
function checkCredentials(users: Map<string, string>, header: string | undefined): string | undefined {
  if (!header?.startsWith('Basic ')) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return undefined;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return undefined;
  const name = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  const expected = users.get(name);
  // Immer vergleichen (auch bei unbekanntem Namen), damit die Antwortzeit nichts verrät
  const ok = timingSafeEqual(digest(pass), digest(expected ?? `\u0000${pass}x`));
  return ok && expected !== undefined ? name : undefined;
}

function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unbekannt';
}

/**
 * Prüft den Login. Gibt den angemeldeten Namen zurück (null, wenn kein Login eingerichtet ist)
 * oder false, wenn die Anfrage abgewiesen wurde.
 */
function authorize(cfg: ServerConfig, failures: Failures, req: IncomingMessage, res: ServerResponse): string | null | false {
  if (!cfg.users.size) return null;
  const key = clientKey(req);
  const state = failures.get(key);
  if (state && state.until > Date.now()) {
    res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' });
    res.end('Zu viele falsche Passwörter – bitte eine Minute warten.');
    return false;
  }
  const user = checkCredentials(cfg.users, req.headers.authorization);
  if (user !== undefined) {
    failures.delete(key);
    return user;
  }
  if (req.headers.authorization) {
    const count = (state?.count ?? 0) + 1;
    failures.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
  }
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Lesekompass", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bitte mit deinem Lesekompass-Login anmelden.');
  return false;
}

/* ------------------------------------------------------------------ */
/* Statische Dateien                                                      */
/* ------------------------------------------------------------------ */

const gzipCache = new Map<string, { mtime: number; data: Buffer }>();

function serveStatic(cfg: ServerConfig, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(cfg.dist, `.${pathname}`);
  if (!file.startsWith(cfg.dist + sep) || pathname.includes('\0')) {
    res.writeHead(403);
    res.end();
    return;
  }
  let stat;
  try {
    stat = statSync(file);
  } catch {
    stat = undefined;
  }
  if (!stat?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
    return;
  }
  const ext = extname(file).toLowerCase();
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  if (ext === '.html') {
    headers['x-frame-options'] = 'DENY';
    headers['referrer-policy'] = 'strict-origin-when-cross-origin';
  }
  let body: Buffer = readFileSync(file);
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && body.length > 1024) {
    const cached = gzipCache.get(file);
    if (cached && cached.mtime === stat.mtimeMs) body = cached.data;
    else {
      const data = gzipSync(body);
      gzipCache.set(file, { mtime: stat.mtimeMs, data });
      body = data;
    }
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ------------------------------------------------------------------ */
/* Server                                                                 */
/* ------------------------------------------------------------------ */

export function createAppServer(cfg: ServerConfig): Server & { nightShift?: NightShift; flushStores: () => void } {
  const users = new WeakMap<IncomingMessage, string | null>();
  const failures: Failures = new Map();
  const sync = cfg.dataDir ? new SyncStore(cfg.dataDir) : undefined;
  const blurbs = cfg.dataDir ? new BlurbStore(cfg.dataDir) : undefined;
  const knowledge = cfg.dataDir ? new KnowledgeStore(cfg.dataDir) : undefined;
  const nightShift =
    sync && blurbs && cfg.dataDir && cfg.geminiApiKey && cfg.nightShift
      ? new NightShift({
          dir: cfg.dataDir,
          geminiKey: cfg.geminiApiKey,
          users: cfg.users.size ? Array.from(cfg.users.keys()) : [null],
          sync,
          blurbs,
          knowledge,
          startHour: cfg.nightShift.startHour,
          timeZone: cfg.nightShift.timeZone,
          log: (m) => console.log(m),
        })
      : undefined;
  const api = createLocalApiHandler({
    anthropicApiKey: cfg.anthropicApiKey,
    geminiApiKey: cfg.geminiApiKey,
    llmKeys: cfg.llmKeys,
    allowRemote: true,
    // Den Server-Schlüssel nur mit Login (oder direkt auf diesem Rechner) freigeben
    canUseAi: (req) => cfg.users.size > 0 || isLocalRequest(req),
    sync,
    userOf: (req) => users.get(req) ?? null,
    blurbs,
    nightShift,
    knowledge,
  });
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, app: 'lesekompass', version: cfg.version, build: cfg.build }));
      return;
    }
    const user = authorize(cfg, failures, req, res);
    if (user === false) return;
    users.set(req, user);
    api(req, res, () => serveStatic(cfg, req, res)).catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err instanceof Error ? err.message : 'Fehler');
    });
  });
  return Object.assign(server, {
    nightShift,
    // Beim Beenden nichts Gelerntes verlieren
    flushStores: () => {
      blurbs?.flush();
      knowledge?.flush();
    },
  });
}

function get(
  port: number,
  path: string,
  auth?: string,
  post?: unknown,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolvePromise, reject) => {
    const headers: Record<string, string> = auth ? { authorization: auth } : {};
    if (post !== undefined) headers['content-type'] = 'application/json';
    const req = httpRequest({ host: '127.0.0.1', port, path, method: post === undefined ? 'GET' : 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`Zeitüberschreitung bei ${path}`)));
    req.end(post === undefined ? undefined : JSON.stringify(post));
  });
}

/** Startet diesen Stand kurz auf einem freien Port und prüft die wichtigsten Seiten. */
export async function selftest(cfg: ServerConfig): Promise<string[]> {
  const problems: string[] = [];
  const index = join(cfg.dist, 'index.html');
  if (!existsSync(index)) return [`${index} fehlt – wurde die App gebaut?`];
  const html = readFileSync(index, 'utf8');
  const assets = Array.from(html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)).map((m) => m[1]);
  if (!assets.some((a) => a.endsWith('.js'))) problems.push('index.html verweist auf kein Skript');
  // Nie die echten Daten anfassen: der Selbsttest synchronisiert in einen Wegwerf-Ordner
  const scratch = cfg.dataDir ? mkdtempSync(join(tmpdir(), 'lesekompass-selftest-')) : undefined;
  const server = createAppServer({ ...cfg, host: '127.0.0.1', port: 0, dataDir: scratch });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  const firstUser = cfg.users.entries().next().value as [string, string] | undefined;
  const auth = firstUser ? `Basic ${Buffer.from(`${firstUser[0]}:${firstUser[1]}`).toString('base64')}` : undefined;
  try {
    const health = await get(port, '/healthz');
    if (health.status !== 200 || !health.body.includes('"lesekompass"')) problems.push(`/healthz antwortet mit ${health.status}`);
    const page = await get(port, '/', auth);
    if (page.status !== 200 || !page.body.includes('id="root"')) problems.push(`Startseite antwortet mit ${page.status}`);
    for (const asset of assets) {
      const r = await get(port, `/${asset}`, auth);
      if (r.status !== 200 || r.body.length === 0) problems.push(`${asset} antwortet mit ${r.status}`);
    }
    const status = await get(port, '/api/status', auth);
    if (status.status !== 200 || !status.body.includes('goodreads')) problems.push(`/api/status antwortet mit ${status.status}`);
    const traversal = await get(port, '/../package.json', auth);
    if (traversal.status === 200 && traversal.body.includes('"dependencies"')) problems.push('Dateien ausserhalb von dist/ sind erreichbar');
    if (scratch) {
      const book = { c: 'library', id: 'gr:1', at: 1, v: { id: 'gr:1', title: 'Selbsttest', authors: ['Lesekompass'] } };
      const first = await get(port, '/api/sync', auth, { since: 0, changes: [book] });
      const second = await get(port, '/api/sync', auth, { since: 0, changes: [] });
      if (first.status !== 200 || !second.body.includes('"Selbsttest"')) problems.push(`/api/sync antwortet mit ${first.status}/${second.status}`);
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  } finally {
    server.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  return problems;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function main() {
  const cfg = configFromEnv();
  if (process.argv.includes('--selftest')) {
    const problems = await selftest(cfg);
    if (problems.length) {
      console.error(`Selbsttest fehlgeschlagen:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log(`Selbsttest bestanden (Build ${cfg.build}).`);
    return;
  }
  if (!existsSync(join(cfg.dist, 'index.html'))) {
    console.error(`Keine gebaute App in ${cfg.dist} – zuerst "npm run build" ausführen.`);
    process.exit(1);
  }
  const server = createAppServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`Lesekompass ${cfg.version} (Build ${cfg.build}) läuft auf http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}/`);
    if (cfg.users.size) console.log(`Login aktiv für: ${Array.from(cfg.users.keys()).join(', ')}`);
    else if (!isLoopback(cfg.host)) console.log('Hinweis: kein Login gesetzt (LESEKOMPASS_AUTH). Die App ist im Netzwerk offen; die KI-Schlüssel des Servers bleiben gesperrt.');
    console.log(cfg.dataDir ? `Geräte-Synchronisation aktiv – Daten in ${cfg.dataDir}` : 'Geräte-Synchronisation aus (LESEKOMPASS_DATA nicht gesetzt).');
    for (const [name, key] of [
      ['Claude', cfg.anthropicApiKey],
      ['Gemini', cfg.geminiApiKey],
      ['Mistral', cfg.llmKeys?.mistral],
      ['Groq', cfg.llmKeys?.groq],
      ['OpenRouter', cfg.llmKeys?.openrouter],
    ] as const) {
      if (key) console.log(cfg.users.size ? `${name}-Schlüssel des Servers aktiv.` : `${name}-Schlüssel gesetzt, aber ohne Login nur auf diesem Rechner selbst nutzbar.`);
    }
    if (server.nightShift) {
      server.nightShift.start();
      console.log(`Nachtschicht aktiv: ab ${server.nightShift.startHour}:00 (${server.nightShift.timeZone}) wird das restliche Gemini-Tageskontingent für die Bibliothek genutzt.`);
    }
  });
  const stop = () => {
    server.nightShift?.stop();
    server.flushStores();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
