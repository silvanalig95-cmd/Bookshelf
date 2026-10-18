import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CompatProvider } from '../lib/aiPrompts';
import { AI_MODEL_NAMES, aiAvailability, aiConfigFor, COMPAT_ORDER, providerName, resetAiStatus, type AiAccess, type AiChannel } from '../lib/aiStatus';
import { COMPAT } from '../lib/openaiCompat';
import { localApiStatus, type LocalApiStatus } from '../lib/goodreads';
import { annasArchiveUrl, ANNAS_ARCHIVE_MIRRORS } from '../lib/shops';
import type { LanguagePreference, Region } from '../lib/types';
import { useSettings, type AiModel, type AiProvider, type GeminiModel, type Theme } from '../store/settings';
import { pullEverything, runSync, setSyncEnabled, useSync } from '../store/sync';
import { loadKnowledge, useKnowledge } from '../store/knowledge';
import { useNightShift } from '../store/nightShift';
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

const PROVIDERS: Array<{ id: AiProvider; label: string }> = [
  { id: 'gemini', label: 'Google Gemini (gratis)' },
  { id: 'claude', label: 'Claude (Anthropic)' },
];

const GEMINI_CHOICES: Array<{ id: GeminiModel; label: string; hint: string }> = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'Beste Empfehlungen (Standard)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', hint: 'Fast so gut, eigenes Kontingent' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'Schneller, mit grösserem Gratis-Kontingent' },
];

const MODELS: Array<{ id: AiModel; label: string; hint: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Beste Empfehlungen (Standard) · ca. 5–15 Rappen pro Anfrage' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Schneller und günstiger · ca. 3–8 Rappen' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Am schnellsten und günstigsten · unter 1 Rappen' },
];

export default function Settings() {
  const s = useSettings();
  const [customAnnas, setCustomAnnas] = useState(ANNAS_ARCHIVE_MIRRORS.includes(s.annasBase) ? '' : s.annasBase);
  const [server, setServer] = useState<LocalApiStatus>();
  const syncPhase = useSync((x) => x.phase);
  const syncing = syncPhase !== 'unavailable' && syncPhase !== 'off' && syncPhase !== 'checking';
  const [ai, setAi] = useState<AiAccess>({ available: false });
  const [testState, setTestState] = useState<string>('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    localApiStatus().then(setServer);
  }, []);
  useEffect(() => {
    resetAiStatus();
    aiAvailability(s).then(setAi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.aiProvider, s.aiApiKey, s.geminiApiKey, s.fallbackChannels, s.mistralApiKey, s.groqApiKey, s.openrouterApiKey]);
  useEffect(() => {
    for (const id of ['ki', 'abgleich']) if (window.location.hash.includes(`#${id}`)) document.getElementById(id)?.scrollIntoView();
  }, []);

  const backups = (ai.channels ?? []).slice(1).map((c) => providerName(c.provider));
  const aiStatusText = !ai.available
    ? s.aiProvider === 'gemini'
      ? 'Noch nicht aktiv. Am sichersten liegt der Schlüssel auf dem Server: bei Docker als GEMINI_API_KEY (zusammen mit einem Login) in deploy/lesekompass.env. Oder unten im Browser eintragen.'
      : 'Noch nicht aktiv. Am sichersten liegt der Schlüssel auf dem Server: bei Docker als ANTHROPIC_API_KEY (zusammen mit einem Login) in deploy/lesekompass.env. Oder unten im Browser eintragen.'
    : `Aktiv: ${AI_MODEL_NAMES[aiConfigFor(ai, s)?.model ?? ''] ?? providerName(ai.provider!)} – ${ai.via === 'server' ? 'mit dem Schlüssel des Servers (bleibt dort)' : 'mit dem Schlüssel aus diesem Browser'}.${
        ai.provider !== s.aiProvider ? ` Für ${providerName(s.aiProvider)} fehlt noch ein Schlüssel, darum antwortet ${providerName(ai.provider!)}.` : ''
      }${backups.length ? ` Springt ein, wenn das Kontingent aufgebraucht ist: ${backups.join(', ')}.` : ''}`;

  const testAi = async () => {
    const config = aiConfigFor(ai, s);
    if (!config) return;
    setTestState('Teste …');
    try {
      const { aiRecommend } = await import('../lib/ai');
      const r = await aiRecommend('ein kurzer, heiterer Roman für einen Sonntag', config, 'Keine Angaben.', { count: 1 });
      setTestState(`Funktioniert! Testvorschlag: „${r.recommendations[0]?.title}“ von ${r.recommendations[0]?.author}${r.note ? ` (${r.note})` : ''}`);
    } catch (err) {
      const { aiErrorMessage } = await import('../lib/ai');
      setTestState(`Fehler: ${aiErrorMessage(err)}`);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-head">
        <p className="eyebrow">Einstellungen</p>
        <h1>So, wie du liest</h1>
        <p>
          {syncing
            ? 'Region, Shop, Sprache, Anna’s Archive und KI-Modell gelten auf allen deinen Geräten. Schlüssel und Design bleiben in diesem Browser.'
            : 'Alle Einstellungen und Schlüssel werden nur in diesem Browser gespeichert.'}
        </p>
      </div>

      <section className="card">
        <h3>Region, Shop & Sprache</h3>
        <div className="field">
          <span className="label">Wo bestellst du?</span>
          <div className="segmented">
            {(['CH', 'DE', 'AT'] as Region[]).map((r) => (
              <button
                key={r}
                className={s.region === r ? 'on' : ''}
                onClick={() => s.set({ region: r, preferredShop: SHOPS[r].some((x) => x.id === s.preferredShop) ? s.preferredShop : 'amazon-de' })}
              >
                {r === 'CH' ? 'Schweiz' : r === 'DE' ? 'Deutschland' : 'Österreich'}
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
                ['auto', 'Automatisch'],
                ['light', 'Hell'],
                ['dark', 'Dunkel'],
              ] as Array<[Theme, string]>
            ).map(([id, label]) => (
              <button key={id} className={s.theme === id ? 'on' : ''} onClick={() => s.set({ theme: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <SyncCard />

      <section className="card">
        <h3>Anna’s Archive</h3>
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
        <h3>KI-Empfehlungen (optional)</h3>
        <p className="small">
          Für „KI fragen“ in der Suche und den KI-Bibliothekar. Die KI versteht Wünsche wie „wie X, aber düsterer und in Island“ und kennt deine gelesenen
          Bücher.
        </p>
        <div className="field">
          <span className="label">Anbieter</span>
          <div className="segmented">
            {PROVIDERS.map((p) => (
              <button key={p.id} className={s.aiProvider === p.id ? 'on' : ''} onClick={() => s.set({ aiProvider: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className={`notice ${ai.available ? 'teal' : ''}`} style={{ marginBottom: 14 }}>
          <span className="small">{aiStatusText}</span>
        </div>

        {s.aiProvider === 'gemini' ? (
          <>
            <p className="small">
              {!server?.gemini && (
                <>
                  <b>Gratis-Schlüssel in zwei Minuten:</b> auf{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                    aistudio.google.com/apikey ↗
                  </a>{' '}
                  mit dem Google-Konto anmelden, „API-Schlüssel erstellen“ und den Schlüssel hier einfügen.{' '}
                </>
              )}
              Der Gratis-Tarif hat Minuten- und Tageslimits (
              <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noopener noreferrer">
                deine Limits ↗
              </a>
              ). Gut zu wissen: Im Gratis-Tarif darf Google die Anfragen – also auch deine Leseliste – zur Verbesserung seiner Produkte verwenden.
            </p>
            {!server?.gemini && (
              <div className="field">
                <label htmlFor="gemini-key">Gemini-API-Schlüssel (Browser)</label>
                <div className="input-group">
                  <input
                    id="gemini-key"
                    className="input"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="AIza… oder AQ.…"
                    value={s.geminiApiKey}
                    onChange={(e) => s.set({ geminiApiKey: e.target.value.trim() })}
                  />
                  <button className="btn" onClick={() => setShowKey((x) => !x)}>
                    {showKey ? 'Verbergen' : 'Zeigen'}
                  </button>
                </div>
                <span className="help">Wird nur in diesem Browser gespeichert. Für alle Geräte auf einmal: GEMINI_API_KEY auf dem Server (siehe deploy/DOCKER.md).</span>
              </div>
            )}
            <div className="field">
              <span className="label">Modell</span>
              <div className="stack" style={{ gap: 6 }}>
                {GEMINI_CHOICES.map((m) => (
                  <label key={m.id} className="toggle">
                    <input type="radio" name="gemini-model" checked={s.geminiModel === m.id} onChange={() => s.set({ geminiModel: m.id })} />
                    <span>
                      <b>{m.label}</b> <span className="muted small">– {m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="small">
              Du brauchst einen eigenen API-Schlüssel von{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                console.anthropic.com ↗
              </a>{' '}
              (Abrechnung nach Verbrauch).
            </p>
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
                <span className="help">Wird nur in diesem Browser gespeichert. Für alle Geräte auf einmal: ANTHROPIC_API_KEY auf dem Server (siehe deploy/DOCKER.md).</span>
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
          </>
        )}
        <FallbackChannels server={server} channels={ai.channels ?? []} />
        <div className="mt-2">
          <div className="divider" />
          <label className="toggle">
            <input type="checkbox" checked={s.autoBlurb} onChange={(e) => s.set({ autoBlurb: e.target.checked })} />
            <b>Kurzbeschreibungen von selbst schreiben</b>
          </label>
          <p className="small muted mt-1">
            Öffnest du ein Buch oder liegt es oben im Bücher-Stapel und es gibt keinen gehaltvollen deutschen Text (Wikipedia, deutscher Klappentext), schreibt die
            KI eine Kurzbeschreibung. Das ist eine Anfrage mit rund 1000–2000 Wörtern Material und 200 Wörtern Antwort: im Gratis-Kontingent kostenlos (zählt als
            eine von den Tagesanfragen), bezahlt wären es etwa 0,1 Rappen. Jede Beschreibung wird gemerkt und nie zweimal erzeugt.
          </p>
        </div>
        <NightShiftSettings />
        <KnowledgeSettings />
        <div className="btn-row">
          <button className="btn" onClick={testAi} disabled={!ai.available}>
            Verbindung testen
          </button>
          {testState && <span className="small">{testState}</span>}
        </div>
      </section>

      <section className="card">
        <h3>Google Books (optional)</h3>
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
        <h3>Lokaler Server</h3>
        <p className="small mb-0">
          {server === undefined
            ? 'Prüfe …'
            : server.goodreads
              ? `Läuft – Goodreads-Profil-Import ist verfügbar${server.gemini ? ', ebenso der Gemini-Schlüssel des Servers' : ''}${server.ai ? ', der Claude-Schlüssel des Servers' : ''}${server.sync ? ' und der Geräte-Abgleich' : ''}. Version ${__VERSION__}, Build ${__BUILD__.slice(0, 7)}.`
              : 'Nicht erreichbar (statische Installation). Goodreads geht dann per CSV-Export, Claude per Browser-Schlüssel.'}
        </p>
      </section>

      <section className="card">
        <h3>Datenquellen</h3>
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

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86_400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(ts).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
}

function SyncCard() {
  const sync = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (sync.phase === 'checking') return null;
  if (sync.phase === 'unavailable') {
    return (
      <section className="card" id="abgleich">
        <h3>Geräte abgleichen</h3>
        <p className="small mb-0">
          Auf dieser Installation nicht verfügbar – Bibliothek und Merkliste bleiben in diesem Browser. Mit dem Docker-Server (siehe <code>deploy/DOCKER.md</code>)
          haben alle deine Geräte automatisch denselben Stand.
        </p>
      </section>
    );
  }

  const on = sync.phase !== 'off';
  const who = sync.user ? (
    <>
      für <b>{sync.user}</b>
    </>
  ) : (
    'ohne Login – alle Geräte im Netz teilen sich eine Bibliothek'
  );
  const c = sync.counts;
  const status =
    sync.phase === 'off'
      ? { tone: '', text: <>Auf diesem Gerät ausgeschaltet. Änderungen bleiben hier und werden beim Einschalten nachgereicht.</> }
      : sync.phase === 'offline'
        ? {
            tone: 'rose',
            text: (
              <>
                Server gerade nicht erreichbar.{' '}
                {sync.pending ? `${sync.pending} Änderung${sync.pending === 1 ? '' : 'en'} werden übertragen, sobald er wieder da ist.` : 'Es geht nichts verloren.'}
              </>
            ),
          }
        : sync.phase === 'error'
          ? { tone: 'rose', text: <>Abgleich gestört: {sync.error}</> }
          : {
              tone: 'teal',
              text: (
                <>
                  Aktiv {who}
                  {sync.lastSync ? ` · zuletzt ${ago(sync.lastSync)}` : ''}.
                </>
              ),
            };

  return (
    <section className="card" id="abgleich">
      <h3>Geräte abgleichen</h3>
      <p className="small">
        Bibliothek, Bewertungen, Merkliste, Stapel-Geschmack und die Einstellungen oben sind auf allen Geräten gleich, die diesen Lesekompass öffnen – auf dem
        Handy gemerkt, am PC gefunden. Änderungen gehen sofort raus; offline Gemachtes wird nachgereicht.
      </p>
      <div className={`notice ${status.tone}`} style={{ marginBottom: 12 }}>
        <span className="small">{status.text}</span>
      </div>
      {c && on && (
        <p className="small muted">
          Auf dem Server: {c.library} {c.library === 1 ? 'Buch' : 'Bücher'} · {c.wishlist} auf der Merkliste · {c.owned ?? 0} im Besitz · {c.signals} Stapel-Entscheidung{c.signals === 1 ? '' : 'en'}
        </p>
      )}
      <label className="toggle" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={on} onChange={(e) => setSyncEnabled(e.target.checked)} />
        <span>Dieses Gerät abgleichen</span>
      </label>
      {on && (
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => void runSync()} disabled={sync.phase === 'syncing'}>
            ↻ Jetzt abgleichen
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              pullEverything();
              toast('Hole alles vom Server …');
            }}
            disabled={sync.phase === 'syncing'}
          >
            Alles neu vom Server holen
          </button>
        </div>
      )}
    </section>
  );
}

/** Gratis-Ausweich-Kanäle für den Fall, dass das Kontingent des Hauptanbieters aufgebraucht ist. */
function FallbackChannels({ server, channels }: { server?: LocalApiStatus; channels: AiChannel[] }) {
  const s = useSettings();
  const [results, setResults] = useState<Record<string, string>>({});
  const keyField = { mistral: 'mistralApiKey', groq: 'groqApiKey', openrouter: 'openrouterApiKey' } as const;
  const modelField = { mistral: 'mistralModel', groq: 'groqModel', openrouter: 'openrouterModel' } as const;

  const testOne = async (provider: CompatProvider) => {
    const channel = channels.find((c) => c.provider === provider);
    if (!channel) return;
    setResults((r) => ({ ...r, [provider]: 'Teste …' }));
    const { aiErrorMessage, aiText } = await import('../lib/ai');
    const config = { provider, via: channel.via, key: s[keyField[provider]], model: s[modelField[provider]], relay: Boolean(server?.goodreads) };
    try {
      const reply = await aiText(config, ['Antworte knapp auf Deutsch.'], 'Nenne in einem Satz einen bekannten deutschsprachigen Roman.', () => {}, { light: true });
      setResults((r) => ({ ...r, [provider]: `Funktioniert (${reply.model}): ${reply.text.slice(0, 120)}` }));
    } catch (err) {
      setResults((r) => ({ ...r, [provider]: `Fehler: ${aiErrorMessage(err)}` }));
    }
  };

  return (
    <div className="mt-2">
      <div className="divider" />
      <label className="toggle">
        <input type="checkbox" checked={s.fallbackChannels} onChange={(e) => s.set({ fallbackChannels: e.target.checked })} />
        <b>Ausweich-Kanäle nutzen, wenn das Kontingent aufgebraucht ist</b>
      </label>
      <p className="small muted mt-1">
        Antwortet der Hauptanbieter nicht, versucht der Lesekompass zuerst die anderen Gemini-Modelle (jedes hat ein eigenes Gratis-Kontingent), dann diese
        Gratis-Dienste – in dieser Reihenfolge. Kurzbeschreibungen verbrauchen ohnehin wenig: Sie nutzen ein günstiges Modell und nur einen knappen Lesekontext.
      </p>
      {s.fallbackChannels &&
        COMPAT_ORDER.map((provider) => {
          const info = COMPAT[provider];
          const onServer = Boolean(server?.llm?.[provider]);
          return (
            <div key={provider} className="field">
              <span className="label">
                {info.name} <span className="muted small">– {info.note}</span>
              </span>
              {onServer ? (
                <span className="small">Schlüssel liegt auf dem Server ({provider.toUpperCase()}_API_KEY).</span>
              ) : (
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={`${info.name}-Schlüssel (optional)`}
                  value={s[keyField[provider]]}
                  onChange={(e) => s.set({ [keyField[provider]]: e.target.value.trim() })}
                  aria-label={`${info.name}-Schlüssel`}
                />
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <input
                  className="input"
                  style={{ maxWidth: 260 }}
                  placeholder="Modell: automatisch"
                  value={s[modelField[provider]]}
                  onChange={(e) => s.set({ [modelField[provider]]: e.target.value.trim() })}
                  aria-label={`${info.name}-Modell`}
                />
                <a className="small" href={info.keyUrl} target="_blank" rel="noopener noreferrer">
                  Gratis-Schlüssel holen ↗
                </a>
                {channels.some((c) => c.provider === provider) && (
                  <button className="btn btn-sm" onClick={() => testOne(provider)}>
                    Testen
                  </button>
                )}
              </div>
              {results[provider] && <span className="help">{results[provider]}</span>}
            </div>
          );
        })}
    </div>
  );
}

/** Nachtschicht: Stand und Ergebnisse, Start auf Knopfdruck. */
/** Wissensspeicher: was der Server über Bücher gelernt hat und wie der Algorithmus nachjustiert. */
function KnowledgeSettings() {
  const { available, summary, tuning } = useKnowledge();
  useEffect(() => {
    void loadKnowledge();
  }, []);
  if (!available || !summary) return null;
  const shift = tuning?.fameShift ?? 0;
  const fame =
    !tuning || tuning.positives < 8 || tuning.negatives < 8
      ? `Noch zu wenige Beobachtungen, um die Bekanntheit nachzujustieren (${tuning?.positives ?? 0} geöffnet/gemocht, ${tuning?.negatives ?? 0} übergangen/ausgeblendet – je 8 nötig).`
      : Math.abs(shift) < 0.05
        ? 'Du öffnest bekannte und weniger bekannte Bücher etwa gleich oft – die Bekanntheit bleibt, wie sie ist.'
        : shift > 0
          ? `Du öffnest und magst eher bekanntere Bücher – die Vorschläge rücken etwas in diese Richtung (+${shift.toFixed(2)}).`
          : `Du öffnest und magst eher weniger bekannte Bücher – Geheimtipps rücken nach vorne (${shift.toFixed(2)}).`;
  return (
    <div className="mt-2">
      <div className="divider" />
      <span className="label">Wissensspeicher</span>
      <p className="small mt-1">
        Alles, was der Lesekompass über Bücher lernt, bleibt auf deinem Server: {summary.books.toLocaleString('de-CH')} Bücher, davon{' '}
        {summary.learned.toLocaleString('de-CH')} mit KI-Schlagwörtern (verbessern die Empfehlungen überall). Von dir: {summary.seen.toLocaleString('de-CH')} gesehen,{' '}
        {summary.opened.toLocaleString('de-CH')} geöffnet.
      </p>
      <p className="small muted">{fame}</p>
      <a className="btn btn-sm" href="./api/wissen/export" download>
        Wissensdatenbank herunterladen
      </a>
    </div>
  );
}

function NightShiftSettings() {
  const { available, loaded, status, results, load, start } = useNightShift();
  const [message, setMessage] = useState('');
  useEffect(() => {
    void load();
  }, [load]);
  if (!loaded) return null;
  const time = (t: number) => new Date(t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const reasons: Record<string, string> = {
    quota: 'Tageskontingent aller Gemini-Modelle aufgebraucht',
    tasks: 'nichts mehr zu tun',
    window: 'Tageswechsel bei Google erreicht',
    active: 'pausiert, weil die KI gerade in der App genutzt wurde',
    errors: 'wegen wiederholter Fehler abgebrochen',
  };
  return (
    <div className="mt-2">
      <div className="divider" />
      <span className="label">Nachtschicht</span>
      {!available ? (
        <p className="small muted mt-1">
          Nutzt am Ende des Google-Tages das restliche Gemini-Kontingent für deine Bibliothek. Dafür braucht es die Docker-Installation mit GEMINI_API_KEY auf dem
          Server (siehe deploy/DOCKER.md).
        </p>
      ) : (
        <>
          <p className="small mt-1">
            Ab {status?.startHour ?? 22}:00 bis zum Tageswechsel bei Google ({status ? time(status.window.reset) : '09:00'} Uhr) nutzt der Server das restliche
            Gemini-Kontingent des Tages: Kurzbeschreibungen für Merkliste und „Will ich lesen“, Schlagwörter für deine Bücher (schärfen das Profil), eine
            Lese-Analyse (unter Bibliothek → Lese-DNA) und neue Vorschläge (unter „Für dich“). Benutzt du die KI selbst, hat das Vorrang.
          </p>
          {status && status.day && (
            <p className="small muted mb-0">
              {status.running ? 'Läuft gerade' : `Zuletzt (${status.day})`}: {status.requests} Anfragen – {status.made.blurbs} Kurzbeschreibungen, {status.made.themes}{' '}
              Bücher verschlagwortet, {status.made.analysis ? 'Analyse erstellt' : 'keine neue Analyse'}, {status.made.suggestions} Vorschläge
              {!status.running && status.reason ? ` · ${reasons[status.reason] ?? status.reason}` : ''}.
              {status.state === 'error' && status.lastError ? ` Letzter Fehler: ${status.lastError}` : ''}
            </p>
          )}
          <p className="small muted">
            Insgesamt: {Object.keys(results.themes).length} Bücher mit zusätzlichen Schlagwörtern, {results.suggestions.length} Vorschläge
            {results.analysis ? `, Analyse vom ${new Date(results.analysis.at).toLocaleDateString('de-CH')}` : ''}.
          </p>
          <div className="btn-row">
            <button
              className="btn btn-sm"
              disabled={status?.running}
              onClick={async () => {
                const err = await start();
                setMessage(err ?? 'Gestartet – das kann eine Weile dauern. Ergebnisse erscheinen nach und nach.');
              }}
            >
              Jetzt starten
            </button>
            <span className="help">Verbraucht das restliche Kontingent sofort – danach antworten bis {status ? time(status.window.reset) : '09:00'} Uhr die Ausweich-Kanäle.</span>
          </div>
          {message && <p className="small mt-1 mb-0">{message}</p>}
        </>
      )}
    </div>
  );
}
