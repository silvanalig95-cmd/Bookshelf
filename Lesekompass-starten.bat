@echo off
rem Lesekompass starten (Windows): Doppelklick genuegt.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und dieses Skript erneut starten.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Erster Start: Pakete werden installiert ...
  call npm install || (pause & exit /b 1)
)
call npm start
