/* Unit tests for the training engine — run with `node --test`.
   Numbered tests map to TRAINING_APP_SPEC.md §12 acceptance items. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "./engine.js";
import * as F from "./fit.js";
import * as S from "./store.js";

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
  assert.deepEqual(w.targetMin, { run: 105, bike: 255, gym: 0 });
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
  const s = E.buildSessions(0, 500, 0, LAYOUT);
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
  assert.equal(E.qualityTemplateFor(mk(1, "bike"), "bike"), "bikeSprint"); // bike cycle: intervals→sprint→climb
  assert.equal(E.qualityTemplateFor(mk(2, "bike"), "bike"), "bikeClimb");
  assert.equal(E.qualityTemplateFor(mk(6, "bike"), "bike"), "bikeQ2");     // interval slot upgraded
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
  assert.deepEqual(parsed.counts, { run: 2, bike: 1, trail: 0, hike: 0, swim: 0, other: 1, bad: 0 });
  const ride = parsed.rows.find(r => r.sport === "bike");
  assert.equal(ride.km, 1034.56, "thousands separator stripped");
  assert.equal(ride.min, 91, "HH:MM:SS → minutes");
  assert.equal(parsed.rows[0].date, "2026-06-12");
  assert.equal(parsed.rows[0].time, "08:01");
  assert.equal(parsed.rows[0].aerobicTE, 3.1, "Aerobic TE column parsed");

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

test("import backfills Aerobic TE onto a log that lacks it, never overwriting a manual one", () => {
  const have = { date: "2026-06-12", sport: "run", min: 42, aerobicTE: 2.0 };
  const miss = { date: "2026-06-12", sport: "run", min: 42 };
  const row = { km: 7, aerobicTE: 3.1 };
  assert.equal(E.fillableFields(have, row).aerobicTE, undefined, "manual TE preserved");
  assert.equal(E.fillableFields(miss, row).aerobicTE, 3.1, "missing TE filled");
});

test("mondayOf back-snaps to this week's Monday; CSV overrides map unknown types", () => {
  assert.equal(E.mondayOf("2026-06-17"), "2026-06-15"); // Wed → this Mon
  assert.equal(E.mondayOf("2026-06-15"), "2026-06-15"); // Mon → itself
  const csv = [CSV_HEADER, row("Cardio", "2026-06-12 08:00:00", "Gym sesh", "0.00", "00:45:00", "120")].join("\n");
  assert.equal(E.parseGarminCSV(csv).rows[0].sport, "other", "unknown type → other by default");
  assert.equal(E.parseGarminCSV(csv, { Cardio: "gym" }).rows[0].sport, "gym", "override → gym");
});

test("targetBands auto-derives from plan; applyTargetsToPlan / restorePlan round-trip", () => {
  const week = { startDate: "2026-06-15", targetMin: { run: 110, bike: 240, gym: 0 }, sessions: [
    { day: "mon", sport: "run", targetMin: 55 }, { day: "wed", sport: "run", targetMin: 55 },
    { day: "tue", sport: "bike", targetMin: 120 }, { day: "thu", sport: "bike", targetMin: 120 }] };
  const settings = { weeklyTargets: { run: null, bike: null, trail: null, hike: null, gym: null }, targetRangePct: 15 };
  const b = E.targetBands(week, settings, { runPace: 5.5, rideKmh: 24 });
  assert.ok(Math.abs(b.run.target - 110 / 5.5) < 0.01, "run km = min/pace");
  assert.ok(b.run.lo < b.run.target && b.run.hi > b.run.target, "±band");
  // override run to 30 km and apply
  const doc = { weeks: [JSON.parse(JSON.stringify(week))] };
  const before = JSON.stringify(doc.weeks);
  const s2 = { ...settings, weeklyTargets: { ...settings.weeklyTargets, run: 30 }, planFollowsTargets: false };
  E.applyTargetsToPlan(doc, s2, "2026-06-17", { runPace: 5.5, rideKmh: 24 });
  assert.ok(doc.weeks[0].targetMin.run > 110, "run minutes raised toward 30 km");
  assert.equal(s2.planFollowsTargets, true);
  E.restorePlan(doc, s2);
  assert.equal(before, JSON.stringify(doc.weeks), "restore is exact");
  assert.equal(s2.planFollowsTargets, false);
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
  const noBike = { bikeIntervals: false, bikeSprint: false, bikeClimb: false };
  assert.equal(E.qualityTemplateFor([], "bike", noBike), null);
});

test("placeLayout honours a non-Sunday rest day with no back-to-back runs", () => {
  const lay = E.placeLayout({ run: 3, bike: 3, restDay: "wed" }); // Wednesday off; returns day→[sports]
  assert.deepEqual(lay.wed, ["rest"]);
  const flat = Object.values(lay).flat();
  assert.equal(flat.filter(v => v === "run").length, 3);
  assert.equal(flat.filter(v => v === "bike" || v === "bike-long").length, 3);
  const oneADay = {}; E.DAYS.forEach(d => { oneADay[d] = lay[d][0]; }); // 6 sessions = one/day
  assert.equal(E.consecutiveRunDays(oneADay).length, 0, "no two runs on consecutive days");
  assert.ok(flat.includes("bike-long"));
});

test("placeLayout puts a 7th/8th session as a two-a-day on a fresh day, not by the long ride", () => {
  const lay = E.placeLayout({ run: 4, bike: 4, restDay: "sun" }); // 8 sessions over 6 active days → 2 doubles
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

test("climbTargetAscent sport param reads trail history and ignores other sports", () => {
  const s = { climbBaseAscent: 500 };
  const logs = [{ sport: "trail", ascent: 900 }, { sport: "bike", ascent: 2000 }];
  assert.equal(E.climbTargetAscent({ weekNum: 1, settings: s, sport: "trail", logs }), 700, "80% of the 900 m trail climb");
  assert.equal(E.climbTargetAscent({ weekNum: 1, settings: s, logs }), 1600, "default bike still reads bike (80% of 2000)");
  assert.equal(E.climbTargetAscent({ weekNum: 1, settings: s, sport: "trail", logs: [{ sport: "bike", ascent: 2000 }] }), 500, "no trail history → base");
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

test("swim: Garmin import maps to metres + venue, and longestSwim PB renders in m", () => {
  const csv = "Activity Type,Date,Time,Distance,Avg HR\n" +
    "Pool Swim,2026-06-01 07:00:00,00:35:00,1.50,132\n" +
    "Open Water Swimming,2026-06-08 08:00:00,00:40:00,1800,140\n";
  const rows = E.parseGarminCSV(csv).rows;
  const pool = rows.find(r => r.activityType === "Pool Swim");
  const ow = rows.find(r => r.activityType === "Open Water Swimming");
  assert.equal(pool.sport, "swim"); assert.equal(pool.m, 1500, "1.50 km → 1500 m"); assert.equal(pool.km, undefined);
  assert.equal(pool.venue, "pool");
  assert.equal(ow.m, 1800, "1800 already in metres"); assert.equal(ow.venue, "open");
  const pbs = E.personalBests({ logs: [{ id: "s1", date: "2026-06-01", sport: "swim", m: 1500, min: 35 }, { id: "s2", date: "2026-06-08", sport: "swim", m: 1800, min: 40 }] });
  const ls = pbs.find(p => p.key === "longestSwim");
  assert.ok(ls && ls.value === 1800 && ls.unit === "m");
  assert.equal(E.fmtBestValue(ls), "1800 m");
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

test("coachInsights surfaces aerobic Training Effect coaching", () => {
  const base = { settings: SETTINGS, weeks: [], coachDismissed: {}, vo2History: [], manualBests: [] };
  const hi = [];
  for (let d = 18; d <= 27; d += 3) hi.push({ id: "h" + d, date: `2026-06-${d}`, sport: "run", min: 90, avgHR: 175, source: "manual" });
  assert.ok(E.coachInsights({ doc: { ...base, logs: hi }, todayISO: "2026-06-28" }).find(i => i.id === "te-high"),
    "repeated high-TE sessions → recovery nudge");

  const lo = [];
  for (let d = 18; d <= 27; d += 3) lo.push({ id: "l" + d, date: `2026-06-${d}`, sport: "run", type: "easy", min: 30, avgHR: 120, source: "manual" });
  const teLo = E.coachInsights({ doc: { ...base, logs: lo }, todayISO: "2026-06-28" }).find(i => i.id === "te-low");
  assert.ok(teLo && teLo.action && teLo.action.kind === "addQuality", "maintaining-only TE → add quality");
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

/* ---------- v1.4: seed counts, buckets, load focus, VO₂ category ---------- */

test("descriptive analytics now count seed/imported history (the load bug)", () => {
  const logs = [
    { date: "2026-06-01", sport: "bike", min: 90, avgHR: 125, source: "seed" },
    { date: "2026-06-03", sport: "run", min: 40, avgHR: 150, source: "csv" },
  ];
  const tl = E.trainingLoad({ logs, bounds: BOUNDS, todayISO: "2026-06-05", n: 2 });
  assert.ok(tl.weeks.some(w => w.load > 0), "seed/csv activities produce load");
  const wi = E.weeklyIntensity({ logs, bounds: BOUNDS, todayISO: "2026-06-05", n: 2 });
  assert.ok(wi.some(w => w.total > 0), "seed/csv count toward intensity");
});

test("bucketize: weeks vs calendar months", () => {
  const wk = E.bucketize("2026-05-04", "2026-05-31", "week");
  assert.equal(E.dayIndex(wk[0].start), 0); // Monday
  assert.ok(wk.length >= 4);
  const mo = E.bucketize("2026-03-10", "2026-06-05", "month");
  assert.deepEqual(mo.map(b => b.label), ["Mar", "Apr", "May", "Jun"]);
  assert.equal(mo[0].start, "2026-03-01");
});

test("loadFocus splits into low/high/anaerobic with an optimal range", () => {
  const logs = [
    { date: "2026-06-01", sport: "bike", min: 120, avgHR: 120, source: "csv" }, // Z2 → low
    { date: "2026-06-02", sport: "run", min: 40, avgHR: 150, source: "csv" },   // Z4 → high
    { date: "2026-06-03", sport: "run", min: 20, avgHR: 175, source: "csv" },   // Z5 → anaerobic
  ];
  const lf = E.loadFocus(logs, BOUNDS, "2026-06-01", "2026-06-07");
  assert.ok(lf.low > 0 && lf.high > 0 && lf.anaerobic > 0);
  assert.ok(lf.total === lf.low + lf.high + lf.anaerobic);
  assert.ok(lf.opt.low[1] > lf.opt.low[0]);
});

test("vo2Category: 43 for a 35-yr-old man is 'Fair'", () => {
  const c = E.vo2Category(43, 35, "male");
  assert.equal(c.label, "Fair");
  assert.equal(c.bracketLabel, "30–39");
  assert.ok(c.pos > 0 && c.pos < 1);
  assert.equal(E.vo2Category(58, 35, "male").label, "Superior");
  assert.equal(E.vo2Category(43, null, "male"), null); // needs age + sex
});

test("distanceSplit: long vs regular by distance, untyped imports included", () => {
  const logs = [
    { date: "2026-06-01", sport: "run", km: 5, min: 30 },
    { date: "2026-06-03", sport: "run", km: 5.2, min: 31 },
    { date: "2026-06-05", sport: "run", km: 5.1, min: 30 },
    { date: "2026-06-07", sport: "run", km: 12, min: 75 }, // clearly the long one
    { date: "2026-06-08", sport: "bike", km: 40, min: 90 },
  ];
  const d = E.distanceSplit(logs, "run", "2026-06-01", "2026-06-30");
  assert.equal(d.long.length, 1);
  assert.equal(d.long[0].km, 12);
  assert.equal(d.regular.length, 3);
  assert.ok(d.threshold > 5 && d.threshold < 12);
  // an explicit long tag wins even when the distance is modest
  const tagged = E.distanceSplit(
    [{ date: "2026-06-01", sport: "run", km: 6, min: 40, type: "long" },
     { date: "2026-06-02", sport: "run", km: 6, min: 40 },
     { date: "2026-06-03", sport: "run", km: 6, min: 40 },
     { date: "2026-06-04", sport: "run", km: 6, min: 40 }],
    "run", "2026-06-01", "2026-06-30");
  assert.ok(tagged.long.some(l => l.km === 6));
});

/* ================= gym activity (v1.5) ================= */

// settings.layout is kept in sync with weeklyCounts (incl. gym) by the app
const GYM_LAYOUT = E.placeLayout({ run: 3, bike: 2, gym: 2, restDay: "sun" });
const GYM_SETTINGS = { ...SETTINGS, layout: GYM_LAYOUT, gymVenueDefault: "home", allowedTypes: { gymStrength: true } };

test("placeLayout schedules 3 streams and realizes the requested counts", () => {
  const lay = E.placeLayout({ run: 2, bike: 3, gym: 2, restDay: "sun" });
  const flat = Object.values(lay).flat();
  assert.equal(flat.filter(v => v === "run").length, 2, "2 runs");
  assert.equal(flat.filter(v => v === "bike" || v === "bike-long").length, 3, "3 rides");
  assert.equal(flat.filter(v => v === "gym").length, 2, "2 gyms");
  assert.deepEqual(lay.sun, ["rest"]);
  const oneADay = {}; E.DAYS.forEach(d => { oneADay[d] = lay[d][0]; });
  assert.equal(E.consecutiveRunDays(oneADay).length, 0, "no back-to-back runs");
});

test("placeLayout extras realize counts when total exceeds active days (bugfix)", () => {
  const lay = E.placeLayout({ run: 3, bike: 3, gym: 2, restDay: "sun" }); // 8 over 6 days
  const flat = Object.values(lay).flat();
  assert.equal(flat.filter(v => v === "run").length, 3);
  assert.equal(flat.filter(v => v === "bike" || v === "bike-long").length, 3);
  assert.equal(flat.filter(v => v === "gym").length, 2);
  assert.equal(flat.filter(v => v !== "rest").length, 8, "all 8 sessions placed");
});

test("buildSessions emits gym sessions snapped to template durations", () => {
  const lay = { mon: "run", tue: "gym", wed: "bike", thu: "gym", fri: "run", sat: "bike-long", sun: "rest" };
  const s = E.buildSessions(70, 200, 95, lay, { gymVenue: "home", weekSalt: "2026-06-15" });
  const gyms = s.filter(x => x.sport === "gym");
  assert.equal(gyms.length, 2);
  for (const g of gyms) {
    assert.ok(E.GYM_DURATIONS.includes(g.targetMin), `gym ${g.targetMin} snapped`);
    assert.equal(g.venue, "home");
    assert.ok(g.gym && typeof g.gym.seed === "number");
    assert.equal(g.zone, undefined, "gym has no zone");
  }
});

test("snapGymMinutes clamps to the template set", () => {
  assert.equal(E.snapGymMinutes(33), 30);
  assert.equal(E.snapGymMinutes(50), 45);
  assert.equal(E.snapGymMinutes(200), 90);
  assert.equal(E.snapGymMinutes(10), 30);
  assert.equal(E.snapGymMinutes(0), 0);
});

test("planNextWeek grows gym capped at +10%, bike absorbs remainder; no-gym unchanged", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week: wg } = E.relayoutWeek({ week: w1, runCount: 3, bikeCount: 2, gymCount: 2, gymVenue: "home" });
  assert.ok(wg.targetMin.gym > 0, "gym introduced");
  const w2 = E.planNextWeek({ prevLoadWeek: wg, chosenRate: 0.07, settings: GYM_SETTINGS, startDate: "2026-06-22", weekNum: 2 });
  assert.ok(w2.targetMin.gym <= wg.targetMin.gym * 1.10 + 7.5, "gym capped at +10%");
  assert.ok(w2.targetMin.run <= wg.targetMin.run * 1.10 + 2.5, "run capped at +10%");
  const t = w => w.targetMin.run + w.targetMin.bike + w.targetMin.gym;
  assert.ok(Math.abs(t(w2) - t(wg) * 1.07) <= 12, "total grows ~7%");
  const noGym = E.planNextWeek({ prevLoadWeek: w1, chosenRate: 0.07, settings: SETTINGS, startDate: "2026-06-22", weekNum: 2 });
  assert.equal(noGym.targetMin.gym, 0, "no-gym week stays gym-free");
});

test("deloadWeek scales gym to 60% (snapped, no zone), keeps it easy and preserves venue", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week: wg } = E.relayoutWeek({ week: w1, runCount: 3, bikeCount: 2, gymCount: 2, gymVenue: "gym" });
  const d = E.deloadWeek({ prevLoadWeek: wg, startDate: "2026-07-06", weekNum: 4 });
  const gyms = d.sessions.filter(s => s.sport === "gym");
  assert.ok(gyms.length >= 1);
  for (const g of gyms) {
    assert.equal(g.kind, "easy");
    assert.ok(E.GYM_DURATIONS.includes(g.targetMin));
    assert.equal(g.venue, "gym", "venue preserved");
    assert.equal(g.zone, undefined);
  }
});

test("plannedMinutes & loggedMinutes count gym; a no-HR gym still counts as volume", () => {
  const w1 = E.generateWeek1("2026-06-15");
  const { week: wg } = E.relayoutWeek({ week: w1, runCount: 2, bikeCount: 2, gymCount: 2, gymVenue: "home" });
  assert.ok(E.plannedMinutes(wg) >= wg.targetMin.run + wg.targetMin.bike, "gym included in planned");
  const logs = [{ date: "2026-06-16", sport: "gym", min: 45, source: "manual" }];
  assert.ok(E.loggedMinutes(wg, logs) >= 45, "no-HR gym counts as logged time");
});

test("sessionLoad (TRIMP): gym needs heart rate; RPE no longer counts toward load", () => {
  assert.equal(E.sessionLoad({ sport: "gym", min: 45 }, BOUNDS), 0);
  assert.equal(E.sessionLoad({ sport: "gym", min: 45, rpe: 7 }, BOUNDS), 0, "RPE alone no longer makes gym load");
  assert.ok(E.sessionLoad({ sport: "gym", min: 45, avgHR: 150 }, BOUNDS) > 0);
  // a run without HR still earns a type-based estimate (RPE ignored)
  assert.ok(E.sessionLoad({ sport: "run", type: "easy", min: 40 }, BOUNDS) > 0);
});

test("TRIMP weights intensity non-linearly: hard-short beats easy-long", () => {
  const easyLong = E.sessionLoad({ sport: "run", min: 60, avgHR: 120 }, BOUNDS);
  const hardShort = E.sessionLoad({ sport: "run", min: 45, avgHR: 175 }, BOUNDS);
  assert.ok(hardShort > easyLong, `hard 45min (${hardShort}) should beat easy 60min (${easyLong})`);
});

test("loadCurve's last point matches the trainingLoad chip", () => {
  const logs = [];
  for (let k = 0; k < 30; k++) logs.push({ id: "l" + k, date: E.addDays("2026-06-28", -k), sport: "run", type: "easy", min: 50, avgHR: 140 });
  const today = "2026-06-28";
  const tl = E.trainingLoad({ logs, bounds: BOUNDS, todayISO: today });
  const curve = E.loadCurve(logs, BOUNDS, E.addDays(today, -20), today, today);
  const last = curve[curve.length - 1];
  assert.equal(last.date, today);
  assert.equal(last.acute, tl.acute, "curve acute == chip acute");
  assert.equal(last.current, true);
});

test("effectiveAerobicTE prefers the real value, else a labeled estimate", () => {
  assert.deepEqual(E.effectiveAerobicTE({ sport: "run", min: 60, avgHR: 150, aerobicTE: 3.4 }, BOUNDS),
    { te: 3.4, estimated: false });
  const est = E.effectiveAerobicTE({ sport: "run", type: "intervals", min: 45, avgHR: 165 }, BOUNDS);
  assert.equal(est.estimated, true);
  assert.ok(est.te > 0 && est.te <= 5);
  assert.equal(E.teBand(3.4).label, "Impacting");
  assert.equal(E.teBand(5).label, "Overreaching");
});

test("primaryBenefit derives a coarse label, merging the top end", () => {
  // BOUNDS (max 183): Z2 110-128, Z3 128-146, Z4 146-165, Z5 165-183
  assert.equal(E.primaryBenefit({ sport: "run", min: 20, avgHR: 100 }, BOUNDS), "Recovery");
  assert.equal(E.primaryBenefit({ sport: "run", type: "long", min: 120, avgHR: 120 }, BOUNDS), "Base");
  assert.equal(E.primaryBenefit({ sport: "run", type: "tempo", min: 40, avgHR: 150 }, BOUNDS), "Threshold");
  assert.equal(E.primaryBenefit({ sport: "run", type: "intervals", min: 45, avgHR: 172 }, BOUNDS), "VO₂max / hard");
});

test("training load / intensity exclude a no-HR gym but include an HR gym", () => {
  const base = [{ date: "2026-06-15", sport: "run", min: 40, avgHR: 150 }];
  const noHR = base.concat([{ date: "2026-06-16", sport: "gym", min: 60 }]);
  const withHR = base.concat([{ date: "2026-06-16", sport: "gym", min: 60, avgHR: 140 }]);
  const ld0 = E.loadInRange(noHR, BOUNDS, "2026-06-15", "2026-06-21");
  const ld1 = E.loadInRange(withHR, BOUNDS, "2026-06-15", "2026-06-21");
  assert.ok(ld1 > ld0, "HR gym adds load, no-HR gym does not");
  const in0 = E.intensityInRange(noHR, BOUNDS, "2026-06-15", "2026-06-21");
  const in1 = E.intensityInRange(withHR, BOUNDS, "2026-06-15", "2026-06-21");
  assert.equal(in0.total, 40, "no-HR gym excluded from the intensity split");
  assert.equal(in1.total, 100, "HR gym counted in the split");
});

test("volumeInRange exposes a gym key unconditionally", () => {
  const logs = [{ date: "2026-06-16", sport: "gym", min: 50 }, { date: "2026-06-17", sport: "gym", min: 40, avgHR: 130 }];
  const v = E.volumeInRange(logs, "2026-06-15", "2026-06-21");
  assert.equal(v.gym, 90, "both gym sessions count as volume regardless of HR");
});

test("programAdherence matches a planned gym to a logged gym", () => {
  const w = E.generateWeek1("2026-06-15");
  const week = { ...w, sessions: w.sessions.map(s => s.day === "tue" ? { day: "tue", sport: "gym", kind: "easy", targetMin: 45 } : s) };
  const logs = [{ date: "2026-06-16", sport: "gym", min: 45, source: "manual" }];
  const adh = E.programAdherence({ weeks: [week], logs, todayISO: "2026-06-16" });
  assert.ok(adh.current >= 1, "logged gym keeps the streak");
});

test("observedMaxHR rises from a gym log", () => {
  assert.equal(E.observedMaxHR([{ sport: "run", maxHR: 175 }, { sport: "gym", maxHR: 181 }]), 181);
});

/* ================= v1.6 ad-hoc + Diary + load band ================= */

test("weekSummary aggregates per sport incl. unplanned", () => {
  const logs = [
    { date: "2026-06-15", sport: "run", min: 40, km: 8, avgHR: 150 },
    { date: "2026-06-16", sport: "run", min: 30, km: 5, avgHR: 140 },
    { date: "2026-06-17", sport: "bike", min: 90, km: 40, ascent: 600, avgHR: 130 },
    { date: "2026-06-18", sport: "hike", min: 180, ascent: 900, calories: 1200 },
    { date: "2026-06-19", sport: "gym", min: 45 }, // no HR → 0 load
  ];
  const s = E.weekSummary(logs, BOUNDS, "2026-06-15", "2026-06-21");
  assert.equal(s.bySport.run.count, 2);
  assert.equal(s.bySport.run.min, 70);
  assert.equal(s.bySport.run.km, 13);
  assert.equal(s.bySport.hike.ascent, 900);
  assert.equal(s.bySport.gym.load, 0, "no-HR gym contributes 0 load");
  assert.equal(s.total.count, 5);
  assert.equal(s.total.min, 385);
});

test("trainingLoadBand returns an optimal range per bucket", () => {
  const logs = [];
  for (let w = 0; w < 4; w++) for (let d = 0; d < 3; d++)
    logs.push({ date: E.addDays("2026-05-04", w * 7 + d), sport: "run", min: 40, avgHR: 150 });
  const buckets = E.bucketize("2026-05-04", "2026-05-31", "week");
  const band = E.trainingLoadBand(logs, BOUNDS, buckets);
  assert.equal(band.length, buckets.length);
  for (const b of band) { assert.ok(b.hi > b.lo, "hi above lo"); assert.ok(b.lo >= 0); }
});

test("suggestSession adapts to recent history with sane fallbacks", () => {
  // long run sized from recent long runs
  const logs = [
    { date: "2026-06-01", sport: "run", type: "long", min: 80, km: 16 },
    { date: "2026-06-08", sport: "run", type: "long", min: 90, km: 18 },
  ];
  const long = E.suggestSession(logs, "run", "long", {});
  assert.ok(long.targetMin >= 80 && long.targetMin <= 90, `long ~85 (got ${long.targetMin})`);
  assert.equal(long.zone, 2);
  // quality carries the template + zone
  const q = E.suggestSession(logs, "run", "runQ1", {});
  assert.equal(q.qualityTemplate, "runQ1");
  assert.equal(q.zone, E.QUALITY_TEMPLATES.runQ1.zone);
  // climb carries an ascent target
  const climb = E.suggestSession([], "bike", "bikeClimb", { settings: { climbBaseAscent: 500 }, weekNum: 1 });
  assert.ok(climb.targetAscent > 0);
  // a hilly trail proposal carries an ascent target (from trail history); plain run does not
  const hilly = E.suggestSession([{ date: "2026-06-01", sport: "trail", min: 70, km: 12, ascent: 800 }], "trail", "trailHilly", { settings: { climbBaseAscent: 500 }, weekNum: 1 });
  assert.ok(hilly.targetAscent > 0, "hilly trail has a climb target");
  assert.equal(E.suggestSession([], "run", "easy", {}).targetAscent, undefined, "plain run has no ascent target");
  assert.equal(E.suggestSession([], "trail", "trailHilly", { settings: { climbBaseAscent: 500 } }).targetAscent, 500, "no trail history → base ascent");
  // empty history → defaults
  assert.equal(E.suggestSession([], "run", "easy", {}).targetMin, 35);
  assert.equal(E.suggestSession([], "bike", "long", {}).targetMin, 120);
});

test("suggestSession hike tiers are distinct in duration + ascent and adapt to history", () => {
  const s = { climbBaseAscent: 500 };
  const short = E.suggestSession([], "hike", "short", { settings: s });
  const day = E.suggestSession([], "hike", "day", { settings: s });
  const big = E.suggestSession([], "hike", "bigday", { settings: s });
  assert.deepEqual([short.targetMin, day.targetMin, big.targetMin], [120, 240, 360], "fixed durations 2h/4h/6h");
  assert.ok(short.targetAscent < day.targetAscent && day.targetAscent < big.targetAscent, "ascent rises by tier");
  assert.ok(big.targetAscent >= 900, "big day floors at 900 m with no history");
  // adaptive: a mountain hiker's recent climbs lift the targets
  const hist = [{ sport: "hike", ascent: 1000, min: 200 }, { sport: "hike", ascent: 1200, min: 220 }];
  const dayA = E.suggestSession(hist, "hike", "day", { settings: s });
  assert.ok(dayA.targetAscent >= 1000, "day ≈ your usual climb (median ~1100)");
});

/* ---------- v1.7.5: VO₂ VDOT, workout recommendation, recommended goals ---------- */

test("estimateVo2FromRuns: VDOT from the best recent run, else null", () => {
  const logs = [{ date: "2026-06-10", sport: "run", km: 5, min: 20 }];
  const v = E.estimateVo2FromRuns(logs, "2026-06-12");
  assert.ok(v >= 45 && v <= 55, `5k/20min ≈ ~50 (got ${v})`);
  // a slower run doesn't beat the best
  const logs2 = logs.concat([{ date: "2026-06-11", sport: "run", km: 5, min: 30 }]);
  assert.equal(E.estimateVo2FromRuns(logs2, "2026-06-12"), v, "fastest run wins");
  // out of window / non-run → null
  assert.equal(E.estimateVo2FromRuns([{ date: "2020-01-01", sport: "run", km: 5, min: 20 }], "2026-06-12"), null);
  assert.equal(E.estimateVo2FromRuns([{ date: "2026-06-10", sport: "bike", km: 20, min: 40 }], "2026-06-12"), null);
});

test("recommendWorkout: recovery-first, else fills the load-focus gap", () => {
  const today = "2026-06-12";
  const base = { settings: SETTINGS, weeks: [], checkins: [] };
  // a hard session today → easy regardless of any gap
  const tired = { ...base, logs: [{ date: today, sport: "run", type: "intervals", min: 50, avgHR: 175 }] };
  assert.equal(E.recommendWorkout(tired, "run", today).kind, "easy");
  // only easy aerobic this week → anaerobic shortage → intervals
  const easyOnly = { ...base, logs: [
    { date: "2026-06-08", sport: "run", min: 40, avgHR: 120 },
    { date: "2026-06-09", sport: "bike", min: 60, avgHR: 120 },
    { date: "2026-06-10", sport: "run", min: 40, avgHR: 122 },
    { date: "2026-06-11", sport: "bike", min: 70, avgHR: 121 },
  ] };
  assert.equal(E.recommendWorkout(easyOnly, "run", today).kind, "intervals");
  // nothing logged → build the base with a long effort
  assert.equal(E.recommendWorkout({ ...base, logs: [] }, "run", today).kind, "long");
  // hike / gym unsupported
  assert.equal(E.recommendWorkout(base, "hike", today), null);
});

test("recommendBurnGoal / recommendClimbTarget / recommendGrowthRate suggest, with nulls", () => {
  const fit = { heightCm: 180, age: 40, sex: "male", targetWeightKg: 80 };
  const r = E.recommendBurnGoal({ settings: fit, weighIns: [{ date: "2026-06-10", kg: 88 }] });
  assert.ok(r && r.burn > 0, "positive burn");
  assert.ok(r.bmi > 26 && r.bmi < 28, `BMI ~27 (got ${r && r.bmi})`);
  assert.equal(E.recommendBurnGoal({ settings: fit, weighIns: [{ kg: 78 }] }).burn, null, "at goal → no burn");
  assert.equal(E.recommendBurnGoal({ settings: { age: 40, sex: "male", targetWeightKg: 80 }, weighIns: [{ kg: 88 }] }), null, "missing height → null");

  const rides = [600, 800, 700].map((a, i) => ({ sport: "bike", ascent: a, date: `2026-06-0${i + 1}` }));
  assert.equal(E.recommendClimbTarget({ logs: rides }), 700);
  assert.equal(E.recommendClimbTarget({ logs: rides.slice(0, 1) }), null);
});

test("initDoc starts a clean no-plan doc (empty data, no weeks)", () => {
  const d = S.initDoc("2026-06-12");
  assert.deepEqual(d.logs, []);
  assert.deepEqual(d.weighIns, []);
  assert.deepEqual(d.vo2History, []);
  assert.deepEqual(d.weeks, []);
  assert.equal(d.settings.goal, "general");
});

test("firstWeekFromMix builds Week 1 from the mix (1 run / 5 ride / 3 gym = 9 sessions)", () => {
  const settings = { weeklyCounts: { run: 1, bike: 5, gym: 3 }, restDay: "sun", gymVenueDefault: "home" };
  const w = E.firstWeekFromMix("2026-06-15", settings);
  const nonRest = w.sessions.filter(s => s.sport !== "rest");
  assert.equal(nonRest.length, 9, "all 9 placed");
  assert.equal(nonRest.filter(s => s.sport === "run").length, 1);
  assert.equal(nonRest.filter(s => s.sport === "bike").length, 5);
  assert.equal(nonRest.filter(s => s.sport === "gym").length, 3);
  assert.ok(nonRest.every(s => s.kind !== "quality"), "week 1 is all easy");
  assert.equal(w.weekNum, 1);
});

test("goalDefaults returns a sane mix + emphasis per goal", () => {
  assert.deepEqual(E.goalDefaults("race").mix, { run: 4, bike: 1, gym: 0 });
  assert.ok(E.goalDefaults("race").allowed.includes("longRun"));
  assert.deepEqual(E.goalDefaults("strength").mix, { run: 2, bike: 1, gym: 3 });
  assert.ok(E.goalDefaults("strength").allowed.includes("gymStrength"));
  assert.deepEqual(E.goalDefaults("anything-else").mix, { run: 3, bike: 3, gym: 0 });
});

test("weeksToEvent counts whole weeks to the event's Monday", () => {
  const s = { goalEvent: { date: "2026-07-13" } };
  assert.equal(E.weeksToEvent(s, "2026-07-13"), 0);
  assert.equal(E.weeksToEvent(s, "2026-07-06"), 1);
  assert.equal(E.weeksToEvent(s, "2026-06-15"), 4);
  assert.equal(E.weeksToEvent({ goalEvent: null }, "2026-06-15"), null);
});

test("taperWeek scales volume down and keeps a sharpener until race week", () => {
  const prev = E.firstWeekFromMix("2026-06-15", { weeklyCounts: { run: 3, bike: 2, gym: 0 }, restDay: "sun" });
  const r = prev.sessions.find(s => s.sport === "run");
  r.kind = "quality"; r.qualityTemplate = "runQ1"; r.zone = 4;
  const tot = w => w.targetMin.run + w.targetMin.bike;
  const t2 = E.taperWeek({ prevLoadWeek: prev, startDate: "2026-06-29", weekNum: 3, weeksOut: 2 });
  const t0 = E.taperWeek({ prevLoadWeek: prev, startDate: "2026-07-13", weekNum: 5, weeksOut: 0 });
  assert.ok(tot(t2) < tot(prev), "2 weeks out is lower than the build week");
  assert.ok(tot(t0) < tot(t2), "race week is the lowest");
  assert.ok(t2.sessions.some(s => s.kind === "quality"), "sharpener kept 2 weeks out");
  assert.ok(t0.sessions.every(s => s.kind !== "quality"), "race week is all easy");
  assert.equal(t0.taper, 0);
});

test("coachInsights surfaces an event countdown when a dated event is set", () => {
  const doc = { settings: { ...SETTINGS, goal: "race", goalEvent: { date: "2026-07-13", distanceKm: 42.2 } },
    weeks: [E.generateWeek1("2026-06-15")], logs: [], checkins: [], vo2History: [], manualBests: [] };
  const ins = E.coachInsights({ doc, todayISO: "2026-06-15" });
  assert.ok(ins.some(i => i.id === "event-countdown"), "countdown insight present");
});

test("targetSuggestions flags a climb-target increase as rides get bigger", () => {
  const doc = { settings: { ...SETTINGS, climbBaseAscent: 500 }, weeks: [], checkins: [],
    logs: [600, 700, 800].map((a, i) => ({ sport: "bike", ascent: a, km: 30, min: 90, date: `2026-06-0${i + 1}` })) };
  const climb = E.targetSuggestions(doc).find(s => s.key === "climb");
  assert.ok(climb && climb.recommended > 500, "climb increase suggested");
});

test("vdotFor + danielsPaces: a faster goal time yields a higher VDOT and faster paces", () => {
  const fast = E.vdotFor(42.2, 180);   // 3:00 marathon
  const slow = E.vdotFor(42.2, 240);   // 4:00 marathon
  assert.ok(fast > slow, "quicker time = higher VDOT");
  assert.equal(E.vdotFor(0, 30), null);
  assert.equal(E.vdotFor(5, 0), null);
  const pf = E.danielsPaces(fast), ps = E.danielsPaces(slow);
  assert.ok(pf.threshold < ps.threshold, "fitter runner trains at a faster threshold pace");
  // paces ordered easy(slowest) → marathon → threshold → interval → rep(fastest)
  assert.ok(ps.easy[0] > ps.marathon && ps.marathon > ps.threshold && ps.threshold > ps.interval && ps.interval > ps.rep);
  // sanity: VDOT 50 threshold ≈ 4:15/km (255 s) ± 20 s
  assert.ok(Math.abs(E.danielsPaces(50).threshold - 255) < 20);
});

test("goalRunPaces / goalRideSpeed read the target time off the goal event", () => {
  assert.equal(E.goalRunPaces({ goal: "race", goalEvent: { distanceKm: 42.2 } }), null, "no time = no paces");
  const gp = E.goalRunPaces({ goal: "race", goalEvent: { distanceKm: 10, targetSec: 2400 } }); // 40:00 10K
  assert.ok(gp && gp.vdot > 0 && gp.threshold > 0);
  assert.equal(gp.racePace, 240, "race pace 4:00/km");
  assert.equal(E.goalRunPaces({ goal: "cycling", goalEvent: { distanceKm: 10, targetSec: 2400 } }), null, "cycling isn't a run goal");
  const sp = E.goalRideSpeed({ goal: "cycling", goalEvent: { distanceKm: 90, targetSec: 3 * 3600 } });
  assert.equal(sp, 30, "90 km in 3 h = 30 km/h");
  assert.equal(E.goalRideSpeed({ goal: "race", goalEvent: { distanceKm: 90, targetSec: 10800 } }), null);
});

test("goalFitnessCheck rates the target against recent-run fitness", () => {
  const ambitious = { settings: { goal: "race", goalEvent: { distanceKm: 10, targetSec: 2100 } }, // 35:00 10K (VDOT ~50)
    logs: [{ sport: "run", km: 10, min: 50, date: "2026-06-01" }] };                              // ~28 min 5K pace fitness
  const c = E.goalFitnessCheck(ambitious, "2026-06-10");
  assert.ok(c && c.currentVdot != null && c.gap > 0 && c.level === "ambitious");
  const fresh = E.goalFitnessCheck({ settings: { goal: "race", goalEvent: { distanceKm: 10, targetSec: 2700 } }, logs: [] }, "2026-06-10");
  assert.equal(fresh.level, "unknown", "no runs logged yet");
  assert.equal(E.goalFitnessCheck({ settings: { goal: "weight" }, logs: [] }, "2026-06-10"), null);
});

test("goalDefaults weight mix scales with the loss rate (volume + intensity)", () => {
  const gentle = E.goalDefaults("weight", { lossKg: 0.25 });
  const aggressive = E.goalDefaults("weight", { lossKg: 0.75 });
  const n = m => m.run + m.bike + m.gym;
  assert.ok(n(aggressive.mix) > n(gentle.mix), "aggressive adds volume");
  assert.ok(aggressive.allowed.includes("runIntervals"), "aggressive adds intensity");
  assert.deepEqual(E.goalDefaults("weight").mix, { run: 3, bike: 3, gym: 1 }, "standard default unchanged");
  assert.equal(E.LOSS_RATES.length, 3);
});
