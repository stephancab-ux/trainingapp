import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "./workouts.js";

const ALL_EQUIP = Object.fromEntries(W.HOME_EQUIPMENT.map(k => [k, true]));
const catsOf = w => w.blocks.map(b => b.category);
const idsOf = w => W.workoutExerciseIds(w);

test("database integrity: unique ids, valid categories, home items use only home equipment", () => {
  const ids = new Set(W.EXERCISES.map(e => e.id));
  assert.equal(ids.size, W.EXERCISES.length, "all ids unique");
  const home = new Set(W.HOME_EQUIPMENT);
  for (const e of W.EXERCISES) {
    assert.ok(W.CATEGORIES.includes(e.category), `${e.id} category valid`);
    if (e.venues.includes("home")) assert.ok(e.equipment.every(k => home.has(k)), `${e.id} home equipment valid`);
  }
  assert.ok(W.EXERCISES.length >= 200, "a large database");
});

test("generateGymWorkout is deterministic for identical inputs", () => {
  const args = { minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 424242 };
  assert.deepEqual(W.generateGymWorkout(args), W.generateGymWorkout(args));
});

test("every duration produces a full-body workout (lower + an upper + core)", () => {
  for (const mins of [30, 45, 60, 75, 90]) {
    const w = W.generateGymWorkout({ minutes: mins, venue: "gym", equipment: ALL_EQUIP, seed: mins * 7 });
    const cats = catsOf(w);
    assert.ok(cats.includes("lower"), `${mins}: has lower`);
    assert.ok(cats.includes("upperPush") || cats.includes("upperPull"), `${mins}: has an upper`);
    assert.ok(cats.includes("core"), `${mins}: has core`);
    assert.ok(w.estMinutes >= mins * 0.6, `${mins}: workout roughly fills the time (${w.estMinutes})`);
  }
});

test("duration snaps to the nearest template", () => {
  assert.equal(W.snapDuration(50), 45);
  assert.equal(W.snapDuration(80), 75);
  assert.equal(W.generateGymWorkout({ minutes: 52, venue: "gym", seed: 1 }).minutes, 45);
});

test("home filters by owned equipment; gym ignores the filter", () => {
  const bare = W.generateGymWorkout({ minutes: 45, venue: "home", equipment: {}, seed: 9 });
  // nothing owned → every chosen exercise is pure bodyweight
  assert.equal(bare.equipmentNeeded.length, 0, "no equipment required when none owned");
  const eligibleBare = W.filterEligible({ venue: "home", equipment: {} });
  assert.ok(eligibleBare.every(e => e.equipment.length === 0));
  // owning dumbbells unlocks dumbbell movements
  const eligibleDb = W.filterEligible({ venue: "home", equipment: { dumbbells: true } });
  assert.ok(eligibleDb.some(e => e.equipment.includes("dumbbells")));
  // gym sees barbell/machine work that home never does
  const gymPool = W.filterEligible({ venue: "gym", equipment: {} });
  assert.ok(gymPool.some(e => e.equipment.includes("barbell")));
});

test("banned exercises never appear", () => {
  const base = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 5 });
  const banned = idsOf(base).slice(0, 3);
  const w = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, banned, seed: 5 });
  for (const id of banned) assert.ok(!idsOf(w).includes(id), `${id} excluded`);
});

test("refresh (new seed + avoidIds) avoids the recent exercises", () => {
  const a = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 111 });
  const aIds = idsOf(a);
  const b = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 222, avoidIds: aIds });
  const overlap = idsOf(b).filter(id => aIds.includes(id));
  assert.equal(overlap.length, 0, "the refreshed workout shares no exercise with the avoided set");
});

test("swap pins an exercise into its block", () => {
  const base = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 77 });
  const block = base.blocks.find(b => b.category === "lower");
  // pick a different lower-body exercise not currently in that block
  const inUse = new Set(idsOf(base));
  const alt = W.EXERCISES.find(e => e.category === "lower" && e.venues.includes("gym") && !inUse.has(e.id));
  const swaps = { [block.bi]: alt.id };
  const w = W.generateGymWorkout({ minutes: 60, venue: "gym", equipment: ALL_EQUIP, seed: 77, swaps });
  const newBlock = w.blocks.find(b => b.bi === block.bi);
  assert.ok(newBlock.exercises.some(e => e.id === alt.id), "swapped exercise is pinned in");
});
