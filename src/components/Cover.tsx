import { useEffect, useState } from 'react';
import { coverUrl } from '../lib/openLibrary';

const PALETTE = [
  ['#7c2d12', '#c2410c'],
  ['#134e4a', '#0f766e'],
  ['#3b0764', '#6d28d9'],
  ['#831843', '#be185d'],
  ['#1e3a8a', '#2563eb'],
  ['#422006', '#a16207'],
  ['#14532d', '#15803d'],
  ['#3f3f46', '#71717a'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface CoverProps {
  title: string;
  author?: string;
  coverId?: number;
  src?: string;
  /** Weitere Kandidaten (z. B. ISBN-Cover), falls das erste Bild fehlt. */
  fallbacks?: string[];
  size?: 'S' | 'M' | 'L';
  className?: string;
  style?: React.CSSProperties;
}

export function Cover({ title, author, coverId, src, fallbacks = [], size = 'M', className, style }: CoverProps) {
  const candidates = [src, coverUrl(coverId, size), ...fallbacks].filter((x): x is string => Boolean(x));
  const candidateKey = candidates.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidateKey]);
  const current = candidates[index];
  const [a, b] = PALETTE[hash(title) % PALETTE.length];

  return (
    <div className={`cover ${className ?? ''}`} style={style}>
      {current ? (
        <img
          key={current}
          src={current}
          alt={`Cover: ${title}`}
          loading="lazy"
          decoding="async"
          onError={() => setIndex((i) => i + 1)}
          onLoad={(e) => {
            // Open Library liefert für fehlende Cover teils 1×1-Pixel-Bilder
            if ((e.currentTarget as HTMLImageElement).naturalWidth < 10) setIndex((i) => i + 1);
          }}
        />
      ) : (
        <div className="cover-fallback" style={{ background: `linear-gradient(150deg, ${a}, ${b})` }} aria-label={`Platzhalter-Cover: ${title}`}>
          <div>
            <div className="cf-title">{title}</div>
            <div className="cf-orn" />
          </div>
          {author && <div className="cf-author">{author}</div>}
        </div>
      )}
    </div>
  );
}
