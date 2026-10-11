/** Auf dem Gerät gemerkte KI-Kurzbeschreibungen („Kurz & spoilerfrei auf Deutsch“). */
export interface CachedBlurb {
  text: string;
  model: string;
}

const key = (bookId: string) => `lesekompass.blurb.v1.${bookId}`;

export function readBlurb(bookId: string): CachedBlurb | undefined {
  try {
    const raw = localStorage.getItem(key(bookId));
    const parsed = raw ? (JSON.parse(raw) as CachedBlurb) : undefined;
    return parsed?.text ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeBlurb(bookId: string, blurb: CachedBlurb) {
  try {
    localStorage.setItem(key(bookId), JSON.stringify(blurb));
  } catch {
    /* Speicher voll – dann eben nur für jetzt */
  }
}
