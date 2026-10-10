/** Leichtgewichtige Prüfung, ob KI verfügbar ist – ohne das Claude-SDK zu laden. */
import { localApiStatus } from './goodreads';

export type AiVia = 'server' | 'browser';

let serverStatus: Promise<boolean> | undefined;

export async function aiAvailability(browserKey: string): Promise<{ available: boolean; via?: AiVia }> {
  serverStatus ??= localApiStatus().then((s) => s.ai);
  if (await serverStatus) return { available: true, via: 'server' };
  if (browserKey.trim()) return { available: true, via: 'browser' };
  return { available: false };
}

/** Server-Status neu abfragen (z. B. nach Änderungen in den Einstellungen). */
export function resetAiStatus() {
  serverStatus = undefined;
}
