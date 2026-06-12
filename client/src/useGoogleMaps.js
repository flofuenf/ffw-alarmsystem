import { useEffect, useState } from "react";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let loadPromise = null;

function loadScript() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (!API_KEY) {
      reject(new Error("Kein Google-Maps-API-Key gesetzt (VITE_GOOGLE_MAPS_API_KEY)."));
      return;
    }
    if (window.google && window.google.maps) {
      resolve(window.google);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places,geometry&language=de&region=DE`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google Maps konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function useGoogleMaps() {
  const [loaded, setLoaded] = useState(!!(window.google && window.google.maps));
  const [error, setError] = useState(API_KEY ? null : "no-key");

  useEffect(() => {
    if (!API_KEY) {
      setError("no-key");
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => !cancelled && setLoaded(true))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return { loaded, error, hasKey: !!API_KEY };
}

// Route (Fahrstrecke) zwischen zwei Punkten via Directions API.
// Liefert Dauer (Sekunden, normaler Pkw-Verkehr) und Distanz (Meter).
export async function getRoute(origin, destination) {
  await loadScript();
  const service = new window.google.maps.DirectionsService();
  return new Promise((resolve, reject) => {
    service.route(
      {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
        // Verkehrs-/Baustellenlage einbeziehen
        drivingOptions: { departureTime: new Date(), trafficModel: "bestguess" },
      },
      (res, status) => {
        const leg = res?.routes?.[0]?.legs?.[0];
        if (status === "OK" && leg) {
          // duration_in_traffic beruecksichtigt aktuelle Bedingungen (Baustellen/Verkehr)
          const sek = leg.duration_in_traffic?.value ?? leg.duration.value;
          resolve({ durationSek: sek, distanzM: leg.distance.value });
        } else {
          reject(new Error("Route nicht verfügbar (" + status + ")"));
        }
      }
    );
  });
}

// React-Hook: ermittelt die Fahrzeit/Distanz zwischen origin und dest.
// Gibt null zurueck, solange keine gueltige Route vorliegt (z. B. ohne API-Key).
export function useFahrtzeit(origin, dest) {
  const [route, setRoute] = useState(null);
  const oLat = origin?.lat, oLng = origin?.lng;
  const dLat = dest?.lat, dLng = dest?.lng;

  useEffect(() => {
    if (oLat == null || oLng == null || dLat == null || dLng == null) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    getRoute({ lat: Number(oLat), lng: Number(oLng) }, { lat: Number(dLat), lng: Number(dLng) })
      .then((r) => !cancelled && setRoute(r))
      .catch(() => !cancelled && setRoute(null));
    return () => { cancelled = true; };
  }, [oLat, oLng, dLat, dLng]);

  return route;
}

// Adresse -> Koordinaten via Geocoding API
export async function geocodeAddress(address) {
  await loadScript();
  const geocoder = new window.google.maps.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address, region: "DE" }, (results, status) => {
      if (status === "OK" && results[0]) {
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          formatted: results[0].formatted_address,
        });
      } else {
        reject(new Error("Adresse nicht gefunden (" + status + ")"));
      }
    });
  });
}
