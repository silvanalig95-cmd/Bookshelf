# Lesekompass in Docker Desktop – neben Olympus

So läuft der Lesekompass genauso wie deine Yoga-App **Olympus**: in einem eigenen Docker-Container, der beim Windows-Start mitstartet, im Heimnetz erreichbar ist und sich **selbst aktualisiert**. Sobald Claude eine Änderung auf GitHub hochlädt, holt der Container sie innerhalb einer Minute, baut und testet sie und schaltet erst dann um. Klappt etwas nicht, läuft die bisherige Version einfach weiter.

Deine Bibliothek, Merkliste und Einstellungen liegen dabei auf dem Server: **Handy, Tablet und PC haben immer denselben Stand.**

| | Olympus | Lesekompass |
|---|---|---|
| Ordner | `C:\Unfurl` | `C:\Lesekompass` |
| Adresse auf dem PC | <http://localhost/> | **<http://localhost:8080/>** |
| Im Heimnetz | `http://PCNAME/` | **`http://PCNAME:8080/`** |
| Einstellungen | `deploy\unfurl.env` | `deploy\lesekompass.env` |
| Container in Docker Desktop | `unfurl` | `lesekompass` |

Die beiden Container sind völlig getrennt: Du kannst den einen neu bauen oder stoppen, ohne den anderen zu berühren.

### Zwei Apps auf einem PC – warum sie sich nicht in die Quere kommen

Beide Apps laufen auf demselben PC, also unter derselben IP-Adresse – aber an verschiedenen **Ports** (wie zwei Wohnungen im selben Haus):

| Adresse | führt zu |
|---|---|
| `http://PCNAME/` (ohne Zahl = Port 80) | Olympus (Yoga) |
| `http://PCNAME:8080/` | Lesekompass |

* **Doppelt belegen geht gar nicht:** Ist ein Port schon besetzt, startet Docker den zweiten Container nicht und meldet `port is already allocated`. Es kann also nie passieren, dass unter einer Adresse plötzlich die falsche App erscheint.
* **Nachsehen:** Docker Desktop → *Containers* → Spalte *Port(s)*: bei *unfurl* steht `80:…`, bei *lesekompass* `8080:8080`. Oder in PowerShell: `docker ps --format "table {{.Names}}\t{{.Ports}}"`.
* **Bequem öffnen:** Auf jedem Gerät je ein Lesezeichen anlegen („Yoga“ → `http://PCNAME/`, „Bücher“ → `http://PCNAME:8080/`). Auf dem Handy im Browser-Menü „Zum Startbildschirm hinzufügen“ – dann hast du zwei App-Symbole.
* **Mit Tailscale** bekommt jede App ihren eigenen HTTPS-Port (siehe unten) – auch dort bleiben sie getrennt.

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

> Der Login ist optional, aber empfohlen: Ohne Login kann jedes Gerät in deinem Netzwerk den Lesekompass öffnen (und deine Bibliothek ändern), und ein Claude-Schlüssel auf dem Server bleibt gesperrt. Der Login bestimmt auch, **welche Bibliothek** du siehst – mehr dazu unter „Deine Daten“.

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

## Deine Daten – auf allen Geräten gleich

Bibliothek, Bewertungen, Merkliste, Swipe-Geschmack und die Einstellungen (Region, Shop, Sprache, Anna’s Archive, KI-Modell) liegen **auf dem Server**. Jedes Gerät, das den Lesekompass mit deinem Login öffnet, hat denselben Stand: auf dem Handy gemerkt, am PC sofort da. Goodreads musst du nur einmal verbinden.

* **Offline:** Ohne Verbindung arbeitest du normal weiter. Änderungen gehen raus, sobald der Server wieder erreichbar ist. Haben zwei Geräte dasselbe Buch geändert, gilt die spätere Änderung.
* **Pro Gerät** bleiben nur das Design (hell/dunkel) und API-Schlüssel, die du im Browser eingetragen hast.
* **Mehrere Personen:** Jedes Login in `LESEKOMPASS_AUTH` hat seine eigene Bibliothek, z. B. `LESEKOMPASS_AUTH=ich:passwort1;partner:passwort2`. Ohne Login teilen sich alle Geräte im Netz eine Bibliothek.
* **Schon Daten auf einem Gerät?** Beim ersten Abgleich wird zusammengeführt. Was schon auf dem Server liegt, hat Vorrang; was nur auf dem Gerät liegt, kommt dazu.
* **Status:** Unten in der App steht „☁️ Geräte abgeglichen“. Unter **Einstellungen → Geräte abgleichen** siehst du Details, kannst sofort abgleichen oder den Abgleich auf einem Gerät ausschalten.

**Wo liegen die Daten?** Im Docker-Volume des Containers, Ordner `/srv/lesekompass/data` – eine Datei pro Login. Updates, Neubauten (`docker-neu-bauen.bat`) und Neustarts berühren sie nicht. Zusätzlich legt der Server jeden Tag eine Sicherung an (`data/sicherungen`, die letzten 14 Tage).

> **Achtung:** `docker compose … down -v` (mit **-v**) löscht das Volume und damit deine Daten. Zum Stoppen immer ohne `-v`.

**Selbst eine Kopie ziehen** (z. B. für OneDrive):

```powershell
cd C:\Lesekompass
docker compose -f deploy/docker-compose.yml cp lesekompass:/srv/lesekompass/data .\daten-sicherung
```

Die Datei-Sicherung in der App gibt es weiterhin: **Bibliothek → Goodreads & Daten → Sicherung herunterladen**. Zurückspielen ersetzt dann den Stand auf allen Geräten.

---

## Optional: KI für alle Geräte (Gemini gratis oder Claude)

Für „KI fragen“ und den KI-Bibliothekar. Am einfachsten und gratis ist **Google Gemini**:

1. Auf <https://aistudio.google.com/apikey> mit deinem Google-Konto anmelden und **„API-Schlüssel erstellen“** klicken.
2. Den Schlüssel in `deploy\lesekompass.env` eintragen (der Login muss gesetzt sein):

```
GEMINI_API_KEY=dein-schlüssel
```

Der Gratis-Tarif hat Minuten- und Tageslimits (AI Studio zeigt sie unter *Rate limit*). Ist das Kontingent von *Gemini 3.8 Flash* aufgebraucht, antwortet automatisch *Gemini 3.5 Flash-Lite*; das Tageslimit setzt sich um 9 Uhr zurück. Im Gratis-Tarif darf Google die Anfragen – also auch deine Leseliste – zur Verbesserung seiner Produkte verwenden.

Lieber **Claude** von Anthropic (kostet wenige Rappen pro Frage)? Dann stattdessen oder zusätzlich `ANTHROPIC_API_KEY=sk-ant-...` eintragen. Welcher Anbieter antwortet, wählst du in der App unter **Einstellungen → KI**.

Dann übernehmen:

```powershell
cd C:\Lesekompass
docker compose -f deploy/docker-compose.yml up -d --force-recreate
```

Der Schlüssel bleibt im Container; der Browser sieht ihn nie. Alle Geräte mit Login können „KI fragen“ und den KI-Bibliothekar nutzen. In der App unter **Einstellungen → KI** auf „Verbindung testen“ klicken.

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
| Statt „KI fragen“ steht „KI-Empfehlungen aktivieren“ | `GEMINI_API_KEY` (oder `ANTHROPIC_API_KEY`) **und** `LESEKOMPASS_AUTH` setzen, dann `up -d --force-recreate`. Oder den Schlüssel in der App unter Einstellungen eintragen. |
| „Gratis-Kontingent von Gemini aufgebraucht“ | Kurz warten (Minutenlimit) bzw. bis 9 Uhr (Tageslimit). Unter Einstellungen → KI „Gemini 3.5 Flash-Lite“ wählen – es hat ein grösseres Kontingent. |
| Container startet immer wieder neu | `docker compose -f deploy/docker-compose.yml logs --tail 50` und die letzten Zeilen an Claude schicken. |
| Unten steht „⚠️ Abgleich gestört“ | Einstellungen → Geräte abgleichen zeigt den Grund. Bei „Bitte neu anmelden“ die Seite neu laden. Sonst die Logs (siehe oben) an Claude schicken – deine Daten bleiben auf dem Gerät und gehen beim nächsten erfolgreichen Abgleich raus. |
| Auf einem Gerät fehlt etwas | Einstellungen → Geräte abgleichen → **Alles neu vom Server holen**. |
| Auf einem Gerät sind fremde Bücher | Prüfen, mit welchem Login das Gerät angemeldet ist (Einstellungen → Geräte abgleichen zeigt „Aktiv für …“). |
