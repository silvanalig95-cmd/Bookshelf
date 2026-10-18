import { describe, expect, it } from 'vitest';
import { duplicateGroups, mergeDuplicates } from '../src/lib/libraryMerge';
import type { LibraryEntry } from '../src/lib/types';
import { useLibrary } from '../src/store/library';

const e = (id: string, patch: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id,
  title: 'Der Schatten des Windes',
  authors: ['Carlos Ruiz Zafón'],
  rating: 0,
  shelf: 'read',
  source: 'goodreads-csv',
  ...patch,
});
const record = (...xs: LibraryEntry[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

describe('Doppelte Ausgaben zusammenführen', () => {
  it('macht aus zwei Ausgaben desselben Werks einen Eintrag – mit dem Besten aus beiden', () => {
    const { entries, removed } = mergeDuplicates(
      record(
        e('gr:1', { workKey: '/works/OL1W', rating: 4, dateRead: '2019-03-01', tags: ['spanien'], dateAdded: '2018-01-01' }),
        e('gr:2', { title: 'The Shadow of the Wind', workKey: '/works/OL1W', rating: 5, dateRead: '2024-06-01', tags: ['favoriten'], subjects: ['Barcelona', 'Books and reading'] }),
      ),
    );
    expect(Object.keys(entries)).toHaveLength(1);
    const merged = Object.values(entries)[0];
    expect(merged).toMatchObject({ title: 'Der Schatten des Windes', rating: 5, dateRead: '2024-06-01', dateAdded: '2018-01-01', subjects: ['Barcelona', 'Books and reading'] });
    expect(merged.tags?.sort()).toEqual(['favoriten', 'spanien']);
    expect(merged.aliases).toEqual(removed);
  });

  it('„gelesen“ schlägt „will ich lesen“', () => {
    const { entries } = mergeDuplicates(record(e('gr:1', { shelf: 'to-read', workKey: '/works/OL1W' }), e('gr:2', { shelf: 'read', rating: 4, workKey: '/works/OL1W' })));
    expect(Object.values(entries)[0]).toMatchObject({ id: 'gr:2', shelf: 'read', rating: 4 });
  });

  it('erkennt gleiche Bücher ohne Werk am ganzen Titel und Nachnamen', () => {
    expect(duplicateGroups(record(e('gr:1'), e('m:2', { authors: ['C. R. Zafón'] })))).toHaveLength(1);
  });

  it('legt verschiedene Werke nie zusammen – auch nicht bei gleichem Reihentitel', () => {
    const series = record(
      e('gr:1', { title: 'Das Lied von Eis und Feuer: Die Herren von Winterfell', authors: ['George R. R. Martin'], workKey: '/works/OL10W' }),
      e('gr:2', { title: 'Das Lied von Eis und Feuer: Das Erbe von Winterfell', authors: ['George R. R. Martin'], workKey: '/works/OL11W' }),
      e('gr:3', { title: 'Das Lied von Eis und Feuer: Das Erbe von Winterfell', authors: ['George R. R. Martin'] }),
    );
    const groups = duplicateGroups(series);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.id).sort()).toEqual(['gr:2', 'gr:3']);
    // gleicher Titel, aber zwei verschiedene Werke: lieber nichts zusammenlegen
    expect(duplicateGroups(record(e('gr:1', { workKey: '/works/OL1W' }), e('gr:2', { workKey: '/works/OL2W' }), e('gr:3')))).toHaveLength(0);
  });

  it('legt eine zusammengeführte Ausgabe beim erneuten Import nicht wieder an', () => {
    useLibrary.setState({ entries: {} });
    const first = useLibrary.getState().upsertMany([e('gr:1', { workKey: '/works/OL1W', rating: 3 }), e('gr:2', { title: 'La sombra del viento', workKey: '/works/OL1W', rating: 5, dateRead: '2025-01-01' })]);
    expect(first.merged).toBe(1);
    expect(Object.keys(useLibrary.getState().entries)).toHaveLength(1);
    useLibrary.getState().upsertMany([e('gr:2', { title: 'La sombra del viento', rating: 5 })]);
    expect(Object.keys(useLibrary.getState().entries)).toHaveLength(1);
  });
});
