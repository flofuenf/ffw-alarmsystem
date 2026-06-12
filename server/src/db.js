import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "db.json");

const DEFAULT_DATA = {
  vehicles: [],
  missions: [],
  settings: {
    station: { name: "", adresse: "", lat: null, lng: null },
    gong: { hasCustom: false, mime: null, updatedAt: null },
    tts: { voice: "" },
  },
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

export function load() {
  ensureFile();
  try {
    const raw = readFileSync(DB_FILE, "utf-8");
    const data = JSON.parse(raw);
    return {
      ...DEFAULT_DATA,
      ...data,
      settings: {
        ...DEFAULT_DATA.settings,
        ...(data.settings || {}),
        station: { ...DEFAULT_DATA.settings.station, ...(data.settings?.station || {}) },
        gong: { ...DEFAULT_DATA.settings.gong, ...(data.settings?.gong || {}) },
        tts: { ...DEFAULT_DATA.settings.tts, ...(data.settings?.tts || {}) },
      },
    };
  } catch (err) {
    console.error("DB konnte nicht gelesen werden, nutze Standardwerte:", err.message);
    return structuredClone(DEFAULT_DATA);
  }
}

export function save(data) {
  ensureFile();
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
