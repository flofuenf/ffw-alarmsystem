import { useState, useEffect } from "react";
import { useLiveState } from "../useLiveState.js";
import { api } from "../api.js";
import { STATUS, STATUS_LIST, FAHRZEUG_TYPEN, PRIORITAETEN, istAlarmierbar } from "../constants.js";
import StatusBadge from "../components/StatusBadge.jsx";
import MapView from "../components/MapView.jsx";
import Fahrtzeit from "../components/Fahrtzeit.jsx";
import { geocodeAddress } from "../useGoogleMaps.js";
import { playGong, setCustomGong } from "../gong.js";
import { speak, getVoices, speakServer } from "../speech.js";

export default function Planung() {
  const { vehicles, missions, settings } = useLiveState();
  const [tab, setTab] = useState("einsaetze");

  return (
    <div className="planung">
      <div className="tabs">
        <button className={tab === "einsaetze" ? "active" : ""} onClick={() => setTab("einsaetze")}>
          Einsätze &amp; Alarmierung ({missions.filter((m) => m.status !== "abgeschlossen").length})
        </button>
        <button className={tab === "fahrzeuge" ? "active" : ""} onClick={() => setTab("fahrzeuge")}>
          Fahrzeuge ({vehicles.length})
        </button>
        <button className={tab === "standort" ? "active" : ""} onClick={() => setTab("standort")}>
          Standort
        </button>
        <button className={tab === "alarmton" ? "active" : ""} onClick={() => setTab("alarmton")}>
          Alarmton
        </button>
      </div>

      {tab === "fahrzeuge" ? (
        <Fahrzeuge vehicles={vehicles} />
      ) : tab === "standort" ? (
        <Standort station={settings?.station} />
      ) : tab === "alarmton" ? (
        <Alarmton gong={settings?.gong} tts={settings?.tts} />
      ) : (
        <Einsaetze missions={missions} vehicles={vehicles} station={settings?.station} />
      )}
    </div>
  );
}

/* =========================== STANDORT =========================== */
function Standort({ station }) {
  const [form, setForm] = useState({ name: "", adresse: "", lat: null, lng: null });
  const [loaded, setLoaded] = useState(false);
  const [geoMsg, setGeoMsg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // Standort aus dem Live-State einmalig in das Formular uebernehmen
  if (!loaded && station) {
    setForm({
      name: station.name || "",
      adresse: station.adresse || "",
      lat: station.lat ?? null,
      lng: station.lng ?? null,
    });
    setLoaded(true);
  }

  async function geocode() {
    setGeoMsg("Suche…");
    try {
      const r = await geocodeAddress(form.adresse);
      setForm({ ...form, lat: r.lat, lng: r.lng, adresse: r.formatted });
      setGeoMsg(`Gefunden: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
    } catch (e) {
      setGeoMsg(e.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.updateStation(form);
      setMsg("Standort gespeichert.");
    } catch (e) {
      setErr(e.message);
    }
  }

  const hasCoords = form.lat != null && form.lng != null;

  return (
    <div className="split">
      <section className="card form-card">
        <h2>Feuerwehr-Standort</h2>
        <p className="muted small">
          Dieser Standort ist der Ausgangspunkt der Fahrtstrecke, die bei einem Alarm auf dem Monitor eingezeichnet wird.
        </p>
        <form onSubmit={submit}>
          <label>
            Bezeichnung
            <input
              placeholder="z. B. Feuerwehrhaus Musterstadt"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Adresse
            <div className="inline">
              <input
                placeholder="Straße, PLZ Ort"
                value={form.adresse}
                onChange={(e) => setForm({ ...form, adresse: e.target.value })}
              />
              <button type="button" className="btn-ghost" onClick={geocode} disabled={!form.adresse}>
                📍 Auf Karte suchen
              </button>
            </div>
          </label>
          {geoMsg && <p className="muted small">{geoMsg}</p>}
          <div className="inline">
            <label className="flex1">
              Lat
              <input
                type="number" step="any" placeholder="Breite"
                value={form.lat ?? ""}
                onChange={(e) => setForm({ ...form, lat: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label className="flex1">
              Lng
              <input
                type="number" step="any" placeholder="Länge"
                value={form.lng ?? ""}
                onChange={(e) => setForm({ ...form, lng: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          {err && <p className="error">{err}</p>}
          {msg && <p className="muted small">{msg}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary">Standort speichern</button>
          </div>
        </form>
      </section>

      <section className="card list-card">
        <h2>Vorschau</h2>
        {hasCoords ? (
          <div style={{ height: 320, borderRadius: 10, overflow: "hidden" }}>
            <MapView lat={form.lat} lng={form.lng} label={form.name || "Feuerwehr"} zoom={15} />
          </div>
        ) : (
          <p className="muted">Noch kein Standort gesetzt. Adresse eingeben und „Auf Karte suchen" oder Koordinaten manuell eintragen.</p>
        )}
      </section>
    </div>
  );
}

/* =========================== ALARMTON =========================== */
function Alarmton({ gong, tts }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const hasCustom = !!gong?.hasCustom;

  // Verfuegbare Stimmen (werden teils asynchron geladen)
  const [voices, setVoices] = useState(getVoices());
  const [voiceName, setVoiceName] = useState(tts?.voice || "");
  useEffect(() => {
    const update = () => setVoices(getVoices());
    update();
    if (window.speechSynthesis) window.speechSynthesis.addEventListener?.("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", update);
  }, []);
  useEffect(() => { setVoiceName(tts?.voice || ""); }, [tts?.voice]);

  // Status der Offline-Sprachsynthese (Piper)
  const [piper, setPiper] = useState(null);
  useEffect(() => {
    fetch("/api/tts/status").then((r) => r.json()).then(setPiper).catch(() => setPiper({ available: false }));
  }, []);

  // Deutsche Stimmen zuerst anzeigen
  const voiceListe = [...voices].sort((a, b) => {
    const da = (a.lang || "").toLowerCase().startsWith("de") ? 0 : 1;
    const db = (b.lang || "").toLowerCase().startsWith("de") ? 0 : 1;
    return da - db || a.name.localeCompare(b.name);
  });

  async function saveVoice() {
    setErr(null); setMsg(null);
    try {
      await api.updateTts(voiceName);
      setMsg("Stimme gespeichert.");
    } catch (e) {
      setErr(e.message);
    }
  }

  function testVoice() {
    speak("Brand zwei. Musterstraße zwölf. Es fahren: Florian Musterstadt 1 44 1.", voiceName);
  }

  async function upload(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (!file) { setErr("Bitte zuerst eine Audiodatei auswählen."); return; }
    setBusy(true);
    try {
      await api.uploadGong(file);
      setFile(null);
      e.target.reset?.();
      setMsg("Alarmton gespeichert.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setErr(null); setMsg(null);
    if (!confirm("Eigenen Alarmton entfernen und den Standard-Gong verwenden?")) return;
    setBusy(true);
    try {
      await api.deleteGong();
      setMsg("Standard-Gong wird wieder verwendet.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function test() {
    // aktuell gespeicherten Ton testen (eigene Datei bzw. Standard-Gong)
    setCustomGong(hasCustom ? `/api/gong?t=${encodeURIComponent(gong?.updatedAt || "")}` : null);
    playGong();
  }

  return (
    <div className="split">
      <section className="card form-card">
        <h2>Alarmton (Gong)</h2>
        <p className="muted small">
          Eigene Audiodatei (z. B. MP3, WAV, OGG) für den Gong, der bei einer Alarmierung auf dem Alarmmonitor abgespielt wird.
        </p>
        <form onSubmit={upload}>
          <label>
            Audiodatei
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {err && <p className="error">{err}</p>}
          {msg && <p className="muted small">{msg}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={busy || !file}>
              {busy ? "Wird gespeichert…" : "Hochladen"}
            </button>
            <button type="button" className="btn-ghost" onClick={test} disabled={busy}>
              ▶ Testen
            </button>
          </div>
        </form>

        <hr className="sep" />

        <h2>Sprachansage</h2>
        {piper?.available ? (
          <p className="muted small">
            ✅ <strong>Offline-Sprachsynthese (Piper)</strong> aktiv – Stimme <code>{piper.model}</code>. Der Alarmmonitor liest den Einsatz damit vor. Die Browser-Stimme unten dient nur als Rückfall, falls Piper auf dem Monitor nicht erreichbar ist.
          </p>
        ) : (
          <p className="muted small">
            ℹ️ Piper (Offline-Sprachsynthese) ist nicht konfiguriert – es wird die <strong>Browser-Stimme</strong> verwendet. Einrichtung: siehe README (PIPER_BIN / PIPER_MODEL).
          </p>
        )}
        {piper?.available && (
          <div className="form-actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => speakServer("Brand zwei. Musterstraße zwölf. Es fahren: Florian Musterstadt 1 44 1.").catch(() => {})}
            >
              ▶ Piper-Ansage testen
            </button>
          </div>
        )}

        <label>
          Browser-Stimme (Rückfall)
          <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
            <option value="">Automatisch (natürlichste deutsche Stimme)</option>
            {voiceListe.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang}){v.localService === false ? " · online" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={saveVoice}>Stimme speichern</button>
          <button type="button" className="btn-ghost" onClick={testVoice}>▶ Browser-Ansage testen</button>
        </div>
      </section>

      <section className="card list-card">
        <h2>Aktueller Alarmton</h2>
        <p>
          {hasCustom ? (
            <>🔔 Eigene Audiodatei <span className="muted small">({gong?.mime || "Audio"})</span></>
          ) : (
            <>🔔 Standard-Gong <span className="muted small">(synthetisch erzeugt)</span></>
          )}
        </p>
        {hasCustom && (
          <>
            <audio controls src={`/api/gong?t=${encodeURIComponent(gong?.updatedAt || "")}`} style={{ width: "100%", marginBottom: 12 }} />
            <button className="btn-danger" onClick={reset} disabled={busy}>Standard-Gong wiederherstellen</button>
          </>
        )}
      </section>
    </div>
  );
}

/* =========================== FAHRZEUGE =========================== */
function emptyVehicle() {
  return { funkrufname: "", typ: FAHRZEUG_TYPEN[0], besatzung: "", status: 2, bemerkung: "", extern: false, abteilung: "", personal: [] };
}

function Fahrzeuge({ vehicles }) {
  const [form, setForm] = useState(emptyVehicle());
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    try {
      if (editId) await api.updateVehicle(editId, form);
      else await api.createVehicle(form);
      setForm(emptyVehicle());
      setEditId(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  function edit(v) {
    setEditId(v.id);
    setForm({ funkrufname: v.funkrufname, typ: v.typ, besatzung: v.besatzung, status: v.status, bemerkung: v.bemerkung, extern: !!v.extern, abteilung: v.abteilung || "", personal: (v.personal || []).map((p) => ({ ...p })) });
  }

  function addPerson() {
    setForm({ ...form, personal: [...form.personal, { funktion: "", name: "" }] });
  }
  function updatePerson(i, field, value) {
    setForm({ ...form, personal: form.personal.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)) });
  }
  function removePerson(i) {
    setForm({ ...form, personal: form.personal.filter((_, idx) => idx !== i) });
  }

  async function changeStatus(v, status) {
    await api.updateVehicle(v.id, { status });
  }

  async function remove(v) {
    if (confirm(`Fahrzeug "${v.funkrufname}" wirklich löschen?`)) await api.deleteVehicle(v.id);
  }

  return (
    <div className="split">
      <section className="card form-card">
        <h2>{editId ? "Fahrzeug bearbeiten" : "Neues Fahrzeug"}</h2>
        <form onSubmit={submit}>
          <label>
            Funkrufname *
            <input
              required
              placeholder="z. B. Florian Musterstadt 1/44/1"
              value={form.funkrufname}
              onChange={(e) => setForm({ ...form, funkrufname: e.target.value })}
            />
          </label>
          <label>
            Typ
            <select value={form.typ} onChange={(e) => setForm({ ...form, typ: e.target.value })}>
              {FAHRZEUG_TYPEN.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Besatzung (Sitzplätze)
            <input
              type="number"
              min="0"
              placeholder="z. B. 9"
              value={form.besatzung}
              onChange={(e) => setForm({ ...form, besatzung: e.target.value })}
            />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}>
              {STATUS_LIST.map((s) => (
                <option key={s} value={s}>{STATUS[s].label}</option>
              ))}
            </select>
          </label>
          <label>
            Bemerkung
            <input
              placeholder="optional"
              value={form.bemerkung}
              onChange={(e) => setForm({ ...form, bemerkung: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.extern}
              onChange={(e) => setForm({ ...form, extern: e.target.checked })}
            />
            Fahrzeug einer fremden Abteilung (nicht auf dem Alarmmonitor)
          </label>
          {form.extern && (
            <label>
              Abteilung
              <input
                placeholder="z. B. Abteilung Musterdorf"
                value={form.abteilung}
                onChange={(e) => setForm({ ...form, abteilung: e.target.value })}
              />
            </label>
          )}
          <fieldset className="dispo">
            <legend>Personal</legend>
            {form.personal.length === 0 && (
              <p className="muted small">Kein Personal hinterlegt. Funktion (und optional Name) hinzufügen.</p>
            )}
            {form.personal.map((p, i) => (
              <div key={i} className="person-row">
                <input
                  className="person-funktion"
                  list="funktionen"
                  placeholder="Funktion (z. B. Gruppenführer)"
                  value={p.funktion}
                  onChange={(e) => updatePerson(i, "funktion", e.target.value)}
                />
                <input
                  className="person-name"
                  placeholder="Name (optional)"
                  value={p.name}
                  onChange={(e) => updatePerson(i, "name", e.target.value)}
                />
                <button type="button" className="tag-remove" title="Person entfernen" onClick={() => removePerson(i)}>×</button>
              </div>
            ))}
            <button type="button" className="btn-ghost" onClick={addPerson}>+ Person</button>
            <datalist id="funktionen">
              <option value="Gruppenführer" />
              <option value="Zugführer" />
              <option value="Maschinist" />
              <option value="Angriffstruppführer" />
              <option value="Angriffstruppmann" />
              <option value="Wassertruppführer" />
              <option value="Wassertruppmann" />
              <option value="Schlauchtruppführer" />
              <option value="Schlauchtruppmann" />
              <option value="Melder" />
            </datalist>
          </fieldset>
          {err && <p className="error">{err}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary">{editId ? "Speichern" : "Anlegen"}</button>
            {editId && (
              <button type="button" className="btn-ghost" onClick={() => { setEditId(null); setForm(emptyVehicle()); }}>
                Abbrechen
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card list-card">
        <h2>Fahrzeuge</h2>
        {vehicles.length === 0 && <p className="muted">Noch keine Fahrzeuge angelegt.</p>}
        <div className="vehicle-list">
          {vehicles.map((v) => (
            <div key={v.id} className="vehicle-row">
              <div className="vehicle-main">
                <strong>
                  {v.funkrufname}
                  {v.extern && <span className="extern-tag">Fremde Abteilung{v.abteilung ? `: ${v.abteilung}` : ""}</span>}
                </strong>
                <span className="muted">{v.typ}{v.besatzung ? ` · ${v.besatzung} Sitze` : ""}</span>
                {v.personal?.length > 0 && (
                  <span className="muted small">
                    👤 {v.personal.map((p) => (p.name ? `${p.funktion}: ${p.name}` : p.funktion)).join(" · ")}
                  </span>
                )}
                {v.bemerkung && <span className="muted">{v.bemerkung}</span>}
              </div>
              <div className="vehicle-side">
                <select
                  className="status-select"
                  value={v.status}
                  onChange={(e) => changeStatus(v, Number(e.target.value))}
                  style={{ borderColor: STATUS[v.status]?.color }}
                >
                  {STATUS_LIST.map((s) => (
                    <option key={s} value={s}>{STATUS[s].label}</option>
                  ))}
                </select>
                <div className="row-actions">
                  <button className="btn-ghost" onClick={() => edit(v)}>Bearbeiten</button>
                  <button className="btn-danger" onClick={() => remove(v)}>Löschen</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* =========================== EINSAETZE =========================== */
// Aktuelles lokales Datum/Uhrzeit im Format fuer <input type="datetime-local">
function nowLocalDatetime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyMission() {
  return { stichwort: "", adresse: "", lat: null, lng: null, beschreibung: "", mitteiler: "", objekt: "", prioritaet: "normal", vehicleIds: [], alarmZeit: nowLocalDatetime(), autoAlarm: false };
}

function Einsaetze({ missions, vehicles, station }) {
  const [form, setForm] = useState(emptyMission());
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);
  const [geoMsg, setGeoMsg] = useState(null);

  async function geocode() {
    setGeoMsg("Suche…");
    try {
      const r = await geocodeAddress(form.adresse);
      setForm({ ...form, lat: r.lat, lng: r.lng, adresse: r.formatted });
      setGeoMsg(`Gefunden: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
    } catch (e) {
      setGeoMsg(e.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    try {
      if (editId) await api.updateMission(editId, form);
      else await api.createMission(form);
      setForm(emptyMission());
      setEditId(null);
      setGeoMsg(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  function edit(m) {
    setEditId(m.id);
    setForm({
      stichwort: m.stichwort, adresse: m.adresse, lat: m.lat, lng: m.lng,
      beschreibung: m.beschreibung, mitteiler: m.mitteiler || "", objekt: m.objekt || "",
      prioritaet: m.prioritaet, vehicleIds: m.vehicleIds || [],
      alarmZeit: m.alarmZeit || "", autoAlarm: !!m.autoAlarm,
    });
  }

  // Einsatz als Vorlage in das "Neuer Einsatz"-Formular uebernehmen (neuer Einsatz, kein Edit)
  function copy(m) {
    setEditId(null);
    setForm({
      stichwort: m.stichwort, adresse: m.adresse, lat: m.lat, lng: m.lng,
      beschreibung: m.beschreibung, mitteiler: m.mitteiler || "", objekt: m.objekt || "",
      prioritaet: m.prioritaet, vehicleIds: m.vehicleIds || [],
      alarmZeit: nowLocalDatetime(), autoAlarm: false,
    });
    setErr(null);
    setGeoMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleVehicle(id) {
    const has = form.vehicleIds.includes(id);
    setForm({
      ...form,
      vehicleIds: has ? form.vehicleIds.filter((x) => x !== id) : [...form.vehicleIds, id],
    });
  }

  const sorted = [...missions].sort((a, b) => {
    const rank = { aktiv: 0, offen: 1, abgeschlossen: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Fahrzeug -> aktiver Einsatz, in dem es bereits alarmiert ist.
  // Zur Planung sind alle Fahrzeuge frei wählbar; die Verfügbarkeit wird erst
  // in der Übersicht/bei der Alarmierung anhand der AKTIVEN Einsätze geprüft.
  const aktivBelegt = {};
  for (const mm of missions) {
    if (mm.status !== "aktiv") continue;
    for (const id of mm.vehicleIds || []) aktivBelegt[id] = mm.id;
  }

  return (
    <div className="split split-3">
      <section className="card form-card">
        <h2>{editId ? "Einsatz bearbeiten" : "Neuer Einsatz"}</h2>
        <form onSubmit={submit}>
          <label>
            Einsatzstichwort *
            <input
              required
              placeholder="z. B. B2 – Wohnungsbrand"
              value={form.stichwort}
              onChange={(e) => setForm({ ...form, stichwort: e.target.value })}
            />
          </label>
          <label>
            Einsatzadresse
            <div className="inline">
              <input
                placeholder="Straße, PLZ Ort"
                value={form.adresse}
                onChange={(e) => setForm({ ...form, adresse: e.target.value })}
              />
              <button type="button" className="btn-ghost" onClick={geocode} disabled={!form.adresse}>
                📍 Auf Karte suchen
              </button>
            </div>
          </label>
          {geoMsg && <p className="muted small">{geoMsg}</p>}
          <div className="inline">
            <label className="flex1">
              Lat
              <input
                type="number" step="any" placeholder="Breite"
                value={form.lat ?? ""}
                onChange={(e) => setForm({ ...form, lat: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label className="flex1">
              Lng
              <input
                type="number" step="any" placeholder="Länge"
                value={form.lng ?? ""}
                onChange={(e) => setForm({ ...form, lng: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="inline">
            <label className="flex1">
              Mitteiler / Tel.
              <input
                placeholder="Name, Telefon"
                value={form.mitteiler}
                onChange={(e) => setForm({ ...form, mitteiler: e.target.value })}
              />
            </label>
            <label className="flex1">
              Objekt
              <input
                placeholder="z. B. Turnhalle"
                value={form.objekt}
                onChange={(e) => setForm({ ...form, objekt: e.target.value })}
              />
            </label>
          </div>
          <label>
            Priorität
            <select value={form.prioritaet} onChange={(e) => setForm({ ...form, prioritaet: e.target.value })}>
              {PRIORITAETEN.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label>
            Geplante Alarmzeit (optional)
            <input
              type="datetime-local"
              value={form.alarmZeit || ""}
              onChange={(e) => setForm({ ...form, alarmZeit: e.target.value })}
            />
            <span className="muted small">Auto-Alarm wird in der Einsatzübersicht aktiviert.</span>
          </label>
          <label>
            Beschreibung
            <textarea
              rows="3"
              placeholder="Lagemeldung, Hinweise…"
              value={form.beschreibung}
              onChange={(e) => setForm({ ...form, beschreibung: e.target.value })}
            />
          </label>
          <fieldset className="dispo">
            <legend>Fahrzeuge disponieren</legend>
            {vehicles.length === 0 && <p className="muted small">Erst Fahrzeuge anlegen.</p>}
            {vehicles.length > 0 && (
              <p className="muted small">Zur Planung sind alle Fahrzeuge wählbar – die Verfügbarkeit wird in der Einsatzübersicht geprüft.</p>
            )}
            {[...vehicles].sort((a, b) => a.funkrufname.localeCompare(b.funkrufname)).map((v) => {
              const selected = form.vehicleIds.includes(v.id);
              return (
                <label key={v.id} className="check">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleVehicle(v.id)}
                  />
                  {v.funkrufname}
                  {v.typ && <span className="muted small">· {v.typ}</span>}
                  {v.extern && <span className="extern-tag">{v.abteilung || "Fremde Abteilung"}</span>}
                </label>
              );
            })}
          </fieldset>
          {err && <p className="error">{err}</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary">{editId ? "Speichern" : "Einsatz anlegen"}</button>
            {editId && (
              <button type="button" className="btn-ghost" onClick={() => { setEditId(null); setForm(emptyMission()); setGeoMsg(null); }}>
                Abbrechen
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card list-card">
        <h2>Einsätze</h2>
        {sorted.length === 0 && <p className="muted">Noch keine Einsätze angelegt.</p>}
        <div className="mission-list">
          {sorted.map((m) => (
            <MissionRow key={m.id} m={m} vehicles={vehicles} station={station} aktivBelegt={aktivBelegt} onEdit={() => edit(m)} onCopy={() => copy(m)} />
          ))}
        </div>
      </section>

      <FahrzeugStatusSpalte vehicles={vehicles} missions={missions} />
    </div>
  );
}

/* Kompakte Fahrzeugliste mit Status-Schnellumschaltung (rechte Spalte) */
function FahrzeugStatusSpalte({ vehicles, missions }) {
  const byName = (a, b) => a.funkrufname.localeCompare(b.funkrufname);
  const bereit = vehicles.filter((v) => istAlarmierbar(v.status)).length;

  // Aktive Einsaetze mit ihren disponierten Fahrzeugen (alarmiert)
  const aktiveEinsaetze = missions
    .filter((m) => m.status === "aktiv")
    .map((m) => ({
      mission: m,
      fahrzeuge: (m.vehicleIds || [])
        .map((id) => vehicles.find((v) => v.id === id))
        .filter(Boolean)
        .sort(byName),
    }))
    .filter((g) => g.fahrzeuge.length > 0);

  // Fahrzeuge, die keinem aktiven Einsatz zugeordnet sind
  const alarmiertIds = new Set(aktiveEinsaetze.flatMap((g) => g.fahrzeuge.map((v) => v.id)));
  const rest = vehicles.filter((v) => !alarmiertIds.has(v.id)).sort(byName);

  const [collapsed, setCollapsed] = useState({});
  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  async function removeFromMission(mission, v) {
    if (confirm(`${v.funkrufname} aus Einsatz "${mission.stichwort}" entlassen?`)) {
      await api.releaseVehicle(mission.id, v.id);
    }
  }

  return (
    <section className="card list-card">
      <h2>Fahrzeugstatus</h2>
      <p className="muted small">{bereit} von {vehicles.length} einsatzbereit (Status 1/2)</p>
      {vehicles.length === 0 ? (
        <p className="muted">Noch keine Fahrzeuge angelegt.</p>
      ) : (
        <div className="status-col-groups">
          {aktiveEinsaetze.map(({ mission, fahrzeuge }) => {
            const zu = collapsed[mission.id];
            return (
              <div key={mission.id} className="status-group alarmiert">
                <button type="button" className="status-group-head" onClick={() => toggle(mission.id)}>
                  <span className="caret">{zu ? "▶" : "▼"}</span>
                  🚨 {mission.stichwort} <span className="muted small">({fahrzeuge.length})</span>
                </button>
                {!zu && fahrzeuge.map((v) => (
                  <VehicleStatusRow key={v.id} v={v} onRemove={() => removeFromMission(mission, v)} />
                ))}
              </div>
            );
          })}

          <div className="status-group">
            {aktiveEinsaetze.length > 0 ? (
              <>
                <button type="button" className="status-group-head muted" onClick={() => toggle("rest")}>
                  <span className="caret">{collapsed.rest ? "▶" : "▼"}</span>
                  Nicht alarmiert ({rest.length})
                </button>
                {!collapsed.rest && rest.map((v) => <VehicleStatusRow key={v.id} v={v} />)}
              </>
            ) : (
              rest.map((v) => <VehicleStatusRow key={v.id} v={v} />)
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* Einzelne Statuszeile mit farbiger Status-Schnellumschaltung */
function VehicleStatusRow({ v, alarmiert = false, onRemove }) {
  async function changeStatus(status) {
    await api.updateVehicle(v.id, { status });
  }
  return (
    <div className={`status-col-row ${alarmiert ? "alarmiert" : ""}`}>
      <div className="status-col-head">
        <strong className="status-col-name">{v.funkrufname}</strong>
        {v.typ && <span className="muted small status-col-typ">· {v.typ}</span>}
        {v.extern && <span className="extern-tag">{v.abteilung || "Fremde Abteilung"}</span>}
      </div>
      <select
        className="status-select status-select-colored"
        value={v.status}
        onChange={(e) => changeStatus(Number(e.target.value))}
        style={{
          borderColor: STATUS[v.status]?.color,
          color: STATUS[v.status]?.color,
        }}
      >
        {STATUS_LIST.map((s) => (
          <option key={s} value={s} style={{ background: "#1e293b", color: STATUS[s]?.color, fontWeight: 700 }}>
            {STATUS[s].label}
          </option>
        ))}
      </select>
      {onRemove && (
        <button
          type="button"
          className="row-release"
          title="Fahrzeug wird nicht mehr benötigt – aus diesem Einsatz entlassen"
          onClick={onRemove}
        >
          ✕ Aus Einsatz entlassen
        </button>
      )}
    </div>
  );
}

function formatAlarmZeit(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

function formatLogTime(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function MissionRow({ m, vehicles, station, aktivBelegt = {}, onEdit, onCopy }) {
  const prio = PRIORITAETEN.find((p) => p.value === m.prioritaet) || PRIORITAETEN[1];
  const dispo = (m.vehicleIds || []).map((id) => vehicles.find((v) => v.id === id)).filter(Boolean);
  const entfernt = (m.entferntIds || []).map((id) => vehicles.find((v) => v.id === id)).filter(Boolean);
  // Verfuegbar = einsatzbereit (Status 1/2) und nicht bereits in einem anderen AKTIVEN Einsatz
  const istVerfuegbar = (v) => istAlarmierbar(v.status) && !(aktivBelegt[v.id] && aktivBelegt[v.id] !== m.id);
  // Alarmierung nur moeglich, wenn ALLE geplanten Fahrzeuge verfuegbar sind
  const alarmierbar = dispo.length > 0 && dispo.every(istVerfuegbar);
  const byName = (a, b) => a.funkrufname.localeCompare(b.funkrufname);
  // Fuer die Nachalarmierung nur verfuegbare Fahrzeuge
  const nachKandidaten = vehicles.filter((v) => !(m.vehicleIds || []).includes(v.id) && istVerfuegbar(v)).sort(byName);
  // Fuer die Planung (Zuteilen) alle noch nicht zugeordneten Fahrzeuge
  const planKandidaten = vehicles.filter((v) => !(m.vehicleIds || []).includes(v.id)).sort(byName);

  const [nachOpen, setNachOpen] = useState(false);
  const [nachIds, setNachIds] = useState([]);
  const [nachErr, setNachErr] = useState(null);

  const [dispoSel, setDispoSel] = useState([]);
  const [dispoErr, setDispoErr] = useState(null);
  const [dispoOpen, setDispoOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [logOpen, setLogOpen] = useState(false);

  async function addNote() {
    const t = noteText.trim();
    if (!t) return;
    await api.addNote(m.id, t);
    setNoteText("");
  }

  function toggleNach(id) {
    setNachIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleDispoSel(id) {
    setDispoSel((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function assignDispo() {
    setDispoErr(null);
    try {
      const merged = [
        ...(m.vehicleIds || []),
        ...dispoSel.filter((id) => !(m.vehicleIds || []).includes(id)),
      ];
      await api.updateMission(m.id, { vehicleIds: merged });
      setDispoSel([]);
    } catch (e) {
      setDispoErr(e.message);
    }
  }

  async function alarm() { await api.alarmMission(m.id); }
  async function reAlarm() {
    if (confirm(`Einsatz "${m.stichwort}" wirklich erneut alarmieren?`)) await api.alarmMission(m.id);
  }
  async function close() { await api.closeMission(m.id); }
  async function toggleAuto() { await api.updateMission(m.id, { autoAlarm: !m.autoAlarm }); }
  async function togglePersonal() { await api.updateMission(m.id, { personalAnzeigen: !m.personalAnzeigen }); }
  async function removePlanned(v) {
    const next = (m.vehicleIds || []).filter((id) => id !== v.id);
    await api.updateMission(m.id, { vehicleIds: next });
  }
  async function remove() {
    if (confirm(`Einsatz "${m.stichwort}" löschen?`)) await api.deleteMission(m.id);
  }

  async function nachalarm() {
    setNachErr(null);
    try {
      await api.nachalarmMission(m.id, nachIds);
      setNachIds([]);
      setNachOpen(false);
    } catch (e) {
      setNachErr(e.message);
    }
  }

  return (
    <div className={`mission-row status-${m.status}`}>
      <div className="mission-head">
        <span className="prio-dot" style={{ background: prio.color }} title={prio.label} />
        <strong>{m.stichwort}</strong>
        <span className={`mission-state state-${m.status}`}>{m.status}</span>
      </div>
      {m.adresse && <div className="muted">📍 {m.adresse}</div>}
      {m.objekt && <div className="muted small">🏢 {m.objekt}</div>}
      {m.mitteiler && <div className="muted small">☎ {m.mitteiler}</div>}
      {station && station.lat != null && station.lng != null && m.lat != null && m.lng != null && (
        <div className="small">
          <Fahrtzeit origin={station} dest={{ lat: m.lat, lng: m.lng }} />
        </div>
      )}
      {m.beschreibung && <div className="muted small">{m.beschreibung}</div>}
      {m.status === "offen" && (
        <div className="auto-alarm">
          <label className="check">
            <input type="checkbox" checked={!!m.autoAlarm} onChange={toggleAuto} />
            Automatisch alarmieren
          </label>
          {m.alarmZeit ? (
            <span className="muted small">⏰ {formatAlarmZeit(m.alarmZeit)}</span>
          ) : (
            <span className="muted small">keine Alarmzeit gesetzt</span>
          )}
          {m.autoAlarm && !m.alarmZeit && (
            <span className="error small">Alarmzeit fehlt</span>
          )}
        </div>
      )}
      {m.status !== "abgeschlossen" && (
        <label className="check monitor-opt">
          <input type="checkbox" checked={!!m.personalAnzeigen} onChange={togglePersonal} />
          Personal im Alarmmonitor anzeigen
        </label>
      )}
      {(dispo.length > 0 || entfernt.length > 0) && (
        <div className="dispo-tags">
          {dispo.map((v) => {
            // Bei aktivem Einsatz: Fahrzeug grün, sobald es reagiert hat (Status 3/4),
            // rot mit Ausrufezeichen, wenn es ausfällt (Status 6).
            // Bei der Planung (offen): nicht verfügbare Fahrzeuge rot markieren.
            const reagiert = m.status === "aktiv" && (v.status === 3 || v.status === 4);
            const ausgefallen = m.status === "aktiv" && v.status === 6;
            const nichtVerfuegbar = m.status === "offen" && !istVerfuegbar(v);
            const rot = ausgefallen || nichtVerfuegbar;
            const cls = reagiert ? "responding" : rot ? "unavailable" : "";
            return (
              <span
                key={v.id}
                className={`dispo-tag ${cls}`}
                title={ausgefallen ? "Fahrzeug nicht einsatzbereit" : nichtVerfuegbar ? "Fahrzeug nicht verfügbar" : undefined}
              >
                {v.funkrufname}{rot && " ⚠"}
                {m.status === "offen" && (
                  <button
                    type="button"
                    className="tag-remove"
                    title="Fahrzeug aus der Planung entfernen"
                    onClick={() => removePlanned(v)}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
          {entfernt.map((v) =>
            m.status === "abgeschlossen" ? (
              <span key={v.id} className="dispo-tag">{v.funkrufname}</span>
            ) : (
              <span key={v.id} className="dispo-tag entlassen" title="aus dem Einsatz entlassen">
                {v.funkrufname} ✕
              </span>
            )
          )}
        </div>
      )}
      {dispo.length === 0 && entfernt.length === 0 && (m.status === "aktiv" || m.status === "abgeschlossen") && (
        <div className="dispo-tags">
          <span className="muted small">keine Fahrzeuge disponiert</span>
        </div>
      )}
      {m.status !== "aktiv" && m.status !== "abgeschlossen" && (
        <div className="assign-panel">
          <button type="button" className={`assign-toggle ${dispoOpen ? "open" : "closed"}`} onClick={() => setDispoOpen((o) => !o)}>
            <span className="caret">{dispoOpen ? "▼" : "▶"}</span> Fahrzeuge zuteilen
          </button>
          {dispoOpen && (planKandidaten.length === 0 ? (
            <p className="muted small">Alle Fahrzeuge sind bereits disponiert.</p>
          ) : (
            <>
              <div className="nachalarm-list">
                {planKandidaten.map((v) => (
                  <label key={v.id} className="check">
                    <input
                      type="checkbox"
                      checked={dispoSel.includes(v.id)}
                      onChange={() => toggleDispoSel(v.id)}
                    />
                    {v.funkrufname}
                    {v.typ && <span className="muted small">· {v.typ}</span>}
                    {" "}<StatusBadge status={v.status} />
                    {v.extern && <span className="extern-tag">{v.abteilung || "Fremde Abteilung"}</span>}
                  </label>
                ))}
              </div>
              {dispoErr && <p className="error small">{dispoErr}</p>}
              <button className="btn-primary" disabled={dispoSel.length === 0} onClick={assignDispo}>
                {dispoSel.length || ""} Fahrzeug{dispoSel.length === 1 ? "" : "e"} zuteilen
              </button>
            </>
          ))}
        </div>
      )}
      {m.status !== "aktiv" && m.status !== "abgeschlossen" && dispo.length === 0 && (
        <p className="error small">⚠ Kein Fahrzeug disponiert – Alarmierung nicht möglich.</p>
      )}
      {m.status !== "aktiv" && m.status !== "abgeschlossen" && dispo.length > 0 && !alarmierbar && (
        <p className="error small">⚠ Nicht alle geplanten Fahrzeuge sind verfügbar (Status 1/2) – Alarmierung nicht möglich.</p>
      )}
      <div className="row-actions">
        {m.status !== "aktiv" && m.status !== "abgeschlossen" && (
          <button
            className="btn-alarm"
            onClick={alarm}
            disabled={!alarmierbar}
            title={!alarmierbar ? "Nicht alle geplanten Fahrzeuge sind verfügbar" : undefined}
          >
            🚨 Alarmieren
          </button>
        )}
        {m.status === "aktiv" && (
          <>
            <button className="btn-alarm" onClick={reAlarm}>↻ Erneut alarmieren</button>
            <button
              className="btn-alarm"
              onClick={() => { setNachOpen((o) => !o); setNachErr(null); }}
              disabled={nachKandidaten.length === 0}
              title={nachKandidaten.length === 0 ? "Keine einsatzbereiten Fahrzeuge (Status 1/2) verfügbar" : "Weitere Fahrzeuge nachalarmieren"}
            >
              ➕ Nachalarmieren
            </button>
            <button className="btn-primary" onClick={close}>Beenden</button>
          </>
        )}
        {m.status === "abgeschlossen" ? (
          <button className="btn-icon" title="Als neuen Einsatz ins Formular kopieren" onClick={onCopy}>
            📋
          </button>
        ) : (
          <button className="btn-ghost" onClick={onEdit}>Bearbeiten</button>
        )}
        <button className="btn-danger" onClick={remove}>Löschen</button>
      </div>
      {m.status === "aktiv" && nachOpen && (
        <div className="nachalarm-panel">
          <strong className="small">Weitere Fahrzeuge nachalarmieren</strong>
          {nachKandidaten.length === 0 ? (
            <p className="muted small">Keine einsatzbereiten Fahrzeuge (Status 1/2) verfügbar.</p>
          ) : (
            <div className="nachalarm-list">
              {nachKandidaten.map((v) => (
                <label key={v.id} className="check">
                  <input
                    type="checkbox"
                    checked={nachIds.includes(v.id)}
                    onChange={() => toggleNach(v.id)}
                  />
                  {v.funkrufname}
                  {v.typ && <span className="muted small">· {v.typ}</span>}
                  {" "}<StatusBadge status={v.status} />
                  {v.extern && <span className="extern-tag">{v.abteilung || "Fremde Abteilung"}</span>}
                </label>
              ))}
            </div>
          )}
          {nachErr && <p className="error small">{nachErr}</p>}
          <div className="row-actions">
            <button className="btn-alarm" onClick={nachalarm} disabled={nachIds.length === 0}>
              🚨 {nachIds.length || ""} alarmieren
            </button>
            <button className="btn-ghost" onClick={() => { setNachOpen(false); setNachIds([]); }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {(m.status === "aktiv" || m.status === "abgeschlossen") && (
        <div className="einsatzlog">
          <div className="log-head">
            <button type="button" className="assign-toggle" onClick={() => setLogOpen((o) => !o)}>
              <span className="caret">{logOpen ? "▼" : "▶"}</span> Einsatztagebuch ({(m.log || []).length})
            </button>
            <button
              type="button"
              className="btn-icon"
              title="Alarmfax (PDF) öffnen"
              onClick={() => window.open(`/api/missions/${m.id}/alarmfax`, "_blank")}
            >
              📠
            </button>
          </div>
          {logOpen && (
            <>
              {m.status === "aktiv" && (
                <div className="note-input">
                  <input
                    placeholder="Notiz hinzufügen…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                  />
                  <button className="btn-primary" onClick={addNote} disabled={!noteText.trim()}>Notiz</button>
                </div>
              )}
              {(m.log || []).length === 0 ? (
                <p className="muted small">Noch keine Einträge.</p>
              ) : (
                <ul className="log-list">
                  {[...m.log].reverse().map((e) => (
                    <li key={e.id} className={`log-entry log-${e.type}`}>
                      <span className="log-time">{formatLogTime(e.at)}</span>
                      <span className="log-text">{e.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
