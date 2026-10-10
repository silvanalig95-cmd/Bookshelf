@echo off
rem Holt das neueste Container-Rezept von GitHub und baut den Lesekompass-Container neu.
rem Nur selten noetig (wenn sich Dockerfile, docker-compose.yml oder run.sh aendern - Claude sagt dann Bescheid).
rem Die App-Updates kommen sonst von selbst. Deine Einstellungen (deploy\lesekompass.env) bleiben erhalten.
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker wurde nicht gefunden. Docker Desktop starten und nochmal versuchen.
  pause
  exit /b 1
)

set "BRANCH=claude/book-search-recommendation-tool-2w5p6a"
if exist deploy\lesekompass.env (
  for /f "tokens=1,* delims==" %%a in ('findstr /b "LESEKOMPASS_BRANCH=" deploy\lesekompass.env') do set "BRANCH=%%b"
)
set "ZIP=%TEMP%\lesekompass-latest.zip"
set "OUT=%TEMP%\lesekompass-latest"
set "URL=https://github.com/silvanalig95-cmd/Bookshelf/archive/refs/heads/%BRANCH%.zip"

echo Lade das neueste Rezept (%BRANCH%) von GitHub ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest $env:URL -OutFile $env:ZIP; if (Test-Path $env:OUT) { Remove-Item $env:OUT -Recurse -Force }; Expand-Archive $env:ZIP -DestinationPath $env:OUT; $src = (Get-ChildItem $env:OUT | Select-Object -First 1).FullName; Copy-Item (Join-Path $src '*') '%~dp0' -Recurse -Force"
if errorlevel 1 (
  echo.
  echo Der Download hat nicht geklappt. Internetverbindung pruefen und nochmal versuchen.
  pause
  exit /b 1
)

echo.
echo Baue den Lesekompass-Container neu ...
docker compose -f deploy/docker-compose.yml up -d --build
if errorlevel 1 (
  echo.
  echo Der Neubau ist fehlgeschlagen. Bitte die letzten Zeilen oben an Claude schicken.
  pause
  exit /b 1
)
echo.
echo Fertig. http://localhost:8080/ oeffnen; unten auf der Seite steht der Build.
pause
