import { useEffect, useState } from 'react';

/**
 * Fragt beim Server (/healthz) regelmässig nach, ob inzwischen eine neuere Version läuft –
 * z. B. weil der Docker-Container sich selbst aktualisiert hat – und bietet dann „Neu laden“ an.
 */
export function UpdateBanner() {
  const [next, setNext] = useState<string>();

  useEffect(() => {
    if (__BUILD__ === 'dev') return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch('./healthz', { cache: 'no-store' });
        if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
        const info = (await res.json()) as { app?: string; build?: string };
        if (!stopped && info.app === 'lesekompass' && info.build && info.build !== __BUILD__) setNext(info.build);
      } catch {
        /* offline oder statische Installation – egal */
      }
    };
    const timer = setInterval(check, 90_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    check();
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!next) return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ Eine neue Version des Lesekompass ist bereit.</span>
      <button className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
        Neu laden
      </button>
    </div>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      Lesekompass {__VERSION__} · Build {__BUILD__.slice(0, 7)} · Daten: Open Library, Wikipedia, Goodreads
    </footer>
  );
}
