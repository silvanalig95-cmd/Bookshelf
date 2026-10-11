import { describe, expect, it } from 'vitest';
import { extractPlot } from '../src/lib/wikipedia';

const article = `
Hunger (norwegisch Sult) ist der erste Roman von Knut Hamsun.

== Inhalt ==
Ein junger, namenloser Schriftsteller streift hungernd durch Kristiania. Er versucht, mit Zeitungsartikeln zu überleben, und verliert zunehmend den Halt.

=== Erster Teil ===
Er wird aus seinem Zimmer geworfen und verpfändet seine Weste.

== Rezeption ==
Der Roman gilt als Vorläufer der Moderne.`;

describe('Wikipedia-Inhalt', () => {
  it('findet den Abschnitt zum Inhalt samt Unterabschnitten', () => {
    const plot = extractPlot(article)!;
    expect(plot.heading).toBe('Inhalt');
    expect(plot.text).toContain('namenloser Schriftsteller');
    expect(plot.text).toContain('verpfändet seine Weste');
    expect(plot.text).not.toContain('Erster Teil');
    expect(plot.text).not.toContain('Vorläufer der Moderne');
  });

  it('kennt auch „Handlung“ und ignoriert zu kurze oder fehlende Abschnitte', () => {
    expect(extractPlot(article.replace('== Inhalt ==', '== Handlung =='))?.heading).toBe('Handlung');
    expect(extractPlot('\nNur eine Einleitung.\n\n== Rezeption ==\nLob.')).toBeUndefined();
    expect(extractPlot('\nX\n\n== Inhalt ==\nKurz.\n')).toBeUndefined();
  });
});
