import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookRow } from '../components/BookCard';
import { Empty, SkeletonGrid } from '../components/Feedback';
import { useLibraryEntries, useProfile, useReadIndex } from '../lib/hooks';
import { isProfileUsable, topGenres } from '../lib/profile';
import { buildRecommendations, uniqueAcrossSections, type RecSection } from '../lib/recommend';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';

export default function ForYou() {
  const entries = useLibraryEntries();
  const profile = useProfile();
  const readIndex = useReadIndex();
  const language = useSettings((s) => s.language);
  const signals = useSignals((s) => s.signals);
  const [sections, setSections] = useState<RecSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  const usable = isProfileUsable(profile);
  const runKey = useRef('');

  useEffect(() => {
    if (!usable || !profile) return;
    const key = `${profile.itemCount}:${profile.signalCount}:${language}:${round}`;
    if (runKey.current === key) return;
    runKey.current = key;
    let cancelled = false;
    setSections([]);
    setLoading(true);
    const dismissed = new Set(signals.filter((s) => s.verdict === 'dislike').map((s) => s.bookId));
    buildRecommendations(entries, { profile, readIndex, language, dismissed }, (section) => {
      if (!cancelled) setSections((prev) => [...prev.filter((p) => p.id !== section.id), section]);
    }).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      runKey.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, profile?.itemCount, profile?.signalCount, language, round]);

  if (!usable || !profile) {
    return (
      <div>
        <div className="page-head">
          <p className="eyebrow">Für dich</p>
          <h1>Empfehlungen nach deinem Geschmack</h1>
        </div>
        <Empty title="Erzähl mir, was du gerne liest">
          <p>
            Für persönliche Empfehlungen braucht der Lesekompass ein paar Bücher, die du gelesen und bewertet hast – oder ein paar Runden Swipe.
            {entries.length > 0 && ' Deine Bibliothek wird gerade noch mit Themen angereichert.'}
          </p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <Link to="/bibliothek?tab=import" className="btn btn-primary">
              Goodreads verbinden
            </Link>
            <Link to="/swipe" className="btn">
              Swipe starten
            </Link>
          </div>
        </Empty>
      </div>
    );
  }

  const shown = uniqueAcrossSections(sections);
  const genres = topGenres(profile, 5);

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Für dich</p>
        <h1>Empfehlungen nach deinem Geschmack</h1>
        <p>
          Berechnet aus {profile.itemCount} Büchern in deiner Bibliothek{profile.signalCount ? ` und ${profile.signalCount} Swipe-Entscheidungen` : ''}. Jede
          Bewertung und jedes ✕ macht die Vorschläge treffsicherer.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row wrap between">
          <div>
            <div className="label">Dein Profil in Stichworten</div>
            <div className="chips mt-1">
              {genres.map((g) => (
                <span key={g.id} className="tag accent">
                  {g.emoji} {g.label}
                </span>
              ))}
              {profile.topConcepts.slice(0, 8).map((c) => (
                <span key={c.concept} className="tag gold">
                  {c.label}
                </span>
              ))}
            </div>
          </div>
          <div className="btn-row">
            <Link to="/bibliothek?tab=dna" className="btn btn-sm">
              Lese-DNA
            </Link>
            <button className="btn btn-sm btn-soft" onClick={() => setRound((r) => r + 1)} disabled={loading}>
              ↻ Neu mischen
            </button>
          </div>
        </div>
      </div>

      {shown.map((s) => (
        <BookRow key={s.id} title={s.title} subtitle={s.subtitle} items={s.items} origin="Für dich" />
      ))}
      {loading && (
        <section className="shelf-row">
          <div className="loading-line">
            <span className="spinner" /> Weitere Empfehlungen werden berechnet …
          </div>
          <SkeletonGrid count={6} compact />
        </section>
      )}
      {!loading && !shown.length && (
        <Empty title="Gerade keine Empfehlungen gefunden">
          <p>Open Library ist vielleicht überlastet. Versuch es gleich nochmal.</p>
          <button className="btn" onClick={() => setRound((r) => r + 1)}>
            Nochmal versuchen
          </button>
        </Empty>
      )}
    </div>
  );
}
