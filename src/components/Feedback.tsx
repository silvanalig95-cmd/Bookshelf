import type { ReactNode } from 'react';
import { useUi } from '../store/ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toast-wrap" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Loading({ text = 'Bücher werden gesucht …' }: { text?: string }) {
  return (
    <div className="loading-line" role="status">
      <span className="spinner" /> {text}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function SkeletonGrid({ count = 10, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={`book-grid ${compact ? 'compact' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stack" style={{ gap: 8 }}>
          <div className="skeleton" style={{ aspectRatio: '2/3' }} />
          <div className="skeleton" style={{ height: 14, width: '85%' }} />
          <div className="skeleton" style={{ height: 12, width: '55%' }} />
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
