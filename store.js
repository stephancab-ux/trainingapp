/* Remonte storage — single localStorage document, write-through, with a
   migration chain and corrupt-data recovery (spec §8). */
import { generateWeek1 } from "./engine.js";

export const KEY = "remonte.v1";
export const SCHEMA_VERSION = 3;

/* The Progress cards in their default order; `on` = shown out of the box. */
export const PROGRESS_CARDS = [
  { id: "volume",      on: true },
  { id: "trainingLoad", on: true },
  { id: "streak",      on: true },
  { id: "calories",    on: true },
  { id: "weight",      on: true },
  { id: "pace",        on: true },
  { id: "coach",       on: true },
  { id: "bests",       on: true },
  { id: "vo2",         on: false },
  { id: "balance",     on: false },
  { id: "caloriesByType", on: false },
  { id: "runSpeed",    on: false },
  { id: "rideSpeed",   on: false },
  { id: "ascent",      on: false },
  { id: "paceVsRpe",   on: false },
  { id: "efficiency",  on: false },
  { id: "rpeHeatmap",  on: false },
  { id: "rpeByType",   on: false },
  { id: "consistency", on: false },
];
const CARD_IDS = PROGRESS_CARDS.map(c => c.id);

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function defaultSettings() {
  return {
    maxHR: 183,
    maxHRAuto: true,
    age: null,
    restingHR: null,
    lthr: null,
    customZones: null,
    zoneMethod: "pctmax",
    targetWeightKg: 80.0,
    growthRate: 0.07,
    deloadEvery: 4,
    hrvBaselineLow: 42,
    layout: { mon: "run", tue: "bike", wed: "run", thu: "bike", fri: "run", sat: "bike-long", sun: "rest" },
    restDay: "sun",
    qualityUnlocked: false,
    qualityOverride: false,
    easyPace: null,
    climbBaseAscent: 500,
    allowedTypes: {
      easyRun: true, runTempo: true, runIntervals: true, runHills: true, longRun: true, trailRun: true,
      easyRide: true, bikeIntervals: true, bikeClimb: true, longRide: true,
    },
    progressRange: { preset: "12w", offset: 0, compare: false },
    progressCards: PROGRESS_CARDS.map(c => ({ ...c })),
    lastExportAt: null,
  };
}

const SEED_WEIGHINS = [
  { date: "2025-12-05", kg: 86.5 }, { date: "2026-01-04", kg: 88.5 },
  { date: "2026-02-08", kg: 87.5 }, { date: "2026-02-23", kg: 87.6 },
  { date: "2026-03-07", kg: 87.2 }, { date: "2026-06-08", kg: 87.4 },
];

const SEED_VO2 = [
  { date: "2024-07-01", value: 47.3 }, { date: "2025-02-01", value: 47.3 },
  { date: "2025-05-01", value: 48.7 }, { date: "2025-07-01", value: 46.7 },
  { date: "2025-10-01", value: 41.8 }, { date: "2026-01-01", value: 42.4 },
  { date: "2026-04-01", value: 43.3 }, { date: "2026-06-01", value: 42.8 },
];

const SEED_LOGS = [
  ["2026-05-01", "bike", 155, 24.23, 145], ["2026-05-05", "run", 27, 5.02, 169],
  ["2026-05-09", "bike", 91, 32.26, 133],  ["2026-05-14", "bike", 70, 16.28, 123],
  ["2026-05-19", "run", 28, 5.01, 164],    ["2026-05-20", "bike", 75, 30.28, 143],
  ["2026-05-22", "run", 35, 5.84, 171],    ["2026-05-23", "bike", 230, 33.97, 129],
  ["2026-05-24", "bike", 54, 17.45, 118],  ["2026-05-26", "run", 35, 5.49, 169],
  ["2026-05-28", "bike", 65, 30.08, 154],  ["2026-06-01", "bike", 93, 18.04, 125],
  ["2026-06-02", "run", 30, 5.47, 170],    ["2026-06-03", "bike", 169, 35.42, 126],
  ["2026-06-05", "run", 41, 7.04, 166],    ["2026-06-06", "run", 38, 6.51, 167],
  ["2026-06-07", "bike", 212, 39.48, 133], ["2026-06-11", "bike", 170, 70.71, 141],
  ["2026-06-12", "run", 42, 7.01, 167],
];

export function seedLogs() {
  return SEED_LOGS.map(([date, sport, min, km, avgHR], i) => ({
    id: "seed-" + (i + 1), date, sport, min, km, avgHR, source: "seed",
  }));
}

export function initDoc(startDate, todayISO) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: todayISO,
    settings: defaultSettings(),
    weeks: [generateWeek1(startDate)],
    logs: seedLogs(),
    checkins: [],
    weighIns: SEED_WEIGHINS.map(w => ({ ...w })),
    vo2History: SEED_VO2.map(v => ({ ...v })),
    manualBests: [],
    coachDismissed: {},
  };
}

/* Union the stored progress-card order with any cards added in a later
   release (appended, off), dropping ids that no longer exist. */
export function normalizeProgressCards(stored) {
  const known = new Set(CARD_IDS);
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(stored) ? stored : []) {
    if (known.has(c.id) && !seen.has(c.id)) { out.push({ id: c.id, on: !!c.on }); seen.add(c.id); }
  }
  for (const c of PROGRESS_CARDS) if (!seen.has(c.id)) out.push({ ...c });
  return out;
}

/* ---- load / save ---- */

export function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (raw == null) return null;
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || typeof doc.schemaVersion !== "number") throw new Error("shape");
    return migrate(doc);
  } catch {
    const err = new Error("Stored data is unreadable");
    err.corrupt = true;
    err.raw = raw;
    throw err;
  }
}

export function save(doc) {
  localStorage.setItem(KEY, JSON.stringify(doc));
}

export function wipe() {
  localStorage.removeItem(KEY);
}

/* ---- migrations: add a step per schema bump; each takes vN → vN+1 ---- */

const MIGRATIONS = {
  // v2: settings gain easyPace + qualityOverride (via the defaults merge);
  // logs may carry an optional `type` tag.
  1: d => ({ ...d, schemaVersion: 2 }),
  // v3: settings gain restDay, climbBaseAscent, allowedFamilies, progressCards
  // (via the defaults merge); doc gains manualBests + coachDismissed.
  2: d => ({ ...d, schemaVersion: 3 }),
  // v4: allowedFamilies → allowedTypes (the family keys carry over, the easy/
  // long/trail keys default on); progressRange added via the defaults merge.
  3: d => {
    const fam = d.settings?.allowedFamilies || {};
    const allowedTypes = {
      easyRun: true, runTempo: fam.runTempo !== false, runIntervals: fam.runIntervals !== false,
      runHills: fam.runHills !== false, longRun: true, trailRun: true,
      easyRide: true, bikeIntervals: fam.bikeIntervals !== false, bikeClimb: fam.bikeClimb !== false, longRide: true,
    };
    const settings = { ...d.settings, allowedTypes };
    delete settings.allowedFamilies;
    return { ...d, settings, schemaVersion: 4 };
  },
};

export function migrate(doc) {
  let d = doc;
  while (d.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[d.schemaVersion];
    if (!step) break;
    d = step(d);
  }
  // settings keys added after first release get safe defaults
  d.settings = { ...defaultSettings(), ...d.settings };
  d.settings.allowedTypes = { ...defaultSettings().allowedTypes, ...(d.settings.allowedTypes || {}) };
  d.settings.progressCards = normalizeProgressCards(d.settings.progressCards);
  for (const k of ["weeks", "logs", "checkins", "weighIns", "vo2History"]) d[k] ||= [];
  d.manualBests ||= [];
  d.coachDismissed ||= {};
  return d;
}

/* ---- import / export ---- */

export function validateImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "Not valid JSON" }; }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "Not a Remonte export" };
  if (typeof parsed.schemaVersion !== "number") return { ok: false, error: "Missing schemaVersion — not a Remonte export" };
  if (parsed.schemaVersion > SCHEMA_VERSION) return { ok: false, error: "Export is from a newer app version" };
  for (const k of ["settings", "logs"]) {
    if (!(k in parsed)) return { ok: false, error: `Missing "${k}" — not a Remonte export` };
  }
  return { ok: true, doc: migrate(parsed) };
}

/* Merge: union of records (current wins on conflicts), current settings kept. */
export function mergeDocs(current, incoming) {
  const out = structuredClone(current);
  const logSig = l => l.id || `${l.date}|${l.sport}|${l.min}|${l.time || ""}`;
  const have = new Set(out.logs.map(logSig));
  for (const l of incoming.logs || []) {
    if (!have.has(logSig(l))) { out.logs.push(l); have.add(logSig(l)); }
  }
  out.logs.sort((a, b) => (a.date < b.date ? -1 : 1));

  const byDate = (cur, inc) => {
    const dates = new Set(cur.map(x => x.date));
    return cur.concat((inc || []).filter(x => !dates.has(x.date)))
              .sort((a, b) => (a.date < b.date ? -1 : 1));
  };
  out.weighIns = byDate(out.weighIns, incoming.weighIns);
  out.vo2History = byDate(out.vo2History, incoming.vo2History);

  const weekIds = new Set(out.weeks.map(w => w.id));
  for (const w of incoming.weeks || []) if (!weekIds.has(w.id)) out.weeks.push(w);
  out.weeks.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  out.weeks.forEach((w, i) => { w.weekNum = i + 1; });

  const ciIds = new Set(out.checkins.map(c => c.weekId));
  for (const c of incoming.checkins || []) if (!ciIds.has(c.weekId)) out.checkins.push(c);

  // personal-best manual entries: keep the better value per key
  out.manualBests ||= [];
  const lowerBetter = new Set(["run5k", "run10k", "runHalf", "runFull", "bike40k"]);
  for (const m of incoming.manualBests || []) {
    const cur = out.manualBests.find(x => x.key === m.key);
    if (!cur) out.manualBests.push({ ...m });
    else if (lowerBetter.has(m.key) ? m.value < cur.value : m.value > cur.value) Object.assign(cur, m);
  }
  out.coachDismissed = { ...(incoming.coachDismissed || {}), ...(out.coachDismissed || {}) };
  return out;
}

export function exportText(doc) {
  return JSON.stringify(doc, null, 1);
}
