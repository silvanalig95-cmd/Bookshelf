# Lesekompass in Docker Desktop – neben Olympus

So läuft der Lesekompass genauso wie deine Yoga-App **Olympus**: in einem eigenen Docker-Container, der beim Windows-Start mitstartet, im Heimnetz erreichbar ist und sich **selbst aktualisiert**. Sobald Claude eine Änderung auf GitHub hochlädt, holt der Container sie innerhalb einer Minute, baut und testet sie und schaltet erst dann um. Klappt etwas nicht, läuft die bisherige Version einfach weiter.

| | Olympus | Lesekompass |
|---|---|---|
| Ordner | `C:\Unfurl` | `C:\Lesekompass` |
| Adresse auf dem PC | <http://localhost/> | **<http://localhost:8080/>** |
| Im Heimnetz | `http://PCNAME/` | **`http://PCNAME:8080/`** |
| Einstellungen | `deploy\unfurl.env` | `deploy\lesekompass.env` |
| Container in Docker Desktop | `unfurl` | `lesekompass` |

Die beiden Container sind völlig getrennt: Du kannst den einen neu bauen oder stoppen, ohne den anderen zu berühren.

---

## Einrichten (einmalig, ca. 10 Minuten)

Docker Desktop ist bei dir schon installiert und läuft (wegen Olympus). Prüfen: Docker Desktop zeigt *Engine running*.

**1. Den Lesekompass holen.** In PowerShell:

```powershell
cd C:\
git clone https://github.com/silvanalig95-cmd/Bookshelf.git Lesekompass
```

*Ohne Git:* <https://github.com/silvanalig95-cmd/Bookshelf/archive/refs/heads/claude/book-search-recommendation-tool-2w5p6a.zip> herunterladen, entpacken und den Ordner (der, in dem `docker-starten.bat` liegt) nach `C:\Lesekompass` verschieben. Nicht in einen OneDrive-Ordner legen.

**2. Doppelklick auf `C:\Lesekompass\docker-starten.bat`.**

Beim ersten Mal öffnet sich Notepad mit `deploy\lesekompass.env`. Trag bei `LESEKOMPASS_AUTH=` einen Login ein, zum Beispiel:

```
LESEKOMPASS_AUTH=ich:ein-langes-passwort
```

Speichern, Notepad schliessen – das Skript baut dann den Container (beim ersten Mal ein paar Minuten) und öffnet <http://localhost:8080/>. Der Browser fragt nach Name und Passwort.

> Der Login ist optional, aber empfohlen: Ohne Login kann jedes Gerät in deinem Netzwerk den Lesekompass öffnen, und ein Claude-Schlüssel auf dem Server bleibt gesperrt.

**3. Firewall für das Heimnetz** (einmal, PowerShell **als Administrator**):

```powershell
netsh advfirewall firewall add rule name="Lesekompass" dir=in action=allow protocol=TCP localport=8080 profile=private
```

Danach öffnest du den Lesekompass auf Handy, Tablet oder Laptop mit `http://PCNAME:8080/` (Name des PCs: `hostname` in PowerShell) oder `http://192.168.x.y:8080/` (die IPv4-Adresse zeigt `docker-starten.bat` an).

**4. Prüfen, ob alles läuft:**

* Docker Desktop → *Containers*: **lesekompass** hat einen grünen Punkt.
* <http://localhost:8080/healthz> zeigt etwas wie `{"ok":true,"app":"lesekompass","version":"1.0.0","build":"1a2b3c4d5e6f"}`.
* Ganz unten in der App steht `Lesekompass 1.0.0 · Build 1a2b3c4`.

Damit ist alles erledigt. Weil der Container `restart: unless-stopped` hat, startet er mit Docker Desktop automatisch – genau wie Olympus.

---

## Wie Updates ankommen

```
Claude ändert etwas  →  Push auf GitHub (Zweig claude/book-search-recommendation-tool-2w5p6a)
jede Minute im Container:  holen → bauen → Typprüfung & Tests → Selbsttest → umschalten → Gesundheitscheck
        └ schlägt etwas fehl: die bisherige Version läuft weiter (bzw. kommt automatisch zurück)
offene Seiten zeigen „Eine neue Version des Lesekompass ist bereit – Neu laden“
```

**Nachsehen, was passiert ist:**

```powershell
cd C:\Lesekompass
docker compose -f deploy/docker-compose.yml logs --tail 30
docker compose -f deploy/docker-compose.yml exec lesekompass /srv/lesekompass/current/deploy/update.sh --status
```

Typische Zeilen: `Update auf 1a2b3c4d5e6f läuft und ist gesund` · `NICHT aktualisiert auf …: Bauen/Testen fehlgeschlagen, … läuft weiter` · `… kommt zurück`.

**Neu bauen nötig?** Nur wenn sich das Container-Rezept selbst ändert (`Dockerfile`, `docker-compose.yml`, `deploy\run.sh`) – Claude sagt dann Bescheid. Dann Doppelklick auf **`docker-neu-bauen.bat`**: Es lädt das neueste Rezept, baut den Container neu und startet ihn. Deine `deploy\lesekompass.env` bleibt erhalten.

---

## Deine Daten

Bibliothek, Merkliste, Bewertungen und Einstellungen speichert der Lesekompass **im Browser des jeweiligen Geräts** (nicht im Container). Updates, Neubauten oder ein gelöschter Container berühren sie nicht.

Das heisst auch: Dein Handy und dein PC haben je eine eigene Bibliothek. Am einfachsten verbindest du Goodreads auf jedem Gerät einmal. Alternativ: **Bibliothek → Goodreads & Daten → Sicherung herunterladen** auf dem einen Gerät und **Wiederherstellen** auf dem anderen.

> Wichtig: Die Daten hängen an der Adresse. `http://localhost:8080` und `http://PCNAME:8080` sind für den Browser zwei verschiedene Orte – nimm auf jedem Gerät immer dieselbe Adresse (Lesezeichen!).

---

## Optional: KI mit Claude für alle Geräte

Trag deinen Schlüssel in `deploy\lesekompass.env` ein (der Login muss gesetzt sein):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Dann übernehmen:

```powershell
cd C:\Lesekompass
docker compose -f deploy/docker-compose.yml up -d --force-recreate
```

Der Schlüssel bleibt im Container; der Browser sieht ihn nie. Alle Geräte mit Login können „KI fragen“ und den KI-Bibliothekar nutzen.

---

## Optional: von unterwegs (Tailscale)

Wenn du für Olympus schon **Tailscale** nutzt, geht das hier genauso – nur mit einem eigenen HTTPS-Port, z. B. 8443:

```powershell
tailscale serve --bg --https=8443 8080
tailscale serve status
```

Dann ist der Lesekompass unter `https://DEINPC.tailXXXX.ts.net:8443/` erreichbar (verschlüsselt, nur für Geräte in deinem Tailnet). Die Befehle von Tailscale ändern sich ab und zu; falls einer abgelehnt wird, hilft die Seite „Tailscale Serve“ in deren Doku.

---

## Praktische Befehle (in `C:\Lesekompass`)

| | |
|---|---|
| Stoppen | `docker compose -f deploy/docker-compose.yml down` |
| Wieder starten | `docker compose -f deploy/docker-compose.yml up -d` |
| Einstellungen geändert | `docker compose -f deploy/docker-compose.yml up -d --force-recreate` |
| Zuschauen | `docker compose -f deploy/docker-compose.yml logs -f` |
| Eine Version zurück | `docker compose -f deploy/docker-compose.yml exec lesekompass /srv/lesekompass/current/deploy/update.sh --rollback` |

---

## Wenn etwas nicht klappt

| Was du siehst | Was hilft |
|---|---|
| `docker-starten.bat` sagt, Docker laufe nicht | Docker Desktop starten, warten bis *Engine running*, nochmal. |
| `port is already allocated` / `Only one usage of each socket address` | Port 8080 ist belegt. In `deploy\docker-compose.yml` die Zeile `- "8080:8080"` z. B. in `- "8081:8080"` ändern, `docker-starten.bat` erneut ausführen und dann `:8081` verwenden. |
| Andere Geräte erreichen die Seite nicht | Firewall-Regel (Schritt 3), Netzwerkprofil „Privat“, PC wach. Zuerst auf dem PC selbst <http://localhost:8080/> testen. |
| Browser fragt immer wieder nach dem Passwort | Name und Passwort genau wie in `LESEKOMPASS_AUTH` eingeben. Nach fünf Fehlversuchen eine Minute warten. |
| Login geändert, aber alter gilt noch | `docker compose -f deploy/docker-compose.yml up -d --force-recreate` (ein einfacher Neustart liest die Datei nicht neu). |
| Build in der Fusszeile ändert sich nicht | Logs ansehen (siehe oben). `konnte … nicht holen` = keine Verbindung zu GitHub; `NICHT aktualisiert` = diese Version wurde abgelehnt, die alte läuft weiter – Claude Bescheid geben. |
| Statt „KI fragen“ steht „KI-Empfehlungen aktivieren“ | `ANTHROPIC_API_KEY` **und** `LESEKOMPASS_AUTH` setzen, dann `up -d --force-recreate`. Oder den Schlüssel in der App unter Einstellungen eintragen. |
| Container startet immer wieder neu | `docker compose -f deploy/docker-compose.yml logs --tail 50` und die letzten Zeilen an Claude schicken. |
