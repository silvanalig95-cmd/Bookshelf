export function CompassMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--ink)" strokeWidth="3.5" />
      <path d="M32 13 L38 32 L26 32 Z" fill="var(--accent)" />
      <path d="M32 51 L26 32 L38 32 Z" fill="var(--line-strong)" />
    </svg>
  );
}
