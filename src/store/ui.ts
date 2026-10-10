import { create } from 'zustand';
import type { Book } from '../lib/types';

interface Toast {
  id: number;
  text: string;
}

interface UiState {
  toasts: Toast[];
  toast: (text: string) => void;
  /** Buch, für das gerade der „Gelesen“-Dialog offen ist. */
  ratingFor?: Book;
  openRating: (book: Book) => void;
  closeRating: () => void;
}

let nextId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  toast: (text) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, text }].slice(-3) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 2600);
  },
  openRating: (book) => set({ ratingFor: book }),
  closeRating: () => set({ ratingFor: undefined }),
}));

export const toast = (text: string) => useUi.getState().toast(text);

/** Sitzungs-Zwischenspeicher für Bücher, damit die Detailseite sofort etwas zeigt. */
const bookCache = new Map<string, Book>();
export function rememberBook(book: Book) {
  const existing = bookCache.get(book.id);
  bookCache.set(book.id, existing ? { ...existing, ...book, description: book.description ?? existing.description } : book);
}
export function recallBook(id: string): Book | undefined {
  return bookCache.get(id);
}
