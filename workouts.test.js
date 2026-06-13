import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./workouts.js";

const ALL_EQUIP = Object.fromEntries(W.HOME_EQUIPMENT.map(k => [k, true]));
const cats = w => w.blocks.map(b => b.category);
const ids = w => W.workoutExerciseIds(w);

test("database: unique ids, valid categories, every exercise has a mode", () => {
  const seen = new Set();
  const home = new Set(W.HOME_EQUIPMENT);
  for (const e of W.EXERCISES) {
    assert.ok(!seen.has(e.id), `dup ${e.id}`); seen.add(e.id);
    assert.ok(W.CATEGORIES.includes(e.category), `${e.id} category`);
    assert.ok(e.mode === "reps" || e.mode === "timed", `${e.id} mode`);
    if (e.mode === "reps") { assert.ok(Number.isInteger(e.reps.sets) && Number.isInteger(e.reps.reps), `${e.id} reps ints`); }
    if (e.venues.includes("home")) assert.ok(e.equipment.every(k => home.has(k)), `${e.id} home equipment`);
  }
  assert.ok(W.EXERCISES.length >= 200);
});

test("generateGymWorkout is deterministic", () => {
  const a = { minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: 99 };
  assert.deepEqual(W.generateGymWorkout(a), W.generateGymWorkout(a));
});

test("every duration is warm-up first, mobility last, with work blocks between", () => {
  for (const mins of [30, 45, 60, 75, 90]) {
    const w = W.generateGymWorkout({ minutes: mins, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: mins });
    const c = cats(w);
    assert.equal(c[0], "warmup");
    assert.equal(c[c.length - 1], "mobility");
    assert.ok(c.length >= 6, `${mins}: enough blocks`);
    // full body covers lower + an upper + core
    assert.ok(c.includes("lower") && (c.includes("upperPush") || c.includes("upperPull")) && c.includes("core"));
  }
});

test("focus selects the right work categories", () => {
  const work = (f) => cats(W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: f, seed: 5 })).slice(1, -1);
  assert.ok(work("upper").every(c => ["upperPush", "upperPull", "core", "cardio"].includes(c)));
  assert.ok(work("lower").filter(c => c === "lower").length >= 3, "lower focus is lower-heavy");
  assert.ok(work("cardio").filter(c => c === "cardio").length >= 3, "cardio focus is cardio-heavy");
  assert.ok(work("core").filter(c => c === "core").length >= 3, "core focus is core-heavy");
});

test("blocks carry rep sets or timed rounds per the exercise mode", () => {
  const w = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: 11 });
  for (const b of w.blocks) {
    if (b.mode === "reps") { assert.ok(b.sets > 0 && b.reps > 0); assert.equal(b.rounds, undefined); }
    else { assert.ok(b.rounds > 0 && b.work > 0); assert.equal(b.sets, undefined); }
  }
  assert.ok(w.blocks.some(b => b.mode === "reps"), "a full workout has rep-based strength");
});

test("home workouts NEVER include un-owned equipment (the bug regression)", () => {
  for (let s = 1; s <= 200; s++) for (const f of W.FOCUSES) {
    const w = W.generateGymWorkout({ minutes: 45, venue: "home", equipment: { mat: true }, focus: f, seed: s });
    for (const id of ids(w)) assert.ok(W.exerciseById(id).equipment.every(k => k === "mat"), `${id} needs un-owned gear`);
  }
  // enabling dumbbells unlocks them; gym sees barbell
  assert.ok(W.filterEligible({ venue: "home", equipment: { dumbbells: true } }).some(e => e.equipment.includes("dumbbells")));
  assert.ok(W.filterEligible({ venue: "gym", equipment: {} }).some(e => e.equipment.includes("barbell")));
});

test("banned exercises never appear", () => {
  const base = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: 5 });
  const banned = ids(base).slice(0, 3);
  const w = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", banned, seed: 5 });
  for (const id of banned) assert.ok(!ids(w).includes(id));
});

test("refresh (new seed + avoidIds) avoids the recent exercises", () => {
  const a = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: 1 });
  const b = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "full", seed: 2, avoidIds: ids(a) });
  assert.equal(ids(b).filter(id => ids(a).includes(id)).length, 0);
});

test("swap pins an exercise into its block index", () => {
  const base = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "lower", seed: 4 });
  const block = base.blocks.find(b => b.category === "lower");
  const inUse = new Set(ids(base));
  const alt = W.EXERCISES.find(e => e.category === "lower" && e.venues.includes("gym") && !inUse.has(e.id));
  const w = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, focus: "lower", seed: 4, swaps: { [block.bi]: alt.id } });
  assert.equal(w.blocks.find(b => b.bi === block.bi).id, alt.id);
});

test("snapDuration picks the nearest template", () => {
  assert.equal(W.snapDuration(52), 45);
  assert.equal(W.snapDuration(80), 75);
});
