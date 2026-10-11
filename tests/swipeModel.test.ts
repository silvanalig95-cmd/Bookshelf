import { describe, expect, it } from 'vitest';
import { buildProfile, signalScale } from '../src/lib/profile';
import { drawDeck } from '../src/lib/swipeDeck';
import { buildSwipeModel, contentFit, focusFor, genreAffinity, interleave, MODERN_FROM, modernShare, planDeck, sampleBeta, summarizeModel, SWIPE_GENRES } from '../src/lib/swipeModel';
import type { Book, SignalVerdict, TasteSignal } from '../src/lib/types';

/** Reproduzierbarer Zufall (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.parse('2026-10-01T12:00:00Z');
let n = 0;
function signal(subjects: string[], verdict: SignalVerdict, author = 'Autor', daysAgo = 1): TasteSignal {
  n++;
  return { bookId: `OL${n}W`, title: `Buch ${n}`, authors: [`${author} ${n % 7}`], subjects, verdict, at: new Date(NOW - daysAgo * 86400000).toISOString() };
}
const KRIMI_SWEDEN = ['Detective and mystery stories', 'Sweden', 'Police'];
const KRIMI_PLAIN = ['Detective and mystery stories', 'Murder'];
const HORROR = ['Horror tales', 'Ghost stories'];
const FANTASY = ['Fantasy fiction', 'Magic'];

function krimiFan(): TasteSignal[] {
  const out: TasteSignal[] = [];
  for (let i = 0; i < 400; i++) out.push(signal(KRIMI_SWEDEN, 'like'));
  for (let i = 0; i < 100; i++) out.push(signal(KRIMI_PLAIN, i % 2 ? 'like' : 'dislike'));
  for (let i = 0; i < 30; i++) out.push(signal(HORROR, 'dislike'));
  for (let i = 0; i < 6; i++) out.push(signal(FANTASY, i % 3 ? 'like' : 'dislike'));
  return out;
}

const book = (subjects: string[], authors = ['Neu']): Book => ({ id: 'OLxW', title: 'X', authors, subjects, languages: ['ger'] }) as Book;

describe('Swipe-Modell', () => {
  it('berücksichtigt alle Entscheidungen, auch tausende', () => {
    const signals = Array.from({ length: 3000 }, (_, i) => signal(i % 2 ? KRIMI_SWEDEN : FANTASY, i % 3 ? 'like' : 'dislike', 'A', i % 900));
    const model = buildSwipeModel(signals, NOW);
    expect(model.total).toBe(3000);
    expect(model.likes + model.dislikes).toBe(3000);
  });

  it('lernt Genre-Vorlieben und -Abneigungen', () => {
    const model = buildSwipeModel(krimiFan(), NOW);
    expect(genreAffinity(model, 'krimi')).toBeGreaterThan(0.75);
    expect(genreAffinity(model, 'horror')).toBeLessThan(0.15);
    // Unerprobte Genres starten vorsichtig – unter der Grundquote, aber weit weg von „abgelehnt“
    expect(genreAffinity(model, 'scifi')).toBeLessThan(model.baseRate);
    expect(genreAffinity(model, 'scifi')).toBeGreaterThan(genreAffinity(model, 'horror') + 0.2);
  });

  it('erkennt Themen, die innerhalb eines Genres besonders reizen', () => {
    const model = buildSwipeModel(krimiFan(), NOW);
    expect(focusFor(model, 'krimi')).toContain('Sweden');
    const summary = summarizeModel(model);
    expect(summary.liked.map((c) => c.subject)).toContain('Sweden');
    expect(summary.disliked.map((c) => c.subject)).toEqual(expect.arrayContaining(['Ghost stories']));
    expect(summary.toExplore).toContain('Science-Fiction');
  });

  it('bewertet Karten nach Passung', () => {
    const model = buildSwipeModel(krimiFan(), NOW);
    expect(contentFit(book(['Sweden', 'Police']), model)).toBeGreaterThan(0.3);
    expect(contentFit(book(['Ghost stories', 'Horror tales']), model)).toBeLessThan(-0.3);
    expect(contentFit(book(['Gardening']), model)).toBe(0);
  });

  it('ältere Entscheidungen zählen weniger, aber nicht gar nicht', () => {
    const fresh = buildSwipeModel([signal(FANTASY, 'like', 'A', 1)], NOW);
    const old = buildSwipeModel([signal(FANTASY, 'like', 'A', 365 * 5)], NOW);
    const g = (m: ReturnType<typeof buildSwipeModel>) => m.genres.get('fantasy')!.pos;
    expect(g(old)).toBeLessThan(g(fresh));
    expect(g(old)).toBeGreaterThanOrEqual(0.4 * g(fresh) - 1e-9);
  });
});

describe('Stapel-Planung gegen die Filterblase', () => {
  const model = buildSwipeModel(krimiFan(), NOW);

  it('mischt immer mehrere Genres, keins über 30 %, ein Viertel Neuland', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const plan = planDeck(model, { size: 16, rng: rng(seed) });
      const total = plan.reduce((a, s) => a + s.count, 0);
      expect(total).toBe(16);
      expect(new Set(plan.map((s) => s.genre.id)).size).toBeGreaterThanOrEqual(5);
      for (const s of plan) expect(s.count).toBeLessThanOrEqual(5);
      expect(plan.filter((s) => s.kind === 'neuland').reduce((a, s) => a + s.count, 0)).toBe(4);
    }
  });

  it('das Lieblingsgenre kommt fast immer, Abgelehntes selten', () => {
    let krimi = 0;
    let horror = 0;
    const runs = 200;
    for (let seed = 1; seed <= runs; seed++) {
      const plan = planDeck(model, { size: 16, rng: rng(seed) });
      if (plan.some((s) => s.genre.id === 'krimi')) krimi++;
      if (plan.some((s) => s.genre.id === 'horror')) horror++;
    }
    expect(krimi / runs).toBeGreaterThan(0.9);
    expect(horror / runs).toBeLessThan(0.1);
  });

  it('erkundet mit der Zeit praktisch alle Genres', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) for (const s of planDeck(model, { rng: rng(seed) })) seen.add(s.genre.id);
    const missing = SWIPE_GENRES.map((g) => g.id).filter((id) => !seen.has(id) && id !== 'horror');
    expect(missing).toEqual([]);
  });

  it('gibt Lieblingsthemen als Fokus mit', () => {
    const plans = Array.from({ length: 30 }, (_, i) => planDeck(model, { rng: rng(i + 1) }));
    const krimiSlot = plans.flat().find((s) => s.genre.id === 'krimi' && s.kind === 'favorit');
    expect(krimiSlot?.focus).toContain('Sweden');
  });

  it('funktioniert ohne jede Vorgeschichte', () => {
    const plan = planDeck(buildSwipeModel([], NOW), { rng: rng(7) });
    expect(plan.reduce((a, s) => a + s.count, 0)).toBe(16);
    expect(new Set(plan.map((s) => s.genre.id)).size).toBeGreaterThanOrEqual(5);
  });
});

describe('Simulation: 1500 Swipes', () => {
  it('lernt die echten Vorlieben, ohne sich auf wenige Genres festzufahren', () => {
    const truth: Record<string, number> = { krimi: 0.85, fantasy: 0.75, scifi: 0.7, historisch: 0.6 };
    const r = rng(2026);
    const signals: TasteSignal[] = [];
    const shownLate = new Map<string, number>();
    for (let round = 0; round < 94; round++) {
      const model = buildSwipeModel(signals, NOW);
      for (const slot of planDeck(model, { size: 16, rng: r })) {
        for (let k = 0; k < slot.count; k++) {
          const p = truth[slot.genre.id] ?? 0.25;
          signals.push(signal(slot.genre.subjects.slice(0, 2), r() < p ? 'like' : 'dislike'));
          if (round >= 75) shownLate.set(slot.genre.id, (shownLate.get(slot.genre.id) ?? 0) + 1);
        }
      }
    }
    const model = buildSwipeModel(signals, NOW);
    expect(model.total).toBe(signals.length);
    expect(signals.length).toBeGreaterThan(1500);
    // Die Lieblingsgenres stehen vorne …
    const top = summarizeModel(model).genres.slice(0, 4).map((g) => g.id);
    expect(top).toEqual(expect.arrayContaining(['krimi', 'fantasy', 'scifi']));
    // … aber auch spät noch viele verschiedene Genres im Stapel, keins dominiert
    const late = Array.from(shownLate.values()).reduce((a, x) => a + x, 0);
    expect(shownLate.size).toBeGreaterThanOrEqual(12);
    expect(Math.max(...shownLate.values()) / late).toBeLessThanOrEqual(0.31);
    const favorites = ['krimi', 'fantasy', 'scifi', 'historisch'].reduce((a, id) => a + (shownLate.get(id) ?? 0), 0);
    expect(favorites / late).toBeGreaterThan(0.45);
  });
});

describe('Hilfsfunktionen', () => {
  it('Beta-Stichproben haben den erwarteten Mittelwert', () => {
    const r = rng(42);
    const xs = Array.from({ length: 4000 }, () => sampleBeta(8, 2, r));
    const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.77);
    expect(mean).toBeLessThan(0.83);
    expect(xs.every((x) => x > 0 && x < 1)).toBe(true);
  });

  it('verschränkt Listen reihum', () => {
    expect(interleave<string | number | boolean>([[1, 2, 3], ['a'], [true, false]])).toEqual([1, 'a', true, 2, false, 3]);
  });

  it('tausende Swipes übertönen die Lesegeschichte nicht', () => {
    expect(signalScale(100)).toBe(1);
    expect(signalScale(1000)).toBeCloseTo(0.5, 5);
    // Gesamtgewicht der Swipes wächst nur noch mit der Wurzel
    expect(4000 * signalScale(4000)).toBeCloseTo(2 * 1000 * signalScale(1000), 5);
    const swipes = Array.from({ length: 2000 }, () => signal(['Romance', 'Love stories'], 'like'));
    expect(buildProfile([], swipes).signalCount).toBe(2000);
  });
});

describe('Neu und Alt', () => {
  it('mischt standardmässig rund zwei Drittel neuere Bücher, bei Weltliteratur mehr Älteres', () => {
    const empty = buildSwipeModel([], NOW);
    expect(modernShare(empty, 'krimi')).toBeCloseTo(0.75, 2);
    expect(modernShare(empty, 'literatur')).toBeCloseTo(0.45, 2);
    expect(modernShare(empty, 'klassiker')).toBe(0);
  });

  it('lernt aus den Swipes, ob du eher Neues oder Älteres magst – mit Grenzen', () => {
    const lovesOld: TasteSignal[] = [];
    for (let i = 0; i < 40; i++) {
      lovesOld.push({ ...signal(FANTASY, 'like'), year: 1900 + i });
      lovesOld.push({ ...signal(FANTASY, 'dislike'), year: 2000 + (i % 20) });
    }
    const model = buildSwipeModel(lovesOld, NOW);
    const share = modernShare(model, 'fantasy');
    expect(share).toBeLessThan(modernShare(buildSwipeModel([], NOW), 'fantasy'));
    expect(share).toBeGreaterThanOrEqual(0.15);
  });
});

describe('Stapel ziehen', () => {
  const mk = (id: string, year: number, author: string): Book =>
    ({ id, title: id, authors: [author], subjects: ['Fiction'], languages: ['ger'], year, coverId: 1, popularity: 100 }) as Book;
  let next = 0;
  // Liefert je Anfrage frische Bücher; neuere nur bei Anfragen mit Jahresfilter
  const search = async (q: string) => {
    const modern = q.includes('first_publish_year');
    return Array.from({ length: 20 }, (_, i) => {
      next++;
      return mk(`B${next}`, modern ? 1995 + (i % 25) : 1850 + i * 5, `Autor ${next}`);
    });
  };

  it('hält den Anteil neuerer Bücher ein und nimmt jede Autor:in nur einmal', async () => {
    const seen = new Set<string>();
    const cards = await drawDeck(buildSwipeModel([], NOW), { langClause: '', usable: (b) => !seen.has(b.id), markSeen: (b) => seen.add(b.id), search, rng: rng(5) });
    expect(cards.length).toBe(16);
    const modern = cards.filter((c) => (c.book.year ?? 0) >= MODERN_FROM).length / cards.length;
    expect(modern).toBeGreaterThan(0.45);
    expect(modern).toBeLessThan(0.9);
    expect(new Set(cards.map((c) => c.book.authors[0])).size).toBe(cards.length);
    expect(cards.every((c) => c.why.length > 0)).toBe(true);
  });

  it('zeigt Gesehenes nicht nochmals', async () => {
    const seen = new Set<string>();
    const opts = { langClause: '', usable: (b: Book) => !seen.has(b.id), markSeen: (b: Book) => seen.add(b.id), search, rng: rng(9) };
    const a = await drawDeck(buildSwipeModel([], NOW), opts);
    const b = await drawDeck(buildSwipeModel([], NOW), opts);
    const ids = new Set(a.map((c) => c.book.id));
    expect(b.some((c) => ids.has(c.book.id))).toBe(false);
  });
});
