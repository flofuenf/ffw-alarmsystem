// Sprachsynthese ueber Microsoft Edge (neuronale Online-Stimmen, kostenlos, ohne API-Key).
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// Auswahl gaengiger deutscher Edge-Stimmen
export const EDGE_VOICES = [
  { id: "de-DE-ConradNeural", label: "Conrad (männlich)" },
  { id: "de-DE-KillianNeural", label: "Killian (männlich)" },
  { id: "de-DE-FlorianMultilingualNeural", label: "Florian (männlich)" },
  { id: "de-DE-KatjaNeural", label: "Katja (weiblich)" },
  { id: "de-DE-AmalaNeural", label: "Amala (weiblich)" },
  { id: "de-DE-SeraphinaMultilingualNeural", label: "Seraphina (weiblich)" },
];

export const DEFAULT_EDGE_VOICE = "de-DE-ConradNeural";

// Text -> MP3-Buffer (wirft bei fehlendem Internet / Fehler)
export async function edgeSynth(text, voice = DEFAULT_EDGE_VOICE) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice || DEFAULT_EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  try {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), 20000);
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      audioStream.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    try { tts.close(); } catch {}
  }
}
