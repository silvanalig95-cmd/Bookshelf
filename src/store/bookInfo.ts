/**
 * Cover in hoher Auflösung und Verlagstexte aus Apple Books – über den eigenen Server, der jede
 * Abfrage gedrosselt stellt und dauerhaft merkt (server/bookInfo.ts). Ohne Server: nichts davon,
 * dann bleiben Nationalbibliothek und Open Library.
 */
import { create } from 'zustand';
import { localApiStatus } from '../lib/goodreads';
import { guessLanguage } from '../lib/wikipedia';

export const useBookInfoServer = create<{ available: boolean }>(() => ({ available: false }));

let checked = false;
export function startBookInfo() {
  if (checked) return;
  checked = true;
  void localApiStatus().then((s) => useBookInfoServer.setState({ available: Boolean(s.bookInfo) }));
}

/** Cover-Adresse über den Server (leitet auf Apple Books weiter oder antwortet 404). */
export function serverCoverUrl(title: string, author: string | undefined, width: number): string {
  return `./api/cover?${new URLSearchParams({ t: title, a: author ?? '', w: String(width) })}`;
}

const texts = new Map<string, Promise<string | undefined>>();

/** Deutscher Verlagstext aus Apple Books (oder nichts). */
export function publisherText(title: string, author: string | undefined): Promise<string | undefined> {
  if (!useBookInfoServer.getState().available) return Promise.resolve(undefined);
  const key = `${title}|${author ?? ''}`;
  let p = texts.get(key);
  if (!p) {
    p = fetch(`./api/buchinfo?${new URLSearchParams({ t: title, a: author ?? '' })}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ description?: string }>) : {}))
      .then((d: { description?: string }) => (d.description && guessLanguage(d.description) === 'ger' ? d.description : undefined))
      .catch(() => undefined);
    texts.set(key, p);
  }
  return p;
}
