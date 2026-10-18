import { create } from 'zustand';
import type { Book } from '../lib/types';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  text: string;
  action?: ToastAction;
}

interface UiState {
  toasts: Toast[];
  toast: (text: string, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  /** Buch, für das gerade der „Gelesen“-Dialog offen ist. */
  ratingFor?: Book;
  openRating: (book: Book) => void;
  closeRating: () => void;
}

let nextId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  toast: (text, action) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, text, action }].slice(-3) });
    // Mit „Rückgängig“ etwas länger stehen lassen
    setTimeout(() => get().dismissToast(id), action ? 5000 : 2600);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  openRating: (book) => set({ ratingFor: book }),
  closeRating: () => set({ ratingFor: undefined }),
}));

export const toast = (text: string, action?: ToastAction) => useUi.getState().toast(text, action);

/** Sitzungs-Zwischenspeicher für Bücher, damit die Detailseite sofort etwas zeigt. */
const bookCache = new Map<string, Book>();
export function rememberBook(book: Book) {
  const existing = bookCache.get(book.id);
  bookCache.set(book.id, existing ? { ...existing, ...book, description: book.description ?? existing.description } : book);
}
export function recallBook(id: string): Book | undefined {
  return bookCache.get(id);
}
