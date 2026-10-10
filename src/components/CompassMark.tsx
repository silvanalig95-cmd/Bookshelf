export function CompassMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="var(--accent)" />
      <circle cx="32" cy="32" r="23" fill="var(--surface)" />
      <path d="M32 12 L38 32 L32 52 L26 32 Z" fill="var(--teal)" />
      <path d="M32 12 L38 32 L26 32 Z" fill="var(--accent)" />
      <circle cx="32" cy="32" r="3.5" fill="var(--ink)" />
    </svg>
  );
}
