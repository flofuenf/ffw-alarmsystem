import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { load, save } from "./db.js";
import { buildAlarmfaxPdf } from "./alarmfax.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DATA_DIR = join(__dirname, "..", "data");
const GONG_FILE = join(DATA_DIR, "gong.bin");
const ALARMFAX_DIR = join(DATA_DIR, "alarmfax");

// Offline-Sprachsynthese mit Piper (https://github.com/rhasspy/piper)
// Standardmaessig wird das ins Repo integrierte Piper unter server/vendor/piper
// genutzt (per `npm run setup:piper` geladen). Ueberschreibbar via Umgebung:
//   PIPER_BIN   = Pfad zur Piper-Executable
//   PIPER_MODEL = Pfad zum Stimmmodell .onnx
const VENDOR_PIPER = join(__dirname, "..", "vendor", "piper");
const DEFAULT_PIPER_BIN = join(VENDOR_PIPER, "piper", process.platform === "win32" ? "piper.exe" : "piper");
const DEFAULT_PIPER_MODEL = join(VENDOR_PIPER, "de_DE-thorsten-medium.onnx");
const PIPER_BIN = process.env.PIPER_BIN || (existsSync(DEFAULT_PIPER_BIN) ? DEFAULT_PIPER_BIN : "piper");
const PIPER_MODEL = process.env.PIPER_MODEL || (existsSync(DEFAULT_PIPER_MODEL) ? DEFAULT_PIPER_MODEL : "");
const piperAvailable = () => !!PIPER_MODEL && existsSync(PIPER_MODEL);

// Funkstatus-Bezeichnungen fuer das Einsatztagebuch
const FMS_LABEL = { 1: "Einsatzbereit (Funk)", 2: "Einsatzbereit (Wache)", 3: "Anfahrt", 4: "Am Einsatzort", 5: "Sprechwunsch", 6: "Nicht einsatzbereit" };

// Eintrag ins Einsatztagebuch eines Einsatzes schreiben
function logEvent(m, text, type = "event") {
  if (!m.log) m.log = [];
  m.log.push({ id: nanoid(6), at: new Date().toISOString(), type, text });
}

// Alarmfax-PDF erzeugen/aktualisieren und ablegen
function erstelleAlarmfax(m, logText = "Alarmfax automatisch erstellt") {
  m.alarmfaxAt = new Date().toISOString();
  logEvent(m, logText, "alarm");
  buildAlarmfaxPdf(m, state.vehicles, state.settings?.station)
    .then((buf) => {
      if (!existsSync(ALARMFAX_DIR)) mkdirSync(ALARMFAX_DIR, { recursive: true });
      writeFileSync(join(ALARMFAX_DIR, `${m.id}.pdf`), buf);
    })
    .catch((e) => console.error("Alarmfax-Erstellung fehlgeschlagen:", e.message));
}

const app = express();
app.use(cors());
app.use(express.json());

// ---- In-Memory-State (aus Datei geladen, in Datei gespeichert) ----
let state = load();

function persist() {
  save(state);
  broadcast();
}

// ---- Server-Sent Events fuer Live-Updates (Alarmmonitor) ----
const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  clients.add(res);
  // Keep-alive Ping
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.get("/api/state", (req, res) => res.json(state));

// ===================== EINSTELLUNGEN / STANDORT =====================
app.get("/api/settings", (req, res) => res.json(state.settings));

app.put("/api/settings/station", (req, res) => {
  const { name, adresse, lat, lng } = req.body || {};
  const s = state.settings.station || (state.settings.station = {});
  if (name !== undefined) s.name = name;
  if (adresse !== undefined) s.adresse = adresse;
  if (lat !== undefined) s.lat = lat === "" || lat === null ? null : Number(lat);
  if (lng !== undefined) s.lng = lng === "" || lng === null ? null : Number(lng);
  persist();
  res.json(state.settings.station);
});

// Status der Offline-Sprachsynthese (Piper) abfragen
app.get("/api/tts/status", (req, res) => {
  res.json({ available: piperAvailable(), model: PIPER_MODEL ? basename(PIPER_MODEL) : null });
});

// Text per Piper zu Sprache (WAV) synthetisieren
app.get("/api/tts", (req, res) => {
  const text = String(req.query.text || "").slice(0, 1000).trim();
  if (!text) return res.status(400).json({ error: "kein Text" });
  if (!piperAvailable()) return res.status(503).json({ error: "Piper nicht konfiguriert" });

  const outFile = join(tmpdir(), `ffw-tts-${nanoid(8)}.wav`);
  const proc = spawn(PIPER_BIN, ["--model", PIPER_MODEL, "--output_file", outFile]);
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  proc.on("error", (e) => {
    if (!res.headersSent) res.status(500).json({ error: "Piper-Start fehlgeschlagen: " + e.message });
  });
  proc.on("close", (code) => {
    if (code !== 0 || !existsSync(outFile)) {
      if (!res.headersSent) res.status(500).json({ error: "Piper-Synthese fehlgeschlagen", detail: stderr.slice(0, 300) });
      return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.send(readFileSync(outFile));
    try { unlinkSync(outFile); } catch {}
  });
  proc.stdin.write(text);
  proc.stdin.end();
});

// Sprachausgabe-Stimme (Name der gewuenschten TTS-Stimme) speichern
app.put("/api/settings/tts", (req, res) => {
  const { voice } = req.body || {};
  state.settings.tts = { voice: typeof voice === "string" ? voice : "" };
  persist();
  res.json(state.settings.tts);
});

// Eigene Gong-Audiodatei hochladen (Rohdaten, Typ aus Content-Type)
app.put("/api/settings/gong", express.raw({ type: () => true, limit: "10mb" }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: "Keine Audiodaten empfangen" });
  const mime = req.headers["content-type"] || "audio/mpeg";
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(GONG_FILE, req.body);
  state.settings.gong = { hasCustom: true, mime, updatedAt: new Date().toISOString() };
  persist();
  res.json(state.settings.gong);
});

// Eigene Gong-Datei entfernen (zurueck zum Standard-Gong)
app.delete("/api/settings/gong", (req, res) => {
  if (existsSync(GONG_FILE)) unlinkSync(GONG_FILE);
  state.settings.gong = { hasCustom: false, mime: null, updatedAt: null };
  persist();
  res.json(state.settings.gong);
});

// Gong-Datei ausliefern (vom Alarmmonitor abgespielt)
app.get("/api/gong", (req, res) => {
  const g = state.settings.gong;
  if (!g?.hasCustom || !existsSync(GONG_FILE)) return res.status(404).end();
  res.setHeader("Content-Type", g.mime || "audio/mpeg");
  res.send(readFileSync(GONG_FILE));
});

// ===================== FAHRZEUGE =====================
app.get("/api/vehicles", (req, res) => res.json(state.vehicles));

// Personalliste normalisieren: [{ funktion, name }]
function normPersonal(personal) {
  if (!Array.isArray(personal)) return [];
  return personal
    .map((p) => ({ funktion: String(p?.funktion || "").trim(), name: String(p?.name || "").trim() }))
    .filter((p) => p.funktion || p.name);
}

app.post("/api/vehicles", (req, res) => {
  const { funkrufname, typ, besatzung, status, bemerkung, extern, abteilung, personal } = req.body || {};
  if (!funkrufname) return res.status(400).json({ error: "funkrufname erforderlich" });
  const vehicle = {
    id: nanoid(8),
    funkrufname,
    typ: typ || "",
    besatzung: Number(besatzung) || 0,
    status: Number(status) || 2,
    bemerkung: bemerkung || "",
    extern: !!extern, // Fahrzeug einer fremden Abteilung (nicht auf dem Alarmmonitor)
    abteilung: abteilung || "", // Name der fremden Abteilung (optional)
    personal: normPersonal(personal), // Besatzung mit Funktionsbezeichnung
    status3At: null, // Zeitpunkt des Wechsels auf Status 3 (fuer Positionsschaetzung)
  };
  state.vehicles.push(vehicle);
  persist();
  res.status(201).json(vehicle);
});

app.put("/api/vehicles/:id", (req, res) => {
  const v = state.vehicles.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: "Fahrzeug nicht gefunden" });
  const { funkrufname, typ, besatzung, status, bemerkung, extern, abteilung, personal } = req.body || {};
  if (funkrufname !== undefined) v.funkrufname = funkrufname;
  if (typ !== undefined) v.typ = typ;
  if (besatzung !== undefined) v.besatzung = Number(besatzung) || 0;
  if (extern !== undefined) v.extern = !!extern;
  if (abteilung !== undefined) v.abteilung = abteilung;
  if (personal !== undefined) v.personal = normPersonal(personal);
  if (status !== undefined) {
    const neu = Number(status);
    const alt = v.status;
    // Beim Wechsel AUF Status 3 (Anfahrt) Startzeit merken, sonst zuruecksetzen
    if (neu === 3 && v.status !== 3) v.status3At = new Date().toISOString();
    else if (neu !== 3) v.status3At = null;
    v.status = neu;
    // Statuswechsel in aktiven Einsaetzen protokollieren (z. B. Eintreffen = Status 4)
    if (alt !== neu) {
      for (const m of state.missions) {
        if (m.status === "aktiv" && (m.vehicleIds || []).includes(v.id)) {
          logEvent(m, `${v.funkrufname}: Status ${neu} – ${FMS_LABEL[neu] || ""}`, "status");
        }
      }
    }
  }
  if (bemerkung !== undefined) v.bemerkung = bemerkung;
  persist();
  res.json(v);
});

app.delete("/api/vehicles/:id", (req, res) => {
  const before = state.vehicles.length;
  state.vehicles = state.vehicles.filter((x) => x.id !== req.params.id);
  // aus allen Einsaetzen entfernen
  for (const m of state.missions) {
    m.vehicleIds = (m.vehicleIds || []).filter((id) => id !== req.params.id);
    m.entferntIds = (m.entferntIds || []).filter((id) => id !== req.params.id);
  }
  if (state.vehicles.length === before) return res.status(404).json({ error: "Fahrzeug nicht gefunden" });
  persist();
  res.status(204).end();
});

// ===================== EINSAETZE =====================
app.get("/api/missions", (req, res) => res.json(state.missions));

// Zur Planung darf ein Fahrzeug mehreren Einsaetzen zugeordnet werden.
// Es ist jedoch nur "verfuegbar" (alarmierbar), wenn es einsatzbereit ist
// (Status 1/2) und nicht bereits in einem anderen AKTIVEN Einsatz alarmiert wurde.
function fahrzeugAktivBelegt(vehicleId, exceptMissionId) {
  return state.missions.some(
    (m) => m.id !== exceptMissionId && m.status === "aktiv" && (m.vehicleIds || []).includes(vehicleId)
  );
}

function fahrzeugVerfuegbar(vehicleId, exceptMissionId) {
  const v = state.vehicles.find((x) => x.id === vehicleId);
  return !!v && (v.status === 1 || v.status === 2) && !fahrzeugAktivBelegt(vehicleId, exceptMissionId);
}

app.post("/api/missions", (req, res) => {
  const { stichwort, adresse, lat, lng, beschreibung, prioritaet, vehicleIds, alarmZeit, autoAlarm, mitteiler, objekt, personalAnzeigen } = req.body || {};
  if (!stichwort) return res.status(400).json({ error: "stichwort erforderlich" });
  const mission = {
    id: nanoid(8),
    stichwort,
    adresse: adresse || "",
    lat: lat ?? null,
    lng: lng ?? null,
    beschreibung: beschreibung || "",
    mitteiler: mitteiler || "", // Mitteiler/Tel. (fuer Alarmfax)
    objekt: objekt || "", // Objekt (fuer Alarmfax)
    personalAnzeigen: !!personalAnzeigen, // Personal der Fahrzeuge auf dem Alarmmonitor anzeigen
    prioritaet: prioritaet || "normal",
    alarmZeit: alarmZeit || null, // geplante Alarmzeit (datetime-local)
    autoAlarm: !!autoAlarm, // automatisch zur Alarmzeit alarmieren
    status: "offen", // offen | aktiv | abgeschlossen
    vehicleIds: Array.isArray(vehicleIds) ? vehicleIds : [],
    createdAt: new Date().toISOString(),
    alarmiertAt: null,
    alarmfaxAt: null,
    nachalarmiertAt: null,
    nachalarmiertIds: [],
    entferntIds: [], // aus dem Einsatz entlassene Fahrzeuge (bleiben auf dem Monitor sichtbar)
    log: [], // Einsatztagebuch (automatische Ereignisse + manuelle Notizen)
  };
  state.missions.push(mission);
  persist();
  res.status(201).json(mission);
});

app.put("/api/missions/:id", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  const fields = ["stichwort", "adresse", "lat", "lng", "beschreibung", "prioritaet", "status", "vehicleIds", "alarmZeit", "autoAlarm", "mitteiler", "objekt", "personalAnzeigen"];
  for (const f of fields) {
    if (req.body[f] === undefined) continue;
    if (f === "vehicleIds") {
      // Zur Planung sind alle Fahrzeuge zulaessig (Verfuegbarkeit wird beim Alarmieren geprueft)
      m.vehicleIds = Array.isArray(req.body.vehicleIds) ? req.body.vehicleIds : [];
      // wieder zugeordnete Fahrzeuge nicht mehr als "entlassen" fuehren
      m.entferntIds = (m.entferntIds || []).filter((id) => !m.vehicleIds.includes(id));
    } else {
      m[f] = req.body[f];
    }
  }
  persist();
  res.json(m);
});

// Manuelle Notiz zum Einsatztagebuch hinzufuegen
app.post("/api/missions/:id/note", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Notiz darf nicht leer sein" });
  logEvent(m, text, "note");
  persist();
  res.json(m);
});

// Alarmfax als PDF abrufen (bei Alarmierung erzeugte Datei, sonst on-the-fly)
app.get("/api/missions/:id/alarmfax", async (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  try {
    const file = join(ALARMFAX_DIR, `${m.id}.pdf`);
    const buf = existsSync(file) ? readFileSync(file) : await buildAlarmfaxPdf(m, state.vehicles, state.settings?.station);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="alarmfax-${m.id}.pdf"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: "Alarmfax konnte nicht erstellt werden" });
  }
});

app.delete("/api/missions/:id", (req, res) => {
  const before = state.missions.length;
  state.missions = state.missions.filter((x) => x.id !== req.params.id);
  if (state.missions.length === before) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  const fax = join(ALARMFAX_DIR, `${req.params.id}.pdf`);
  if (existsSync(fax)) { try { unlinkSync(fax); } catch {} }
  persist();
  res.status(204).end();
});

// Fahrzeug aus dem Einsatz entlassen: aus den aktiven Fahrzeugen entfernen,
// aber als "entlassen" vermerken (bleibt auf dem Alarmmonitor sichtbar/markiert).
app.post("/api/missions/:id/release", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  const { vehicleId } = req.body || {};
  if (!vehicleId || !(m.vehicleIds || []).includes(vehicleId)) {
    return res.status(400).json({ error: "Fahrzeug ist diesem Einsatz nicht zugeordnet" });
  }
  m.vehicleIds = m.vehicleIds.filter((id) => id !== vehicleId);
  m.entferntIds = [...new Set([...(m.entferntIds || []), vehicleId])];
  const fz = state.vehicles.find((x) => x.id === vehicleId);
  logEvent(m, `${fz?.funkrufname || "Fahrzeug"} aus Einsatz entlassen`, "release");
  persist();
  res.json(m);
});

// Einsatz alarmieren: aktiv setzen. Der Funkstatus der Fahrzeuge wird NICHT
// automatisch geaendert – die Besatzung meldet ihren Status selbst.
app.post("/api/missions/:id/alarm", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  // Erstalarmierung nur moeglich, wenn ALLE geplanten Fahrzeuge verfuegbar sind.
  // Bei bereits aktivem Einsatz ist eine erneute Alarmierung weiterhin erlaubt.
  if (m.status !== "aktiv") {
    const ids = m.vehicleIds || [];
    if (ids.length === 0) return res.status(400).json({ error: "Kein Fahrzeug disponiert" });
    if (!ids.every((id) => fahrzeugVerfuegbar(id, m.id))) {
      return res.status(400).json({ error: "Nicht alle geplanten Fahrzeuge sind verfügbar" });
    }
  }
  // andere aktive Einsaetze bleiben aktiv (Mehrfachalarm moeglich)
  const erstalarm = m.status !== "aktiv";
  m.status = "aktiv";
  m.alarmiertAt = new Date().toISOString();
  logEvent(m, erstalarm ? "Einsatz alarmiert" : "Erneut alarmiert", "alarm");
  if (erstalarm) erstelleAlarmfax(m);
  persist();
  res.json(m);
});

// Nachalarmierung: weitere Fahrzeuge dem laufenden Einsatz hinzufuegen und alarmieren
app.post("/api/missions/:id/nachalarm", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  if (m.status === "abgeschlossen") return res.status(400).json({ error: "Einsatz ist bereits abgeschlossen" });
  const requested = Array.isArray(req.body?.vehicleIds) ? req.body.vehicleIds : [];
  // nur noch nicht disponierte, einsatzbereite (Status 1/2) Fahrzeuge nachalarmieren
  const neu = requested.filter(
    (id) => !(m.vehicleIds || []).includes(id) && fahrzeugVerfuegbar(id, m.id)
  );
  if (neu.length === 0) return res.status(400).json({ error: "Keine einsatzbereiten Fahrzeuge zum Nachalarmieren" });
  m.vehicleIds = [...(m.vehicleIds || []), ...neu];
  m.nachalarmiertIds = [...(m.nachalarmiertIds || []), ...neu];
  m.entferntIds = (m.entferntIds || []).filter((id) => !neu.includes(id)); // wieder aktiv
  m.status = "aktiv";
  m.nachalarmiertAt = new Date().toISOString();
  const namen = neu.map((id) => state.vehicles.find((v) => v.id === id)?.funkrufname).filter(Boolean).join(", ");
  logEvent(m, `Nachalarmierung: ${namen}`, "alarm");
  erstelleAlarmfax(m, "Alarmfax aktualisiert (Nachalarmierung)");
  // Funkstatus bleibt unveraendert – die Besatzung meldet selbst.
  persist();
  res.json(m);
});

// Einsatz beenden: abgeschlossen, Fahrzeuge zurueck auf Status 2
app.post("/api/missions/:id/close", (req, res) => {
  const m = state.missions.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Einsatz nicht gefunden" });
  m.status = "abgeschlossen";
  // entferntIds bleibt erhalten, damit entlassene Fahrzeuge im beendeten Einsatz sichtbar bleiben
  for (const id of m.vehicleIds || []) {
    const v = state.vehicles.find((x) => x.id === id);
    if (v) {
      v.status = 2; // einsatzbereit auf Wache
      v.status3At = null;
    }
  }
  logEvent(m, "Einsatz beendet", "close");
  persist();
  res.json(m);
});

// ---- Auto-Alarm fuer vorgeplante Einsaetze ----
// Prueft regelmaessig, ob ein offener Einsatz mit aktiviertem Auto-Alarm
// seine geplante Alarmzeit erreicht hat, und alarmiert ihn dann automatisch.
function checkScheduledAlarms() {
  const now = Date.now();
  let changed = false;
  for (const m of state.missions) {
    if (m.status !== "offen" || !m.autoAlarm || !m.alarmZeit) continue;
    const t = new Date(m.alarmZeit).getTime();
    if (isNaN(t) || t > now) continue;
    // Auto-Alarm nur, wenn Fahrzeuge disponiert und ALLE verfuegbar sind
    const ids = m.vehicleIds || [];
    if (ids.length === 0 || !ids.every((id) => fahrzeugVerfuegbar(id, m.id))) continue;
    m.status = "aktiv";
    m.alarmiertAt = new Date().toISOString();
    logEvent(m, "Einsatz automatisch alarmiert (geplante Alarmzeit)", "alarm");
    erstelleAlarmfax(m);
    changed = true;
    console.log(`Auto-Alarm: Einsatz "${m.stichwort}" automatisch alarmiert.`);
  }
  if (changed) persist();
}
setInterval(checkScheduledAlarms, 15000);

// ---- Statisches Frontend (Produktion) ----
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => res.sendFile(join(clientDist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`FFW-Alarmsystem-Server laeuft auf http://localhost:${PORT}`);
});
