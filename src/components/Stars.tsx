export function Stars({ value, max = 5, showValue = true }: { value?: number; max?: number; showValue?: boolean }) {
  if (!value) return null;
  const full = Math.round(value);
  return (
    <span className="stars" title={`${value.toFixed(2)} von ${max}`}>
      {'★'.repeat(full)}
      <span className="off">{'★'.repeat(Math.max(0, max - full))}</span>
      {showValue && <span className="muted small"> {value.toFixed(1)}</span>}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="star-input" role="radiogroup" aria-label="Bewertung">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} Sterne`}
          className={n <= value ? 'on' : ''}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}
