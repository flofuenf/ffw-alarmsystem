import { useEffect, useState } from "react";

// Abonniert den Server-Sent-Events-Stream und haelt den kompletten
// State (vehicles, missions) live aktuell. Faellt bei Verbindungsabbruch
// automatisch auf Polling zurueck.
export function useLiveState() {
  const [state, setState] = useState({ vehicles: [], missions: [], settings: { station: {} } });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es;
    let pollTimer;

    function startPolling() {
      const poll = async () => {
        try {
          const r = await fetch("/api/state");
          if (r.ok) setState(await r.json());
        } catch {}
      };
      poll();
      pollTimer = setInterval(poll, 4000);
    }

    try {
      es = new EventSource("/api/stream");
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        try {
          setState(JSON.parse(e.data));
        } catch {}
      };
      es.onerror = () => {
        setConnected(false);
      };
    } catch {
      startPolling();
    }

    return () => {
      es && es.close();
      pollTimer && clearInterval(pollTimer);
    };
  }, []);

  return { ...state, connected };
}
