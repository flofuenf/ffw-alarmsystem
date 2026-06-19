// Laedt die Piper-Binary und ein deutsches Stimmmodell nach server/vendor/piper/.
// Plattformabhaengig; idempotent (vorhandene Dateien werden nicht erneut geladen).
//
//   node scripts/setup-piper.mjs   (bzw. npm run setup:piper)

import { existsSync, mkdirSync, createWriteStream, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(__dirname, "..", "server", "vendor", "piper");

const PIPER_VERSION = "2023.11.14-2";
const ASSETS = {
  "win32-x64": "piper_windows_amd64.zip",
  "linux-x64": "piper_linux_x86_64.tar.gz",
  "linux-arm64": "piper_linux_aarch64.tar.gz",
  "darwin-x64": "piper_macos_x64.tar.gz",
  "darwin-arm64": "piper_macos_aarch64.tar.gz",
};

const MODEL = "de_DE-thorsten-medium.onnx";
const MODEL_URL =
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx";

const binName = process.platform === "win32" ? "piper.exe" : "piper";
const binPath = join(VENDOR, "piper", binName);
const modelPath = join(VENDOR, MODEL);

async function download(url, dest) {
  process.stdout.write(`  ↓ ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSETS[key];
  if (!asset) {
    console.error(`Keine Piper-Binary fuer ${key} verfuegbar. Bitte manuell installieren und PIPER_BIN/PIPER_MODEL setzen.`);
    process.exit(1);
  }
  mkdirSync(VENDOR, { recursive: true });

  // 1) Binary
  if (existsSync(binPath)) {
    console.log("✓ Piper-Binary bereits vorhanden:", binPath);
  } else {
    console.log("Lade Piper-Binary…");
    const archive = join(VENDOR, asset);
    await download(`https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${asset}`, archive);
    console.log("Entpacke…");
    // bsdtar (Windows) sowie GNU tar (Linux/macOS) koennen das jeweilige Archiv lesen
    execFileSync("tar", ["-xf", archive, "-C", VENDOR], { stdio: "inherit" });
    rmSync(archive, { force: true });
    if (!existsSync(binPath)) throw new Error("Binary nach dem Entpacken nicht gefunden: " + binPath);
    if (process.platform !== "win32") execFileSync("chmod", ["+x", binPath]);
    console.log("✓ Piper-Binary:", binPath);
  }

  // 2) Stimmmodell
  if (existsSync(modelPath)) {
    console.log("✓ Stimmmodell bereits vorhanden:", modelPath);
  } else {
    console.log("Lade Stimmmodell (de_DE-thorsten-medium, ~63 MB)…");
    await download(MODEL_URL, modelPath);
    await download(MODEL_URL + ".json", modelPath + ".json");
    console.log("✓ Stimmmodell:", modelPath);
  }

  // macOS-Warnung: die rhasspy-Releases (2023.11.14-2) liefern KEINE *.dylib mit ->
  // Piper laesst sich auf dem Mac nicht starten ("Library not loaded: @rpath/libespeak-ng.1.dylib").
  if (process.platform === "darwin" && !existsSync(join(dirname(binPath), "libespeak-ng.1.dylib"))) {
    console.warn("\n⚠  ACHTUNG (macOS): Das Piper-Release enthaelt keine Bibliotheken (libespeak-ng …).");
    console.warn("   Piper kann damit NICHT starten. Auf dem Mac empfiehlt sich stattdessen eine");
    console.warn("   hochwertige System-Stimme ueber die Browser-Sprachausgabe – siehe README.");
    return;
  }

  console.log("\nFertig. Der Server nutzt Piper jetzt automatisch (server/vendor/piper).");
}

main().catch((e) => {
  console.error("\nFehler:", e.message);
  process.exit(1);
});
