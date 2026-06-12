// Baut die gesamte App zu einer eigenstaendigen .exe (ohne Node/npm zum Starten).
//   node scripts/build-exe.mjs   (bzw. npm run dist)
//
// Ergebnis: dist/alarmsystem-win.exe  (+ optionaler vendor/piper-Ordner daneben)

import { execSync } from "node:child_process";
import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

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

console.log("\n[4/4] Ausfuehrbare Datei erstellen (pkg)…");
mkdirSync(join(root, "dist"), { recursive: true });
run(
  "npx @yao-pkg/pkg build/server.cjs --config pkg.config.json " +
    "--output dist/alarmsystem-win.exe --public"
);

console.log("\nFertig:  dist/alarmsystem-win.exe");
if (existsSync(join(root, "server", "vendor", "piper"))) {
  console.log("Tipp: Fuer die Piper-Sprachausgabe den Ordner server/vendor/piper nach dist/vendor/piper kopieren.");
}
