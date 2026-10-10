#!/bin/bash
# Lesekompass starten (macOS/Linux): Doppelklick genügt.
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und dieses Skript erneut starten."
  read -r -p "Enter zum Schliessen …"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Erster Start: Pakete werden installiert …"
  npm install || { read -r -p "Installation fehlgeschlagen. Enter zum Schliessen …"; exit 1; }
fi
npm start
