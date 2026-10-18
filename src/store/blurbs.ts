/**
 * KI-Kurzbeschreibungen für Buchseite und Bücher-Stapel – an einem Ort, damit dasselbe Buch nie
 * zweimal gleichzeitig angefragt wird. Gemerkt auf dem Gerät und auf dem Server (blurbCache).
 *
 * Automatisch entsteht eine Beschreibung nur, wenn es keinen gehaltvollen deutschen Text einer
 * anderen Quelle gibt (siehe lib/bookTexts). Antwortet keine KI (Kontingent aufgebraucht), pausiert
 * das Automatische eine Weile – dann zeigen Buchseite und Stapel die übrigen Quellen.
 */
import { create } from 'zustand';
import type { AiConfig } from '../lib/aiPrompts';
import { fetchSharedBlurb, readBlurb, shareBlurb, writeBlurb } from '../lib/blurbCache';
import type { TasteProfile } from '../lib/profile';
import type { Book, LibraryEntry } from '../lib/types';
import { useSettings } from './settings';

export interface BlurbView {
  text?: string;
  model?: string;
  note?: string;
  /** Wird gerade geschrieben. */
  busy?: boolean;
  /** Wird gesucht oder gleich geschrieben – noch nicht entschieden. */
  pending?: boolean;
  /** Schon nachgeschaut (Gerät und Server). */
  checked?: boolean;
  error?: string;
}

export interface BlurbJob {
  config: AiConfig;
  entries: LibraryEntry[];
  profile?: TasteProfile;
  description?: string;
  wiki?: string;
}

export const useBlurbs = create<{ items: Record<string, BlurbView> }>(() => ({ items: {} }));

function patch(id: string, v: Partial<BlurbView>) {
  useBlurbs.setState((s) => ({ items: { ...s.items, [id]: { ...s.items[id], ...v } } }));
}

const lookups = new Map<string, Promise<boolean>>();
const running = new Map<string, Promise<void>>();
/** Nach einem Fehlschlag (meist: Kontingent aufgebraucht) eine Weile nichts automatisch anfragen. */
const PAUSE_MS = 15 * 60_000;
let pausedUntil = 0;

export function autoBlurbPaused(now = Date.now()): boolean {
  return now < pausedUntil;
}

/** Gibt es schon eine (auf dem Gerät oder auf dem Server)? */
export function lookupBlurb(id: string): Promise<boolean> {
  if (useBlurbs.getState().items[id]?.text) return Promise.resolve(true);
  const local = readBlurb(id);
  if (local) {
    patch(id, { ...local, checked: true });
    return Promise.resolve(true);
  }
  let p = lookups.get(id);
  if (!p) {
    p = fetchSharedBlurb(id).then((shared) => {
      if (shared && !useBlurbs.getState().items[id]?.text) patch(id, { ...shared, checked: true });
      else patch(id, { checked: true });
      lookups.delete(id);
      return Boolean(shared);
    });
    lookups.set(id, p);
  }
  return p;
}

/** Schreibt die Beschreibung (gestreamt) – pro Buch höchstens eine Anfrage gleichzeitig. */
export function generateBlurb(book: Book, job: BlurbJob, opts: { auto?: boolean } = {}): Promise<void> {
  const already = running.get(book.id);
  if (already) return already;
  const p = (async () => {
    const { aiErrorMessage, aiText, AI_MODEL_NAMES, BLURB_SYSTEM, blurbPrompt, compactReadingContext } = await import('../lib/ai');
    patch(book.id, { busy: true, text: '', error: undefined });
    let acc = '';
    try {
      const reply = await aiText(
        job.config,
        // Knapper Lesekontext und ein günstiges Modell: eine Kurzbeschreibung braucht nicht die ganze Bibliothek
        [BLURB_SYSTEM, `Lesekontext der Person:\n${compactReadingContext(job.entries, job.profile)}`],
        blurbPrompt({
          title: book.title,
          author: book.authors[0] ?? 'unbekannt',
          year: book.year,
          originalTitle: book.originalTitle,
          description: job.description,
          wiki: job.wiki,
          subjects: book.subjects,
        }),
        (delta) => {
          acc += delta;
          patch(book.id, { busy: true, text: acc });
        },
        { light: true },
      );
      const done = { text: reply.text.trim(), model: AI_MODEL_NAMES[reply.model] ?? reply.model };
      patch(book.id, { ...done, note: reply.note, busy: false, checked: true });
      writeBlurb(book.id, done);
      shareBlurb(book.id, done);
    } catch (err) {
      if (opts.auto) pausedUntil = Date.now() + PAUSE_MS;
      patch(book.id, { busy: false, text: undefined, error: aiErrorMessage(err) });
    } finally {
      running.delete(book.id);
    }
  })();
  running.set(book.id, p);
  return p;
}

/**
 * Automatisch: erst nachschauen, dann – falls eingeschaltet, eine KI da ist und das Kontingent
 * reicht – schreiben. `job` fehlt, wenn es einen guten deutschen Text gibt oder keine KI.
 */
export async function autoBlurb(book: Book, job: BlurbJob | undefined): Promise<void> {
  if (book.id.startsWith('ai:')) return;
  const willWrite = Boolean(job) && useSettings.getState().autoBlurb && !autoBlurbPaused();
  if (willWrite) patch(book.id, { pending: true });
  try {
    if (await lookupBlurb(book.id)) return;
    if (!job || !willWrite || autoBlurbPaused() || useBlurbs.getState().items[book.id]?.error) return;
    await generateBlurb(book, job, { auto: true });
  } finally {
    if (willWrite) patch(book.id, { pending: false });
  }
}

/** Für die nächsten Karten im Stapel vorarbeiten – eine nach der anderen, damit es nicht ruckelt. */
let chain: Promise<void> = Promise.resolve();
export function prepareBlurb(run: () => Promise<void>) {
  chain = chain.then(run, run).catch(() => {});
}
