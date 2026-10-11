# 🧭 Lesekompass

**Bücher entdecken, Ausgaben vergleichen, Angebote finden – auf Deutsch zuerst.**

Lesekompass ist eine Web-App, mit der du auf viele verschiedene Arten neue Bücher findest: über eine ausführliche Suche mit Stimmungen, Orten und Epochen, über deine eigenen Worte, über Empfehlungen aus deiner Goodreads-Bibliothek und über verspielte Modi wie Swipen, Glücksrad oder ein Lese-Orakel. Zu jedem Buch siehst du alle Ausgaben (wie bei Goodreads) und direkt die Bezugsquellen – mit Amazon.de als Standard-Shop, Preisvergleich und Anna’s Archive.

---

## Was alles drin ist

| Bereich | Was er kann |
|---|---|
| 🔎 **Ausführliche Suche** | Wunsch in eigenen Worten („wie *Der Schatten des Windes*, aber kürzer und in Wien“), Stichwörter, 34 Genres (einschliessen *oder* ausschliessen), 18 Stimmungen, Tempo, Anspruch, Bekanntheit (Geheimtipp ↔ Bestseller), Länge, Schauplatz, Epoche, Erscheinungsjahr, Figuren, Autor:in, „ähnlich wie …“, Ausschlusswörter, Mindestbewertung, Sprache. Jedes Ergebnis bekommt eine **Trefferquote in %** und **Begründungen** („🕵️ Krimi · 📍 Skandinavien · 🇩🇪 auf Deutsch“). „🎲 Würfeln“ erzeugt zufällige Kombinationen. |
| 📖 **Buchseite** | Deutsche Zusammenfassung aus Wikipedia, Klappentext (mit DeepL-Übersetzungslink), Themen, Orte, Figuren, erster Satz. **Alle Ausgaben** mit Filter nach Sprache und Format – deutsche Ausgaben zuerst. Cover, ISBN und Angebote wechseln mit der gewählten Ausgabe. |
| 🛒 **Angebote** | **Amazon.de als Standard-Shop** (Lieferung in die Schweiz), Orell Füssli, Ex Libris, Thalia, Hugendubel, Preisvergleich (eurobuch, BookFinder), Gebrauchtes (booklooker, medimops, reBuy, ZVAB), E-Books & Hörbücher, Bibliotheken (WorldCat, swisscovery, DNB, Onleihe), **Anna’s Archive** (per ISBN und per Titel) – alles ISBN-genau. |
| 💛 **Für dich** | Algorithmische Empfehlungen aus deinem Geschmacksprofil: Top-Treffer, „Weil du X mochtest“, Lieblingsautor:innen, Geheimtipps und „Über den Tellerrand“. |
| 🃏 **Bücher-Swipe** | Karten wischen (Maus, Finger oder Pfeiltasten). Der Stapel lernt live, welche Themen dich anziehen. |
| 🎡 **Glücksrad & Blind Date** | Das Rad wählt Genre, Stimmung, Ort, Epoche oder eines deiner Themen – dann lernst du drei Bücher zuerst nur über ihren ersten Satz kennen. |
| 🔮 **Lese-Orakel** | Sieben verspielte Fragen → Lesepersönlichkeit und passende Bücher. |
| 🕸️ **Themen-Netz** | Interaktiver Graph: von Thema zu Thema, Ort oder Epoche springen und unterwegs Bücher finden. |
| ✨ **KI-Bibliothekar** *(optional)* | Chat mit Google Gemini (gratis) oder Claude – die KI kennt deine gelesenen Bücher. Empfehlungen erscheinen als anklickbare Buchkarten. Auch in der Suche: „✨ KI fragen“. |
| 📚 **Bibliothek & Lese-DNA** | Goodreads-Import, Merkliste, Bewertungen, Statistiken (Bücher pro Jahr, Sterne, Genres, Autor:innen, Jahrzehnte, Themen, Orte) und eine Lesepersönlichkeit. |

Alle deine Daten (Bibliothek, Merkliste, Einstellungen) bleiben **bei dir**: im Browser – oder, mit der Docker-Installation, auf deinem eigenen Server, damit Handy, Tablet und PC denselben Stand haben. Es gibt kein Konto bei Dritten.

---

## Schnellstart

Du brauchst [Node.js](https://nodejs.org/) ab Version 22 (einfach die aktuelle „LTS“-Version herunterladen und installieren).

```bash
git clone https://github.com/silvanalig95-cmd/Bookshelf.git
cd Bookshelf
npm install
npm start
```

Der Browser öffnet sich mit **http://localhost:4173**. Fertig.

Ohne Terminal: Doppelklick auf **`Lesekompass-starten.command`** (macOS) bzw. **`Lesekompass-starten.bat`** (Windows) – das Skript installiert beim ersten Mal alles Nötige und startet die App.

**Dauerhaft in Docker Desktop (neben Olympus):** siehe **[deploy/DOCKER.md](deploy/DOCKER.md)** – Doppelklick auf `docker-starten.bat`, danach läuft der Lesekompass unter <http://localhost:8080/>, ist im Heimnetz erreichbar und aktualisiert sich selbst, sobald eine neue Version auf GitHub liegt.

> `npm start` baut die App und startet einen kleinen lokalen Server. Der wird für zwei Dinge gebraucht: das direkte Verbinden mit Goodreads und – falls du willst – einen Claude-Schlüssel, der nie im Browser landet.

---

## Goodreads verbinden

Goodreads vergibt seit 2020 keine API-Schlüssel mehr. Lesekompass bietet deshalb zwei Wege (unter **Bibliothek → Goodreads & Daten**):

1. **Profil verbinden (empfohlen):** Profil-URL eingeben, z. B. `https://www.goodreads.com/user/show/12345678-name`. Lesekompass lädt deine Regale *Gelesen*, *Lese ich gerade* und *Will ich lesen* inklusive Bewertungen, Lesedaten und Klappentexten. Voraussetzung: Dein Profil ist öffentlich (Goodreads → Settings → Privacy → „anyone“). Erneut synchronisieren geht jederzeit.
2. **CSV-Export:** Auf Goodreads unter [Import and export](https://www.goodreads.com/review/import) „Export Library“ klicken und die Datei `goodreads_library_export.csv` in Lesekompass ablegen.

Danach ordnet Lesekompass deine Bücher im Hintergrund den Werken bei Open Library zu (meist > 95 %), um Themen, Orte und Epochen zu kennen. Daraus entstehen Geschmacksprofil, Empfehlungen und die Lese-DNA. Gelesene Bücher werden in allen Suchen automatisch ausgeblendet.

---

## Preise & Angebote – was geht und was nicht

- **Amazon.de** ist als Standard-Shop eingestellt und wird überall zuerst gezeigt (ISBN-genaue Suche, mit Lieferhinweis für die Schweiz). Amazon stellt Preise nur über das Partnerprogramm (PA-API) bereit, das an ein aktives Affiliate-Konto mit Umsätzen gebunden ist – deshalb zeigt Lesekompass keine Amazon-Live-Preise, sondern führt per Klick direkt zur richtigen Ausgabe.
- **Live-Preise** gibt es für E-Books bei Google Play, wenn du einen (kostenlosen) Google-Books-Schlüssel einträgst.
- **Preisvergleich:** eurobuch (.ch/.de/.at je nach Region) vergleicht über 100 Shops inklusive Gebrauchtangeboten.
- **Buchpreisbindung:** In Deutschland und Österreich kosten neue deutschsprachige Bücher überall gleich viel – sparen kann man nur gebraucht oder bei E-Book-Aktionen. In der Schweiz gibt es keine Buchpreisbindung; da lohnt sich der Vergleich. Lesekompass weist auf der Buchseite passend darauf hin.
- **Anna’s Archive** wechselt häufig die Adresse. Unter **Einstellungen → Anna’s Archive** kannst du einen Spiegel auswählen oder die aktuelle Adresse eintragen.

---

## Optionale Erweiterungen

### ✨ KI: Google Gemini (gratis) oder Claude

Für „KI fragen“ in der Suche und den KI-Bibliothekar brauchst du einen API-Schlüssel – Anbieter und Modell wählst du unter **Einstellungen → KI**:

- **Google Gemini** – gratis mit Minuten- und Tageslimit. Schlüssel auf [aistudio.google.com/apikey](https://aistudio.google.com/apikey) erstellen. Standard ist *Gemini 3.8 Flash*; jedes Gemini-Modell hat ein eigenes Gratis-Kontingent, ist eines aufgebraucht, antwortet automatisch das nächste (3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite). Im Gratis-Tarif darf Google die Anfragen zur Verbesserung seiner Produkte verwenden.
- **Claude** von Anthropic – Schlüssel von [console.anthropic.com](https://console.anthropic.com/settings/keys), Abrechnung nach Verbrauch (mit Claude Opus 5.5 typischerweise 5–15 Rappen pro Anfrage, mit Sonnet oder Haiku deutlich weniger).

**Empfohlen – Schlüssel bleibt auf deinem Computer:** Datei `.env` im Projektordner anlegen (Vorlage: `.env.example`):

```
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
```

(einer genügt) und `npm start` neu ausführen. Alternativ kannst du den Schlüssel unter **Einstellungen → KI** eintragen; er wird dann nur in diesem Browser gespeichert.

Die KI bekommt dabei eine kompakte Zusammenfassung deiner Bibliothek (Lieblingsbücher, Abneigungen, gelesene Titel), damit sie nichts Gelesenes empfiehlt und deinen Geschmack trifft. Kurzbeschreibungen auf der Buchseite sind sparsam: günstiges Modell, kaum „Nachdenken“, nur ein knapper Lesekontext – und mit Server wird jede Beschreibung nur einmal erzeugt und dann auf allen Geräten gezeigt.

**Ausweich-Kanäle:** Ist das Gemini-Kontingent ganz aufgebraucht, springen der Reihe nach Gratis-Dienste ein – [Mistral](https://console.mistral.ai/api-keys), [Groq](https://console.groq.com/keys) und [OpenRouter](https://openrouter.ai/settings/keys) (Schlüssel als `MISTRAL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` in der `.env` oder unter **Einstellungen → KI**), zuletzt Claude, falls eingerichtet. Das Modell wählt die App automatisch aus der aktuellen Modellliste des Anbieters.

### 📗 Google Books

Ergänzt deutsche Klappentexte, E-Book-Preise und Titel, die Open Library nicht kennt. Ohne eigenen Schlüssel ist das geteilte Gratis-Kontingent praktisch immer aufgebraucht, deshalb fragt Lesekompass Google Books nur mit eigenem Schlüssel an: [Books API aktivieren](https://console.cloud.google.com/apis/library/books.googleapis.com) → „Anmeldedaten“ → API-Schlüssel erstellen → unter **Einstellungen → Google Books** eintragen.

---

## Docker (empfohlen für den Dauerbetrieb)

Der Container baut die App, startet den Server (`server/server.ts`) und prüft jede Minute, ob es auf GitHub eine neue Version gibt. Bibliothek, Merkliste, Swipe-Geschmack und Einstellungen werden dabei **zwischen allen Geräten abgeglichen** (pro Login, mit täglicher Sicherung im Docker-Volume). Neue Versionen werden neben der laufenden gebaut, getestet (Typprüfung, Unit-Tests, Selbsttest) und erst dann umgeschaltet; meldet sich der Server danach nicht gesund, kommt die vorherige Version automatisch zurück. Offene Seiten zeigen dann „Neu laden“.

```bash
cp deploy/lesekompass.env.example deploy/lesekompass.env   # Login & optional Claude-Schlüssel eintragen
docker compose -f deploy/docker-compose.yml up -d --build
```

Schritt-für-Schritt für Windows: **[deploy/DOCKER.md](deploy/DOCKER.md)**.

## Online stellen (optional)

Lesekompass lässt sich auch als statische Website betreiben, z. B. über **GitHub Pages**:

1. Im Repository unter *Settings → Pages* als Quelle „GitHub Actions“ wählen.
2. Unter *Actions* den Workflow **„Auf GitHub Pages veröffentlichen“** manuell starten.

Auf einer statischen Installation gibt es keinen lokalen Server: Goodreads geht dann per CSV-Export, Claude per Schlüssel im Browser. Alles andere funktioniert gleich.

---

## Datenquellen

- [Open Library](https://openlibrary.org/developers/api) (Internet Archive): Suche, Werke, Ausgaben, Cover, Themen – frei und ohne Anmeldung
- [Wikipedia](https://de.wikipedia.org/): deutschsprachige Zusammenfassungen
- [Goodreads](https://www.goodreads.com/): deine Regale (RSS-Feed bzw. CSV-Export)
- [Google Books](https://developers.google.com/books) *(optional)*: Klappentexte und E-Book-Preise
- [Claude](https://www.anthropic.com/) *(optional)*: KI-Empfehlungen

---

## Für Entwickler:innen

```bash
npm run dev        # Entwicklungsserver mit Hot Reload (http://localhost:5173)
npm test           # Unit-Tests (Vitest)
npm run typecheck  # TypeScript prüfen
npm run build      # Produktions-Build nach dist/
```

**Technik:** React + TypeScript + Vite, Zustand (Zustände, Bibliothek in IndexedDB), Papa Parse (CSV), Anthropic SDK. Keine UI-Bibliothek – eigenes CSS mit hellem „Papier“- und dunklem „Nachtbibliothek“-Design.

```
server/localApi.ts      Lokale API: Goodreads-RSS-Abruf, Claude-/Gemini-Proxy, Geräte-Abgleich
server/server.ts        Produktions-Server (Docker): App ausliefern, Login, /healthz, Selbsttest
server/syncStore.ts     Datenablage für den Geräte-Abgleich (pro Login, jüngste Änderung gewinnt)
src/lib/syncEngine.ts   Abgleich im Browser: Änderungen erkennen, übertragen, übernehmen
deploy/                 Docker-Rezept und Update-Automatik (run.sh, update.sh)
src/lib/openLibrary.ts  Open-Library-Anbindung (Suche, Werke, Ausgaben, Themen)
src/lib/discovery.ts    Entdecken-Suche: Wunsch verstehen, Anfragen planen, bewerten
src/lib/profile.ts      Geschmacksprofil (TF-IDF über Themen, Bewertungen, Aktualität)
src/lib/recommend.ts    „Für dich“-Empfehlungen
src/lib/taxonomy.ts     Genres, Stimmungen, Epochen, Orte, deutsche Themen-Labels
src/lib/shops.ts        Shops, Preisvergleich, Bibliotheken, Anna’s Archive
src/lib/goodreads.ts    CSV/RSS-Import und Abgleich mit Open Library
src/lib/ai.ts           KI: strukturierte Empfehlungen und Chat (gemini.ts, claude.ts, aiPrompts.ts)
src/pages/              Die einzelnen Seiten
tests/                  Unit-Tests mit Beispieldaten
```

Shops oder Links ergänzen: `src/lib/shops.ts`. Genres und Stimmungen anpassen: `src/lib/taxonomy.ts`.
