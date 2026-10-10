/** Ausgaben sortieren, filtern und die beste (deutsche) Ausgabe vorschlagen. */
import type { Edition, FormatKind, LanguagePreference } from './types';

export type EditionLangFilter = 'all' | 'ger' | 'eng' | 'other';
export type EditionFormatFilter = 'all' | FormatKind;

export const FORMAT_LABELS: Record<FormatKind, string> = {
  paperback: 'Taschenbuch',
  hardcover: 'Gebunden',
  ebook: 'E-Book',
  audio: 'Hörbuch',
  other: 'Sonstige',
};

export interface EditionSummary {
  total: number;
  byLang: Record<string, number>;
  byFormat: Record<FormatKind, number>;
  german: number;
  english: number;
}

export function summarizeEditions(editions: Edition[]): EditionSummary {
  const byLang: Record<string, number> = {};
  const byFormat: Record<FormatKind, number> = { paperback: 0, hardcover: 0, ebook: 0, audio: 0, other: 0 };
  for (const e of editions) {
    const langs = e.languages.length ? e.languages : ['und'];
    for (const l of langs) byLang[l] = (byLang[l] ?? 0) + 1;
    byFormat[e.formatKind]++;
  }
  return { total: editions.length, byLang, byFormat, german: byLang.ger ?? 0, english: byLang.eng ?? 0 };
}

/** Qualitätspunkte einer Ausgabe: ISBN, Cover, Seitenzahl, Aktualität. */
export function editionQuality(e: Edition): number {
  let q = 0;
  if (e.isbn13) q += 4;
  if (e.coverId || e.coverUrl) q += 3;
  if (e.pages) q += 1;
  if (e.publishers.length) q += 0.5;
  if (e.year) q += Math.max(0, Math.min(2.5, (e.year - 1980) / 16));
  if (e.formatKind === 'paperback') q += 0.6;
  if (e.formatKind === 'hardcover') q += 0.4;
  if (e.formatKind === 'audio') q -= 1.5;
  return q;
}

function langRank(e: Edition, pref: LanguagePreference): number {
  if (pref === 'any') return 0;
  if (e.languages.includes('ger')) return 0;
  if (e.languages.includes('eng')) return 1;
  return 2;
}

export function sortEditions(editions: Edition[], pref: LanguagePreference = 'de-first'): Edition[] {
  return [...editions].sort((a, b) => langRank(a, pref) - langRank(b, pref) || editionQuality(b) - editionQuality(a) || (b.year ?? 0) - (a.year ?? 0));
}

export function pickDefaultEdition(editions: Edition[], pref: LanguagePreference = 'de-first'): Edition | undefined {
  return sortEditions(editions, pref)[0];
}

export function filterEditions(editions: Edition[], lang: EditionLangFilter, format: EditionFormatFilter): Edition[] {
  return editions.filter((e) => {
    if (lang === 'ger' && !e.languages.includes('ger')) return false;
    if (lang === 'eng' && !e.languages.includes('eng')) return false;
    if (lang === 'other' && (e.languages.includes('ger') || e.languages.includes('eng'))) return false;
    if (format !== 'all' && e.formatKind !== format) return false;
    return true;
  });
}

export function editionLabel(e: Edition): string {
  const parts = [e.publishers[0], e.year ?? e.publishDate, formatLabel(e), e.pages ? `${e.pages} S.` : undefined];
  return parts.filter(Boolean).join(' · ');
}

/** Deutsches Format-Label (übersetzt bekannte Formate, sonst Originalangabe). */
export function formatLabel(e: Edition): string | undefined {
  if (e.formatKind !== 'other') return FORMAT_LABELS[e.formatKind];
  return e.format;
}
