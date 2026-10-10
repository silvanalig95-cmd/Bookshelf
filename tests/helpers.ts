import type { Book, Edition, LibraryEntry } from '../src/lib/types';

export function book(partial: Partial<Book> & { id: string; title: string }): Book {
  return { authors: ['Jemand'], subjects: [], languages: [], source: 'openlibrary', ...partial };
}

export function edition(partial: Partial<Edition> & { key: string }): Edition {
  return { title: 'Titel', publishers: [], languages: [], formatKind: 'other', ...partial };
}

export function entry(partial: Partial<LibraryEntry> & { id: string; title: string }): LibraryEntry {
  return { authors: ['Jemand'], rating: 0, shelf: 'read', source: 'manual', matchState: 'matched', ...partial };
}
