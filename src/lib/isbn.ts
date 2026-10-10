/** ISBN-Hilfen: Bereinigen, Prüfen, Umrechnen. */

export function cleanIsbn(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.replace(/^="?|"$/g, '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbn10to13(isbn10: string): string | undefined {
  if (!isValidIsbn10(isbn10)) return undefined;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + String((10 - (sum % 10)) % 10);
}

export function isbn13to10(isbn13: string): string | undefined {
  if (!isValidIsbn13(isbn13) || !isbn13.startsWith('978')) return undefined;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

/** Liefert eine gültige ISBN-13 (wandelt ISBN-10 um), sonst undefined. */
export function toIsbn13(raw: string | undefined | null): string | undefined {
  const isbn = cleanIsbn(raw);
  if (isValidIsbn13(isbn)) return isbn;
  if (isValidIsbn10(isbn)) return isbn10to13(isbn);
  return undefined;
}

/** Gruppen-Präfix → wahrscheinlicher Sprachraum (978-3 = deutschsprachig). */
export function isbnLanguageHint(isbn13: string | undefined): 'de' | 'en' | undefined {
  if (!isbn13) return undefined;
  if (/^9783/.test(isbn13)) return 'de';
  if (/^978[01]/.test(isbn13) || /^979[8]/.test(isbn13)) return 'en';
  return undefined;
}
