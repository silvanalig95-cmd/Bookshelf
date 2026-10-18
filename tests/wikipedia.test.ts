import { describe, expect, it } from 'vitest';
import { contentSentences, contentSummary, extractPlot, premise, sentences, titleVariants } from '../src/lib/wikipedia';

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

describe('Worum es geht', () => {
  it('zerlegt Sätze trotz Abkürzungen, Initialen und Ordnungszahlen', () => {
    expect(sentences('Im 19. Jahrhundert lebt z. B. J. K. Müller in St. Gallen. Dann zieht er weg! „Warum?“ Niemand weiss es.')).toEqual([
      'Im 19. Jahrhundert lebt z. B. J. K. Müller in St. Gallen.',
      'Dann zieht er weg!',
      '„Warum?“',
      'Niemand weiss es.',
    ]);
  });

  it('nimmt aus dem Handlungsabschnitt nur die Ausgangslage', () => {
    const plot = 'Richard Papen kommt aus Kalifornien an ein College in Vermont. Dort schliesst er sich einer Gruppe von Griechisch-Studenten an. ' + 'Später geschieht ein Mord. '.repeat(30);
    const text = premise(plot, 140);
    expect(text).toBe('Richard Papen kommt aus Kalifornien an ein College in Vermont. Dort schliesst er sich einer Gruppe von Griechisch-Studenten an.');
  });

  it('lässt Erscheinungs- und Erfolgsangaben der Einleitung weg', () => {
    const intro =
      'Die geheime Geschichte ist der Debüt-Roman der US-amerikanischen Schriftstellerin Donna Tartt. Das Buch erschien erstmals 1992 im Verlag Alfred A. Knopf und wurde zum Bestseller. Der Roman erzählt von einer Gruppe exzentrischer Studenten, die ein Verbrechen begehen.';
    expect(contentSentences(intro)).toEqual(['Der Roman erzählt von einer Gruppe exzentrischer Studenten, die ein Verbrechen begehen.']);
    expect(contentSummary({ title: 'x', url: '', extract: intro.split(' Der Roman')[0] })).toBeUndefined();
    expect(contentSummary({ title: 'x', url: '', extract: intro, plot: { heading: 'Handlung', text: 'Richard zieht nach Vermont.' } })).toEqual({
      text: 'Richard zieht nach Vermont.',
      source: 'plot',
    });
  });
});

describe('Wikipedia: Schreibweisen von Ausgabentiteln', () => {
  it('findet auch Titel mit Zusätzen, Grossbuchstaben und Untertiteln', () => {
    expect(titleVariants('Schlachthof 5 oder der Kinderkreuzzug.')).toEqual(
      expect.arrayContaining(['Schlachthof 5 oder der Kinderkreuzzug', 'Schlachthof 5 oder Der Kinderkreuzzug', 'Schlachthof 5']),
    );
    expect(titleVariants('Die Frau DES Zeitreisenden')).toContain('Die Frau des Zeitreisenden');
    expect(titleVariants('Hüter der Erinnerung. ( Ab 12 J.).')).toContain('Hüter der Erinnerung');
    expect(titleVariants('Der Fremde')).toEqual(['Der Fremde']);
  });
});
