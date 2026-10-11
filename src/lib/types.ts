/** Gemeinsame Datentypen von Lesekompass. */

/** ISO-639-2/B-Sprachcode wie ihn Open Library nutzt, z. B. "ger", "eng". */
export type LangCode = string;

export type BookSource = 'openlibrary' | 'google' | 'goodreads' | 'ai' | 'manual';

export interface Book {
  /** Routen-ID: "OL123W" für Open-Library-Werke, "gb:xyz" für Google-Books-Bände. */
  id: string;
  /** Open-Library-Werkschlüssel, z. B. "/works/OL123W". */
  workKey?: string;
  /** Anzeigetitel – wenn möglich der Titel der deutschen Ausgabe. */
  title: string;
  /** Originaltitel des Werks, falls er vom Anzeigetitel abweicht. */
  originalTitle?: string;
  subtitle?: string;
  authors: string[];
  authorKeys?: string[];
  /** Jahr der Erstveröffentlichung. */
  year?: number;
  coverId?: number;
  coverUrl?: string;
  subjects: string[];
  places?: string[];
  times?: string[];
  people?: string[];
  /** Sprachen, in denen Ausgaben existieren. */
  languages: LangCode[];
  pages?: number;
  rating?: number;
  ratingsCount?: number;
  /** Wie oft das Werk in Leselisten steht (Beliebtheit). */
  popularity?: number;
  editionCount?: number;
  firstSentence?: string;
  description?: string;
  /** ISBNs der bevorzugten Ausgabe. */
  isbns?: string[];
  preferredEditionKey?: string;
  preferredEditionLang?: LangCode;
  googleId?: string;
  source: BookSource;
}

export type FormatKind = 'paperback' | 'hardcover' | 'ebook' | 'audio' | 'other';

export interface Edition {
  /** "/books/OL..M" oder "gb:<id>" */
  key: string;
  title: string;
  subtitle?: string;
  publishers: string[];
  publishDate?: string;
  year?: number;
  languages: LangCode[];
  isbn13?: string;
  isbn10?: string;
  pages?: number;
  format?: string;
  formatKind: FormatKind;
  coverId?: number;
  coverUrl?: string;
  editionName?: string;
  translationOf?: string;
}

export type Shelf = 'read' | 'to-read' | 'currently-reading';

export interface LibraryEntry {
  /** "gr:<goodreadsId>" oder "ol:<OLID>" oder "m:<zufall>" */
  id: string;
  goodreadsId?: string;
  title: string;
  authors: string[];
  isbn?: string;
  isbn13?: string;
  /** 0 = nicht bewertet, sonst 1–5 */
  rating: number;
  shelf: Shelf;
  /** Eigene Regale / Tags aus Goodreads. */
  tags?: string[];
  dateRead?: string;
  dateAdded?: string;
  pages?: number;
  year?: number;
  avgRating?: number;
  coverUrl?: string;
  coverId?: number;
  description?: string;
  /** Zugeordnetes Open-Library-Werk. */
  workKey?: string;
  subjects?: string[];
  places?: string[];
  times?: string[];
  languages?: LangCode[];
  matchState?: 'pending' | 'matched' | 'unmatched';
  source: 'goodreads-csv' | 'goodreads-rss' | 'manual' | 'swipe';
}

export interface WishlistItem {
  book: Book;
  addedAt: string;
  note?: string;
  /** Woher die Idee stammt (z. B. "Swipe", "Glücksrad"). */
  origin?: string;
}

export type SignalVerdict = 'like' | 'dislike' | 'save' | 'read';

export interface TasteSignal {
  bookId: string;
  title: string;
  authors: string[];
  subjects: string[];
  verdict: SignalVerdict;
  at: string;
  /** Erscheinungsjahr – damit das Swipe-Modell lernt, ob du eher Neues oder Älteres magst. */
  year?: number;
}

export type Region = 'DE' | 'CH' | 'AT';
export type LanguagePreference = 'de-first' | 'de-only' | 'any';

export interface Reason {
  kind:
    | 'genre'
    | 'mood'
    | 'place'
    | 'era'
    | 'taste'
    | 'similar'
    | 'german'
    | 'rating'
    | 'fame'
    | 'length'
    | 'keyword'
    | 'author'
    | 'character'
    | 'ai';
  label: string;
}

export interface ScoredBook {
  book: Book;
  score: number;
  /** 0–100 */
  match: number;
  reasons: Reason[];
  alreadyRead?: boolean;
  /** Erfüllt keine der konkreten Angaben (Stichwort, Autor:in, Vergleichsbuch). */
  weak?: boolean;
}
