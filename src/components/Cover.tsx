import { useEffect, useState } from 'react';
import { coverUrl } from '../lib/openLibrary';
import { serverCoverUrl, useBookInfoServer } from '../store/bookInfo';

// Gedämpfte Einfarbtöne für Bücher ohne Cover
const PALETTE = ['#5b4a3f', '#3f5550', '#4a4458', '#5a4148', '#3e4a5c', '#5c5238', '#41513f', '#4a4a4a'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Aktuelle Verlags-Cover aus dem Verzeichnis lieferbarer Bücher, über die Deutsche Nationalbibliothek:
 * scharf und modern, aber nur für Bücher deutschsprachiger Verlage (ISBN 978-3-…). Sonst Open Library.
 */
export function publisherCoverUrl(isbn: string | undefined, size: 'S' | 'M' | 'L' = 'M'): string | undefined {
  if (!isbn || !/^9783\d{9}$/.test(isbn)) return undefined;
  return `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}&size=${size === 'S' ? 'm' : 'l'}`;
}

interface CoverProps {
  title: string;
  author?: string;
  coverId?: number;
  src?: string;
  /** Weitere Kandidaten (z. B. ISBN-Cover), falls das erste Bild fehlt. */
  fallbacks?: string[];
  /** ISBN-13 der Ausgabe – bei deutschsprachigen Verlagen kommt das Verlags-Cover zuerst. */
  isbn?: string;
  /** Genau diese Ausgabe zeigen (keine Suche nach Titel, z. B. in der Ausgabenliste). */
  exact?: boolean;
  size?: 'S' | 'M' | 'L';
  className?: string;
  style?: React.CSSProperties;
}

export function Cover({ title, author, coverId, src, fallbacks = [], isbn, exact, size = 'M', className, style }: CoverProps) {
  // Reihenfolge: Apple Books (scharf, aktuelle Ausgabe; über den eigenen Server), Verlags-Cover der
  // Nationalbibliothek, dann Open Library
  const server = useBookInfoServer((s) => s.available);
  const apple = server && !exact && title ? serverCoverUrl(title, author, size === 'S' ? 160 : size === 'L' ? 800 : 400) : undefined;
  const candidates = [apple, publisherCoverUrl(isbn, size), src, coverUrl(coverId, size), ...fallbacks].filter((x): x is string => Boolean(x));
  const candidateKey = candidates.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidateKey]);
  const current = candidates[index];
  const tone = PALETTE[hash(title) % PALETTE.length];

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
        <div className="cover-fallback" style={{ background: tone }} aria-label={`Platzhalter-Cover: ${title}`}>
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
