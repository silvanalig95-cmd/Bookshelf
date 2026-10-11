/**
 * Gemerkte KI-Kurzbeschreibungen auf dem Server: einmal erzeugt, auf allen Geräten derselben
 * Person sofort da – das spart Anfragen an die KI. Abgelegt in <data>/kurzbeschreibungen.json.
 * Getrennt je Login, weil die Beschreibung einen Satz zum eigenen Geschmack enthält.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Blurb {
  text: string;
  model: string;
  at: number;
}

const MAX_ENTRIES = 30_000;
const MAX_TEXT = 4000;

export class BlurbStore {
  private readonly file: string;
  private entries: Record<string, Blurb> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(dir: string) {
    this.file = join(dir, 'kurzbeschreibungen.json');
  }

  private load(): Record<string, Blurb> {
    if (!this.entries) {
      try {
        this.entries = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Blurb>) : {};
      } catch {
        this.entries = {};
      }
    }
    return this.entries;
  }

  private key(user: string | null, id: string): string {
    return `${user ?? ''}|${id}`;
  }

  get(user: string | null, id: string): Blurb | undefined {
    return this.load()[this.key(user, id)];
  }

  set(user: string | null, id: string, text: string, model: string): boolean {
    if (!id || id.length > 200 || !text.trim() || text.length > MAX_TEXT || model.length > 100) return false;
    const entries = this.load();
    entries[this.key(user, id)] = { text, model, at: Date.now() };
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => entries[a].at - entries[b].at);
      for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[old];
    }
    this.scheduleSave();
    return true;
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 2000);
    this.timer.unref?.();
  }

  flush() {
    if (!this.entries) return;
    mkdirSync(join(this.file, '..'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.entries));
    renameSync(tmp, this.file);
  }
}
