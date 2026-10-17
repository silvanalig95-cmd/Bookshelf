import { Link } from 'react-router-dom';
import type { NightResults } from '../store/nightShift';

/** Text der nächtlichen Lese-Analyse: Zwischentitel mit „## “, Bücher als [[Titel|Autor]] → Suche. */
export function NightAnalysis({ analysis }: { analysis: NonNullable<NightResults['analysis']> }) {
  const blocks = analysis.text.split(/\n\s*\n|\n(?=## )/).filter((b) => b.trim());
  const withLinks = (text: string) =>
    text.split(/(\[\[[^\]|]+\|[^\]]+\]\])/g).map((part, i) => {
      const m = part.match(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/);
      return m ? (
        <Link key={i} to={`/entdecken?q=${encodeURIComponent(`${m[1].trim()} ${m[2].trim()}`)}`}>
          {m[1].trim()}
        </Link>
      ) : (
        part
      );
    });
  return (
    <div className="night-analysis">
      {blocks.map((b, i) => {
        const lines = b.trim().split('\n');
        if (lines[0].startsWith('## ')) {
          return (
            <div key={i}>
              <h3>{lines[0].slice(3)}</h3>
              {lines.slice(1).map((l, j) => (
                <p key={j}>{withLinks(l.replace(/^[-*]\s+/, ''))}</p>
              ))}
            </div>
          );
        }
        return <p key={i}>{withLinks(b.trim())}</p>;
      })}
      <p className="tiny muted mb-0">
        Über Nacht erstellt am {new Date(analysis.at).toLocaleDateString('de-CH')} · {analysis.model} – kann Fehler enthalten.
      </p>
    </div>
  );
}
