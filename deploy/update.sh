#!/usr/bin/env bash
# Update-Skript des Lesekompass: holt den neuesten Commit eines Git-Zweigs, baut und prüft ihn
# und schaltet den laufenden Server erst dann um – nach dem Vorbild von Olympus (stretching-app).
#
#   update.sh              Update einspielen, falls es eines gibt (macht run.sh jede Minute)
#   update.sh --check      nur sagen, ob ein Update wartet (Exit 10 = ja, 0 = aktuell)
#   update.sh --status     welche Version läuft, welche ist die Reserve, welche wurde abgelehnt
#   update.sh --rollback   sofort zur vorherigen Version zurück
#   update.sh --force      eine früher abgelehnte Version nochmals versuchen
#   (--no-restart: Dateien umschalten, aber nichts neu starten)
#
# Aufbau unter $LESEKOMPASS_HOME (Standard /srv/lesekompass):
#   repo/            Kopie des Git-Repositorys        releases/<id>/  eine gebaute Version pro Ordner
#   current          Verweis auf die laufende Version  previous        Verweis auf die vorherige
#   update.log       was passiert ist und warum        failed          abgelehnte Version
#   npm-cache/       Paket-Zwischenspeicher (beschleunigt Builds)
#
# Sicherheitsnetz:
#   1. die neue Version wird neben der laufenden gebaut (npm ci, Typprüfung, Build, Tests) und muss
#      `node server/server.ts --selftest` bestehen, BEVOR irgendetwas umgeschaltet wird;
#   2. Umschalten = ein atomarer Symlink-Wechsel, danach Neustart;
#   3. der Server muss innerhalb von $LESEKOMPASS_HEALTH_TIMEOUT Sekunden auf /healthz die NEUE
#      Version melden – sonst kommt die alte zurück und die neue wird übersprungen.
#   Die Bibliothek der Nutzer:innen liegt im Browser; Updates können sie nicht berühren.
set -uo pipefail
umask 022

HOME_DIR="${LESEKOMPASS_HOME:-/srv/lesekompass}"
REPO_URL="${LESEKOMPASS_REPO_URL:-}"
BRANCH="${LESEKOMPASS_BRANCH:-main}"
KEEP="${LESEKOMPASS_KEEP_RELEASES:-4}"
PORT="${LESEKOMPASS_PORT:-8080}"
RUN_TESTS="${LESEKOMPASS_UPDATE_TESTS:-1}"
HEALTH_URL="${LESEKOMPASS_HEALTH_URL:-http://127.0.0.1:${PORT}/healthz}"
HEALTH_TIMEOUT="${LESEKOMPASS_HEALTH_TIMEOUT:-40}"
PIDFILE="${LESEKOMPASS_PIDFILE:-$HOME_DIR/server.pid}"
NODE="${LESEKOMPASS_NODE:-node}"

MODE=apply; RESTART=1; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --status) MODE=status ;;
    --rollback) MODE=rollback ;;
    --force) FORCE=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unbekannte Option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$HOME_DIR/releases" || { echo "kann $HOME_DIR/releases nicht anlegen" >&2; exit 2; }
LOG="$HOME_DIR/update.log"

log() {
  local line; line="$(date '+%Y-%m-%d %H:%M:%S') update: $*"
  echo "$line" >&2
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1"; fi
  echo "$line" >>"$LOG" 2>/dev/null || true
}

# ---------------------------------------------------------------- immer nur ein Updater
LOCK="$HOME_DIR/.update.lock"
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ >"$LOCK/pid"; return 0; fi
  local other; other="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null && grep -q 'update.sh' "/proc/$other/cmdline" 2>/dev/null; then return 1; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null && { echo $$ >"$LOCK/pid"; return 0; }
  return 1
}
release_lock() { rm -rf "$LOCK"; }

# ---------------------------------------------------------------- Hilfen
build_of() { cat "$1/BUILD" 2>/dev/null || true; }
current_dir() { [ -e "$HOME_DIR/current" ] && readlink -f "$HOME_DIR/current" 2>/dev/null || true; }
previous_dir() { [ -e "$HOME_DIR/previous" ] && readlink -f "$HOME_DIR/previous" 2>/dev/null || true; }
current_build() { local d; d="$(current_dir)"; [ -n "$d" ] && build_of "$d"; }
point() { ln -sfn "$2" "$HOME_DIR/$1.tmp" && mv -Tf "$HOME_DIR/$1.tmp" "$HOME_DIR/$1"; }

health_build() {
  "$NODE" -e '
    const c = new AbortController(); setTimeout(() => c.abort(), 3000);
    fetch(process.argv[1], { signal: c.signal }).then((r) => r.json()).then((j) => { console.log(j.build || ""); }).catch(() => process.exit(1));
  ' "$HEALTH_URL" 2>/dev/null
}

wait_healthy() {
  local want="$1" i=0 got
  while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    got="$(health_build)" && [ "$got" = "$want" ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

restart_server() {
  [ "$RESTART" = 1 ] || return 0
  if [ -s "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    touch "$HOME_DIR/.restart-requested"      # run.sh weiss so: dieser Neustart ist gewollt
    kill -TERM "$(cat "$PIDFILE")"; return $?
  fi
  return 0
}
manages_restart() { [ "$RESTART" = 1 ] && [ -s "$PIDFILE" ]; }

ensure_repo() {
  [ -n "$REPO_URL" ] || [ -d "$HOME_DIR/repo" ] || return 1
  if [ ! -d "$HOME_DIR/repo" ]; then
    git init --bare --quiet "$HOME_DIR/repo" || return 1
    git -C "$HOME_DIR/repo" remote add origin "$REPO_URL" || return 1
  elif [ -n "$REPO_URL" ] && [ "$(git -C "$HOME_DIR/repo" remote get-url origin 2>/dev/null)" != "$REPO_URL" ]; then
    git -C "$HOME_DIR/repo" remote set-url origin "$REPO_URL" || return 1
  fi
}

fetch_branch() {
  local t=(); command -v timeout >/dev/null 2>&1 && t=(timeout 120)
  GIT_TERMINAL_PROMPT=0 ${t[@]+"${t[@]}"} git -C "$HOME_DIR/repo" fetch --quiet --prune --depth=1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>"$HOME_DIR/.fetch-error"
}

# Baut eine entpackte Version: Pakete, Typprüfung + Build, Tests. Danach braucht der Server nur noch dist/ und server/.
build_release() {  # build_release <ordner> <build-id>
  (
    cd "$1" || exit 1
    export npm_config_cache="$HOME_DIR/npm-cache" npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
    echo "== npm ci"; npm ci --include=dev --loglevel=error || exit 1
    echo "== npm run build"; LESEKOMPASS_BUILD="$2" npm run build || exit 1
    if [ "$RUN_TESTS" = 1 ]; then echo "== npm test"; npm test || exit 1; fi
    rm -rf node_modules
  ) >"$HOME_DIR/.build-output" 2>&1
}

# ---------------------------------------------------------------- Modi
status() {
  echo "läuft:      $(current_build || true) ($(current_dir))"
  echo "vorherige:  $(build_of "$(previous_dir)") ($(previous_dir))"
  echo "abgelehnt:  $(cat "$HOME_DIR/failed" 2>/dev/null || echo keine)"
  local url; url="${REPO_URL:-$(git -C "$HOME_DIR/repo" remote get-url origin 2>/dev/null || echo '(keins)')}"
  echo "Zweig:      $BRANCH  Repository: $(echo "$url" | sed -E 's#(://)[^/@]*@#\1***@#')"
}

do_rollback() {
  local prev cur; prev="$(previous_dir)"; cur="$(current_dir)"
  if [ -z "$prev" ] || [ ! -d "$prev" ] || [ "$prev" = "$cur" ]; then log "keine vorherige Version vorhanden"; return 1; fi
  log "zurück von $(build_of "$cur") auf $(build_of "$prev")"
  build_of "$cur" >"$HOME_DIR/failed"
  point current "$prev"
  restart_server
  if manages_restart && ! wait_healthy "$(build_of "$prev")"; then log "WARNUNG: auch die vorherige Version meldet sich nicht gesund; siehe Server-Log"; return 1; fi
  return 0
}

prune() {
  local keep_a keep_b n=0 d
  keep_a="$(current_dir)"; keep_b="$(previous_dir)"
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    d="$HOME_DIR/releases/$d"
    { [ "$d" = "$keep_a" ] || [ "$d" = "$keep_b" ]; } && continue
    n=$((n + 1))
    [ "$n" -gt "$KEEP" ] && rm -rf "$d"
  done < <(ls -1t "$HOME_DIR/releases" 2>/dev/null)
  rm -rf "$HOME_DIR"/releases/.incoming-* 2>/dev/null || true
}

apply() {
  if ! ensure_repo; then log "kein Repository eingestellt (LESEKOMPASS_REPO_URL) – automatische Updates sind aus"; return 0; fi
  if ! fetch_branch; then
    local err; err="$(tr '\n' ' ' <"$HOME_DIR/.fetch-error" | cut -c1-300)"
    if [ "$(cat "$HOME_DIR/.fetch-failing" 2>/dev/null)" != "$err" ]; then log "konnte $BRANCH nicht holen: ${err:-unbekannter Fehler} (versuche es leise weiter)"; fi
    echo "$err" >"$HOME_DIR/.fetch-failing"
    return 3
  fi
  rm -f "$HOME_DIR/.fetch-failing"

  local full short live
  full="$(git -C "$HOME_DIR/repo" rev-parse "refs/remotes/origin/$BRANCH" 2>/dev/null)" || { log "Zweig '$BRANCH' nicht im Repository gefunden"; return 3; }
  short="${full:0:12}"
  live="$(current_build || true)"

  if [ "$short" = "$live" ]; then [ "$MODE" = check ] && echo "aktuell ($live)"; return 0; fi
  if [ "$MODE" = check ]; then echo "Update verfügbar: ${live:-keine} -> $short"; return 10; fi
  if [ "$FORCE" = 0 ] && [ "$short" = "$(cat "$HOME_DIR/failed" 2>/dev/null || true)" ]; then return 0; fi

  local rel="$HOME_DIR/releases/$short" tmp="$HOME_DIR/releases/.incoming-$short"
  if [ ! -f "$rel/BUILD" ]; then
    log "neue Version $short gefunden – wird gebaut und geprüft"
    rm -rf "$tmp" "$rel"; mkdir -p "$tmp"
    if ! { git -C "$HOME_DIR/repo" archive "$full" | tar -x -C "$tmp"; } 2>"$HOME_DIR/.archive-error"; then
      log "konnte $short nicht entpacken: $(tr '\n' ' ' <"$HOME_DIR/.archive-error" | cut -c1-200)"; rm -rf "$tmp"; return 1
    fi
    if ! build_release "$tmp" "$short"; then
      log "NICHT aktualisiert auf $short: Bauen/Testen fehlgeschlagen, $live läuft weiter. $(tail -n 6 "$HOME_DIR/.build-output" | tr '\n' ' ' | cut -c1-500)"
      echo "$short" >"$HOME_DIR/failed"; rm -rf "$tmp"
      return 1
    fi
    echo "$short" >"$tmp/BUILD"
    mv "$tmp" "$rel"
  fi

  # --- Selbsttest, bevor irgendetwas umgeschaltet wird
  local out rc
  out="$(cd "$rel" && env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$NODE" server/server.ts --selftest 2>&1)"; rc=$?
  [ "$rc" != 0 ] && [ -z "$out" ] && out="Selbsttest endete mit Status $rc ohne Meldung"
  for f in "$rel"/deploy/*.sh; do [ -f "$f" ] && ! bash -n "$f" 2>/dev/null && { out="$out; $(basename "$f") hat einen Syntaxfehler"; rc=1; }; done
  if [ "$rc" != 0 ]; then
    log "NICHT aktualisiert auf $short: Selbsttest fehlgeschlagen, $live läuft weiter. $(echo "$out" | tail -n 4 | tr '\n' ' ' | cut -c1-400)"
    echo "$short" >"$HOME_DIR/failed"
    return 1
  fi

  # --- umschalten
  local old oldprev; old="$(current_dir)"; oldprev="$(previous_dir)"
  [ -n "$old" ] && [ "$old" != "$rel" ] && point previous "$old"
  point current "$rel"
  log "umgeschaltet ${live:-(nichts)} -> $short; Neustart"
  restart_server

  if manages_restart; then
    if wait_healthy "$short"; then
      log "Update auf $short läuft und ist gesund"
      rm -f "$HOME_DIR/failed"; echo "$short" >"$HOME_DIR/healthy"
    else
      log "der Server meldet $short nicht innerhalb von ${HEALTH_TIMEOUT}s – $live kommt zurück"
      if [ -n "$old" ] && [ -d "$old" ]; then
        point current "$old"
        if [ -n "$oldprev" ] && [ -d "$oldprev" ]; then point previous "$oldprev"; else rm -f "$HOME_DIR/previous"; fi
        restart_server
        wait_healthy "$live" && log "zurückgesetzt: $live läuft wieder" || log "WARNUNG: auch $live meldet sich nicht gesund; siehe Server-Log"
      fi
      echo "$short" >"$HOME_DIR/failed"
      return 1
    fi
  else
    log "Update auf $short liegt bereit; es gilt ab dem nächsten Serverstart"
    rm -f "$HOME_DIR/failed"
  fi
  prune
  return 0
}

if [ "$MODE" = status ]; then status; exit 0; fi
acquire_lock || { [ "$MODE" = check ] || echo "ein anderes Update läuft bereits" >&2; exit 0; }
trap release_lock EXIT
case "$MODE" in
  rollback) do_rollback; exit $? ;;
  *) apply; exit $? ;;
esac
