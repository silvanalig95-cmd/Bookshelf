/**
 * fetch-Hülle mit Zeitlimit, Zwischenspeicher, Bündelung gleicher Anfragen,
 * begrenzter Parallelität pro Host und einem Wiederholungsversuch.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

const MAX_CACHE = 600;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function cacheGet(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // LRU: ans Ende verschieben
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Einfache Semaphore pro Host, damit wir öffentliche APIs nicht überfluten. */
class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const limiters = new Map<string, Limiter>();
function limiterFor(url: string): Limiter {
  const host = new URL(url, 'http://localhost').host;
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new Limiter(host.includes('openlibrary') ? 6 : 4);
    limiters.set(host, limiter);
  }
  return limiter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  /** Cache-Dauer in Millisekunden (0 = kein Cache). */
  ttl?: number;
  timeout?: number;
  signal?: AbortSignal;
  /** Text statt JSON zurückgeben. */
  text?: boolean;
  retries?: number;
  headers?: Record<string, string>;
}

async function doFetch(url: string, opts: FetchOptions): Promise<unknown> {
  const timeout = opts.timeout ?? 20_000;
  const retries = opts.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await limiterFor(url).run(() => fetch(url, { signal: controller.signal, headers: opts.headers }));
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        const err = new HttpError(res.status, `HTTP ${res.status}`, url);
        if (retryable && attempt < retries && res.status !== 429) {
          lastError = err;
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw err;
      }
      return opts.text ? await res.text() : await res.json();
    } catch (err) {
      lastError = err;
      if (opts.signal?.aborted) throw err;
      if (err instanceof HttpError) throw err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError;
}

/** Lässt ein Versprechen abbrechen, ohne die (geteilte) Anfrage selbst zu stoppen. */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Abgebrochen', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const ttl = opts.ttl ?? 30 * 60_000;
  const key = (opts.text ? 'T:' : 'J:') + url;
  if (ttl > 0) {
    const hit = cacheGet(key);
    if (hit !== undefined) return hit as T;
  }
  let pending = inflight.get(key);
  if (!pending) {
    // Die eigentliche Anfrage läuft ohne das Abbruchsignal des Aufrufers weiter:
    // So können mehrere Komponenten sie teilen, und das Ergebnis landet im Cache.
    pending = doFetch(url, { ...opts, signal: undefined })
      .then((value) => {
        if (ttl > 0) cacheSet(key, value, ttl);
        return value;
      })
      .finally(() => inflight.delete(key));
    // Verhindert „unhandled rejection“, falls alle Aufrufer schon abgebrochen haben
    pending.catch(() => undefined);
    inflight.set(key, pending);
  }
  return withSignal(pending as Promise<T>, opts.signal);
}

export function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  return fetchJson<string>(url, { ...opts, text: true });
}

/** Führt Aufgaben mit begrenzter Parallelität aus und meldet Fortschritt. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

export function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.catch((err) => {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (import.meta.env?.DEV && !aborted) console.warn('[lesekompass]', err);
    return undefined;
  });
}
