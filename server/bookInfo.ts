/**
 * Cover und Verlagstext aus Apple Books: aktuelle Ausgaben in hoher Auflösung (bis ~1000 px) und
 * oft ein deutscher Klappentext des Verlags – frei abfragbar, aber nur rund 20 Anfragen pro Minute.
 * Darum fragt der Server gedrosselt und merkt sich jedes Ergebnis (auch „nicht gefunden“) dauerhaft
 * in <data>/buchinfo.json. So wird jedes Buch nur einmal nachgeschlagen.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BookInfo {
  /** Vorlage der Bild-Adresse, „{w}x{h}“ wird durch die gewünschte Grösse ersetzt. */
  artwork?: string;
  /** Verlagstext (ohne HTML), meist auf Deutsch. */
  description?: string;
  trackName?: string;
  at: number;
}

interface AppleResult {
  kind?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  description?: string;
}

const SEARCH = 'https://itunes.apple.com/search';
const RETRY_MISS_MS = 30 * 24 * 3600_000;
const MAX_ENTRIES = 100_000;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const surname = (author: string) => normalize(author).split(' ').filter(Boolean).pop() ?? '';
const STOP = new Set(['der', 'die', 'das', 'des', 'ein', 'eine', 'und', 'the', 'a', 'of', 'roman', 'band']);

/** Schlüssel für ein Buch: Titel (ohne Zusätze) und Nachname. */
export function bookInfoKey(title: string, author: string): string {
  return `${normalize(title.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/[:;]| - | – /)[0])}|${surname(author)}`;
}

/** Passt ein Apple-Treffer wirklich zum Buch? Titelwörter und Nachname müssen stimmen. */
export function matches(r: AppleResult, title: string, author: string): boolean {
  const sur = surname(author);
  if (sur && !normalize(r.artistName ?? '').includes(sur)) return false;
  const wanted = normalize(title.split(/[:;(]/)[0])
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (!wanted.length) return false;
  const got = new Set(normalize(r.trackName ?? '').split(' '));
  return wanted.filter((w) => got.has(w)).length / wanted.length >= 0.6;
}

export function cleanDescription(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length >= 80 ? text.slice(0, 4000) : undefined;
}

/** Adresse in der gewünschten Breite (Apple skaliert in einen Rahmen, Seitenverhältnis bleibt). */
export function artworkUrl(template: string, width: number): string {
  const w = Math.max(60, Math.min(1200, Math.round(width)));
  return template.replace('{w}x{h}', `${w}x${Math.round(w * 1.6)}`);
}

export class BookInfoStore {
  private readonly file: string;
  private readonly fetchFn: typeof fetch;
  private readonly clock: () => number;
  private readonly gapMs: number;
  private entries: Record<string, BookInfo> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly queue: Array<{ key: string; title: string; author: string }> = [];
  private readonly inflight = new Map<string, Promise<BookInfo>>();
  private nextSlot = 0;
  private draining = false;

  constructor(dir: string, opts: { fetchFn?: typeof fetch; clock?: () => number; gapMs?: number } = {}) {
    this.file = join(dir, 'buchinfo.json');
    this.fetchFn = opts.fetchFn ?? fetch;
    this.clock = opts.clock ?? Date.now;
    // ~18 Anfragen pro Minute – knapp unter Apples Grenze
    this.gapMs = opts.gapMs ?? 3300;
  }

  private load(): Record<string, BookInfo> {
    if (!this.entries) {
      try {
        this.entries = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, BookInfo>) : {};
      } catch {
        this.entries = {};
      }
    }
    return this.entries;
  }

  /** Was schon bekannt ist (undefined = noch nie nachgeschlagen oder zu alt). */
  cached(title: string, author: string): BookInfo | undefined {
    const hit = this.load()[bookInfoKey(title, author)];
    if (!hit) return undefined;
    if (!hit.artwork && this.clock() - hit.at > RETRY_MISS_MS) return undefined;
    return hit;
  }

  /**
   * Nachschlagen: sofort, wenn gerade nichts ansteht (für eine einzelne Buchseite), sonst in die
   * Warteschlange (Buchkarten) – dann gibt es beim nächsten Mal das Ergebnis.
   */
  async resolve(title: string, author: string, opts: { wait?: boolean } = {}): Promise<BookInfo | undefined> {
    const known = this.cached(title, author);
    if (known) return known;
    const key = bookInfoKey(title, author);
    if (!key.split('|')[0]) return undefined;
    const running = this.inflight.get(key);
    if (running) return opts.wait ? running : undefined;
    if (opts.wait || (this.queue.length === 0 && this.nextSlot <= this.clock())) return this.lookup(key, title, author);
    if (!this.queue.some((q) => q.key === key) && this.queue.length < 500) this.queue.push({ key, title, author });
    void this.drain();
    return undefined;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        if (this.cached(next.title, next.author)) continue;
        await this.lookup(next.key, next.title, next.author);
      }
    } finally {
      this.draining = false;
    }
  }

  private lookup(key: string, title: string, author: string): Promise<BookInfo> {
    const p = (async () => {
      const wait = this.nextSlot - this.clock();
      this.nextSlot = Math.max(this.clock(), this.nextSlot) + this.gapMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const info = await this.search(title, author);
      // Bei Drosselung oder Netzfehler nichts merken – später nochmals versuchen
      if (info) this.store(key, info);
      return info ?? { at: this.clock() };
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async search(title: string, author: string): Promise<BookInfo | undefined> {
    const term = `${title.replace(/\(.*?\)/g, ' ').split(/[:;]/)[0]} ${surname(author)}`.trim();
    for (const country of ['ch', 'de']) {
      const url = `${SEARCH}?${new URLSearchParams({ term, media: 'ebook', country, limit: '6' })}`;
      let data: { results?: AppleResult[] };
      try {
        const res = await this.fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 403 || res.status === 429) {
          this.nextSlot = this.clock() + 60_000; // gedrosselt – eine Minute Pause
          return undefined;
        }
        if (!res.ok) return undefined;
        data = (await res.json()) as { results?: AppleResult[] };
      } catch {
        return undefined;
      }
      const hit = (data.results ?? []).find((r) => r.artworkUrl100 && matches(r, title, author));
      if (hit) {
        return {
          artwork: hit.artworkUrl100!.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/{w}x{h}bb.$1'),
          description: cleanDescription(hit.description),
          trackName: hit.trackName,
          at: this.clock(),
        };
      }
    }
    return { at: this.clock() }; // gesucht, nichts Passendes
  }

  private store(key: string, info: BookInfo) {
    const entries = this.load();
    entries[key] = info;
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => entries[a].at - entries[b].at);
      for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[old];
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, 3000);
    this.saveTimer.unref?.();
  }

  flush() {
    if (!this.entries) return;
    mkdirSync(join(this.file, '..'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.entries));
    renameSync(tmp, this.file);
  }
}
