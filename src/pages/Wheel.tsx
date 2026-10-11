import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { useProfile, useReadIndex } from '../lib/hooks';
import { docToBook, isbnCoverUrl, searchWorks } from '../lib/openLibrary';
import { isProfileUsable } from '../lib/profile';
import { displaySubjects, ERAS, GENRES, MOODS, PLACES } from '../lib/taxonomy';
import { shuffle, solrPhrase } from '../lib/text';
import type { Book } from '../lib/types';
import { useSettings } from '../store/settings';
import { useSignals } from '../store/signals';
import { rememberBook, toast } from '../store/ui';
import { useWishlist } from '../store/wishlist';

type WheelKind = 'genre' | 'mood' | 'place' | 'era' | 'mine';

interface Segment {
  id: string;
  label: string;
  emoji: string;
  /** Open-Library-Abfrageteil */
  clause: string;
}

const KINDS: Array<{ id: WheelKind; label: string }> = [
  { id: 'genre', label: 'Genres' },
  { id: 'mood', label: 'Stimmungen' },
  { id: 'place', label: 'Schauplätze' },
  { id: 'era', label: 'Epochen' },
  { id: 'mine', label: 'Meine Themen' },
];

const COLORS = ['#c2410c', '#0f766e', '#b7791f', '#6d28d9', '#be185d', '#1d4ed8', '#4d7c0f', '#9a3412', '#0e7490', '#7e22ce'];

const or = (field: string, terms: string[]) => `${field}:(${terms.map(solrPhrase).join(' OR ')})`;

function segmentsFor(kind: WheelKind, mine: string[]): Segment[] {
  switch (kind) {
    case 'genre':
      return shuffle(GENRES.filter((g) => g.group === 'fiction')).slice(0, 10).map((g) => ({ id: g.id, label: g.label, emoji: g.emoji, clause: or('subject', g.subjects.slice(0, 3)) }));
    case 'mood':
      return shuffle(MOODS).slice(0, 10).map((m) => ({ id: m.id, label: m.label, emoji: m.emoji, clause: or('subject', m.subjects) }));
    case 'place':
      return shuffle(PLACES).slice(0, 10).map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, clause: or('place', p.places) }));
    case 'era':
      return ERAS.map((e) => ({ id: e.id, label: e.label, emoji: e.emoji, clause: or('time', e.times) }));
    case 'mine':
      return shuffle(mine)
        .slice(0, 10)
        .map((s, i) => ({ id: `mine-${i}`, label: s.length > 22 ? `${s.slice(0, 20)}…` : s, emoji: '', clause: or('subject', [s]) }));
  }
}

function polar(cx: number, cy: number, r: number, angle: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export default function Wheel() {
  const language = useSettings((s) => s.language);
  const profile = useProfile();
  const readIndex = useReadIndex();
  const record = useSignals((s) => s.record);
  const toggleWish = useWishlist((s) => s.toggle);
  const wishItems = useWishlist((s) => s.items);
  const usable = isProfileUsable(profile);
  const [kind, setKind] = useState<WheelKind>('genre');
  const [seed, setSeed] = useState(0);
  const segments = useMemo(() => segmentsFor(kind, profile?.querySubjects ?? []), [kind, seed, profile?.querySubjects]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Segment | null>(null);
  const [dates, setDates] = useState<Book[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const n = segments.length;
  const slice = 360 / Math.max(1, n);

  const spin = () => {
    if (spinning || !n) return;
    const index = Math.floor(Math.random() * n);
    // Zeiger oben: Segment `index` soll unter 0° landen
    const target = 360 - (index * slice + slice / 2);
    const turns = 5 + Math.floor(Math.random() * 3);
    const next = rotation - (rotation % 360) + turns * 360 + target;
    setRotation(next);
    setSpinning(true);
    setWinner(null);
    setDates([]);
    setRevealed(new Set());
    setTimeout(() => {
      setSpinning(false);
      const w = segments[index];
      setWinner(w);
      loadDates(w);
    }, 4600);
  };

  const loadDates = async (seg: Segment) => {
    setLoading(true);
    const lang = language === 'any' ? '' : ' language:ger';
    try {
      const withSentence = await searchWorks(`${seg.clause}${lang} first_sentence:*`, { sort: 'random', limit: 30, lang: 'de' });
      let books = withSentence.docs.map((d) => docToBook(d));
      if (books.length < 3) {
        const any = await searchWorks(`${seg.clause}${lang}`, { sort: 'random', limit: 30, lang: 'de' });
        books = [...books, ...any.docs.map((d) => docToBook(d))];
      }
      const picks = shuffle(books.filter((b) => !readIndex.has(b) && (b.coverId || b.coverUrl))).slice(0, 3);
      picks.forEach(rememberBook);
      setDates(picks);
    } catch {
      toast('Open Library antwortet gerade nicht – nochmal drehen?');
    } finally {
      setLoading(false);
    }
  };

  const reveal = (b: Book) => setRevealed((r) => new Set(r).add(b.id));

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Spielen · Glücksrad & Blind Date</p>
        <h1>Dreh am Rad des Lesens</h1>
        <p>Das Rad wählt eine Richtung, dann lernst du drei Bücher kennen – zuerst nur über ihren ersten Satz und ein paar Hinweise. Wer neugierig macht, wird ausgepackt.</p>
      </div>

      <div className="row wrap" style={{ marginBottom: 18 }}>
        <div className="segmented">
          {KINDS.filter((k) => k.id !== 'mine' || usable).map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? 'on' : ''}
              onClick={() => {
                setKind(k.id);
                setWinner(null);
                setDates([]);
              }}
              disabled={spinning}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => setSeed((x) => x + 1)} disabled={spinning || kind === 'era'}>
          Andere Felder
        </button>
      </div>

      <div className="wheel-layout">
        <div className="wheel-wrap">
          <div className="wheel-pointer" aria-hidden="true" />
          <svg viewBox="0 0 400 400" className="wheel" style={{ transform: `rotate(${rotation}deg)` }} role="img" aria-label="Glücksrad">
            {segments.map((seg, i) => {
              const a0 = i * slice;
              const a1 = (i + 1) * slice;
              const p0 = polar(200, 200, 195, a0);
              const p1 = polar(200, 200, 195, a1);
              const large = slice > 180 ? 1 : 0;
              const mid = a0 + slice / 2;
              const lp = polar(200, 200, 125, mid);
              return (
                <g key={seg.id}>
                  <path d={`M200,200 L${p0.x},${p0.y} A195,195 0 ${large} 1 ${p1.x},${p1.y} Z`} fill={COLORS[i % COLORS.length]} stroke="var(--surface)" strokeWidth="2" />
                  <g transform={`translate(${lp.x},${lp.y}) rotate(${mid > 180 ? mid + 90 : mid - 90})`}>
                    <text textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={n > 9 ? 12 : 13} fontWeight="700" style={{ fontFamily: 'var(--font-sans)' }}>
                      {seg.emoji} {seg.label.length > 16 ? `${seg.label.slice(0, 15)}…` : seg.label}
                    </text>
                  </g>
                </g>
              );
            })}
            <circle cx="200" cy="200" r="34" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
          </svg>
          <button className="wheel-spin btn btn-primary" onClick={spin} disabled={spinning}>
            {spinning ? '…' : 'Drehen'}
          </button>
        </div>

        <div>
          {!winner && !spinning && (
            <div className="card center">
              <h3>Bereit?</h3>
              <p className="muted">Drück auf „Drehen“ – das Rad entscheidet, wohin die Reise geht.</p>
            </div>
          )}
          {spinning && (
            <div className="card center">
              <span className="spinner" />
              <h3>Das Rad dreht sich …</h3>
            </div>
          )}
          {winner && (
            <div className="stack">
              <div className="card center" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--gold-soft))', borderColor: 'transparent' }}>
                <p className="eyebrow">Das Rad hat entschieden</p>
                <h2 className="mb-0">
                  {winner.emoji} {winner.label}
                </h2>
              </div>
              {loading && <div className="loading-line">Drei Blind Dates werden vorbereitet …</div>}
              <div className="blind-dates">
                {dates.map((b, i) => {
                  const open = revealed.has(b.id);
                  const hints = displaySubjects(b.subjects, 3);
                  const isbn = b.isbns?.[0];
                  return (
                    <div key={b.id} className={`blind-date ${open ? 'open' : ''}`} style={{ animationDelay: `${i * 120}ms` }}>
                      {!open ? (
                        <div className="bd-front">
                          <div className="bd-ribbon">Blind Date #{i + 1}</div>
                          {b.firstSentence ? <blockquote className="bd-quote">„{b.firstSentence.length > 260 ? `${b.firstSentence.slice(0, 258)}…` : b.firstSentence}“</blockquote> : <p className="muted">Kein erster Satz bekannt – nur Hinweise:</p>}
                          <div className="chips">
                            {b.year && <span className="tag">{Math.floor(b.year / 10) * 10}er</span>}
                            {b.pages && <span className="tag">~{Math.round(b.pages / 50) * 50} S.</span>}
                            {b.places?.[0] && <span className="tag teal">{b.places[0]}</span>}
                            {hints.map((h) => (
                              <span key={h} className="tag gold">
                                {h}
                              </span>
                            ))}
                          </div>
                          <button className="btn btn-dark mt-2" onClick={() => reveal(b)}>
                            Auspacken
                          </button>
                        </div>
                      ) : (
                        <div className="bd-back">
                          <Link to={bookPath(b)} onClick={() => rememberBook(b)}>
                            <Cover title={b.title} author={b.authors[0]} coverId={b.coverId} src={b.coverUrl} fallbacks={isbn ? [isbnCoverUrl(isbn)] : []} style={{ width: 110 }} />
                          </Link>
                          <div>
                            <Link to={bookPath(b)} onClick={() => rememberBook(b)} style={{ color: 'var(--ink)' }}>
                              <h3 className="mb-0">{b.title}</h3>
                            </Link>
                            <div className="muted small">
                              {b.authors.slice(0, 2).join(', ')}
                              {b.year ? ` · ${b.year}` : ''}
                            </div>
                            <div className="btn-row mt-1">
                              <button
                                className={`btn btn-sm ${wishItems[b.id] ? 'btn-soft' : 'btn-primary'}`}
                                onClick={() => {
                                  const added = toggleWish(b, 'Glücksrad');
                                  if (added) record(b, 'save');
                                  toast(added ? '♥ Gemerkt' : 'Entfernt');
                                }}
                              >
                                {wishItems[b.id] ? '♥ Gemerkt' : '♡ Merken'}
                              </button>
                              <Link to={bookPath(b)} onClick={() => rememberBook(b)} className="btn btn-sm">
                                Angebote →
                              </Link>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!loading && dates.length > 0 && (
                <div className="btn-row">
                  <button className="btn" onClick={() => winner && loadDates(winner)}>
                    Drei neue Dates in „{winner.label}“
                  </button>
                  <button className="btn btn-ghost" onClick={spin}>
                    Nochmal drehen
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
