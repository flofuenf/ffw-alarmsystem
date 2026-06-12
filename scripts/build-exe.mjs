// Baut die gesamte App zu eigenstaendigen Programmen (ohne Node/npm zum Starten).
//   node scripts/build-exe.mjs            -> Windows (.exe)
//   node scripts/build-exe.mjs mac        -> macOS (Apple Silicon + Intel)
//   node scripts/build-exe.mjs all        -> Windows, macOS, Linux
//   node scripts/build-exe.mjs win mac-arm-> gezielte Auswahl
//
// Ergebnis: dist/alarmsystem-*  (+ optionaler vendor/piper-Ordner daneben)

import { execSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

const ALL = {
  win: { pkg: "node22-win-x64", out: "alarmsystem-win.exe" },
  "mac-arm": { pkg: "node22-macos-arm64", out: "alarmsystem-macos-arm64" },
  "mac-x64": { pkg: "node22-macos-x64", out: "alarmsystem-macos-x64" },
  linux: { pkg: "node22-linux-x64", out: "alarmsystem-linux" },
};

// Plattform-Auswahl aus den Argumenten bestimmen
const args = process.argv.slice(2);
let keys;
if (args.length === 0) {
  keys = ["win"];
} else if (args.includes("all")) {
  keys = Object.keys(ALL);
} else {
  keys = [];
  for (const a of args) {
    if (a === "mac") keys.push("mac-arm", "mac-x64");
    else if (ALL[a]) keys.push(a);
  }
}
keys = [...new Set(keys)];
if (keys.length === 0) {
  console.error("Keine gueltige Plattform. Optionen: win, mac, mac-arm, mac-x64, linux, all");
  process.exit(1);
}

console.log("\n[1/4] Frontend bauen (vite)…");
run("npm run build --prefix client");

console.log("\n[2/4] Build-Ordner vorbereiten…");
const build = join(root, "build");
rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
cpSync(join(root, "client", "dist"), join(build, "public"), { recursive: true });

console.log("\n[3/4] Server buendeln (esbuild)…");
run(
  "npx esbuild server/src/index.js --bundle --platform=node --format=cjs " +
    "--target=node20 --external:pdfkit --outfile=build/server.cjs"
);

console.log(`\n[4/4] Ausfuehrbare Datei(en) erstellen (pkg): ${keys.join(", ")}`);
mkdirSync(join(root, "dist"), { recursive: true });
for (const k of keys) {
  const t = ALL[k];
  console.log(`\n  -> ${k} (${t.pkg})`);
  // --no-bytecode + --public: ohne Bytecode-Generierung -> auch Cross-Compile
  // (z. B. macOS-Build unter Windows) moeglich; bettet plain JS ein.
  run(
    `npx @yao-pkg/pkg build/server.cjs --config pkg.config.json ` +
      `--targets ${t.pkg} --output dist/${t.out} --no-bytecode --public --public-packages "*"`
  );
}

console.log("\nFertig. Erzeugt in dist/:");
for (const k of keys) console.log(`  - ${ALL[k].out}`);
if (existsSync(join(root, "server", "vendor", "piper"))) {
  console.log("\nTipp: Fuer Piper-Sprachausgabe den passenden vendor/piper-Ordner neben das Programm legen.");
}
