/* Remonte training engine — pure functions only, no DOM, no storage.
   Every rule here comes from TRAINING_APP_SPEC.md §5 and §7. */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const QUALITY_TEMPLATES = {
  runQ1:     { sport: "run",  family: "intervals", name: "Speed repeats",   zone: 4, label: "8 × 1 min @ Z4 · 2 min Z1 jog between",          set: { type: "intervals", reps: 8, workSec: 60,  workZone: 4, restSec: 120, restZone: 1 } },
  runQ2:     { sport: "run",  family: "intervals", name: "Speed repeats",   zone: 4, label: "3 × 6 min @ low Z4 · 3 min easy between",         set: { type: "intervals", reps: 3, workSec: 360, workZone: 4, restSec: 180, restZone: 2 } },
  runTempo:  { sport: "run",  family: "tempo",     name: "Tempo run",       zone: 3, label: "20 min steady @ Z3 — comfortably hard, even pace", set: { type: "block", blockMin: 20, zone: 3 } },
  runHills:  { sport: "run",  family: "hills",     name: "Hill repeats",    zone: 4, label: "8 × 45 s uphill strong · walk/jog down between",   set: { type: "intervals", reps: 8, workSec: 45,  workZone: 4, restSec: 90,  restZone: 1 } },
  bikeQ1:    { sport: "bike", family: "intervals", name: "Sweet spot",      zone: 3, label: "3 × 8 min @ Z3–Z4 sweet spot · 5 min easy between", set: { type: "intervals", reps: 3, workSec: 480, workZone: 3, restSec: 300, restZone: 2 } },
  bikeQ2:    { sport: "bike", family: "intervals", name: "Sweet spot",      zone: 3, label: "2 × 12 min @ Z3–Z4 sweet spot · 5 min easy between",set: { type: "intervals", reps: 2, workSec: 720, workZone: 3, restSec: 300, restZone: 2 } },
  bikeClimb: { sport: "bike", family: "climb",     name: "Climbing ride",   zone: 3, label: "Long climb @ Z3 — seated, steady; repeat to fill the session", set: { type: "block", blockMin: 30, zone: 3 } },
  bikeSprint:{ sport: "bike", family: "sprint",    name: "Sprint ride",     zone: 5, label: "6 × 30 s all-out @ Z5 · 4 min easy spin between",     set: { type: "intervals", reps: 6, workSec: 30,  workZone: 5, restSec: 240, restZone: 1 } },
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
/* Monday on/before the given date (this week's Monday) — lets the plan start today. */
export function mondayOf(iso) { return addDays(iso, -dayIndex(iso)); }

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

  let zb;
  if (method === "custom") {
    zb = customZones.map((z, i) => ({ z: i + 1, lo: Math.round(z.lo), hi: Math.round(z.hi) }));
  } else if (method === "lthr") {
    zb = LTHR_BANDS.map(([a, b], i) => ({
      z: i + 1,
      lo: Math.round(a * lthr),
      hi: Math.min(Math.round(b * lthr), maxHR),
    }));
  } else if (method === "karvonen") {
    const r = maxHR - restingHR;
    zb = PCT_BANDS.map(([a, b], i) => ({
      z: i + 1,
      lo: Math.round(restingHR + a * r),
      hi: Math.round(restingHR + b * r),
    }));
  } else {
    zb = PCT_BANDS.map(([a, b], i) => ({
      z: i + 1,
      lo: Math.round(a * maxHR),
      hi: Math.round(b * maxHR),
    }));
  }
  // Load context for HR-based training load (TRIMP). These extra props ride on
  // the bounds array (iterated only by index elsewhere) so sessionLoad can read
  // maxHR / resting HR / sex without threading settings through every caller.
  zb.maxHR = maxHR;
  zb.restHR = restingHR;
  zb.sex = settings.sex;
  return zb;
}

export function zoneMid(bounds, z) {
  const b = bounds[z - 1];
  return Math.round((b.lo + b.hi) / 2);
}

/* Age-based max-HR estimate — Tanaka (208 − 0.7·age), more accurate than the
   old 220−age. A measured/observed max from activities should still win. */
export function estMaxHRFromAge(age) {
  if (!age || age < 5 || age > 120) return null;
  return Math.round(208 - 0.7 * age);
}

/* The highest max-HR seen across logged/imported run & bike activities. */
export function observedMaxHR(logs) {
  let m = 0;
  for (const l of logs) {
    if ((l.sport === "run" || l.sport === "bike" || l.sport === "gym") && l.maxHR > m) m = l.maxHR;
  }
  return m || null;
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

/* Gym sessions come in fixed template lengths; snap an arbitrary minute value
   to the nearest. A gym session is at least 30 min. */
export const GYM_DURATIONS = [30, 45, 60, 75, 90];
export function snapGymMinutes(v) {
  if (!(v > 0)) return 0;
  const c = Math.max(30, Math.min(90, v));
  return GYM_DURATIONS.reduce((best, d) => Math.abs(d - c) < Math.abs(best - c) ? d : best, GYM_DURATIONS[0]);
}

/* Deterministic 32-bit seed from a string, so a planned gym session yields a
   stable workout across reloads without persisting the structure. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
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
    sessions, targetMin: { run: 105, bike: 255, gym: 0, swim: 0 },
  };
}

/* Build a week's sessions from per-sport minutes over a day→sport layout.
   A layout value may be a single sport string or an array (two-a-days). Long
   ride gets a double share; every session rounds to 5 min. Each session keeps
   its `slot` (0/1) so a day can carry two sessions. */
export function buildSessions(runMin, bikeMin, gymMin, layout, opts = {}) {
  const { deload = false, quality = { run: false, bike: false, gym: false }, climbTarget = null } = opts;
  const swimMin = opts.swimMin || 0;
  const runQTemplate = opts.runQTemplate || "runQ1";
  const bikeQTemplate = opts.bikeQTemplate || "bikeQ1";
  const gymVenue = opts.gymVenue || "home";
  const weekSalt = String(opts.weekSalt ?? "");
  const longCap = opts.longCap ?? (deload ? 90 : 210);

  const entries = [];
  for (const day of DAYS) {
    const v = layout[day];
    const slots = Array.isArray(v) ? (v.length ? v : ["rest"]) : [v || "rest"];
    slots.forEach((what, slot) => entries.push({ day, slot, what: what || "rest" }));
  }
  const runEntries = entries.filter(e => e.what === "run");
  const bikeEntries = entries.filter(e => e.what === "bike" || e.what === "bike-long");
  const gymEntries = entries.filter(e => e.what === "gym");
  const swimEntries = entries.filter(e => e.what === "swim");
  const runSplit = splitMinutes(runMin, runEntries.map(() => 1));
  let bikeSplit = splitMinutes(bikeMin, bikeEntries.map(e => e.what === "bike-long" ? 2 : 1));
  const gymSplit = splitMinutes(gymMin, gymEntries.map(() => 1)).map(snapGymMinutes);
  const swimSplit = splitMinutes(swimMin, swimEntries.map(() => 1));
  // one threshold swim per week when swim quality is unlocked
  const qSwimDay = (quality.swim && !deload && swimEntries.length) ? swimEntries[swimEntries.length - 1].day : null;

  const longIdx = bikeEntries.findIndex(e => e.what === "bike-long");
  if (longIdx >= 0 && bikeSplit[longIdx] > longCap) {
    const excess = bikeSplit[longIdx] - longCap;
    bikeSplit[longIdx] = longCap;
    const others = bikeEntries.map((_, i) => i).filter(i => i !== longIdx);
    if (others.length) {
      const extra = splitMinutes(excess, others.map(() => 1));
      others.forEach((bi, k) => { bikeSplit[bi] += extra[k]; });
    }
  }

  const runDays = runEntries.map(e => e.day);
  const qRunDay = quality.run && !deload && runDays.length
    ? (runDays.includes("wed") ? "wed" : runDays[Math.floor((runDays.length - 1) / 2)]) : null;
  const nonLong = bikeEntries.filter(e => e.what !== "bike-long");
  const qBikeDay = quality.bike && !deload && nonLong.length
    ? (nonLong.some(e => e.day === "thu") ? "thu" : nonLong[0].day) : null;
  // a "hard" gym day, but never adjacent to the long ride or a quality run/ride
  const hardDays = new Set([qRunDay, qBikeDay, ...bikeEntries.filter(e => e.what === "bike-long").map(e => e.day)].filter(Boolean));
  const adjacent = day => { const i = DAYS.indexOf(day); return [DAYS[i - 1], DAYS[i + 1]].some(d => d && hardDays.has(d)); };
  const qGymDay = quality.gym && !deload && gymEntries.length
    ? (gymEntries.map(e => e.day).find(d => !hardDays.has(d) && !adjacent(d)) || null) : null;

  let ri = 0, bi = 0, gi = 0, si = 0, qRunUsed = false, qBikeUsed = false, qGymUsed = false, qSwimUsed = false;
  const out = [];
  for (const e of entries) {
    if (e.what === "rest") { out.push({ day: e.day, slot: e.slot, sport: "rest", kind: "rest", targetMin: 0, zone: 0 }); continue; }
    if (e.what === "swim") {
      const min = swimSplit[si++];
      const hard = e.day === qSwimDay && !qSwimUsed && min > 0;
      if (hard) qSwimUsed = true;
      out.push({ day: e.day, slot: e.slot, sport: "swim", kind: hard ? "quality" : "easy", targetMin: min,
                 zone: hard ? 3 : 2, type: hard ? "threshold" : "endurance" });
      continue;
    }
    if (e.what === "run") {
      const min = runSplit[ri++];
      if (e.day === qRunDay && !qRunUsed && min > 0) {
        qRunUsed = true;
        out.push({ day: e.day, slot: e.slot, sport: "run", kind: "quality", targetMin: min,
                   zone: QUALITY_TEMPLATES[runQTemplate].zone, qualityTemplate: runQTemplate });
      } else out.push({ day: e.day, slot: e.slot, sport: "run", kind: "easy", targetMin: min, zone: 2 });
      continue;
    }
    if (e.what === "gym") {
      const min = gymSplit[gi++];
      const hard = e.day === qGymDay && !qGymUsed && min > 0;
      if (hard) qGymUsed = true;
      out.push({ day: e.day, slot: e.slot, sport: "gym", kind: hard ? "quality" : "easy", targetMin: min,
                 venue: gymVenue, gym: { seed: hashSeed(`${weekSalt}-${e.day}-${e.slot}`), avoidIds: [], swaps: {} } });
      continue;
    }
    const min = bikeSplit[bi++];
    const kind = e.what === "bike-long" ? "long" : "easy";
    if (e.day === qBikeDay && !qBikeUsed && e.what !== "bike-long" && min > 0) {
      qBikeUsed = true;
      const s = { day: e.day, slot: e.slot, sport: "bike", kind: "quality", targetMin: min,
                  zone: QUALITY_TEMPLATES[bikeQTemplate].zone, qualityTemplate: bikeQTemplate };
      if (bikeQTemplate === "bikeClimb" && climbTarget) s.targetAscent = climbTarget;
      out.push(s);
    } else out.push({ day: e.day, slot: e.slot, sport: "bike", kind, targetMin: min, zone: 2 });
  }
  // brick (triathlon): turn the long ride into a back-to-back bike→run on its day
  if (opts.brick) {
    const ride = out.find(s => s.sport === "bike" && s.kind === "long") || out.find(s => s.sport === "bike");
    if (ride) {
      const runTail = deload ? 15 : 20;
      delete ride.qualityTemplate;
      ride.sport = "brick"; ride.kind = "brick";
      ride.legs = [{ sport: "bike", targetMin: ride.targetMin, zone: 2 }, { sport: "run", targetMin: runTail, zone: 2 }];
      ride.targetMin = ride.targetMin + runTail;
    }
  }
  return out;
}

export function sumSessions(sessions, sport) {
  return sessions.reduce((a, s) => {
    if (s.sport === sport) return a + (s.targetMin || 0);
    // a brick holds two back-to-back legs — count each leg toward its sport
    if (s.sport === "brick" && Array.isArray(s.legs)) return a + s.legs.filter(l => l.sport === sport).reduce((x, l) => x + (l.targetMin || 0), 0);
    return a;
  }, 0);
}
/* Per-sport planned minutes for a session list (the week's targetMin shape). */
export function sportTargets(sessions) {
  return { run: sumSessions(sessions, "run"), bike: sumSessions(sessions, "bike"), gym: sumSessions(sessions, "gym"), swim: sumSessions(sessions, "swim") };
}

/* §7.2 — next load week from the last load week. Run growth hard-capped at
   +10 %/week; any excess goes to the bike. */
export function planNextWeek({ prevLoadWeek, chosenRate, settings, startDate, weekNum,
                               quality = { run: false, bike: false }, noQuality = false,
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1", logs = [] }) {
  const prevRun = prevLoadWeek.targetMin.run;
  const prevBike = prevLoadWeek.targetMin.bike;
  const prevGym = prevLoadWeek.targetMin.gym || 0;
  const prevSwim = prevLoadWeek.targetMin.swim || 0;
  const prevTotal = prevRun + prevBike + prevGym + prevSwim;
  const total = prevTotal * (1 + chosenRate);
  // run, gym and swim are load-sensitive → capped at +10 %/wk; the bike absorbs the rest
  const runT = Math.min(prevRun * 1.10, (prevRun / prevTotal) * total);
  const gymT = prevGym === 0 ? 0 : Math.min(prevGym * 1.10, (prevGym / prevTotal) * total);
  const swimT = prevSwim === 0 ? 0 : Math.min(prevSwim * 1.10, (prevSwim / prevTotal) * total);
  const bikeT = total - runT - gymT - swimT;
  const gymHard = settings.allowedTypes ? settings.allowedTypes.gymStrength !== false : true;
  const q = noQuality ? { run: false, bike: false, gym: false }
    : { run: quality.run && !!runQTemplate, bike: quality.bike && !!bikeQTemplate, gym: gymHard };
  const climbTarget = climbTargetAscent({ logs, weekNum, settings });
  const sessions = buildSessions(runT, bikeT, gymT, settings.layout,
    { quality: q, runQTemplate, bikeQTemplate, swimMin: swimT, brick: settings.goal === "triathlon" && prevBike > 0 && prevRun > 0,
      longCap: 210, climbTarget, gymVenue: settings.gymVenueDefault || "home", weekSalt: startDate });
  return {
    id: isoWeekId(startDate), startDate, weekNum, isDeload: false, sessions,
    targetMin: sportTargets(sessions),
    rate: chosenRate,
  };
}

/* §7.3 — deload: 60 % of the previous load week, session by session,
   everything Z2 or below, no quality, long ride capped at 90. */
export function deloadWeek({ prevLoadWeek, startDate, weekNum }) {
  const sessions = prevLoadWeek.sessions.map(s => {
    if (s.sport === "rest") return { ...s };
    if (s.sport === "brick") return { day: s.day, slot: s.slot, sport: "brick", kind: "brick", zone: 2,
      legs: (s.legs || []).map(l => ({ ...l, targetMin: round5(l.targetMin * 0.6) })), targetMin: round5(s.targetMin * 0.6) };
    if (s.sport === "gym") {
      return { day: s.day, slot: s.slot, sport: "gym", kind: "easy",
               targetMin: snapGymMinutes(round5(s.targetMin * 0.6)), venue: s.venue || "home",
               gym: { seed: hashSeed(`${startDate}-${s.day}-${s.slot ?? 0}`), avoidIds: [], swaps: {} } };
    }
    let min = round5(s.targetMin * 0.6);
    if (s.kind === "long") min = Math.min(min, 90);
    return { day: s.day, sport: s.sport, kind: s.kind === "long" ? "long" : "easy",
             targetMin: min, zone: Math.min(2, s.zone || 2) };
  });
  return {
    id: isoWeekId(startDate), startDate, weekNum, isDeload: true, sessions,
    targetMin: sportTargets(sessions),
    rate: 0,
  };
}

export function isDeloadWeek(weekNum, deloadEvery) {
  return deloadEvery > 0 && weekNum % deloadEvery === 0;
}

/* Whole weeks from the Monday of `weekStartISO` to the Monday of the goal event
   (settings.goalEvent.date), or null with no dated event. 0 = the event is that week. */
export function weeksToEvent(settings, weekStartISO) {
  const ev = settings && settings.goalEvent;
  if (!ev || !ev.date) return null;
  return Math.round((parseISO(mondayOf(ev.date)) - parseISO(mondayOf(weekStartISO))) / (7 * 864e5));
}

/* Taper toward the event — scale the previous week down so you arrive fresh:
   ~2 weeks out 70 %, final week 50 %, race week 40 %. A short sharpener (quality)
   is kept until race week, when everything goes easy. */
export function taperWeek({ prevLoadWeek, startDate, weekNum, weeksOut }) {
  const factor = weeksOut >= 2 ? 0.7 : weeksOut === 1 ? 0.5 : 0.4;
  const longCap = weeksOut >= 2 ? 75 : weeksOut === 1 ? 50 : 40;
  const keepQuality = weeksOut >= 1;
  const sessions = prevLoadWeek.sessions.map(s => {
    if (s.sport === "rest") return { ...s };
    if (s.sport === "brick") return { day: s.day, slot: s.slot, sport: "brick", kind: "brick", zone: 2,
      legs: (s.legs || []).map(l => ({ ...l, targetMin: round5(l.targetMin * factor) })), targetMin: round5(s.targetMin * factor) };
    if (s.sport === "gym") {
      return { day: s.day, slot: s.slot, sport: "gym", kind: "easy",
               targetMin: snapGymMinutes(round5(s.targetMin * factor)), venue: s.venue || "home",
               gym: { seed: hashSeed(`${startDate}-${s.day}-${s.slot ?? 0}`), avoidIds: [], swaps: {} } };
    }
    const isQ = s.kind === "quality" && keepQuality;
    let min = round5(s.targetMin * factor);
    if (s.kind === "long") min = Math.min(min, longCap);
    const out = { day: s.day, slot: s.slot, sport: s.sport,
                  kind: isQ ? "quality" : (s.kind === "long" ? "long" : "easy"),
                  targetMin: Math.max(20, min), zone: isQ ? (s.zone || 4) : Math.min(2, s.zone || 2) };
    if (isQ && s.qualityTemplate) out.qualityTemplate = s.qualityTemplate;
    return out;
  });
  return {
    id: isoWeekId(startDate), startDate, weekNum, isDeload: false, taper: weeksOut, sessions,
    targetMin: sportTargets(sessions),
    rate: factor - 1,
  };
}

export function lastLoadWeek(weeks) {
  if (!weeks.length) return null;
  for (let i = weeks.length - 1; i >= 0; i--) if (!weeks[i].isDeload) return weeks[i];
  return weeks[weeks.length - 1];
}

/* ---------------- completion (§7.4) ---------------- */

export function plannedMinutes(week) {
  return week.targetMin.run + week.targetMin.bike + (week.targetMin.gym || 0) + (week.targetMin.swim || 0);
}

export function loggedMinutes(week, logs) {
  const end = addDays(week.startDate, 6);
  return logs
    .filter(l => l.date >= week.startDate && l.date <= end &&
                 (isRunType(l) || l.sport === "bike" || l.sport === "gym" || l.sport === "swim") && l.source !== "seed")
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
  bike: ["intervals", "sprint", "climb"],
};

const FAMILY_KEY = { run: { intervals: "runIntervals", tempo: "runTempo", hills: "runHills" },
                     bike: { intervals: "bikeIntervals", sprint: "bikeSprint", climb: "bikeClimb" } };

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
  if (family === "sprint") return "bikeSprint";
  return sport === "run" ? (count >= 4 ? "runQ2" : "runQ1")
                         : (count >= 4 ? "bikeQ2" : "bikeQ1");
}

/* v1.1 — read-only look-ahead for the "Coming weeks" card: simulate the next
   n weeks at the default growth rate. The Sunday check-in stays the real
   control; this only shows where the dial is pointing. */
export function projectWeeks({ weeks, settings, quality = { run: false, bike: false }, n = 3, ...opts }) {
  if (!weeks.length) return [];
  const sim = [...weeks];
  const out = [];
  for (let k = 0; k < n; k++) {
    const last = sim[sim.length - 1];
    const startDate = addDays(last.startDate, 7);
    const weekNum = last.weekNum + 1;
    const wo = weeksToEvent(settings, startDate);
    const w = (wo === 0 || wo === 1 || wo === 2)
      ? taperWeek({ prevLoadWeek: lastLoadWeek(sim), startDate, weekNum, weeksOut: wo })
      : isDeloadWeek(weekNum, settings.deloadEvery)
      ? deloadWeek({ prevLoadWeek: lastLoadWeek(sim), startDate, weekNum })
      : planNextWeek({
          prevLoadWeek: lastLoadWeek(sim), chosenRate: settings.growthRate, settings,
          startDate, weekNum, quality, logs: opts.logs || [],
          runQTemplate: qualityTemplateFor(sim, "run", settings.allowedFamilies),
          bikeQTemplate: qualityTemplateFor(sim, "bike", settings.allowedFamilies),
        });
    sim.push(w);
    out.push({
      weekNum, startDate, isDeload: w.isDeload, taper: w.taper,
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

/* Fatigue-aware day assignment around a configurable rest day. Returns
   day → [sports]. ≤ 6 sessions = one per day; a 7th/8th lands as a second
   session on the freshest day (farthest from the long/hard day). */
export function placeLayout({ run, bike, gym = 0, swim = 0, restDay = "sun" }) {
  const layout = {}; DAYS.forEach(d => { layout[d] = []; });
  const active = DAYS.filter(d => d !== restDay);
  const total = run + bike + gym;
  const used = spreadPick(active, Math.min(total, active.length));
  const longDay = bike > 0 ? (used.includes("sat") ? "sat" : used[used.length - 1]) : null;
  const runnable = used.filter(d => d !== longDay);
  const order = runnable.filter((_, i) => i % 2 === 0).concat(runnable.filter((_, i) => i % 2 === 1));
  const runDays = order.slice(0, run);
  // gym lands on the freshest non-run days (spread among the bike days)
  const gymPool = runnable.filter(d => !runDays.includes(d));
  const gymDays = spreadPick(gymPool, Math.min(gym, gymPool.length));
  const assigned = { run: 0, bike: 0, gym: 0 };
  for (const d of used) {
    if (d === longDay) { layout[d].push("bike-long"); assigned.bike++; }
    else if (runDays.includes(d)) { layout[d].push("run"); assigned.run++; }
    else if (gymDays.includes(d)) { layout[d].push("gym"); assigned.gym++; }
    else { layout[d].push("bike"); assigned.bike++; }
  }
  // extras beyond one-per-day → freshest days (farthest from the long day),
  // filling each stream's remaining demand explicitly
  const li = longDay ? DAYS.indexOf(longDay) : -1;
  const fresh = active.filter(d => layout[d].length === 1)
    .sort((a, b) => (li < 0 ? 0 : Math.abs(DAYS.indexOf(b) - li) - Math.abs(DAYS.indexOf(a) - li)));
  for (const d of fresh) {
    if (assigned.bike < bike) { layout[d].push("bike"); assigned.bike++; }
    else if (assigned.gym < gym) { layout[d].push("gym"); assigned.gym++; }
    else if (assigned.run < run) { layout[d].push("run"); assigned.run++; }
    else break;
  }
  // swims are low-impact cross-training — drop each on the currently lightest active day (stacking is fine)
  for (let k = 0; k < swim; k++) {
    const lightest = active.reduce((best, d) => layout[d].length < layout[best].length ? d : best, active[0]);
    layout[lightest].push("swim");
  }
  for (const d of DAYS) if (!layout[d].length) layout[d] = ["rest"];
  return layout;
}

/* Goal → recommended starting mix + workout-type emphasis for the onboarding funnel.
   The user overrides everything; this just seeds sensible defaults with a reason. */
/* The three weight-loss rates offered when the goal is "weight". The chosen
   rate drives the burn goal (recommendBurnGoal), the training volume and the
   intensity (see goalDefaults below). */
export const LOSS_RATES = [
  { key: "gentle",     kg: 0.25, label: "Gentle" },
  { key: "standard",   kg: 0.5,  label: "Standard" },
  { key: "aggressive", kg: 0.75, label: "Aggressive" },
];

export function goalDefaults(goal, opts = {}) {
  switch (goal) {
    case "race":     return { mix: { run: 4, bike: 1, gym: 0 }, allowed: ["longRun", "runTempo", "runIntervals"], reason: "Run-focused with a long run and tempo work to build race endurance." };
    case "cycling":  return { mix: { run: 1, bike: 4, gym: 0 }, allowed: ["longRide", "bikeClimb", "bikeIntervals"], reason: "Ride-focused with a long ride and climbing to build cycling endurance." };
    case "triathlon": return { mix: { run: 3, bike: 3, gym: 0, swim: 2 }, allowed: ["longRide", "longRun", "bikeClimb"], reason: "A bike-led triathlon base — endurance across swim, bike and run, with a weekly brick (bike→run)." };
    case "weight": {
      // Faster loss = more sessions (volume) and harder work (intensity).
      const rate = opts.lossKg || 0.5;
      const mix = rate >= 0.75 ? { run: 4, bike: 3, gym: 2 }
                : rate <= 0.25 ? { run: 2, bike: 2, gym: 1 }
                : { run: 3, bike: 3, gym: 1 };
      const allowed = rate >= 0.75 ? ["runIntervals", "bikeIntervals", "gymCardio"] : [];
      const reason = rate >= 0.75 ? "A high-frequency mix with added intensity to maximise the weekly burn toward your target weight."
                   : rate <= 0.25 ? "A gentle, sustainable mix paired with a modest weekly burn goal toward your target weight."
                   : "A higher-frequency balanced mix; pair it with a weekly burn goal toward your target weight.";
      return { mix, allowed, reason };
    }
    case "strength": return { mix: { run: 2, bike: 1, gym: 3 }, allowed: ["gymStrength"], reason: "Gym strength three times a week, with easy aerobic sessions to recover." };
    default:         return { mix: { run: 3, bike: 3, gym: 0 }, allowed: [], reason: "A balanced run + ride base — a solid all-round starting point." };
  }
}

/* Build a personalised Week 1 straight from the weekly mix (onboarding funnel) — Week 1
   reflects the chosen run/ride/gym counts instead of the fixed generateWeek1 table. */
export function firstWeekFromMix(startDate, settings, layout) {
  const c = settings.weeklyCounts || { run: 3, bike: 3, gym: 0 };
  const swim = c.swim || 0;
  const restDay = settings.restDay || "sun";
  if (!layout) layout = placeLayout({ run: c.run, bike: c.bike, gym: c.gym, swim, restDay });
  const sessions = buildSessions(35 * c.run, 60 * c.bike, 45 * c.gym, layout, {
    deload: false, quality: { run: false, bike: false, gym: false, swim: false },
    swimMin: 35 * swim, brick: settings.goal === "triathlon" && c.bike > 0 && c.run > 0,
    gymVenue: settings.gymVenueDefault || "home", weekSalt: startDate,
  });
  return {
    id: isoWeekId(startDate), startDate, weekNum: 1, isDeload: false, sessions,
    targetMin: sportTargets(sessions),
  };
}

/* True if a layout value (string or array) contains a run. */
function hasRun(v) { return Array.isArray(v) ? v.includes("run") : v === "run"; }

export function relayoutWeek({ week, runCount, bikeCount, gymCount = 0, swimCount = null, prevRunMin = null, restDay = null,
                               quality = { run: false, bike: false },
                               runQTemplate = "runQ1", bikeQTemplate = "bikeQ1", climbTarget = null,
                               gymVenue = "home", gymHard = true, layout = null, brick = null }) {
  const warnings = [];
  const oldRuns = week.sessions.filter(s => s.sport === "run").length;
  const oldBikes = week.sessions.filter(s => s.sport === "bike").length;
  const oldGyms = week.sessions.filter(s => s.sport === "gym").length;
  const oldSwims = week.sessions.filter(s => s.sport === "swim").length;
  const hadBrick = week.sessions.some(s => s.sport === "brick");
  // unless told otherwise, keep the week's existing swims + brick (so relayout/mix-change paths don't drop them)
  if (swimCount == null) swimCount = oldSwims;
  if (brick == null) brick = hadBrick;
  const restDays = week.sessions.filter(s => s.sport === "rest").map(s => s.day);
  const rest = restDay || (restDays.includes("sun") || !restDays.length ? "sun" : restDays[0]);

  let runMin = oldRuns > 0 ? week.targetMin.run * (runCount / oldRuns) : 35 * runCount;
  if (prevRunMin != null) runMin = Math.min(runMin, prevRunMin * 1.10);
  const bikeMin = oldBikes > 0 ? week.targetMin.bike * (bikeCount / oldBikes) : 60 * bikeCount;
  // introducing gym mid-program bootstraps from a 45-min base per session
  const gymMin = oldGyms > 0 ? (week.targetMin.gym || 0) * (gymCount / oldGyms) : 45 * gymCount;
  const swimMin = oldSwims > 0 ? (week.targetMin.swim || 0) * (swimCount / oldSwims) : 35 * swimCount;

  const lay = layout || placeLayout({ run: runCount, bike: bikeCount, gym: gymCount, swim: swimCount, restDay: rest });

  for (let i = 0; i < DAYS.length - 1; i++) {
    if (hasRun(lay[DAYS[i]]) && hasRun(lay[DAYS[i + 1]])) { warnings.push("consecutive-runs"); break; }
  }

  const q = { run: quality.run && !!runQTemplate, bike: quality.bike && !!bikeQTemplate, gym: gymHard && !week.isDeload };
  const sessions = buildSessions(runMin, bikeMin, gymMin, lay,
    { deload: week.isDeload, quality: q, runQTemplate, bikeQTemplate, swimMin, brick: brick && bikeCount > 0 && runCount > 0,
      longCap: week.isDeload ? 90 : 210, climbTarget, gymVenue, weekSalt: week.startDate });
  return {
    week: { ...week, sessions,
            targetMin: sportTargets(sessions) },
    warnings,
  };
}

/* Layout-editor guard (§1.7): find consecutive run days in a day→sport map. */
export function consecutiveRunDays(layout) {
  const out = [];
  for (let i = 0; i < DAYS.length - 1; i++) {
    if (hasRun(layout[DAYS[i]]) && hasRun(layout[DAYS[i + 1]])) out.push([DAYS[i], DAYS[i + 1]]);
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

const SPORT_MAP = {
  "Running": "run", "Treadmill Running": "run", "Track Running": "run",
  "Trail Running": "trail",
  "Cycling": "bike", "Road Cycling": "bike", "Mountain Biking": "bike", "Virtual Cycling": "bike", "Gravel/Unpaved Cycling": "bike",
  "Hiking": "hike",
  "Pool Swim": "swim", "Pool Swimming": "swim", "Lap Swimming": "swim", "Open Water Swimming": "swim", "Open Water": "swim", "Swimming": "swim",
};

/* Trail runs count as runs for plan fulfilment; hiking does not. */
export function isRunType(sportOrLog) {
  const s = typeof sportOrLog === "string" ? sportOrLog : sportOrLog?.sport;
  return s === "run" || s === "trail";
}

function hmsToMin(t) {
  const parts = String(t).split(":").map(parseFloat);
  if (parts.some(Number.isNaN)) return null;
  let min = 0;
  if (parts.length === 3) min = parts[0] * 60 + parts[1] + parts[2] / 60;
  else if (parts.length === 2) min = parts[0] + parts[1] / 60;
  else return null;
  return Math.round(min);
}

export function parseGarminCSV(text, overrides = {}) {
  const rows = parseCSV(text.replace(/^﻿/, ""));
  if (!rows.length) return { error: "Empty file" };
  const header = rows[0].map(h => h.trim());
  const col = name => header.indexOf(name);
  const iType = col("Activity Type"), iDate = col("Date"), iTime = col("Time"),
        iDist = col("Distance"), iHR = col("Avg HR"), iTitle = col("Title"),
        iAsc = col("Total Ascent"), iMaxHR = col("Max HR"),
        iDesc = col("Total Descent"), iCal = col("Calories"),
        iTE = col("Aerobic TE") >= 0 ? col("Aerobic TE") : col("Aerobic Training Effect");
  if (iType < 0 || iDate < 0 || iTime < 0) {
    return { error: "Doesn't look like a Garmin activities CSV (missing Activity Type / Date / Time columns)" };
  }
  const pint = (i, r) => i >= 0 ? (parseInt((r[i] ?? "").replace(/[^\d]/g, ""), 10) || null) : null;
  const pfloat = (i, r) => { if (i < 0) return null; const v = parseFloat((r[i] ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(v) ? v : null; };
  const out = [], counts = { run: 0, bike: 0, trail: 0, hike: 0, swim: 0, other: 0, bad: 0 };
  for (const r of rows.slice(1)) {
    const type = (r[iType] || "").trim();
    const sport = overrides[type] || SPORT_MAP[type] || "other";
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec((r[iDate] || "").trim());
    const min = hmsToMin((r[iTime] || "").trim());
    if (!m || !min) { counts.bad++; continue; }
    const rawDist = parseFloat((r[iDist] ?? "").replace(/[",]/g, "")) || null;
    // swim distance is metres (export it as km sometimes, e.g. "1.50"); keep it in `m`, never `km`
    const isSwim = sport === "swim";
    const swimM = isSwim && rawDist != null ? Math.round(rawDist < 50 ? rawDist * 1000 : rawDist) : undefined;
    out.push({
      date: m[1], time: `${m[2]}:${m[3]}`, sport, min,
      km: isSwim ? undefined : (rawDist ?? undefined), m: swimM,
      venue: isSwim ? (/open/i.test(type) ? "open" : "pool") : undefined,
      avgHR: pint(iHR, r) ?? undefined, maxHR: pint(iMaxHR, r) ?? undefined,
      ascent: pint(iAsc, r) ?? undefined, descent: pint(iDesc, r) ?? undefined,
      calories: pint(iCal, r) ?? undefined,
      aerobicTE: pfloat(iTE, r) ?? undefined,
      note: (iTitle >= 0 && r[iTitle]) ? r[iTitle].trim() : undefined,
      activityType: type,
    });
    counts[sport] = (counts[sport] || 0) + 1;
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

/* Fields a Garmin row can fill in on an existing log — only where the log is
   missing them (never overwrites your own data, e.g. notes/RPE/type). */
const IMPORT_FILL_FIELDS = ["km", "m", "venue", "avgHR", "maxHR", "ascent", "descent", "calories", "time", "aerobicTE"];
export function fillableFields(log, row) {
  const out = {};
  for (const f of IMPORT_FILL_FIELDS) if (log[f] == null && row[f] != null) out[f] = row[f];
  if (!log.note && row.note) out.note = row.note;
  return out;
}

/* v1.3.2 import triage: rows with no match are added; a row matching an
   existing activity GAP-FILLS any fields the activity is missing (calories,
   max HR, ascent/descent…) rather than being thrown away. If the activity is
   already complete, the row is left unchanged. */
export function classifyImport(rows, logs) {
  const fresh = [], enrich = [], unchanged = [];
  for (const { row, matches } of importMatches(rows, logs)) {
    if (!matches.length) { fresh.push(row); continue; }
    const log = matches[0]; // best match
    const fill = fillableFields(log, row);
    if (Object.keys(fill).length) enrich.push({ row, log, fill });
    else unchanged.push(row);
  }
  return { fresh, enrich, unchanged };
}

/* ---------------- progress helpers ---------------- */

export function vo2AtTargetWeight(vo2, weightKg, targetKg) {
  if (!vo2 || !weightKg || !targetKg) return null;
  return Math.round((vo2 * weightKg / targetKg) * 10) / 10;
}

/* Daniels' VDOT for a single run performance (km over min). The inverse curve
   below (danielsPaces) turns a VDOT back into training paces. */
export function vdotFor(km, min) {
  if (!(km > 0) || !(min > 0)) return null;
  const v = (km * 1000) / min; // metres per minute
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
  const vdot = vo2 / pct;
  return vdot > 0 ? Math.round(vdot * 10) / 10 : null;
}

/* Daniels' training paces (sec per km) from a VDOT. Each pace is a fraction of
   the velocity at VO₂max (vVDOT); the fractions reproduce Daniels' E/M/T/I/R
   tables closely. Returns null for a non-positive VDOT. */
export function danielsPaces(vdot) {
  if (!(vdot > 0)) return null;
  // velocity (m/min) achieving a given VO₂ — inverse of the vo2–velocity curve
  const velAt = vo2 => {
    const a = 0.000104, b = 0.182258, c = -(4.60 + vo2);
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  };
  const vV = velAt(vdot);                                   // velocity at VO₂max
  const pace = frac => Math.round(60000 / (vV * frac));     // sec/km at frac of vVDOT
  return {
    easy: [pace(0.70), pace(0.77)],
    marathon: pace(0.84),
    threshold: pace(0.88),
    interval: pace(0.975),
    rep: pace(1.05),
  };
}

/* Goal-derived run training paces — when the goal is a dated run race with a
   target finish time, the implied VDOT sets the training paces. Null otherwise. */
export function goalRunPaces(settings) {
  const ev = settings && settings.goalEvent;
  if (!ev || settings.goal !== "race" || !(ev.distanceKm > 0) || !(ev.targetSec > 0)) return null;
  const vdot = vdotFor(ev.distanceKm, ev.targetSec / 60);
  if (!vdot) return null;
  return { vdot, racePace: Math.round(ev.targetSec / ev.distanceKm), ...danielsPaces(vdot) };
}

/* Goal average speed (km/h) for a cycling event with a target time, else null. */
export function goalRideSpeed(settings) {
  const ev = settings && settings.goalEvent;
  if (!ev || settings.goal !== "cycling" || !(ev.distanceKm > 0) || !(ev.targetSec > 0)) return null;
  return Math.round((ev.distanceKm / (ev.targetSec / 3600)) * 10) / 10;
}

/* Is the run target realistic vs current fitness? Compares the goal VDOT with
   the VDOT estimated from recent runs. level: ready ≤1, stretch ≤5, ambitious. */
export function goalFitnessCheck(doc, asOfISO) {
  const gp = goalRunPaces(doc.settings);
  if (!gp) return null;
  const cur = estimateVo2FromRuns(doc.logs || [], asOfISO || (doc.weighIns?.[doc.weighIns.length - 1]?.date) || "9999-12-31");
  if (cur == null) return { goalVdot: gp.vdot, currentVdot: null, gap: null, level: "unknown" };
  const gap = Math.round((gp.vdot - cur) * 10) / 10;
  const level = gap <= 1 ? "ready" : gap <= 5 ? "stretch" : "ambitious";
  return { goalVdot: gp.vdot, currentVdot: cur, gap, level };
}

/* VO₂max estimate from your best recent run (Daniels' VDOT, running only).
   Returns the highest VDOT among qualifying runs in the window, or null. */
export function estimateVo2FromRuns(logs, asOfISO, windowDays = 56, minKm = 1.5) {
  const from = addDays(asOfISO, -windowDays);
  let best = null;
  for (const l of logs) {
    if (!isRunType(l) || !(l.km >= minKm) || !(l.min > 0)) continue;
    if (l.date < from || l.date > asOfISO) continue;
    const vdot = vdotFor(l.km, l.min);
    if (vdot != null && (best == null || vdot > best)) best = vdot;
  }
  return best == null ? null : Math.round(best * 10) / 10;
}

/* Per-week rolling-best VDOT over a window — the VO₂ trend in "calculated" mode. */
export function vo2CalcCurve(logs, from, to) {
  const out = [];
  const firstMon = addDays(from, -dayIndex(from));
  for (let mon = firstMon; mon <= to; mon = addDays(mon, 7)) {
    const wkEnd = addDays(mon, 6);
    const asOf = wkEnd < to ? wkEnd : to;
    const v = estimateVo2FromRuns(logs, asOf);
    if (v != null) out.push({ date: asOf, value: v });
  }
  return out;
}

/* ---- swim fitness: Critical Swim Speed (CSS), the swim analogue of VDOT ---- */
/* CSS from two sustained efforts (e.g. 400 m & 200 m time-trials). d in metres,
   t in seconds, d2>d1. Returns speed (m/s) + pace per 100 m (sec). */
export function cssFromEfforts(d1, t1, d2, t2) {
  if (!(d2 > d1) || !(t2 > t1)) return null;
  const speed = (d2 - d1) / (t2 - t1);
  return { speed, pacePer100: Math.round((100 * (t2 - t1)) / (d2 - d1)) };
}
/* Estimate CSS pace (sec/100 m) from recent swims: a hard sustained long swim
   sits near CSS; with only short swims, nudge slightly slower. null if no swims. */
export function estimateCSS(logs, asOfISO, windowDays = 56) {
  const from = addDays(asOfISO, -windowDays);
  const swims = (logs || []).filter(l => l.sport === "swim" && l.m >= 200 && l.min > 0 && l.date >= from && l.date <= asOfISO);
  if (!swims.length) return null;
  const pace = l => (l.min * 60) / (l.m / 100);
  const longs = swims.filter(l => l.m >= 800);
  const css = longs.length ? Math.min(...longs.map(pace)) : Math.min(...swims.map(pace)) * 1.06;
  return { pacePer100: Math.round(css), speed: 100 / css, source: longs.length ? "sustained" : "short", n: swims.length };
}
/* Training paces (sec/100 m) from a CSS pace — Swim-Smooth-style zone offsets. */
export function swimPaces(css) {
  if (!(css > 0)) return null;
  const p = f => Math.round(css * f);
  return { easy: [p(1.18), p(1.10)], endurance: p(1.06), threshold: p(1), interval: p(0.94), sprint: p(0.88) };
}
/* Per-week CSS trend over a window (the swim fitness curve). */
export function cssCurve(logs, from, to) {
  const out = [];
  const firstMon = addDays(from, -dayIndex(from));
  for (let mon = firstMon; mon <= to; mon = addDays(mon, 7)) {
    const wkEnd = addDays(mon, 6);
    const asOf = wkEnd < to ? wkEnd : to;
    const c = estimateCSS(logs, asOf);
    if (c) out.push({ date: asOf, value: c.pacePer100 });
  }
  return out;
}

/* Triathlon readiness — per-leg (swim/bike/run) and overall. Each leg blends
   distance-readiness (your longest single session vs the race leg) with recent
   volume-vs-target; the overall is weighted by each leg's estimated race time
   (so the bike dominates a long course). Returns null for a non-triathlon goal. */
export function triReadiness(doc, todayISO) {
  const ev = doc.settings && doc.settings.goalEvent;
  if (!ev || ev.kind !== "triathlon" || !ev.legs) return null;
  const logs = doc.logs || [];
  const longest = (pred, val) => logs.filter(pred).reduce((m, l) => Math.max(m, val(l) || 0), 0);
  const from = addDays(todayISO, -21);
  const vol = volumeInRange(logs, from, todayISO);
  const c = doc.settings.weeklyCounts || {};
  const tgt = { swim: (c.swim || 0) * 35 * 3, bike: (c.bike || 0) * 60 * 3, run: (c.run || 0) * 35 * 3 };
  const clamp = x => Math.max(0, Math.min(1, x));
  const leg = (longM, legM, volMin, tgtMin) => {
    const distPct = legM > 0 ? clamp(longM / legM) : 0;
    const volPct = tgtMin > 0 ? clamp(volMin / tgtMin) : distPct;
    return { ready: clamp(0.6 * distPct + 0.4 * volPct), distPct, volPct, longest: Math.round(longM) };
  };
  const legs = {
    swim: leg(longest(l => l.sport === "swim", l => l.m), ev.legs.swim.m, vol.swim, tgt.swim),
    bike: leg(longest(l => l.sport === "bike", l => (l.km || 0) * 1000), ev.legs.bike.m, vol.bike, tgt.bike),
    run:  leg(longest(l => isRunType(l), l => (l.km || 0) * 1000), ev.legs.run.m, vol.run, tgt.run),
  };
  // estimate each leg's race time (s) for time-share weighting: swim 2:00/100m, bike 28 km/h, run 5:30/km
  const dur = { swim: ev.legs.swim.m / 100 * 120, bike: ev.legs.bike.m / 1000 / 28 * 3600, run: ev.legs.run.m / 1000 * 330 };
  const tot = dur.swim + dur.bike + dur.run || 1;
  const overall = (legs.swim.ready * dur.swim + legs.bike.ready * dur.bike + legs.run.ready * dur.run) / tot;
  const weakest = ["swim", "bike", "run"].reduce((a, b) => legs[b].ready < legs[a].ready ? b : a, "swim");
  return { legs, overall, weakest };
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
    const run = inWeek.filter(l => isRunType(l)).reduce((a, l) => a + (l.min || 0), 0);
    const bike = inWeek.filter(l => l.sport === "bike").reduce((a, l) => a + (l.min || 0), 0);
    const gym = inWeek.filter(l => l.sport === "gym").reduce((a, l) => a + (l.min || 0), 0);
    const plan = weeks.find(w => w.startDate === start);
    out.push({
      start, run, bike, gym,
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

const ENDURANCE = new Set(["run", "trail", "bike", "hike", "swim"]);
/* Descriptive analytics (load, intensity, efficiency, calories) count ALL real
   endurance history, including the bootstrapped/imported seed — consistent with
   weeklyVolume. (Plan completion/adherence still exclude seed separately.) */
const TRAIN = l => l && ENDURANCE.has(l.sport);
/* Every logged activity counts toward load/intensity — endurance sports always,
   and any other (gym/other, planned or extra) once it carries an effort signal
   (HR or RPE) or a type tag; a bare untyped tap stays time/volume/adherence only. */
const hasEffortSignal = l => l.avgHR != null || l.rpe != null;
const LOADBEARING = l => l && (ENDURANCE.has(l.sport) || hasEffortSignal(l) || l.type != null);
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
  recovery: "aerobic", easy: "aerobic", long: "aerobic", drills: "aerobic", endurance: "aerobic",
  tempo: "threshold", climb: "threshold", threshold: "threshold",
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
    logs.filter(l => LOADBEARING(l) && l.date >= start && l.date <= end)
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
const TYPE_EFFORT = { recovery: 3, easy: 4, long: 5, drills: 4, endurance: 5, tempo: 6, climb: 7, threshold: 6, intervals: 8, hills: 8 };
export function sessionEffort(log, bounds) {
  if (log.rpe != null) return log.rpe;
  const z = zoneOfHR(bounds, log.avgHR);
  if (z != null) return ZONE_EFFORT[z];
  return TYPE_EFFORT[log.type] || 5;
}
// Estimated fractional HR-reserve by session type / sport — used when a log has no avgHR.
const TYPE_HRR = { recovery: 0.55, easy: 0.62, long: 0.65, drills: 0.55, endurance: 0.65, tempo: 0.78, climb: 0.80, threshold: 0.80, hills: 0.85, intervals: 0.88 };
const SPORT_HRR = { swim: 0.62, run: 0.65, bike: 0.60, hike: 0.55, gym: 0.58, other: 0.55 };

/* Banister TRIMP — training load, intensity weighted exponentially (a hard
   session outscores a longer easy one). Intensity comes from avgHR vs resting/max
   (bounds) when present; else from RPE (RPE×duration); else an estimate from the
   session type / sport. A bare non-endurance tap with no signal or type scores 0
   (time-only). Returns the raw (unrounded) impulse. */
export function sessionTrimp(log, bounds) {
  if (!log.min) return 0;
  // non-endurance with no effort signal or type tag = time-only (no load)
  if (!ENDURANCE.has(log.sport) && log.avgHR == null && log.rpe == null && log.type == null) return 0;
  const maxHR = (bounds && bounds.maxHR) || 190;
  const restHR = bounds && bounds.restHR != null ? bounds.restHR : 50;
  let hrr = log.avgHR != null && maxHR > restHR
    ? (log.avgHR - restHR) / (maxHR - restHR)
    : log.rpe != null
      ? 0.30 + 0.06 * log.rpe
      : (TYPE_HRR[log.type] ?? SPORT_HRR[log.sport] ?? 0.55);
  hrr = Math.max(0, Math.min(1, hrr));
  const female = bounds && bounds.sex === "female";
  const k1 = female ? 0.86 : 0.64, k2 = female ? 1.67 : 1.92;
  return log.min * hrr * k1 * Math.exp(k2 * hrr);
}
export function sessionLoad(log, bounds) {
  return Math.round(sessionTrimp(log, bounds));
}
// Acute:chronic workload ratio → status band (shared by the chip and the curve).
export function loadStatus(acwr) {
  if (acwr == null) return "building";
  return acwr < 0.8 ? "undertraining" : acwr <= 1.3 ? "optimal"
    : acwr <= 1.5 ? "overreaching" : "high-risk";
}
export function trainingLoad({ logs, bounds, todayISO, n = 12 }) {
  const train = logs.filter(LOADBEARING);
  const loadOn = (a, b) => train.filter(l => l.date >= a && l.date <= b)
                                .reduce((s, l) => s + sessionLoad(l, bounds), 0);
  const acute = loadOn(addDays(todayISO, -6), todayISO);
  const chronic = loadOn(addDays(todayISO, -27), todayISO) / 4;
  const acwr = chronic > 0 ? acute / chronic : null;
  const status = loadStatus(acwr);
  const thisMonday = addDays(todayISO, -dayIndex(todayISO));
  const weeks = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(thisMonday, -7 * k);
    weeks.push({ start, load: loadOn(start, addDays(start, 6)), current: start === thisMonday });
  }
  return { weeks, acute: Math.round(acute), chronic: Math.round(chronic), acwr, status };
}

/* Rolling 7-day load over a date window — the line + optimal band shown on the
   Load·Trend card. Each day: acute = trailing-7-day TRIMP, chronic =
   trailing-28-day/4, band = chronic×[0.8,1.3], plus its ACWR status (for the
   status-coloured line). The last point (when `to` is today) equals the chip. */
export function loadCurve(logs, bounds, from, to, todayISO) {
  const byDay = {};
  for (const l of logs) if (LOADBEARING(l)) byDay[l.date] = (byDay[l.date] || 0) + sessionLoad(l, bounds);
  const sumRange = (a, b) => { let s = 0; for (let d = a; d <= b; d = addDays(d, 1)) s += byDay[d] || 0; return s; };
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const acute = sumRange(addDays(d, -6), d);
    const chronic = sumRange(addDays(d, -27), d) / 4;
    const acwr = chronic > 0 ? acute / chronic : null;
    out.push({ date: d, acute: Math.round(acute), lo: Math.round(chronic * 0.8),
               hi: Math.round(chronic * 1.3), status: loadStatus(acwr), current: d === todayISO });
  }
  return out;
}

/* ---- aerobic Training Effect (Garmin's 0–5 bands) ---- */
export const TE_BANDS = [
  { min: 0,   label: "No Benefit",       color: "#6f7a86" },
  { min: 1.0, label: "Some Benefit",     color: "#7cae72" },
  { min: 2.0, label: "Maintaining",      color: "#5fbf6a" },
  { min: 3.0, label: "Impacting",        color: "#e6a13c" },
  { min: 4.0, label: "Highly Impacting", color: "#e8743c" },
  { min: 5.0, label: "Overreaching",     color: "#e8554e" },
];
export function teBand(te) {
  if (te == null) return null;
  let band = TE_BANDS[0];
  for (const b of TE_BANDS) if (te >= b.min) band = b;
  return band;
}
const TE_REF = 110; // calibrates the TRIMP→TE saturation curve
export function estimateAerobicTE(log, bounds) {
  const tr = sessionTrimp(log, bounds);
  if (tr <= 0) return 0;
  return Math.max(0, Math.min(5, 5 * (1 - Math.exp(-tr / TE_REF))));
}
/* Real value when present (Garmin import / manual entry), else a labeled estimate. */
export function effectiveAerobicTE(log, bounds) {
  if (log.aerobicTE != null) return { te: log.aerobicTE, estimated: false };
  return { te: estimateAerobicTE(log, bounds), estimated: true };
}
/* Coarse 'primary benefit' for a session, derived from aerobic TE + HR zone +
   duration + type. Without anaerobic TE the top end can't be split, so VO2max /
   anaerobic / sprint collapse into one "VO₂max / hard" label. */
export function primaryBenefit(log, bounds) {
  const { te } = effectiveAerobicTE(log, bounds);
  if (te < 1) return "Recovery";
  const z = zoneOfHR(bounds, log.avgHR), type = log.type;
  if (z === 5 || type === "intervals" || type === "hills") return "VO₂max / hard";
  if (z === 4 || type === "tempo") return "Threshold";
  if (z === 3 || type === "climb") return "Tempo";
  if (type === "long" || (log.min || 0) >= 90 || z == null || z <= 2) return "Base";
  return "Tempo";
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
export function climbTargetAscent({ logs = [], weekNum = 1, settings = {}, sport = "bike" }) {
  const base = settings.climbBaseAscent || 500;
  const block = Math.floor((weekNum - 1) / 4);
  let target = base * Math.pow(1.05, block);
  const recent = logs.filter(l => l.sport === sport && l.ascent > 0).slice(-8).map(l => l.ascent);
  if (recent.length) target = Math.max(target, Math.max(...recent) * 0.8);
  return Math.round(target / 50) * 50;
}

/* ---- recommended-but-editable goals (Targets page): suggest, never auto-fill ---- */

/* Weekly exercise-burn target to lose weight toward your goal (Mifflin-St Jeor).
   Returns { burn, bmi, reason } or null when inputs are missing. */
export function recommendBurnGoal(doc, lossKgPerWeek = 0.5) {
  const s = doc.settings || {};
  const wi = doc.weighIns || [];
  const kg = wi.length ? wi[wi.length - 1].kg : null;
  const { heightCm: cm, age, sex, targetWeightKg: target } = s;
  if (!kg || !cm || !age || !sex || !target) return null;
  const bmi = Math.round((kg / Math.pow(cm / 100, 2)) * 10) / 10;
  if (kg <= target) return { burn: null, bmi, reason: "You're at or below your target weight — maintain with your current routine." };
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === "female" ? -161 : 5);
  const maxDailyDeficit = bmr * 0.4; // keep intake ≥ BMR (maintenance ≈ BMR × 1.4)
  const dailyDeficit = Math.min((lossKgPerWeek * 7700) / 7, maxDailyDeficit);
  const burn = Math.round((dailyDeficit * 7 * 0.5) / 100) * 100; // ~half from training
  return { burn, bmi, reason: `To lose ~${lossKgPerWeek} kg/week toward ${target} kg — about half from training, half from diet.` };
}

/* Climb target (m of ascent) from recent rides — median of the last ~6, or null. */
export function recommendClimbTarget(doc) {
  const asc = (doc.logs || []).filter(l => l.sport === "bike" && l.ascent > 0).slice(-6).map(l => l.ascent);
  if (asc.length < 2) return null;
  const s = [...asc].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] / 50) * 50;
}

/* Weekly growth % from recent consistency + last check-in feel. Returns { rate, reason } or null. */
export function recommendGrowthRate(doc) {
  const logs = doc.logs || [], checkins = doc.checkins || [];
  const recent = (doc.weeks || []).slice(-4).filter(w => loggedMinutes(w, logs) > 0).slice(-3);
  if (!recent.length) return null;
  const avgC = recent.reduce((a, w) => a + weekCompletion(w, logs), 0) / recent.length;
  const lastFeel = checkins.length ? checkins[checkins.length - 1].feel : null;
  let rate, reason;
  if (avgC >= 0.9 && (lastFeel == null || lastFeel >= 4)) { rate = 0.08; reason = "You've hit your weeks and felt strong — you can push growth."; }
  else if (avgC >= 0.75) { rate = 0.05; reason = "Solid consistency — a moderate build fits."; }
  else { rate = 0.03; reason = "Recent weeks were patchy — grow gently."; }
  return { rate, reason };
}

/* Targets whose data-driven recommendation now meaningfully (≥10%) exceeds the current
   setting — so the coach + Sunday review can nudge the user to raise them as they progress. */
export function targetSuggestions(doc) {
  const s = doc.settings || {};
  const out = [];
  const up = (key, label, current, recommended, unit, reason) => {
    if (recommended != null && current != null && current > 0 && recommended >= current * 1.1)
      out.push({ key, label, current, recommended, unit, reason });
  };
  up("climb", "Climb target", s.climbBaseAscent, recommendClimbTarget(doc), "m", "your recent rides are climbing more");
  const gr = recommendGrowthRate(doc);
  if (gr) up("growth", "Weekly growth", Math.round((s.growthRate || 0) * 100), Math.round(gr.rate * 100), "%", gr.reason);
  const rb = recommendBurnGoal(doc);
  if (rb && rb.burn && s.weeklyCalorieTarget) up("burn", "Weekly burn goal", s.weeklyCalorieTarget, rb.burn, "kcal", "toward your target weight");
  return out;
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
                         "longestRun", "longestTrail", "longestRide", "longestHike", "longestSwim",
                         "biggestAscent", "biggestDescent", "longestSession"];
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
    if (l.sport === "trail" && l.km > 0) put("longestTrail", l.km, l, { unit: "km" });
    if (l.sport === "bike" && l.km > 0) put("longestRide", l.km, l, { unit: "km" });
    if (l.sport === "hike" && l.km > 0) put("longestHike", l.km, l, { unit: "km" });
    if (l.sport === "swim" && l.m > 0) put("longestSwim", l.m, l, { unit: "m" });
    // biggest climb / descent across any climbing-capable sport
    if ((l.sport === "bike" || l.sport === "trail" || l.sport === "hike") && l.ascent > 0) put("biggestAscent", l.ascent, l, { unit: "m" });
    if ((l.sport === "bike" || l.sport === "trail" || l.sport === "hike") && l.descent > 0) put("biggestDescent", l.descent, l, { unit: "m" });
    if (l.min > 0 && ENDURANCE.has(l.sport)) put("longestSession", l.min, l, { unit: "min" });
    for (const d of PB_DISTANCES) {
      const sportOk = d.sport === "run" ? isRunType(l) : l.sport === d.sport;
      if (sportOk && l.km >= d.band[0] && l.km <= d.band[1] && l.min > 0) {
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
  if (key === "biggestAscent" || key === "biggestDescent" || key === "longestSwim") return "m";
  if (key === "longestSession") return "min";
  return "km";
}
function pbLabel(key) {
  const d = PB_DISTANCES.find(x => x.key === key);
  if (d) return d.label;
  return { longestRun: "Longest run", longestTrail: "Longest trail run", longestRide: "Longest ride",
           longestHike: "Longest hike", longestSwim: "Longest swim", biggestAscent: "Biggest climb", biggestDescent: "Biggest descent",
           longestSession: "Longest session" }[key] || key;
}

/* Plain-text value of a PB record (used by the coach + UI). */
export function fmtBestValue(rec) {
  if (!rec) return "";
  if (rec.unit === "time") {
    const s = Math.round(rec.value), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
  }
  if (rec.unit === "min") { const m = Math.round(rec.value); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; }
  if (rec.unit === "m") return `${Math.round(rec.value)} m`;
  return `${(+rec.value).toFixed(1)} km`;
}

/* ---- calories ---- */
const SPORT_LABEL = { run: "running", trail: "trail running", bike: "cycling", hike: "hiking", gym: "gym", swim: "swimming", other: "other" };
export function caloriesInRange(logs, from, to) {
  return logs.filter(l => l.date >= from && l.date <= to && l.calories > 0)
             .reduce((a, l) => a + l.calories, 0);
}
export function weeklyCalories({ logs, todayISO, n = 12 }) {
  const mon = addDays(todayISO, -dayIndex(todayISO));
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = addDays(mon, -7 * k);
    out.push({ start, total: caloriesInRange(logs, start, addDays(start, 6)), current: start === mon });
  }
  return out;
}
export function dailyCalories({ logs, from, to }) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1))
    out.push({ date: d, total: logs.filter(l => l.date === d && l.calories > 0).reduce((a, l) => a + l.calories, 0) });
  return out;
}
export function caloriesByType({ logs, todayISO, n = 4 }) {
  const from = addDays(addDays(todayISO, -dayIndex(todayISO)), -7 * (n - 1));
  const by = {};
  for (const l of logs) if (l.calories > 0 && l.date >= from && l.date <= todayISO)
    by[l.sport || "other"] = (by[l.sport || "other"] || 0) + l.calories;
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const buckets = Object.entries(by).map(([sport, cal]) =>
    ({ sport, label: SPORT_LABEL[sport] || sport, cal, share: total ? cal / total : 0 }))
    .sort((a, b) => b.cal - a.cal);
  return { total, buckets, top: buckets[0] || null };
}
export function plannedVsUnplannedCalories({ weeks = [], logs = [], from, to }) {
  const isPlanned = l => weeks.some(w => (w.sessions || []).some(s =>
    s.sport !== "rest" && dateOfDay(w, s.day) === l.date &&
    ((isRunType(l) && isRunType(s)) || (l.sport === "bike" && s.sport === "bike") || (l.sport === "gym" && s.sport === "gym"))));
  let planned = 0, unplanned = 0;
  for (const l of logs) {
    if (!(l.calories > 0) || l.date < from || l.date > to) continue;
    if (isPlanned(l)) planned += l.calories; else unplanned += l.calories;
  }
  return { planned, unplanned };
}

/* ---- Progress time-range window (range + step + compare) ---- */
const RANGE_WK = { thisWeek: 1, "4w": 4, "8w": 8, "12w": 12, "3m": 13, "6m": 26 };
const RANGE_LBL = { thisWeek: "Last 7 days", "4w": "4 weeks", "8w": "8 weeks", "12w": "12 weeks", "3m": "3 months", "6m": "6 months" };
export function rangeWindow(range = {}, todayISO) {
  const preset = range.preset || "12w";
  const off = range.offset || 0;
  const mon = addDays(todayISO, -dayIndex(todayISO));
  let from, to, label;
  if (preset === "thisWeek") { // rolling 7 days ending today (no future days)
    to = addDays(todayISO, -7 * off);
    from = addDays(to, -6);
    label = off === 0 ? "Last 7 days" : `7 days to ${to}`;
  } else if (RANGE_WK[preset]) {
    const wk = RANGE_WK[preset];
    to = addDays(mon, 6 - 7 * wk * off);
    from = addDays(to, -(7 * wk - 1));
    label = RANGE_LBL[preset];
  } else if (preset === "ytd") {
    const year = parseISO(todayISO).getUTCFullYear() - off;
    from = `${year}-01-01`;
    to = off === 0 ? todayISO : `${year}-12-31`;
    label = off === 0 ? "Year to date" : String(year);
  } else if (preset === "all") { // earliest data → today; caller supplies range.from
    from = range.from || addDays(todayISO, -365);
    to = todayISO;
    label = "All time";
  } else { // custom
    from = range.from || addDays(todayISO, -83);
    to = range.to || todayISO;
    label = "Custom";
  }
  const days = Math.round((parseISO(to) - parseISO(from)) / 864e5) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  return { from, to, label, prevFrom, prevTo, preset, offset: off, days };
}

/* ---- program-adherence streak ---- */
export function programAdherence({ weeks = [], logs = [], todayISO }) {
  const planByDate = {};
  for (const w of weeks) for (const s of (w.sessions || [])) {
    const d = dateOfDay(w, s.day);
    (planByDate[d] = planByDate[d] || []).push(s);
  }
  const logsByDate = {};
  for (const l of logs) if (l.source !== "seed" && (isRunType(l) || l.sport === "bike" || l.sport === "gym"))
    (logsByDate[l.date] = logsByDate[l.date] || []).push(l);
  // match a planned session to a logged activity of the same sport family
  const sameSport = (s, l) => isRunType(s) ? isRunType(l) : s.sport === "gym" ? l.sport === "gym" : l.sport === "bike";

  const statusOf = d => {
    const plan = planByDate[d];
    if (!plan) return "none";
    const nonRest = plan.filter(s => s.sport !== "rest");
    if (!nonRest.length) {
      const hard = (logsByDate[d] || []).some(l => (l.rpe || 0) >= 6);
      return hard ? "modified" : "restKept";
    }
    const dayLogs = (logsByDate[d] || []).slice();
    let kept = 0, mod = 0;
    for (const s of nonRest) {
      const i = dayLogs.findIndex(l => sameSport(s, l));
      if (i < 0) continue;
      const l = dayLogs.splice(i, 1)[0];
      if ((l.min || 0) >= 0.8 * (s.targetMin || 1)) kept++; else mod++;
    }
    if (kept + mod >= nonRest.length) return kept === nonRest.length ? "kept" : "modified";
    if (kept + mod > 0) return "modified";
    return "missed";
  };

  const start = weeks.length ? weeks[0].startDate : todayISO;
  const days = [];
  for (let d = start; d <= todayISO; d = addDays(d, 1)) days.push({ date: d, status: statusOf(d) });
  const ok = s => s === "kept" || s === "modified" || s === "restKept";

  // current streak: walk back from today; today only breaks if already 'missed'
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i].status;
    if (s === "none") { if (i === days.length - 1) continue; else continue; }
    if (s === "missed") { if (days[i].date === todayISO) continue; break; }
    if (ok(s)) current++;
  }
  let longest = 0, run = 0;
  for (const x of days) {
    if (x.status === "none") continue;
    if (ok(x.status)) { run++; longest = Math.max(longest, run); }
    else if (x.status === "missed" && x.date !== todayISO) run = 0;
  }
  let sessionsRow = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i].status;
    if (s === "restKept" || s === "none") continue;
    if (s === "kept" || s === "modified") sessionsRow++; else if (days[i].date !== todayISO) break;
  }
  const past4 = days.filter(x => x.status !== "none" && x.date >= addDays(todayISO, -27) && x.date < todayISO);
  const plannedDays = past4.filter(x => x.status !== "restKept");
  const keptDays = plannedDays.filter(x => x.status === "kept" || x.status === "modified");
  const adherence = plannedDays.length ? keptDays.length / plannedDays.length : null;

  // complete weeks in a row (each past week all kept/modified + rests respected)
  const doneWeeks = weeks.filter(w => addDays(w.startDate, 6) < todayISO);
  let weeksRow = 0;
  for (let i = doneWeeks.length - 1; i >= 0; i--) {
    const w = doneWeeks[i];
    const dd = DAYS.map(day => statusOf(dateOfDay(w, day))).filter(s => s !== "none");
    if (dd.length && dd.every(ok)) weeksRow++; else break;
  }
  return {
    current, longest, sessionsRow, weeksRow,
    restRespected: days.filter(x => x.status === "restKept").length,
    missed: days.filter(x => x.status === "missed" && x.date !== todayISO).length,
    modified: days.filter(x => x.status === "modified").length,
    adherence, days,
  };
}

/* ---- structured workout steps (flat, for .FIT export) ----
   Each step is { intensity, durationType:"time"|"repeat", seconds?, hrLo, hrHi,
   name } or a repeat marker { type:"repeat", from, count }. */
export function workoutSteps(session, bounds) {
  const z = n => { const b = bounds[Math.min(5, Math.max(1, n)) - 1]; return { hrLo: b.lo, hrHi: b.hi }; };
  const tpl = session.qualityTemplate ? QUALITY_TEMPLATES[session.qualityTemplate] : null;
  const steps = [];
  if (tpl && tpl.set) {
    steps.push({ intensity: "warmup", durationType: "time", seconds: 600, ...z(2), name: "Warm-up" });
    const set = tpl.set;
    if (set.type === "intervals") {
      const from = steps.length;
      steps.push({ intensity: "active", durationType: "time", seconds: set.workSec, ...z(set.workZone), name: "Work" });
      steps.push({ intensity: "rest", durationType: "time", seconds: set.restSec, ...z(set.restZone), name: "Recover" });
      steps.push({ type: "repeat", from, count: set.reps });
    } else {
      steps.push({ intensity: "active", durationType: "time", seconds: set.blockMin * 60, ...z(set.zone), name: tpl.name });
    }
    steps.push({ intensity: "cooldown", durationType: "time", seconds: 300, ...z(2), name: "Cool-down" });
  } else {
    steps.push({ intensity: "active", durationType: "time", seconds: (session.targetMin || 30) * 60,
                 ...z(session.zone || 2), name: session.kind === "long" ? "Long" : "Steady" });
  }
  return steps;
}

/* ---- v1.4: week/month buckets, distance, Garmin-style load, VO₂ category ---- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Time buckets across [from,to]: Monday weeks, or calendar months. */
export function bucketize(from, to, unit = "week") {
  const out = [];
  if (unit === "month") {
    let d = parseISO(from); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = parseISO(to);
    while (d <= end) {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      out.push({ start: toISO(d), end: addDays(toISO(next), -1),
                 label: MONTHS[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? " " + String(d.getUTCFullYear()).slice(2) : "") });
      d = next;
    }
  } else {
    let s = addDays(from, -dayIndex(from));
    while (s <= to) { out.push({ start: s, end: addDays(s, 6), label: `${parseISO(s).getUTCDate()} ${MONTHS[parseISO(s).getUTCMonth()]}` }); s = addDays(s, 7); }
  }
  return out;
}

export function volumeInRange(logs, from, to) {
  const r = logs.filter(l => l.date >= from && l.date <= to);
  return {
    run: r.filter(isRunType).reduce((a, l) => a + (l.min || 0), 0),
    bike: r.filter(l => l.sport === "bike").reduce((a, l) => a + (l.min || 0), 0),
    hike: r.filter(l => l.sport === "hike").reduce((a, l) => a + (l.min || 0), 0),
    gym: r.filter(l => l.sport === "gym").reduce((a, l) => a + (l.min || 0), 0),
    swim: r.filter(l => l.sport === "swim").reduce((a, l) => a + (l.min || 0), 0),
  };
}
export function loadInRange(logs, bounds, from, to) {
  return logs.filter(l => LOADBEARING(l) && l.date >= from && l.date <= to).reduce((s, l) => s + sessionLoad(l, bounds), 0);
}
export function intensityInRange(logs, bounds, from, to) {
  const band = { aerobic: 0, threshold: 0, anaerobic: 0 };
  logs.filter(l => LOADBEARING(l) && l.date >= from && l.date <= to).forEach(l => { band[intensityOfLog(l, bounds)] += l.min || 0; });
  const total = band.aerobic + band.threshold + band.anaerobic;
  return { ...band, total, easyPct: total ? band.aerobic / total : null, hardPct: total ? (band.threshold + band.anaerobic) / total : null };
}

/* Garmin-style load focus: load split into Low aerobic (Z1–2), High aerobic
   (Z3–4) and Anaerobic (Z5), with a polarized "optimal range" per bucket. */
function loadBucketOf(l, bounds) {
  const z = zoneOfHR(bounds, l.avgHR);
  if (z != null) return z <= 2 ? "low" : z <= 4 ? "high" : "anaerobic";
  const t = l.type;
  if (t === "intervals" || t === "hills") return "anaerobic";
  if (t === "tempo" || t === "climb") return "high";
  return "low";
}
export function loadFocus(logs, bounds, from, to) {
  const b = { low: 0, high: 0, anaerobic: 0 };
  for (const l of logs) { if (!LOADBEARING(l) || l.date < from || l.date > to) continue; b[loadBucketOf(l, bounds)] += sessionLoad(l, bounds); }
  const total = b.low + b.high + b.anaerobic;
  const opt = { low: [total * 0.55, total * 0.80], high: [total * 0.15, total * 0.35], anaerobic: [total * 0.03, total * 0.12] };
  let focus = "Well balanced";
  if (!total) focus = "No load yet";
  else if (b.anaerobic < opt.anaerobic[0]) focus = "Anaerobic shortage";
  else if (b.high < opt.high[0]) focus = "Aerobic shortage";
  else if (b.anaerobic > opt.anaerobic[1]) focus = "Too much anaerobic";
  return { ...b, total, opt, focus };
}
export function dailyLoad(logs, bounds, from, to) {
  const days = {};
  for (const l of logs) {
    if (!LOADBEARING(l) || l.date < from || l.date > to) continue;
    const d = (days[l.date] = days[l.date] || { low: 0, high: 0, anaerobic: 0, total: 0 });
    const load = sessionLoad(l, bounds);
    d[loadBucketOf(l, bounds)] += load; d.total += load;
  }
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, ...(days[d] || { low: 0, high: 0, anaerobic: 0, total: 0 }) });
  return out;
}

/* VO₂max fitness category by age + sex (Poor→Superior), with a colour and a
   0–1 position for the dial. Thresholds ≈ Cooper/ACSM norms. */
const VO2_NORMS = {
  // [Fair, Good, Excellent, Superior] thresholds, by age bracket
  male:   { 20: [42, 46, 51, 56], 30: [41, 45, 49, 53], 40: [38, 43, 47, 52], 50: [35, 40, 43, 49], 60: [31, 36, 40, 45] },
  female: { 20: [36, 40, 44, 49], 30: [34, 38, 42, 46], 40: [32, 35, 39, 44], 50: [28, 32, 36, 41], 60: [25, 30, 33, 38] },
};
const VO2_CATS = [
  { label: "Poor", color: "#e8554e" }, { label: "Fair", color: "#e6a13c" },
  { label: "Good", color: "#5fbf6a" }, { label: "Excellent", color: "#4a90e2" },
  { label: "Superior", color: "#8e6ff0" },
];
export function vo2Category(value, age, sex) {
  if (value == null || !age || !sex || !VO2_NORMS[sex]) return null;
  const bracket = age < 30 ? 20 : age < 40 ? 30 : age < 50 ? 40 : age < 60 ? 50 : 60;
  const t = VO2_NORMS[sex][bracket];
  let idx = 0;
  for (let i = 0; i < t.length; i++) if (value >= t[i]) idx = i + 1;
  const scaleLo = t[0] - 8, scaleHi = t[3] + 6;
  const pos = Math.max(0, Math.min(1, (value - scaleLo) / (scaleHi - scaleLo)));
  return { ...VO2_CATS[idx], idx, pos, bracketLabel: `${bracket}–${bracket + 9}`, thresholds: t };
}

/* Long vs regular outings for a sport, split by distance so it works on
   imported data that carries no type tag. "Long" = an explicit long session,
   or (when untyped) ≥ 1.2× the median distance for that sport. Returns the two
   date-sorted series plus the threshold used. */
export function distanceSplit(logs, sport, from, to) {
  const inSport = l => l.km > 0 && (sport === "run" ? isRunType(l) : l.sport === sport);
  const all = logs.filter(inSport);
  const ds = all.map(l => l.km).sort((a, b) => a - b);
  const median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  const threshold = median * 1.2;
  const isLong = l => l.type === "long" || (l.type == null && ds.length >= 4 && l.km >= threshold);
  const pick = pred => all.filter(l => l.date >= from && l.date <= to && pred(l))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(l => ({ date: l.date, km: l.km, id: l.id }));
  return { long: pick(isLong), regular: pick(l => !isLong(l)), threshold, median };
}

/* Per-sport summary of what was actually done in [from,to] — counts every
   logged activity incl. unplanned. Powers the Diary week summary. */
export function weekSummary(logs, bounds, from, to) {
  const by = {};
  const total = { count: 0, min: 0, km: 0, ascent: 0, cal: 0, load: 0 };
  for (const l of logs) {
    if (l.date < from || l.date > to) continue;
    const sp = l.sport || "other";
    const s = (by[sp] = by[sp] || { count: 0, min: 0, km: 0, ascent: 0, cal: 0, load: 0 });
    const ld = sessionLoad(l, bounds);
    s.count++; s.min += l.min || 0; s.km += l.km || 0; s.ascent += l.ascent || 0; s.cal += l.calories || 0; s.load += ld;
    total.count++; total.min += l.min || 0; total.km += l.km || 0; total.ascent += l.ascent || 0; total.cal += l.calories || 0; total.load += ld;
  }
  return { bySport: by, total };
}

/* Per-sport weekly target bands for the Targets graph. Effective target = the
   user override (settings.weeklyTargets) or auto-derived from the week's planned
   minutes via pace (run) / speed (bike); gym target is minutes. conv = {runPace
   (min/km), rideKmh}. Returns { [sport]: {target, unit, lo, hi, auto} }. */
export function targetBands(week, settings, conv = {}) {
  const pct = (settings.targetRangePct ?? 15) / 100;
  const ov = settings.weeklyTargets || {};
  const tm = (week && week.targetMin) || { run: 0, bike: 0, gym: 0 };
  const runPace = conv.runPace > 0 ? conv.runPace : 5.5;
  const rideKmh = conv.rideKmh > 0 ? conv.rideKmh : 25;
  const out = {};
  const add = (sp, auto, unit) => {
    const t = ov[sp] != null ? ov[sp] : auto;
    if (t > 0) out[sp] = { target: t, unit, lo: t * (1 - pct), hi: t * (1 + pct), auto: ov[sp] == null };
  };
  add("run", tm.run / runPace, "km");
  add("bike", (tm.bike / 60) * rideKmh, "km");
  add("gym", tm.gym, "min");
  for (const sp of ["trail", "hike", "other"]) if (ov[sp] > 0) out[sp] = { target: ov[sp], unit: "km", lo: ov[sp] * (1 - pct), hi: ov[sp] * (1 + pct), auto: false };
  return out;
}
/* Flatten the current + future weeks' planned minutes to the effective targets
   (km→min via pace), scaling existing session lengths & keeping counts. Snapshots
   those weeks into doc.planBackup so restorePlan() is exactly reversible. */
export function applyTargetsToPlan(doc, settings, todayISO, conv = {}) {
  const cur = mondayOf(todayISO);
  const affected = doc.weeks.filter(w => w.startDate >= cur);
  if (!affected.length) return;
  doc.planBackup = affected.map(w => JSON.parse(JSON.stringify(w)));
  const bands = targetBands(affected[0], settings, conv);
  const runPace = conv.runPace > 0 ? conv.runPace : 5.5, rideKmh = conv.rideKmh > 0 ? conv.rideKmh : 25;
  const tmin = {};
  if (bands.run) tmin.run = Math.round(bands.run.target * runPace);
  if (bands.bike) tmin.bike = Math.round((bands.bike.target / rideKmh) * 60);
  if (bands.gym) tmin.gym = Math.round(bands.gym.target);
  for (const w of affected) {
    for (const sp of ["run", "bike", "gym"]) {
      if (tmin[sp] == null) continue;
      const curMin = sumSessions(w.sessions, sp);
      if (curMin > 0) { const f = tmin[sp] / curMin; for (const s of w.sessions) if (s.sport === sp) s.targetMin = Math.max(5, Math.round(s.targetMin * f)); }
    }
    w.targetMin = { run: sumSessions(w.sessions, "run"), bike: sumSessions(w.sessions, "bike"), gym: sumSessions(w.sessions, "gym") };
  }
  settings.planFollowsTargets = true;
}
export function restorePlan(doc, settings) {
  if (!doc.planBackup) return;
  const byDate = {}; for (const w of doc.planBackup) byDate[w.startDate] = w;
  doc.weeks = doc.weeks.map(w => byDate[w.startDate] || w);
  doc.planBackup = null;
  if (settings) settings.planFollowsTargets = false;
}

/* A Garmin-style "optimal range" per bucket: a trailing ~4-bucket chronic
   baseline × [0.8, 1.3]. The actual bucket load rides above/below this band. */
export function trainingLoadBand(logs, bounds, buckets) {
  const loads = buckets.map(bk =>
    logs.filter(l => LOADBEARING(l) && l.date >= bk.start && l.date <= bk.end)
        .reduce((s, l) => s + sessionLoad(l, bounds), 0));
  return buckets.map((bk, i) => {
    const win = loads.slice(Math.max(0, i - 3), i + 1);
    const chronic = win.reduce((a, b) => a + b, 0) / win.length;
    return { start: bk.start, lo: Math.round(chronic * 0.8), hi: Math.round(chronic * 1.3) };
  });
}

/* Adaptive prescription for an ad-hoc session (not in the plan): size from
   recent history, fall back to sane defaults. typeId = a sessionTypeOptions id. */
export function suggestSession(logs, sport, typeId, { settings = {}, weekNum = 1 } = {}) {
  const med = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const lastN = (pred, n) => logs.filter(pred).slice(-n).map(l => l.min);
  const runish = sport === "run" || sport === "trail";

  // hikes are low-intensity, time-based — three tiers, each with an adaptive climb target
  if (sport === "hike") {
    const recentAsc = logs.filter(l => l.sport === "hike" && l.ascent > 0).slice(-6).map(l => l.ascent);
    const base = recentAsc.length ? med(recentAsc) : (settings.climbBaseAscent || 500);
    const r50 = v => Math.round(v / 50) * 50;
    const tiers = {
      short:  { targetMin: 120, targetAscent: r50(Math.max(base * 0.5, 250)), note: "A short hike — a leg-stretch in the hills." },
      day:    { targetMin: 240, targetAscent: r50(Math.max(base, 400)),       note: "A day hike — steady all-day effort; pack food and water." },
      bigday: { targetMin: 360, targetAscent: r50(Math.max(base * 2, 900)),   note: "A big day out — morning till late afternoon; fuel well and pace it." },
    };
    const t = tiers[typeId] || tiers.day;
    return { targetMin: t.targetMin, zone: 1, note: t.note, targetAscent: t.targetAscent };
  }

  if (sport === "swim") {
    const recent = logs.filter(l => l.sport === "swim" && l.min > 0).slice(-6).map(l => l.min);
    const base = round5(med(recent) || 35);
    if (typeId === "threshold" || typeId === "intervals")
      return { targetMin: base, zone: 3, type: typeId, note: typeId === "intervals" ? "Swim intervals near your CSS pace — e.g. 8–10 × 100 m." : "Threshold swim — steady, strong, around your CSS pace." };
    return { targetMin: base, zone: 2, type: typeId === "endurance" ? "endurance" : "easy", note: "Smooth, relaxed swimming — focus on form." };
  }

  if (QUALITY_TEMPLATES[typeId]) {
    const t = QUALITY_TEMPLATES[typeId];
    const base = runish
      ? (med(lastN(l => isRunType(l) && (l.min || 0) >= 20, 8)) || 35)
      : (med(lastN(l => l.sport === "bike" && (l.min || 0) >= 30, 8)) || 60);
    const r = { targetMin: round5(Math.max(runish ? 35 : 45, base + 10)), zone: t.zone, qualityTemplate: typeId, note: t.label };
    if (typeId === "bikeClimb") r.targetAscent = climbTargetAscent({ logs, weekNum, settings });
    return r;
  }
  if (typeId === "long") {
    if (runish) {
      const longs = logs.filter(l => isRunType(l) && (l.type === "long" || (l.km || 0) > 12)).slice(-4).map(l => l.min);
      return { targetMin: round5(avg(longs) || 75), zone: 2, note: "Steady and unhurried — your aerobic anchor." };
    }
    const longs = logs.filter(l => l.sport === "bike" && (l.type === "long" || (l.km || 0) > 40)).slice(-4).map(l => l.min);
    return { targetMin: round5(avg(longs) || 120), zone: 2, note: "Long steady ride — build endurance." };
  }
  if (typeId === "trailHilly") {
    const easy = logs.filter(l => l.sport === "trail" && (l.min || 0) >= 20).slice(-8).map(l => l.min);
    return { targetMin: round5(med(easy) || 50), zone: 2, note: "A hilly trail run — steady effort, hike the steep climbs.",
             targetAscent: climbTargetAscent({ logs, weekNum, settings, sport: "trail" }) };
  }
  if (runish) {
    const easy = lastN(l => isRunType(l) && (!l.type || l.type === "easy") && (l.min || 0) >= 20, 8);
    return { targetMin: round5(med(easy) || 35), zone: 2, note: "Conversational pace — keep it easy." };
  }
  const easyB = lastN(l => l.sport === "bike" && (!l.type || l.type === "easy") && (l.min || 0) >= 30, 8);
  return { targetMin: round5(med(easyB) || 60), zone: 2, note: "Easy aerobic spin." };
}

/* Recommend a one-off workout type from the last 7 days (run/trail/ride only).
   Recovery first: under fatigue, recommend easy regardless of any gap. Returns
   { kind: "easy"|"tempo"|"intervals"|"long", reason } or null for hike/gym. */
export function recommendWorkout(doc, sport, todayISO) {
  if (sport !== "run" && sport !== "trail" && sport !== "bike") return null;
  const bounds = zoneBounds(doc.settings);
  const logs = doc.logs || [];
  const from = addDays(todayISO, -6), yest = addDays(todayISO, -1);
  const tl = trainingLoad({ logs, bounds, todayISO });
  const hardRecent = logs.some(l => (l.date === todayISO || l.date === yest) &&
    ["intervals", "hills", "tempo", "long", "climb"].includes(l.type));
  // only trust the acute:chronic ratio once there's a real chronic base
  if ((tl.status === "overreaching" || tl.status === "high-risk") && tl.chronic >= 80)
    return { kind: "easy", reason: "Your training load is running high — keep it easy today to absorb it." };
  if (hardRecent)
    return { kind: "easy", reason: "You went hard in the last day — an easy session lets it settle." };
  const lf = loadFocus(logs, bounds, from, todayISO);
  if (lf.focus === "Anaerobic shortage")
    return { kind: "intervals", reason: "Light on intensity this week — intervals add the punch you're missing." };
  if (lf.focus === "Aerobic shortage")
    return { kind: "tempo", reason: "Short on tempo work — a steady Z3 effort fills the high-aerobic gap." };
  if (lf.focus === "Too much anaerobic")
    return { kind: "easy", reason: "Plenty of hard work banked — go easy and aerobic to balance it." };
  const ws = weekSummary(logs, bounds, from, todayISO);
  const ride = sport === "bike";
  const vol = ride ? (ws.bySport.bike?.min || 0)
                   : ((ws.bySport.run?.min || 0) + (ws.bySport.trail?.min || 0));
  if (vol < (ride ? 120 : 80))
    return { kind: "long", reason: "Your easy volume is low this week — a longer steady effort builds the base." };
  return { kind: "easy", reason: "You're well balanced — an easy aerobic session keeps it ticking over." };
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

  // how the training plan is going + event countdown
  const planWeeks = doc.weeks || [];
  if (planWeeks.length) {
    const done = planWeeks.filter(w => addDays(w.startDate, 6) < todayISO).slice(-3);
    if (done.length) {
      const avg = done.reduce((a, w) => a + weekCompletion(w, logs), 0) / done.length;
      const pc = Math.round(avg * 100), span = `your last ${done.length} week${done.length > 1 ? "s" : ""}`;
      if (avg >= 0.9)
        add({ id: "plan-ontrack", category: "strength", title: "Plan on track",
              body: `You're completing about ${pc}% of your planned training — consistency like this is what drives the gains.`,
              why: `Average completion across ${span}.`, impact: 0.7, confidence: 0.7 });
      else if (avg >= 0.65)
        add({ id: "plan-behind", category: "recommendation", title: "Slipping a little off plan",
              body: `You're logging about ${pc}% of the plan. Protect the key sessions — or trim the weekly mix so it fits your week.`,
              why: `Average completion across ${span}.`, impact: 0.7, confidence: 0.65 });
      else
        add({ id: "plan-low", category: "recovery", title: "The plan's getting away",
              body: `Only about ${pc}% of planned training is getting done. Ease the mix, or start a fresh plan around what's realistic right now.`,
              why: `Average completion across ${span}.`, impact: 0.8, confidence: 0.7 });
    }
    const ev = doc.settings.goalEvent;
    if (ev && ev.date && ev.date >= todayISO) {
      const wo = weeksToEvent(doc.settings, todayISO);
      if (wo != null && wo >= 0) {
        const what = doc.settings.goal === "cycling" ? "event" : doc.settings.goal === "triathlon" ? "triathlon" : "race";
        add({ id: "event-countdown", category: wo <= 2 ? "recommendation" : "trend",
              title: wo === 0 ? "It's race week!" : `${wo} week${wo > 1 ? "s" : ""} to your ${what}`,
              body: wo === 0 ? "Keep it short and easy, rest up, then enjoy it." : wo <= 2 ? "You're tapering now — lower volume, stay sharp, arrive fresh." : "Stay consistent and keep building steadily toward it.",
              why: ev.distanceKm ? `${ev.distanceKm} km on ${ev.date}.` : `Target ${what} on ${ev.date}.`,
              impact: wo <= 2 ? 0.85 : 0.6, confidence: 0.9 });
        if (ev.kind === "triathlon") {
          const tr = triReadiness(doc, todayISO);
          if (tr) add({ id: "tri-readiness", category: "trend",
            title: `${Math.round(tr.overall * 100)}% ready for your ${ev.tri ? ev.tri.toUpperCase() : "triathlon"}`,
            body: `Your ${tr.weakest} is the limiter right now — give it a little extra focus across the coming weeks.`,
            why: `Swim ${Math.round(tr.legs.swim.ready * 100)}% · Bike ${Math.round(tr.legs.bike.ready * 100)}% · Run ${Math.round(tr.legs.run.ready * 100)}% (longest vs each leg + recent volume).`,
            impact: 0.7, confidence: 0.75 });
        }
      }
    }
  }

  // recommendations that have outgrown the current setting
  for (const t of targetSuggestions(doc)) {
    const u = t.unit === "%" ? "%" : t.unit === "kcal" ? " kcal" : " " + t.unit;
    add({ id: "tgt-" + t.key, category: "improvement", title: `Raise your ${t.label.toLowerCase()}`,
          body: `Your training suggests about ${t.recommended}${u} now — you're set to ${t.current}${u}. ${t.reason}. Bump it in Settings → Targets.`,
          why: "Recommended from your recent data.", impact: 0.6, confidence: 0.7 });
  }

  // new personal bests in the last 7 days
  const pbs = personalBests({ logs, manualBests: doc.manualBests || [] });
  const freshPB = pbs.find(p => p.date && p.date >= addDays(todayISO, -7) && !p.manual);
  if (freshPB)
    add({ id: "pb-" + freshPB.key, category: "strength",
          title: `New PB — ${freshPB.label}: ${fmtBestValue(freshPB)}`,
          body: "A personal best this week. Bank it and recover well.",
          why: `Set on ${freshPB.date}.`, logId: freshPB.logId,
          impact: 0.7, confidence: 0.9 });

  // calorie burn week-over-week + dominant sport
  const cal = weeklyCalories({ logs, todayISO, n: 2 });
  if (cal.length === 2 && cal[0].total > 0 && cal[1].total > 0) {
    const pct = Math.round(((cal[1].total - cal[0].total) / cal[0].total) * 100);
    if (Math.abs(pct) >= 10)
      add({ id: "cal-wow", category: pct > 0 ? "trend" : "trend",
            title: `Burned ${Math.abs(pct)}% ${pct > 0 ? "more" : "fewer"} calories than last week`,
            body: pct > 0 ? "Energy output is climbing." : "Lighter week on the energy front.",
            why: `${cal[1].total} kcal this week vs ${cal[0].total} last week.`,
            impact: 0.45, confidence: 0.6 });
  }
  const byType = caloriesByType({ logs, todayISO, n: 4 });
  if (byType.total > 800 && byType.top && byType.top.share >= 0.5)
    add({ id: "cal-dom", category: "trend", title: `Most of this month's burn came from ${byType.top.label}`,
          body: "Worth knowing where your energy is going.",
          why: `${Math.round(byType.top.share * 100)}% of ${byType.total} kcal over 4 weeks.`,
          impact: 0.35, confidence: 0.6 });

  // easy-pace improving (learned model)
  const hint = paceHint(logs, bounds, 2, doc.settings.easyPace);
  if (hint.learned && hint.n >= 4)
    add({ id: "pace", category: "improvement", title: "Easy pace improving",
          body: "You're running faster at the same easy heart rate — the clearest sign of aerobic fitness.",
          why: `Learned from your last ${hint.n} easy runs.`, impact: 0.6, confidence: 0.6 });

  // gym: planned but not happening, or logged without an effort signal
  const gymPlanned = (doc.settings.weeklyCounts && doc.settings.weeklyCounts.gym > 0) ||
    (doc.weeks || []).some(w => (w.sessions || []).some(s => s.sport === "gym"));
  const recentGym = logs.filter(l => l.sport === "gym" && l.date >= addDays(todayISO, -14));
  if (gymPlanned && recentGym.length === 0)
    add({ id: "gym-gap", category: "recommendation", title: "No gym sessions logged",
          body: "Your plan includes gym work but none is logged in the last two weeks. Open today's workout and run the timer.",
          why: "Strength + mobility protect you as run and ride volume climbs.", impact: 0.5, confidence: 0.6 });
  const gymNoHR = recentGym.filter(l => l.avgHR == null && l.rpe == null);
  if (recentGym.length && gymNoHR.length >= Math.ceil(recentGym.length / 2))
    add({ id: "gym-hr", category: "recommendation", title: "Add heart rate to gym sessions",
          body: "Most recent gym sessions have no HR or RPE, so they count toward time only — not your aerobic/anaerobic balance or training load.",
          why: `${gymNoHR.length} of ${recentGym.length} recent gym logs had no effort signal.`, impact: 0.4, confidence: 0.7 });

  // aerobic Training Effect picture — last ~10 days of cardio sessions
  const teLogs = logs.filter(l => l.date >= addDays(todayISO, -10) &&
    ["run", "trail", "bike", "hike", "gym"].includes(l.sport) && (l.min || 0) >= 15);
  if (teLogs.length >= 3) {
    const tes = teLogs.map(l => effectiveAerobicTE(l, bounds));
    const peak = Math.max(...tes.map(t => t.te));
    const avg = tes.reduce((a, t) => a + t.te, 0) / tes.length;
    const estShare = tes.filter(t => t.estimated).length / tes.length;
    if (peak >= 4.5 && avg >= 3.2)
      add({ id: "te-high", category: "recovery", title: "Big training-effect spikes",
            body: "Several recent sessions hit a high aerobic Training Effect. Make sure an easy day follows each one.",
            why: `Peak ${peak.toFixed(1)}/5, averaging ${avg.toFixed(1)} over ${teLogs.length} sessions.`,
            impact: 0.6, confidence: 0.6 });
    else if (peak < 3 && avg < 2.6)
      add({ id: "te-low", category: "recommendation", title: "Sessions are only maintaining",
            body: "Recent training effect has stayed in the maintaining band — a longer steady effort or some threshold work would nudge it into the impacting zone (3.0+).",
            why: `Top session ${peak.toFixed(1)}/5 across ${teLogs.length} sessions.`,
            impact: 0.55, confidence: 0.6, action: { kind: "addQuality" } });
    if (estShare >= 0.7)
      add({ id: "te-est", category: "recommendation", title: "Training Effect is estimated",
            body: "Most sessions have no Garmin Aerobic TE, so it's estimated from heart rate. Import your Garmin CSV — or enter it when you log — for the real value.",
            why: `${Math.round(estShare * 100)}% of recent sessions had no imported TE.`,
            impact: 0.35, confidence: 0.7 });
  }

  const dismissed = doc.coachDismissed || {};
  return out.filter(i => !dismissed[i.id])
            .sort((a, b) => (b.impact * b.confidence) - (a.impact * a.confidence));
}
