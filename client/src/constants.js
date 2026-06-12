// Feuerwehr-Funkstatus (FMS)
export const STATUS = {
  1: { label: "1 – Einsatzbereit Funk", short: "Bereit (Funk)", color: "#16a34a" },
  2: { label: "2 – Einsatzbereit Wache", short: "Bereit (Wache)", color: "#22c55e" },
  3: { label: "3 – Einsatz übernommen", short: "Anfahrt", color: "#f59e0b" },
  4: { label: "4 – Am Einsatzort", short: "Am Einsatzort", color: "#16a34a" },
  5: { label: "5 – Sprechwunsch", short: "Sprechwunsch", color: "#3b82f6" },
  6: { label: "6 – Nicht einsatzbereit", short: "Nicht bereit", color: "#dc2626" },
};

export const STATUS_LIST = [1, 2, 3, 4, 5, 6];

// Fuer eine (Nach-)Alarmierung disponierbar sind nur einsatzbereite Fahrzeuge.
export const istAlarmierbar = (status) => status === 1 || status === 2;

// Einsatzfahrten mit Blaulicht und Sonderrechten sind deutlich schneller als der
// normale Strassenverkehr. Als grobe Naeherung rechnen wir die von Google
// gelieferte Pkw-Fahrzeit auf ~65 % herunter.
export const SONDERRECHTE_FAKTOR = 0.65;
export const einsatzFahrzeitSek = (normalSek) => Math.round(normalSek * SONDERRECHTE_FAKTOR);

export function formatDauer(sek) {
  const min = Math.round(sek / 60);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const FAHRZEUG_TYPEN = [
  "LF (Löschfahrzeug)",
  "HLF (Hilfeleistungslöschfahrzeug)",
  "TLF (Tanklöschfahrzeug)",
  "DLK (Drehleiter)",
  "RW (Rüstwagen)",
  "MTW (Mannschaftstransportwagen)",
  "ELW (Einsatzleitwagen)",
  "KdoW (Kommandowagen)",
  "GW (Gerätewagen)",
  "Sonstiges",
];

export const PRIORITAETEN = [
  { value: "niedrig", label: "Niedrig", color: "#22c55e" },
  { value: "normal", label: "Normal", color: "#f59e0b" },
  { value: "hoch", label: "Hoch / Menschenleben", color: "#ef4444" },
];
