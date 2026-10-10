import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { bookPath } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { aiAvailability, aiChat, aiErrorMessage, parseBookRefs, readingContext, type AiVia, type ChatMessage } from '../lib/ai';
import { useLibraryEntries, useProfile } from '../lib/hooks';
import { resolveBook } from '../lib/resolve';
import type { Book } from '../lib/types';
import { useSettings } from '../store/settings';
import { rememberBook, toast } from '../store/ui';
import { useWishlist } from '../store/wishlist';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface Conversation {
  /** Verlauf für die API – Antworten vollständig (inkl. Denkblöcke), nur angehängt. */
  api: ChatMessage[];
  turns: Turn[];
  /** Lesekontext, festgehalten zu Beginn des Gesprächs. */
  context: string;
}

const STORAGE_KEY = 'lesekompass.chat';

const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

const SUGGESTIONS = [
  'Was soll ich als Nächstes lesen?',
  'Etwas wie meine Lieblingsbücher, aber kürzer und leichter',
  'Ein Buch für Ferien in Italien',
  'Ein Klassiker, der mir gefallen könnte – und warum',
  'Etwas völlig anderes als sonst, das trotzdem zu mir passt',
  'Eine Reihe, in der ich versinken kann',
];

function loadConversation(): Conversation | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Conversation) : undefined;
  } catch {
    return undefined;
  }
}

/* Mini-Markdown: Absätze, Aufzählungen, **fett**, *kursiv*, [[Titel|Autor]] */
function inline(text: string, onBook: (title: string, author: string) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  parseBookRefs(text).forEach((part, i) => {
    if (part.type === 'book') {
      out.push(<Fragment key={`b${i}`}>{onBook(part.title, part.author)}</Fragment>);
      return;
    }
    const tokens = part.text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
    tokens.forEach((t, j) => {
      if (/^\*\*[^*]+\*\*$/.test(t)) out.push(<strong key={`${i}-${j}`}>{t.slice(2, -2)}</strong>);
      else if (/^\*[^*]+\*$/.test(t)) out.push(<em key={`${i}-${j}`}>{t.slice(1, -1)}</em>);
      else if (t) out.push(<Fragment key={`${i}-${j}`}>{t}</Fragment>);
    });
  });
  return out;
}

function Markdown({ text, onBook }: { text: string; onBook: (title: string, author: string) => ReactNode }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), onBook)}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        if (/^#{1,4}\s/.test(block)) return <h4 key={i}>{inline(block.replace(/^#{1,4}\s/, ''), onBook)}</h4>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, onBook)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

export default function Librarian() {
  const settings = useSettings();
  const entries = useLibraryEntries();
  const profile = useProfile();
  const [params, setParams] = useSearchParams();
  const [ai, setAi] = useState<{ available: boolean; via?: AiVia } | undefined>();
  const [conv, setConv] = useState<Conversation | undefined>(loadConversation);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<Record<string, Book | null>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const toggleWish = useWishlist((s) => s.toggle);
  const wish = useWishlist((s) => s.items);

  useEffect(() => {
    aiAvailability(settings.aiApiKey).then(setAi);
  }, [settings.aiApiKey]);

  useEffect(() => {
    const buch = params.get('buch');
    if (buch) {
      setInput(`Erzähl mir mehr über „${buch}“ – lohnt es sich für mich? Und was könnte ich danach lesen?`);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (conv) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(conv));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* egal */
    }
  }, [conv]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [conv?.turns.length, streaming]);

  // Buchverweise im Hintergrund auflösen
  const refs = useMemo(() => {
    const list: Array<{ title: string; author: string }> = [];
    for (const t of conv?.turns ?? []) if (t.role === 'assistant') for (const p of parseBookRefs(t.text)) if (p.type === 'book') list.push(p);
    return list;
  }, [conv?.turns]);
  useEffect(() => {
    for (const r of refs) {
      const key = `${r.title}|${r.author}`;
      if (key in resolved) continue;
      setResolved((m) => ({ ...m, [key]: null }));
      resolveBook(r.title, r.author)
        .then((b) => {
          if (b) rememberBook(b);
          setResolved((m) => ({ ...m, [key]: b ?? null }));
        })
        .catch(() => undefined);
    }
  }, [refs, resolved]);

  const send = async (text: string) => {
    if (!text.trim() || busy || !ai?.available || !ai.via) return;
    setError('');
    const base: Conversation = conv ?? { api: [], turns: [], context: readingContext(entries, profile) };
    const api: ChatMessage[] = [...base.api, { role: 'user', content: text.trim() }];
    const turns: Turn[] = [...base.turns, { role: 'user', text: text.trim() }];
    setConv({ ...base, api, turns });
    setInput('');
    setBusy(true);
    setStreaming('');
    controller.current = new AbortController();
    try {
      let acc = '';
      const message = await aiChat(
        api,
        { via: ai.via, key: settings.aiApiKey, model: settings.aiModel },
        base.context,
        (delta) => {
          acc += delta;
          setStreaming(acc);
        },
        controller.current.signal,
      );
      const finalText = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      setConv({
        ...base,
        api: [...api, { role: 'assistant', content: message.content as ChatMessage['content'] }],
        turns: [...turns, { role: 'assistant', text: finalText }],
      });
    } catch (err) {
      setError(aiErrorMessage(err));
      // Unbeantwortete Frage wieder entfernen, damit der Verlauf gültig bleibt
      setConv(base.turns.length ? base : undefined);
      setInput(text);
    } finally {
      setBusy(false);
      setStreaming('');
    }
  };

  const bookChip = (title: string, author: string) => {
    const b = resolved[`${title}|${author}`];
    if (b) {
      return (
        <Link to={bookPath(b)} className="book-ref" onClick={() => rememberBook(b)}>
          📖 {title}
        </Link>
      );
    }
    return (
      <Link to={`/entdecken?q=${encodeURIComponent(`${title} ${author}`)}`} className="book-ref">
        📖 {title}
      </Link>
    );
  };

  if (ai === undefined) return null;

  if (!ai.available) {
    return (
      <div style={{ maxWidth: 760 }}>
        <div className="page-head">
          <p className="eyebrow">KI-Bibliothekar</p>
          <h1>Frag jemanden, der deine Bücher kennt</h1>
        </div>
        <div className="card">
          <p>
            Der KI-Bibliothekar nutzt <b>Claude</b> von Anthropic. Er kennt deine gelesenen Bücher und Bewertungen, versteht Wünsche wie „wie Der Schatten des
            Windes, aber in Wien und kürzer“ und schlägt Bücher vor, die du direkt öffnen, merken und kaufen kannst.
          </p>
          <p className="small muted">Dafür brauchst du einen eigenen API-Schlüssel (Abrechnung nach Verbrauch, typisch wenige Rappen pro Frage).</p>
          <Link to="/einstellungen#ki" className="btn btn-primary">
            ✨ KI in den Einstellungen aktivieren
          </Link>
        </div>
      </div>
    );
  }

  const turns = conv?.turns ?? [];
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
  const lastBooks = lastAssistant
    ? parseBookRefs(lastAssistant.text)
        .filter((p): p is { type: 'book'; title: string; author: string } => p.type === 'book')
        .map((p) => resolved[`${p.title}|${p.author}`])
        .filter((b): b is Book => Boolean(b))
    : [];

  return (
    <div className="librarian">
      <div className="page-head row between wrap">
        <div>
          <p className="eyebrow">KI-Bibliothekar</p>
          <h1 className="mb-0">Worauf hast du Lust?</h1>
          <p className="small muted mt-1">
            {MODEL_NAMES[settings.aiModel]} ·
            kennt {entries.filter((e) => e.shelf === 'read').length} deiner gelesenen Bücher
          </p>
        </div>
        {turns.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => {
              controller.current?.abort();
              setConv(undefined);
              setError('');
            }}
          >
            ✚ Neues Gespräch
          </button>
        )}
      </div>

      <div className="chat">
        {turns.length === 0 && (
          <div className="chat-empty">
            <div style={{ fontSize: '2.6rem' }}>✨</div>
            <p>Erzähl mir, wonach dir ist – Stimmung, Ort, ein Buch, das du geliebt hast, oder was du gerade gar nicht willst.</p>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.role === 'assistant' ? <Markdown text={t.text} onBook={bookChip} /> : <p>{t.text}</p>}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant">
            {streaming ? (
              <Markdown text={streaming} onBook={(title) => <span className="book-ref">📖 {title}</span>} />
            ) : (
              <p className="muted">
                <span className="spinner" style={{ width: 16, height: 16, verticalAlign: 'middle' }} /> Claude blättert in deinen Regalen …
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="notice rose">
            <span className="notice-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {lastBooks.length > 0 && !busy && (
        <div className="chat-books">
          {lastBooks.map((b) => (
            <div key={b.id} className="chat-book">
              <Link to={bookPath(b)} onClick={() => rememberBook(b)}>
                <Cover title={b.title} author={b.authors[0]} coverId={b.coverId} src={b.coverUrl} style={{ width: 70 }} />
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link to={bookPath(b)} onClick={() => rememberBook(b)} style={{ color: 'var(--ink)', fontWeight: 650 }}>
                  {b.title}
                </Link>
                <div className="small muted">{b.authors[0]}</div>
                <button
                  className={`btn btn-sm mt-1 ${wish[b.id] ? 'btn-soft' : ''}`}
                  onClick={() => {
                    const added = toggleWish(b, 'KI-Bibliothekar');
                    toast(added ? '♥ Gemerkt' : 'Entfernt');
                  }}
                >
                  {wish[b.id] ? '♥ Gemerkt' : '♡ Merken'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="textarea"
          rows={2}
          value={input}
          placeholder="z. B. „Ich mochte Der Name der Rose – gibt es etwas Ähnliches, aber spannender?“"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
          Senden
        </button>
      </form>
    </div>
  );
}
