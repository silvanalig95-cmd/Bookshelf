/**
 * Nachtschicht: nutzt das restliche Gemini-Gratiskontingent des Tages, um die Bibliothek zu
 * erweitern und zu analysieren – bevor es bei Google verfällt.
 *
 * Googles Tageskontingent setzt sich um Mitternacht Pacific Time zurück (in der Schweiz meist
 * 9 Uhr morgens). Die Nachtschicht läuft ab dem Abend (Standard 22 Uhr Ortszeit) bis zu diesem
 * Tageswechsel und arbeitet der Reihe nach ab:
 *   1. Kurzbeschreibungen für Bücher, die du geöffnet hast, die aber noch keine haben
 *   2. deutsche Kurzbeschreibungen für Bücher auf der Merkliste und „Will ich lesen“
 *   3. Schlagwörter (Themen, Ton, Schauplatz) für Bücher der Bibliothek – schärft das Geschmacksprofil
 *   4. eine Lese-Analyse (einmal pro Tag, wenn sich die Bibliothek geändert hat)
 *   5. neue Vorschläge, auf Open Library nachgeschlagen, jeweils mit Kurzbeschreibung
 *   6. Schlagwörter für alle Bücher im Wissensspeicher (zwölf pro Anfrage – verbessern die
 *      Empfehlungen überall) und Kurzbeschreibungen für Bücher, die dir angezeigt wurden
 *   7. weitere Vorschlagsrunden
 * Sie hört auf, wenn alle Gemini-Modelle ihr Tageskontingent aufgebraucht haben, und pausiert,
 * solange jemand die KI in der App benutzt.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlurbStore } from './blurbStore.ts';
import type { KnowledgeStore } from './knowledge.ts';
import { syncFileName, type SyncStore } from './syncStore.ts';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPEN_LIBRARY = 'https://openlibrary.org';
/** Kleine Aufgaben zuerst auf den günstigen Modellen, grosse zuerst auf dem besten. */
export const LIGHT_CHAIN = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
export const MAIN_CHAIN = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const THINKING: Record<string, string[]> = {
  'gemini-3.8-flash': ['LOW', 'MEDIUM', 'HIGH'],
  'gemini-3.6-flash': ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  'gemini-3.5-flash-lite': ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
};
// Vorschläge werden nicht mehr verworfen – nur als Schutz für den Speicher begrenzt
const MAX_SUGGESTIONS = 2000;

/** Der Auftrag für Kurzbeschreibungen – gleich lautend in src/lib/aiPrompts.ts (ein Test prüft das). */
export const BLURB_INSTRUCTIONS = [
  'Schreib auf Deutsch zwei Absätze:',
  '1. Worum es geht – 4 bis 6 Sätze, spoilerfrei: Ausgangslage und Hauptfiguren, Schauplatz und Zeit, worum es im Kern geht, Ton und Stil – und was das Buch besonders macht. Konkret statt allgemein; keine Wendungen, kein Ende.',
  '2. Ein Satz, der mit „Passt zu dir, weil …“ oder „Eher nicht dein Fall, weil …“ beginnt und sich auf den Lesekontext stützt. Ohne Lesekontext: „Für alle, die …“.',
  'Kennst du das Buch nicht sicher, stütze dich nur auf das Material oben und sag ehrlich, wenn es dünn ist. Keine Überschriften, keine Aufzählung, kein [[…]]-Format. Schweizer Rechtschreibung (ss statt ß).',
];
const THEME_BATCH = 12;

/* ---------- Zeitfenster ---------- */

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function zoned(t: number, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/**
 * Das aktuelle bzw. letzte Nachtschicht-Fenster: von `startHour` Ortszeit bis zum nächsten
 * Tageswechsel bei Google (Mitternacht in Los Angeles). `day` ist der Google-Tag, dessen
 * Kontingent darin aufgebraucht wird.
 */
export function nightWindow(t: number, startHour: number, timeZone: string): { start: number; reset: number; day: string } {
  const local = zoned(t, timeZone);
  const sinceStart = ((local.h - startHour + 24) % 24) * 3600_000 + local.mi * 60_000 + local.s * 1000 + (((t % 1000) + 1000) % 1000);
  const start = t - sinceStart;
  const la = zoned(start, 'America/Los_Angeles');
  const reset = start + 24 * 3600_000 - (la.h * 3600_000 + la.mi * 60_000 + la.s * 1000);
  const day = `${la.y}-${String(la.mo).padStart(2, '0')}-${String(la.d).padStart(2, '0')}`;
  return { start, reset, day };
}

export function inNightWindow(t: number, startHour: number, timeZone: string): boolean {
  const w = nightWindow(t, startHour, timeZone);
  return t >= w.start && t < w.reset;
}

/* ---------- Gemini-Antworten ---------- */

/** Ist das Tageskontingent (und nicht nur das Minutenlimit) des Modells aufgebraucht? */
export function quotaKind(body: unknown): { daily: boolean; retryMs?: number } {
  const details = (body as { error?: { details?: Array<Record<string, unknown>>; message?: string } })?.error?.details ?? [];
  let daily = false;
  let retryMs: number | undefined;
  for (const d of details) {
    for (const v of (d.violations as Array<{ quotaId?: string; quotaMetric?: string }> | undefined) ?? []) {
      if (/per ?day|perday/i.test(`${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`)) daily = true;
    }
    if (typeof d.retryDelay === 'string') {
      const sec = Number.parseFloat(d.retryDelay);
      if (Number.isFinite(sec)) retryMs = Math.ceil(sec * 1000);
    }
  }
  const message = (body as { error?: { message?: string } })?.error?.message ?? '';
  if (/per day|daily/i.test(message)) daily = true;
  return { daily, retryMs };
}

function thinking(model: string, wanted: 'MINIMAL' | 'LOW'): Record<string, unknown> {
  const levels = THINKING[model];
  if (!levels) return {};
  const order = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
  const level = order.slice(order.indexOf(wanted)).find((l) => levels.includes(l));
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
}

/** Alle Modelle haben ihr Tageskontingent aufgebraucht. */
export class QuotaExhausted extends Error {}

/* ---------- Ergebnisse ---------- */

export interface Suggestion {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  coverId?: number;
  why: string;
  at: number;
}

export interface NightResults {
  /** Eintrag der Bibliothek → zusätzliche Schlagwörter */
  themes: Record<string, { subjects: string[]; at: number }>;
  /** Die neueste Lese-Analyse … */
  analysis?: { text: string; model: string; at: number; rev: number };
  /** … und alle früheren (nichts geht verloren). */
  analyses?: Array<{ text: string; model: string; at: number; rev: number }>;
  suggestions: Suggestion[];
}

export interface NightStatus {
  day: string;
  state: 'idle' | 'running' | 'paused' | 'done' | 'error';
  reason?: 'quota' | 'tasks' | 'window' | 'active' | 'errors';
  startedAt?: number;
  finishedAt?: number;
  requests: number;
  exhausted: string[];
  made: { blurbs: number; themes: number; analysis: number; suggestions: number };
  lastError?: string;
}

interface Entry {
  id: string;
  title: string;
  authors: string[];
  rating: number;
  shelf: string;
  workKey?: string;
  subjects?: string[];
  year?: number;
  dateRead?: string;
  dateAdded?: string;
}

interface WishItem {
  book: { id: string; title: string; authors: string[]; year?: number; subjects?: string[]; originalTitle?: string };
}

export interface NightShiftOptions {
  dir: string;
  geminiKey: string;
  /** Logins (null = ohne Login) */
  users: Array<string | null>;
  sync: SyncStore;
  blurbs: BlurbStore;
  /** Wissensspeicher: geöffnete und gesehene Bücher, gelernte Schlagwörter. */
  knowledge?: KnowledgeStore;
  startHour?: number;
  timeZone?: string;
  clock?: () => number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Abstand zwischen zwei KI-Anfragen (Gratis-Tarif: wenige Anfragen pro Minute). */
  paceMs?: number;
  log?: (message: string) => void;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9À-ɏЀ-ӿ]+/g, ' ')
    .trim();
const surname = (author: string) => normalize(author).split(' ').filter(Boolean).pop() ?? '';

export class NightShift {
  readonly startHour: number;
  readonly timeZone: string;
  private readonly opts: NightShiftOptions;
  private readonly clock: () => number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly paceMs: number;
  private running = false;
  private stopRequested = false;
  private lastActivity = 0;
  private lastRequest = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private status: NightStatus;
  /** Was in dieser Nacht nicht klappte, wird nicht endlos wiederholt. */
  private readonly failedIds = new Set<string>();
  private suggestRounds = 0;

  constructor(opts: NightShiftOptions) {
    this.opts = opts;
    this.startHour = opts.startHour ?? 22;
    this.timeZone = opts.timeZone ?? 'Europe/Zurich';
    this.clock = opts.clock ?? Date.now;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.paceMs = opts.paceMs ?? 7000;
    this.status = this.readJson<NightStatus>(this.statusFile()) ?? this.freshStatus('');
  }

  /* ----- Dateien ----- */

  private folder(): string {
    return join(this.opts.dir, 'nachtschicht');
  }
  private statusFile(): string {
    return join(this.folder(), 'status.json');
  }
  private resultsFile(user: string | null): string {
    return join(this.folder(), `${syncFileName(user)}.json`);
  }
  private readJson<T>(file: string): T | undefined {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
    } catch {
      return undefined;
    }
  }
  private writeJson(file: string, data: unknown) {
    mkdirSync(this.folder(), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }
  results(user: string | null): NightResults {
    return this.readJson<NightResults>(this.resultsFile(user)) ?? { themes: {}, suggestions: [] };
  }
  private saveResults(user: string | null, r: NightResults) {
    this.writeJson(this.resultsFile(user), r);
  }
  private freshStatus(day: string): NightStatus {
    return { day, state: 'idle', requests: 0, exhausted: [], made: { blurbs: 0, themes: 0, analysis: 0, suggestions: 0 } };
  }
  private saveStatus() {
    this.writeJson(this.statusFile(), this.status);
  }

  /* ----- Steuerung ----- */

  getStatus(): NightStatus & { window: { start: number; reset: number }; startHour: number; timeZone: string; running: boolean } {
    const w = nightWindow(this.clock(), this.startHour, this.timeZone);
    return { ...this.status, window: { start: w.start, reset: w.reset }, startHour: this.startHour, timeZone: this.timeZone, running: this.running };
  }

  /** Jemand nutzt gerade die KI in der App – die Nachtschicht lässt ihr den Vortritt. */
  noteActivity() {
    this.lastActivity = this.clock();
  }
  private userActive(): boolean {
    return this.clock() - this.lastActivity < 10 * 60_000;
  }

  start() {
    if (this.timer) return;
    const tick = () => void this.tick();
    setTimeout(tick, 60_000).unref?.();
    this.timer = setInterval(tick, 5 * 60_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopRequested = true;
  }

  /** Einmal prüfen, ob gerade Nachtschicht ist – und dann arbeiten. */
  async tick(): Promise<void> {
    if (this.running) return;
    const now = this.clock();
    const w = nightWindow(now, this.startHour, this.timeZone);
    if (now < w.start || now >= w.reset) return;
    if (this.status.day === w.day && (this.status.state === 'done' || this.status.state === 'error')) return;
    if (this.userActive()) return;
    await this.run(w.day, w.reset);
  }

  /** Sofort starten (z. B. aus den Einstellungen) – verbraucht das restliche Kontingent des laufenden Google-Tages. */
  async runNow(): Promise<void> {
    if (this.running) return;
    const la = zoned(this.clock(), 'America/Los_Angeles');
    await this.run(`${la.y}-${String(la.mo).padStart(2, '0')}-${String(la.d).padStart(2, '0')}`, Number.POSITIVE_INFINITY, true);
  }

  private async run(day: string, until: number, manual = false): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    if (this.status.day !== day) {
      this.status = this.freshStatus(day);
      this.failedIds.clear();
      this.suggestRounds = 0;
    }
    this.status.state = 'running';
    this.status.reason = undefined;
    this.status.startedAt = this.clock();
    this.saveStatus();
    this.opts.log?.(`Nachtschicht beginnt (Google-Tag ${day})`);
    let failures = 0;
    try {
      for (const user of this.opts.users) {
        for (;;) {
          if (this.stopRequested) return this.finish('idle', 'window');
          if (this.clock() >= until) return this.finish('idle', 'window');
          if (!manual && this.userActive()) return this.finish('paused', 'active');
          const task = this.nextTask(user);
          if (!task) break;
          try {
            await task();
            failures = 0;
          } catch (err) {
            if (err instanceof QuotaExhausted) return this.finish('done', 'quota');
            failures++;
            this.status.lastError = err instanceof Error ? err.message : String(err);
            this.saveStatus();
            if (failures >= 5) return this.finish('error', 'errors');
          }
        }
      }
      this.finish('done', 'tasks');
    } finally {
      this.running = false;
    }
  }

  private finish(state: NightStatus['state'], reason: NightStatus['reason']) {
    this.status.state = state;
    this.status.reason = reason;
    this.status.finishedAt = this.clock();
    this.saveStatus();
    const m = this.status.made;
    this.opts.log?.(
      `Nachtschicht ${state === 'done' ? 'fertig' : state === 'paused' ? 'pausiert' : 'unterbrochen'} (${reason}): ${this.status.requests} Anfragen – ${m.blurbs} Kurzbeschreibungen, ${m.themes} Bücher verschlagwortet, ${m.analysis} Analyse, ${m.suggestions} Vorschläge`,
    );
  }

  /* ----- Aufgaben ----- */

  private library(user: string | null): Entry[] {
    return Object.values(this.opts.sync.records(user, 'library')).filter((e): e is Entry => Boolean(e && typeof e === 'object' && 'title' in (e as object)));
  }

  /** Bücher, die nicht mehr vorgeschlagen werden sollen („Nicht meins“, ausgeblendet). */
  private dismissed(user: string | null): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, v] of Object.entries(this.opts.sync.records(user, 'signals') as Record<string, { verdict?: string; title?: string }>)) {
      if (v?.verdict === 'dislike' || v?.verdict === 'hide') out.set(id, v.title ?? '');
    }
    return out;
  }

  /** Die nächste sinnvolle Aufgabe für dieses Login – oder keine mehr. */
  private nextTask(user: string | null): (() => Promise<void>) | undefined {
    const blurbs = this.opts.blurbs;
    const knowledge = this.opts.knowledge;
    const results = this.results(user);
    const library = this.library(user);
    const failed = this.failedIds;
    const needsBlurb = (id: string) => !id.startsWith('ai:') && !blurbs.get(user, id) && !failed.has(`blurb:${id}`);
    const stats = knowledge?.stats(user) ?? {};
    const fromCatalog = (id: string) => {
      const b = knowledge?.book(id);
      return b ? { id, title: b.title, author: b.authors[0] ?? '', year: b.year, subjects: [...(b.learned?.subjects ?? []), ...b.subjects].slice(0, 15) } : undefined;
    };

    // 1. Geöffnete Bücher ohne Kurzbeschreibung (tagsüber reichte das Kontingent nicht) – die neuesten zuerst
    const opened = Object.entries(stats)
      .filter(([id, s]) => s.opened > 0 && needsBlurb(id))
      .sort((a, b) => (b[1].lastOpened ?? 0) - (a[1].lastOpened ?? 0))
      .map(([id]) => fromCatalog(id))
      .find(Boolean);
    if (opened) return () => this.blurbTask(user, opened, library);

    // 2. Kurzbeschreibungen für Merkliste und „Will ich lesen“
    const wish = Object.values(this.opts.sync.records(user, 'wishlist')) as WishItem[];
    const wanted = [
      ...wish.filter((w) => w?.book?.id).map((w) => ({ id: w.book.id, title: w.book.title, author: w.book.authors?.[0] ?? '', year: w.book.year, subjects: w.book.subjects ?? [] })),
      ...library
        .filter((e) => e.shelf === 'to-read' && e.workKey)
        .map((e) => ({ id: e.workKey!.replace('/works/', ''), title: e.title, author: e.authors?.[0] ?? '', year: e.year, subjects: e.subjects ?? [] })),
    ].filter((b) => needsBlurb(b.id));
    if (wanted.length) return () => this.blurbTask(user, wanted[0], library);

    // 3. Schlagwörter für die Bibliothek – schlecht verschlagwortete Bücher zuerst
    const untagged = library
      .filter((e) => !results.themes[e.id] && !failed.has(`themes:${e.id}`))
      .sort((a, b) => (a.subjects?.length ?? 0) - (b.subjects?.length ?? 0));
    if (untagged.length) return () => this.themesTask(user, untagged.slice(0, THEME_BATCH));

    // 4. Lese-Analyse, wenn sich die Bibliothek seit der letzten geändert hat (höchstens täglich)
    const rev = this.opts.sync.revision(user);
    const stale = !results.analysis || (results.analysis.rev !== rev && this.clock() - results.analysis.at > 20 * 3600_000);
    if (library.filter((e) => e.shelf === 'read').length >= 5 && stale && !failed.has('analysis')) return () => this.analysisTask(user, library, rev);

    // 5. Vorschläge ohne Kurzbeschreibung nachliefern; eine erste Vorschlagsrunde pro Nacht
    const pending = results.suggestions.find((s) => needsBlurb(s.id));
    if (pending) return () => this.blurbTask(user, { id: pending.id, title: pending.title, author: pending.authors[0] ?? '', year: pending.year, subjects: [] }, library);
    if (library.length && !failed.has('suggest') && this.suggestRounds === 0) return () => this.suggestTask(user, library, wish);

    if (knowledge) {
      const dismissed = this.dismissed(user);
      const read = new Set(library.filter((e) => e.shelf !== 'to-read' && e.workKey).map((e) => e.workKey!.replace('/works/', '')));
      const recent = Object.entries(stats)
        .filter(([id]) => !dismissed.has(id) && !read.has(id))
        .sort((a, b) => Math.max(b[1].lastSeen ?? 0, b[1].lastOpened ?? 0) - Math.max(a[1].lastSeen ?? 0, a[1].lastOpened ?? 0))
        .map(([id]) => id);
      // 6a. Schlagwörter für Bücher aus dem Wissensspeicher – zwölf auf einmal, das Gesehene zuerst
      const unlearned = recent.filter((id) => !knowledge.book(id)?.learned && !failed.has(`learn:${id}`)).slice(0, THEME_BATCH);
      if (unlearned.length >= 4 || (unlearned.length && !recent.some((id) => needsBlurb(id)))) return () => this.learnTask(unlearned);
      // 6b. Kurzbeschreibungen für Bücher, die dir angezeigt wurden – damit sie da sind, wenn du sie öffnest
      const seen = recent.map((id) => (needsBlurb(id) ? fromCatalog(id) : undefined)).find(Boolean);
      if (seen) return () => this.blurbTask(user, seen, library);
    }

    // 7. Weitere Vorschlagsrunden, solange sie Neues bringen
    if (library.length && !failed.has('suggest')) return () => this.suggestTask(user, library, wish);
    return undefined;
  }

  private async withFailureMark<T>(key: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof QuotaExhausted)) this.failedIds.add(key);
      throw err;
    }
  }

  private async blurbTask(user: string | null, b: { id: string; title: string; author: string; year?: number; subjects: string[] }, library: Entry[]) {
    await this.withFailureMark(`blurb:${b.id}`, async () => {
      const description = /^OL\d+W$/.test(b.id) ? await this.workDescription(b.id) : undefined;
      const prompt = [
        `Buch: „${b.title}“ von ${b.author || 'unbekannt'}${b.year ? ` (${b.year})` : ''}.`,
        description ? `Klappentext (evtl. in einer anderen Sprache):\n${description.slice(0, 2000)}` : '',
        b.subjects.length ? `Schlagwörter: ${b.subjects.slice(0, 15).join(', ')}` : '',
        '',
        ...BLURB_INSTRUCTIONS,
      ]
        .filter(Boolean)
        .join('\n');
      const system = `Du schreibst deutsche Kurzbeschreibungen für die App „Lesekompass“: konkret und gehaltvoll, ohne Werbesprache.\n\nLesekontext der Person:\n${compactContext(library)}`;
      const reply = await this.gemini({ system, prompt, chain: LIGHT_CHAIN, maxTokens: 2048 });
      if (!this.opts.blurbs.set(user, b.id, reply.text.trim(), modelLabel(reply.model))) throw new Error('Kurzbeschreibung unbrauchbar');
      this.status.made.blurbs++;
      this.saveStatus();
    });
  }

  private async themesTask(user: string | null, batch: Entry[]) {
    await this.withFailureMark(`themes:${batch[0].id}`, async () => {
      const list = batch.map((e, i) => `${i + 1}. „${e.title}“ – ${e.authors?.[0] ?? '?'}${e.year ? ` (${e.year})` : ''}`).join('\n');
      const prompt = `Gib für jedes Buch 5 bis 8 englische Schlagwörter im Stil von Open Library / Library of Congress: Genre (z. B. "Detective and mystery stories", "Fantasy fiction"), Themen (z. B. "Grief", "Families"), Ton (z. B. "Humorous stories", "Psychological fiction") und Schauplatz (z. B. "Sweden"). Nur Bücher, die du sicher kennst – sonst eine leere Liste.\n\n${list}`;
      const schema = {
        type: 'object',
        properties: { books: { type: 'array', items: { type: 'object', properties: { nr: { type: 'integer' }, subjects: { type: 'array', items: { type: 'string' } } }, required: ['nr', 'subjects'] } } },
        required: ['books'],
      };
      const reply = await this.gemini({ system: 'Du bist eine sorgfältige Bibliothekarin.', prompt, chain: LIGHT_CHAIN, schema, maxTokens: 4096 });
      const data = JSON.parse(reply.text) as { books?: Array<{ nr: number; subjects: string[] }> };
      const results = this.results(user);
      batch.forEach((e, i) => {
        const subjects = (data.books?.find((b) => b.nr === i + 1)?.subjects ?? [])
          .filter((s) => typeof s === 'string' && s.length > 2 && s.length < 60)
          .slice(0, 8);
        results.themes[e.id] = { subjects, at: this.clock() };
        if (e.workKey) this.opts.knowledge?.learn(e.workKey.replace('/works/', ''), subjects, reply.model, { title: e.title, authors: e.authors ?? [], year: e.year });
      });
      this.saveResults(user, results);
      this.status.made.themes += batch.length;
      this.saveStatus();
    });
  }

  /** Schlagwörter für Bücher aus dem Wissensspeicher – zwölf pro Anfrage, verbessern die Empfehlungen überall. */
  private async learnTask(ids: string[]) {
    const knowledge = this.opts.knowledge;
    if (!knowledge) return;
    await this.withFailureMark(`learn:${ids[0]}`, async () => {
      const books = ids.map((id) => ({ id, b: knowledge.book(id)! })).filter((x) => x.b);
      const list = books.map((x, i) => `${i + 1}. „${x.b.title}“ – ${x.b.authors[0] ?? '?'}${x.b.year ? ` (${x.b.year})` : ''}`).join('\n');
      const prompt = `Gib für jedes Buch 5 bis 8 englische Schlagwörter im Stil von Open Library / Library of Congress: Genre (z. B. "Detective and mystery stories", "Fantasy fiction"), Themen (z. B. "Grief", "Families"), Ton (z. B. "Humorous stories", "Psychological fiction") und Schauplatz (z. B. "Sweden"). Nur Bücher, die du sicher kennst – sonst eine leere Liste.\n\n${list}`;
      const schema = {
        type: 'object',
        properties: { books: { type: 'array', items: { type: 'object', properties: { nr: { type: 'integer' }, subjects: { type: 'array', items: { type: 'string' } } }, required: ['nr', 'subjects'] } } },
        required: ['books'],
      };
      const reply = await this.gemini({ system: 'Du bist eine sorgfältige Bibliothekarin.', prompt, chain: LIGHT_CHAIN, schema, maxTokens: 4096 });
      const data = JSON.parse(reply.text) as { books?: Array<{ nr: number; subjects: string[] }> };
      books.forEach((x, i) => {
        const subjects = (data.books?.find((b) => b.nr === i + 1)?.subjects ?? []).filter((s) => typeof s === 'string' && s.length > 2 && s.length < 60).slice(0, 8);
        knowledge.learn(x.id, subjects, reply.model);
      });
      this.status.made.themes += books.length;
      this.saveStatus();
    });
  }

  private async analysisTask(user: string | null, library: Entry[], rev: number) {
    await this.withFailureMark('analysis', async () => {
      const prompt = `${fullContext(library)}

Schreib eine persönliche Lese-Analyse auf Deutsch (300–450 Wörter), mit diesen vier Zwischentiteln als eigene Zeilen:
## Was dich anzieht
## Wie sich dein Lesen verändert
## Blinde Flecken
## Fünf Bücher für die nächsten Wochen
Sei konkret und beziehe dich auf Titel aus der Liste. Bei den fünf Büchern: nur echte Bücher, die nicht in der Liste stehen, jedes als [[Titel|Autor]] (deutscher Titel, falls vorhanden) mit einem Satz, warum. Schweizer Rechtschreibung (ss statt ß).`;
      const reply = await this.gemini({ system: 'Du bist eine belesene, warmherzige Buchhändlerin, die ihre Stammkundschaft genau kennt.', prompt, chain: MAIN_CHAIN, maxTokens: 6000 });
      const results = this.results(user);
      results.analysis = { text: reply.text.trim(), model: modelLabel(reply.model), at: this.clock(), rev };
      results.analyses = [...(results.analyses ?? []), results.analysis];
      this.saveResults(user, results);
      this.status.made.analysis++;
      this.saveStatus();
    });
  }

  private async suggestTask(user: string | null, library: Entry[], wish: WishItem[]) {
    this.suggestRounds++;
    await this.withFailureMark('suggest', async () => {
      const results = this.results(user);
      const avoid = [...library.map((e) => e.title), ...wish.map((w) => w.book?.title ?? ''), ...results.suggestions.map((s) => s.title), ...this.dismissed(user).values()].filter(Boolean);
      const prompt = `${compactContext(library)}

Schlage 10 Bücher vor, die diese Person noch nicht kennt und die gut zu ihr passen – abwechslungsreich, gern auch weniger bekannte, aber keine Obskuritäten. Nur Bücher, die es wirklich gibt. Deutscher Titel, falls es eine deutsche Ausgabe gibt.
Nicht vorschlagen (schon bekannt): ${avoid.slice(-400).join(' | ')}`;
      const schema = {
        type: 'object',
        properties: {
          books: {
            type: 'array',
            items: { type: 'object', properties: { title: { type: 'string' }, author: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'author', 'why'] },
          },
        },
        required: ['books'],
      };
      const reply = await this.gemini({ system: 'Du bist eine belesene Buchhändlerin. Antworte auf Deutsch.', prompt, chain: MAIN_CHAIN, schema, maxTokens: 4096 });
      const data = JSON.parse(reply.text) as { books?: Array<{ title: string; author: string; why: string }> };
      const known = new Set(avoid.map(normalize));
      let added = 0;
      for (const rec of data.books ?? []) {
        if (!rec?.title || known.has(normalize(rec.title))) continue;
        const found = await this.resolve(rec.title, rec.author);
        if (!found || results.suggestions.some((s) => s.id === found.id) || library.some((e) => e.workKey === `/works/${found.id}`)) continue;
        results.suggestions.push({ ...found, why: String(rec.why ?? '').slice(0, 300), at: this.clock() });
        this.opts.knowledge?.report(user, [{ id: found.id, title: found.title, authors: found.authors, year: found.year, coverId: found.coverId, subjects: [], event: 'suggested' }]);
        known.add(normalize(rec.title));
        added++;
      }
      results.suggestions = results.suggestions.slice(-MAX_SUGGESTIONS);
      this.saveResults(user, results);
      this.status.made.suggestions += added;
      this.saveStatus();
      // Nichts Neues gefunden? Dann für diese Nacht keine weiteren Vorschlagsrunden
      if (!added) this.failedIds.add('suggest');
    });
  }

  /* ----- Schnittstellen ----- */

  private async pace() {
    const wait = this.lastRequest + this.paceMs - this.clock();
    if (wait > 0) await this.sleep(wait);
    this.lastRequest = this.clock();
  }

  /** Eine Gemini-Anfrage über die Modellkette; Tageskontingente werden vermerkt. */
  async gemini(req: { system: string; prompt: string; chain: string[]; schema?: unknown; maxTokens: number }): Promise<{ text: string; model: string }> {
    for (const model of req.chain) {
      if (this.status.exhausted.includes(model)) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.pace();
        const body = {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            ...thinking(model, req.schema ? 'MINIMAL' : 'LOW'),
            ...(req.schema ? { responseMimeType: 'application/json', responseJsonSchema: req.schema } : {}),
          },
        };
        const res = await this.fetchFn(`${GEMINI}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.opts.geminiKey },
          body: JSON.stringify(body),
        });
        this.status.requests++;
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          data = undefined;
        }
        if (res.ok) {
          const parts = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })?.candidates?.[0]?.content?.parts ?? [];
          const text = parts
            .filter((p) => !p.thought && p.text)
            .map((p) => p.text)
            .join('');
          if (!text) throw new Error(`${model}: leere Antwort`);
          return { text: text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''), model };
        }
        if (res.status === 429) {
          const q = quotaKind(data);
          // Zweimal hintereinander Minutenlimit gilt ebenfalls als erschöpft
          if (q.daily || attempt === 2) {
            this.status.exhausted.push(model);
            this.saveStatus();
            this.opts.log?.(`Nachtschicht: Tageskontingent von ${model} aufgebraucht`);
            break;
          }
          await this.sleep(q.retryMs ?? 65_000);
          continue;
        }
        if (res.status === 404) {
          // Modell für diesen Schlüssel nicht verfügbar
          this.status.exhausted.push(model);
          break;
        }
        if (res.status >= 500) {
          await this.sleep(30_000);
          continue;
        }
        const message = (data as { error?: { message?: string } })?.error?.message ?? '';
        throw new Error(`Gemini ${res.status}${message ? `: ${message.slice(0, 200)}` : ''}`);
      }
    }
    throw new QuotaExhausted('Alle Gemini-Modelle haben ihr Tageskontingent aufgebraucht');
  }

  private async workDescription(id: string): Promise<string | undefined> {
    try {
      const res = await this.fetchFn(`${OPEN_LIBRARY}/works/${id}.json`, { headers: { accept: 'application/json' } });
      if (!res.ok) return undefined;
      const w = (await res.json()) as { description?: string | { value?: string } };
      return typeof w.description === 'string' ? w.description : w.description?.value;
    } catch {
      return undefined;
    }
  }

  /** Vorschlag auf Open Library finden (Werk-ID, Cover, Jahr) – sonst verwerfen. */
  async resolve(title: string, author: string): Promise<Omit<Suggestion, 'why' | 'at'> | undefined> {
    const q = `${title} ${surname(author)}`.trim();
    const url = `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,first_publish_year,cover_i,editions,editions.title,editions.language&lang=de&limit=5`;
    try {
      const res = await this.fetchFn(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return undefined;
      const data = (await res.json()) as {
        docs?: Array<{ key: string; title: string; author_name?: string[]; first_publish_year?: number; cover_i?: number; editions?: { docs?: Array<{ title?: string; language?: string[] }> } }>;
      };
      const wanted = normalize(title).split(' ').filter((w) => w.length > 2);
      const sur = surname(author);
      for (const d of data.docs ?? []) {
        const authorOk = !sur || (d.author_name ?? []).some((a) => normalize(a).includes(sur));
        const german = d.editions?.docs?.find((e) => e.language?.includes('ger'))?.title;
        const titles = [d.title, german].filter(Boolean).map((t) => normalize(t!));
        const overlap = wanted.length ? Math.max(...titles.map((t) => wanted.filter((w) => t.includes(w)).length / wanted.length)) : 1;
        if (!authorOk || overlap < 0.5) continue;
        return { id: d.key.replace('/works/', ''), title: german ?? d.title, authors: d.author_name?.slice(0, 2) ?? [author], year: d.first_publish_year, coverId: d.cover_i };
      }
    } catch {
      /* Open Library nicht erreichbar */
    }
    return undefined;
  }
}

function modelLabel(model: string): string {
  return model.replace(/^gemini-/, 'Gemini ').replace(/-flash-lite$/, ' Flash-Lite').replace(/-flash$/, ' Flash');
}

const fmt = (e: Entry) => `${e.title.replace(/\s*\(.*?\)/, '')} – ${e.authors?.[0] ?? '?'}`;

/** Knapp: Lieblingsbücher und Abneigungen. */
export function compactContext(library: Entry[]): string {
  const read = library.filter((e) => e.shelf === 'read');
  const favorites = read.filter((e) => e.rating >= 5).slice(0, 15);
  const disliked = read.filter((e) => e.rating > 0 && e.rating <= 2).slice(0, 8);
  const lines = [];
  if (favorites.length) lines.push(`Lieblingsbücher: ${favorites.map(fmt).join('; ')}`);
  if (disliked.length) lines.push(`Nicht gefallen: ${disliked.map(fmt).join('; ')}`);
  return lines.join('\n') || 'Es liegen kaum Informationen über bisher gelesene Bücher vor.';
}

/** Ausführlich – für die tägliche Analyse. */
export function fullContext(library: Entry[]): string {
  const read = library.filter((e) => e.shelf === 'read');
  const byDate = [...read].sort((a, b) => (b.dateRead ?? b.dateAdded ?? '').localeCompare(a.dateRead ?? a.dateAdded ?? ''));
  const authors = new Map<string, number>();
  for (const e of read) if (e.authors?.[0]) authors.set(e.authors[0], (authors.get(e.authors[0]) ?? 0) + 1);
  const top = Array.from(authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([a, n]) => `${a} (${n})`);
  return [
    `Gelesene Bücher: ${read.length}, auf der Will-ich-lesen-Liste: ${library.filter((e) => e.shelf === 'to-read').length}.`,
    `5★: ${read.filter((e) => e.rating === 5).slice(0, 40).map(fmt).join('; ') || '–'}`,
    `4★: ${read.filter((e) => e.rating === 4).slice(0, 30).map(fmt).join('; ') || '–'}`,
    `1–2★: ${read.filter((e) => e.rating > 0 && e.rating <= 2).slice(0, 20).map(fmt).join('; ') || '–'}`,
    `Zuletzt gelesen: ${byDate.slice(0, 20).map((e) => `${fmt(e)}${e.dateRead ? ` (${e.dateRead.slice(0, 7)})` : ''}`).join('; ') || '–'}`,
    `Häufigste Autor:innen: ${top.join(', ') || '–'}`,
  ].join('\n');
}
