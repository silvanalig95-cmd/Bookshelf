import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, WishlistItem } from '../lib/types';
import { announceBulkChange } from './syncIntent';

interface WishlistState {
  items: Record<string, WishlistItem>;
  toggle: (book: Book, origin?: string) => boolean;
  add: (book: Book, origin?: string) => void;
  remove: (id: string) => void;
  setNote: (id: string, note: string) => void;
  clear: () => void;
}

/** Schlanke Kopie eines Buchs für die Merkliste (ohne lange Texte). */
export function slimBook(book: Book): Book {
  return {
    ...book,
    description: book.description?.slice(0, 400),
    subjects: book.subjects.slice(0, 20),
    places: book.places?.slice(0, 6),
    times: book.times?.slice(0, 6),
    people: book.people?.slice(0, 6),
    isbns: book.isbns?.slice(0, 4),
  };
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: {},
      toggle: (book, origin) => {
        if (get().items[book.id]) {
          get().remove(book.id);
          return false;
        }
        get().add(book, origin);
        return true;
      },
      add: (book, origin) =>
        set({ items: { ...get().items, [book.id]: { book: slimBook(book), addedAt: new Date().toISOString(), origin } } }),
      remove: (id) => {
        const items = { ...get().items };
        delete items[id];
        set({ items });
      },
      setNote: (id, note) => {
        const item = get().items[id];
        if (item) set({ items: { ...get().items, [id]: { ...item, note } } });
      },
      clear: () => {
        announceBulkChange();
        set({ items: {} });
      },
    }),
    { name: 'lesekompass.wishlist', version: 1 },
  ),
);
