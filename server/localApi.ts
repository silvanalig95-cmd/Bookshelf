/**
 * Kleine lokale API – läuft im Vite-Dev-/Preview-Server und im Docker-Server (server.ts).
 *
 * - /api/status              → welche Server-Funktionen verfügbar sind
 * - /api/goodreads/rss       → holt den öffentlichen RSS-Feed eines Goodreads-Regals
 *                              (Goodreads erlaubt keinen direkten Browser-Zugriff/CORS)
 * - /api/anthropic/v1/...    → leitet Claude-Anfragen weiter und fügt den Schlüssel
 *                              aus ANTHROPIC_API_KEY hinzu, damit er nie im Browser landet
 * - /api/gemini/v1beta/...   → dasselbe für Google Gemini (GEMINI_API_KEY)
 * - /api/sync                → gleicht Bibliothek, Merkliste & Co. zwischen Geräten ab
 *                              (nur wenn ein Datenordner eingerichtet ist, siehe syncStore.ts)
 *
 * Auf einer rein statischen Installation (z. B. GitHub Pages) gibt es diese
 * Endpunkte nicht – die App erkennt das über /api/status und weicht aus.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { SyncInputError, type SyncStore } from './syncStore.ts';

type Next = (err?: unknown) => void;

export interface LocalApiOptions {
  anthropicApiKey?: string;
  geminiApiKey?: string;
  allowRemote?: boolean;
  /**
   * Darf diese Anfrage die KI-Schlüssel des Servers nutzen? Standard: nur vom
   * eigenen Computer. Der Docker-Server erlaubt es nur angemeldeten Personen.
   */
  canUseAi?: (req: IncomingMessage) => boolean;
  /** Datenablage für die Geräte-Synchronisation; ohne sie gibt es keinen Abgleich. */
  sync?: SyncStore;
  /** Angemeldeter Name dieser Anfrage (null = ohne Login). */
  userOf?: (req: IncomingMessage) => string | null;
}

class RequestTooLarge extends Error {}

const GOODREADS_SHELF = /^[a-z0-9_\-#%]{1,64}$/i;
const GEMINI_PATH = /^\/v1beta\/models\/(gemini-[a-z0-9.-]{1,60}):(generateContent|streamGenerateContent)$/;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

function sendJson(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const text = JSON.stringify(body);
  if (req && text.length > 8192 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
    res.end(gzipSync(text));
    return;
  }
  res.end(text);
}

export function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

async function readBody(req: IncomingMessage, limit = 2_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) throw new RequestTooLarge('Anfrage zu gross');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function fetchGoodreadsRss(params: URLSearchParams): Promise<{ status: number; body: string }> {
  const user = (params.get('user') ?? '').trim();
  const shelf = params.get('shelf') ?? 'read';
  const page = Number(params.get('page') ?? '1');
  const perPage = Number(params.get('per_page') ?? '200');
  const key = params.get('key') ?? '';
  if (!/^\d{1,12}$/.test(user)) return { status: 400, body: 'Ungültige Goodreads-Nutzer-ID' };
  if (!GOODREADS_SHELF.test(shelf)) return { status: 400, body: 'Ungültiges Regal' };
  if (!Number.isInteger(page) || page < 1 || page > 100) return { status: 400, body: 'Ungültige Seite' };
  const qs = new URLSearchParams({
    shelf,
    page: String(page),
    per_page: String(Math.min(Math.max(perPage, 1), 200)),
  });
  if (/^[a-z0-9_-]{1,80}$/i.test(key)) qs.set('key', key);
  const url = `https://www.goodreads.com/review/list_rss/${user}?${qs.toString()}`;
  const upstream = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Lesekompass; persönlicher Import)',
      accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5',
    },
    redirect: 'follow',
  });
  const body = await upstream.text();
  return { status: upstream.status, body };
}

/**
 * Schutz vor fremden Webseiten: Anfragen an den Claude-Proxy müssen von dieser App selbst
 * kommen (gleiche Herkunft) und JSON senden – das erzwingt bei fremden Seiten einen
 * CORS-Vorabcheck, den dieser Server nie beantwortet.
 */
export function isSameOriginJson(req: IncomingMessage): boolean {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createLocalApiHandler(options: LocalApiOptions) {
  const aiAllowed = (req: IncomingMessage) => (options.canUseAi ? options.canUseAi(req) : isLocalRequest(req));
  const canUseAi = (req: IncomingMessage) => Boolean(options.anthropicApiKey) && aiAllowed(req);
  const canUseGemini = (req: IncomingMessage) => Boolean(options.geminiApiKey) && aiAllowed(req);
  const userOf = (req: IncomingMessage) => options.userOf?.(req) ?? null;
  return async function handler(req: IncomingMessage, res: ServerResponse, next: Next) {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith('/api/')) return next();
    const url = new URL(rawUrl, 'http://localhost');

    if (!options.allowRemote && !isLocalRequest(req)) {
      return sendJson(res, 403, { error: 'Die lokale API ist nur auf diesem Computer erreichbar.' });
    }

    try {
      if (url.pathname === '/api/status') {
        return sendJson(res, 200, { goodreads: true, ai: canUseAi(req), gemini: canUseGemini(req), sync: Boolean(options.sync), user: userOf(req) });
      }

      if (url.pathname === '/api/sync') {
        if (!options.sync) return sendJson(res, 404, { error: 'Die Synchronisation ist auf diesem Server nicht eingerichtet.' });
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Nur POST' });
        if (!isSameOriginJson(req)) return sendJson(res, 403, { error: 'Anfrage von fremder Herkunft abgelehnt.' });
        let input: unknown;
        try {
          input = JSON.parse((await readBody(req, 48_000_000)).toString('utf8'));
        } catch (err) {
          if (err instanceof RequestTooLarge) return sendJson(res, 413, { error: err.message });
          return sendJson(res, 400, { error: 'Ungültiges JSON' });
        }
        try {
          const result = options.sync.sync(userOf(req), input);
          return sendJson(res, result.status, result.body, req);
        } catch (err) {
          if (err instanceof SyncInputError) return sendJson(res, 400, { error: err.message });
          return sendJson(res, 500, { error: `Daten konnten nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      if (url.pathname === '/api/goodreads/rss') {
        const { status, body } = await fetchGoodreadsRss(url.searchParams);
        res.statusCode = status;
        res.setHeader('content-type', status === 200 ? 'application/rss+xml; charset=utf-8' : 'text/plain; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        return res.end(body);
      }

      if (url.pathname.startsWith('/api/anthropic/')) {
        if (!options.anthropicApiKey) {
          return sendJson(res, 503, { error: 'ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt.' });
        }
        if (!canUseAi(req)) {
          return sendJson(res, 403, { error: 'Den Claude-Schlüssel des Servers dürfen nur angemeldete Personen nutzen (LESEKOMPASS_AUTH setzen).' });
        }
        if (!isSameOriginJson(req)) {
          return sendJson(res, 403, { error: 'Anfrage von fremder Herkunft abgelehnt.' });
        }
        const path = url.pathname.slice('/api/anthropic'.length);
        if (req.method !== 'POST' || !/^\/v1\/messages(\/count_tokens)?$/.test(path)) {
          return sendJson(res, 404, { error: 'Nicht unterstützter Endpunkt' });
        }
        const body = await readBody(req);
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-api-key': options.anthropicApiKey,
          'anthropic-version': String(req.headers['anthropic-version'] ?? '2023-06-01'),
        };
        const beta = req.headers['anthropic-beta'];
        if (beta) headers['anthropic-beta'] = Array.isArray(beta) ? beta.join(',') : beta;
        const upstream = await fetch(`https://api.anthropic.com${path}`, { method: 'POST', headers, body: new Uint8Array(body) });
        res.statusCode = upstream.status;
        upstream.headers.forEach((value, key) => {
          if (['content-type', 'request-id', 'retry-after', 'x-should-retry'].includes(key) || key.startsWith('anthropic-ratelimit')) {
            res.setHeader(key, value);
          }
        });
        if (!upstream.body) return res.end();
        Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
        return;
      }

      if (url.pathname.startsWith('/api/gemini/')) {
        if (!options.geminiApiKey) return sendJson(res, 503, { error: 'GEMINI_API_KEY ist auf dem Server nicht gesetzt.' });
        if (!aiAllowed(req)) {
          return sendJson(res, 403, { error: 'Den Gemini-Schlüssel des Servers dürfen nur angemeldete Personen nutzen (LESEKOMPASS_AUTH setzen).' });
        }
        if (!isSameOriginJson(req)) return sendJson(res, 403, { error: 'Anfrage von fremder Herkunft abgelehnt.' });
        const path = url.pathname.slice('/api/gemini'.length);
        if (req.method !== 'POST' || !GEMINI_PATH.test(path)) return sendJson(res, 404, { error: 'Nicht unterstützter Endpunkt' });
        const body = await readBody(req);
        const qs = url.searchParams.get('alt') === 'sse' ? '?alt=sse' : '';
        const upstream = await fetch(`${GEMINI_BASE}${path}${qs}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.geminiApiKey },
          body: new Uint8Array(body),
        });
        res.statusCode = upstream.status;
        const type = upstream.headers.get('content-type');
        if (type) res.setHeader('content-type', type);
        res.setHeader('cache-control', 'no-store');
        if (!upstream.body) return res.end();
        Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
        return;
      }

      return sendJson(res, 404, { error: 'Unbekannter API-Pfad' });
    } catch (err) {
      return sendJson(res, 502, { error: err instanceof Error ? err.message : 'Unbekannter Fehler' });
    }
  };
}

export function localApi(options: LocalApiOptions): Plugin {
  const handler = createLocalApiHandler(options);
  return {
    name: 'lesekompass-local-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
