/**
 * Bücher in deinem Besitz – als gedrucktes Buch, als E-Book oder beides. Unabhängig davon, ob du
 * sie schon gelesen hast; wird zwischen deinen Geräten abgeglichen.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book } from '../lib/types';

export type OwnedFormat = 'print' | 'ebook';

export interface OwnedItem {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  coverId?: number;
  coverUrl?: string;
  subjects: string[];
  formats: OwnedFormat[];
  at: string;
}

export const FORMAT_LABEL: Record<OwnedFormat, string> = { print: 'Buch', ebook: 'E-Book' };

interface OwnedState {
  items: Record<string, OwnedItem>;
  /** Format an- oder abwählen; ohne Format ist das Buch nicht mehr im Besitz. */
  toggle: (book: Book, format: OwnedFormat) => OwnedFormat[];
}

export const useOwned = create<OwnedState>()(
  persist(
    (set, get) => ({
      items: {},
      toggle: (book, format) => {
        const items = { ...get().items };
        const prev = items[book.id]?.formats ?? [];
        const formats = prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format].sort();
        if (formats.length) {
          items[book.id] = {
            id: book.id,
            title: book.title,
            authors: book.authors.slice(0, 3),
            year: book.year,
            coverId: book.coverId,
            coverUrl: book.coverUrl,
            subjects: book.subjects.slice(0, 20),
            formats,
            at: items[book.id]?.at ?? new Date().toISOString(),
          };
        } else {
          delete items[book.id];
        }
        set({ items });
        return formats;
      },
    }),
    { name: 'lesekompass.owned', version: 1 },
  ),
);

export function ownedLabel(formats: OwnedFormat[] | undefined): string | undefined {
  if (!formats?.length) return undefined;
  return formats.length === 2 ? 'Buch & E-Book' : FORMAT_LABEL[formats[0]];
}

/** Als Buch-Objekte (z. B. für Buchkarten und Empfehlungen). */
export function ownedBooks(items: Record<string, OwnedItem>): Book[] {
  return Object.values(items)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((o) => ({ id: o.id, workKey: /^OL\d+W$/.test(o.id) ? `/works/${o.id}` : undefined, title: o.title, authors: o.authors, year: o.year, coverId: o.coverId, coverUrl: o.coverUrl, subjects: o.subjects, languages: [], source: 'openlibrary' as const }));
}

export function useOwnedBooks(): Book[] {
  const items = useOwned((s) => s.items);
  return useMemo(() => ownedBooks(items), [items]);
}
