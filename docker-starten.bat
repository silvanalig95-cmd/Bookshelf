@echo off
rem Lesekompass in Docker Desktop einrichten und starten - laeuft neben Olympus, auf Port 8080.
rem Doppelklick genuegt (Docker Desktop muss laufen). Beim ersten Mal oeffnet sich Notepad fuer den Login.
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker wurde nicht gefunden. Docker Desktop starten, warten bis "Engine running" steht, dann nochmal.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker ist installiert, laeuft aber nicht. Docker Desktop starten, warten bis "Engine running" steht, dann nochmal.
  pause
  exit /b 1
)

if not exist deploy\lesekompass.env (
  copy deploy\lesekompass.env.example deploy\lesekompass.env >nul
  echo.
  echo Erstes Mal: Ich habe deploy\lesekompass.env angelegt. Notepad oeffnet sich gleich.
  echo Trage bei LESEKOMPASS_AUTH= einen Login ein, z. B.  LESEKOMPASS_AUTH=ich:ein-langes-passwort
  echo Speichern und Notepad schliessen - dann geht es automatisch weiter.
  echo.
  notepad deploy\lesekompass.env
)

echo.
echo Der Lesekompass-Container wird gebaut und gestartet. Beim ersten Mal dauert das ein paar Minuten ...
docker compose -f deploy/docker-compose.yml up -d --build
if errorlevel 1 (
  echo.
  echo Das hat nicht geklappt. Bitte die letzten Zeilen oben an Claude schicken.
  pause
  exit /b 1
)

echo.
echo Fertig! Der Lesekompass laeuft:
echo     auf diesem PC:          http://localhost:8080/
echo     im Heimnetz:            http://%COMPUTERNAME%:8080/
echo     oder mit der IP-Adresse (siehe "IPv4"), z. B. http://192.168.1.50:8080/
ipconfig | findstr /c:"IPv4"
echo.
echo Neue Versionen holt sich der Container selbst (jede Minute), du musst nichts tun.
start "" http://localhost:8080/
pause
