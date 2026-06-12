# FFW Alarmsystem

Web-App zur Alarmierung für die freiwillige Feuerwehr – bestehend aus zwei Teilen:

1. **Planung & Alarmierung** – Fahrzeuge und Einsätze anlegen, speichern, Fahrzeuge disponieren und alarmieren.
2. **Alarmmonitor** – Vollbild-Ansicht für die Wache: bei Alarm Karte mit Einsatzort + disponierte Fahrzeuge, sonst die Statusübersicht aller Fahrzeuge.

Alle Geräte teilen sich denselben Stand über einen kleinen Server. Änderungen erscheinen **live** auf dem Monitor (Server-Sent Events, mit automatischem Polling-Fallback).

## Technik

- **Frontend:** React + Vite (`client/`)
- **Backend:** Node.js + Express, Speicherung in `server/data/db.json` (`server/`)
- **Karte:** Google Maps JavaScript API

## Einrichtung

Voraussetzung: Node.js 18+.

```bash
# im Projektordner
npm install
```

`npm install` installiert automatisch die Abhängigkeiten von `server/` und `client/`.

### Google-Maps-API-Key hinterlegen

Die Karte und die Adresssuche brauchen einen Google-Maps-Schlüssel:

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen.
2. Unter **APIs & Services → Library** die **Maps JavaScript API** und (für die Adresssuche) die **Geocoding API** aktivieren.
3. Unter **APIs & Services → Credentials** einen API-Key erstellen.
4. Den Key eintragen:

```bash
cp client/.env.example client/.env
# danach in client/.env:
# VITE_GOOGLE_MAPS_API_KEY=DEIN_SCHLUESSEL
```

> Ohne Key funktioniert die App trotzdem – die Karte zeigt dann einen Platzhalter mit Koordinaten und einem Link zu Google Maps. Koordinaten lassen sich im Einsatzformular auch manuell als Lat/Lng eintragen.

## Starten

### Entwicklung (zwei Prozesse, automatisches Neuladen)

```bash
npm run dev
```

- Planung: <http://localhost:5173/planung>
- Alarmmonitor: <http://localhost:5173/monitor> (öffnet sich aus der Planung über den Menüpunkt im neuen Tab)

Der Vite-Dev-Server leitet `/api`-Anfragen an den Backend-Server auf Port 3001 weiter.

### Produktion (ein Prozess)

```bash
npm run build          # baut das Frontend nach client/dist
npm start              # Server liefert API + Frontend auf Port 3001
```

Dann alles unter <http://localhost:3001> erreichbar. Den Monitor-Rechner auf der Wache einfach auf `/monitor` zeigen lassen.

## Im lokalen Netz erreichbar (z. B. Monitor auf anderem Gerät)

Der Server lauscht auf allen Netzwerk-Interfaces (`0.0.0.0`). Andere Geräte im selben WLAN/LAN (Tablet, zweiter Rechner, Smart-TV-Browser) können den Monitor direkt aufrufen.

1. **Server starten** – empfohlen im Produktionsmodus (ein Prozess):
   ```bash
   npm run build
   npm start
   ```
   Beim Start zeigt der Server die Netzwerk-Adressen an, z. B.:
   ```
   Im Netz: http://192.168.178.20:3001   (Monitor: http://192.168.178.20:3001/monitor)
   ```
2. **Auf dem anderen Gerät** im Browser diese Adresse öffnen, für den Monitor `…:3001/monitor`.
3. **Firewall:** Beim ersten Start fragt Windows ggf., ob Node.js im Netzwerk kommunizieren darf → **zulassen** (privates Netz). Unter macOS ggf. die Firewall-Freigabe für `node` bestätigen.

> Im Entwicklungsmodus (`npm run dev`) ist der Vite-Server ebenfalls im Netz erreichbar (`http://<IP>:5173`); für den Dauerbetrieb auf der Wache ist aber der Produktionsmodus (Port 3001) besser geeignet.

Hinweis: Die Adresse hängt an der IP des Server-Rechners. Vergibt der Router per DHCP wechselnde IPs, lohnt sich eine feste IP/DHCP-Reservierung für den Server, damit die Monitor-URL gleich bleibt.

## Bedienung

### Fahrzeuge
Im Reiter **Fahrzeuge**: Funkrufname, Typ, Besatzung und Funkstatus (1–6) anlegen. Der Status lässt sich jederzeit direkt in der Liste umschalten.

### Einsätze & Alarmierung
Im Reiter **Einsätze**: Stichwort, Adresse (Button „Auf Karte suchen" ermittelt die Koordinaten), Priorität, Beschreibung und die zu disponierenden Fahrzeuge auswählen.

- **🚨 Alarmieren** setzt den Einsatz auf *aktiv*. Der Funkstatus der Fahrzeuge wird dabei **nicht** automatisch geändert – die Besatzung meldet ihren Status (z. B. 3 = Anfahrt) selbst. Der Alarmmonitor wechselt sofort in die Einsatzansicht. Eine Alarmierung ist nur möglich, wenn mindestens ein einsatzbereites Fahrzeug (Status 1/2) disponiert ist.
- **Beenden** schließt den Einsatz und setzt die Fahrzeuge zurück auf Status 2.

### Alarmmonitor
- **Kein Alarm:** Übersicht aller Fahrzeuge mit Status und Anzahl einsatzbereiter Fahrzeuge.
- **Aktiver Alarm:** Stichwort, Adresse, Laufzeit, disponierte Fahrzeuge und der Einsatzort auf der Karte. Mehrere gleichzeitige Einsätze werden unterstützt.
- **Akustischer Alarm:** Bei einer (Nach-)Alarmierung ertönt ein Gong, danach wird der Einsatz vorgelesen (Stichwort, Straße + Hausnummer, disponierte Fahrzeuge). Browser blockieren Ton bis zur ersten Interaktion – den Monitor einmal anklicken bzw. auf 🔔 tippen. Im Reiter **Alarmton** lässt sich eine eigene Gong-Datei hochladen und die Stimme wählen.

## Sprachansage mit Piper (offline, natürlichere Stimme)

Standardmäßig nutzt der Monitor die Browser-Sprachausgabe. Für eine natürlicher klingende, **männliche** Stimme ohne Cloud nutzt der Server [Piper](https://github.com/rhasspy/piper). Binary und Stimmmodell werden mit einem Befehl ins Projekt geladen:

```bash
npm run setup:piper
```

Das lädt die zur Plattform passende Piper-Binary und das deutsche Modell `de_DE-thorsten-medium` (~63 MB) nach `server/vendor/piper/`. Danach erkennt der Server Piper automatisch – einfach neu starten (`npm run dev` bzw. `npm start`). Im Reiter **Alarmton** wird der Status angezeigt („Offline-Sprachsynthese (Piper) aktiv"), und der Alarmmonitor liest den Einsatz mit dieser Stimme vor.

Eigene Pfade/Stimme lassen sich per Umgebungsvariablen überschreiben:

```bash
# Windows (PowerShell)
$env:PIPER_BIN = "C:\pfad\piper.exe"; $env:PIPER_MODEL = "C:\pfad\stimme.onnx"; npm start
# Linux/macOS
PIPER_BIN=/opt/piper/piper PIPER_MODEL=/opt/piper/stimme.onnx npm start
```

Ist Piper nicht eingerichtet, dient die im Reiter **Alarmton** gewählte Browser-Stimme als Rückfall.

## Standalone-Build (.exe – ohne Node/npm starten)

Die gesamte App lässt sich in **eine eigenständige Windows-`.exe`** packen (Node-Runtime, Backend und gebautes Frontend sind enthalten). Auf dem Zielrechner muss **nichts** installiert sein.

```bash
npm run dist
```

Ergebnis: **`dist/alarmsystem-win.exe`** (~70 MB). Einfach starten (Doppelklick oder per Konsole) – der Server läuft dann auf Port 3001, alles unter <http://localhost:3001> bzw. der im Konsolenfenster angezeigten Netz-Adresse.

**Wichtig / gut zu wissen:**
- **Daten** werden in einem Ordner `data/` **neben der `.exe`** abgelegt (wird beim ersten Start angelegt) – einfach mitkopieren/sichern.
- **Google-Maps-Key:** Der Schlüssel wird **beim Bauen** aus `client/.env` ins Frontend übernommen. Also vor `npm run dist` den Key in `client/.env` eintragen, sonst ist in der `.exe` keiner enthalten.
- **Piper-Sprachausgabe (optional):** den Ordner `server/vendor/piper` neben die `.exe` nach `dist/vendor/piper` kopieren. Ohne Piper nutzt die Ansage die Browser-Stimme.
- **Port ändern:** `PORT`-Umgebungsvariable setzen, z. B. (PowerShell) `$env:PORT=8080; .\alarmsystem-win.exe`.

### Für macOS / Linux bauen

```bash
npm run dist:mac     # macOS: Apple Silicon (arm64) + Intel (x64)
npm run dist:all     # Windows + macOS + Linux
# oder gezielt:
node scripts/build-exe.mjs win mac-arm linux
```
Ergebnisse in `dist/`: `alarmsystem-macos-arm64`, `alarmsystem-macos-x64`, `alarmsystem-linux`. Die Builds funktionieren auch **plattformübergreifend** (z. B. macOS-Programm unter Windows bauen).

**macOS-Programm startklar machen** (einmalig auf dem Mac, da unter Windows erzeugte Binaries unsigniert sind):
```bash
chmod +x ./alarmsystem-macos-arm64
xattr -dr com.apple.quarantine ./alarmsystem-macos-arm64   # Gatekeeper-Quarantäne entfernen
codesign --force --sign - ./alarmsystem-macos-arm64        # Ad-hoc-Signatur (für Apple Silicon nötig)
./alarmsystem-macos-arm64
```
(Bei Intel-Macs `…-macos-x64` verwenden; die `codesign`-Zeile ist dort meist nicht zwingend.) Sauberer/ohne diese Schritte ist es, die App **direkt auf einem Mac** mit `npm run dist:mac` zu bauen.

## Docker

Die App lässt sich auch als Docker-Container betreiben (Backend + gebautes Frontend in einem Image).

```bash
# Image bauen
npm run docker:build
# (entspricht:  docker build -t ffw-alarmsystem .)

# Container starten (Port 3001, Daten als benanntes Volume)
npm run docker:run
# (entspricht:  docker run --rm -p 3001:3001 -v ffw-data:/app/server/data ffw-alarmsystem)
```

Danach erreichbar unter <http://localhost:3001> bzw. `http://<host-ip>:3001/monitor`.

**Hinweise:**
- **Daten** liegen im Container unter `/app/server/data`. Mit `-v ffw-data:/app/server/data` (oder einem Host-Pfad) bleiben sie über Neustarts erhalten.
- **Google-Maps-Key** beim Bauen mitgeben (wird ins Frontend eingebacken):
  ```bash
  docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=DEIN_SCHLUESSEL -t ffw-alarmsystem .
  ```
  Alternativ vor dem Build den Key in `client/.env` eintragen.
- **Port ändern:** `-e PORT=8080 -p 8080:8080`.
- **Piper-Sprachausgabe (optional):** den passenden Linux-Piper-Ordner als Volume einhängen: `-v /pfad/piper:/app/server/vendor/piper`. Ohne Piper nutzt die Ansage die Browser-Stimme.

### Mit Docker Compose

Einfacher Dauerbetrieb inkl. Daten-Volume und Auto-Neustart:

```bash
npm run docker:up      # docker compose up -d --build
npm run docker:down    # docker compose down
```

Der Google-Maps-Key kann über eine `.env`-Datei im Projektordner gesetzt werden (Compose liest sie automatisch):

```bash
# .env
VITE_GOOGLE_MAPS_API_KEY=DEIN_SCHLUESSEL
PORT=3001
```

Die Daten liegen im benannten Volume `ffw-data`. Für Piper die entsprechende Zeile in [docker-compose.yml](docker-compose.yml) einkommentieren.

## Funkstatus (FMS)

| Status | Bedeutung |
|--------|-----------|
| 1 | Einsatzbereit über Funk |
| 2 | Einsatzbereit auf Wache |
| 3 | Einsatz übernommen / Anfahrt |
| 4 | Am Einsatzort |
| 5 | Sprechwunsch |
| 6 | Nicht einsatzbereit |

## Projektstruktur

```
alarming/
├─ server/              Express-Backend
│  └─ src/
│     ├─ index.js       REST-API + SSE-Live-Stream
│     └─ db.js          JSON-Persistenz
├─ client/              React-Frontend (Vite)
│  └─ src/
│     ├─ pages/
│     │  ├─ Planung.jsx Fahrzeug- & Einsatzverwaltung, Alarmierung
│     │  └─ Monitor.jsx Alarmmonitor
│     ├─ components/    MapView, StatusBadge
│     ├─ api.js         API-Client
│     ├─ useLiveState.js Live-Daten via SSE
│     └─ useGoogleMaps.js Karten-/Geocoding-Loader
└─ package.json         Workspaces + Start-Skripte
```

## Hinweise

- Die Daten liegen in `server/data/db.json` (wird beim ersten Start angelegt). Für ein Backup einfach diese Datei sichern.
- Für den Produktivbetrieb auf der Wache empfiehlt sich, den Server als Dienst laufen zu lassen (z. B. via `pm2` oder systemd).
