import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from './idbStorage';
import { mergeDuplicates } from '../lib/libraryMerge';
import { bookFingerprint } from '../lib/text';
import type { Book, LibraryEntry, Shelf } from '../lib/types';
import { announceBulkChange } from './syncIntent';

interface ImportInfo {
  source: LibraryEntry['source'];
  at: string;
  count: number;
}

interface LibraryState {
  entries: Record<string, LibraryEntry>;
  lastImport?: ImportInfo;
  /** Fügt Einträge hinzu bzw. aktualisiert bestehende (gleiche ID oder gleiches Buch). */
  upsertMany: (entries: LibraryEntry[], source?: LibraryEntry['source']) => { added: number; updated: number; merged: number };
  /** Führt doppelte Ausgaben desselben Buchs zusammen; gibt zurück, wie viele Einträge dabei aufgehen. */
  dedupe: () => number;
  update: (id: string, patch: Partial<LibraryEntry>) => void;
  updateMany: (patches: Array<{ id: string; patch: Partial<LibraryEntry> }>) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Markiert ein Buch aus der Suche als gelesen / gewünscht. */
  addBook: (book: Book, shelf: Shelf, rating?: number) => void;
}

function mergeEntry(old: LibraryEntry, incoming: LibraryEntry): LibraryEntry {
  return {
    ...old,
    ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))),
    // Bereits ermittelte Zuordnung nicht verlieren
    workKey: old.workKey ?? incoming.workKey,
    subjects: old.subjects?.length ? old.subjects : incoming.subjects,
    languages: old.languages?.length ? old.languages : incoming.languages,
    matchState: old.matchState === 'matched' ? 'matched' : incoming.matchState ?? old.matchState,
    id: old.id,
  } as LibraryEntry;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      entries: {},
      upsertMany: (incoming, source) => {
        const entries = { ...get().entries };
        const byPrint = new Map<string, string>();
        const byAlias = new Map<string, string>();
        for (const e of Object.values(entries)) {
          byPrint.set(bookFingerprint(e.title, e.authors), e.id);
          for (const a of e.aliases ?? []) byAlias.set(a, e.id);
        }
        let added = 0;
        let updated = 0;
        for (const entry of incoming) {
          // Schon zusammengeführte Ausgaben (z. B. beim erneuten Goodreads-Import) nicht wieder anlegen
          const existingId = entries[entry.id] ? entry.id : (byAlias.get(entry.id) ?? byPrint.get(bookFingerprint(entry.title, entry.authors)));
          if (existingId && entries[existingId]) {
            entries[existingId] = mergeEntry(entries[existingId], entry);
            updated++;
          } else {
            entries[entry.id] = entry;
            byPrint.set(bookFingerprint(entry.title, entry.authors), entry.id);
            added++;
          }
        }
        const merged = mergeDuplicates(entries);
        set({
          entries: merged.entries,
          lastImport: source ? { source, at: new Date().toISOString(), count: incoming.length } : get().lastImport,
        });
        return { added, updated, merged: merged.removed.length };
      },
      dedupe: () => {
        const merged = mergeDuplicates(get().entries);
        if (merged.removed.length) set({ entries: merged.entries });
        return merged.removed.length;
      },
      update: (id, patch) => {
        const e = get().entries[id];
        if (!e) return;
        set({ entries: { ...get().entries, [id]: { ...e, ...patch } } });
      },
      updateMany: (patches) => {
        const entries = { ...get().entries };
        for (const { id, patch } of patches) if (entries[id]) entries[id] = { ...entries[id], ...patch };
        // Erst mit dem zugeordneten Werk zeigt sich, dass zwei Ausgaben dasselbe Buch sind
        set({ entries: mergeDuplicates(entries).entries });
      },
      remove: (id) => {
        const entries = { ...get().entries };
        delete entries[id];
        set({ entries });
      },
      clear: () => {
        announceBulkChange();
        set({ entries: {}, lastImport: undefined });
      },
      addBook: (book, shelf, rating = 0) => {
        const id = book.workKey ? `ol:${book.id}` : `m:${book.id}`;
        const entry: LibraryEntry = {
          id,
          title: book.title,
          authors: book.authors,
          isbn13: book.isbns?.[0],
          rating,
          shelf,
          dateAdded: new Date().toISOString().slice(0, 10),
          dateRead: shelf === 'read' ? new Date().toISOString().slice(0, 10) : undefined,
          pages: book.pages,
          year: book.year,
          coverId: book.coverId,
          coverUrl: book.coverUrl,
          workKey: book.workKey,
          subjects: book.subjects.slice(0, 30),
          languages: book.languages,
          matchState: book.workKey ? 'matched' : 'unmatched',
          source: 'manual',
        };
        get().upsertMany([entry]);
      },
    }),
    { name: 'lesekompass.library', version: 1, storage: createJSONStorage(() => idbStorage) },
  ),
);

/** Index zum schnellen Prüfen „schon gelesen?“ – nach Werk und nach Titel/Autor. */
export interface ReadIndex {
  workKeys: Set<string>;
  prints: Set<string>;
  has: (book: Pick<Book, 'workKey' | 'title' | 'authors'>) => boolean;
  entryFor: (book: Pick<Book, 'workKey' | 'title' | 'authors'>) => LibraryEntry | undefined;
}

export function buildReadIndex(entries: Record<string, LibraryEntry>, shelves: Shelf[] = ['read', 'currently-reading']): ReadIndex {
  const workKeys = new Set<string>();
  const prints = new Set<string>();
  const byWork = new Map<string, LibraryEntry>();
  const byPrint = new Map<string, LibraryEntry>();
  for (const e of Object.values(entries)) {
    if (!shelves.includes(e.shelf)) continue;
    const p = bookFingerprint(e.title, e.authors);
    prints.add(p);
    byPrint.set(p, e);
    if (e.workKey) {
      workKeys.add(e.workKey);
      byWork.set(e.workKey, e);
    }
  }
  const entryFor = (book: Pick<Book, 'workKey' | 'title' | 'authors'>) =>
    (book.workKey && byWork.get(book.workKey)) || byPrint.get(bookFingerprint(book.title, book.authors));
  return {
    workKeys,
    prints,
    entryFor,
    has: (book) => Boolean(entryFor(book)),
  };
}
