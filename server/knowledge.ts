/**
 * Wissensspeicher: Alles, was der Lesekompass über Bücher lernt, bleibt auf dem Server erhalten –
 * eine wachsende Datenbank, aus der die Empfehlungen laufend besser werden.
 *
 *   <data>/wissen/buecher.json   – jedes Buch, das in der App vorkam: Titel, Autor:in, Jahr,
 *                                  Bekanntheit, Schlagwörter von Open Library und die von der KI
 *                                  gelernten (Nachtschicht)
 *   <data>/wissen/<login>.json   – wie oft du ein Buch gesehen und geöffnet hast
 *
 * Daraus lernt der Algorithmus laufend nach (tuning): Welche Bekanntheit haben die Bücher, die du
 * öffnest, merkst oder magst – im Vergleich zu denen, die du übergehst oder ausblendest? Danach
 * richtet sich, wie bekannt die Vorschläge sein sollen.
 *
 * Entscheidungen (Stapel, Ausblenden, Bewertungen) liegen im Abgleich (syncStore.ts), die
 * Kurzbeschreibungen in kurzbeschreibungen.json, Analysen und Vorschläge bei der Nachtschicht.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncFileName } from './syncStore.ts';

export interface KnownBook {
  title: string;
  authors: string[];
  year?: number;
  coverId?: number;
  subjects: string[];
  /** Bekanntheit (wie fameScore in der App: 0 = unbekannt … ~4 = Welt-Bestseller). */
  fame?: number;
  /** Von der KI gelernte Schlagwörter (Nachtschicht). */
  learned?: { subjects: string[]; model: string; at: number };
  firstSeen: number;
  lastSeen: number;
}

export interface BookStats {
  seen: number;
  opened: number;
  lastSeen?: number;
  lastOpened?: number;
}

export type BookEvent = 'seen' | 'opened' | 'suggested';

export interface ReportedBook {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  coverId?: number;
  subjects: string[];
  fame?: number;
  event: BookEvent;
}

export interface Tuning {
  /** Verschiebt den „Sweet Spot“ der Bekanntheit: + bekannter, − weniger bekannt (−0.6 … +0.6). */
  fameShift: number;
  positives: number;
  negatives: number;
  meanPositive?: number;
  meanNegative?: number;
}

const MAX_BOOKS = 200_000;
const MAX_REPORT = 200;
const EVENTS: BookEvent[] = ['seen', 'opened', 'suggested'];

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/** Prüft, was ein Browser meldet – Unbrauchbares fällt still weg. */
export function cleanReport(input: unknown): ReportedBook[] {
  const list = (input as { books?: unknown })?.books;
  if (!Array.isArray(list)) return [];
  const out: ReportedBook[] = [];
  for (const raw of list.slice(0, MAX_REPORT)) {
    const r = raw as Record<string, unknown>;
    const id = str(r.id, 120);
    const title = str(r.title, 300);
    const event = EVENTS.find((e) => e === r.event);
    if (!id || !/^[A-Za-z0-9:._-]+$/.test(id) || id.startsWith('ai:') || !title || !event) continue;
    out.push({
      id,
      title,
      authors: (Array.isArray(r.authors) ? r.authors : []).map((a) => str(a, 150)).filter((a): a is string => Boolean(a)).slice(0, 5),
      year: num(r.year, 0, 3000),
      coverId: num(r.coverId, 1, 1e10),
      subjects: (Array.isArray(r.subjects) ? r.subjects : []).map((s) => str(s, 120)).filter((s): s is string => Boolean(s)).slice(0, 30),
      fame: num(r.fame, 0, 10),
      event,
    });
  }
  return out;
}

export class KnowledgeStore {
  private readonly dir: string;
  private readonly clock: () => number;
  private books: Record<string, KnownBook> | undefined;
  private readonly users = new Map<string, Record<string, BookStats>>();
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(dataDir: string, clock: () => number = Date.now) {
    this.dir = join(dataDir, 'wissen');
    this.clock = clock;
  }

  private read<T>(file: string, fallback: T): T {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private booksFile() {
    return join(this.dir, 'buecher.json');
  }
  private userFile(user: string | null) {
    return join(this.dir, `${syncFileName(user)}.json`);
  }
  private catalog(): Record<string, KnownBook> {
    this.books ??= this.read<Record<string, KnownBook>>(this.booksFile(), {});
    return this.books;
  }
  private userStats(user: string | null): Record<string, BookStats> {
    const key = syncFileName(user);
    let stats = this.users.get(key);
    if (!stats) {
      stats = this.read<Record<string, BookStats>>(this.userFile(user), {});
      this.users.set(key, stats);
    }
    return stats;
  }

  /** Bücher aus der App übernehmen und zählen, wie oft sie gesehen bzw. geöffnet wurden. */
  report(user: string | null, books: ReportedBook[]): number {
    const catalog = this.catalog();
    const stats = this.userStats(user);
    const now = this.clock();
    for (const b of books) {
      const known = catalog[b.id];
      catalog[b.id] = {
        ...known,
        title: b.title,
        authors: b.authors.length ? b.authors : (known?.authors ?? []),
        year: b.year ?? known?.year,
        coverId: b.coverId ?? known?.coverId,
        subjects: Array.from(new Set([...(known?.subjects ?? []), ...b.subjects])).slice(0, 40),
        fame: b.fame ?? known?.fame,
        firstSeen: known?.firstSeen ?? now,
        lastSeen: now,
      };
      if (b.event === 'suggested') continue;
      const s = stats[b.id] ?? { seen: 0, opened: 0 };
      if (b.event === 'seen') stats[b.id] = { ...s, seen: s.seen + 1, lastSeen: now };
      else stats[b.id] = { ...s, opened: s.opened + 1, lastOpened: now };
    }
    this.trim();
    this.dirty.add('books');
    this.dirty.add(syncFileName(user));
    this.scheduleSave(user);
    return books.length;
  }

  /** Von der KI gelernte Schlagwörter festhalten (auch eine leere Liste: „kennt die KI nicht“). */
  learn(id: string, subjects: string[], model: string, fallback?: Pick<KnownBook, 'title' | 'authors' | 'year'>) {
    const catalog = this.catalog();
    const now = this.clock();
    const known = catalog[id] ?? (fallback ? { ...fallback, subjects: [], firstSeen: now, lastSeen: now } : undefined);
    if (!known) return;
    catalog[id] = { ...known, learned: { subjects: subjects.slice(0, 12), model, at: now } };
    this.dirty.add('books');
    this.scheduleSave(null);
  }

  book(id: string): KnownBook | undefined {
    return this.catalog()[id];
  }

  stats(user: string | null): Record<string, BookStats> {
    return this.userStats(user);
  }

  /** Buch → von der KI gelernte Schlagwörter (für die App: ergänzt die Themen von Open Library). */
  learnedSubjects(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, b] of Object.entries(this.catalog())) if (b.learned?.subjects.length) out[id] = b.learned.subjects;
    return out;
  }

  summary(user: string | null): { books: number; learned: number; seen: number; opened: number } {
    const catalog = Object.values(this.catalog());
    const stats = Object.values(this.userStats(user));
    return {
      books: catalog.length,
      learned: catalog.filter((b) => b.learned).length,
      seen: stats.filter((s) => s.seen > 0).length,
      opened: stats.filter((s) => s.opened > 0).length,
    };
  }

  /**
   * Was der Algorithmus aus deinem Verhalten lernt. Positiv: geöffnet, gemerkt, „mehr davon“.
   * Negativ: ausgeblendet, „nicht meins“ oder mehrmals gesehen und nie geöffnet. Liegen die
   * positiven Bücher im Schnitt bekannter als die negativen, rücken bekanntere Bücher nach vorne –
   * und umgekehrt. Erst ab genug Beobachtungen, und nie mehr als ±0.6.
   */
  tuning(user: string | null, signals: Record<string, { verdict?: string }> = {}): Tuning {
    const catalog = this.catalog();
    const stats = this.userStats(user);
    let posSum = 0;
    let pos = 0;
    let negSum = 0;
    let neg = 0;
    const ids = new Set([...Object.keys(stats), ...Object.keys(signals)]);
    for (const id of ids) {
      const fame = catalog[id]?.fame;
      if (fame === undefined) continue;
      const s = stats[id];
      const verdict = signals[id]?.verdict;
      if (verdict === 'save' || verdict === 'like' || (s?.opened ?? 0) > 0) {
        posSum += fame;
        pos++;
      } else if (verdict === 'hide' || verdict === 'dislike' || ((s?.seen ?? 0) >= 2 && !s?.opened)) {
        negSum += fame;
        neg++;
      }
    }
    if (pos < 8 || neg < 8) return { fameShift: 0, positives: pos, negatives: neg };
    const meanPositive = posSum / pos;
    const meanNegative = negSum / neg;
    const confidence = Math.min(1, Math.min(pos, neg) / 30);
    const fameShift = Math.max(-0.6, Math.min(0.6, (meanPositive - meanNegative) * 0.6 * confidence));
    return { fameShift: Math.round(fameShift * 100) / 100, positives: pos, negatives: neg, meanPositive, meanNegative };
  }

  /** Alles zu einem Login – für den Download „Wissensdatenbank“. */
  exportFor(user: string | null): { buecher: Record<string, KnownBook & { statistik?: BookStats }> } {
    const catalog = this.catalog();
    const stats = this.userStats(user);
    const out: Record<string, KnownBook & { statistik?: BookStats }> = {};
    for (const [id, b] of Object.entries(catalog)) out[id] = stats[id] ? { ...b, statistik: stats[id] } : b;
    return { buecher: out };
  }

  private trim() {
    const catalog = this.catalog();
    const ids = Object.keys(catalog);
    if (ids.length <= MAX_BOOKS) return;
    // Zuerst gehen Bücher, die lange nicht mehr vorkamen und nichts Gelerntes tragen
    ids.sort((a, b) => Number(Boolean(catalog[a].learned)) - Number(Boolean(catalog[b].learned)) || catalog[a].lastSeen - catalog[b].lastSeen);
    for (const id of ids.slice(0, ids.length - MAX_BOOKS)) delete catalog[id];
  }

  private pendingUsers = new Map<string, string | null>();
  private scheduleSave(user: string | null) {
    this.pendingUsers.set(syncFileName(user), user);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 3000);
    this.timer.unref?.();
  }

  flush() {
    if (!this.dirty.size) return;
    mkdirSync(this.dir, { recursive: true });
    const write = (file: string, data: unknown) => {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, file);
    };
    if (this.dirty.has('books') && this.books) write(this.booksFile(), this.books);
    for (const [key, user] of this.pendingUsers) if (this.dirty.has(key)) write(this.userFile(user), this.userStats(user));
    this.dirty.clear();
    this.pendingUsers.clear();
  }
}
