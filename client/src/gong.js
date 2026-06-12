// Synthetischer Gong-/Alarmton ueber die Web Audio API – ohne Audiodatei.
// Browser erlauben Tonausgabe erst nach einer Nutzerinteraktion, daher kann
// der AudioContext ueber unlockAudio() (z. B. bei einem Klick) freigeschaltet
// werden.

let ctx = null;
let customAudio = null;
let customUrl = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// Eigene Gong-Datei festlegen (URL) bzw. mit null auf den Standard-Gong zuruecksetzen
export function setCustomGong(url) {
  if (url === customUrl) return;
  customUrl = url;
  customAudio = url ? new Audio(url) : null;
  if (customAudio) customAudio.preload = "auto";
}

// AudioContext + HTML-Audio nach einer Nutzerinteraktion aktivieren (Autoplay-Sperre)
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume();
  if (customAudio) {
    customAudio.muted = true;
    customAudio
      .play()
      .then(() => {
        customAudio.pause();
        customAudio.currentTime = 0;
        customAudio.muted = false;
      })
      .catch(() => { customAudio.muted = false; });
  }
}

// Einen Gong-Schlag abspielen
function strike(c, startAt, baseFreq, peak) {
  const master = c.createGain();
  master.connect(c.destination);
  master.gain.setValueAtTime(0.0001, startAt);
  master.gain.exponentialRampToValueAtTime(peak, startAt + 0.008);
  master.gain.exponentialRampToValueAtTime(0.0001, startAt + 3.2);

  // Inharmonische Teiltoene fuer einen metallischen Gong-Klang
  const partials = [
    { mul: 1.0, g: 1.0 },
    { mul: 2.0, g: 0.55 },
    { mul: 2.76, g: 0.4 },
    { mul: 3.95, g: 0.28 },
    { mul: 5.4, g: 0.16 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = baseFreq * p.mul;
    const g = c.createGain();
    g.gain.value = p.g;
    osc.connect(g).connect(master);
    osc.start(startAt);
    osc.stop(startAt + 3.2);
  }
}

function playSynth(onDone) {
  const c = getCtx();
  if (!c) { if (onDone) onDone(); return; }
  if (c.state === "suspended") c.resume();
  const now = c.currentTime;
  // Zwei Schlaege fuer einen praegnanten Alarmgong
  strike(c, now, 146.83, 0.9);        // D3
  strike(c, now + 0.42, 110.0, 0.8);  // A2
  // Ansage nach den Schlaegen starten (waehrend der Gong leise ausklingt)
  if (onDone) setTimeout(onDone, 2000);
}

// Spielt den Gong und ruft onDone auf, sobald er (im Wesentlichen) verklungen ist.
export function playGong(onDone) {
  if (customAudio) {
    customAudio.currentTime = 0;
    customAudio.onended = () => { if (onDone) onDone(); };
    customAudio.play().catch(() => playSynth(onDone)); // bei Fehler Standard-Gong
    return;
  }
  playSynth(onDone);
}
