#!/usr/bin/env bash
# Startet den Lesekompass und hält ihn aktuell – dieses eine Skript ist der ganze „Dienst“:
#   - startet den Server aus der laufenden Version und startet ihn neu, falls er stoppt,
#   - fragt alle LESEKOMPASS_UPDATE_INTERVAL Sekunden (Standard 60) update.sh nach Neuem,
#   - fällt auf die vorherige Version zurück, wenn eine neue gleich nach dem Start immer wieder abstürzt.
# Im Docker-Image ist es der Einstiegspunkt; es läuft aber auch direkt in einem Terminal.
set -u

HOME_DIR="${LESEKOMPASS_HOME:-/srv/lesekompass}"
INTERVAL="${LESEKOMPASS_UPDATE_INTERVAL:-60}"
NODE="${LESEKOMPASS_NODE:-node}"
SEED="${LESEKOMPASS_SEED:-}"          # fertige Version im Image, falls noch keine heruntergeladen wurde
PIDFILE="${LESEKOMPASS_PIDFILE:-$HOME_DIR/server.pid}"
CRASH_LIMIT="${LESEKOMPASS_CRASH_LIMIT:-5}"
export LESEKOMPASS_HOME="$HOME_DIR" LESEKOMPASS_PIDFILE="$PIDFILE"
unset LESEKOMPASS_BUILD                # die Build-Kennung muss aus der jeweiligen Version (BUILD-Datei) kommen
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${LESEKOMPASS_UPDATER:-$here/update.sh}"
# Das Update-Skript aus der laufenden Version ist das neueste geprüfte – so verbessert sich auch das Update selbst.
updater() {
  local live="$HOME_DIR/current/deploy/update.sh"
  if [ -z "${LESEKOMPASS_UPDATER:-}" ] && [ -f "$live" ] && bash -n "$live" 2>/dev/null; then echo "$live"; else echo "$UPDATER"; fi
}

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') lesekompass: $*" >&2; }
mkdir -p "$HOME_DIR/releases" || { say "kann $HOME_DIR nicht anlegen"; exit 2; }

# ---- erster Start: eine lauffähige Version bereitstellen
seed_release() {
  local id; id="seed-$(cat "$SEED/BUILD" 2>/dev/null || echo local)"
  rm -rf "$HOME_DIR/releases/$id"; cp -r "$SEED" "$HOME_DIR/releases/$id"
  ln -sfn "releases/$id" "$HOME_DIR/current.tmp" && mv -Tf "$HOME_DIR/current.tmp" "$HOME_DIR/current"
  say "starte die Version aus dem Image ($id)"
}
if [ ! -e "$HOME_DIR/current" ]; then
  if [ -n "$SEED" ] && [ -f "$SEED/dist/index.html" ]; then seed_release
  elif [ -n "${LESEKOMPASS_REPO_URL:-}" ]; then bash "$UPDATER" --no-restart
  fi
  [ -e "$HOME_DIR/current" ] || { say "keine Version zum Starten vorhanden: LESEKOMPASS_REPO_URL setzen"; exit 1; }
elif [ -z "${LESEKOMPASS_REPO_URL:-}" ] && [ -n "$SEED" ] && [ -f "$SEED/BUILD" ]; then
  # Ohne Repository ist die Version im Image massgeblich – nach einem Neubau die neue nehmen.
  live="$(basename "$(readlink -f "$HOME_DIR/current")")"
  case "$live" in seed-*) [ "$live" = "seed-$(cat "$SEED/BUILD")" ] || seed_release ;; esac
fi

SERVER_PID=""; UPDATER_PID=""; stopping=0
shutdown() {
  stopping=1
  [ -n "$UPDATER_PID" ] && kill "$UPDATER_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill -TERM "$SERVER_PID" 2>/dev/null
}
trap shutdown TERM INT

# ---- Update-Schleife (erste Prüfung kurz nach dem Start)
if [ "$INTERVAL" -gt 0 ] 2>/dev/null; then
  (
    trap 'exit 0' TERM INT
    sleep 5 & wait $!
    while true; do
      bash "$(updater)" >/dev/null       # update.sh meldet Wichtiges auf stderr und in update.log
      sleep "$INTERVAL" & wait $!
    done
  ) &
  UPDATER_PID=$!
fi

# ---- Server-Schleife
quick=0
while [ "$stopping" = 0 ]; do
  started_build="$(cat "$HOME_DIR/current/BUILD" 2>/dev/null || true)"
  ( cd "$HOME_DIR/current" && exec "$NODE" server/server.ts ) &
  SERVER_PID=$!
  echo "$SERVER_PID" >"$PIDFILE"
  started="$(date +%s)"
  wait "$SERVER_PID"; rc=$?
  while [ "$stopping" = 1 ] && kill -0 "$SERVER_PID" 2>/dev/null; do wait "$SERVER_PID" 2>/dev/null; done
  [ "$stopping" = 1 ] && break
  if [ -e "$HOME_DIR/.restart-requested" ]; then
    rm -f "$HOME_DIR/.restart-requested"; quick=0; continue
  fi
  # Wurde inzwischen auf eine andere Version umgeschaltet (z. B. Rückfall nach einem Absturz)? Dann sofort neu starten.
  if [ "$(cat "$HOME_DIR/current/BUILD" 2>/dev/null || true)" != "$started_build" ]; then
    say "Version gewechselt ($started_build -> $(cat "$HOME_DIR/current/BUILD" 2>/dev/null)); starte neu"
    quick=0; continue
  fi
  lived=$(( $(date +%s) - started ))
  if [ "$lived" -lt 10 ]; then quick=$((quick + 1)); else quick=0; fi
  live_build="$(cat "$HOME_DIR/current/BUILD" 2>/dev/null || true)"
  [ "$lived" -ge 30 ] && [ -n "$live_build" ] && echo "$live_build" >"$HOME_DIR/healthy"
  say "der Server hat gestoppt (Exit $rc) nach ${lived}s"
  if [ "$quick" -ge "$CRASH_LIMIT" ]; then
    if [ "$live_build" != "$(cat "$HOME_DIR/healthy" 2>/dev/null || true)" ] && [ -e "$HOME_DIR/previous" ] \
       && [ "$(readlink -f "$HOME_DIR/previous")" != "$(readlink -f "$HOME_DIR/current")" ]; then
      say "diese Version lief noch nie stabil und stürzt sofort ab – zurück zur vorherigen"
      bash "$(updater)" --rollback --no-restart >/dev/null || say "auch die vorherige Version liess sich nicht herstellen"
    else
      say "der Server stürzt gleich nach dem Start ab; die Ursache liegt vermutlich in den Einstellungen (siehe Meldungen oben). Neuer Versuch alle 30 Sekunden."
    fi
    quick=$((CRASH_LIMIT))
  fi
  # Warten vor dem nächsten Versuch – aber sofort weiter, wenn inzwischen eine andere Version aktiv ist
  delay=$(( quick >= CRASH_LIMIT ? 30 : quick > 0 ? quick * 2 : 1 ))
  while [ "$delay" -gt 0 ] && [ "$stopping" = 0 ]; do
    if [ "$(cat "$HOME_DIR/current/BUILD" 2>/dev/null || true)" != "$live_build" ]; then quick=0; break; fi
    sleep 1 & wait $!
    delay=$((delay - 1))
  done
done
rm -f "$PIDFILE"
say "gestoppt"
