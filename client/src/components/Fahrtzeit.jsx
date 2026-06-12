import { useFahrtzeit } from "../useGoogleMaps.js";
import { einsatzFahrzeitSek, formatDauer } from "../constants.js";

// Zeigt die ungefaehre Anfahrtszeit vom Feuerwehr-Standort (origin) zum
// Einsatzort (dest) an – reduziert um den Sonderrechte-Faktor (Blaulichtfahrt).
// Rendert nichts, wenn keine Route ermittelt werden kann (z. B. ohne API-Key).
export default function Fahrtzeit({ origin, dest, className = "" }) {
  const route = useFahrtzeit(origin, dest);
  if (!route) return null;
  const sek = einsatzFahrzeitSek(route.durationSek);
  const km = (route.distanzM / 1000).toFixed(1);
  return (
    <span className={`fahrtzeit ${className}`} title="Geschätzte Anfahrt mit Sonderrechten">
      🚒 Anfahrt ca. {formatDauer(sek)} · {km} km
    </span>
  );
}
