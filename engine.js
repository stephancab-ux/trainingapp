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
          climbTarget = null } = opts;
  const runQTemplate = opts.runQTemplate || "runQ1";
  const bikeQTemplate = opts.bikeQTemplate || "bikeQ1";
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
      const s = { day, sport: "bike", kind: "quality", targetMin: min,
                  zone: QUALITY_TEMPLATES[bikeQTemplate].zone, qualityTemplate: bikeQTemplate };
      if (bikeQTemplate === "bikeClimb" && climbTarget) s.targetAscent = climbTarget;
      return s;
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
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1", logs = [] }) {
  const prevRun = prevLoadWeek.targetMin.run;
  const prevBike = prevLoadWeek.targetMin.bike;
  const prevTotal = prevRun + prevBike;
  const total = prevTotal * (1 + chosenRate);
  const runT = Math.min(prevRun * 1.10, (prevRun / prevTotal) * total);
  const bikeT = total - runT;
  const q = noQuality ? { run: false, bike: false }
    : { run: quality.run && !!runQTemplate, bike: quality.bike && !!bikeQTemplate };
  const climbTarget = climbTargetAscent({ logs, weekNum, settings });
  const sessions = buildSessions(runT, bikeT, settings.layout,
    { quality: q, runQTemplate, bikeQTemplate, longCap: 210, climbTarget });
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

const FAMILY_KEY = { run: { intervals: "runIntervals", tempo: "runTempo", hills: "runHills" },
                     bike: { intervals: "bikeIntervals", climb: "bikeClimb" } };

/* Allowed-family aware (v1.2). `allowed` is settings.allowedFamilies or null
   (= everything). Returns null when no family is allowed for the sport. */
export function qualityTemplateFor(weeks, sport, allowed = null) {
  const count = weeks.reduce((a, w) =>
    a + w.sessions.filter(s => s.sport === sport && s.kind === "quality").length, 0);
  let cycle = QUALITY_ROTATION[sport];
  if (allowed) cycle = cycle.filter(fam => allowed[FAMILY_KEY[sport][fam]] !== false);
  if (!cycle.length) return null;
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

/* Pick k days spread as evenly as possible across `arr`, preserving order. */
function spreadPick(arr, k) {
  if (k >= arr.length) return [...arr];
  if (k <= 0) return [];
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.round((i * (arr.length - 1)) / Math.max(1, k - 1))]);
  return [...new Set(out)];
}

/* Fatigue-aware day assignment around a configurable rest day (v1.2): spread
   sessions, keep runs apart, and sit the long ride just before the rest day. */
export function placeLayout(runCount, bikeCount, restDay = "sun") {
  const layout = {}; DAYS.forEach(d => { layout[d] = "rest"; });
  const active = DAYS.filter(d => d !== restDay);
  const used = spreadPick(active, Math.min(runCount + bikeCount, active.length));
  let longDay = null;
  if (bikeCount > 0) longDay = used.includes("sat") ? "sat" : used[used.length - 1];
  const slots = used.filter(d => d !== longDay);
  // alternate (even slots first) so runs land non-adjacent until forced
  const order = slots.filter((_, i) => i % 2 === 0).concat(slots.filter((_, i) => i % 2 === 1));
  order.slice(0, runCount).forEach(d => { layout[d] = "run"; });
  if (longDay) layout[longDay] = "bike-long";
  used.forEach(d => { if (layout[d] === "rest") layout[d] = "bike"; });
  return layout;
}

export function relayoutWeek({ week, runCount, bikeCount, prevRunMin = null, restDay = null,
                               quality = { run: false, bike: false },
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1", climbTarget = null }) {
  const warnings = [];
  const oldRuns = week.sessions.filter(s => s.sport === "run").length;
  const oldBikes = week.sessions.filter(s => s.sport === "bike").length;
  const restDays = week.sessions.filter(s => s.sport === "rest").map(s => s.day);
  const rest = restDay || (restDays.includes("sun") || !restDays.length ? "sun" : restDays[0]);

  let runMin = oldRuns > 0 ? week.targetMin.run * (runCount / oldRuns) : 35 * runCount;
  if (prevRunMin != null) runMin = Math.min(runMin, prevRunMin * 1.10);
  const bikeMin = oldBikes > 0 ? week.targetMin.bike * (bikeCount / oldBikes) : 60 * bikeCount;

  const layout = placeLayout(runCount, bikeCount, rest);

  for (let i = 0; i < DAYS.length - 1; i++) {
    if (layout[DAYS[i]] === "run" && layout[DAYS[i + 1]] === "run") { warnings.push("consecutive-runs"); break; }
  }

  const q = { run: quality.run && !!runQTemplate, bike: quality.bike && !!bikeQTemplate };
  const sessions = buildSessions(runMin, bikeMin, layout,
    { deload: week.isDeload, quality: q, runQTemplate, bikeQTemplate,
      longCap: week.isDeload ? 90 : 210, climbTarget });
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
        iDist = col("Distance"), iHR = col("Avg HR"), iTitle = col("Title"),
        iAsc = col("Total Ascent");
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
    const ascent = iAsc >= 0 ? (parseInt((r[iAsc] ?? "").replace(/[^\d]/g, ""), 10) || null) : null;
    out.push({
      date: m[1], time: `${m[2]}:${m[3]}`, sport, min,
      km, avgHR: hr, ascent: ascent ?? undefined,
      note: (iTitle >= 0 && r[iTitle]) ? r[iTitle].trim() : undefined,
      activityType: type,
    });
    counts[sport]++;
  }
  return { rows: out, counts };
}

/* §9 dedupe (v1.2). Manual logs store no clock time (only a 5-min-stepped
   duration), so a Garmin row matches an existing log on same sport + same
   date + duration within ±10 min + distance within ±0.5 km. When both have a
   clock time it must also be within ±10 min — that only disambiguates two
   same-sport sessions on one day. Returns, per row, the candidate matches so
   the UI can ask merge / skip / keep-both. */
export function importMatches(rows, logs) {
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const closeMin = (a, b) => a == null || b == null ? true : Math.abs(a - b) <= 10;
  const closeKm = (a, b) => a == null || b == null ? true : Math.abs(a - b) <= 0.5;
  return rows.map(row => {
    const matches = logs.filter(l =>
      l.sport === row.sport && l.date === row.date &&
      closeMin(l.min, row.min) && closeKm(l.km, row.km) &&
      (l.time == null || row.time == null || Math.abs(toMin(l.time) - toMin(row.time)) <= 10));
    // best match first: closest duration, then distance
    matches.sort((a, b) =>
      (Math.abs((a.min || 0) - row.min) - Math.abs((b.min || 0) - row.min)) ||
      (Math.abs((a.km || 0) - (row.km || 0)) - Math.abs((b.km || 0) - (row.km || 0))));
    return { row, matches };
  });
}

/* Back-compat helper used by tests/older callers: split fresh vs duplicates. */
export function dedupeImports(rows, logs) {
  const fresh = [], dupes = [];
  for (const { row, matches } of importMatches(rows, logs)) {
    (matches.length ? dupes : fresh).push(row);
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

/* ================= v1.2 analytics (all pure) ================= */

const TRAIN = l => l && (l.sport === "run" || l.sport === "bike") && l.source !== "seed";
const speedKmh = l => (l.km > 0 && l.min > 0) ? (l.km * 60) / l.min : null;
const vam = l => (l.ascent > 0 && l.min > 0) ? (l.ascent * 60) / l.min : null; // m/h climbed

/* Which HR zone (1–5) a heart rate sits in; null when no HR. */
export function zoneOfHR(bounds, hr) {
  if (hr == null) return null;
  for (const b of bounds) if (hr <= b.hi) return b.z;
  return 5;
}

/* ---- intensity: aerobic / threshold / anaerobic ---- */
const TYPE_INTENSITY = {
  recovery: "aerobic", easy: "aerobic", long: "aerobic",
  tempo: "threshold", climb: "threshold",
  intervals: "anaerobic", hills: "anaerobic",
};
export function intensityOfLog(log, bounds) {
  const z = zoneOfHR(bounds, log.avgHR);
  if (z != null) return z <= 2 ? "aerobic" : z === 3 ? "threshold" : "anaerobic";
  return TYPE_INTENSITY[log.type] || "aerobic";
}

/* Per-week minutes & % in each band, last n Monday-weeks, + an 80/20 read. */
export function weeklyIntensity({ logs, bounds, todayISO, n = 12 }) {
  const thisMonday = addDays(todayISO, -dayIndex(todayISO));
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(thisMonday, -7 * k), end = addDays(start, 6);
    const band = { aerobic: 0, threshold: 0, anaerobic: 0 };
    logs.filter(l => TRAIN(l) && l.date >= start && l.date <= end)
        .forEach(l => { band[intensityOfLog(l, bounds)] += l.min || 0; });
    const tot = band.aerobic + band.threshold + band.anaerobic;
    out.push({ start, ...band, total: tot, current: start === thisMonday,
               easyPct: tot ? band.aerobic / tot : null,
               hardPct: tot ? (band.threshold + band.anaerobic) / tot : null });
  }
  return out;
}

/* ---- training load (Foster sRPE; HR/zone or type fallback) ---- */
const ZONE_EFFORT = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 9 };
const TYPE_EFFORT = { recovery: 3, easy: 4, long: 5, tempo: 6, climb: 7, intervals: 8, hills: 8 };
export function sessionEffort(log, bounds) {
  if (log.rpe != null) return log.rpe;
  const z = zoneOfHR(bounds, log.avgHR);
  if (z != null) return ZONE_EFFORT[z];
  return TYPE_EFFORT[log.type] || 5;
}
export function sessionLoad(log, bounds) {
  if (!log.min) return 0;
  return Math.round(log.min * sessionEffort(log, bounds));
}
export function trainingLoad({ logs, bounds, todayISO, n = 12 }) {
  const train = logs.filter(TRAIN);
  const loadOn = (a, b) => train.filter(l => l.date >= a && l.date <= b)
                                .reduce((s, l) => s + sessionLoad(l, bounds), 0);
  const acute = loadOn(addDays(todayISO, -6), todayISO);
  const chronic = loadOn(addDays(todayISO, -27), todayISO) / 4;
  const acwr = chronic > 0 ? acute / chronic : null;
  const status = acwr == null ? "building"
    : acwr < 0.8 ? "undertraining" : acwr <= 1.3 ? "optimal"
    : acwr <= 1.5 ? "overreaching" : "high-risk";
  const thisMonday = addDays(todayISO, -dayIndex(todayISO));
  const weeks = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(thisMonday, -7 * k);
    weeks.push({ start, load: loadOn(start, addDays(start, 6)), current: start === thisMonday });
  }
  return { weeks, acute: Math.round(acute), chronic: Math.round(chronic), acwr, status };
}

/* ---- performance & efficiency (no power → speed / climb-rate) ---- */
export function sessionPerformance(log) {
  if (log.type === "climb" || (log.sport === "bike" && vam(log) && !speedKmh(log)))
    return vam(log) == null ? null : { value: vam(log), kind: "vam" };
  const s = speedKmh(log);
  return s == null ? null : { value: s, kind: "speed" };
}
export function sessionEfficiency(log) {
  const p = sessionPerformance(log);
  if (!p || !log.rpe) return null;
  return { value: p.value / log.rpe, kind: p.kind };
}

/* ---- expected RPE: preset per type, refined by your own history ---- */
const RPE_PRESET = { recovery: 3, easy: 4, long: 5, tempo: 6.5, climb: 7, intervals: 8, hills: 8 };
export function expectedRPE(log, logs) {
  const type = log.type || "easy";
  const preset = RPE_PRESET[type] ?? 5;
  const sameType = logs.filter(l => l !== log && l.type === type && l.rpe != null && TRAIN(l))
                       .slice(-6).map(l => l.rpe);
  if (sameType.length < 3) return preset;
  const avg = sameType.reduce((a, b) => a + b, 0) / sameType.length;
  return 0.5 * preset + 0.5 * avg;
}
export function rpeDeviation(log, logs) {
  if (log.rpe == null) return { dev: null, band: "none" };
  const dev = log.rpe - expectedRPE(log, logs);
  return { dev, band: dev <= -1.5 ? "green" : dev >= 1.5 ? "red" : "yellow" };
}

/* ---- per-session evaluation surfaced as a tag + one-liner ---- */
export function evaluateSession(log, { bounds, logs = [], plannedSession = null } = {}) {
  const intensity = intensityOfLog(log, bounds);
  const { band } = rpeDeviation(log, logs);
  const z = zoneOfHR(bounds, log.avgHR);
  const easyKind = log.type === "easy" || log.type === "long" || log.type === "recovery"
    || (plannedSession && (plannedSession.kind === "easy" || plannedSession.kind === "long"));
  let verdict;
  if (easyKind && z != null && z >= 3) verdict = "ran this one hot — easy days belong in Z2";
  else if (band === "red") verdict = "harder than usual — watch fatigue";
  else if (band === "green") verdict = "felt easy — recovering well";
  else if (log.sport === "run" && easyKind && improvingEasyPace(log, logs)) verdict = "improving — faster at the same effort";
  else verdict = "on target";
  return { intensity, rpeBand: band, verdict };
}
function improvingEasyPace(log, logs) {
  const s = speedKmh(log);
  if (s == null) return false;
  const prior = logs.filter(l => l !== log && l.sport === "run" && TRAIN(l) &&
                  (l.type === "easy" || l.type == null) && speedKmh(l) && l.date < log.date).slice(-5);
  if (prior.length < 3) return false;
  const avg = prior.map(speedKmh).reduce((a, b) => a + b, 0) / prior.length;
  return s > avg * 1.02;
}

/* ---- climb prescription target (metres), ramps with load ---- */
export function climbTargetAscent({ logs = [], weekNum = 1, settings = {} }) {
  const base = settings.climbBaseAscent || 500;
  const block = Math.floor((weekNum - 1) / 4);
  let target = base * Math.pow(1.05, block);
  const recent = logs.filter(l => l.sport === "bike" && l.ascent > 0).slice(-8).map(l => l.ascent);
  if (recent.length) target = Math.max(target, Math.max(...recent) * 0.8);
  return Math.round(target / 50) * 50;
}

/* ---- personal bests, auto from logs merged with manual entries ---- */
const PB_DISTANCES = [
  { key: "run5k",   sport: "run",  std: 5,       band: [4.5, 7],     label: "5K" },
  { key: "run10k",  sport: "run",  std: 10,      band: [9, 13],      label: "10K" },
  { key: "runHalf", sport: "run",  std: 21.0975, band: [19, 25],     label: "Half marathon" },
  { key: "runFull", sport: "run",  std: 42.195,  band: [38, 46],     label: "Marathon" },
  { key: "bike40k", sport: "bike", std: 40,      band: [35, 50],     label: "40K ride" },
];
export const PB_ORDER = ["run5k", "run10k", "runHalf", "runFull", "bike40k",
                         "longestRun", "longestRide", "biggestAscent", "longestSession"];
export const PB_LOWER_BETTER = new Set(["run5k", "run10k", "runHalf", "runFull", "bike40k"]);

export function personalBests({ logs = [], manualBests = [] } = {}) {
  const rec = {};
  const put = (key, value, log, extra = {}) => {
    if (value == null) return;
    const lower = PB_LOWER_BETTER.has(key);
    if (!rec[key] || (lower ? value < rec[key].value : value > rec[key].value))
      rec[key] = { key, value, date: log?.date, logId: log?.id, ...extra };
  };
  for (const l of logs) {
    if (l.sport === "run" && l.km > 0) put("longestRun", l.km, l, { unit: "km" });
    if (l.sport === "bike" && l.km > 0) put("longestRide", l.km, l, { unit: "km" });
    if (l.sport === "bike" && l.ascent > 0) put("biggestAscent", l.ascent, l, { unit: "m" });
    if (l.min > 0 && (l.sport === "run" || l.sport === "bike")) put("longestSession", l.min, l, { unit: "min" });
    for (const d of PB_DISTANCES) {
      if (l.sport === d.sport && l.km >= d.band[0] && l.km <= d.band[1] && l.min > 0) {
        put(d.key, (l.min * 60) * (d.std / l.km), l, { unit: "time" }); // normalized seconds
      }
    }
  }
  for (const m of manualBests) {
    const lower = PB_LOWER_BETTER.has(m.key);
    if (m.value == null) continue;
    if (!rec[m.key] || (lower ? m.value < rec[m.key].value : m.value > rec[m.key].value))
      rec[m.key] = { ...rec[m.key], key: m.key, value: m.value, date: m.date, manual: true,
                     unit: rec[m.key]?.unit || pbUnit(m.key) };
  }
  return PB_ORDER.filter(k => rec[k]).map(k => ({ label: pbLabel(k), ...rec[k] }));
}
function pbUnit(key) {
  if (PB_LOWER_BETTER.has(key)) return "time";
  if (key === "biggestAscent") return "m";
  if (key === "longestSession") return "min";
  return "km";
}
function pbLabel(key) {
  const d = PB_DISTANCES.find(x => x.key === key);
  if (d) return d.label;
  return { longestRun: "Longest run", longestRide: "Longest ride",
           biggestAscent: "Biggest climb", longestSession: "Longest session" }[key] || key;
}

/* ---- the offline AI coach: deterministic, ranked, explained ---- */
export function coachInsights({ doc, todayISO }) {
  const out = [];
  const logs = doc.logs || [];
  const bounds = zoneBounds(doc.settings);
  const add = (o) => out.push({ impact: 0.5, confidence: 0.5, ...o });

  // VO₂ trend over ~6 weeks
  const vo2 = (doc.vo2History || []).filter(v => v.value);
  if (vo2.length >= 2) {
    const last = vo2[vo2.length - 1];
    const ref = vo2.filter(v => v.date <= addDays(last.date, -35)).slice(-1)[0] || vo2[0];
    if (ref && ref !== last) {
      const pct = ((last.value - ref.value) / ref.value) * 100;
      if (Math.abs(pct) >= 2)
        add({ id: "vo2", category: pct > 0 ? "improvement" : "trend",
              title: `VO₂max ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}%`,
              body: pct > 0 ? "Your engine is growing." : "VO₂ has slipped — keep aerobic volume up.",
              why: `${ref.value} → ${last.value} ml/kg/min since ${ref.date}.`,
              impact: 0.8, confidence: 0.7 });
    }
  }

  // training load / ACWR
  const tl = trainingLoad({ logs, bounds, todayISO });
  if (tl.acwr != null && tl.chronic > 0) {
    if (tl.status === "high-risk")
      add({ id: "load-high", category: "recovery", title: "Load spike — back off",
            body: "Your recent load jumped well above your baseline. Take an easy day before the next hard one.",
            why: `7-day load ${tl.acute} vs 4-week baseline ${tl.chronic} (ratio ${tl.acwr.toFixed(2)}).`,
            impact: 0.95, confidence: 0.75, action: { kind: "insertRecoveryDay" } });
    else if (tl.status === "undertraining")
      add({ id: "load-low", category: "recommendation", title: "Room to build",
            body: "Your load is well under your baseline — you can safely add a little volume.",
            why: `7-day load ${tl.acute} vs 4-week baseline ${tl.chronic} (ratio ${tl.acwr.toFixed(2)}).`,
            impact: 0.6, confidence: 0.6, action: { kind: "addEasyVolume" } });
  }

  // aerobic / anaerobic balance (this week)
  const wi = weeklyIntensity({ logs, bounds, todayISO, n: 1 })[0];
  if (wi && wi.total >= 60) {
    const hard = Math.round(wi.hardPct * 100);
    if (hard < 10)
      add({ id: "balance-easy", category: "recommendation", title: "Add some intensity",
            body: `Only ${hard}% of this week is hard work — one quality session would sharpen you up.`,
            why: `${Math.round(wi.easyPct * 100)}% easy / ${hard}% hard this week.`,
            impact: 0.6, confidence: 0.6, action: { kind: "addQuality" } });
    else if (hard > 35)
      add({ id: "balance-hard", category: "recovery", title: "Skewing hard",
            body: `${hard}% of this week is hard — most weeks train best near 80/20. Add easy volume.`,
            why: `${Math.round(wi.easyPct * 100)}% easy / ${hard}% hard this week.`,
            impact: 0.65, confidence: 0.6, action: { kind: "addEasyVolume" } });
  }

  // consistency streak
  const cons = consistency({ weeks: doc.weeks || [], logs, todayISO });
  if (cons.streak >= 3)
    add({ id: "streak", category: "strength", title: `${cons.streak}-week streak`,
          body: "You've hit your plan consistently — this is exactly how fitness comes back.",
          why: `${cons.streak} straight weeks at ≥ 80% completion.`,
          impact: 0.5, confidence: 0.8 });

  // new personal bests in the last 7 days
  const pbs = personalBests({ logs, manualBests: doc.manualBests || [] });
  const freshPB = pbs.find(p => p.date && p.date >= addDays(todayISO, -7) && !p.manual);
  if (freshPB)
    add({ id: "pb-" + freshPB.key, category: "strength", title: `New PB — ${freshPB.label}`,
          body: "A personal best this week. Bank it and recover well.",
          why: `Set on ${freshPB.date}.`, impact: 0.7, confidence: 0.9 });

  // easy-pace improving (learned model)
  const hint = paceHint(logs, bounds, 2, doc.settings.easyPace);
  if (hint.learned && hint.n >= 4)
    add({ id: "pace", category: "improvement", title: "Easy pace improving",
          body: "You're running faster at the same easy heart rate — the clearest sign of aerobic fitness.",
          why: `Learned from your last ${hint.n} easy runs.`, impact: 0.6, confidence: 0.6 });

  const dismissed = doc.coachDismissed || {};
  return out.filter(i => !dismissed[i.id])
            .sort((a, b) => (b.impact * b.confidence) - (a.impact * a.confidence));
}
