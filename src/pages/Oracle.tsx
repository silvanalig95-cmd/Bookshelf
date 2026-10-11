import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookGrid } from '../components/BookCard';
import { SkeletonGrid } from '../components/Feedback';
import { DEFAULT_PARAMS, describeSearch, runDiscovery, type DiscoveryParams } from '../lib/discovery';
import { errorMessage, useProfile, useReadIndex } from '../lib/hooks';
import { isProfileUsable } from '../lib/profile';
import { uniq } from '../lib/text';
import type { ScoredBook } from '../lib/types';
import { useDiscover } from '../store/discover';
import { useSettings } from '../store/settings';

interface Answer {
  emoji: string;
  text: string;
  patch: Partial<DiscoveryParams>;
  /** Für die Lesepersönlichkeit */
  noun?: string;
  adjective?: string;
}

interface Question {
  q: string;
  answers: Answer[];
}

const QUESTIONS: Question[] = [
  {
    q: 'Wo wärst du heute Abend am liebsten?',
    answers: [
      { emoji: '🏔️', text: 'In einer Berghütte am knisternden Kamin', patch: { moods: ['ruhig', 'herzerwaermend'], tempo: -1 }, noun: 'Die Kaminfeuer-Seele' },
      { emoji: '🚀', text: 'Auf einem Raumschiff zwischen den Sternen', patch: { genres: ['scifi'] }, noun: 'Der Sternenstaub' },
      { emoji: '🌧️', text: 'In einer verregneten Gasse der Grossstadt', patch: { genres: ['krimi'], moods: ['duester'] }, noun: 'Die Regennacht' },
      { emoji: '🏰', text: 'In einem Schloss voller Geheimgänge', patch: { genres: ['fantasy', 'historisch'], moods: ['raetselhaft'] }, noun: 'Das Schlossgespenst' },
    ],
  },
  {
    q: 'Was steht neben dir auf dem Tisch?',
    answers: [
      { emoji: '☕', text: 'Ein doppelter Espresso', patch: { tempo: 2, moods: ['rasant'] } },
      { emoji: '🍷', text: 'Ein Glas Rotwein', patch: { moods: ['nachdenklich', 'romantisch'], depth: 1 } },
      { emoji: '🍫', text: 'Heisse Schokolade mit Sahne', patch: { moods: ['herzerwaermend', 'humorvoll'], depth: -1 } },
      { emoji: '🧪', text: 'Ein geheimnisvoll dampfender Trank', patch: { moods: ['magisch'], genres: ['mythen'] } },
    ],
  },
  {
    q: 'Wie viel Zeit schenkst du diesem Buch?',
    answers: [
      { emoji: '⏱️', text: 'Einen Abend', patch: { pagesMax: 220 } },
      { emoji: '🛋️', text: 'Ein gemütliches Wochenende', patch: { pagesMax: 380 } },
      { emoji: '🗓️', text: 'Ein paar Wochen', patch: { pagesMin: 300, pagesMax: 650 } },
      { emoji: '♾️', text: 'Ich will darin versinken', patch: { pagesMin: 500 } },
    ],
  },
  {
    q: 'Was soll das Buch mit dir machen?',
    answers: [
      { emoji: '😂', text: 'Mich zum Lachen bringen', patch: { moods: ['humorvoll'], genres: ['humor'] }, adjective: 'kichernde' },
      { emoji: '🥲', text: 'Mich zu Tränen rühren', patch: { moods: ['emotional'] }, adjective: 'zartfühlende' },
      { emoji: '😱', text: 'Mir Gänsehaut bereiten', patch: { moods: ['gruselig', 'spannend'] }, adjective: 'furchtlose' },
      { emoji: '🤯', text: 'Mein Weltbild durchrütteln', patch: { moods: ['nachdenklich', 'gesellschaftskritisch'], depth: 2 }, adjective: 'grübelnde' },
    ],
  },
  {
    q: 'Wann soll die Geschichte spielen?',
    answers: [
      { emoji: '🏺', text: 'Vor langer, langer Zeit', patch: { eras: ['antike', 'mittelalter', 'fruehe-neuzeit'] } },
      { emoji: '🎩', text: 'Vor 100 bis 200 Jahren', patch: { eras: ['19jh', 'weltkriege'] } },
      { emoji: '📱', text: 'Hier und heute', patch: { eras: ['gegenwart'], yearFrom: 1995 } },
      { emoji: '🛸', text: 'In der Zukunft', patch: { eras: ['zukunft'] } },
      { emoji: '🌀', text: 'Egal – Hauptsache gut', patch: {} },
    ],
  },
  {
    q: 'Bestseller oder Geheimtipp?',
    answers: [
      { emoji: '🔥', text: 'Das, worüber alle reden', patch: { fame: 2 } },
      { emoji: '💎', text: 'Ein verborgener Schatz', patch: { fame: -2 } },
      { emoji: '🎲', text: 'Überrasch mich', patch: {} },
    ],
  },
  {
    q: 'Wohin soll die Reise gehen?',
    answers: [
      { emoji: '🏡', text: 'Nach Europa', patch: { places: ['deutschland', 'schweiz', 'oesterreich', 'frankreich', 'italien', 'britannien', 'skandinavien'] } },
      { emoji: '🌏', text: 'Auf einen anderen Kontinent', patch: { places: ['ostasien', 'indien', 'lateinamerika', 'afrika', 'nahost', 'usa'] } },
      { emoji: '🌊', text: 'Ans Meer', patch: { places: ['meer'] } },
      { emoji: '🐉', text: 'In eine erfundene Welt', patch: { places: ['fantasiewelt'], genres: ['fantasy'] } },
      { emoji: '🧭', text: 'Egal, Hauptsache weg', patch: {} },
    ],
  },
];

function combine(answers: Answer[], base: DiscoveryParams): DiscoveryParams {
  const p: DiscoveryParams = { ...base };
  for (const a of answers) {
    const x = a.patch;
    if (x.genres) p.genres = uniq([...p.genres, ...x.genres]);
    if (x.moods) p.moods = uniq([...p.moods, ...x.moods]);
    if (x.eras) p.eras = uniq([...p.eras, ...x.eras]);
    if (x.places) p.places = uniq([...p.places, ...x.places]);
    if (x.tempo !== undefined) p.tempo = x.tempo;
    if (x.depth !== undefined) p.depth = x.depth;
    if (x.fame !== undefined) p.fame = x.fame;
    if (x.pagesMin !== undefined) p.pagesMin = x.pagesMin;
    if (x.pagesMax !== undefined) p.pagesMax = x.pagesMax;
    if (x.yearFrom !== undefined) p.yearFrom = x.yearFrom;
  }
  // Nicht zu viele Stimmungen auf einmal – die ersten drei zählen
  p.moods = p.moods.slice(0, 3);
  return p;
}

export default function Oracle() {
  const navigate = useNavigate();
  const language = useSettings((s) => s.language);
  const profile = useProfile();
  const readIndex = useReadIndex();
  const replaceParams = useDiscover((s) => s.replaceParams);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [results, setResults] = useState<ScoredBook[] | null>(null);
  const [error, setError] = useState('');
  const done = step >= QUESTIONS.length;
  const params = useMemo(() => combine(answers, { ...DEFAULT_PARAMS, language }), [answers, language]);

  const persona = useMemo(() => {
    const noun = answers.find((a) => a.noun)?.noun ?? 'Die Lesende Seele';
    const adjective = answers.find((a) => a.adjective)?.adjective;
    if (!adjective) return noun;
    const [article, ...rest] = noun.split(' ');
    return `${article} ${adjective} ${rest.join(' ')}`;
  }, [answers]);

  const choose = async (a: Answer) => {
    const next = [...answers, a];
    setAnswers(next);
    setStep(step + 1);
    if (step + 1 >= QUESTIONS.length) {
      setResults(null);
      setError('');
      try {
        const p = combine(next, { ...DEFAULT_PARAMS, language });
        const res = await runDiscovery(p, { profile: isProfileUsable(profile) ? profile : undefined, readIndex });
        setResults(res.results.slice(0, 18));
      } catch (err) {
        setError(errorMessage(err));
        setResults([]);
      }
    }
  };

  const restart = () => {
    setStep(0);
    setAnswers([]);
    setResults(null);
  };

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Spielen · Lese-Orakel</p>
        <h1>Das Orakel weiss, was du lesen willst</h1>
        <p>Sieben Fragen, kein Nachdenken – folge deinem Bauchgefühl.</p>
      </div>

      {!done ? (
        <div className="oracle card">
          <div className="row between">
            <span className="muted small">
              Frage {step + 1} von {QUESTIONS.length}
            </span>
            {step > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setStep(step - 1);
                  setAnswers(answers.slice(0, -1));
                }}
              >
                ← zurück
              </button>
            )}
          </div>
          <div className="progress mt-1">
            <div style={{ width: `${(step / QUESTIONS.length) * 100}%` }} />
          </div>
          <h2 key={step} className="oracle-q">
            {QUESTIONS[step].q}
          </h2>
          <div className="oracle-answers" key={`a-${step}`}>
            {QUESTIONS[step].answers.map((a, i) => (
              <button key={a.text} className="oracle-answer" onClick={() => choose(a)} style={{ animationDelay: `${i * 60}ms` }}>
                <span className="oa-emoji">{a.emoji}</span>
                <span>{a.text}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 20 }}>
          <div className="card center" style={{ background: 'linear-gradient(135deg, var(--violet-soft), var(--rose-soft))', borderColor: 'transparent' }}>
            <p className="eyebrow">Das Orakel hat gesprochen</p>
            <h2>{persona}</h2>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {describeSearch(params).map((d) => (
                <span key={d} className="tag accent">
                  {d}
                </span>
              ))}
            </div>
            <div className="btn-row mt-2" style={{ justifyContent: 'center' }}>
              <button
                className="btn btn-dark"
                onClick={() => {
                  replaceParams(params);
                  navigate('/entdecken');
                }}
              >
                In der Suche verfeinern
              </button>
              <button className="btn" onClick={restart}>
                Nochmal befragen
              </button>
            </div>
          </div>
          {error && <p style={{ color: 'var(--rose)' }}>{error}</p>}
          {results === null ? <SkeletonGrid count={8} /> : results.length ? <BookGrid items={results} origin="Lese-Orakel" /> : !error && <p className="muted center">Das Orakel schweigt – zu viele Wünsche auf einmal? Versuch es in der Suche mit weniger Kriterien.</p>}
        </div>
      )}
    </div>
  );
}
