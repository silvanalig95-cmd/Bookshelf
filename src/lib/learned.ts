/**
 * Was der Wissensspeicher des Servers gelernt hat (siehe server/knowledge.ts) – hier als einfache
 * Ablage, damit Open-Library-Treffer und Bewertungen es nutzen können, ohne einen Store zu kennen:
 *  - von der KI gelernte Schlagwörter für Bücher, die Open Library kaum verschlagwortet
 *  - die Feinabstimmung: wie bekannt die Vorschläge sein sollen (aus deinem Verhalten gelernt)
 */
let learnedSubjects = new Map<string, string[]>();
let fameShift = 0;

export function setLearnedSubjects(map: Record<string, string[]>) {
  learnedSubjects = new Map(Object.entries(map));
}

/** Gelernte Schlagwörter vorne anfügen (ohne Doppelte). */
export function withLearnedSubjects(id: string, subjects: string[]): string[] {
  const extra = learnedSubjects.get(id);
  if (!extra?.length) return subjects;
  const known = new Set(subjects.map((s) => s.toLowerCase()));
  return [...extra.filter((s) => !known.has(s.toLowerCase())), ...subjects];
}

export function setFameShift(shift: number) {
  fameShift = Number.isFinite(shift) ? Math.max(-0.6, Math.min(0.6, shift)) : 0;
}

/** + bekanntere, − weniger bekannte Bücher bevorzugen (0 = keine Anpassung). */
export function learnedFameShift(): number {
  return fameShift;
}
