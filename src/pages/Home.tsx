import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookRow } from '../components/BookCard';
import { SkeletonGrid } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { useAsync, useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { docToBook, searchWorks } from '../lib/openLibrary';
import { isProfileUsable } from '../lib/profile';
import { scoreForProfile } from '../lib/recommend';
import { MOODS } from '../lib/taxonomy';
import { solrPhrase } from '../lib/text';
import { useSettings } from '../store/settings';
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
  { to: '/swipe', title: 'Bücher-Swipe', text: 'Wischen – der Stapel lernt deinen Geschmack.' },
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

  const popular = useAsync(
    async (signal) => {
      const res = await searchWorks('language:ger first_publish_year:[2015 TO *]', { sort: 'trending', limit: 24, lang: 'de', signal });
      return res.docs.map((d) => docToBook(d)).filter((b) => !readIndex.has(b));
    },
    [],
  );

  const forYou = useAsync(
    async (signal) => {
      if (!usable || !profile) return [];
      const subjects = profile.querySubjects.slice(0, 5);
      const lang = language === 'any' ? '' : ' language:ger';
      const res = await searchWorks(`subject:(${subjects.map(solrPhrase).join(' OR ')})${lang}`, { sort: 'rating', limit: 40, lang: 'de', signal });
      return res.docs
        .map((d) => scoreForProfile(docToBook(d), { profile, readIndex, language }))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .sort((a, b) => b.score - a.score)
        .slice(0, 16);
    },
    [usable, profile?.querySubjects.join('|')],
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

      <div className="mode-grid">
        {MODES.map((m) => (
          <Link key={m.to} to={m.to} className="mode-tile">
            <h3>{m.title}</h3>
            <p>{m.text}</p>
          </Link>
        ))}
      </div>

      {usable ? (
        forYou.loading ? (
          <section className="shelf-row">
            <h2>Heute für dich</h2>
            <SkeletonGrid count={6} compact />
          </section>
        ) : forYou.data?.length ? (
          <BookRow
            title="Heute für dich"
            subtitle="Passend zu deinem Geschmacksprofil – mehr unter „Für dich“."
            items={forYou.data}
            origin="Startseite"
            action={
              <Link to="/fuer-dich" className="btn btn-sm">
                Alle Empfehlungen →
              </Link>
            }
          />
        ) : null
      ) : (
        <div className="notice mt-2">
          <div>
            <b>{entries.length ? 'Noch etwas mehr Futter für deinen Geschmack' : 'Persönliche Empfehlungen freischalten'}</b>
            <div className="small">
              {entries.length
                ? 'Deine Bibliothek wird gerade mit Themen angereichert oder enthält noch wenige Bücher. Bewerte ein paar Bücher oder spiel eine Runde Swipe.'
                : 'Verbinde dein Goodreads-Profil oder lade den CSV-Export hoch – dann lernt der Lesekompass deinen Geschmack und blendet Gelesenes aus.'}
            </div>
            <div className="btn-row mt-1">
              <Link to="/bibliothek?tab=import" className="btn btn-sm btn-teal">
                Goodreads verbinden
              </Link>
              <Link to="/swipe" className="btn btn-sm">
                Swipe starten
              </Link>
            </div>
          </div>
        </div>
      )}

      {wishItems.length > 0 && (
        <BookRow
          title="Deine Merkliste"
          items={wishItems}
          action={
            <Link to="/bibliothek?tab=merkliste" className="btn btn-sm">
              Alle ansehen →
            </Link>
          }
        />
      )}

      {popular.loading ? (
        <section className="shelf-row">
          <h2>Gerade gefragt – auf Deutsch</h2>
          <SkeletonGrid count={6} compact />
        </section>
      ) : popular.data?.length ? (
        <BookRow title="Gerade gefragt – auf Deutsch" subtitle="Was Leser:innen auf Open Library diese Tage auf ihre Listen setzen." items={popular.data} origin="Startseite" />
      ) : null}
    </div>
  );
}
