// Zentrale Pfade – funktionieren sowohl in der Entwicklung (node)
// als auch in der gepackten Anwendung (pkg/.exe).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packaged = !!process.pkg; // von pkg gesetzt, wenn als .exe gestartet
// Im Paket (CJS-Bundle) ist __dirname verfuegbar; in der Entwicklung (ESM) import.meta.url.
// (Der jeweils nicht zutreffende Zweig wird nicht ausgewertet.)
const here = packaged ? __dirname : dirname(fileURLToPath(import.meta.url));
const exeDir = dirname(process.execPath); // Verzeichnis der gestarteten .exe

// Schreibbare Daten: im Paket NEBEN der .exe (Snapshot ist schreibgeschützt), sonst server/data
export const DATA_DIR = packaged ? join(exeDir, "data") : join(here, "..", "data");

// Statisches Frontend: im Paket eingebettet (build/public), sonst client/dist
export const PUBLIC_DIR = packaged ? join(here, "public") : join(here, "..", "..", "client", "dist");
