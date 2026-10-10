import { useState } from 'react';

/**
 * Schlichte Diagramme für die Lese-DNA: eine Datenreihe, eine Farbe,
 * dünne Balken mit abgerundetem Ende, Haarlinien-Raster, Tooltip beim Hovern
 * und eine Tabellenansicht für Screenreader.
 */

interface Datum {
  label: string;
  value: number;
  hint?: string;
}

export function ColumnChart({ data, height = 180, color = 'var(--teal)', unit = '', title }: { data: Datum[]; height?: number; color?: string; unit?: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  // Bei vielen Säulen nur jede n-te Achsenbeschriftung zeigen (Tooltip & Tabelle haben alle)
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));
  return (
    <figure className="chart" aria-label={title}>
      <div className="col-chart" style={{ height }}>
        <div className="col-grid" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="col-gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{compact(t)}</span>
            </div>
          ))}
        </div>
        <div className="col-bars">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="col-slot"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.label}: ${d.value}${unit}`}
            >
              <div className="col-bar" style={{ height: `${(d.value / top) * 100}%`, background: color, opacity: hover === null || hover === i ? 1 : 0.45 }} />
              {hover === i && (
                <div className="chart-tip" role="tooltip">
                  <b>{d.label}</b>
                  <span>
                    {d.value.toLocaleString('de-CH')}
                    {unit}
                  </span>
                  {d.hint && <span className="muted">{d.hint}</span>}
                </div>
              )}
              {(i % labelEvery === 0 || i === data.length - 1) && <span className="col-label">{d.label}</span>}
            </div>
          ))}
        </div>
      </div>
      <DataTable data={data} unit={unit} title={title} />
    </figure>
  );
}

export function BarList({ data, color = 'var(--accent)', unit = '', title }: { data: Datum[]; color?: string; unit?: string; title: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure className="chart" aria-label={title}>
      <div className="bar-list">
        {data.map((d, i) => (
          <div key={d.label} className="bar-row" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={d.hint}>
            <span className="bar-label">{d.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: color, opacity: hover === null || hover === i ? 1 : 0.5 }} />
            </span>
            <span className="bar-value">
              {d.value.toLocaleString('de-CH')}
              {unit}
            </span>
          </div>
        ))}
      </div>
      <DataTable data={data} unit={unit} title={title} />
    </figure>
  );
}

function DataTable({ data, unit, title }: { data: Datum[]; unit: string; title: string }) {
  return (
    <details className="chart-table">
      <summary>Als Tabelle</summary>
      <table>
        <caption className="sr-only">{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>
                {d.value.toLocaleString('de-CH')}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function niceTicks(max: number): number[] {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const out: number[] = [];
  for (let v = 0; v <= max + step - 1e-9; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function compact(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`.replace('.0K', 'K');
  return String(n);
}
