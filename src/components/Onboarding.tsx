import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CompassMark } from './CompassMark';
import type { LanguagePreference, Region } from '../lib/types';
import { useSettings } from '../store/settings';
import { Modal } from './Modal';

const REGIONS: Array<{ id: Region; label: string }> = [
  { id: 'CH', label: '🇨🇭 Schweiz' },
  { id: 'DE', label: '🇩🇪 Deutschland' },
  { id: 'AT', label: '🇦🇹 Österreich' },
];

const LANGS: Array<{ id: LanguagePreference; label: string; hint: string }> = [
  { id: 'de-first', label: 'Deutsch bevorzugt', hint: 'Deutsche Ausgaben zuerst, sonst Englisch/Original' },
  { id: 'de-only', label: 'Nur Deutsch', hint: 'Nur Bücher mit deutscher Ausgabe' },
  { id: 'any', label: 'Egal', hint: 'Alle Sprachen gleichwertig' },
];

export function Onboarding() {
  const s = useSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  if (s.onboarded) return null;
  const finish = (goImport: boolean) => {
    s.set({ onboarded: true });
    if (goImport) navigate('/bibliothek?tab=import');
  };

  return (
    <Modal open onClose={() => finish(false)} label="Willkommen beim Lesekompass">
      {step === 0 ? (
        <div className="stack">
          <div className="row">
            <CompassMark className="brand-mark" />
            <h2 className="mb-0">Willkommen beim Lesekompass</h2>
          </div>
          <p>
            Hier findest du Bücher über Stimmungen, Orte, Epochen und deine eigenen Worte – und siehst sofort alle Ausgaben, die besten Bezugsquellen und den
            Link zu Anna’s Archive.
          </p>
          <div className="field">
            <span className="label">Wo bestellst du Bücher?</span>
            <div className="segmented">
              {REGIONS.map((r) => (
                <button key={r.id} className={s.region === r.id ? 'on' : ''} onClick={() => s.set({ region: r.id })}>
                  {r.label}
                </button>
              ))}
            </div>
            <span className="help">Standard-Shop: Amazon.de{s.region === 'CH' ? ' mit Lieferung in die Schweiz' : ''} – änderbar in den Einstellungen.</span>
          </div>
          <div className="field">
            <span className="label">In welcher Sprache liest du?</span>
            <div className="stack" style={{ gap: 6 }}>
              {LANGS.map((l) => (
                <label key={l.id} className="toggle">
                  <input type="radio" name="lang" checked={s.language === l.id} onChange={() => s.set({ language: l.id })} />
                  <span>
                    <b>{l.label}</b> <span className="muted small">– {l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => setStep(1)}>
              Weiter →
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <h2 className="mb-0">Deine Goodreads-Bücher einbeziehen?</h2>
          <p>
            Mit deinen gelesenen Büchern und Bewertungen lernt der Lesekompass deinen Geschmack, blendet Gelesenes aus und macht persönliche Empfehlungen. Du
            kannst dein öffentliches Goodreads-Profil verbinden oder den CSV-Export hochladen.
          </p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => finish(false)}>
              Später
            </button>
            <button className="btn btn-primary" onClick={() => finish(true)}>
              📚 Goodreads verbinden
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
