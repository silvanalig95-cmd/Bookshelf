/**
 * Gemerkte KI-Kurzbeschreibungen („Kurz & spoilerfrei auf Deutsch“): auf dem Gerät und – falls ein
 * Lesekompass-Server mit Datenordner läuft – dort für alle Geräte. Jede Beschreibung wird so nur
 * einmal erzeugt, was das KI-Kontingent schont.
 */
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

/** Vom Server holen (und lokal merken), falls ein anderes Gerät sie schon erzeugt hat. */
export async function fetchSharedBlurb(bookId: string, signal?: AbortSignal): Promise<CachedBlurb | undefined> {
  try {
    const res = await fetch(`./api/blurbs?id=${encodeURIComponent(bookId)}`, { cache: 'no-store', signal });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return undefined;
    const b = (await res.json()) as Partial<CachedBlurb>;
    if (!b.text) return undefined;
    const blurb = { text: b.text, model: b.model ?? '' };
    writeBlurb(bookId, blurb);
    return blurb;
  } catch {
    return undefined;
  }
}

/** Für die anderen Geräte auf dem Server ablegen (ohne Server passiert einfach nichts). */
export function shareBlurb(bookId: string, blurb: CachedBlurb) {
  fetch('./api/blurbs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bookId, ...blurb }) }).catch(() => {});
}
