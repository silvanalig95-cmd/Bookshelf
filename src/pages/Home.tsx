import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookRow } from '../components/BookCard';
import { SkeletonGrid } from '../components/Feedback';
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
  { to: '/entdecken', icon: '🔎', title: 'Ausführliche Suche', text: 'Genres, Stimmungen, Orte, Epochen, Tempo, Länge – und dein Wunsch in eigenen Worten.', color: 'var(--accent-soft)' },
  { to: '/fuer-dich', icon: '💛', title: 'Für dich', text: 'Algorithmische Empfehlungen aus deinen gelesenen Büchern und Bewertungen.', color: 'var(--gold-soft)' },
  { to: '/swipe', icon: '🃏', title: 'Bücher-Swipe', text: 'Wisch dich durch Bücher – der Stapel lernt mit jedem Wisch deinen Geschmack.', color: 'var(--rose-soft)' },
  { to: '/gluecksrad', icon: '🎡', title: 'Glücksrad & Blind Date', text: 'Dreh am Rad und lerne Bücher erst über ihren ersten Satz kennen.', color: 'var(--violet-soft)' },
  { to: '/orakel', icon: '🔮', title: 'Lese-Orakel', text: 'Sieben verspielte Fragen – und das Orakel weiss, was du heute lesen willst.', color: 'var(--teal-soft)' },
  { to: '/themen', icon: '🕸️', title: 'Themen-Netz', text: 'Von Thema zu Thema springen und im Kaninchenbau neue Welten finden.', color: 'var(--gold-soft)' },
  { to: '/bibliothekar', icon: '✨', title: 'KI-Bibliothekar', text: 'Erzähl, worauf du Lust hast – Claude kennt deine Bücher und empfiehlt passend.', color: 'var(--violet-soft)' },
  { to: '/bibliothek', icon: '📚', title: 'Bibliothek & Lese-DNA', text: 'Goodreads verbinden, Merkliste pflegen und deine Lesestatistik entdecken.', color: 'var(--teal-soft)' },
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
        <p className="eyebrow">Dein Kompass durch die Bücherwelt</p>
        <h1>
          Finde dein nächstes <em>Lieblingsbuch</em>.
        </h1>
        <p className="lead">
          Beschreib in eigenen Worten, worauf du Lust hast – oder spiel mit Stimmungen, Orten und Epochen. Deutsche Ausgaben zuerst, alle Angebote auf einen
          Blick.
        </p>
        <form className="big-search" onSubmit={submit} role="search">
          <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>
            🔎
          </span>
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
          {MOODS.slice(0, 9).map((m) => (
            <Link key={m.id} to={`/entdecken?m=${m.id}`} className="chip" title={m.hint}>
              {m.emoji} {m.label}
            </Link>
          ))}
          <Link to="/gluecksrad" className="chip">
            🎲 Überrasch mich
          </Link>
        </div>
      </section>

      <div className="mode-grid">
        {MODES.map((m) => (
          <Link key={m.to} to={m.to} className="mode-tile" style={{ '--tile-color': m.color } as React.CSSProperties}>
            <span className="mt-icon">{m.icon}</span>
            <h3>{m.title}</h3>
            <p>{m.text}</p>
          </Link>
        ))}
      </div>

      {usable ? (
        forYou.loading ? (
          <section className="shelf-row">
            <h2>💛 Heute für dich</h2>
            <SkeletonGrid count={6} compact />
          </section>
        ) : forYou.data?.length ? (
          <BookRow
            title="Heute für dich"
            icon="💛"
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
        <div className="notice teal mt-2">
          <span className="notice-icon">📚</span>
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
          icon="♥"
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
          <h2>🔥 Gerade gefragt – auf Deutsch</h2>
          <SkeletonGrid count={6} compact />
        </section>
      ) : popular.data?.length ? (
        <BookRow title="Gerade gefragt – auf Deutsch" icon="🔥" subtitle="Was Leser:innen auf Open Library diese Tage auf ihre Listen setzen." items={popular.data} origin="Startseite" />
      ) : null}
    </div>
  );
}
