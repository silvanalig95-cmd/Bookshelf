/**
 * Geschmacksprofil: verdichtet gelesene & bewertete Bücher (plus Swipe-Signale)
 * zu gewichteten „Konzepten“ (Themen), Lieblingsautor:innen und Genre-Vorlieben.
 *
 * Verfahren: inhaltsbasiertes Profil mit TF-IDF-Gewichtung.
 *  - Jede Bewertung wird zu einem Gewicht (5★ stark positiv, 1–2★ negativ).
 *  - Jüngere Lektüre zählt mehr als lange zurückliegende.
 *  - Themen, die in fast allen deinen Büchern vorkommen, verlieren an Gewicht,
 *    damit das Profil deine *besonderen* Vorlieben abbildet.
 */
import { authorSurname, normalize } from './text';
import { detectGenres, GENRES, isNoiseSubject, subjectConcepts, subjectLabel } from './taxonomy';
import type { Book, LibraryEntry, TasteSignal } from './types';

export interface WeightedConcept {
  concept: string;
  label: string;
  weight: number;
  support: number;
}

export interface FavoriteAuthor {
  name: string;
  avg: number;
  count: number;
  weight: number;
}

export interface TasteProfile {
  /** L2-normalisierte Konzeptgewichte. */
  concepts: Map<string, number>;
  authors: Map<string, number>;
  genres: Map<string, number>;
  topConcepts: WeightedConcept[];
  dislikedConcepts: WeightedConcept[];
  favoriteAuthors: FavoriteAuthor[];
  /** Originale Schlagwörter mit höchstem Gewicht – gut für Suchanfragen. */
  querySubjects: string[];
  itemCount: number;
  ratedCount: number;
  signalCount: number;
  avgPages?: number;
  germanShare: number;
}

interface ProfileItem {
  weight: number;
  subjects: string[];
  authors: string[];
  pages?: number;
  languages?: string[];
}

const DNF = /dnf|did-not-finish|abgebrochen|nicht-beendet|not-finished|abandoned/i;

export function entryWeight(e: LibraryEntry, now = Date.now()): number {
  if (e.shelf === 'to-read') return 0.35;
  if (e.tags?.some((t) => DNF.test(t))) return -1.2;
  let w: number;
  switch (e.rating) {
    case 5:
      w = 2.5;
      break;
    case 4:
      w = 1.5;
      break;
    case 3:
      w = 0.4;
      break;
    case 2:
      w = -0.8;
      break;
    case 1:
      w = -1.6;
      break;
    default:
      w = e.shelf === 'currently-reading' ? 0.8 : 0.6;
  }
  const date = e.dateRead ?? e.dateAdded;
  const t = date ? Date.parse(date.replace(/\//g, '-')) : NaN;
  if (Number.isFinite(t)) {
    const years = Math.max(0, (now - t) / (365.25 * 24 * 3600 * 1000));
    w *= Math.max(0.45, Math.pow(0.5, years / 6));
  } else {
    w *= 0.75;
  }
  return w;
}

export function signalWeight(s: TasteSignal): number {
  switch (s.verdict) {
    case 'like':
      return 1.2;
    // Merken = „will ich lesen“ – stärker als nur „klingt spannend“
    case 'save':
      return 1.5;
    case 'read':
      return 0.8;
    case 'dislike':
      return -0.9;
  }
}

// Schlagwörter wiederholen sich ständig – ihre Konzepte nur einmal berechnen
const conceptCache = new Map<string, string[]>();

export function conceptsOf(subjects: string[]): string[] {
  const out = new Set<string>();
  for (const s of subjects.slice(0, 40)) {
    let cs = conceptCache.get(s);
    if (!cs) {
      if (conceptCache.size > 50_000) conceptCache.clear();
      cs = subjectConcepts(s);
      conceptCache.set(s, cs);
    }
    for (const c of cs) out.add(c);
  }
  return Array.from(out);
}

/**
 * Swipes sind schnelle Bauchentscheidungen: Mit wachsender Zahl wächst ihr Gewicht im
 * Gesamtprofil nur noch mit der Wurzel, damit tausende Swipes die Lesegeschichte nicht übertönen.
 */
export function signalScale(count: number): number {
  return count > 250 ? Math.sqrt(250 / count) : 1;
}

export function buildProfile(entries: LibraryEntry[], signals: TasteSignal[] = []): TasteProfile {
  const items: ProfileItem[] = [];
  for (const e of entries) {
    items.push({ weight: entryWeight(e), subjects: [...(e.subjects ?? []), ...(e.tags ?? []).map((t) => t.replace(/-/g, ' '))], authors: e.authors, pages: e.pages, languages: e.languages });
  }
  const scale = signalScale(signals.length);
  for (const s of signals) items.push({ weight: signalWeight(s) * scale, subjects: s.subjects, authors: s.authors });

  const itemConcepts = items.map((i) => conceptsOf(i.subjects));
  const df = new Map<string, number>();
  for (const cs of itemConcepts) for (const c of cs) df.set(c, (df.get(c) ?? 0) + 1);
  const n = Math.max(1, itemConcepts.filter((c) => c.length > 0).length);

  const raw = new Map<string, number>();
  const conceptSubject = new Map<string, Map<string, number>>();
  items.forEach((item, idx) => {
    const cs = itemConcepts[idx];
    if (!cs.length) return;
    const norm = 1 / Math.sqrt(cs.length);
    for (const c of cs) raw.set(c, (raw.get(c) ?? 0) + item.weight * norm);
    // Merken, welches Originalschlagwort ein Konzept am besten repräsentiert
    for (const s of item.subjects.slice(0, 40)) {
      if (isNoiseSubject(s) || s.length > 40) continue;
      for (const c of subjectConcepts(s)) {
        const m = conceptSubject.get(c) ?? new Map<string, number>();
        m.set(s, (m.get(s) ?? 0) + 1);
        conceptSubject.set(c, m);
      }
    }
  });

  const weighted = new Map<string, number>();
  for (const [c, v] of raw) {
    const d = df.get(c) ?? 1;
    const idf = Math.log(1 + n / d);
    const support = d / (d + 1.5);
    weighted.set(c, v * idf * support);
  }
  const norm = Math.sqrt(Array.from(weighted.values()).reduce((a, b) => a + b * b, 0)) || 1;
  const concepts = new Map<string, number>();
  for (const [c, v] of weighted) concepts.set(c, v / norm);

  const sorted = Array.from(concepts.entries()).sort((a, b) => b[1] - a[1]);
  const toWeighted = ([c, w]: [string, number]): WeightedConcept => {
    const fromConcept = subjectLabel(c);
    const label = fromConcept.toLowerCase() !== c ? fromConcept : subjectLabel(bestSubject(conceptSubject.get(c)) ?? c);
    return { concept: c, label, weight: w, support: df.get(c) ?? 0 };
  };
  const byLabel = (list: WeightedConcept[]) => {
    const seen = new Set<string>();
    return list.filter((x) => {
      const k = normalize(x.label);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const topConcepts = byLabel(sorted.filter(([c, w]) => w > 0 && (df.get(c) ?? 0) >= Math.min(2, n)).slice(0, 40).map(toWeighted)).slice(0, 30);
  const dislikedConcepts = byLabel(sorted.filter(([, w]) => w < 0).reverse().slice(0, 16).map(toWeighted)).slice(0, 12);

  // Autor:innen
  const authorStats = new Map<string, { name: string; sum: number; rated: number; count: number; weight: number }>();
  for (const e of entries) {
    if (e.shelf !== 'read') continue;
    for (const a of e.authors.slice(0, 2)) {
      const k = authorSurname(a) + '|' + normalize(a).slice(0, 1);
      const st = authorStats.get(k) ?? { name: a, sum: 0, rated: 0, count: 0, weight: 0 };
      st.count++;
      if (e.rating > 0) {
        st.sum += e.rating;
        st.rated++;
      }
      st.weight += entryWeight(e);
      authorStats.set(k, st);
    }
  }
  const authors = new Map<string, number>();
  for (const st of authorStats.values()) authors.set(normalize(st.name), st.weight);
  const favoriteAuthors = Array.from(authorStats.values())
    .filter((s) => s.weight > 1.2 && (s.rated === 0 || s.sum / s.rated >= 3.8))
    .map((s) => ({ name: s.name, avg: s.rated ? s.sum / s.rated : 0, count: s.count, weight: s.weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  // Genres
  const genres = new Map<string, number>();
  items.forEach((item) => {
    const text = normalize(item.subjects.join(' '));
    for (const g of detectGenres(text)) genres.set(g, (genres.get(g) ?? 0) + item.weight);
  });

  const querySubjects: string[] = [];
  for (const wc of topConcepts) {
    const s = bestSubject(conceptSubject.get(wc.concept));
    if (s && !querySubjects.includes(s)) querySubjects.push(s);
    if (querySubjects.length >= 12) break;
  }

  const pages = entries.filter((e) => e.shelf === 'read' && e.pages && e.pages > 30).map((e) => e.pages as number);
  const withLang = entries.filter((e) => e.languages?.length);
  const german = withLang.filter((e) => e.languages?.includes('ger')).length;

  return {
    concepts,
    authors,
    genres,
    topConcepts,
    dislikedConcepts,
    favoriteAuthors,
    querySubjects,
    itemCount: entries.length,
    ratedCount: entries.filter((e) => e.rating > 0).length,
    signalCount: signals.length,
    avgPages: pages.length ? Math.round(pages.reduce((a, b) => a + b, 0) / pages.length) : undefined,
    germanShare: withLang.length ? german / withLang.length : 0,
  };
}

function bestSubject(m: Map<string, number> | undefined): string | undefined {
  if (!m) return undefined;
  let best: string | undefined;
  let bestCount = -1;
  for (const [s, c] of m) {
    // kürzere, „sauberere“ Schlagwörter bevorzugen
    const score = c - s.length / 100;
    if (score > bestCount) {
      bestCount = score;
      best = s;
    }
  }
  return best;
}

export interface TasteMatch {
  /** Kosinus-Ähnlichkeit (−1 … 1). */
  similarity: number;
  /** Gemeinsame positive Konzepte (deutsche Labels). */
  shared: string[];
  authorBonus: number;
}

export function tasteMatch(profile: TasteProfile, book: Pick<Book, 'subjects' | 'authors'>): TasteMatch {
  const cs = conceptsOf(book.subjects);
  let dot = 0;
  const contributions: Array<[string, number]> = [];
  for (const c of cs) {
    const w = profile.concepts.get(c);
    if (w) {
      dot += w;
      contributions.push([c, w]);
    }
  }
  const similarity = cs.length ? dot / Math.sqrt(cs.length) : 0;
  const labelOf = new Map(profile.topConcepts.map((t) => [t.concept, t.label]));
  const shared = contributions
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => labelOf.get(c) ?? subjectLabel(c));
  let authorBonus = 0;
  for (const a of book.authors) {
    const w = profile.authors.get(normalize(a));
    if (w) authorBonus = Math.max(authorBonus, w);
  }
  return { similarity, shared, authorBonus };
}

export function topGenres(profile: TasteProfile, max = 6): Array<{ id: string; label: string; emoji: string; weight: number }> {
  return Array.from(profile.genres.entries())
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id, weight]) => {
      const g = GENRES.find((x) => x.id === id)!;
      return { id, label: g.label, emoji: g.emoji, weight };
    });
}

export function isProfileUsable(profile: TasteProfile | undefined): profile is TasteProfile {
  return Boolean(profile && profile.topConcepts.length >= 3);
}
