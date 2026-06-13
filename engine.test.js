/* Unit tests for the training engine — run with `node --test`.
   Numbered tests map to TRAINING_APP_SPEC.md §12 acceptance items. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "./engine.js";
import * as F from "./fit.js";

const LAYOUT = { mon: "run", tue: "bike", wed: "run", thu: "bike", fri: "run", sat: "bike-long", sun: "rest" };
const SETTINGS = {
  maxHR: 183, restingHR: null, zoneMethod: "pctmax", lthr: null, customZones: null,
  targetWeightKg: 80, growthRate: 0.07, deloadEvery: 4, hrvBaselineLow: 42, layout: LAYOUT,
};
const total = w => w.targetMin.run + w.targetMin.bike;

/* ---------- dates ---------- */

test("date helpers: snapToMonday, isoWeekId, addDays", () => {
  assert.equal(E.snapToMonday("2026-06-12"), "2026-06-15"); // Fri -> next Mon
  assert.equal(E.snapToMonday("2026-06-15"), "2026-06-15"); // Mon -> itself
  assert.equal(E.isoWeekId("2026-06-15"), "2026-W25");
  assert.equal(E.isoWeekId("2026-01-01"), "2026-W01");
  assert.equal(E.isoWeekId("2025-12-29"), "2026-W01"); // ISO year rollover
  assert.equal(E.addDays("2026-06-28", 3), "2026-07-01");
  assert.equal(E.nextStartDate({ startDate: "2026-06-15" }, "2026-06-21"), "2026-06-22");
  assert.equal(E.nextStartDate({ startDate: "2026-06-15" }, "2026-07-15"), "2026-07-13"); // came back late
});

/* ---------- 1. week 1 matches §7.1 exactly ---------- */

test("acceptance 1: week 1 plan matches the spec table", () => {
  const w = E.generateWeek1("2026-06-15");
  assert.equal(w.id, "2026-W25");
  assert.equal(w.isDeload, false);
  const expect = [
    ["mon", "run", "easy", 35, 2], ["tue", "bike", "easy", 60, 2],
    ["wed", "run", "easy", 35, 2], ["thu", "bike", "easy", 75, 2],
    ["fri", "run", "easy", 35, 2], ["sat", "bike", "long", 120, 2],
    ["sun", "rest", "rest", 0, 0],
  ];
  w.sessions.forEach((s, i) => {
    const [day, sport, kind, min, zone] = expect[i];
    assert.deepEqual([s.day, s.sport, s.kind, s.targetMin, s.zone], [day, sport, kind, min, zone]);
  });
  assert.deepEqual(w.targetMin, { run: 105, bike: 255 });
});

/* ---------- 2. +7 % recommendation, +10 % override, run cap ---------- */

test("acceptance 2: full week + feel 4 recommends +7 %; +10 % override caps run growth", () => {
  const rec = E.recommendRate({ completion: 1.0, feel: 4, hrv7d: null, settings: SETTINGS });
  assert.equal(rec.rate, 0.07);
  assert.equal(rec.noQuality, false);

  const w1 = E.generateWeek1("2026-06-15");
  const w2 = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0.10, settings: SETTINGS,
                              startDate: "2026-06-22", weekNum: 2 });
  assert.ok(w2.targetMin.run <= 105 * 1.10 + 2.5, `run ${w2.targetMin.run} over +10 % cap`);
  assert.ok(Math.abs(total(w2) - 360 * 1.10) <= 7.5, `total ${total(w2)} not ~396`);
  for (const s of w2.sessions) assert.equal(s.targetMin % 5, 0, "sessions round to 5");
});

/* ---------- 3. deload week 4, resume week 5 ---------- */

test("acceptance 3: week 4 deloads at 60 % (long ride ≤ 90); week 5 = week 3 × (1+rate)", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const w2 = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-06-22", weekNum: 2 });
  const w3 = E.planNextWeek({ prevLoadWeek: w2, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-06-29", weekNum: 3 });

  assert.equal(E.isDeloadWeek(4, SETTINGS.deloadEvery), true);
  const w4 = E.deloadWeek({ prevLoadWeek: w3, startDate: "2026-07-06", weekNum: 4 });
  assert.equal(w4.isDeload, true);
  w4.sessions.forEach((s, i) => {
    if (s.sport === "rest") return;
    assert.ok(s.zone <= 2, "deload is all Z2 or below");
    assert.notEqual(s.kind, "quality");
    const sixty = E.round5(w3.sessions[i].targetMin * 0.6);
    const expected = s.kind === "long" ? Math.min(sixty, 90) : sixty;
    assert.equal(s.targetMin, expected);
  });
  const long = w4.sessions.find(s => s.kind === "long");
  assert.ok(long.targetMin <= 90, "deload long ride capped at 90");

  const w5 = E.planNextWeek({ prevLoadWeek: w3, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-07-13", weekNum: 5 });
  assert.ok(Math.abs(total(w5) - total(w3) * 1.07) <= 10, "week 5 resumes from week 3");
  assert.ok(total(w5) > total(w4), "week 5 above deload");
});

test("long ride hard cap at 210 redistributes to other rides", () => {
  const s = E.buildSessions(0, 500, LAYOUT);
  const long = s.find(x => x.kind === "long");
  assert.equal(long.targetMin, 210);
  assert.equal(E.sumSessions(s, "bike"), 500);
});

/* ---------- 4. quality unlock sequence ---------- */

test("acceptance 4: 3 of last 4 weeks ≥ 80 % unlocks run quality; 2 more unlock bike", () => {
  const wk = (completion, feel, isDeload = false) => ({ completion, feel, isDeload });
  let q = E.qualityState([wk(0.85, 3), wk(0.9, 4)]);
  assert.equal(q.run, false);
  assert.equal(q.progress.done, 2); // honest "2 done" copy

  q = E.qualityState([wk(0.85, 3), wk(0.9, 4), wk(0.82, 3)]);
  assert.equal(q.run, true);
  assert.equal(q.bike, false);

  q = E.qualityState([wk(0.85, 3), wk(0.9, 4), wk(0.82, 3), wk(0.9, 3), wk(0.88, 4)]);
  assert.equal(q.bike, true);

  // deload weeks don't count toward (or against) the window
  q = E.qualityState([wk(0.85, 3), wk(0.9, 4), wk(1.0, 3, true), wk(0.82, 3)]);
  assert.equal(q.run, true);

  // a feel=1 inside the window blocks the unlock
  q = E.qualityState([wk(0.85, 3), wk(0.9, 1), wk(0.82, 3), wk(0.95, 4)]);
  assert.equal(q.run, false);
});

test("re-lock after 2 consecutive bad weeks", () => {
  const wk = (completion, feel) => ({ completion, feel, isDeload: false });
  const q = E.qualityState([wk(0.85, 3), wk(0.9, 4), wk(0.82, 3), wk(0.5, 2), wk(0.55, 3)]);
  assert.equal(q.run, false);
  assert.equal(q.bike, false);
});

test("quality slot rotates intervals → tempo → hills; intervals still progress Q1 → Q2", () => {
  const mk = (n, sport) => Array.from({ length: n }, () => ({
    sessions: [{ sport, kind: "quality" }],
  }));
  assert.equal(E.qualityTemplateFor([], "run"), "runQ1");
  assert.equal(E.qualityTemplateFor(mk(1, "run"), "run"), "runTempo");
  assert.equal(E.qualityTemplateFor(mk(2, "run"), "run"), "runHills");
  assert.equal(E.qualityTemplateFor(mk(3, "run"), "run"), "runQ1");  // back to intervals, < 4 done
  assert.equal(E.qualityTemplateFor(mk(6, "run"), "run"), "runQ2");  // interval slot upgraded
  assert.equal(E.qualityTemplateFor([], "bike"), "bikeQ1");
  assert.equal(E.qualityTemplateFor(mk(1, "bike"), "bike"), "bikeClimb");
  assert.equal(E.qualityTemplateFor(mk(4, "bike"), "bike"), "bikeQ2");
});

test("unlocked quality lands on Wednesday run / Thursday ride", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const w = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0.07, settings: SETTINGS,
                             startDate: "2026-06-22", weekNum: 2,
                             quality: { run: true, bike: true } });
  const wed = w.sessions.find(s => s.day === "wed");
  const thu = w.sessions.find(s => s.day === "thu");
  assert.equal(wed.kind, "quality");
  assert.equal(wed.qualityTemplate, "runQ1");
  assert.equal(thu.kind, "quality");
  assert.equal(thu.qualityTemplate, "bikeQ1");
});

/* ---------- 5. bad week: −10 % and quality suppressed ---------- */

test("acceptance 5: completion 0.5 + feel 1 → −10 % and no quality next week", () => {
  const rec = E.recommendRate({ completion: 0.5, feel: 1, hrv7d: null, settings: SETTINGS });
  assert.equal(rec.rate, -0.10);
  assert.equal(rec.noQuality, true);

  const w1 = E.generateWeek1("2026-06-15");
  const w = E.planNextWeek({ prevLoadWeek: w1, chosenRate: rec.rate, settings: SETTINGS,
                             startDate: "2026-06-22", weekNum: 2,
                             quality: { run: true, bike: true }, noQuality: true });
  assert.ok(w.sessions.every(s => s.kind !== "quality"), "quality suppressed");
  assert.ok(total(w) < 360, "volume reduced");
});

test("HRV below baseline caps the recommendation at 0", () => {
  const rec = E.recommendRate({ completion: 1.0, feel: 5, hrv7d: 39, settings: SETTINGS });
  assert.equal(rec.rate, 0);
});

test("middling week repeats: completion 0.75 → 0 %", () => {
  assert.equal(E.recommendRate({ completion: 0.75, feel: 4, hrv7d: null, settings: SETTINGS }).rate, 0);
  assert.equal(E.recommendRate({ completion: 0.95, feel: 2, hrv7d: null, settings: SETTINGS }).rate, 0);
});

/* ---------- 6. zones ---------- */

test("acceptance 6: pctmax matches spec exactly; Karvonen switch changes bounds", () => {
  const pm = E.zoneBounds(SETTINGS);
  assert.deepEqual(pm.map(z => [z.lo, z.hi]),
    [[92, 110], [110, 128], [128, 146], [146, 165], [165, 183]]);

  const kv = E.zoneBounds({ ...SETTINGS, restingHR: 50, zoneMethod: "karvonen" });
  assert.deepEqual(kv[1], { z: 2, lo: 130, hi: 143 }); // 50 + .6/.7 × 133
  assert.notDeepEqual(kv, pm);

  // graceful fallback when method's inputs are missing
  assert.deepEqual(E.zoneBounds({ ...SETTINGS, zoneMethod: "karvonen" }), pm);
});

test("LTHR and custom zone methods (user-editable zones)", () => {
  const lt = E.zoneBounds({ ...SETTINGS, zoneMethod: "lthr", lthr: 160 });
  assert.deepEqual(lt[1], { z: 2, lo: 136, hi: 144 });
  assert.ok(lt[4].hi <= 183, "Z5 capped at maxHR");

  const custom = [{ lo: 90, hi: 112 }, { lo: 112, hi: 130 }, { lo: 130, hi: 148 }, { lo: 148, hi: 166 }, { lo: 166, hi: 183 }];
  const cz = E.zoneBounds({ ...SETTINGS, zoneMethod: "custom", customZones: custom });
  assert.deepEqual(cz.map(z => [z.lo, z.hi]), custom.map(z => [z.lo, z.hi]));
});

/* ---------- 7. mix change ---------- */

test("acceptance 7: 2 runs / 4 rides relayouts with no consecutive runs and scaled minutes", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week, warnings } = E.relayoutWeek({ week: w1, runCount: 2, bikeCount: 4, prevRunMin: 105 });
  assert.deepEqual(warnings, []);
  const runDays = week.sessions.filter(s => s.sport === "run").map(s => s.day);
  const bikeDays = week.sessions.filter(s => s.sport === "bike");
  assert.equal(runDays.length, 2);
  assert.equal(bikeDays.length, 4);
  assert.equal(week.sessions.find(s => s.day === "sun").sport, "rest");
  assert.equal(week.sessions.find(s => s.day === "sat").kind, "long", "long ride stays on Saturday");
  for (let i = 0; i < E.DAYS.length - 1; i++) {
    const a = week.sessions[i], b = week.sessions[i + 1];
    assert.ok(!(a.sport === "run" && b.sport === "run"), "no consecutive runs");
  }
  assert.ok(Math.abs(week.targetMin.run - 105 * 2 / 3) <= 5, "run minutes scale by 2/3");
  assert.ok(Math.abs(week.targetMin.bike - 255 * 4 / 3) <= 5, "bike minutes scale by 4/3");
});

test("4 runs cannot avoid consecutive days → warn, then allow", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week, warnings } = E.relayoutWeek({ week: w1, runCount: 4, bikeCount: 2, prevRunMin: 200 });
  assert.equal(week.sessions.filter(s => s.sport === "run").length, 4);
  assert.ok(warnings.includes("consecutive-runs"));
});

test("layout editor guard finds consecutive run days", () => {
  assert.deepEqual(E.consecutiveRunDays(LAYOUT), []);
  const bad = { ...LAYOUT, sat: "run" };
  assert.deepEqual(E.consecutiveRunDays(bad), [["fri", "sat"]]);
});

/* ---------- 8. pace model ---------- */

test("acceptance 8: seed runs are all too hard to teach the model → cold start", () => {
  const seedish = [
    { date: "2026-06-02", sport: "run", min: 30, km: 5.47, avgHR: 170, source: "seed" },
    { date: "2026-06-05", sport: "run", min: 41, km: 7.04, avgHR: 166, source: "seed" },
    { date: "2026-06-12", sport: "run", min: 42, km: 7.01, avgHR: 167, source: "seed" },
  ];
  const bounds = E.zoneBounds(SETTINGS);
  const hint = E.paceHint(seedish, bounds, 2);
  assert.equal(hint.learned, false);
  assert.deepEqual([hint.lo, hint.hi], [420, 465]); // 7:00–7:45
});

test("3+ easy runs teach a learned estimate at the Z2 midpoint, ±15 s", () => {
  const logs = [
    { date: "2026-06-16", sport: "run", min: 30, km: 4.0, avgHR: 120 }, // 7:30
    { date: "2026-06-18", sport: "run", min: 28, km: 4.0, avgHR: 130 }, // 7:00
    { date: "2026-06-20", sport: "run", min: 29, km: 4.0, avgHR: 125 }, // 7:15
    { date: "2026-06-22", sport: "run", min: 27, km: 4.0, avgHR: 135 }, // 6:45
  ];
  const bounds = E.zoneBounds(SETTINGS); // Z2 mid = 119
  const hint = E.paceHint(logs, bounds, 2);
  assert.equal(hint.learned, true);
  // perfect line: pace = 810 − 3·HR → 453 at 119 bpm
  assert.deepEqual([hint.lo, hint.hi], [438, 468]);
  assert.equal(E.fmtPace(453), "7:33");
});

test("manual easy pace replaces the cold start until the model learns", () => {
  const bounds = E.zoneBounds(SETTINGS);
  const manual = { lo: 390, hi: 420 }; // 6:30–7:00
  const h0 = E.paceHint([], bounds, 2, manual);
  assert.deepEqual([h0.lo, h0.hi, !!h0.manual, h0.learned], [390, 420, true, false]);
  const logs = [
    { date: "2026-06-16", sport: "run", min: 30, km: 4.0, avgHR: 120 },
    { date: "2026-06-18", sport: "run", min: 28, km: 4.0, avgHR: 130 },
    { date: "2026-06-20", sport: "run", min: 29, km: 4.0, avgHR: 125 },
  ];
  const h = E.paceHint(logs, bounds, 2, manual);
  assert.equal(h.learned, true); // 3 qualifying runs → learned beats the setting
  const h4 = E.paceHint([], bounds, 4, manual);
  assert.deepEqual([h4.lo, h4.hi], [325, 355]); // other zones ignore it
});

test("projectWeeks previews 3 weeks at the default rate, deload included", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const w2 = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-06-22", weekNum: 2 });
  const w3 = E.planNextWeek({ prevLoadWeek: w2, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-06-29", weekNum: 3 });
  const proj = E.projectWeeks({ weeks: [w1, w2, w3], settings: SETTINGS });
  assert.deepEqual(proj.map(p => p.weekNum), [4, 5, 6]);
  assert.equal(proj[0].isDeload, true);
  assert.equal(proj[0].startDate, "2026-07-06");
  assert.ok(Math.abs(proj[1].total - total(w3) * 1.07) <= 10); // week 5 grows from week 3, not the deload
  assert.ok(proj[2].total > proj[1].total);
  assert.equal(proj[1].hasQuality, false);
  const projQ = E.projectWeeks({ weeks: [w1, w2, w3], settings: SETTINGS, quality: { run: true, bike: false } });
  assert.equal(projQ[1].hasQuality, true);
  // a faster default rate produces a bigger week 5
  const proj10 = E.projectWeeks({ weeks: [w1, w2, w3], settings: { ...SETTINGS, growthRate: 0.10 } });
  assert.ok(proj10[1].total > proj[1].total);
});

test("short, hard, or HR-less runs never qualify; non-Z2 zones use cold-start", () => {
  const logs = [
    { date: "2026-06-16", sport: "run", min: 15, km: 2, avgHR: 120 },   // too short
    { date: "2026-06-17", sport: "run", min: 40, km: 6, avgHR: 165 },   // too hard
    { date: "2026-06-18", sport: "run", min: 40, km: 6 },               // no HR
    { date: "2026-06-19", sport: "bike", min: 60, km: 25, avgHR: 120 }, // not a run
  ];
  assert.equal(E.qualifyingRuns(logs).length, 0);
  const hint = E.paceHint(logs, E.zoneBounds(SETTINGS), 4);
  assert.deepEqual([hint.lo, hint.hi, hint.learned], [325, 355, false]);
});

/* ---------- 9. Garmin CSV ---------- */

const CSV_HEADER = "Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR,Max HR,Aerobic TE,Avg Run Cadence,Max Run Cadence,Avg Pace,Best Pace,Total Ascent,Total Descent,Avg Stride Length,Training Stress Score®,Steps,Min Temp,Decompression,Best Lap Time,Number of Laps,Max Temp,Moving Time,Elapsed Time,Min Elevation,Max Elevation";
const row = (type, date, title, dist, time, hr) =>
  `${type},${date},false,"${title}","${dist}","450",${time},${hr},176,3.1,160,172,6:01,5:25,"120","118",1.05,"0","6,800",22.0,No,00:05:30,7,28.0,00:40:00,00:43:00,490,560`;

test("acceptance 9: CSV parses, maps sports, strips quoted thousands, dedupes vs seed", () => {
  const csv = [
    CSV_HEADER,
    row("Running", "2026-06-12 08:01:10", "Sierre Running", "7.01", "00:42:10", "167"),
    row("Treadmill Running", "2026-06-13 07:30:00", "Hotel treadmill", "5.00", "00:31:00", "150"),
    row("Cycling", "2026-06-14 09:00:00", "Val d'Anniviers", "1,034.56", "01:30:30", "138"),
    row("Walking", "2026-06-14 18:00:00", "Evening walk", "3.20", "00:45:00", "95"),
  ].join("\n");

  const parsed = E.parseGarminCSV(csv);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.counts, { run: 2, bike: 1, trail: 0, hike: 0, other: 1, bad: 0 });
  const ride = parsed.rows.find(r => r.sport === "bike");
  assert.equal(ride.km, 1034.56, "thousands separator stripped");
  assert.equal(ride.min, 91, "HH:MM:SS → minutes");
  assert.equal(parsed.rows[0].date, "2026-06-12");
  assert.equal(parsed.rows[0].time, "08:01");

  const seedLogs = [{ date: "2026-06-12", sport: "run", min: 42, source: "seed" }];
  const { fresh, dupes } = E.dedupeImports(parsed.rows, seedLogs);
  assert.equal(dupes.length, 1, "same-day same-sport seed run is a duplicate");
  assert.equal(fresh.length, 3);

  // csv-vs-csv: ±10 min window
  const existing = [{ date: "2026-06-14", time: "09:05", sport: "bike", min: 90, source: "csv" }];
  const again = E.dedupeImports(parsed.rows, existing);
  assert.equal(again.dupes.length, 1);
});

test("CSV with wrong shape is rejected gracefully", () => {
  assert.ok(E.parseGarminCSV("foo,bar\n1,2").error);
});

/* ---------- completion & misc ---------- */

test("completion: seed and 'other' excluded, cap at 1.2", () => {
  const w = E.generateWeek1("2026-06-15"); // 360 planned
  const logs = [
    { date: "2026-06-15", sport: "run", min: 35, source: "manual" },
    { date: "2026-06-16", sport: "bike", min: 60, source: "csv" },
    { date: "2026-06-17", sport: "run", min: 35, source: "seed" },   // excluded
    { date: "2026-06-18", sport: "other", min: 120, source: "manual" }, // excluded
    { date: "2026-06-22", sport: "run", min: 35, source: "manual" }, // next week
  ];
  assert.ok(Math.abs(E.weekCompletion(w, logs) - 95 / 360) < 1e-9);
  const big = [{ date: "2026-06-15", sport: "bike", min: 9999, source: "manual" }];
  assert.equal(E.weekCompletion(w, big), 1.2);
});

test("splitMinutes preserves totals in 5-min units", () => {
  assert.deepEqual(E.splitMinutes(105, [1, 1, 1]), [35, 35, 35]);
  assert.deepEqual(E.splitMinutes(255, [1, 1, 2]), [65, 65, 125]);
  assert.equal(E.splitMinutes(112.35, [1, 1, 1]).reduce((a, b) => a + b, 0), 110);
});

test("VO₂ at target weight: 42.8 @ 87.4 kg → 46.8 @ 80 kg", () => {
  assert.equal(E.vo2AtTargetWeight(42.8, 87.4, 80), 46.8);
});

test("weeklyVolume buckets logs into Monday weeks with plan targets", () => {
  const weeks = [E.generateWeek1("2026-06-15")];
  const logs = [
    { date: "2026-06-16", sport: "bike", min: 60, source: "manual" },
    { date: "2026-06-10", sport: "run", min: 42, source: "seed" }, // pre-plan week, still charted
  ];
  const vol = E.weeklyVolume({ logs, weeks, todayISO: "2026-06-19", n: 3 });
  assert.equal(vol.length, 3);
  assert.equal(vol[2].bike, 60);
  assert.equal(vol[2].target, 360);
  assert.equal(vol[1].run, 42);
  assert.equal(vol[1].target, null);
});

test("consistency streak counts completed weeks ≥ 80 %", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const w2 = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0, settings: SETTINGS, startDate: "2026-06-22", weekNum: 2 });
  const logs = [
    { date: "2026-06-15", sport: "run", min: 300, source: "manual" },
    { date: "2026-06-16", sport: "bike", min: 200, source: "manual" },
  ]; // week 1 fully logged, week 2 empty
  const c = E.consistency({ weeks: [w1, w2], logs, todayISO: "2026-07-01" });
  assert.equal(c.cells.length, 2);
  assert.ok(c.cells[0].pct >= 0.8);
  assert.equal(c.streak, 0); // week 2 broke it
});

/* ---------- v1.2: elevation, dedup, rotation, layout ---------- */

const BOUNDS = E.zoneBounds(SETTINGS); // Z2 110–128, Z3 128–146, Z4 146–165, Z5 165–183

test("CSV captures Total Ascent in metres + Max HR", () => {
  const csv = [CSV_HEADER,
    row("Cycling", "2026-06-14 09:00:00", "Climb", "30.0", "01:30:00", "138"),
  ].join("\n");
  // the row() helper puts "120" in Total Ascent and 176 in Max HR
  const ride = E.parseGarminCSV(csv).rows.find(r => r.sport === "bike");
  assert.equal(ride.ascent, 120);
  assert.equal(ride.maxHR, 176);
});

test("age estimates max HR (Tanaka); observed max wins from activities", () => {
  assert.equal(E.estMaxHRFromAge(40), Math.round(208 - 0.7 * 40)); // 180
  assert.equal(E.estMaxHRFromAge(0), null);
  assert.equal(E.observedMaxHR([
    { sport: "run", maxHR: 178 }, { sport: "bike", maxHR: 191 }, { sport: "other", maxHR: 200 },
  ]), 191); // ignores non run/bike
  assert.equal(E.observedMaxHR([{ sport: "run", avgHR: 150 }]), null);
});

test("importMatches keys on duration+distance, not clock time", () => {
  const rows = [
    { date: "2026-07-01", sport: "bike", min: 43, km: 21.8, time: "18:43" }, // matches manual
    { date: "2026-07-01", sport: "bike", min: 120, km: 60, time: "07:00" },  // different ride same day
  ];
  const logs = [{ id: "m1", date: "2026-07-01", sport: "bike", min: 45, km: 22, source: "manual" }];
  const m = E.importMatches(rows, logs);
  assert.equal(m[0].matches.length, 1, "close duration+distance matches the manual log");
  assert.equal(m[0].matches[0].id, "m1");
  assert.equal(m[1].matches.length, 0, "the long ride is not collapsed into it");
});

test("rotation respects allowed families; null when none allowed", () => {
  const noHills = { runIntervals: true, runTempo: false, runHills: false, bikeIntervals: true, bikeClimb: true };
  // run cycle would be intervals→tempo→hills; with only intervals allowed it stays intervals
  assert.equal(E.qualityTemplateFor([], "run", noHills), "runQ1");
  assert.equal(E.qualityTemplateFor([{ sessions: [{ sport: "run", kind: "quality" }] }], "run", noHills), "runQ1");
  const noBike = { bikeIntervals: false, bikeClimb: false };
  assert.equal(E.qualityTemplateFor([], "bike", noBike), null);
});

test("placeLayout honours a non-Sunday rest day with no back-to-back runs", () => {
  const lay = E.placeLayout(3, 3, "wed"); // Wednesday off; returns day→[sports]
  assert.deepEqual(lay.wed, ["rest"]);
  const flat = Object.values(lay).flat();
  assert.equal(flat.filter(v => v === "run").length, 3);
  assert.equal(flat.filter(v => v === "bike" || v === "bike-long").length, 3);
  const oneADay = {}; E.DAYS.forEach(d => { oneADay[d] = lay[d][0]; }); // 6 sessions = one/day
  assert.equal(E.consecutiveRunDays(oneADay).length, 0, "no two runs on consecutive days");
  assert.ok(flat.includes("bike-long"));
});

test("placeLayout puts a 7th/8th session as a two-a-day on a fresh day, not by the long ride", () => {
  const lay = E.placeLayout(4, 4, "sun"); // 8 sessions over 6 active days → 2 doubles
  const trainingSlots = Object.values(lay).flat().filter(v => v !== "rest").length;
  assert.equal(trainingSlots, 8, "4 runs + 4 rides placed");
  const doubleDays = E.DAYS.filter(d => lay[d].length === 2 && !lay[d].includes("rest"));
  assert.ok(doubleDays.length >= 1, "at least one two-a-day");
  const longDay = E.DAYS.find(d => lay[d].includes("bike-long"));
  // the extra session should not pile onto the long-ride day
  assert.ok(!doubleDays.includes(longDay), "extra not stacked on the long-ride day");
});

test("relayoutWeek reflows around a moved rest day", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week } = E.relayoutWeek({ week: w1, runCount: 3, bikeCount: 3, restDay: "mon" });
  assert.equal(week.sessions.find(s => s.day === "mon").sport, "rest");
  assert.equal(week.targetMin.run + week.targetMin.bike > 0, true);
});

test("climbTargetAscent ramps with load and rounds to 50 m", () => {
  const s = { climbBaseAscent: 500 };
  assert.equal(E.climbTargetAscent({ weekNum: 1, settings: s }), 500);
  assert.equal(E.climbTargetAscent({ weekNum: 5, settings: s }), 550); // +5% block (525), rounded to 50
  const floored = E.climbTargetAscent({ weekNum: 1, settings: s,
    logs: [{ sport: "bike", ascent: 1000 }] });
  assert.equal(floored, 800, "floored at 80% of a recent big climb");
});

/* ---------- v1.2: intensity, load, efficiency, RPE ---------- */

test("intensityOfLog by HR zone, falling back to type", () => {
  assert.equal(E.intensityOfLog({ avgHR: 120 }, BOUNDS), "aerobic");   // Z2
  assert.equal(E.intensityOfLog({ avgHR: 140 }, BOUNDS), "threshold"); // Z3
  assert.equal(E.intensityOfLog({ avgHR: 170 }, BOUNDS), "anaerobic"); // Z5
  assert.equal(E.intensityOfLog({ type: "intervals" }, BOUNDS), "anaerobic");
  assert.equal(E.intensityOfLog({ type: "long" }, BOUNDS), "aerobic");
});

test("weeklyIntensity reports the 80/20 split", () => {
  const logs = [
    { date: "2026-06-15", sport: "run", min: 80, avgHR: 120, source: "manual" }, // aerobic
    { date: "2026-06-17", sport: "run", min: 20, avgHR: 170, source: "manual" }, // anaerobic
  ];
  const wi = E.weeklyIntensity({ logs, bounds: BOUNDS, todayISO: "2026-06-21", n: 1 })[0];
  assert.equal(wi.total, 100);
  assert.ok(Math.abs(wi.easyPct - 0.8) < 1e-9);
  assert.ok(Math.abs(wi.hardPct - 0.2) < 1e-9);
});

test("trainingLoad: a spike reads high-risk, a lull undertraining", () => {
  const spike = [];
  for (let d = 1; d <= 28; d++) {
    const date = `2026-06-${String(d).padStart(2, "0")}`;
    // light for 3 weeks, then a big final week
    const min = d > 21 ? 120 : 20;
    spike.push({ date, sport: "bike", min, rpe: 7, source: "manual" });
  }
  const tl = E.trainingLoad({ logs: spike, bounds: BOUNDS, todayISO: "2026-06-28" });
  assert.ok(tl.acwr > 1.5, `acwr ${tl.acwr}`);
  assert.equal(tl.status, "high-risk");

  const lull = [{ date: "2026-06-01", sport: "bike", min: 120, rpe: 7, source: "manual" }];
  const tl2 = E.trainingLoad({ logs: lull, bounds: BOUNDS, todayISO: "2026-06-28" });
  assert.equal(tl2.acwr, 0); // nothing acute, some chronic → undertraining
  assert.equal(tl2.status, "undertraining");
});

test("sessionEfficiency uses speed for runs and VAM for climbs", () => {
  const run = E.sessionEfficiency({ sport: "run", km: 10, min: 50, rpe: 5 }); // 12 km/h ÷ 5
  assert.equal(run.kind, "speed");
  assert.ok(Math.abs(run.value - 12 / 5) < 1e-9);
  const climb = E.sessionEfficiency({ sport: "bike", type: "climb", ascent: 600, min: 60, rpe: 6 });
  assert.equal(climb.kind, "vam"); // 600 m/h ÷ 6
  assert.ok(Math.abs(climb.value - 100) < 1e-9);
});

test("expectedRPE preset refines by history; deviation bands are context-aware", () => {
  const logs = [{ type: "interval-stub" }];
  // RPE 8 on an interval session is normal (preset 8) → yellow
  assert.equal(E.rpeDeviation({ type: "intervals", rpe: 8 }, logs).band, "yellow");
  // RPE 8 on a recovery ride (preset 3) → red
  assert.equal(E.rpeDeviation({ type: "recovery", rpe: 8 }, logs).band, "red");
  // an easy session that felt very light → green
  assert.equal(E.rpeDeviation({ type: "easy", rpe: 2 }, logs).band, "green");
});

test("evaluateSession flags an easy run done too hot", () => {
  const e = E.evaluateSession({ sport: "run", type: "easy", min: 35, km: 5, avgHR: 150 },
    { bounds: BOUNDS, logs: [] });
  assert.equal(e.intensity, "anaerobic"); // 150 = Z4
  assert.match(e.verdict, /hot/);
});

/* ---------- v1.2: personal bests & coach ---------- */

test("personalBests auto-derives records and manual entries win only when better", () => {
  const logs = [
    { id: "a", date: "2026-06-01", sport: "bike", km: 30, ascent: 800, min: 120 },
    { id: "b", date: "2026-06-08", sport: "bike", km: 42, ascent: 600, min: 150 },
    { id: "c", date: "2026-06-10", sport: "run", km: 10.1, min: 50 }, // ~10K
  ];
  const pbs = E.personalBests({ logs });
  const ascent = pbs.find(p => p.key === "biggestAscent");
  assert.equal(ascent.value, 800);
  const longestRide = pbs.find(p => p.key === "longestRide");
  assert.equal(longestRide.value, 42);
  assert.ok(pbs.find(p => p.key === "run10k"), "a ~10K run sets the 10K record");

  const withManual = E.personalBests({ logs, manualBests: [{ key: "biggestAscent", value: 1500, date: "2024-01-01" }] });
  assert.equal(withManual.find(p => p.key === "biggestAscent").value, 1500);
  const worse = E.personalBests({ logs, manualBests: [{ key: "biggestAscent", value: 100, date: "2024-01-01" }] });
  assert.equal(worse.find(p => p.key === "biggestAscent").value, 800, "a worse manual entry doesn't override");
});

test("coachInsights fires categories with a why, stays quiet on no data, and carries actions", () => {
  assert.deepEqual(E.coachInsights({ doc: { logs: [], weeks: [], settings: SETTINGS }, todayISO: "2026-06-21" }), []);

  const doc = {
    settings: SETTINGS, weeks: [], coachDismissed: {},
    vo2History: [{ date: "2026-04-01", value: 42 }, { date: "2026-06-01", value: 45 }],
    logs: [], manualBests: [],
  };
  const ins = E.coachInsights({ doc, todayISO: "2026-06-12" });
  const vo2 = ins.find(i => i.id === "vo2");
  assert.ok(vo2 && vo2.why && vo2.category === "improvement", "VO₂ gain surfaces with a why");

  // an overreaching block should yield a recovery action
  const logs = [];
  for (let d = 1; d <= 28; d++)
    logs.push({ date: `2026-06-${String(d).padStart(2, "0")}`, sport: "bike",
                min: d > 21 ? 150 : 15, rpe: 7, source: "manual" });
  const hot = E.coachInsights({ doc: { ...doc, logs }, todayISO: "2026-06-28" });
  const rec = hot.find(i => i.action && i.action.kind === "insertRecoveryDay");
  assert.ok(rec && rec.category === "recovery", "load spike → recovery action");
});

/* ---------- v1.3: trail/hike, calories, range, adherence, FIT ---------- */

test("trail counts as run for plan volume; hike does not", () => {
  const w = E.generateWeek1("2026-06-15"); // Monday plans a 35-min run
  assert.ok(E.loggedMinutes(w, [{ date: "2026-06-15", sport: "trail", min: 35, source: "manual" }]) >= 35);
  assert.equal(E.loggedMinutes(w, [{ date: "2026-06-15", sport: "hike", min: 120, source: "manual" }]), 0);
  assert.equal(E.isRunType("trail"), true);
  assert.equal(E.isRunType({ sport: "hike" }), false);
});

test("CSV captures calories + descent and maps trail/hike", () => {
  // the standard row() helper sets Calories=450, Total Ascent=120, Total Descent=118
  const csv = [CSV_HEADER,
    row("Trail Running", "2026-06-12 08:00:00", "Trail", "12.0", "01:30:00", "150"),
    row("Hiking", "2026-06-10 08:00:00", "Hike", "9.0", "02:00:00", "120"),
  ].join("\n");
  const p = E.parseGarminCSV(csv);
  const trail = p.rows.find(r => r.sport === "trail");
  assert.equal(trail.descent, 118);
  assert.equal(trail.calories, 450);
  assert.equal(p.rows.find(r => r.sport === "hike").sport, "hike");
});

test("classifyImport adds new rows, gap-fills matches, leaves complete ones", () => {
  const rows = [
    { date: "2026-07-01", sport: "bike", min: 60, km: 22, time: "08:00", calories: 800, maxHR: 171 }, // fills c1
    { date: "2026-07-02", sport: "run", min: 35, km: 5, time: "09:00", calories: 400 },               // c2 complete
    { date: "2026-07-03", sport: "bike", min: 90, km: 40 },                                            // new
  ];
  const logs = [
    { id: "c1", date: "2026-07-01", sport: "bike", min: 60, km: 22, source: "csv" }, // missing calories + maxHR
    { id: "c2", date: "2026-07-02", sport: "run", min: 35, km: 5, calories: 400, maxHR: 160, time: "09:00", source: "csv" },
  ];
  const c = E.classifyImport(rows, logs);
  assert.equal(c.fresh.length, 1);
  assert.equal(c.enrich.length, 1);
  assert.equal(c.enrich[0].fill.calories, 800, "fills missing calories");
  assert.equal(c.enrich[0].fill.maxHR, 171, "fills missing max HR");
  assert.equal(c.unchanged.length, 1);
  // a manual log's own data (note/RPE/type) is never overwritten
  const manual = E.classifyImport([{ date: "2026-07-04", sport: "run", min: 30, km: 5, calories: 300 }],
    [{ id: "m1", date: "2026-07-04", sport: "run", min: 30, km: 5, note: "mine", rpe: 6, source: "manual" }]);
  assert.equal(manual.enrich[0].fill.calories, 300);
  assert.equal(manual.enrich[0].fill.note, undefined, "keeps the manual note");
});

test("calorie aggregations: weekly total and dominant sport", () => {
  const logs = [
    { date: "2026-06-15", sport: "run", min: 40, calories: 500, source: "manual" },
    { date: "2026-06-16", sport: "bike", min: 60, calories: 800, source: "manual" },
  ];
  assert.equal(E.weeklyCalories({ logs, todayISO: "2026-06-21", n: 1 })[0].total, 1300);
  const bt = E.caloriesByType({ logs, todayISO: "2026-06-21", n: 1 });
  assert.equal(bt.total, 1300);
  assert.equal(bt.top.sport, "bike");
});

test("rangeWindow: 4-week window, Monday-aligned, with previous period + offset", () => {
  const r = E.rangeWindow({ preset: "4w", offset: 0 }, "2026-06-17");
  assert.equal(E.dayIndex(r.from), 0); // Monday
  assert.equal(Math.round((E.parseISO(r.to) - E.parseISO(r.from)) / 864e5) + 1, 28);
  assert.equal(r.prevTo, E.addDays(r.from, -1));
  const r2 = E.rangeWindow({ preset: "4w", offset: 1 }, "2026-06-17");
  assert.equal(r2.to, E.addDays(r.to, -28));
});

test("programAdherence: kept days streak; a missed session breaks it", () => {
  const w = E.generateWeek1("2026-06-15");
  const logs = [];
  for (const s of w.sessions) if (s.sport !== "rest")
    logs.push({ date: E.dateOfDay(w, s.day), sport: s.sport, min: s.targetMin, source: "manual" });
  const a = E.programAdherence({ weeks: [w], logs, todayISO: "2026-06-22" });
  assert.ok(a.current >= 7, `streak ${a.current}`); // 6 sessions + the respected rest
  assert.equal(a.missed, 0);
  const a2 = E.programAdherence({ weeks: [w], logs: logs.filter(l => l.date !== "2026-06-17"), todayISO: "2026-06-22" });
  assert.ok(a2.missed >= 1);
});

test("workoutSteps expand intervals; easy is one block; FIT encodes a valid file", () => {
  const iv = E.workoutSteps({ sport: "run", kind: "quality", qualityTemplate: "runQ1", targetMin: 35, zone: 4 }, BOUNDS);
  assert.equal(iv.length, 5);
  assert.equal(iv[0].intensity, "warmup");
  assert.equal(iv[3].type, "repeat");
  assert.equal(iv[3].count, 8);
  assert.ok(iv[1].hrLo > 100);
  const easy = E.workoutSteps({ sport: "run", kind: "easy", targetMin: 40, zone: 2 }, BOUNDS);
  assert.equal(easy.length, 1);
  assert.equal(easy[0].seconds, 2400);

  const bytes = F.encodeWorkout({ name: "Speed repeats", sport: "run", steps: iv });
  assert.ok(bytes.length > 60);
  assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), ".FIT");
  assert.equal((bytes[12] | (bytes[13] << 8)), F.fitCRC(bytes, 0, 12), "header CRC");
  assert.equal((bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)), F.fitCRC(bytes, 0, bytes.length - 2), "file CRC");
});

test("fmtBestValue formats time / distance / metres", () => {
  assert.equal(E.fmtBestValue({ unit: "time", value: 1350 }), "22:30");
  assert.equal(E.fmtBestValue({ unit: "km", value: 70.71 }), "70.7 km");
  assert.equal(E.fmtBestValue({ unit: "m", value: 1240 }), "1240 m");
});
