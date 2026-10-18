/**
 * Doppelte Ausgaben in der Bibliothek zusammenführen: Zwei Einträge gelten als dasselbe Buch, wenn
 * sie zum selben Open-Library-Werk gehören (z. B. Taschenbuch und Hardcover, deutsche und englische
 * Ausgabe) oder Titel und Autor:in übereinstimmen. Übrig bleibt ein Eintrag mit dem Besten aus allen:
 * gelesen schlägt „will ich lesen“, die Bewertung der zuletzt gelesenen Ausgabe, das jüngste
 * Lesedatum, alle Regale und Themen. Die IDs der übrigen Einträge werden als `aliases` gemerkt, damit
 * ein erneuter Goodreads-Import sie nicht wieder anlegt.
 */
import { authorSurname, normalize } from './text';
import type { LibraryEntry, Shelf } from './types';

const SHELF_RANK: Record<Shelf, number> = { read: 3, 'currently-reading': 2, 'to-read': 1 };

function better(a: LibraryEntry, b: LibraryEntry): number {
  return (
    SHELF_RANK[b.shelf] - SHELF_RANK[a.shelf] ||
    Number(Boolean(b.rating)) - Number(Boolean(a.rating)) ||
    (b.dateRead ?? '').localeCompare(a.dateRead ?? '') ||
    Number(b.matchState === 'matched') - Number(a.matchState === 'matched') ||
    a.id.localeCompare(b.id)
  );
}

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

/** Sieht ein Titel deutsch aus? (Artikel, Umlaute – Titel sind für eine echte Spracherkennung zu kurz) */
function germanTitle(title: string): boolean {
  return /\b(der|die|das|des|dem|den|ein|eine|einer|und|im|vom|zum|zur|über|für)\b|[äöüß]/i.test(title) && !/\b(the|of|and|a)\b/i.test(title);
}

export function mergeGroup(group: LibraryEntry[]): LibraryEntry {
  const sorted = [...group].sort(better);
  const primary = sorted[0];
  const read = sorted.filter((e) => e.dateRead).sort((a, b) => (b.dateRead ?? '').localeCompare(a.dateRead ?? ''));
  // Bewertung: die der zuletzt gelesenen bewerteten Ausgabe, sonst irgendeine
  const rated = [...read.filter((e) => e.rating), ...sorted.filter((e) => e.rating)][0];
  const added = sorted.map((e) => e.dateAdded).filter((d): d is string => Boolean(d)).sort()[0];
  const longest = <K extends 'subjects' | 'places' | 'times'>(k: K) => sorted.map((e) => e[k] ?? []).sort((a, b) => b.length - a.length)[0];
  const tags = uniq(sorted.flatMap((e) => e.tags ?? []));
  const aliases = uniq(sorted.flatMap((e) => [e.id, ...(e.aliases ?? [])]).filter((id) => id !== primary.id));
  // Den deutschen Titel behalten, wenn eine der Ausgaben deutsch ist
  const german = germanTitle(primary.title) ? undefined : sorted.find((x) => germanTitle(x.title));
  return {
    ...primary,
    ...(german ? { title: german.title } : {}),
    rating: rated?.rating ?? 0,
    dateRead: read[0]?.dateRead ?? primary.dateRead,
    dateAdded: added ?? primary.dateAdded,
    workKey: primary.workKey ?? sorted.find((e) => e.workKey)?.workKey,
    matchState: sorted.some((e) => e.matchState === 'matched') ? 'matched' : primary.matchState,
    subjects: longest('subjects'),
    places: longest('places'),
    times: longest('times'),
    tags: tags.length ? tags : undefined,
    coverId: primary.coverId ?? sorted.find((e) => e.coverId)?.coverId,
    coverUrl: primary.coverUrl ?? sorted.find((e) => e.coverUrl)?.coverUrl,
    description: primary.description ?? sorted.find((e) => e.description)?.description,
    aliases: aliases.length ? aliases : undefined,
  };
}

/** Ganzer Titel ohne Klammerzusätze + Nachname – strenger als bookFingerprint (der Untertitel abschneidet). */
function strictPrint(e: LibraryEntry): string {
  return `${normalize(e.title.replace(/\(.*?\)|\[.*?\]/g, ' ')).trim()}|${authorSurname(e.authors[0] ?? '')}`;
}

/**
 * Findet Gruppen gleicher Bücher: gleiches Open-Library-Werk, oder – wenn einem Eintrag das Werk
 * fehlt – gleicher ganzer Titel und Nachname. Verschiedene Werke werden nie zusammengelegt.
 */
export function duplicateGroups(entries: Record<string, LibraryEntry>): LibraryEntry[][] {
  const groups = new Map<string, LibraryEntry[]>();
  const printToGroup = new Map<string, string | null>(); // null = mehrdeutig (gleicher Titel, verschiedene Werke)
  const add = (key: string, e: LibraryEntry) => groups.set(key, [...(groups.get(key) ?? []), e]);
  const list = Object.values(entries);
  for (const e of list.filter((x) => x.workKey)) {
    const key = `w:${e.workKey}`;
    add(key, e);
    const print = strictPrint(e);
    const known = printToGroup.get(print);
    printToGroup.set(print, known === undefined || known === key ? key : null);
  }
  for (const e of list.filter((x) => !x.workKey)) {
    const print = strictPrint(e);
    if (print.startsWith('|')) continue;
    const known = printToGroup.get(print);
    if (known === null) continue;
    const key = known ?? `p:${print}`;
    add(key, e);
    if (known === undefined) printToGroup.set(print, key);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

/** Führt alle Doppelten zusammen; `removed` sind die IDs, die dabei verschwinden. */
export function mergeDuplicates(entries: Record<string, LibraryEntry>): { entries: Record<string, LibraryEntry>; removed: string[] } {
  const groups = duplicateGroups(entries);
  if (!groups.length) return { entries, removed: [] };
  const next = { ...entries };
  const removed: string[] = [];
  for (const group of groups) {
    const merged = mergeGroup(group);
    for (const e of group) {
      if (e.id === merged.id) continue;
      delete next[e.id];
      removed.push(e.id);
    }
    next[merged.id] = merged;
  }
  return { entries: next, removed };
}
