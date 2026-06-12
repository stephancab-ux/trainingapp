/* Remonte training engine — pure functions only, no DOM, no storage.
   Every rule here comes from TRAINING_APP_SPEC.md §5 and §7. */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const QUALITY_TEMPLATES = {
  runQ1:     { sport: "run",  family: "intervals", name: "Speed repeats",   zone: 4, label: "8 × 1 min @ Z4 · 2 min Z1 jog between" },
  runQ2:     { sport: "run",  family: "intervals", name: "Speed repeats",   zone: 4, label: "3 × 6 min @ low Z4 · 3 min easy between" },
  runTempo:  { sport: "run",  family: "tempo",     name: "Tempo run",       zone: 3, label: "20 min steady @ Z3 — comfortably hard, even pace" },
  runHills:  { sport: "run",  family: "hills",     name: "Hill repeats",    zone: 4, label: "8 × 45 s uphill strong · walk/jog down between" },
  bikeQ1:    { sport: "bike", family: "intervals", name: "Sweet spot",      zone: 3, label: "3 × 8 min @ Z3–Z4 sweet spot · 5 min easy between" },
  bikeQ2:    { sport: "bike", family: "intervals", name: "Sweet spot",      zone: 3, label: "2 × 12 min @ Z3–Z4 sweet spot · 5 min easy between" },
  bikeClimb: { sport: "bike", family: "climb",     name: "Climbing ride",   zone: 3, label: "Long climb @ Z3 — seated, steady; repeat to fill the session" },
};
export const QUALITY_WARMUP = "15 min warm-up / 10 min cool-down inside the planned time";

/* ---------------- dates ---------------- */

export function parseISO(s) { return new Date(s + "T00:00:00Z"); }
export function toISO(d) { return d.toISOString().slice(0, 10); }
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
export function dayIndex(iso) { return (parseISO(iso).getUTCDay() + 6) % 7; } // 0 = mon

/* Monday on/after the given date (a Monday maps to itself). */
export function snapToMonday(iso) {
  const i = dayIndex(iso);
  return i === 0 ? iso : addDays(iso, 7 - i);
}
export function nextMonday(todayISO) { return snapToMonday(todayISO); }

export function isoWeekId(iso) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() - dayIndex(iso) + 3); // Thursday decides the ISO year
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((d - week1Mon) / (7 * 864e5)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weekDates(startISO) {
  return DAYS.map((_, i) => addDays(startISO, i));
}
export function dateOfDay(week, day) {
  return addDays(week.startDate, DAYS.indexOf(day));
}

/* Start date for the week generated at a check-in: normally the Monday after
   the last week, but if that week is already fully in the past (user came
   back late), pick up from the current week's Monday instead. */
export function nextStartDate(lastWeek, todayISO) {
  const candidate = addDays(lastWeek.startDate, 7);
  if (todayISO > addDays(candidate, 6)) return addDays(todayISO, -dayIndex(todayISO));
  return candidate;
}

/* ---------------- zones ---------------- */

const PCT_BANDS = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0]];
// LTHR banding: contiguous 5-zone scheme in the Friel style, Z5 capped at maxHR.
const LTHR_BANDS = [[0.70, 0.85], [0.85, 0.90], [0.90, 0.95], [0.95, 1.00], [1.00, 1.06]];
export const ZONE_NAMES = ["recovery", "easy", "steady", "threshold", "max"];

export function zoneBounds(settings) {
  const { maxHR, restingHR, lthr, customZones } = settings;
  let method = settings.zoneMethod || "pctmax";
  if (method === "karvonen" && restingHR == null) method = "pctmax";
  if (method === "lthr" && lthr == null) method = "pctmax";
  if (method === "custom" && !Array.isArray(customZones)) method = "pctmax";

  if (method === "custom") {
    return customZones.map((z, i) => ({ z: i + 1, lo: Math.round(z.lo), hi: Math.round(z.hi) }));
  }
  if (method === "lthr") {
    return LTHR_BANDS.map(([a, b], i) => ({
      z: i + 1,
      lo: Math.round(a * lthr),
      hi: Math.min(Math.round(b * lthr), maxHR),
    }));
  }
  if (method === "karvonen") {
    const r = maxHR - restingHR;
    return PCT_BANDS.map(([a, b], i) => ({
      z: i + 1,
      lo: Math.round(restingHR + a * r),
      hi: Math.round(restingHR + b * r),
    }));
  }
  return PCT_BANDS.map(([a, b], i) => ({
    z: i + 1,
    lo: Math.round(a * maxHR),
    hi: Math.round(b * maxHR),
  }));
}

export function zoneMid(bounds, z) {
  const b = bounds[z - 1];
  return Math.round((b.lo + b.hi) / 2);
}

/* ---------------- pace model (§5) ---------------- */

export const COLD_START_PACE = { 2: [420, 465], 3: [375, 405], 4: [325, 355], 5: [270, 300] };

export function qualifyingRuns(logs) {
  return logs
    .filter(l => l.sport === "run" && (l.min || 0) >= 20 && l.km > 0 &&
                 l.avgHR != null && l.avgHR >= 105 && l.avgHR <= 155)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-8);
}

/* Pace range in sec/km for a planned zone. Learned regression predicts at the
   Z2 midpoint only; other zones always use the cold-start table. A manual
   easyPace {lo,hi} replaces the Z2 cold start until the model has 3 runs. */
export function paceHint(logs, bounds, zone = 2, easyPace = null) {
  const cold = COLD_START_PACE[zone] || COLD_START_PACE[2];
  if (zone !== 2) return { lo: cold[0], hi: cold[1], learned: false, n: 0 };
  const runs = qualifyingRuns(logs);
  if (runs.length < 3) {
    if (easyPace && easyPace.lo && easyPace.hi) {
      return { lo: easyPace.lo, hi: easyPace.hi, learned: false, manual: true, n: runs.length };
    }
    return { lo: cold[0], hi: cold[1], learned: false, n: runs.length };
  }
  const xs = runs.map(r => r.avgHR);
  const ys = runs.map(r => (r.min * 60) / r.km);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  let pred;
  if (den < 1e-6) pred = my;
  else pred = my + (num / den) * (zoneMid(bounds, 2) - mx);
  pred = Math.max(240, Math.min(720, pred));
  return { lo: Math.round(pred - 15), hi: Math.round(pred + 15), learned: true, n: runs.length };
}

export function fmtPace(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------------- minute math ---------------- */

export const round5 = v => Math.round(v / 5) * 5;

/* Split a sport's weekly minutes across sessions by weight, in 5-minute
   units, preserving the (rounded) weekly total exactly. */
export function splitMinutes(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const units = Math.round(total / 5);
  const raw = weights.map(w => (units * w) / sum);
  const base = raw.map(Math.floor);
  let left = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) base[order[k % order.length][1]] += 1;
  return base.map(u => u * 5);
}

/* ---------------- week construction ---------------- */

const WEEK1_TABLE = [
  ["mon", "run",  "easy", 35,  2, null],
  ["tue", "bike", "easy", 60,  2, null],
  ["wed", "run",  "easy", 35,  2, null],
  ["thu", "bike", "easy", 75,  2, "Z3 ok on climbs"],
  ["fri", "run",  "easy", 35,  2, null],
  ["sat", "bike", "long", 120, 2, null],
  ["sun", "rest", "rest", 0,   0, null],
];

export function generateWeek1(startDate) {
  const sessions = WEEK1_TABLE.map(([day, sport, kind, targetMin, zone, note]) => {
    const s = { day, sport, kind, targetMin, zone };
    if (note) s.note = note;
    return s;
  });
  return {
    id: isoWeekId(startDate), startDate, weekNum: 1, isDeload: false,
    sessions, targetMin: { run: 105, bike: 255 },
  };
}

/* Build a week's sessions from per-sport minutes over a day→sport layout.
   Long ride gets a double share; every session rounds to 5 min. */
export function buildSessions(runMin, bikeMin, layout, opts = {}) {
  const { deload = false, quality = { run: false, bike: false },
          runQTemplate = "runQ1", bikeQTemplate = "bikeQ1" } = opts;
  const longCap = opts.longCap ?? (deload ? 90 : 210);

  const runDays = DAYS.filter(d => layout[d] === "run");
  const bikeDays = DAYS.filter(d => layout[d] === "bike" || layout[d] === "bike-long");
  const runSplit = splitMinutes(runMin, runDays.map(() => 1));
  const bikeWeights = bikeDays.map(d => (layout[d] === "bike-long" ? 2 : 1));
  let bikeSplit = splitMinutes(bikeMin, bikeWeights);

  const longIdx = bikeDays.findIndex(d => layout[d] === "bike-long");
  if (longIdx >= 0 && bikeSplit[longIdx] > longCap) {
    const excess = bikeSplit[longIdx] - longCap;
    bikeSplit[longIdx] = longCap;
    const others = bikeDays.map((_, i) => i).filter(i => i !== longIdx);
    if (others.length) {
      const extra = splitMinutes(excess, others.map(() => 1));
      others.forEach((bi, k) => { bikeSplit[bi] += extra[k]; });
    }
  }

  const qRunDay = quality.run && !deload && runDays.length
    ? (runDays.includes("wed") ? "wed" : runDays[Math.floor((runDays.length - 1) / 2)])
    : null;
  const nonLong = bikeDays.filter(d => layout[d] !== "bike-long");
  const qBikeDay = quality.bike && !deload && nonLong.length
    ? (nonLong.includes("thu") ? "thu" : nonLong[0])
    : null;

  return DAYS.map(day => {
    const what = layout[day] || "rest";
    if (what === "rest") return { day, sport: "rest", kind: "rest", targetMin: 0, zone: 0 };
    if (what === "run") {
      const min = runSplit[runDays.indexOf(day)];
      if (day === qRunDay && min > 0) {
        return { day, sport: "run", kind: "quality", targetMin: min,
                 zone: QUALITY_TEMPLATES[runQTemplate].zone, qualityTemplate: runQTemplate };
      }
      return { day, sport: "run", kind: "easy", targetMin: min, zone: 2 };
    }
    const min = bikeSplit[bikeDays.indexOf(day)];
    const kind = what === "bike-long" ? "long" : "easy";
    if (day === qBikeDay && min > 0) {
      return { day, sport: "bike", kind: "quality", targetMin: min,
               zone: QUALITY_TEMPLATES[bikeQTemplate].zone, qualityTemplate: bikeQTemplate };
    }
    return { day, sport: "bike", kind, targetMin: min, zone: 2 };
  });
}

export function sumSessions(sessions, sport) {
  return sessions.filter(s => s.sport === sport).reduce((a, s) => a + s.targetMin, 0);
}

/* §7.2 — next load week from the last load week. Run growth hard-capped at
   +10 %/week; any excess goes to the bike. */
export function planNextWeek({ prevLoadWeek, chosenRate, settings, startDate, weekNum,
                               quality = { run: false, bike: false }, noQuality = false,
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1" }) {
  const prevRun = prevLoadWeek.targetMin.run;
  const prevBike = prevLoadWeek.targetMin.bike;
  const prevTotal = prevRun + prevBike;
  const total = prevTotal * (1 + chosenRate);
  const runT = Math.min(prevRun * 1.10, (prevRun / prevTotal) * total);
  const bikeT = total - runT;
  const q = noQuality ? { run: false, bike: false } : quality;
  const sessions = buildSessions(runT, bikeT, settings.layout,
    { quality: q, runQTemplate, bikeQTemplate, longCap: 210 });
  return {
    id: isoWeekId(startDate), startDate, weekNum, isDeload: false, sessions,
    targetMin: { run: sumSessions(sessions, "run"), bike: sumSessions(sessions, "bike") },
    rate: chosenRate,
  };
}

/* §7.3 — deload: 60 % of the previous load week, session by session,
   everything Z2 or below, no quality, long ride capped at 90. */
export function deloadWeek({ prevLoadWeek, startDate, weekNum }) {
  const sessions = prevLoadWeek.sessions.map(s => {
    if (s.sport === "rest") return { ...s };
    let min = round5(s.targetMin * 0.6);
    if (s.kind === "long") min = Math.min(min, 90);
    return { day: s.day, sport: s.sport, kind: s.kind === "long" ? "long" : "easy",
             targetMin: min, zone: Math.min(2, s.zone || 2) };
  });
  return {
    id: isoWeekId(startDate), startDate, weekNum, isDeload: true, sessions,
    targetMin: { run: sumSessions(sessions, "run"), bike: sumSessions(sessions, "bike") },
    rate: 0,
  };
}

export function isDeloadWeek(weekNum, deloadEvery) {
  return deloadEvery > 0 && weekNum % deloadEvery === 0;
}

export function lastLoadWeek(weeks) {
  for (let i = weeks.length - 1; i >= 0; i--) if (!weeks[i].isDeload) return weeks[i];
  return weeks[weeks.length - 1];
}

/* ---------------- completion (§7.4) ---------------- */

export function plannedMinutes(week) {
  return week.targetMin.run + week.targetMin.bike;
}

export function loggedMinutes(week, logs) {
  const end = addDays(week.startDate, 6);
  return logs
    .filter(l => l.date >= week.startDate && l.date <= end &&
                 (l.sport === "run" || l.sport === "bike") && l.source !== "seed")
    .reduce((a, l) => a + (l.min || 0), 0);
}

export function weekCompletion(week, logs) {
  const planned = plannedMinutes(week);
  if (!planned) return 0;
  return Math.min(1.2, loggedMinutes(week, logs) / planned);
}

/* §7.4 recommendation. Harshest condition wins; HRV below baseline caps at 0. */
export function recommendRate({ completion, feel, hrv7d, settings }) {
  let rate, noQuality = false, reason;
  if (completion < 0.70 || feel === 1) {
    rate = -0.10; noQuality = true;
    reason = feel === 1 ? "That week hurt — back off and rebuild." : "Under 70 % logged — step back, then climb again.";
  } else if (completion < 0.90 || feel === 2) {
    rate = 0;
    reason = "Close but not quite — repeat the week and own it.";
  } else {
    rate = settings.growthRate;
    reason = "You hit the week and felt good — grow.";
  }
  if (hrv7d != null && hrv7d < settings.hrvBaselineLow && rate > 0) {
    rate = 0;
    reason = "HRV is under your baseline — hold volume this week.";
  }
  return { rate, noQuality, reason };
}

/* ---------------- quality unlock (§7.5) ---------------- */

/* history: chronological completed weeks [{completion, feel, isDeload}].
   Returns unlock flags plus honest progress toward the next unlock. */
export function qualityState(history) {
  let run = false, bike = false, sinceRun = 0;
  const nd = [];
  let prev = null;
  for (const h of history) {
    const harsh = w => w && (w.completion < 0.60 || w.feel === 1);
    if (harsh(h) && harsh(prev)) { run = false; bike = false; sinceRun = 0; }
    if (!h.isDeload) {
      nd.push(h);
      const last4 = nd.slice(-4);
      const qual = last4.filter(w => w.completion >= 0.80).length;
      const ok = qual >= 3 && !last4.some(w => w.feel === 1);
      const thisQual = h.completion >= 0.80 && h.feel !== 1;
      if (run && !bike && thisQual) {
        sinceRun++;
        if (sinceRun >= 2) bike = true;
      }
      if (!run && ok) { run = true; sinceRun = 0; }
    }
    prev = h;
  }
  const last4 = nd.slice(-4);
  const done = Math.min(3, last4.filter(w => w.completion >= 0.80 && w.feel !== 1).length);
  return { run, bike, progress: { done, needed: run ? 2 : 3, sinceRun: Math.min(2, sinceRun) } };
}

/* The weekly quality slot rotates through the workout menu (v1.1):
   run intervals → tempo → hills, bike intervals → climb. The interval slot
   itself still progresses Q1 → Q2 after 4 planned quality sessions (§7.5). */
const QUALITY_ROTATION = {
  run:  ["intervals", "tempo", "hills"],
  bike: ["intervals", "climb"],
};

export function qualityTemplateFor(weeks, sport) {
  const count = weeks.reduce((a, w) =>
    a + w.sessions.filter(s => s.sport === sport && s.kind === "quality").length, 0);
  const cycle = QUALITY_ROTATION[sport];
  const family = cycle[count % cycle.length];
  if (family === "tempo") return "runTempo";
  if (family === "hills") return "runHills";
  if (family === "climb") return "bikeClimb";
  return sport === "run" ? (count >= 4 ? "runQ2" : "runQ1")
                         : (count >= 4 ? "bikeQ2" : "bikeQ1");
}

/* v1.1 — read-only look-ahead for the "Coming weeks" card: simulate the next
   n weeks at the default growth rate. The Sunday check-in stays the real
   control; this only shows where the dial is pointing. */
export function projectWeeks({ weeks, settings, quality = { run: false, bike: false }, n = 3 }) {
  if (!weeks.length) return [];
  const sim = [...weeks];
  const out = [];
  for (let k = 0; k < n; k++) {
    const last = sim[sim.length - 1];
    const startDate = addDays(last.startDate, 7);
    const weekNum = last.weekNum + 1;
    const w = isDeloadWeek(weekNum, settings.deloadEvery)
      ? deloadWeek({ prevLoadWeek: lastLoadWeek(sim), startDate, weekNum })
      : planNextWeek({
          prevLoadWeek: lastLoadWeek(sim), chosenRate: settings.growthRate, settings,
          startDate, weekNum, quality,
          runQTemplate: qualityTemplateFor(sim, "run"),
          bikeQTemplate: qualityTemplateFor(sim, "bike"),
        });
    sim.push(w);
    out.push({
      weekNum, startDate, isDeload: w.isDeload,
      run: w.targetMin.run, bike: w.targetMin.bike,
      total: w.targetMin.run + w.targetMin.bike,
      hasQuality: w.sessions.some(s => s.kind === "quality"),
    });
  }
  return out;
}

/* ---------------- weekly mix change (§7.6) ---------------- */

const RUN_PATTERNS = { 0: [], 1: ["wed"], 2: ["tue", "fri"], 3: ["mon", "wed", "fri"], 4: ["mon", "wed", "fri", "tue"] };

export function relayoutWeek({ week, runCount, bikeCount, prevRunMin = null,
                               quality = { run: false, bike: false },
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1" }) {
  const warnings = [];
  const oldRuns = week.sessions.filter(s => s.sport === "run").length;
  const oldBikes = week.sessions.filter(s => s.sport === "bike").length;
  const restDays = week.sessions.filter(s => s.sport === "rest").map(s => s.day);
  const restDay = restDays.includes("sun") || !restDays.length ? "sun" : restDays[0];

  let runMin = oldRuns > 0 ? week.targetMin.run * (runCount / oldRuns) : 35 * runCount;
  if (prevRunMin != null) runMin = Math.min(runMin, prevRunMin * 1.10);
  const bikeMin = oldBikes > 0 ? week.targetMin.bike * (bikeCount / oldBikes) : 60 * bikeCount;

  const layout = {};
  DAYS.forEach(d => { layout[d] = "rest"; });
  const free = DAYS.filter(d => d !== restDay);
  if (bikeCount > 0 && free.includes("sat")) layout.sat = "bike-long";
  else if (bikeCount > 0) layout[free[free.length - 1]] = "bike-long";

  const runPattern = (RUN_PATTERNS[runCount] || RUN_PATTERNS[4]).filter(d => layout[d] === "rest" && d !== restDay);
  let placed = 0;
  for (const d of runPattern) { if (placed < runCount) { layout[d] = "run"; placed++; } }
  for (const d of free) {
    if (placed >= runCount) break;
    if (layout[d] === "rest") { layout[d] = "run"; placed++; }
  }
  let bikesLeft = bikeCount - (Object.values(layout).includes("bike-long") ? 1 : 0);
  for (const d of free) {
    if (bikesLeft <= 0) break;
    if (layout[d] === "rest") { layout[d] = "bike"; bikesLeft--; }
  }

  for (let i = 0; i < DAYS.length - 1; i++) {
    if (layout[DAYS[i]] === "run" && layout[DAYS[i + 1]] === "run") {
      warnings.push("consecutive-runs");
      break;
    }
  }

  const sessions = buildSessions(runMin, bikeMin, layout,
    { deload: week.isDeload, quality, runQTemplate, bikeQTemplate, longCap: week.isDeload ? 90 : 210 });
  return {
    week: { ...week, sessions,
            targetMin: { run: sumSessions(sessions, "run"), bike: sumSessions(sessions, "bike") } },
    warnings,
  };
}

/* Layout-editor guard (§1.7): find consecutive run days in a day→sport map. */
export function consecutiveRunDays(layout) {
  const out = [];
  for (let i = 0; i < DAYS.length - 1; i++) {
    if ((layout[DAYS[i]] === "run") && (layout[DAYS[i + 1]] === "run")) out.push([DAYS[i], DAYS[i + 1]]);
  }
  return out;
}

/* ---------------- Garmin CSV import (§9) ---------------- */

function parseCSV(text) {
  const rows = []; let row = [], val = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else inQ = false; }
      else val += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(val); val = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(val); val = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else val += c;
  }
  row.push(val);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

const SPORT_MAP = { "Running": "run", "Treadmill Running": "run", "Cycling": "bike" };

function hmsToMin(t) {
  const parts = String(t).split(":").map(parseFloat);
  if (parts.some(Number.isNaN)) return null;
  let min = 0;
  if (parts.length === 3) min = parts[0] * 60 + parts[1] + parts[2] / 60;
  else if (parts.length === 2) min = parts[0] + parts[1] / 60;
  else return null;
  return Math.round(min);
}

export function parseGarminCSV(text) {
  const rows = parseCSV(text.replace(/^﻿/, ""));
  if (!rows.length) return { error: "Empty file" };
  const header = rows[0].map(h => h.trim());
  const col = name => header.indexOf(name);
  const iType = col("Activity Type"), iDate = col("Date"), iTime = col("Time"),
        iDist = col("Distance"), iHR = col("Avg HR"), iTitle = col("Title");
  if (iType < 0 || iDate < 0 || iTime < 0) {
    return { error: "Doesn't look like a Garmin activities CSV (missing Activity Type / Date / Time columns)" };
  }
  const out = [], counts = { run: 0, bike: 0, other: 0, bad: 0 };
  for (const r of rows.slice(1)) {
    const type = (r[iType] || "").trim();
    const sport = SPORT_MAP[type] || "other";
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec((r[iDate] || "").trim());
    const min = hmsToMin((r[iTime] || "").trim());
    if (!m || !min) { counts.bad++; continue; }
    const km = parseFloat((r[iDist] ?? "").replace(/[",]/g, "")) || null;
    const hr = parseInt((r[iHR] ?? "").replace(/[^\d]/g, ""), 10) || null;
    out.push({
      date: m[1], time: `${m[2]}:${m[3]}`, sport, min,
      km, avgHR: hr, note: (iTitle >= 0 && r[iTitle]) ? r[iTitle].trim() : undefined,
      activityType: type,
    });
    counts[sport]++;
  }
  return { rows: out, counts };
}

/* §9 dedupe: same sport + same date, within ±10 min when both have a
   time-of-day (seed/manual logs have none — date match is enough). */
export function dedupeImports(rows, logs) {
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fresh = [], dupes = [];
  for (const row of rows) {
    const dup = logs.some(l =>
      l.sport === row.sport && l.date === row.date &&
      (l.time == null || row.time == null || Math.abs(toMin(l.time) - toMin(row.time)) <= 10));
    (dup ? dupes : fresh).push(row);
  }
  return { fresh, dupes };
}

/* ---------------- progress helpers ---------------- */

export function vo2AtTargetWeight(vo2, weightKg, targetKg) {
  if (!vo2 || !weightKg || !targetKg) return null;
  return Math.round((vo2 * weightKg / targetKg) * 10) / 10;
}

export function ema(values, alpha = 0.25) {
  const out = [];
  values.forEach((v, i) => out.push(i === 0 ? v : alpha * v + (1 - alpha) * out[i - 1]));
  return out;
}

/* Last n calendar weeks (Monday-based, ending with the week containing
   `todayISO`) with logged minutes per sport and plan target if one exists. */
export function weeklyVolume({ logs, weeks, todayISO, n = 12 }) {
  const thisMonday = addDays(todayISO, -dayIndex(todayISO));
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(thisMonday, -7 * k);
    const end = addDays(start, 6);
    const inWeek = logs.filter(l => l.date >= start && l.date <= end);
    const run = inWeek.filter(l => l.sport === "run").reduce((a, l) => a + (l.min || 0), 0);
    const bike = inWeek.filter(l => l.sport === "bike").reduce((a, l) => a + (l.min || 0), 0);
    const plan = weeks.find(w => w.startDate === start);
    out.push({
      start, run, bike,
      target: plan ? plannedMinutes(plan) : null,
      isDeload: plan ? plan.isDeload : false,
      current: start === thisMonday,
    });
  }
  return out;
}

/* Completion per past plan week + current streak of weeks ≥ 80 %. */
export function consistency({ weeks, logs, todayISO, n = 12 }) {
  const done = weeks.filter(w => addDays(w.startDate, 6) < todayISO);
  const cells = done.slice(-n).map(w => ({
    id: w.id, pct: weekCompletion(w, logs), isDeload: w.isDeload,
  }));
  let streak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].pct >= 0.8) streak++;
    else break;
  }
  return { cells, streak };
}
