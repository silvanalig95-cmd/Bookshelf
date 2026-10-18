import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookRow } from '../components/BookCard';
import { SkeletonGrid } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { useAsync, useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { discoveryPool, newReleasesPool, rankForHome, tastePool } from '../lib/homeFeed';
import { isProfileUsable } from '../lib/profile';
import { MOODS } from '../lib/taxonomy';
import { impressionsReady, staleness } from '../store/impressions';
import { useSettings } from '../store/settings';
import { dismissedIds, useSignals } from '../store/signals';
import { useWishlist } from '../store/wishlist';

const EXAMPLES = [
  'ein düsterer Krimi, der in Skandinavien spielt',
  'wie „Der Schatten des Windes“, aber kürzer',
  'Fantasy ohne Romanze, eher ein Geheimtipp',
  'etwas Herzerwärmendes für einen verregneten Sonntag',
  'Science-Fiction mit Philosophie und KI',
  'ein Familienroman über mehrere Generationen in Italien',
  'lustig und skurril, unter 250 Seiten',
  'historischer Roman im Mittelalter, spannend',
];

const MODES = [
  { to: '/entdecken', title: 'Ausführliche Suche', text: 'Genres, Stimmungen, Orte, Epochen, Länge und Wunsch kombinieren.' },
  { to: '/fuer-dich', title: 'Für dich', text: 'Empfehlungen aus deinen gelesenen Büchern und Bewertungen.' },
  { to: '/bibliothekar', title: 'KI-Bibliothekar', text: 'Erzähl, worauf du Lust hast – die KI kennt deine Bücher.' },
  { to: '/bibliothek', title: 'Bibliothek & Lese-DNA', text: 'Goodreads verbinden, Merkliste und Lesestatistik.' },
  { to: '/swipe', title: 'Bücher-Stapel', text: 'Mehr davon, merken oder weiter – der Stapel lernt deinen Geschmack.' },
  { to: '/gluecksrad', title: 'Glücksrad & Blind Date', text: 'Bücher erst über ihren ersten Satz kennenlernen.' },
  { to: '/orakel', title: 'Lese-Orakel', text: 'Sieben Fragen zur heutigen Lesestimmung.' },
  { to: '/themen', title: 'Themen-Netz', text: 'Von Thema zu Thema neue Welten finden.' },
];

function useRotatingPlaceholder(): string {
  const [i, setI] = useState(() => Math.floor(Math.random() * EXAMPLES.length));
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % EXAMPLES.length), 3800);
    return () => clearInterval(t);
  }, []);
  return EXAMPLES[i];
}

export default function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const placeholder = useRotatingPlaceholder();
  const language = useSettings((s) => s.language);
  const entries = useLibraryEntries();
  const profile = useProfile();
  const readIndex = useReadIndex();
  const wishlist = useWishlist((s) => s.items);
  const wishItems = useMemo(
    () => Object.values(wishlist).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map((w) => w.book).slice(0, 20),
    [wishlist],
  );
  const usable = isProfileUsable(profile);

  // Alle Reihen auf einmal berechnen: so bleibt die Startseite stabil, solange du sie ansiehst
  const rows = useAsync(
    async (signal) => {
      const subjects = usable && profile ? profile.querySubjects.slice(0, 6) : [];
      const [taste, discover, fresh] = await Promise.all([
        tastePool(subjects, language, signal),
        discoveryPool(language, signal),
        newReleasesPool(language, signal),
        impressionsReady(),
      ]);
      const ctx = { profile: usable ? profile : undefined, readIndex, language, staleness: (id: string) => staleness(id) };
      // Ausgeblendetes und „Nicht meins“ kommen nicht mehr vor
      const hidden = dismissedIds(useSignals.getState().signals);
      const forYou = usable ? rankForHome([...taste, ...discover], { ...ctx, exclude: hidden, minRating: 3.75 }) : [];
      const shown = new Set([...hidden, ...forYou.map((s) => s.book.id)]);
      const discoveries = rankForHome(discover, { ...ctx, exclude: shown, minRating: 3.8 });
      for (const s of discoveries) shown.add(s.book.id);
      const newest = rankForHome(fresh, { ...ctx, exclude: shown, max: 14 });
      return { forYou, discoveries, newest };
    },
    [usable, profile?.querySubjects.join('|'), language],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = (query.trim() || placeholder).trim();
    navigate(`/entdecken?q=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <section className="hero">
        <h1>Finde dein nächstes Lieblingsbuch.</h1>
        <p className="lead">Titel, Autor:in oder einfach in eigenen Worten, worauf du Lust hast. Deutsche Ausgaben zuerst.</p>
        <form className="big-search" onSubmit={submit} role="search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Titel, Autor:in oder Wunsch in eigenen Worten"
          />
          <button className="btn btn-primary" type="submit">
            Finden
          </button>
        </form>
        <div className="chips quick-moods">
          {MOODS.slice(0, 7).map((m) => (
            <Link key={m.id} to={`/entdecken?m=${m.id}`} className="chip" title={m.hint}>
              {m.label}
            </Link>
          ))}
          <Link to="/gluecksrad" className="chip">
            Überrasch mich
          </Link>
        </div>
      </section>

      {usable ? (
        rows.loading ? (
          <section className="shelf-row">
            <h2>Heute für dich</h2>
            <SkeletonGrid count={6} compact />
          </section>
        ) : rows.data?.forYou.length ? (
          <BookRow
            title="Heute für dich"
            subtitle="Zu deinem Geschmack – abseits der grossen Bestseller, jeden Tag neu gemischt."
            items={rows.data.forYou}
            origin="Startseite"
            action={
              <Link to="/fuer-dich" className="btn btn-sm">
                Mehr →
              </Link>
            }
          />
        ) : null
      ) : null}

      {rows.loading ? (
        <section className="shelf-row">
          <h2>Entdeckungen</h2>
          <SkeletonGrid count={6} compact />
        </section>
      ) : (
        <>
          {rows.data?.discoveries.length ? (
            <BookRow
              title="Entdeckungen"
              subtitle="Gut bewertet, aber nicht überall zu sehen. Was du schon gesehen hast, macht Platz für Neues."
              items={rows.data.discoveries}
              origin="Startseite"
            />
          ) : null}
          {rows.data?.newest.length ? (
            <BookRow title="Neu und noch nicht überall" subtitle="Erschienen in den letzten Jahren, mit ersten Leser:innen." items={rows.data.newest} origin="Startseite" />
          ) : null}
        </>
      )}

      {wishItems.length > 0 && (
        <BookRow
          title="Deine Merkliste"
          items={wishItems}
          keepHidden
          action={
            <Link to="/bibliothek?tab=merkliste" className="btn btn-sm">
              Alle ansehen →
            </Link>
          }
        />
      )}

      {!usable && (
        <div className="notice mt-2">
          <div>
            <b>{entries.length ? 'Noch etwas mehr Futter für deinen Geschmack' : 'Persönliche Empfehlungen freischalten'}</b>
            <div className="small">
              {entries.length
                ? 'Deine Bibliothek wird gerade mit Themen angereichert oder enthält noch wenige Bücher. Bewerte ein paar Bücher oder blättere durch den Bücher-Stapel.'
                : 'Verbinde dein Goodreads-Profil oder lade den CSV-Export hoch – dann lernt der Lesekompass deinen Geschmack und blendet Gelesenes aus.'}
            </div>
            <div className="btn-row mt-1">
              <Link to="/bibliothek?tab=import" className="btn btn-sm btn-teal">
                Goodreads verbinden
              </Link>
              <Link to="/swipe" className="btn btn-sm">
                Bücher-Stapel
              </Link>
            </div>
          </div>
        </div>
      )}

      <section className="shelf-row">
        <h2>Mehr Wege zum nächsten Buch</h2>
        <div className="mode-grid">
          {MODES.map((m) => (
            <Link key={m.to} to={m.to} className="mode-tile">
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
