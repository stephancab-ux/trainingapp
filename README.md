# Remonte

*("climbs back up")* — a single-user, offline-first run + bike training PWA for iPhone. No accounts, no server, no analytics: everything lives in your phone's storage, with JSON export as the backup.

It plans a weekly run + bike program from heart-rate zones (3 runs · 3 rides · Sunday rest by default), proposes next week's volume every Sunday (+7 % default, slider override, automatic deload every 4th week), keeps interval sessions locked until consistency is proven, tracks weight against a target, and learns your easy-running pace over time.

Once intervals unlock (or you flip the override in Settings → Plan), the weekly hard session rotates through a workout menu — speed repeats, tempo and hill repeats on the run side, sweet spot and climbing on the bike — and any planned quality session can be swapped from the Week tab. Logs carry a workout type, the Week tab projects the coming 3 weeks at your default growth rate, and the easy-pace hint can be set manually until the app has learned from your runs.

It also tracks ride **elevation** and climbing capacity, lets you move your **rest day** and choose which **workout types** are allowed, evaluates each session (good / too hot / improving), and the **Progress** tab is a customizable, reorderable stack of charts — weekly volume, training load (acute:chronic, over/under-training), weight, pace, aerobic/anaerobic balance, running/ride speed, climbing, pace-vs-RPE, an efficiency trend, an RPE calendar and **personal bests**. The **Coach** tab reads all of it offline and writes plain-language strengths, recommendations and recovery alerts, some applied with one tap. Garmin CSV imports are reviewed per activity (merge / skip / keep-both) so you never get duplicates.

The full behavior spec is in [`TRAINING_APP_SPEC.md`](TRAINING_APP_SPEC.md); the original design board is in [`mockup/`](mockup/).

---

## Deploy to GitHub Pages (one-time)

1. Make sure this code is on the **`main`** branch of a **public** repository.
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment** set **Source: Deploy from a branch**, **Branch: `main`**, **Folder: `/ (root)`** → **Save**.
4. Wait ~1 minute. The app is live at `https://<your-username>.github.io/<repo-name>/`.

## Install on your iPhone

1. Open the Pages URL above in **Safari** (not Chrome — only Safari can install).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **Remonte** from the home screen. First launch asks one thing: the plan start date (defaults to next Monday).
4. It now works fully offline — airplane mode included.

> iOS keeps a home-screen app's storage independent of Safari's 7-day cleanup, but the **Export JSON** button in Settings is your real backup. The app reminds you after 30 days.

## Updating the app

The loop for any change:

1. Ask Claude Code for the change.
2. Commit and push to `main` (and bump `VERSION` in `sw.js` — Claude will do this).
3. On the phone: **open the app, close it, open it again.** The first open downloads the new version in the background; the second open runs it.

## Development

| File | What it is |
|---|---|
| `engine.js` | every training rule as pure functions — no DOM, no storage |
| `engine.test.js` | unit tests for the engine: `node --test` |
| `store.js` | localStorage document, migrations, import/export/merge |
| `charts.js` | hand-rolled SVG charts (the ridge, lines, consistency strip) |
| `app.js` / `index.html` / `app.css` | the UI — four tabs + check-in flow |
| `sw.js` / `manifest.webmanifest` / `icons/` | PWA shell (cache-first, versioned) |
| `tools/gen-icons.mjs` | regenerates the icons (needs playwright + chromium) |

Run locally: `python3 -m http.server 8000` then open `http://localhost:8000`.
`?now=YYYY-MM-DD` freezes "today" for testing time-dependent flows.

No build step, no dependencies, no network calls at runtime.
