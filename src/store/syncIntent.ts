/**
 * Kleine Brücke zwischen den Daten-Stores und der Synchronisation (ohne Import-Kreis):
 * Wer absichtlich viele Datensätze auf einmal entfernt (Leeren, Sicherung zurückspielen),
 * kündigt das hier an – sonst hält der Abgleich das für verlorene Daten und holt sie zurück.
 */
let listener: (() => void) | undefined;

export function announceBulkChange() {
  listener?.();
}

export function onBulkChange(fn: () => void) {
  listener = fn;
}
