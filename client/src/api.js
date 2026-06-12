const BASE = "/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Einstellungen / Standort
  getSettings: () => req("/settings"),
  updateStation: (s) => req("/settings/station", { method: "PUT", body: JSON.stringify(s) }),

  // Alarmton (Gong)
  uploadGong: async (file) => {
    const res = await fetch(BASE + "/settings/gong", {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  deleteGong: () => req("/settings/gong", { method: "DELETE" }),

  // Sprachausgabe-Stimme
  updateTts: (voice) => req("/settings/tts", { method: "PUT", body: JSON.stringify({ voice }) }),

  // Fahrzeuge
  getVehicles: () => req("/vehicles"),
  createVehicle: (v) => req("/vehicles", { method: "POST", body: JSON.stringify(v) }),
  updateVehicle: (id, v) => req(`/vehicles/${id}`, { method: "PUT", body: JSON.stringify(v) }),
  deleteVehicle: (id) => req(`/vehicles/${id}`, { method: "DELETE" }),

  // Einsaetze
  getMissions: () => req("/missions"),
  createMission: (m) => req("/missions", { method: "POST", body: JSON.stringify(m) }),
  updateMission: (id, m) => req(`/missions/${id}`, { method: "PUT", body: JSON.stringify(m) }),
  deleteMission: (id) => req(`/missions/${id}`, { method: "DELETE" }),
  alarmMission: (id) => req(`/missions/${id}/alarm`, { method: "POST" }),
  releaseVehicle: (id, vehicleId) =>
    req(`/missions/${id}/release`, { method: "POST", body: JSON.stringify({ vehicleId }) }),
  nachalarmMission: (id, vehicleIds) =>
    req(`/missions/${id}/nachalarm`, { method: "POST", body: JSON.stringify({ vehicleIds }) }),
  closeMission: (id) => req(`/missions/${id}/close`, { method: "POST" }),
  addNote: (id, text) => req(`/missions/${id}/note`, { method: "POST", body: JSON.stringify({ text }) }),
};
