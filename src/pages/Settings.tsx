import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiAvailability, resetAiStatus, type AiVia } from '../lib/aiStatus';
import { localApiStatus } from '../lib/goodreads';
import { annasArchiveUrl, ANNAS_ARCHIVE_MIRRORS } from '../lib/shops';
import type { LanguagePreference, Region } from '../lib/types';
import { useSettings, type AiModel, type Theme } from '../store/settings';
import { toast } from '../store/ui';

const SHOPS: Record<Region, Array<{ id: string; label: string }>> = {
  CH: [
    { id: 'amazon-de', label: 'Amazon.de (Lieferung in die Schweiz)' },
    { id: 'orellfuessli', label: 'Orell Füssli' },
    { id: 'exlibris', label: 'Ex Libris' },
  ],
  DE: [
    { id: 'amazon-de', label: 'Amazon.de' },
    { id: 'thalia-de', label: 'Thalia' },
    { id: 'hugendubel', label: 'Hugendubel' },
  ],
  AT: [
    { id: 'amazon-de', label: 'Amazon.de' },
    { id: 'thalia-at', label: 'Thalia.at' },
  ],
};

const MODELS: Array<{ id: AiModel; label: string; hint: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Beste Empfehlungen (Standard) · ca. 5–15 Rappen pro Anfrage' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Schneller und günstiger · ca. 3–8 Rappen' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Am schnellsten und günstigsten · unter 1 Rappen' },
];

export default function Settings() {
  const s = useSettings();
  const [customAnnas, setCustomAnnas] = useState(ANNAS_ARCHIVE_MIRRORS.includes(s.annasBase) ? '' : s.annasBase);
  const [server, setServer] = useState<{ goodreads: boolean; ai: boolean }>();
  const [ai, setAi] = useState<{ available: boolean; via?: AiVia }>({ available: false });
  const [testState, setTestState] = useState<string>('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    localApiStatus().then(setServer);
  }, []);
  useEffect(() => {
    resetAiStatus();
    aiAvailability(s.aiApiKey).then(setAi);
  }, [s.aiApiKey]);
  useEffect(() => {
    if (window.location.hash.includes('#ki')) document.getElementById('ki')?.scrollIntoView();
  }, []);

  const testAi = async () => {
    if (!ai.available || !ai.via) return;
    setTestState('Teste …');
    try {
      const { aiRecommend } = await import('../lib/ai');
      const r = await aiRecommend('ein kurzer, heiterer Roman für einen Sonntag', { via: ai.via, key: s.aiApiKey, model: s.aiModel }, 'Keine Angaben.', { count: 1 });
      setTestState(`✅ Funktioniert! Testvorschlag: „${r.recommendations[0]?.title}“ von ${r.recommendations[0]?.author}`);
    } catch (err) {
      const { aiErrorMessage } = await import('../lib/ai');
      setTestState(`❌ ${aiErrorMessage(err)}`);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-head">
        <p className="eyebrow">Einstellungen</p>
        <h1>So, wie du liest</h1>
        <p>Alle Einstellungen und Schlüssel werden nur in diesem Browser gespeichert.</p>
      </div>

      <section className="card">
        <h3>🌍 Region, Shop & Sprache</h3>
        <div className="field">
          <span className="label">Wo bestellst du?</span>
          <div className="segmented">
            {(['CH', 'DE', 'AT'] as Region[]).map((r) => (
              <button
                key={r}
                className={s.region === r ? 'on' : ''}
                onClick={() => s.set({ region: r, preferredShop: SHOPS[r].some((x) => x.id === s.preferredShop) ? s.preferredShop : 'amazon-de' })}
              >
                {r === 'CH' ? '🇨🇭 Schweiz' : r === 'DE' ? '🇩🇪 Deutschland' : '🇦🇹 Österreich'}
              </button>
            ))}
          </div>
          <span className="help">Bestimmt Shops, Preisvergleich (eurobuch.ch/.de/.at), Bibliotheken und den Hinweis zur Buchpreisbindung.</span>
        </div>
        <div className="field">
          <label htmlFor="shop">Standard-Shop (wird überall zuerst und hervorgehoben gezeigt)</label>
          <select id="shop" className="select" value={s.preferredShop} onChange={(e) => s.set({ preferredShop: e.target.value })}>
            {SHOPS[s.region].map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Lesesprache</span>
          <div className="segmented">
            {(
              [
                ['de-first', 'Deutsch bevorzugt, sonst Englisch'],
                ['de-only', 'Nur Deutsch'],
                ['any', 'Alle Sprachen'],
              ] as Array<[LanguagePreference, string]>
            ).map(([id, label]) => (
              <button key={id} className={s.language === id ? 'on' : ''} onClick={() => s.set({ language: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field mb-0">
          <span className="label">Design</span>
          <div className="segmented">
            {(
              [
                ['auto', '🌗 Automatisch'],
                ['light', '☀️ Hell'],
                ['dark', '🌙 Dunkel'],
              ] as Array<[Theme, string]>
            ).map(([id, label]) => (
              <button key={id} className={s.theme === id ? 'on' : ''} onClick={() => s.set({ theme: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>🗄️ Anna’s Archive</h3>
        <p className="small">
          Die Adresse von Anna’s Archive wechselt immer wieder. Falls die Links nicht mehr gehen, wähle hier einen anderen Spiegel oder trage die aktuelle
          Adresse ein.
        </p>
        <div className="chips">
          {ANNAS_ARCHIVE_MIRRORS.map((m) => (
            <button
              key={m}
              className={`chip ${s.annasBase === m ? 'on' : ''}`}
              onClick={() => {
                s.set({ annasBase: m });
                setCustomAnnas('');
              }}
            >
              {m.replace('https://', '')}
            </button>
          ))}
        </div>
        <div className="input-group mt-1">
          <input className="input" placeholder="Eigene Adresse, z. B. https://annas-archive.xyz" value={customAnnas} onChange={(e) => setCustomAnnas(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              const v = customAnnas.trim().replace(/\/+$/, '');
              if (!/^https?:\/\/[^\s/]+$/.test(v)) {
                toast('Bitte eine Adresse wie https://annas-archive.xyz eingeben');
                return;
              }
              s.set({ annasBase: v });
              toast('Gespeichert');
            }}
          >
            Übernehmen
          </button>
        </div>
        <p className="small mt-1">
          Aktuell: <b>{s.annasBase}</b> ·{' '}
          <a href={annasArchiveUrl(s.annasBase, 'Der Schatten des Windes Zafón', 'de')} target="_blank" rel="noopener noreferrer">
            Testsuche öffnen ↗
          </a>
        </p>
      </section>

      <section className="card" id="ki">
        <h3>✨ KI-Empfehlungen mit Claude (optional)</h3>
        <p className="small">
          Für „KI fragen“ in der Suche und den KI-Bibliothekar. Claude versteht Wünsche wie „wie X, aber düsterer und in Island“ und kennt deine gelesenen Bücher.
          Du brauchst einen eigenen API-Schlüssel von{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
            console.anthropic.com ↗
          </a>{' '}
          (Abrechnung nach Verbrauch).
        </p>
        <div className={`notice ${ai.available ? 'teal' : ''}`} style={{ marginBottom: 14 }}>
          <span className="notice-icon">{ai.available ? '✅' : 'ℹ️'}</span>
          <span className="small">
            {server?.ai
              ? 'Der Server hat einen Claude-Schlüssel (ANTHROPIC_API_KEY) – er bleibt auf dem Server. Ein Browser-Schlüssel ist nicht nötig.'
              : ai.available
                ? 'Aktiv mit dem Schlüssel aus diesem Browser.'
                : 'Noch nicht aktiv. Am sichersten liegt der Schlüssel auf dem Server: bei Docker als ANTHROPIC_API_KEY (zusammen mit einem Login) in deploy/lesekompass.env, sonst in der Datei .env – danach neu starten. Alternativ hier eintragen (wird nur in diesem Browser gespeichert).'}
          </span>
        </div>
        {!server?.ai && (
          <div className="field">
            <label htmlFor="ai-key">Claude-API-Schlüssel (Browser)</label>
            <div className="input-group">
              <input
                id="ai-key"
                className="input"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                placeholder="sk-ant-…"
                value={s.aiApiKey}
                onChange={(e) => s.set({ aiApiKey: e.target.value.trim() })}
              />
              <button className="btn" onClick={() => setShowKey((x) => !x)}>
                {showKey ? 'Verbergen' : 'Zeigen'}
              </button>
            </div>
          </div>
        )}
        <div className="field">
          <span className="label">Modell</span>
          <div className="stack" style={{ gap: 6 }}>
            {MODELS.map((m) => (
              <label key={m.id} className="toggle">
                <input type="radio" name="model" checked={s.aiModel === m.id} onChange={() => s.set({ aiModel: m.id })} />
                <span>
                  <b>{m.label}</b> <span className="muted small">– {m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={testAi} disabled={!ai.available}>
            Verbindung testen
          </button>
          {testState && <span className="small">{testState}</span>}
        </div>
      </section>

      <section className="card">
        <h3>📗 Google Books (optional)</h3>
        <p className="small">
          Ergänzt deutsche Klappentexte, Live-E-Book-Preise von Google Play und Titel, die Open Library nicht kennt. Ohne eigenen Schlüssel ist das geteilte
          Gratis-Kontingent praktisch immer aufgebraucht – mit einem kostenlosen Schlüssel klappt es zuverlässig:{' '}
          <a href="https://console.cloud.google.com/apis/library/books.googleapis.com" target="_blank" rel="noopener noreferrer">
            Books API aktivieren ↗
          </a>
          , dann unter „Anmeldedaten“ einen API-Schlüssel erstellen.
        </p>
        <div className="field mb-0">
          <label htmlFor="gb-key">Google-Books-API-Schlüssel</label>
          <input id="gb-key" className="input" type="password" autoComplete="off" placeholder="AIza…" value={s.googleApiKey} onChange={(e) => s.set({ googleApiKey: e.target.value.trim() })} />
        </div>
      </section>

      <section className="card">
        <h3>🔌 Lokaler Server</h3>
        <p className="small mb-0">
          {server === undefined
            ? 'Prüfe …'
            : server.goodreads
              ? `✅ Läuft – Goodreads-Profil-Import ist verfügbar${server.ai ? ', ebenso der Claude-Schlüssel des Servers' : ''}. Version ${__VERSION__}, Build ${__BUILD__.slice(0, 7)}.`
              : 'Nicht erreichbar (statische Installation). Goodreads geht dann per CSV-Export, Claude per Browser-Schlüssel.'}
        </p>
      </section>

      <section className="card">
        <h3>📚 Datenquellen</h3>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            <b>Open Library</b> (Internet Archive): Suche, Werke, alle Ausgaben, Cover, Themen – frei und ohne Anmeldung.
          </li>
          <li>
            <b>Wikipedia</b>: deutschsprachige Zusammenfassungen auf den Buchseiten.
          </li>
          <li>
            <b>Goodreads</b>: deine Regale via öffentlichem RSS-Feed oder CSV-Export.
          </li>
          <li>
            <b>Google Books</b> (optional): Klappentexte und E-Book-Preise.
          </li>
          <li>
            <b>Claude</b> (optional): KI-Empfehlungen und der KI-Bibliothekar.
          </li>
        </ul>
        <p className="small mt-1 mb-0">
          Daten sichern oder umziehen: <Link to="/bibliothek?tab=import">Bibliothek → Goodreads & Daten</Link>
        </p>
      </section>
    </div>
  );
}
