import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveState } from "../useLiveState.js";
import { STATUS } from "../constants.js";
import StatusBadge from "../components/StatusBadge.jsx";
import MapView from "../components/MapView.jsx";
import Fahrtzeit from "../components/Fahrtzeit.jsx";
import { PRIORITAETEN } from "../constants.js";
import { playGong, unlockAudio, setCustomGong } from "../gong.js";
import { speak, cancelSpeech, speakServer } from "../speech.js";

export default function Monitor() {
  const { vehicles, missions, settings, connected } = useLiveState();
  const station = settings?.station || null;
  const [now, setNow] = useState(new Date());
  const [muted, setMuted] = useState(false);
  const alarmSigRef = useRef(null);
  const serverTtsRef = useRef(false);
  const repeatTimerRef = useRef(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Ansage abspielen – bevorzugt Piper (Server), sonst Browser-Stimme.
  // Promise wird aufgeloest, wenn die Ansage beendet ist.
  function announceOnce(text, voice) {
    if (serverTtsRef.current) return speakServer(text).catch(() => speak(text, voice));
    return speak(text, voice);
  }

  // Verfuegbarkeit der Offline-Sprachsynthese (Piper) einmalig pruefen
  useEffect(() => {
    fetch("/api/tts/status")
      .then((r) => r.json())
      .then((s) => { serverTtsRef.current = !!s.available; })
      .catch(() => { serverTtsRef.current = false; });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // AudioContext bei der ersten Nutzerinteraktion freischalten (Autoplay-Sperre)
  useEffect(() => {
    const h = () => unlockAudio();
    window.addEventListener("pointerdown", h, { once: true });
    return () => window.removeEventListener("pointerdown", h);
  }, []);

  // Eigene Gong-Datei aus den Einstellungen uebernehmen (oder Standard-Gong)
  const gongCustom = settings?.gong?.hasCustom;
  const gongUpdatedAt = settings?.gong?.updatedAt;
  useEffect(() => {
    setCustomGong(gongCustom ? `/api/gong?t=${encodeURIComponent(gongUpdatedAt || "")}` : null);
  }, [gongCustom, gongUpdatedAt]);

  // Gong + Sprachansage bei neuer/erneuter Alarmierung oder Nachalarmierung
  useEffect(() => {
    const sig = new Map();
    for (const m of missions) {
      if (m.status === "aktiv") {
        sig.set(m.id, { a: m.alarmiertAt || "", n: m.nachalarmiertAt || "", ids: (m.vehicleIds || []).join(",") });
      }
    }
    const prev = alarmSigRef.current;
    if (prev !== null && !muted) {
      for (const m of missions) {
        if (m.status !== "aktiv") continue;
        const cur = sig.get(m.id);
        const pv = prev.get(m.id);
        let text = null;
        if (!pv || pv.a !== cur.a) {
          // neuer Einsatz oder (erneute) Alarmierung -> Vollansage
          text = ansageText(m, vehicles);
        } else if (pv.n !== cur.n) {
          // Nachalarmierung -> nur die neu hinzugekommenen Fahrzeuge ansagen
          const prevIds = new Set((pv.ids || "").split(",").filter(Boolean));
          const neuIds = (m.vehicleIds || []).filter((id) => !prevIds.has(id));
          text = nachAnsageText(m, vehicles, neuIds);
        }
        if (text) {
          const voice = settings?.tts?.voice || "";
          clearTimeout(repeatTimerRef.current);
          // 1) Gong, danach die Ansage
          playGong(() => {
            // 2) Wiederholung 5 Sekunden NACH dem Ende der ersten Ansage – ohne Gong
            announceOnce(text, voice).then(() => {
              repeatTimerRef.current = setTimeout(() => {
                if (!mutedRef.current) announceOnce(text, voice);
              }, 5000);
            });
          });
          break; // nur den ersten geaenderten Einsatz pro Aktualisierung
        }
      }
    }
    alarmSigRef.current = sig;
  }, [missions, vehicles, muted, settings?.tts?.voice]);

  function toggleSound() {
    unlockAudio();
    setMuted((m) => {
      if (!m) { cancelSpeech(); clearTimeout(repeatTimerRef.current); } // wird gerade stummgeschaltet
      return !m;
    });
  }

  // geplante Wiederholung beim Verlassen abbrechen
  useEffect(() => () => clearTimeout(repeatTimerRef.current), []);

  const active = useMemo(
    () =>
      missions
        .filter((m) => m.status === "aktiv")
        .sort((a, b) => new Date(b.alarmiertAt || b.createdAt) - new Date(a.alarmiertAt || a.createdAt)),
    [missions]
  );

  const hasAlarm = active.length > 0;

  return (
    <div className={`monitor ${hasAlarm ? "monitor-alarm" : ""}`}>
      <header className="monitor-bar">
        <div className="monitor-title">
          <span className="brand-icon">🚒</span> Alarmmonitor
        </div>
        <div className="monitor-clock">
          {now.toLocaleTimeString("de-DE")}
          <span className="monitor-date">{now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
        </div>
        <div className="monitor-bar-right">
          <button
            className="sound-btn"
            onClick={toggleSound}
            title={muted ? "Alarmton einschalten" : "Alarmton ausschalten"}
          >
            {muted ? "🔕" : "🔔"}
          </button>
          <div className={`conn ${connected ? "on" : "off"}`}>{connected ? "● live" : "○ offline"}</div>
        </div>
      </header>

      {hasAlarm ? (
        <AlarmView mission={active[0]} others={active.slice(1)} vehicles={vehicles} station={station} now={now} />
      ) : (
        <RuheView vehicles={vehicles} />
      )}
    </div>
  );
}

/* ===================== ALARMIERUNG AKTIV ===================== */
function AlarmView({ mission, others, vehicles, station, now }) {
  // Eigene Fahrzeuge prominent, fremde Abteilungen dezent (gruppiert)
  const dispo = (mission.vehicleIds || [])
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v) => v && !v.extern);
  const fremde = (mission.vehicleIds || [])
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v) => v && v.extern);
  const entfernt = (mission.entferntIds || [])
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v) => v && !v.extern);
  const prio = PRIORITAETEN.find((p) => p.value === mission.prioritaet) || PRIORITAETEN[1];
  const since = mission.alarmiertAt ? laufzeit(mission.alarmiertAt, now) : null;
  const nachSet = new Set(mission.nachalarmiertIds || []);
  const nachSince = mission.nachalarmiertAt ? laufzeit(mission.nachalarmiertAt, now) : null;

  return (
    <div className="alarm-grid">
      <div className="alarm-info">
        <div className="alarm-banner" style={{ background: prio.color }}>
          🚨 EINSATZ
        </div>
        <h1 className="alarm-stichwort">{mission.stichwort}</h1>
        {mission.adresse && <div className="alarm-adresse">📍 {mission.adresse}</div>}
        {mission.beschreibung && <p className="alarm-desc">{mission.beschreibung}</p>}
        <div className="alarm-meta">
          {since && <span>⏱ Alarmierung vor {since}</span>}
          {nachSince && nachSet.size > 0 && <span className="nach-meta">➕ Nachalarmierung vor {nachSince}</span>}
          {station && station.lat != null && station.lng != null && mission.lat != null && mission.lng != null && (
            <Fahrtzeit origin={station} dest={{ lat: mission.lat, lng: mission.lng }} />
          )}
          <span>Priorität: {prio.label}</span>
        </div>

        <h2 className="dispo-title">Disponierte Fahrzeuge ({dispo.length})</h2>
        <div className="dispo-grid">
          {dispo.length === 0 && <p className="muted">Keine Fahrzeuge disponiert.</p>}
          {dispo.map((v) => {
            const vorOrt = v.status === 4; // Am Einsatzort -> positiv hervorheben
            return (
              <div
                key={v.id}
                className={`dispo-card ${vorOrt ? "am-einsatzort" : ""}`}
                style={vorOrt ? undefined : { borderColor: STATUS[v.status]?.color }}
              >
                <strong>{v.funkrufname}</strong>
                <span className="muted small">{v.typ}</span>
                {vorOrt ? (
                  <span className="vor-ort-badge">✅ Am Einsatzort</span>
                ) : (
                  <StatusBadge status={v.status} full />
                )}
                {mission.personalAnzeigen && v.personal?.length > 0 && (
                  <ul className="card-personal">
                    {gruppierePersonal(v.personal).map((b, i) => (
                      <li key={i} className={`pers-group ${b.isTrupp ? "pers-trupp" : ""}`} style={funktionStil(b.key)}>
                        <span className="pers-funktion">{b.key}</span>
                        {b.isTrupp ? (
                          <span className="pers-rollen">
                            {b.mitglieder.map((m, j) => (
                              <span key={j} className="pers-rolle">
                                <b>{m.rolle || "—"}</b>{m.name ? `: ${m.name}` : ""}
                              </span>
                            ))}
                          </span>
                        ) : (
                          (() => {
                            const namen = b.mitglieder.map((m) => m.name).filter(Boolean);
                            return (
                              <>
                                {b.mitglieder.length > 1 && <span className="pers-funktion">({b.mitglieder.length})</span>}
                                {namen.length > 0 && <span className="pers-namen">{namen.join(", ")}</span>}
                              </>
                            );
                          })()
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {entfernt.map((v) => (
            <div key={v.id} className="dispo-card entlassen">
              <span className="entlassen-badge">✕ Entlassen</span>
              <strong>{v.funkrufname}</strong>
              <span className="muted small">{v.typ}</span>
              <StatusBadge status={v.status} full />
            </div>
          ))}
        </div>

        {fremde.length > 0 && (
          <div className="fremde-section">
            <h3 className="fremde-title">Weitere Fahrzeuge ({fremde.length})</h3>
            {gruppiereFremde(fremde).map((g) => (
              <div key={g.name} className="fremde-group">
                <div className="fremde-group-name">{g.name}</div>
                <div className="fremde-list">
                  {g.items.map((v) => (
                    <span key={v.id} className="fremde-veh">
                      {v.funkrufname}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {others.length > 0 && (
          <div className="other-alarms">
            <h3>Weitere aktive Einsätze ({others.length})</h3>
            {others.map((m) => {
              const oprio = PRIORITAETEN.find((p) => p.value === m.prioritaet) || PRIORITAETEN[1];
              const osince = m.alarmiertAt ? laufzeit(m.alarmiertAt, now) : null;
              const odispo = (m.vehicleIds || [])
                .map((id) => vehicles.find((v) => v.id === id))
                .filter((v) => v && !v.extern);
              return (
                <div key={m.id} className="other-alarm">
                  <div className="other-alarm-head">
                    <span className="prio-dot" style={{ background: oprio.color }} title={oprio.label} />
                    <strong>{m.stichwort}</strong>
                    {osince && <span className="other-time">⏱ {osince}</span>}
                  </div>
                  {m.adresse && <div className="muted small">📍 {m.adresse}</div>}
                  <div className="other-meta">Priorität: {oprio.label}</div>
                  <div className="other-vehicles">
                    {odispo.length === 0 ? (
                      <span className="muted small">keine Fahrzeuge disponiert</span>
                    ) : (
                      odispo.map((v) => (
                        <span key={v.id} className="other-veh" style={{ borderColor: STATUS[v.status]?.color }}>
                          {v.funkrufname}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="alarm-map">
        <MapView
          lat={mission.lat}
          lng={mission.lng}
          label={mission.stichwort}
          origin={station && station.lat != null && station.lng != null ? station : null}
          vehicles={dispo}
          zoom={16}
        />
      </div>
    </div>
  );
}

/* ===================== RUHEZUSTAND ===================== */
function RuheView({ vehicles }) {
  // Eigene Fahrzeuge prominent, fremde Abteilungen dezent (gruppiert)
  const eigene = vehicles.filter((v) => !v.extern);
  const fremde = vehicles.filter((v) => v.extern);
  const sorted = [...eigene].sort((a, b) => a.status - b.status || a.funkrufname.localeCompare(b.funkrufname));
  const bereit = eigene.filter((v) => v.status === 1 || v.status === 2).length;

  return (
    <div className="ruhe">
      <div className="ruhe-head">
        <h1>Fahrzeugstatus</h1>
        <div className="ruhe-summary">
          <span className="ok">{bereit}</span> von {eigene.length} Fahrzeugen einsatzbereit
        </div>
      </div>
      {eigene.length === 0 ? (
        <p className="muted big">Noch keine Fahrzeuge angelegt. Lege Fahrzeuge in der Planung an.</p>
      ) : (
        <div className="status-grid">
          {sorted.map((v) => (
            <div key={v.id} className="status-tile" style={{ borderLeftColor: STATUS[v.status]?.color }}>
              <div className="tile-top">
                <strong>{v.funkrufname}</strong>
                <span className="status-num" style={{ background: STATUS[v.status]?.color }}>{v.status}</span>
              </div>
              <span className="muted small">{v.typ}</span>
              <StatusBadge status={v.status} full />
              {v.bemerkung && <span className="muted small">{v.bemerkung}</span>}
            </div>
          ))}
        </div>
      )}

      {fremde.length > 0 && (
        <div className="fremde-section">
          <h3 className="fremde-title">Weitere Fahrzeuge ({fremde.length})</h3>
          {gruppiereFremde(fremde).map((g) => (
            <div key={g.name} className="fremde-group">
              <div className="fremde-group-name">{g.name}</div>
              <div className="fremde-list">
                {g.items.map((v) => (
                  <span key={v.id} className="fremde-veh">
                    {v.funkrufname} <StatusBadge status={v.status} />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Reihenfolge der Funktionen auf dem Monitor
const FUNKTION_ORDER = ["gruppenführer", "maschinist", "angriffstrupp", "wassertrupp", "schlauchtrupp", "melder"];
function funktionRang(funktion) {
  const f = (funktion || "").toLowerCase();
  for (let i = 0; i < FUNKTION_ORDER.length; i++) {
    const key = FUNKTION_ORDER[i];
    if (f.includes(key) || (key === "gruppenführer" && f.includes("gruppenfuehrer"))) return i;
  }
  return FUNKTION_ORDER.length; // unbekannte Funktionen ans Ende
}

// Trupp + Rolle (Fuehrer/Mann) aus der Funktionsbezeichnung ableiten
function parseTrupp(funktion) {
  const f = (funktion || "").toLowerCase();
  let trupp = null;
  if (f.includes("angriffstrupp")) trupp = "Angriffstrupp";
  else if (f.includes("wassertrupp")) trupp = "Wassertrupp";
  else if (f.includes("schlauchtrupp")) trupp = "Schlauchtrupp";
  let rolle = "";
  if (trupp) {
    if (f.includes("führer") || f.includes("fuehrer")) rolle = "Führer";
    else if (f.includes("mann")) rolle = "Mann";
  }
  return { trupp, rolle };
}

// Personal eines Fahrzeugs gruppieren: Trupps zu einem Block zusammenfassen
// (innen Fuehrer/Mann), uebrige Funktionen je als eigener Block.
function gruppierePersonal(personal) {
  const blocks = [];
  for (const p of personal || []) {
    const { trupp, rolle } = parseTrupp(p.funktion);
    const key = trupp || (p.funktion || "").trim() || "—";
    let b = blocks.find((x) => x.key === key);
    if (!b) { b = { key, isTrupp: !!trupp, mitglieder: [] }; blocks.push(b); }
    b.mitglieder.push({ rolle, name: p.name || "" });
  }
  // innerhalb eines Trupps: Fuehrer vor Mann
  for (const b of blocks) {
    if (b.isTrupp) b.mitglieder.sort((a, z) => (a.rolle === "Mann" ? 1 : 0) - (z.rolle === "Mann" ? 1 : 0));
  }
  return blocks.sort((a, b) => funktionRang(a.key) - funktionRang(b.key));
}

// Farbliche Kennzeichnung der Funktion (taktische Truppfarben)
function funktionStil(funktion) {
  const f = (funktion || "").toLowerCase();
  if (f.includes("angriffstrupp")) return { background: "#dc2626", color: "#fff" }; // rot
  if (f.includes("wassertrupp")) return { background: "#2563eb", color: "#fff" }; // blau
  if (f.includes("schlauchtrupp")) return { background: "#facc15", color: "#1f2937" }; // gelb
  if (f.includes("gruppenführer") || f.includes("gruppenfuehrer")) return { background: "#2563eb", color: "#fff" }; // blau
  if (f.includes("melder") || f.includes("maschinist")) return { background: "#ffffff", color: "#1f2937" }; // weiss
  return { background: "#475569", color: "#fff" }; // sonstige
}

// Fremde Fahrzeuge nach Abteilung gruppieren
function gruppiereFremde(vehicles) {
  const groups = [];
  for (const v of vehicles) {
    const name = (v.abteilung || "").trim() || "Fremde Abteilung";
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(v);
  }
  return groups;
}

function laufzeit(iso, now) {
  const diff = Math.max(0, Math.floor((now - new Date(iso)) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, "0")} min`;
}

// Vorlese-Text: Vorspann (je nach Priorität), Stichwort, Adresse (nur Straße + Hausnummer), Fahrzeuge
function ansageText(mission, vehicles) {
  const teile = [];
  // Prioritaetsabhaengiger Vorspann
  teile.push("Alarmeinsatz");
  if (mission.prioritaet === "hoch") teile.push("Menschenleben in Gefahr");
  if (mission.stichwort) teile.push(mission.stichwort);
  // Nur den ersten Teil der Adresse (Straße + Hausnummer), Rest (PLZ/Ort) weglassen
  const strasse = (mission.adresse || "").split(",")[0].trim();
  if (strasse) teile.push(strasse);
  const dispo = (mission.vehicleIds || [])
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v) => v && !v.extern);
  if (dispo.length > 0) {
    // Schrägstriche in Funkrufnamen besser sprechbar machen ("1/44/1" -> "1 44 1");
    // Punkt zwischen den Fahrzeugen sorgt fuer eine kurze Pause (bessere Verstaendlichkeit)
    const namen = dispo.map((v) => v.funkrufname.replace(/[/]/g, " ")).join(". ");
    teile.push(`Es fahren: ${namen}`);
  }
  return teile.join(". ") + ".";
}

// Ansage bei Nachalarmierung: nur die neu hinzugekommenen Fahrzeuge nennen
function nachAnsageText(mission, vehicles, neuIds) {
  const teile = ["Nachalarmierung"];
  if (mission.stichwort) teile.push(mission.stichwort);
  const strasse = (mission.adresse || "").split(",")[0].trim();
  if (strasse) teile.push(strasse);
  const neu = (neuIds || []).map((id) => vehicles.find((v) => v.id === id)).filter((v) => v && !v.extern);
  if (neu.length > 0) {
    const namen = neu.map((v) => v.funkrufname.replace(/[/]/g, " ")).join(". ");
    teile.push(`Es fahren: ${namen}`);
  }
  return teile.join(". ") + ".";
}
