import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CompassMark } from './components/CompassMark';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading, Toasts } from './components/Feedback';
import { Onboarding } from './components/Onboarding';
import { RatingDialog } from './components/RatingDialog';
import { AppFooter, UpdateBanner } from './components/UpdateBanner';
import { useSettings } from './store/settings';
import { startSync } from './store/sync';
import { useWishlist } from './store/wishlist';
import Home from './pages/Home';

const Discover = lazy(() => import('./pages/Discover'));
const BookDetail = lazy(() => import('./pages/BookDetail'));
const ForYou = lazy(() => import('./pages/ForYou'));
const Swipe = lazy(() => import('./pages/Swipe'));
const Wheel = lazy(() => import('./pages/Wheel'));
const Oracle = lazy(() => import('./pages/Oracle'));
const Explore = lazy(() => import('./pages/Explore'));
const Librarian = lazy(() => import('./pages/Librarian'));
const Library = lazy(() => import('./pages/Library'));
const Settings = lazy(() => import('./pages/Settings'));

const NAV = [
  { to: '/entdecken', label: 'Entdecken', icon: '🔎' },
  { to: '/fuer-dich', label: 'Für dich', icon: '💛' },
];

const PLAY = [
  { to: '/swipe', label: 'Bücher-Swipe', icon: '🃏', hint: 'Wischen & Geschmack lernen' },
  { to: '/gluecksrad', label: 'Glücksrad & Blind Date', icon: '🎡', hint: 'Zufall mit Stil' },
  { to: '/orakel', label: 'Lese-Orakel', icon: '🔮', hint: '7 Fragen, 1 Lesestimmung' },
  { to: '/themen', label: 'Themen-Netz', icon: '🕸️', hint: 'Von Thema zu Thema springen' },
];

const NAV_END = [
  { to: '/bibliothekar', label: 'KI-Bibliothekar', icon: '✨' },
  { to: '/bibliothek', label: 'Bibliothek', icon: '📚' },
];

function PlayMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const active = PLAY.some((p) => pathname.startsWith(p.to));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={active ? 'active-btn' : ''} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <span aria-hidden="true">🎲</span> Spielen <span aria-hidden="true" style={{ fontSize: '0.7em' }}>▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {PLAY.map((p) => (
            <NavLink key={p.to} to={p.to} role="menuitem" className="menu-item">
              <span className="menu-icon" aria-hidden="true">
                {p.icon}
              </span>
              <span>
                <b>{p.label}</b>
                <span className="muted small" style={{ display: 'block' }}>
                  {p.hint}
                </span>
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

const BOTTOM_NAV = [
  { to: '/', label: 'Start', icon: '🧭', end: true },
  { to: '/entdecken', label: 'Entdecken', icon: '🔎' },
  { to: '/fuer-dich', label: 'Für dich', icon: '💛' },
  { to: '/swipe', label: 'Swipe', icon: '🃏' },
  { to: '/bibliothek', label: 'Bibliothek', icon: '📚' },
];

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0 }), [pathname]);
  return null;
}

export default function App() {
  useTheme();
  useEffect(() => startSync(), []);
  const location = useLocation();
  const wishCount = useWishlist((s) => Object.keys(s.items).length);
  const theme = useSettings((s) => s.theme);
  const setSettings = useSettings((s) => s.set);
  const nextTheme = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';

  return (
    <div className="app">
      <ScrollToTop />
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="brand" aria-label="Lesekompass – Startseite">
            <CompassMark />
            <span>Lesekompass</span>
          </NavLink>
          <nav className="nav" aria-label="Hauptnavigation">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to}>
                <span aria-hidden="true">{n.icon}</span> {n.label}
              </NavLink>
            ))}
            <PlayMenu />
            {NAV_END.map((n) => (
              <NavLink key={n.to} to={n.to}>
                <span aria-hidden="true">{n.icon}</span> {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <NavLink to="/bibliothek?tab=merkliste" className="icon-btn" title="Merkliste" aria-label={`Merkliste (${wishCount})`}>
              ♥{wishCount > 0 && <span className="dot">{wishCount > 99 ? '99+' : wishCount}</span>}
            </NavLink>
            <button
              className="icon-btn"
              onClick={() => setSettings({ theme: nextTheme })}
              title={`Design: ${theme === 'auto' ? 'automatisch' : theme === 'dark' ? 'dunkel' : 'hell'}`}
              aria-label="Design wechseln"
            >
              {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌗'}
            </button>
            <NavLink to="/einstellungen" className="icon-btn" title="Einstellungen" aria-label="Einstellungen">
              ⚙️
            </NavLink>
          </div>
        </div>
      </header>

      <main className="main">
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<Loading text="Seite wird geladen …" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/entdecken" element={<Discover />} />
            <Route path="/buch/:id" element={<BookDetail />} />
            <Route path="/fuer-dich" element={<ForYou />} />
            <Route path="/swipe" element={<Swipe />} />
            <Route path="/gluecksrad" element={<Wheel />} />
            <Route path="/orakel" element={<Oracle />} />
            <Route path="/themen" element={<Explore />} />
            <Route path="/bibliothekar" element={<Librarian />} />
            <Route path="/bibliothek" element={<Library />} />
            <Route path="/einstellungen" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <AppFooter />

      <nav className="bottom-nav" aria-label="Navigation">
        {BOTTOM_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <span aria-hidden="true">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <UpdateBanner />
      <RatingDialog />
      <Onboarding />
      <Toasts />
    </div>
  );
}
