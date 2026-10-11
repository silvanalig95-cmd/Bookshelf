import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookGrid } from '../components/BookCard';
import { Empty, SkeletonGrid } from '../components/Feedback';
import { errorMessage, useAsync, useProfile, useReadIndex } from '../lib/hooks';
import { docToBook, getSubject, searchWorks, subjectKey, type SubjectFacet } from '../lib/openLibrary';
import { conceptsOf, isProfileUsable } from '../lib/profile';
import { isNoiseSubject, subjectLabel } from '../lib/taxonomy';
import { solrPhrase } from '../lib/text';
import { useSettings } from '../store/settings';

type NodeKind = 'subject' | 'place' | 'time' | 'person';

interface GraphNode {
  key: string;
  name: string;
  label: string;
  count: number;
  kind: NodeKind;
}

const STARTERS = [
  'Magic',
  'Time travel',
  'Detectives',
  'Friendship',
  'Islands',
  'Vikings',
  'Artificial intelligence',
  'Witches',
  'Pirates',
  'Books and reading',
  'Mountains',
  'Ghosts',
  'Spies',
  'Family secrets',
  'Dragons',
  'Lighthouses',
  'Music',
  'Cooking',
];

const KIND_STYLE: Record<NodeKind, { color: string; label: string }> = {
  subject: { color: 'var(--accent)', label: 'Thema' },
  place: { color: 'var(--teal)', label: 'Ort' },
  time: { color: 'var(--gold)', label: 'Zeit' },
  person: { color: 'var(--violet)', label: 'Figur' },
};

function kindOf(key: string): NodeKind {
  if (key.includes('place:')) return 'place';
  if (key.includes('time:')) return 'time';
  if (key.includes('person:')) return 'person';
  return 'subject';
}

function cleanKey(key: string): string {
  return key.replace(/^\/subjects\//, '');
}

function toNodes(list: SubjectFacet[], kind: NodeKind, max: number, exclude: Set<string>): GraphNode[] {
  const out: GraphNode[] = [];
  for (const f of list) {
    if (isNoiseSubject(f.name) || f.name.length > 40) continue;
    const cs = conceptsOf([f.name]);
    if (kind === 'subject' && (!cs.length || cs.every((c) => exclude.has(c)))) continue;
    if (/^(fiction|juvenile|children|history|social life and customs|general)/i.test(f.name) && kind === 'subject') continue;
    out.push({ key: cleanKey(f.key), name: f.name, label: subjectLabel(f.name), count: f.count, kind });
    if (out.length >= max) break;
  }
  return out;
}

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const language = useSettings((s) => s.language);
  const profile = useProfile();
  const readIndex = useReadIndex();
  const [input, setInput] = useState('');
  const [germanOnly, setGermanOnly] = useState(language !== 'any');
  const raw = params.get('s') ?? '';
  const key = params.get('k') ?? (raw ? subjectKey(raw) : '');
  const trail = (params.get('t') ?? '').split('|').filter(Boolean);

  const go = (nextKey: string, name: string) => {
    const nextTrail = key ? [...trail, `${key}~${details.data?.name ?? raw}`].slice(-8) : [];
    setParams({ k: nextKey, s: name, t: nextTrail.join('|') });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const details = useAsync(async (signal) => (key ? getSubject(key, 6, signal) : undefined), [key]);

  const books = useAsync(
    async (signal) => {
      if (!key || !details.data) return [];
      const kind = kindOf(key);
      const name = details.data.name;
      const field = kind === 'subject' ? 'subject' : kind;
      const q = `${field}:${solrPhrase(name)}${germanOnly ? ' language:ger' : ''}`;
      const res = await searchWorks(q, { sort: 'readinglog', limit: 30, lang: 'de', signal });
      return res.docs.map((d) => docToBook(d)).filter((b) => !readIndex.has(b));
    },
    [key, details.data?.name, germanOnly],
  );

  const nodes = useMemo(() => {
    const d = details.data;
    if (!d) return [];
    const self = new Set(conceptsOf([d.name]));
    const all = [
      ...toNodes(d.subjects, 'subject', 10, self),
      ...toNodes(d.places, 'place', 4, self),
      ...toNodes(d.times, 'time', 3, self),
      ...toNodes(d.people, 'person', 2, self),
    ];
    const seen = new Set<string>([subjectLabel(d.name).toLowerCase()]);
    return all.filter((n) => (seen.has(n.label.toLowerCase()) ? false : (seen.add(n.label.toLowerCase()), true))).slice(0, 15);
  }, [details.data]);

  const starters = isProfileUsable(profile) ? [...profile.topConcepts.slice(0, 8).map((c) => c.concept), ...STARTERS.slice(0, 10)] : STARTERS;

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Spielen · Themen-Netz</p>
        <h1>Folge dem Faden</h1>
        <p>Jedes Thema ist mit anderen Themen, Orten, Epochen und Figuren verknüpft. Spring von Knoten zu Knoten – und finde unterwegs Bücher, nach denen du nie gesucht hättest.</p>
      </div>

      <form
        className="row wrap"
        style={{ marginBottom: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            setParams({ s: input.trim(), k: subjectKey(input.trim()) });
            setInput('');
          }
        }}
      >
        <input className="input" style={{ maxWidth: 360 }} placeholder="Thema auf Englisch, z. B. lighthouses, chess, Venice …" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn-dark" type="submit">
          Erkunden
        </button>
      </form>

      {!key ? (
        <div className="card">
          <h3>Wo möchtest du anfangen?</h3>
          <div className="chips mt-1">
            {starters.map((s, i) => (
              <button key={s} className="chip" style={{ animationDelay: `${i * 30}ms` }} onClick={() => setParams({ s, k: subjectKey(s) })}>
                {subjectLabel(s)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {trail.length > 0 && (
            <nav className="row wrap small" style={{ gap: 6, marginBottom: 12 }} aria-label="Dein Pfad">
              <span className="muted">Dein Pfad:</span>
              {trail.map((t, i) => {
                const [k, name] = t.split('~');
                return (
                  <span key={`${t}-${i}`} className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setParams({ k, s: name, t: trail.slice(0, i).join('|') })}>
                      {subjectLabel(name ?? k)}
                    </button>
                    <span className="muted">→</span>
                  </span>
                );
              })}
              <b>{subjectLabel(details.data?.name ?? raw)}</b>
            </nav>
          )}

          <div className="card graph-card">
            {details.loading && !details.data ? (
              <div className="loading-line" style={{ justifyContent: 'center', minHeight: 300 }}>
                <span className="spinner" /> Das Netz wird geknüpft …
              </div>
            ) : details.error ? (
              <Empty title="Dieses Thema kennt Open Library nicht">
                <p>{errorMessage(details.error) || 'Probier einen englischen Begriff, z. B. „lighthouses“ statt „Leuchttürme“.'}</p>
              </Empty>
            ) : details.data ? (
              <Graph center={details.data.name} count={details.data.workCount} kind={kindOf(key)} nodes={nodes} onPick={(n) => go(n.key, n.name)} />
            ) : null}
            <div className="row wrap" style={{ gap: 12, justifyContent: 'center' }}>
              {(Object.keys(KIND_STYLE) as NodeKind[]).map((k) => (
                <span key={k} className="row small muted" style={{ gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: KIND_STYLE[k].color, display: 'inline-block' }} />
                  {KIND_STYLE[k].label}
                </span>
              ))}
            </div>
          </div>

          {details.data && details.data.authors.length > 0 && (
            <div className="mt-2">
              <span className="label">Prägende Autor:innen</span>
              <div className="chips mt-1">
                {details.data.authors.slice(0, 10).map((a) => (
                  <Link key={a.key} to={`/entdecken?autor=${encodeURIComponent(a.name)}`} className="chip">
                    {a.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <section className="mt-3">
            <div className="row between wrap" style={{ marginBottom: 14 }}>
              <h2 className="mb-0">Bücher zu „{subjectLabel(details.data?.name ?? raw)}“</h2>
              <label className="toggle">
                <input type="checkbox" checked={germanOnly} onChange={(e) => setGermanOnly(e.target.checked)} />
                nur mit deutscher Ausgabe
              </label>
            </div>
            {books.loading ? <SkeletonGrid count={10} /> : books.data?.length ? <BookGrid items={books.data} origin="Themen-Netz" /> : <p className="muted">Keine Bücher gefunden.</p>}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Platziert die Knoten auf einer Ellipse um die Mitte und schiebt sie dann
 * iterativ auseinander, bis sich weder Kreise noch Beschriftungen überlappen.
 */
function layout(nodes: GraphNode[], W: number, H: number) {
  const cx = W / 2;
  const cy = H / 2;
  const max = Math.max(1, ...nodes.map((n) => n.count));
  const pts = nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    const r = 14 + 20 * (Math.log(1 + n.count) / Math.log(1 + max));
    const labelW = Math.min(24, n.label.length) * 7.2;
    return { ...n, x: cx + Math.cos(angle) * 300, y: cy + Math.sin(angle) * 185, r, labelW };
  });
  const box = (p: (typeof pts)[number]) => ({
    x0: p.x - Math.max(p.r, p.labelW / 2) - 6,
    x1: p.x + Math.max(p.r, p.labelW / 2) + 6,
    y0: p.y - p.r - 4,
    y1: p.y + p.r + 24,
  });
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = box(pts[i]);
        const b = box(pts[j]);
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox > 0 && oy > 0) {
          moved = true;
          // entlang der kleineren Überlappung auseinanderschieben
          if (ox < oy) {
            const d = (ox / 2 + 1) * Math.sign(pts[i].x - pts[j].x || 1);
            pts[i].x += d;
            pts[j].x -= d;
          } else {
            const d = (oy / 2 + 1) * Math.sign(pts[i].y - pts[j].y || 1);
            pts[i].y += d;
            pts[j].y -= d;
          }
        }
      }
      // Abstand zur Mitte und zum Rand
      const p = pts[i];
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = 62 + p.r + 22;
      if (dist < minDist) {
        p.x = cx + (dx / dist) * minDist;
        p.y = cy + (dy / dist) * minDist;
        moved = true;
      }
      const half = Math.max(p.r, p.labelW / 2) + 4;
      p.x = Math.min(W - half, Math.max(half, p.x));
      p.y = Math.min(H - p.r - 24, Math.max(p.r + 6, p.y));
    }
    if (!moved) break;
  }
  return pts;
}

function Graph({ center, count, kind, nodes, onPick }: { center: string; count: number; kind: NodeKind; nodes: GraphNode[]; onPick: (n: GraphNode) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 860;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const placed = useMemo(() => layout(nodes, W, H), [nodes]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="graph" role="img" aria-label={`Themen-Netz rund um ${center}`}>
      {placed.map((n) => (
        <path
          key={`l-${n.key}`}
          d={`M${cx},${cy} Q${(cx + n.x) / 2 + (n.y - cy) * 0.15},${(cy + n.y) / 2 - (n.x - cx) * 0.15} ${n.x},${n.y}`}
          fill="none"
          stroke={hover === n.key ? KIND_STYLE[n.kind].color : 'var(--line-strong)'}
          strokeWidth={hover === n.key ? 2 : 1}
          className="graph-edge"
        />
      ))}
      <g className="graph-center">
        <circle cx={cx} cy={cy} r={62} fill={KIND_STYLE[kind].color} />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontWeight={700} fontSize={15} style={{ fontFamily: 'var(--font-serif)' }}>
          {subjectLabel(center).length > 18 ? `${subjectLabel(center).slice(0, 17)}…` : subjectLabel(center)}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="#fff" fontSize={11} opacity={0.85}>
          {count.toLocaleString('de-CH')} Werke
        </text>
      </g>
      {placed.map((n, i) => (
        <g
          key={n.key}
          className="graph-node"
          style={{ animationDelay: `${i * 40}ms`, cursor: 'pointer' }}
          onClick={() => onPick(n)}
          onMouseEnter={() => setHover(n.key)}
          onMouseLeave={() => setHover(null)}
          tabIndex={0}
          role="button"
          aria-label={`${KIND_STYLE[n.kind].label}: ${n.label}`}
          onKeyDown={(e) => e.key === 'Enter' && onPick(n)}
        >
          <circle cx={n.x} cy={n.y} r={n.r + (hover === n.key ? 4 : 0)} fill={KIND_STYLE[n.kind].color} opacity={hover && hover !== n.key ? 0.55 : 0.92} stroke="var(--surface)" strokeWidth={3} />
          <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--ink)">
            {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
          </text>
          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>
            {n.count > 999 ? `${Math.round(n.count / 100) / 10}K` : n.count}
          </text>
        </g>
      ))}
    </svg>
  );
}
