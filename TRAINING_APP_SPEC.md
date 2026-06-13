# REMONTE — Run & Bike Rebuild App
### Build specification for Claude Code

> "Remonte" (French: *climbs back up*) is a working name — rename freely.

---

## 0. The brief in one paragraph

A single-user, offline-first web app installed on an iPhone home screen (PWA hosted on GitHub Pages). It plans and tracks a weekly run + bike program (default 3 runs, 3 rides, Sunday rest), driven by heart-rate zones. Each week the user logs sessions in ~30 seconds; on Sunday a check-in proposes next week's volume (default +7%, user can override with a slider), with an automatic deload every 4th week. Harder interval sessions stay locked until consistency is proven. The app also tracks weight against a target and learns the user's easy-running pace over time. All data lives on the device (localStorage) with JSON export/import. No accounts, no server, no analytics, no runtime network dependency.

---

## 1. Hard requirements (non-negotiable)

1. Works fully offline after install; no CDN or network calls at runtime.
2. All data on-device; one-tap JSON export, import with validate + replace/merge prompt.
3. Installable iOS PWA (Add to Home Screen from Safari), portrait, standalone.
4. Mobile-first at 380 px width; every tap target ≥ 44 px.
5. Logging a session takes ≤ 30 seconds and ≤ 3 taps to reach.
6. Training engine implemented as pure functions in its own module (`engine.js`) — no DOM access — so rules can be unit-tested.
7. Runs are never scheduled on consecutive days. If the user forces a layout that breaks this, warn once, then allow.
8. Copy never shames a missed session. Empty/missed states always point to the next action.

---

## 2. Tech stack

- Vanilla HTML/CSS/JS, no framework, no build step. Files: `index.html`, `app.css`, `app.js` (+ `engine.js`, `store.js`, `charts.js` as ES modules), `sw.js`, `manifest.webmanifest`, `icons/`.
- Charts: hand-rolled inline SVG (line + bar). No chart library — keeps the bundle tiny and dependency-free.
- Service worker: cache-first app shell, versioned cache name, update-on-reload.
- Fonts: system stack (`-apple-system, …`) — offline constraint; compensate with a strong type scale (see §11).
- Hosting: GitHub Pages from `main` branch root. Repo also contains this spec.

---

## 3. The athlete (context the app is built around)

Returning athlete in Sierre, Valais (CH). Strong history (1,000+ logged activities) but two years of travel with little structure. Restarted April 2026.

| Metric | Value | Source |
|---|---|---|
| Weight | 87.4 kg (Jun 8 2026); range 86.5–88.5 since Dec 2025 | Garmin weigh-ins |
| VO₂ max | 42.8 now; 46.7 (Jul 2025); ~48 (spring 2025); self-reported 53–54 two years ago | Garmin |
| Max HR | 183 bpm (observed Mar 2026; 182 in May–Jun) | Garmin |
| Resting HR | **unknown — settings field** | — |
| HRV | 7-day avg ~39–43 ms, baseline 42–68 ms (sits at the low edge) | Garmin |
| Sleep | ~6 h 45 – 7 h 15, "Fair" | Garmin |
| Recent runs | 5–7 km at 5:19–6:21/km, **avg HR 164–171 on every run** | Activities export |
| Recent rides | 16–70 km, avg HR 118–154, weekend rides up to 3.5 h | Activities export |
| Best recent week | Jun 1–7 2026: 3 runs + 3 rides, ~9.7 h | Activities export |

Two facts drive the engine design:

- **Every run is too hard.** All recent runs sit at ~90 % of max HR. The app's first job is enforcing genuinely easy running. Expect Z2 pace to start around 7:00–7:45/km — the UI should normalize this ("easy means easy") rather than present it as slowness.
- **Consistency, not volume, is the real gap.** Weekly session counts since late April: 1, 5, 2, 2, 5, 4, 6, 2. Make consistency visible (streaks, weeks-on-target) and start volume conservatively (~6 h) with headroom to grow.

Goals (equal priority): rebuild VO₂ max and lose weight. Motivating math the app should surface: VO₂ max is per kg — at unchanged fitness, 87.4 → 80 kg lifts 42.8 to ~46.8. Show "VO₂ at target weight" next to the weight chart.

No current injuries reported. Keep the conservative run rules anyway (87 kg + layoff).

---

## 4. Seed data

On first launch, ask only for **plan start date** (default: next Monday). Everything below ships pre-loaded; all of it editable in Settings or History.

```json
{
  "schemaVersion": 1,
  "settings": {
    "maxHR": 183,
    "restingHR": null,
    "zoneMethod": "pctmax",
    "targetWeightKg": 80.0,
    "growthRate": 0.07,
    "deloadEvery": 4,
    "hrvBaselineLow": 42,
    "layout": { "mon": "run", "tue": "bike", "wed": "run", "thu": "bike", "fri": "run", "sat": "bike-long", "sun": "rest" },
    "qualityUnlocked": false,
    "lastExportAt": null
  },
  "weighIns": [
    { "date": "2025-12-05", "kg": 86.5 },
    { "date": "2026-01-04", "kg": 88.5 },
    { "date": "2026-02-08", "kg": 87.5 },
    { "date": "2026-02-23", "kg": 87.6 },
    { "date": "2026-03-07", "kg": 87.2 },
    { "date": "2026-06-08", "kg": 87.4 }
  ],
  "vo2History": [
    { "date": "2024-07-01", "value": 47.3 }, { "date": "2025-02-01", "value": 47.3 },
    { "date": "2025-05-01", "value": 48.7 }, { "date": "2025-07-01", "value": 46.7 },
    { "date": "2025-10-01", "value": 41.8 }, { "date": "2026-01-01", "value": 42.4 },
    { "date": "2026-04-01", "value": 43.3 }, { "date": "2026-06-01", "value": 42.8 }
  ],
  "logs": [
    { "date": "2026-05-01", "sport": "bike", "min": 155,  "km": 24.23, "avgHR": 145 },
    { "date": "2026-05-05", "sport": "run",  "min": 27,   "km": 5.02,  "avgHR": 169 },
    { "date": "2026-05-09", "sport": "bike", "min": 91,   "km": 32.26, "avgHR": 133 },
    { "date": "2026-05-14", "sport": "bike", "min": 70,   "km": 16.28, "avgHR": 123 },
    { "date": "2026-05-19", "sport": "run",  "min": 28,   "km": 5.01,  "avgHR": 164 },
    { "date": "2026-05-20", "sport": "bike", "min": 75,   "km": 30.28, "avgHR": 143 },
    { "date": "2026-05-22", "sport": "run",  "min": 35,   "km": 5.84,  "avgHR": 171 },
    { "date": "2026-05-23", "sport": "bike", "min": 230,  "km": 33.97, "avgHR": 129 },
    { "date": "2026-05-24", "sport": "bike", "min": 54,   "km": 17.45, "avgHR": 118 },
    { "date": "2026-05-26", "sport": "run",  "min": 35,   "km": 5.49,  "avgHR": 169 },
    { "date": "2026-05-28", "sport": "bike", "min": 65,   "km": 30.08, "avgHR": 154 },
    { "date": "2026-06-01", "sport": "bike", "min": 93,   "km": 18.04, "avgHR": 125 },
    { "date": "2026-06-02", "sport": "run",  "min": 30,   "km": 5.47,  "avgHR": 170 },
    { "date": "2026-06-03", "sport": "bike", "min": 169,  "km": 35.42, "avgHR": 126 },
    { "date": "2026-06-05", "sport": "run",  "min": 41,   "km": 7.04,  "avgHR": 166 },
    { "date": "2026-06-06", "sport": "run",  "min": 38,   "km": 6.51,  "avgHR": 167 },
    { "date": "2026-06-07", "sport": "bike", "min": 212,  "km": 39.48, "avgHR": 133 },
    { "date": "2026-06-11", "sport": "bike", "min": 170,  "km": 70.71, "avgHR": 141 },
    { "date": "2026-06-12", "sport": "run",  "min": 42,   "km": 7.01,  "avgHR": 167 }
  ]
}
```

All seed logs get `source: "seed"`. They populate charts and the pace model but belong to pre-plan history, not to plan-week completion.

---

## 5. Heart-rate zones & pace model

**Zone calculation** (recompute whenever settings change):

- `pctmax` (default, used while `restingHR` is null): Z1 50–60 %, Z2 60–70 %, Z3 70–80 %, Z4 80–90 %, Z5 90–100 % of maxHR.
  With maxHR 183 → Z1 92–110 · Z2 110–128 · Z3 128–146 · Z4 146–165 · Z5 165–183.
- `karvonen` (auto-switch when restingHR is entered): zone bound = RHR + pct × (maxHR − RHR), same percentage bands. Show a small "zones updated" note when the switch happens.

**Run pace hints.** Every planned run shows its HR target plus an *estimated* pace range, clearly labelled as an estimate.

- Learned model: over the last 8 logged runs ≥ 20 min with avgHR between 105 and 155, fit a linear regression of pace (sec/km) vs avgHR; predict pace at the Z2 midpoint; display ±15 s/km as a range. Recompute after every run log.
- Cold-start seeds (until ≥ 3 qualifying runs exist): Z2 7:00–7:45/km · Z3 6:15–6:45 · Z4 5:25–5:55 · Z5 < 5:00.
- Surface "pace at easy HR" as its own progress chart — same heart rate getting faster is the clearest engine-rebuild signal.

**Bike.** HR + duration only. Never show speed *targets* (Valais terrain makes outdoor speed meaningless); show recent average speed as a reference stat in history only.

---

## 6. Screens (5 total, bottom tab bar)

**Today (default tab).** One card: today's session — sport, type, duration, zone with live bpm range, pace hint for runs. Primary button "Log this session" opens the quick-log sheet pre-filled with the planned duration. Secondary: "Skip" (asks: move to another day this week / drop it). Rest day shows a quiet card. If yesterday's session is unlogged, a small one-tap "log yesterday" link — never a guilt banner.

**Week.** Seven-day strip with the fixed layout (Mon run · Tue bike · Wed run · Thu bike · Fri run · Sat long ride · Sun rest), status per day (planned / done / skipped), weekly totals vs target per sport, and a "Change this week's mix" control: steppers for run count (0–4) and ride count (0–5). Re-layout rules in §7.6.

**Check-in (appears on the Week tab from Sunday, badge until completed).** Steps: (1) weight entry, optional but prompted; (2) "How did the week feel?" 1–5; (3) optional recovery inputs: HRV 7-day average and sleep quality 1–5; (4) the proposal — next week's volume with the recommended change pre-selected and an override slider from −20 % to +15 % in 1 % steps, live-previewing the resulting session durations; (5) confirm → next week is generated.

**Progress.** Charts (SVG): weekly minutes by sport (stacked bars, target line, deload weeks tinted); weight with EMA trend (α = 0.25), target line at `targetWeightKg`, and the "VO₂ at target weight" figure; pace-at-easy-HR trend; VO₂ entries (manual "Add reading" button); consistency strip — last 12 weeks colored by completion, plus current streak of weeks ≥ 80 %.

**Settings.** maxHR, restingHR, zone preview table, target weight, default growth rate (0–15 %), deload cadence, weekly layout editor (enforces §1.7 with warn-then-allow), data: Export JSON / Import JSON / Import Garmin CSV, "reset all data" behind a confirm. Show last-export date; banner on any tab if > 30 days since export.

---

## 7. Training engine (pure functions, exact rules)

### 7.1 Week 1 plan (generated from start date)

| Day | Session | Duration | Zone |
|---|---|---|---|
| Mon | Run easy | 35 min | Z2 |
| Tue | Bike easy | 60 min | Z2 |
| Wed | Run easy | 35 min | Z2 |
| Thu | Bike easy | 75 min | Z2 (Z3 allowed on climbs) |
| Fri | Run easy | 35 min | Z2 |
| Sat | Long ride | 120 min | Z2 |
| Sun | Rest | — | — |

Targets: run 105 min, bike 255 min, total 360 min (6 h 00). Deliberately below his best recent week (~9.7 h) to leave growth headroom and prioritize consistency.

### 7.2 Weekly progression

- `nextTotal = lastLoadWeekTarget × (1 + chosenRate)` where `chosenRate` defaults to the engine recommendation (§7.4) and is final after the user's slider choice.
- Distribute the increase proportionally to each sport's current share, **except**: run minutes may grow at most **+10 % per week** regardless of `chosenRate`; any excess goes to bike.
- Session durations: each sport's weekly minutes split across its sessions; the Saturday ride always takes a double share (it is the long session, growing toward ~3 h over time, hard cap 210 min). Round every session to 5 min.

### 7.3 Deload

- Every `deloadEvery`-th week (default 4th): all sessions at 60 % of the *previous load week's* durations, everything Z2 or below, no quality sessions, long ride capped at 90 min.
- The week after a deload resumes from the previous load week: `target = lastLoadWeek × (1 + chosenRate)`.

### 7.4 Check-in recommendation

Inputs: `completion = loggedMinutes / plannedMinutes` over run+bike (cap 1.2; imported CSV sessions count, "other" activities don't), `feel` 1–5, optional `hrv7d`.

| Condition | Recommended rate |
|---|---|
| completion ≥ 0.90 and feel ≥ 3 | `settings.growthRate` (default +7 %) |
| completion 0.70–0.89, or feel = 2 | 0 % (repeat the week) |
| completion < 0.70, or feel = 1 | −10 %, and no quality next week |
| `hrv7d` entered and < `hrvBaselineLow` | cap recommendation at 0 % |

The user can always override with the slider; store both `recommendedRate` and `chosenRate` on the check-in record.

### 7.5 Quality-session unlock (the "app decides" rule)

- **Unlock condition:** completion ≥ 0.80 in **3 of the last 4 non-deload weeks**, with no feel = 1 among them.
- First unlock converts Wednesday's run into a quality run. After **2 further qualifying weeks**, Thursday's ride becomes a quality ride too (max 1 quality session per sport per week, never on deload weeks).
- **Re-lock** (back to all-easy) if 2 consecutive weeks have completion < 0.60 or feel = 1.
- Templates (warm-up 15 min / cool-down 10 min inside the planned duration):
  - Run Q1: 8 × 1 min @ Z4 with 2 min Z1 jog. After 4 quality runs → Q2: 3 × 6 min @ low Z4, 3 min easy between.
  - Bike Q1: 3 × 8 min @ Z3–Z4 (sweet spot), 5 min easy between. After 4 → Q2: 2 × 12 min.
- Show locked state honestly on the Week tab: "Intervals unlock after 3 consistent weeks — 2 done."

### 7.6 Changing the weekly mix

User edits run/ride counts for the *current or next* week. Re-layout keeps Sunday rest (unless the layout editor changed it), alternates sports where possible, never places runs on consecutive days (§1.7 warn-then-allow), keeps the long ride on Saturday when ≥ 1 ride exists. Per-sport weekly minutes scale by `newCount / oldCount` (run +10 %/wk cap still applies vs the previous week's actual run minutes). Changing the mix never changes the week's *total* minutes by more than the counts imply — no hidden volume jumps.

### 7.7 Logging

Quick-log fields: duration (pre-filled), distance km, avg HR, RPE 1–10, optional note. Any activity can also be logged unplanned (FAB on Week tab) including sport "other" (hike etc.) — shown in history, excluded from completion math.

---

## 8. Data model & storage

Single localStorage key `remonte.v1` holding one JSON document: `{ schemaVersion, settings, weeks[], logs[], checkins[], weighIns[], vo2History[] }`.

- `week`: `{ id: "2026-W26", startDate, isDeload, sessions: [{ day, sport, kind: "easy"|"quality"|"long"|"rest", targetMin, zone, qualityTemplate? }], targetMin: { run, bike } }`
- `log`: `{ id, date, sport: "run"|"bike"|"other", min, km?, avgHR?, rpe?, note?, source: "manual"|"csv"|"seed" }`
- `checkin`: `{ weekId, completion, feel, weightKg?, hrv7d?, sleep?, recommendedRate, chosenRate }`
- Write-through on every mutation; call `navigator.storage.persist()` on first run; guard every parse with a corrupt-data recovery path (offer export of raw string + reset).
- `schemaVersion` + a `migrate()` chain so future Claude Code edits can evolve the schema safely.

---

## 9. Garmin CSV import

Garmin Connect → Activities → export CSV. Exact header (28 columns):

```
Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR,Max HR,Aerobic TE,Avg Run Cadence,Max Run Cadence,Avg Pace,Best Pace,Total Ascent,Total Descent,Avg Stride Length,Training Stress Score®,Steps,Min Temp,Decompression,Best Lap Time,Number of Laps,Max Temp,Moving Time,Elapsed Time,Min Elevation,Max Elevation
```

Rules: parse `Date` as `YYYY-MM-DD HH:MM:SS`; `Time` `HH:MM:SS` → minutes; `Distance` is km (strip quotes/commas — fields are quoted and may contain thousands separators); map `Running` and `Treadmill Running` → `run`, `Cycling` → `bike`, everything else → `other`. Dedupe: skip rows matching an existing log on (same date ±10 min, same sport). Imported rows get `source:"csv"` and count toward the matching plan week's completion. Show an import summary (added / skipped-duplicate / ignored types).

---

## 10. iOS PWA & deployment

- `manifest.webmanifest`: `display: "standalone"`, `orientation: "portrait"`, name/short_name, theme + background colors, 192/512 icons; plus `<link rel="apple-touch-icon" sizes="180x180">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, correct `viewport` with `viewport-fit=cover` and safe-area insets in CSS.
- Installed home-screen apps on iOS keep their storage independently of Safari's 7-day eviction — still treat export as the real backup (30-day reminder, §6).
- Deploy: public GitHub repo → Settings → Pages → `main` / root. Include a `README.md` with: enabling Pages, the Add-to-Home-Screen steps on iPhone, and the update loop (*ask Claude Code for the change → commit → push → reopen app twice to pick up the new service-worker cache*).
- User prerequisite: free GitHub account (Claude Code should offer to walk through creating one and the repo).

---

## 11. Design direction

Subject grounding: climbing back to fitness, in the Valais Alps. The design should feel like a clean, confident training log with one alpine signature — **the weekly volume chart drawn as a mountain ridge**: each week's stacked bars form a silhouette/profile that fills toward the target line, deload weeks as gentle cols between peaks. Spend the boldness there; keep everything else quiet and disciplined.

- Zone colors: a single cool→hot ramp for Z1→Z5 used consistently everywhere (zone chips, charts, log entries). Run vs bike distinguished by icon + a secondary hue, not by competing palettes.
- Light and dark themes via `prefers-color-scheme`; dark default feels right for an athlete checking the app at 6 am, but respect the system. *(Build decision 2026-06-12: user chose **always dark** — single dark theme, no light mode.)*
- Type: system stack, but with a deliberate scale — oversized numerals for today's duration and bpm range (the two things read mid-warm-up), small caps/letter-spaced labels for eyebrows. Numbers are the heroes of this app.
- Motion: one orchestrated moment only — the check-in proposal sliding in with the volume preview updating live under the slider. Respect `prefers-reduced-motion`.
- Copy: plain verbs, sentence case, second person. "Log this session", not "Submit". Missed week: "Pick up where you left off — here's Monday." Locked intervals state shows progress toward unlocking, not a padlock and nothing else.

---

## 12. Acceptance checklist

1. Fresh install → asks start date → Week 1 matches §7.1 exactly.
2. Log all sessions at plan duration, feel 4 → check-in recommends +7 %; slider override to +10 % regenerates next week with run minutes ≤ +10 %.
3. Week 4 is auto-deload at 60 % with a 90 min long ride; week 5 = week 3 × (1 + chosenRate).
4. Three weeks at ≥ 80 % completion (of last 4, non-deload) → Wednesday becomes quality run with Q1 template; two more → Thursday quality ride.
5. Completion 0.5 + feel 1 → recommendation −10 % and quality suppressed next week.
6. Entering restingHR switches zones to Karvonen and updates every displayed bpm range.
7. Changing mix to 4 rides / 2 runs relayouts with no consecutive runs and preserves sport-minute scaling.
8. Pace hint updates after each logged run; with seed data present it shows a learned estimate, labelled as estimate. *(Build note: no seed run meets the §5 learned-model filter — avgHR 105–155 — so the app correctly shows cold-start estimates until 3 qualifying easy runs are logged.)*
9. CSV from §9 header imports, dedupes against seed logs, and counts toward the current week.
10. Airplane mode: app fully usable, logging works, charts render.
11. Export produces a JSON file that re-imports losslessly on a wiped install.
12. Lighthouse PWA installable; tap targets ≥ 44 px; reduced-motion honored.

---

## 13. Out of scope (v2 ideas, do not build now)

French localization · Garmin FIT-file parsing · automatic HRV-based daily adjustments · long-run progression block (revisit ~week 8) · shareable weekly summary card · multi-device sync.

---

## 14. v1.1 changes (2026-06-12, user-requested after first use)

1. **Workout menu + rotation.** `QUALITY_TEMPLATES` grows to: run — speed repeats (Q1/Q2), tempo run, hill repeats; bike — sweet spot (Q1/Q2), climbing ride. The weekly quality slot auto-rotates (run: intervals → tempo → hills; bike: intervals → climb); the interval slot still upgrades Q1 → Q2 after 4 planned quality sessions. Tapping a planned quality session on the Week tab opens a chooser to swap the workout type.
2. **Manual unlock override.** Settings → Plan → Intervals can force the quality gate open (`settings.qualityOverride`). The 3-consistent-weeks rule (§7.5) remains the default; the override is explicit, warned, and reversible.
3. **Typed logs.** Logs carry an optional `type` (`easy | tempo | intervals | hills | long | climb`), pre-filled from the planned session, editable in the log sheet, shown in week rows and history. No effect on completion math.
4. **Coming-weeks projection.** The Week tab shows a read-only projection of the next 3 weeks (volume split, deload, quality) computed by `engine.projectWeeks` at `settings.growthRate` — which is the existing editable "Weekly growth" setting. Real weeks are still created only at the Sunday check-in.
5. **Manual easy pace.** `settings.easyPace {lo,hi}` (sec/km) replaces the Z2 cold-start range (§5) until 3 qualifying runs exist; then the learned model takes over. Editable under Settings → Plan → Easy pace.
6. **Sheet drag-to-dismiss.** Bottom sheets close by swiping down (pointer-event drag, 8 px engage threshold, 100 px / fast-flick dismiss); the grab bar gets an enlarged `touch-action:none` hit area.
7. **Ridge chart inspection.** Tapping a column on the weekly-volume ridge highlights it and shows that week's dates, run/ride minutes, % of target and deload state. Tap again to clear.
8. **Storage.** `schemaVersion` 2 (migration adds the two new settings keys). Service worker `v1.1.0`.

---

## 15. v1.2 changes (2026-06-13, user-requested)

Single release on top of v1.1.

1. **Decimal/comma fix + free-minute durations.** All numeric inputs are `type="text" inputmode="decimal/numeric"` so iOS keeps the "," (parsed by `num()`); logged duration is a free integer-minute field (plan targets still round to 5).
2. **Ride elevation.** Logs carry an optional `ascent` (m, rides only); `parseGarminCSV` reads "Total Ascent". Climbing rides show a target ascent (`climbTargetAscent`, base `settings.climbBaseAscent`, ramps with load). Progress has a climbing/ascent trend.
3. **Garmin import duplicate review.** `importMatches` pairs a CSV row to existing logs by sport + date + duration (±10 min) + distance (±0.5 km) — never clock time (manual logs have none). The import sheet lets you Merge / Skip / Keep-both per match.
4. **Movable rest day + smart scheduling.** `settings.restDay` picker; `placeLayout`/`relayoutWeek` are rest-day-agnostic and fatigue-aware (long ride before the rest day, quality spaced, no back-to-back runs). Adding a session is extra volume placed on the freshest day.
5. **Allowed-workout toggles.** `settings.allowedFamilies` gates the rotation; toggling one off also rewrites the current week.
6. **Per-session evaluation.** `evaluateSession` tags each logged session (intensity + verdict) using HR zones, expected-RPE (preset refined by your history) and the pace trend.
7. **Analytics + graphs.** `intensityOfLog`/`weeklyIntensity` (80/20), `sessionLoad`/`trainingLoad` (acute/chronic ACWR), `sessionPerformance`/`sessionEfficiency` (speed; VAM for climbs), `personalBests` (auto + manual). Progress is a customizable, reorderable card registry; line charts gain axis labels and tap-to-read points. New cards: training load, aerobic/anaerobic, running speed by type, ride speed, climbing/ascent, pace-vs-RPE, efficiency trend, RPE calendar, RPE-by-type, personal bests.
8. **AI Coach (5th tab).** `coachInsights` — offline, deterministic, ranked by impact×confidence, every insight carries a plain-language "why". Categories: strengths, improvements, recommendations, recovery alerts, performance trends. Actionable insights apply with one tap (add interval/tempo, add easy volume, ease the hardest day). Dismissals persist in `doc.coachDismissed`.
9. **Storage.** schemaVersion 3 (restDay, climbBaseAscent, allowedFamilies, progressCards, manualBests, coachDismissed); service worker `v1.2.0`.

Pending: the supplied "Stephan Endurance" logo as the app icon/splash — needs the raw image file committed to `icons/`.

---

## 16. v1.3 changes (2026-06-13)

1. **Garmin import** verified against the real export (ISO dates). Now captures **Calories** + **Total Descent**, maps `Trail Running→trail` and `Hiking→hike`. Weekly full-history re-imports **auto-skip** already-imported activities; only matches against a *manual* log prompt merge/skip/keep-both.
2. **Calories** — optional `log.calories`; Progress cards for daily/weekly burn, by-activity-type, planned-vs-unplanned; Coach week-over-week + dominant-sport insights.
3. **Progress history navigation** — a global range selector (This week · 4 · 8 · 12 weeks · 3 months · YTD) with ◀▶ stepping and a "vs prev" toggle, persisted in `settings.progressRange`; every activity chart honours the window (weight/VO₂ keep full history).
4. **Two-a-days** — up to 8 sessions/week; a 7th/8th lands as a second session on the freshest day (`placeLayout` returns day→[sports]).
5. **Trail running + hiking** are their own sports (ascent + descent). Trail counts toward a planned run; hiking is tracked (calories, climbing) but not in the plan.
6. **Descent** logged + imported; the climbing chart is restricted to climbing activities; ride speed is split flat vs climb.
7. **Every workout type is toggleable** (`settings.allowedTypes`) with a last-base guard.
8. **Program-adherence streak** (`programAdherence`) — current/longest streak, sessions/weeks in a row, rests respected, missed, adherence %; Coach insights.
9. **Weekly layout** gains apply-to-current-week (future days only) + auto-schedule.
10. **Personal bests** show values everywhere (incl. the Coach, click-through to the activity); trail/hike/descent records added.
11. **Per-session editor** — tap any planned session to change duration, zone, type, climb target, note; log it; or **send it to a Garmin watch as a .FIT** structured workout (+ "export the whole week" as a .zip). New `fit.js` (FIT encoder) and `zip.js`.
12. Storage schemaVersion 4 (allowedFamilies→allowedTypes, progressRange); merge unions manualBests/coachDismissed; SW `v1.3.0`. Activity icons now render in the All-activity sheet.
