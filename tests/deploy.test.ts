import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Docker-Rezept', () => {
  it('Shell-Skripte sind syntaktisch korrekt und nutzen LF', () => {
    for (const f of ['deploy/run.sh', 'deploy/update.sh']) {
      expect(() => execFileSync('bash', ['-n', f])).not.toThrow();
      expect(readFileSync(f, 'utf8')).not.toContain('\r');
      expect(readFileSync(f, 'utf8').startsWith('#!/usr/bin/env bash')).toBe(true);
    }
  });

  it('kopiert nur vorhandene Dateien ins Image', () => {
    const dockerfile = readFileSync('deploy/Dockerfile', 'utf8');
    for (const m of dockerfile.matchAll(/^COPY (?:--chown=\S+ )?(?!--from)(.+) \S+$/gm)) {
      for (const src of m[1].split(/\s+/)) if (src !== '.') expect(existsSync(src), src).toBe(true);
    }
    expect(dockerfile).toContain('ENTRYPOINT ["/opt/lesekompass-seed/deploy/run.sh"]');
  });

  it('Einstellungsvorlage nennt jeden Namen nur einmal', () => {
    const keys = readFileSync('deploy/lesekompass.env.example', 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.split('=')[0]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['LESEKOMPASS_AUTH', 'ANTHROPIC_API_KEY', 'LESEKOMPASS_UPDATE_INTERVAL']));
  });

  it('Compose-Datei verweist auf Dockerfile und Einstellungen', () => {
    const compose = readFileSync('deploy/docker-compose.yml', 'utf8');
    expect(compose).toContain('dockerfile: deploy/Dockerfile');
    expect(compose).toContain('path: lesekompass.env');
    expect(compose).toContain('"8080:8080"');
  });

  it('Windows-Skripte sind reines ASCII', () => {
    for (const f of ['docker-starten.bat', 'docker-neu-bauen.bat', 'Lesekompass-starten.bat']) {
      expect(/^[\x00-\x7F]*$/.test(readFileSync(f, 'utf8')), f).toBe(true);
    }
  });
});
