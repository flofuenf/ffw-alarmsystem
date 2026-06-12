// Sprachausgabe (Text-to-Speech) ueber die Web Speech API.
// Waehlt automatisch die natuerlichste verfuegbare deutsche Stimme
// (bevorzugt neuronale/Online-Stimmen, meidet robotische wie eSpeak).

// Stimmen werden in manchen Browsern asynchron geladen -> frueh anstossen.
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function voiceScore(v) {
  const name = (v.name || "").toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  if (!lang.startsWith("de")) return -1;
  let s = 1; // Grundwert fuer jede deutsche Stimme
  // Neuronale / Online-Stimmen klingen am natuerlichsten
  if (name.includes("natural") || name.includes("neural")) s += 100;
  if (v.localService === false) s += 40; // Online-Stimme
  if (name.includes("online")) s += 20;
  if (name.includes("google")) s += 60; // "Google Deutsch" klingt recht natuerlich
  // Bekannte, angenehm klingende Windows-/Apple-Stimmen
  if (/(katja|hedda|conrad|stefan|vicki|petra|markus|anna|gisela|yannick|helena)/.test(name)) s += 35;
  // Robotische Stimmen abwerten
  if (name.includes("espeak") || name.includes("e-speak")) s -= 80;
  return s;
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  let best = null;
  let bestScore = 0;
  for (const v of voices) {
    const sc = voiceScore(v);
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return best;
}

let serverAudio = null;

export function cancelSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (serverAudio) { serverAudio.pause(); serverAudio = null; }
}

// Ansage ueber die serverseitige (Piper-)Sprachsynthese abspielen.
// Promise wird abgelehnt, wenn der Server keine Audiodaten liefert.
export function speakServer(text) {
  return new Promise((resolve, reject) => {
    if (!text) return reject(new Error("kein Text"));
    const a = new Audio(`/api/tts?text=${encodeURIComponent(text)}`);
    serverAudio = a;
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("Server-TTS nicht verfügbar"));
    a.play().catch(reject);
  });
}

// Liste der verfuegbaren Stimmen (z. B. fuer eine Auswahl in den Einstellungen)
export function getVoices() {
  return window.speechSynthesis?.getVoices() || [];
}

// Liefert ein Promise, das aufgeloest wird, wenn die Ansage beendet ist.
export function speak(text, preferredName) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || !text) { resolve(); return; }
    synth.cancel(); // laufende Ansage abbrechen
    const u = new SpeechSynthesisUtterance(text);
    const named = preferredName ? getVoices().find((v) => v.name === preferredName) : null;
    const voice = named || pickVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "de-DE";
    }
    u.rate = 1.0;   // natuerliches Tempo
    u.pitch = 1.0;  // natuerliche Tonhoehe
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}
