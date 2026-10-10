/** Statistiken für die „Lese-DNA“. */
import { authorSurname, normalize } from './text';
import { detectGenres, GENRES } from './taxonomy';
import type { LibraryEntry } from './types';

export interface ReadingStats {
  read: number;
  currentlyReading: number;
  toRead: number;
  pages: number;
  rated: number;
  avgRating?: number;
  perYear: Array<{ year: number; count: number; pages: number }>;
  ratings: Array<{ stars: number; count: number }>;
  genres: Array<{ id: string; label: string; emoji: string; count: number }>;
  authors: Array<{ name: string; count: number; avg?: number }>;
  decades: Array<{ decade: number; count: number }>;
  places: Array<{ name: string; count: number }>;
  longest?: LibraryEntry;
  oldest?: LibraryEntry;
  matched: number;
}

function yearOf(date?: string): number | undefined {
  if (!date) return undefined;
  const y = Number(date.slice(0, 4));
  return y > 1900 && y < 2200 ? y : undefined;
}

export function computeStats(entries: LibraryEntry[]): ReadingStats {
  const read = entries.filter((e) => e.shelf === 'read');
  const rated = read.filter((e) => e.rating > 0);

  const yearMap = new Map<number, { count: number; pages: number }>();
  for (const e of read) {
    const y = yearOf(e.dateRead);
    if (!y) continue;
    const v = yearMap.get(y) ?? { count: 0, pages: 0 };
    v.count++;
    v.pages += e.pages ?? 0;
    yearMap.set(y, v);
  }
  const years = Array.from(yearMap.keys()).sort((a, b) => a - b);
  const perYear: ReadingStats['perYear'] = [];
  if (years.length) {
    const from = Math.max(years[0], years[years.length - 1] - 11);
    for (let y = from; y <= years[years.length - 1]; y++) perYear.push({ year: y, ...(yearMap.get(y) ?? { count: 0, pages: 0 }) });
  }

  const ratings = [1, 2, 3, 4, 5].map((stars) => ({ stars, count: rated.filter((e) => e.rating === stars).length }));

  const genreCount = new Map<string, number>();
  for (const e of read) {
    const text = normalize([...(e.subjects ?? []), ...(e.tags ?? [])].join(' '));
    for (const g of detectGenres(text)) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }
  const genres = Array.from(genreCount.entries())
    .map(([id, count]) => {
      const g = GENRES.find((x) => x.id === id)!;
      return { id, label: g.label, emoji: g.emoji, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const authorMap = new Map<string, { name: string; count: number; sum: number; rated: number }>();
  for (const e of read) {
    const name = e.authors[0];
    if (!name) continue;
    const k = authorSurname(name) + normalize(name).slice(0, 2);
    const v = authorMap.get(k) ?? { name, count: 0, sum: 0, rated: 0 };
    v.count++;
    if (e.rating) {
      v.sum += e.rating;
      v.rated++;
    }
    authorMap.set(k, v);
  }
  const authors = Array.from(authorMap.values())
    .sort((a, b) => b.count - a.count || b.sum - a.sum)
    .slice(0, 10)
    .map((a) => ({ name: a.name, count: a.count, avg: a.rated ? a.sum / a.rated : undefined }));

  const decadeMap = new Map<number, number>();
  for (const e of read) if (e.year && e.year > 1500) decadeMap.set(Math.floor(e.year / 10) * 10, (decadeMap.get(Math.floor(e.year / 10) * 10) ?? 0) + 1);
  const decades = Array.from(decadeMap.entries())
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => a.decade - b.decade)
    .filter((d) => d.decade >= 1900 || d.count > 1);

  const placeMap = new Map<string, number>();
  for (const e of read) for (const p of new Set((e.places ?? []).slice(0, 6))) placeMap.set(p, (placeMap.get(p) ?? 0) + 1);
  const places = Array.from(placeMap.entries())
    .map(([name, count]) => ({ name, count }))
    .filter((p) => p.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const withPages = read.filter((e) => e.pages && e.pages > 30);
  return {
    read: read.length,
    currentlyReading: entries.filter((e) => e.shelf === 'currently-reading').length,
    toRead: entries.filter((e) => e.shelf === 'to-read').length,
    pages: withPages.reduce((a, e) => a + (e.pages ?? 0), 0),
    rated: rated.length,
    avgRating: rated.length ? rated.reduce((a, e) => a + e.rating, 0) / rated.length : undefined,
    perYear,
    ratings,
    genres,
    authors,
    decades,
    places,
    longest: withPages.sort((a, b) => (b.pages ?? 0) - (a.pages ?? 0))[0],
    oldest: read.filter((e) => e.year && e.year > 0).sort((a, b) => (a.year ?? 0) - (b.year ?? 0))[0],
    matched: entries.filter((e) => e.matchState === 'matched').length,
  };
}

/** Eine augenzwinkernde Lese-Persönlichkeit aus den Statistiken. */
export function readingPersona(s: ReadingStats): { title: string; text: string } {
  const top = s.genres[0]?.id;
  const avgPages = s.read ? s.pages / Math.max(1, s.read) : 0;
  // Bewusst Bilder statt Personenbezeichnungen – niemand wird hier ein Geschlecht zugeschrieben.
  const nouns: Record<string, string> = {
    krimi: 'Die Spürnase',
    thriller: 'Das Adrenalin-Herz',
    fantasy: 'Die Drachenseele',
    scifi: 'Der Sternenblick',
    historisch: 'Die Zeitkapsel',
    liebe: 'Das romantische Herz',
    literatur: 'Die feine Feder',
    klassiker: 'Die Bibliothek auf zwei Beinen',
    humor: 'Die Frohnatur',
    biografie: 'Die Lebensgeschichten-Sammlung',
    wissenschaft: 'Der Wissensdurst',
    philosophie: 'Der Denkerkopf',
    horror: 'Das furchtlose Herz',
    abenteuer: 'Der Kompass',
  };
  const title = (top && nouns[top]) || 'Der Bücherwurm';
  const bits: string[] = [];
  if (s.genres.length >= 6 && s.genres[0].count < s.read * 0.35) bits.push('Du liest quer durch die Genres – Neugier ist dein Kompass.');
  else if (s.genres[0]) bits.push(`${s.genres[0].emoji} ${s.genres[0].label} ist dein Heimathafen.`);
  if (avgPages > 450) bits.push('Dicke Wälzer schrecken dich nicht ab.');
  else if (avgPages && avgPages < 280) bits.push('Du magst es knackig und auf den Punkt.');
  if (s.avgRating && s.avgRating >= 4.2) bits.push('Du vergibst gern viele Sterne – Begeisterung ist ansteckend.');
  else if (s.avgRating && s.avgRating < 3.4) bits.push('Bei Sternen bist du streng – ein Buch muss sich deine Gunst verdienen.');
  if (s.oldest?.year && s.oldest.year < 1900) bits.push(`Dein ältestes Buch stammt von ${s.oldest.year}.`);
  return { title, text: bits.join(' ') };
}
