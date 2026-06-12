import { useEffect, useRef } from "react";
import { useGoogleMaps } from "../useGoogleMaps.js";
import { STATUS, einsatzFahrzeitSek } from "../constants.js";

// Punkt an einem Bruchteil (0..1) entlang eines Polyline-Pfads bestimmen.
function pointAlongPath(path, fraction) {
  const sph = window.google.maps.geometry.spherical;
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = sph.computeDistanceBetween(path[i], path[i + 1]);
    segs.push(d);
    total += d;
  }
  if (total === 0) return path[0];
  let target = total * fraction;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      return sph.interpolate(path[i], path[i + 1], segs[i] === 0 ? 0 : target / segs[i]);
    }
    target -= segs[i];
  }
  return path[path.length - 1];
}

// Typkuerzel (LF, HLF, DLK, …) aus dem Typ-Text ableiten
function typKuerzel(typ) {
  const t = (typ || "").trim().split(" ")[0];
  if (!t || t === "Sonstiges") return "FW";
  return t;
}

// Grobe Kategorie fuer die Silhouette
function typKategorie(typ) {
  const k = typKuerzel(typ);
  if (k === "DLK") return "ladder"; // Drehleiter
  if (["MTW", "ELW", "KdoW"].includes(k)) return "van"; // Mannschaft/Führung
  return "truck"; // Loeschfahrzeuge & Co.
}

// SVG-Elemente eines Feuerwehrautos im Koordinatenraum 0..40 x 0..24.
// Karosserie rot, Umrandung + Blaulicht in der Statusfarbe.
function truckShapes(kategorie, statusColor) {
  const red = "#c81e1e";
  let s = "";
  if (kategorie === "ladder") {
    s += `<line x1='6' y1='11' x2='40' y2='3' stroke='#9ca3af' stroke-width='2.5'/>`;
  }
  if (kategorie === "van") {
    s += `<rect x='5' y='6' width='30' height='13' rx='2.5' fill='${red}' stroke='${statusColor}' stroke-width='2'/>`;
    s += `<rect x='24' y='8' width='8' height='5' rx='1' fill='#bfdbfe'/>`;
  } else {
    s += `<rect x='3' y='8' width='34' height='11' rx='2' fill='${red}' stroke='${statusColor}' stroke-width='2'/>`;
    s += `<rect x='28' y='10' width='6' height='4' rx='1' fill='#bfdbfe'/>`;
  }
  s += `<rect x='16' y='5' width='6' height='3' rx='1' fill='${statusColor}'/>`; // Blaulicht
  s += `<circle cx='11' cy='20' r='3.2' fill='#111'/><circle cx='30' cy='20' r='3.2' fill='#111'/>`;
  return s;
}

// Vollstaendiges Marker-Icon eines einzelnen Fahrzeugs (Beschriftung darunter).
function fahrzeugIcon(typ, statusColor) {
  const inner =
    truckShapes(typKategorie(typ), statusColor) +
    `<text x='20' y='16' font-size='7' font-family='sans-serif' font-weight='800' fill='white' text-anchor='middle'>${escapeXml(typKuerzel(typ))}</text>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='26'>${inner}</svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(40, 26),
    anchor: new window.google.maps.Point(20, 24),
    labelOrigin: new window.google.maps.Point(20, 36),
  };
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
  );
}

// SVG-Icon fuer mehrere Fahrzeuge an (nahezu) gleicher Position: eine Liste,
// jede Zeile mit kleinem Feuerwehrauto (nach Typ) und Funkrufname.
function clusterIcon(items) {
  const lh = 22, padX = 8, padY = 8, truckW = 40 * 0.5, textX = padX + truckW + 4;
  const maxChars = Math.max(...items.map((i) => i.name.length));
  const w = Math.min(320, Math.max(150, textX + maxChars * 6.6 + 8));
  const h = padY * 2 + items.length * lh;
  let rows = "";
  items.forEach((it, i) => {
    const top = padY + i * lh;
    const y = top + lh / 2;
    rows +=
      `<g transform='translate(${padX},${top - 1}) scale(0.5)'>${truckShapes(typKategorie(it.typ), it.color)}</g>` +
      `<text x='${textX}' y='${y + 4}' font-size='11' font-family='sans-serif' font-weight='700' fill='#0b1120'>${escapeXml(it.name)}</text>`;
  });
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect x='0.75' y='0.75' width='${w - 1.5}' height='${h - 1.5}' rx='8' fill='white' fill-opacity='0.95' stroke='#b91c1c' stroke-width='1.5'/>` +
    rows +
    `</svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(w, h),
    anchor: new window.google.maps.Point(w / 2, 0),
  };
}

// Zeigt eine Google-Maps-Karte mit einem Marker am Einsatzort.
// Ist ein `origin` (Feuerwehr-Standort) gesetzt, wird zusaetzlich die
// Fahrtstrecke vom Standort zum Einsatzort eingezeichnet.
// `vehicles` (disponierte Fahrzeuge) werden als Marker dargestellt: an der
// Wache, am Einsatzort (Status 4) oder – bei Status 3 – an der entlang der
// Route geschaetzten aktuellen Position (Blaulichtfahrt mit Sonderrechten).
// Faellt ohne API-Key auf eine Hinweis-/Platzhalteranzeige zurueck.
export default function MapView({ lat, lng, label, origin = null, vehicles = [], zoom = 15, height = "100%" }) {
  const { loaded, error, hasKey } = useGoogleMaps();
  const ref = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const originMarkerRef = useRef(null);
  const directionsRef = useRef(null);
  const routePathRef = useRef(null);
  const emergencyDurRef = useRef(null);
  const vehicleMarkersRef = useRef(new Map());
  const propsRef = useRef({});

  const hasOrigin = origin && origin.lat != null && origin.lng != null;
  propsRef.current = { vehicles, origin, dest: { lat, lng } };

  // Fahrzeug-Marker anhand des aktuellen Status/Zeit positionieren
  function updateVehicleMarkers() {
    const g = window.google;
    if (!g || !mapRef.current) return;
    const { vehicles: vs, origin: o, dest } = propsRef.current;
    const destPos = dest.lat != null && dest.lng != null ? { lat: Number(dest.lat), lng: Number(dest.lng) } : null;
    const stationPos = o && o.lat != null && o.lng != null ? { lat: Number(o.lat), lng: Number(o.lng) } : null;
    const markers = vehicleMarkersRef.current;

    // 1) Position je Fahrzeug bestimmen
    const positioned = [];
    for (const v of vs || []) {
      let pos = null;
      if (v.status === 4) {
        pos = destPos; // am Einsatzort
      } else if (v.status === 3 && v.status3At && routePathRef.current && emergencyDurRef.current) {
        const elapsed = (Date.now() - new Date(v.status3At).getTime()) / 1000;
        const frac = Math.max(0, Math.min(1, elapsed / emergencyDurRef.current));
        pos = pointAlongPath(routePathRef.current, frac);
        pos = { lat: pos.lat(), lng: pos.lng() };
      } else if (stationPos) {
        pos = stationPos; // disponiert, noch an der Wache
      }
      if (pos) positioned.push({ v, pos });
    }

    // 2) Fahrzeuge mit (nahezu) gleicher Position zusammenfassen (~11 m Raster)
    const groups = new Map();
    for (const p of positioned) {
      const key = `${p.pos.lat.toFixed(4)},${p.pos.lng.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    // 3) Marker erzeugen/aktualisieren – Einzelfahrzeug als Punkt, Gruppe als Liste
    const seen = new Set();
    for (const [, members] of groups) {
      const pos = members[0].pos;
      if (members.length === 1) {
        const v = members[0].v;
        const key = `v:${v.id}`;
        seen.add(key);
        let marker = markers.get(key);
        if (!marker) { marker = new g.maps.Marker({ map: mapRef.current }); markers.set(key, marker); }
        marker.setPosition(pos);
        marker.setTitle(`${v.funkrufname} · ${v.typ || ""} (Status ${v.status})`);
        marker.setIcon(fahrzeugIcon(v.typ, STATUS[v.status]?.color || "#2563eb"));
        marker.setLabel({ text: v.funkrufname, fontSize: "11px", fontWeight: "700", color: "#0b1120" });
        marker.setZIndex(v.status === 3 ? 1000 : 500);
      } else {
        const sorted = [...members].sort((a, b) => a.v.funkrufname.localeCompare(b.v.funkrufname));
        const key = `c:${members[0].pos.lat.toFixed(4)},${members[0].pos.lng.toFixed(4)}`;
        seen.add(key);
        let marker = markers.get(key);
        if (!marker) { marker = new g.maps.Marker({ map: mapRef.current }); markers.set(key, marker); }
        marker.setPosition(pos);
        marker.setTitle(sorted.map((m) => `${m.v.funkrufname} · ${m.v.typ || ""} (Status ${m.v.status})`).join("\n"));
        marker.setIcon(clusterIcon(sorted.map((m) => ({ name: m.v.funkrufname, typ: m.v.typ, color: STATUS[m.v.status]?.color || "#2563eb" }))));
        marker.setLabel(null);
        marker.setZIndex(1500);
      }
    }
    // 4) nicht mehr benoetigte Marker entfernen
    for (const [key, marker] of markers) {
      if (!seen.has(key)) {
        marker.setMap(null);
        markers.delete(key);
      }
    }
  }

  useEffect(() => {
    if (!loaded || !ref.current || lat == null || lng == null) return;
    const pos = { lat: Number(lat), lng: Number(lng) };
    if (!mapRef.current) {
      mapRef.current = new window.google.maps.Map(ref.current, {
        center: pos,
        zoom,
        mapTypeId: window.google.maps.MapTypeId.HYBRID, // Satellitenansicht mit Beschriftung
        disableDefaultUI: false,
        streetViewControl: false,
        mapTypeControl: false,
      });
      // Live-Verkehr inkl. Baustellen-Staus und Sperrungen einblenden
      new window.google.maps.TrafficLayer().setMap(mapRef.current);
    } else {
      mapRef.current.setCenter(pos);
    }

    // Einsatzort-Marker
    if (markerRef.current) markerRef.current.setMap(null);
    markerRef.current = new window.google.maps.Marker({
      position: pos,
      map: mapRef.current,
      title: label || "Einsatzort",
      animation: window.google.maps.Animation.DROP,
    });

    // Vorherige Route/Standort-Marker entfernen
    if (directionsRef.current) { directionsRef.current.setMap(null); directionsRef.current = null; }
    if (originMarkerRef.current) { originMarkerRef.current.setMap(null); originMarkerRef.current = null; }

    if (hasOrigin) {
      const from = { lat: Number(origin.lat), lng: Number(origin.lng) };
      const service = new window.google.maps.DirectionsService();
      const renderer = new window.google.maps.DirectionsRenderer({
        map: mapRef.current,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: "#b91c1c", strokeWeight: 6, strokeOpacity: 0.85 },
      });
      service.route(
        {
          origin: from,
          destination: pos,
          travelMode: window.google.maps.TravelMode.DRIVING,
          // Verkehrs-/Baustellenlage einbeziehen (aktuelle Bedingungen)
          drivingOptions: { departureTime: new Date(), trafficModel: "bestguess" },
        },
        (result, status) => {
          if (status === "OK" && result) {
            renderer.setDirections(result);
            directionsRef.current = renderer;
            // Routenpfad + (Sonderrechte-)Fahrzeit fuer die Positionsschaetzung merken
            const route = result.routes[0];
            routePathRef.current = route.overview_path;
            const leg = route.legs[0];
            emergencyDurRef.current = einsatzFahrzeitSek(leg.duration_in_traffic?.value ?? leg.duration.value);
            updateVehicleMarkers();
            // Karte auf gesamte Strecke einpassen
            const bounds = new window.google.maps.LatLngBounds();
            bounds.extend(from);
            bounds.extend(pos);
            mapRef.current.fitBounds(bounds, 60);
          } else {
            renderer.setMap(null);
            routePathRef.current = null;
            emergencyDurRef.current = null;
          }
        }
      );
      // Standort-Marker (Feuerwehr)
      originMarkerRef.current = new window.google.maps.Marker({
        position: from,
        map: mapRef.current,
        title: origin.name || "Feuerwehr",
        label: { text: "🚒", fontSize: "20px" },
      });
    } else {
      routePathRef.current = null;
      emergencyDurRef.current = null;
    }
    updateVehicleMarkers();
  }, [loaded, lat, lng, label, zoom, hasOrigin, origin?.lat, origin?.lng, origin?.name]);

  // Fahrzeug-Marker bei Statusaenderungen sofort aktualisieren
  useEffect(() => {
    updateVehicleMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles]);

  // Laufende Positionsschaetzung fuer Fahrzeuge in Anfahrt (Status 3)
  useEffect(() => {
    if (!loaded) return;
    const t = setInterval(updateVehicleMarkers, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!hasKey || error === "no-key") {
    return (
      <div className="map-fallback" style={{ height }}>
        <div>
          <strong>Karte nicht verfügbar</strong>
          <p>
            Kein Google-Maps-API-Key hinterlegt. Trage einen Schlüssel in
            <code> client/.env </code> als <code>VITE_GOOGLE_MAPS_API_KEY</code> ein.
          </p>
          {lat != null && lng != null && (
            <p className="coords">
              Koordinaten: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
              <br />
              <a
                href={`https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
              >
                In Google Maps öffnen
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-fallback" style={{ height }}>
        <div><strong>Karte konnte nicht geladen werden</strong><p>{error}</p></div>
      </div>
    );
  }

  if (lat == null || lng == null) {
    return (
      <div className="map-fallback" style={{ height }}>
        <div><strong>Kein Einsatzort gesetzt</strong><p>Für diesen Einsatz wurden keine Koordinaten hinterlegt.</p></div>
      </div>
    );
  }

  return <div ref={ref} style={{ width: "100%", height }} className="map-canvas" />;
}
