import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookGrid } from '../components/BookCard';
import { BookSearchBox } from '../components/BookSearchBox';
import { BarList, ColumnChart } from '../components/Charts';
import { Cover } from '../components/Cover';
import { Empty, ProgressBar } from '../components/Feedback';
import { StarInput } from '../components/Stars';
import { fetchGoodreadsShelves, localApiStatus, parseGoodreadsCsv, parseGoodreadsUserId } from '../lib/goodreads';
import { useLibraryEntries, useProfile } from '../lib/hooks';
import { computeStats, readingPersona } from '../lib/stats';
import { normalize } from '../lib/text';
import type { LibraryEntry, Shelf } from '../lib/types';
import { useEnrichment } from '../store/enrichment';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';
import { toast, useUi } from '../store/ui';
import { useWishlist } from '../store/wishlist';

type Tab = 'gelesen' | 'wunsch' | 'merkliste' | 'dna' | 'import';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'gelesen', label: '📖 Gelesen' },
  { id: 'wunsch', label: '🗓️ Will ich lesen' },
  { id: 'merkliste', label: '♥ Merkliste' },
  { id: 'dna', label: '🧬 Lese-DNA' },
  { id: 'import', label: '⇅ Goodreads & Daten' },
];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'gelesen';
  const entries = useLibraryEntries();
  const wishCount = useWishlist((s) => Object.keys(s.items).length);
  const enrichment = useEnrichment();
  const pending = entries.filter((e) => e.matchState !== 'matched').length;
  const counts: Record<Tab, number | undefined> = {
    gelesen: entries.filter((e) => e.shelf !== 'to-read').length,
    wunsch: entries.filter((e) => e.shelf === 'to-read').length,
    merkliste: wishCount,
    dna: undefined,
    import: undefined,
  };

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Bibliothek</p>
        <h1>Deine Bücher</h1>
        <p>Alles, was du gelesen hast, lesen willst und dir gemerkt hast – die Grundlage für persönliche Empfehlungen. Alle Daten bleiben in diesem Browser.</p>
      </div>

      {(enrichment.running || (pending > 0 && entries.length > 0)) && (
        <div className="notice teal" style={{ marginBottom: 18 }}>
          <span className="notice-icon">🧩</span>
          <div style={{ flex: 1 }}>
            {enrichment.running ? (
              <>
                <b>Bücher werden mit Themen angereichert …</b> {enrichment.done} / {enrichment.total} · {enrichment.matched} zugeordnet
                <div className="mt-1">
                  <ProgressBar value={enrichment.done} max={enrichment.total} />
                </div>
              </>
            ) : (
              <div className="row between wrap">
                <span>
                  {pending} {pending === 1 ? 'Buch ist' : 'Bücher sind'} noch keinem Open-Library-Werk zugeordnet. Mit Themen werden Empfehlungen treffsicherer.
                </span>
                <button className="btn btn-sm btn-teal" onClick={enrichment.start}>
                  Abgleich starten
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setParams({ tab: t.id }, { replace: true })}>
            {t.label}
            {counts[t.id] ? <span className="muted"> {counts[t.id]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'gelesen' && <EntryList shelves={['read', 'currently-reading']} />}
      {tab === 'wunsch' && <EntryList shelves={['to-read']} />}
      {tab === 'merkliste' && <Wishlist />}
      {tab === 'dna' && <ReadingDna />}
      {tab === 'import' && <ImportPanel />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function entryLink(e: LibraryEntry): string {
  if (e.workKey) return `/buch/${e.workKey.replace('/works/', '')}`;
  return `/entdecken?q=${encodeURIComponent(`${e.title} ${e.authors[0] ?? ''}`)}`;
}

function EntryList({ shelves }: { shelves: Shelf[] }) {
  const entries = useLibraryEntries();
  const update = useLibrary((s) => s.update);
  const remove = useLibrary((s) => s.remove);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'date' | 'rating' | 'title' | 'author'>('date');
  const [limit, setLimit] = useState(60);

  const list = useMemo(() => {
    const f = normalize(filter);
    const items = entries.filter((e) => shelves.includes(e.shelf) && (!f || normalize(`${e.title} ${e.authors.join(' ')} ${(e.tags ?? []).join(' ')}`).includes(f)));
    const by = {
      date: (a: LibraryEntry, b: LibraryEntry) => (b.dateRead ?? b.dateAdded ?? '').localeCompare(a.dateRead ?? a.dateAdded ?? ''),
      rating: (a: LibraryEntry, b: LibraryEntry) => b.rating - a.rating,
      title: (a: LibraryEntry, b: LibraryEntry) => a.title.localeCompare(b.title, 'de'),
      author: (a: LibraryEntry, b: LibraryEntry) => (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '', 'de'),
    }[sort];
    return items.sort(by);
  }, [entries, shelves, filter, sort]);

  if (!entries.some((e) => shelves.includes(e.shelf))) {
    return (
      <Empty icon={shelves.includes('read') ? '📖' : '🗓️'} title={shelves.includes('read') ? 'Noch keine gelesenen Bücher' : 'Deine Will-ich-lesen-Liste ist leer'}>
        <p>Verbinde Goodreads oder füge Bücher manuell hinzu.</p>
        <Link to="/bibliothek?tab=import" className="btn btn-primary">
          Bücher importieren
        </Link>
      </Empty>
    );
  }

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 340 }} placeholder="In der Liste suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sortierung">
          <option value="date">Zuletzt gelesen/hinzugefügt</option>
          <option value="rating">Beste Bewertung</option>
          <option value="title">Titel A–Z</option>
          <option value="author">Autor:in A–Z</option>
        </select>
        <span className="muted small">{list.length} Bücher</span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {list.slice(0, limit).map((e) => (
          <div key={e.id} className="edition" style={{ cursor: 'default', gridTemplateColumns: '46px 1fr auto' }}>
            <Cover title={e.title} author={e.authors[0]} src={e.coverUrl} coverId={e.coverId} size="S" />
            <div style={{ minWidth: 0 }}>
              <Link to={entryLink(e)} className="e-title" style={{ color: 'var(--ink)' }}>
                {e.title}
              </Link>
              <div className="e-meta">
                {e.authors.slice(0, 2).join(', ')}
                {e.dateRead ? ` · gelesen ${new Date(e.dateRead).toLocaleDateString('de-CH')}` : ''}
                {e.shelf === 'currently-reading' ? ' · liest du gerade' : ''}
                {e.pages ? ` · ${e.pages} S.` : ''}
              </div>
              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {e.matchState === 'unmatched' && <span className="tag gold" title="Kein Open-Library-Werk gefunden – zählt nur eingeschränkt für Empfehlungen">⚠ ohne Themen</span>}
                {(e.tags ?? []).slice(0, 4).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {e.shelf !== 'to-read' && <StarInput value={e.rating} onChange={(r) => update(e.id, { rating: r })} />}
              <button
                className="mini-btn"
                style={{ boxShadow: 'none', border: '1px solid var(--line)' }}
                title="Entfernen"
                onClick={() => {
                  remove(e.id);
                  toast('Entfernt');
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
      {list.length > limit && (
        <div className="center mt-2">
          <button className="btn" onClick={() => setLimit((l) => l + 120)}>
            Mehr zeigen ({list.length - limit})
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Wishlist() {
  const items = useWishlist((s) => s.items);
  const clear = useWishlist((s) => s.clear);
  const list = useMemo(() => Object.values(items).sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [items]);
  if (!list.length) {
    return (
      <Empty icon="♡" title="Deine Merkliste ist leer">
        <p>Tippe auf ♡ bei einem Buch, um es dir zu merken – beim Entdecken, Swipen oder am Glücksrad.</p>
        <Link to="/swipe" className="btn btn-primary">
          Swipe starten
        </Link>
      </Empty>
    );
  }
  const copy = async () => {
    const text = list.map((w) => `${w.book.title} – ${w.book.authors[0] ?? ''}${w.book.isbns?.[0] ? ` (ISBN ${w.book.isbns[0]})` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Merkliste kopiert');
    } catch {
      toast('Kopieren nicht möglich');
    }
  };
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <span className="muted small">{list.length} gemerkte Bücher</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={copy}>
          📋 Als Liste kopieren
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (confirm('Merkliste wirklich leeren?')) clear();
          }}
        >
          Leeren
        </button>
      </div>
      <BookGrid items={list.map((w) => w.book)} origin="Merkliste" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReadingDna() {
  const entries = useLibraryEntries();
  const profile = useProfile();
  const stats = useMemo(() => computeStats(entries), [entries]);
  const persona = useMemo(() => readingPersona(stats), [stats]);
  if (!stats.read) {
    return (
      <Empty icon="🧬" title="Noch keine Lese-DNA">
        <p>Sobald deine gelesenen Bücher importiert sind, siehst du hier, wie du liest.</p>
        <Link to="/bibliothek?tab=import" className="btn btn-primary">
          Goodreads verbinden
        </Link>
      </Empty>
    );
  }
  const maxConcept = profile?.topConcepts[0]?.weight ?? 1;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--gold-soft))', borderColor: 'transparent' }}>
        <p className="eyebrow">Deine Lesepersönlichkeit</p>
        <h2>{persona.title}</h2>
        <p className="mb-0">{persona.text}</p>
      </div>

      <div className="stat-tiles">
        <Tile label="Gelesene Bücher" value={stats.read.toLocaleString('de-CH')} sub={`${stats.currentlyReading} gerade, ${stats.toRead} geplant`} />
        <Tile label="Gelesene Seiten" value={compactNumber(stats.pages)} sub={stats.read ? `Ø ${Math.round(stats.pages / Math.max(1, stats.read))} pro Buch` : undefined} />
        <Tile label="Ø Bewertung" value={stats.avgRating ? `${stats.avgRating.toFixed(2)} ★` : '–'} sub={`${stats.rated} bewertet`} />
        <Tile label="Mit Themen" value={`${Math.round((stats.matched / Math.max(1, entries.length)) * 100)} %`} sub="Open-Library-Abgleich" />
      </div>

      <div className="grid-2">
        {stats.perYear.length > 1 && (
          <div className="card">
            <h3>Bücher pro Jahr</h3>
            <ColumnChart
              title="Gelesene Bücher pro Jahr"
              data={stats.perYear.map((y) => ({ label: `'${String(y.year).slice(2)}`, value: y.count, hint: y.pages ? `${y.pages.toLocaleString('de-CH')} Seiten` : undefined }))}
            />
          </div>
        )}
        <div className="card">
          <h3>Deine Sterne</h3>
          <ColumnChart title="Verteilung deiner Bewertungen" color="var(--gold)" data={stats.ratings.map((r) => ({ label: `${r.stars} ★`, value: r.count }))} />
        </div>
        {stats.genres.length > 0 && (
          <div className="card">
            <h3>Lieblingsgenres</h3>
            <BarList title="Gelesene Bücher nach Genre" data={stats.genres.map((g) => ({ label: `${g.emoji} ${g.label}`, value: g.count }))} />
          </div>
        )}
        {stats.authors.length > 0 && (
          <div className="card">
            <h3>Meistgelesene Autor:innen</h3>
            <BarList title="Gelesene Bücher nach Autor:in" color="var(--teal)" data={stats.authors.map((a) => ({ label: a.name, value: a.count, hint: a.avg ? `Ø ${a.avg.toFixed(1)} ★` : undefined }))} />
          </div>
        )}
        {stats.decades.length > 1 && (
          <div className="card">
            <h3>Aus welcher Zeit deine Bücher stammen</h3>
            <ColumnChart title="Bücher nach Jahrzehnt der Erstveröffentlichung" color="var(--violet)" data={stats.decades.map((d) => ({ label: String(d.decade), value: d.count, hint: `${d.decade}–${d.decade + 9}` }))} />
          </div>
        )}
        {profile && profile.topConcepts.length > 0 && (
          <div className="card">
            <h3>Deine Themen</h3>
            <p className="small muted">Je grösser, desto prägender für deinen Geschmack.</p>
            <div className="chips">
              {profile.topConcepts.slice(0, 24).map((c) => (
                <Link
                  key={c.concept}
                  to={`/themen?s=${encodeURIComponent(c.concept)}`}
                  className="chip"
                  style={{ fontSize: `${0.78 + (c.weight / maxConcept) * 0.45}rem`, fontWeight: c.weight / maxConcept > 0.6 ? 700 : 550 }}
                >
                  {c.label}
                </Link>
              ))}
            </div>
            {profile.dislikedConcepts.length > 0 && (
              <p className="small muted mt-2">
                Eher nicht deins: {profile.dislikedConcepts.slice(0, 6).map((c) => c.label).join(', ')}
              </p>
            )}
          </div>
        )}
        {stats.places.length > 0 && (
          <div className="card">
            <h3>Wohin dich Bücher führen</h3>
            <div className="chips">
              {stats.places.map((p) => (
                <span key={p.name} className="tag teal">
                  📍 {p.name} · {p.count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {(stats.longest || stats.oldest) && (
        <div className="grid-2">
          {stats.longest && <Tile label="Dein dickstes Buch" value={`${stats.longest.pages} Seiten`} sub={`${stats.longest.title} – ${stats.longest.authors[0] ?? ''}`} />}
          {stats.oldest && <Tile label="Dein ältestes Buch" value={String(stats.oldest.year)} sub={`${stats.oldest.title} – ${stats.oldest.authors[0] ?? ''}`} />}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="st-label">{label}</div>
      <div className="st-value">{value}</div>
      {sub && <div className="st-sub">{sub}</div>}
    </div>
  );
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} Mio.`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString('de-CH');
}

/* ------------------------------------------------------------------ */

function ImportPanel() {
  const upsertMany = useLibrary((s) => s.upsertMany);
  const clearLibrary = useLibrary((s) => s.clear);
  const lastImport = useLibrary((s) => s.lastImport);
  const startEnrichment = useEnrichment((s) => s.start);
  const settings = useSettings();
  const openRating = useUi((s) => s.openRating);
  const [server, setServer] = useState<boolean | undefined>();
  const [profileInput, setProfileInput] = useState(settings.goodreadsUserId);
  const [shelves, setShelves] = useState<Shelf[]>(['read', 'currently-reading', 'to-read']);
  const [rssState, setRssState] = useState<{ busy: boolean; message?: string; error?: string }>({ busy: false });
  const [csvState, setCsvState] = useState<{ message?: string; error?: string }>({});
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localApiStatus().then((s) => setServer(s.goodreads));
  }, []);

  const afterImport = (count: number, source: string, added: number, updated: number) => {
    toast(`${count} Bücher aus ${source} übernommen`);
    startEnrichment();
    return `${count} Bücher gelesen – ${added} neu, ${updated} aktualisiert. Themen werden jetzt im Hintergrund ergänzt.`;
  };

  const importRss = async () => {
    const id = parseGoodreadsUserId(profileInput);
    if (!id) {
      setRssState({ busy: false, error: 'Bitte die Profil-URL (z. B. https://www.goodreads.com/user/show/12345678-name) oder die Nutzer-ID eingeben.' });
      return;
    }
    setRssState({ busy: true, message: 'Verbinde mit Goodreads …' });
    try {
      const entries = await fetchGoodreadsShelves(id, shelves, (p) =>
        setRssState({ busy: true, message: `Regal „${p.shelf}“, Seite ${p.page} … ${p.count} Bücher bisher` }),
      );
      if (!entries.length) {
        setRssState({ busy: false, error: 'Keine Bücher gefunden. Ist dein Profil öffentlich? (Goodreads → Einstellungen → Datenschutz → „Jeder“)' });
        return;
      }
      settings.set({ goodreadsUserId: id });
      const { added, updated } = upsertMany(entries, 'goodreads-rss');
      setRssState({ busy: false, message: afterImport(entries.length, 'Goodreads', added, updated) });
    } catch (err) {
      setRssState({
        busy: false,
        error: `Goodreads konnte nicht geladen werden (${err instanceof Error ? err.message : String(err)}). Prüfe, ob das Profil öffentlich ist – oder nutze den CSV-Export.`,
      });
    }
  };

  const importCsv = async (file: File) => {
    setCsvState({ message: 'Datei wird gelesen …' });
    try {
      const text = await file.text();
      const result = parseGoodreadsCsv(text);
      if (!result.entries.length) {
        setCsvState({ error: result.errors[0] ?? 'Keine Bücher in der Datei gefunden.' });
        return;
      }
      const { added, updated } = upsertMany(result.entries, 'goodreads-csv');
      setCsvState({ message: afterImport(result.entries.length, 'dem CSV-Export', added, updated) });
    } catch (err) {
      setCsvState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const exportBackup = () => {
    const settingsRaw = JSON.parse(localStorage.getItem('lesekompass.settings') ?? '{}') as { state?: Record<string, unknown> };
    if (settingsRaw.state) {
      // Schlüssel nicht mit exportieren
      settingsRaw.state.aiApiKey = '';
      settingsRaw.state.googleApiKey = '';
    }
    const lib = useLibrary.getState();
    const data = {
      library: { entries: lib.entries, lastImport: lib.lastImport },
      wishlist: { items: useWishlist.getState().items },
      signals: { signals: useSignals.getState().signals },
      settings: settingsRaw.state ?? {},
    };
    const blob = new Blob([JSON.stringify({ app: 'lesekompass', version: 2, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lesekompass-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        app?: string;
        data?: {
          library?: { entries?: Record<string, LibraryEntry>; lastImport?: unknown };
          wishlist?: { items?: Record<string, unknown> };
          signals?: { signals?: unknown[] };
          settings?: Record<string, unknown>;
        };
      };
      if (parsed.app !== 'lesekompass' || !parsed.data) throw new Error('Das ist keine Lesekompass-Sicherung.');
      const d = parsed.data;
      if (d.library?.entries) useLibrary.setState({ entries: d.library.entries });
      if (d.wishlist?.items) useWishlist.setState({ items: d.wishlist.items as never });
      if (d.signals?.signals) useSignals.setState({ signals: d.signals.signals as never });
      if (d.settings) {
        const { aiApiKey: _a, googleApiKey: _g, ...rest } = d.settings;
        void _a;
        void _g;
        useSettings.getState().set(rest as never);
      }
      toast('Sicherung wiederhergestellt');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sicherung ungültig');
    }
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">
          <h3>🔗 Goodreads-Profil verbinden</h3>
        </div>
        <p className="small">
          Lädt deine Regale direkt aus deinem <b>öffentlichen</b> Goodreads-Profil – inklusive Bewertungen, Lesedaten und Klappentexten. Erneut ausführen
          aktualisiert die Daten.
        </p>
        {server === false && (
          <div className="notice" style={{ marginBottom: 12 }}>
            <span className="notice-icon">ℹ️</span>
            <span className="small">
              Das direkte Verbinden braucht den lokalen Lesekompass-Server (<code>npm start</code>), weil Goodreads keinen Browser-Zugriff erlaubt. Auf dieser
              Installation klappt der CSV-Export rechts.
            </span>
          </div>
        )}
        <div className="field">
          <label htmlFor="gr-profile">Profil-URL oder Nutzer-ID</label>
          <input
            id="gr-profile"
            className="input"
            placeholder="https://www.goodreads.com/user/show/12345678-dein-name"
            value={profileInput}
            onChange={(e) => setProfileInput(e.target.value)}
            disabled={server === false}
          />
          <span className="help">Zu finden unter „My Books“ oder in der Adresszeile deines Profils.</span>
        </div>
        <div className="chips" style={{ marginBottom: 14 }}>
          {(
            [
              ['read', 'Gelesen'],
              ['currently-reading', 'Lese ich gerade'],
              ['to-read', 'Will ich lesen'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`chip ${shelves.includes(id) ? 'on' : ''}`} onClick={() => setShelves((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={importRss} disabled={rssState.busy || server === false || !shelves.length}>
          {rssState.busy ? 'Importiere …' : settings.goodreadsUserId ? '↻ Erneut synchronisieren' : 'Mit Goodreads verbinden'}
        </button>
        {rssState.message && <p className="small mt-1">{rssState.message}</p>}
        {rssState.error && (
          <p className="small mt-1" style={{ color: 'var(--rose)' }}>
            {rssState.error}
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h3>📄 CSV-Export hochladen</h3>
        </div>
        <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
          <li>
            Auf Goodreads{' '}
            <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer">
              „Import and export“ öffnen ↗
            </a>
          </li>
          <li>„Export Library“ klicken und kurz warten</li>
          <li>Die Datei <code>goodreads_library_export.csv</code> hier ablegen</li>
        </ol>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) importCsv(f);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong)'}`,
            background: dragOver ? 'var(--accent-soft)' : 'var(--surface-2)',
            borderRadius: 16,
            padding: '28px 16px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all .15s',
          }}
        >
          <div style={{ fontSize: '2rem' }}>📥</div>
          <b>CSV hierher ziehen</b>
          <div className="small muted">oder klicken zum Auswählen</div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        {csvState.message && <p className="small mt-1">{csvState.message}</p>}
        {csvState.error && (
          <p className="small mt-1" style={{ color: 'var(--rose)' }}>
            {csvState.error}
          </p>
        )}
        {lastImport && (
          <p className="tiny muted mt-1">
            Letzter Import: {new Date(lastImport.at).toLocaleString('de-CH')} · {lastImport.count} Bücher ({lastImport.source === 'goodreads-rss' ? 'Profil' : lastImport.source === 'goodreads-csv' ? 'CSV' : 'manuell'})
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h3>➕ Buch von Hand hinzufügen</h3>
        </div>
        <p className="small">Für Bücher, die nicht auf Goodreads stehen. Suche das Buch und bewerte es.</p>
        <BookSearchBox placeholder="Titel oder Autor:in …" onPick={(b) => openRating(b)} />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>💾 Sicherung</h3>
        </div>
        <p className="small">Bibliothek, Merkliste und Swipe-Geschmack als Datei sichern – z. B. um auf ein anderes Gerät umzuziehen. API-Schlüssel werden nicht exportiert.</p>
        <div className="btn-row">
          <button className="btn" onClick={exportBackup}>
            ⬇️ Sicherung herunterladen
          </button>
          <button className="btn" onClick={() => backupRef.current?.click()}>
            ⬆️ Wiederherstellen
          </button>
          <input ref={backupRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </div>
        <hr className="divider" />
        <DangerZone onClearLibrary={clearLibrary} />
      </div>
    </div>
  );
}

function DangerZone({ onClearLibrary }: { onClearLibrary: () => void }) {
  const clearSignals = useSignals((s) => s.clear);
  return (
    <div className="btn-row">
      <button
        className="btn btn-sm btn-ghost"
        onClick={() => {
          if (confirm('Alle importierten Bücher löschen? Die Merkliste bleibt erhalten.')) {
            onClearLibrary();
            toast('Bibliothek geleert');
          }
        }}
      >
        Bibliothek leeren
      </button>
      <button
        className="btn btn-sm btn-ghost"
        onClick={() => {
          if (confirm('Swipe- und Glücksrad-Geschmack zurücksetzen?')) {
            clearSignals();
            toast('Geschmackssignale zurückgesetzt');
          }
        }}
      >
        Swipe-Geschmack zurücksetzen
      </button>
    </div>
  );
}
