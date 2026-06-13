/* Remonte UI — renders the four tabs, the check-in flow and all sheets.
   All training rules live in engine.js; all persistence in store.js. */
import * as E from "./engine.js";
import * as S from "./store.js";
import * as C from "./charts.js";
import * as F from "./fit.js";
import * as W from "./workouts.js";
import { makeZip } from "./zip.js";

let doc = null;
let tab = "today";

/* `?now=YYYY-MM-DD` freezes "today" — used by the E2E checks, harmless live. */
const FAKE_NOW = new URLSearchParams(location.search).get("now");
const todayISO = () => FAKE_NOW || new Date().toLocaleDateString("sv-SE");

/* ---------------- tiny utils ---------------- */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

function fmtDur(min) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`;
}
function fmtDate(iso, opts = { weekday: "long", day: "numeric", month: "long" }) {
  // add the year whenever it's not the current year, so old activities read clearly
  if (!("year" in opts) && E.parseISO(iso).getUTCFullYear() !== E.parseISO(todayISO()).getUTCFullYear())
    opts = { ...opts, year: "numeric" };
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(E.parseISO(iso));
}
/* Day + month, plus the year whenever it's not the current year — so an old
   personal best reads "23 May 2024" while recent dates stay compact. */
const fmtShort = iso => fmtDate(iso,
  E.parseISO(iso).getUTCFullYear() === E.parseISO(todayISO()).getUTCFullYear()
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
/* very compact d/m label for dense daily bar axes */
const shortDay = iso => { const d = E.parseISO(iso); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
/* always includes the year — for chart read-outs that can span multiple years */
const fmtFull = iso => fmtDate(iso, { day: "numeric", month: "short", year: "numeric" });

const ICONS = {
  run: `<svg viewBox="0 0 24 24"><circle cx="14" cy="5" r="2"/><path d="M11.5 20l2-5-3-3 3.5-4 2.5 3h3M8 12l2-3M7 20l2.5-4"/></svg>`,
  bike: `<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-6.5h4.5L18 17M10 10.5L8.5 7H6.5M14.5 10.5L13 7h2.5"/></svg>`,
  rest: `<svg viewBox="0 0 24 24"><path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a7 7 0 0 0 9.5 9.5z"/></svg>`,
  other: `<svg viewBox="0 0 24 24"><path d="M3 18.5l5.5-8 3.5 4.5 4-6.5 5 10z"/></svg>`,
  trail: `<svg viewBox="0 0 24 24"><circle cx="14" cy="5" r="2"/><path d="M11.5 20l2-5-3-3 3.5-4 2.5 3h3M8 12l2-3M7 20l2.5-4"/><path d="M2 22l4-4 3 2 4-5"/></svg>`,
  hike: `<svg viewBox="0 0 24 24"><path d="M4 22l5-9 3 3 3-7 5 13M11 7a2 2 0 1 0 0-.01"/></svg>`,
  gym: `<svg viewBox="0 0 24 24"><path d="M4 9v6M7 7v10M20 9v6M17 7v10M7 12h10"/></svg>`,
};
const sportClass = sp => sp === "run" || sp === "trail" ? "runc" : sp === "bike" ? "bikec" : sp === "hike" ? "hikec" : sp === "gym" ? "gymc" : "restc";
const SPORT_NAME = { run: "Run", trail: "Trail run", bike: "Ride", hike: "Hike", gym: "Gym", other: "Other" };

const ICONS_UI = {
  sliders: `<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6"/></svg>`,
  coach: `<svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 4.5-3.2 7.3-8 9-4.8-1.7-8-4.5-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>`,
};
const CAT_META = {
  strength:       { label: "Strength", color: "var(--cy)" },
  improvement:    { label: "Improvement", color: "var(--cy)" },
  recommendation: { label: "Recommendation", color: "var(--sand)" },
  recovery:       { label: "Recovery alert", color: "var(--bad)" },
  trend:          { label: "Performance trend", color: "var(--sub)" },
};
function coachMini(i) {
  const c = CAT_META[i.category] || CAT_META.trend;
  return `<div class="cmini"><span class="cdot" style="background:${c.color}"></span><span><b>${esc(i.title)}</b> ${esc(i.body)}</span></div>`;
}

const DAY_LABEL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
                    fri: "Friday", sat: "Saturday", sun: "Sunday" };
const WORKOUT_TOGGLES = [
  ["easyRun", "Easy run", "the aerobic base"],
  ["runTempo", "Tempo run", "steady Z3 efforts"],
  ["runIntervals", "Speed repeats", "Z4 interval runs"],
  ["runHills", "Hill repeats", "short uphill surges"],
  ["longRun", "Long run", "the weekend distance"],
  ["trailRun", "Trail run", "off-road, with climbing"],
  ["easyRide", "Easy ride", "aerobic spin"],
  ["bikeIntervals", "Sweet spot", "Z3–Z4 ride intervals"],
  ["bikeClimb", "Climbing ride", "long sustained climbs"],
  ["longRide", "Long ride", "the weekend distance"],
  ["gymStrength", "Gym strength", "resistance + circuits"],
  ["gymCardio", "Gym cardio", "conditioning finishers"],
  ["gymMobility", "Mobility", "warm-ups + cooldowns"],
];
const RUN_BASE = ["easyRun", "runTempo", "runIntervals", "runHills", "longRun", "trailRun"];
const RIDE_BASE = ["easyRide", "bikeIntervals", "bikeClimb", "longRide"];
const GYM_BASE = ["gymStrength", "gymCardio", "gymMobility"];

/* Workout-type tags on logs (v1.1). Purely descriptive — no plan math. */
const LOG_TYPES = {
  run:   [["easy", "Easy"], ["tempo", "Tempo"], ["intervals", "Intervals"], ["hills", "Hills"], ["long", "Long"]],
  trail: [["easy", "Easy"], ["long", "Long"], ["intervals", "Intervals"]],
  bike:  [["easy", "Easy"], ["climb", "Climbing"], ["intervals", "Intervals"], ["long", "Long"]],
  hike:  [["easy", "Hike"], ["long", "Big day"]],
};
const TYPE_NAME = {
  run:   { easy: "Easy run", tempo: "Tempo run", intervals: "Interval run", hills: "Hill run", long: "Long run" },
  trail: { easy: "Trail run", long: "Long trail run", intervals: "Trail intervals" },
  bike:  { easy: "Easy ride", climb: "Climbing ride", intervals: "Interval ride", long: "Long ride" },
  hike:  { easy: "Hike", long: "Big hike" },
};
function logTitle(l) {
  return TYPE_NAME[l.sport]?.[l.type] || SPORT_NAME[l.sport] || (l.sport[0].toUpperCase() + l.sport.slice(1));
}

/* Per-session evaluation tag (v1.2): a coloured verdict from the engine. */
const EVAL_DOT = { green: "var(--cy)", yellow: "var(--sub)", red: "var(--bad)", none: "var(--mut)" };
function evalOf(log, plannedSession = null) {
  if (!log || !["run", "trail", "bike"].includes(log.sport)) return null;
  return E.evaluateSession(log, { bounds: bounds(), logs: doc.logs, plannedSession });
}
function evalChip(log, plannedSession = null) {
  const e = evalOf(log, plannedSession);
  if (!e) return "";
  return `<span class="eval-chip"><i style="background:${EVAL_DOT[e.rpeBand]}"></i>${esc(e.verdict)}</span>`;
}

function kindLabel(s) {
  if (s.sport === "rest") return "Rest";
  if (s.sport === "gym") return s.venue === "gym" ? "Gym workout" : "Home workout";
  if (s.kind === "long") return "Long ride";
  if (s.kind === "quality") {
    const t = E.QUALITY_TEMPLATES[s.qualityTemplate];
    if (t) return t.name;
    return s.sport === "run" ? "Run intervals" : "Ride intervals";
  }
  return s.sport === "run" ? "Easy run" : "Easy ride";
}

const bounds = () => E.zoneBounds(doc.settings);
function zoneInfo(s) {
  const b = bounds();
  const t = s.qualityTemplate ? E.QUALITY_TEMPLATES[s.qualityTemplate] : null;
  if (t && t.sport === "bike" && t.family === "intervals") {
    return { label: "Z3–Z4", lo: b[2].lo, hi: b[3].hi, cls: "zc3" };
  }
  const z = s.zone || 2;
  return { label: `Zone ${z}`, lo: b[z - 1].lo, hi: b[z - 1].hi, cls: `zc${z}` };
}

/* Quality unlock state — the engine's gate, or wide open when the user
   flipped the manual override in Settings. */
function qstate() {
  if (doc.settings.qualityOverride) {
    return { run: true, bike: true, override: true,
             progress: { done: 3, needed: 3, sinceRun: 2 } };
  }
  return E.qualityState(weekHistory());
}

/* ---------------- overlays ---------------- */

const overlayRoot = () => $("#overlay-root");

function closeOverlay() {
  overlayRoot().innerHTML = "";
}
function openSheet(html) {
  overlayRoot().innerHTML =
    `<div class="scrim"></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  const scrim = overlayRoot().querySelector(".scrim");
  const sheet = overlayRoot().querySelector(".sheet");
  scrim.addEventListener("click", closeOverlay);
  requestAnimationFrame(() => {
    scrim.classList.add("show");
    sheet.classList.add("show");
  });
  wireSheetDrag(sheet, scrim);
  return sheet;
}

/* Swipe-down to dismiss. The drag engages after 8 px so taps on buttons
   inside still click; gestures starting on text inputs are left alone. */
function wireSheetDrag(sheet, scrim) {
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  sheet.addEventListener("pointerdown", e => {
    // ignore inputs and the reorder drag-handle, so dragging a card down
    // reorders the list instead of swiping the sheet away
    if (e.target.closest("input, select, textarea, [data-drag]")) return;
    if (sheet.scrollTop > 0) return;
    startY = e.clientY; dy = 0; dragging = false; t0 = performance.now();
    sheet.addEventListener("pointermove", onMove);
    sheet.addEventListener("pointerup", onUp);
    sheet.addEventListener("pointercancel", onUp);
  });
  function onMove(e) {
    dy = Math.max(0, e.clientY - startY);
    if (!dragging && dy > 8) {
      dragging = true;
      sheet.setPointerCapture(e.pointerId);
      sheet.style.transition = "none";
    }
    if (dragging) {
      sheet.style.transform = `translateX(-50%) translateY(${dy}px)`;
      scrim.style.opacity = String(Math.max(0, 1 - dy / 320));
    }
  }
  function onUp(e) {
    sheet.removeEventListener("pointermove", onMove);
    sheet.removeEventListener("pointerup", onUp);
    sheet.removeEventListener("pointercancel", onUp);
    if (!dragging) return;
    sheet.addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); },
      { capture: true, once: true });
    const fast = dy > 40 && (performance.now() - t0) < 250;
    sheet.style.transition = "";
    if (dy > 100 || fast) {
      sheet.style.transform = `translateX(-50%) translateY(110%)`;
      scrim.style.opacity = "0";
      setTimeout(closeOverlay, 240);
    } else {
      sheet.style.transform = "";
      scrim.style.opacity = "";
    }
  }
}
function openModal(title, body, buttons) {
  overlayRoot().innerHTML =
    `<div class="scrim show"></div><div class="modal" role="alertdialog">
       <h2>${title}</h2><p>${body}</p>
       ${buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-mi="${i}">${b.label}</button>`).join("")}
     </div>`;
  overlayRoot().querySelector(".scrim").addEventListener("click", closeOverlay);
  buttons.forEach((b, i) => {
    overlayRoot().querySelector(`[data-mi="${i}"]`).addEventListener("click", () => {
      closeOverlay();
      b.fn && b.fn();
    });
  });
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function persist(mutate) {
  mutate && mutate();
  autoBumpMaxHR();
  S.save(doc);
  render();
}

/* Raise max HR when an activity shows a higher one (opt-out in Settings). */
function autoBumpMaxHR() {
  if (!doc.settings.maxHRAuto) return;
  const obs = E.observedMaxHR(doc.logs);
  if (obs && obs > doc.settings.maxHR) {
    doc.settings.maxHR = obs;
    toast(`Max HR raised to ${obs} from your activity`);
  }
}

/* ---------------- plan state helpers ---------------- */

const lastWeek = () => doc.weeks[doc.weeks.length - 1];
function currentWeek() {
  const t = todayISO();
  return doc.weeks.find(w => t >= w.startDate && t <= E.addDays(w.startDate, 6)) || null;
}
function weekIndex(w) { return doc.weeks.findIndex(x => x.id === w.id); }

/* Logs of a (run-or-trail / bike) on a date, excluding seed. */
function dayLogsFor(date, sport) {
  const match = sport === "run" ? E.isRunType : l => l.sport === sport;
  return doc.logs.filter(l => l.date === date && l.source !== "seed" && match(l));
}
function logFor(date, sport) { return dayLogsFor(date, sport)[0]; }

/* Which planned slot of this sport+day is `s` (0,1…) — for two-a-days. */
function sessionSlotIndex(week, s) {
  return week.sessions.filter(x => x.sport === s.sport && x.day === s.day).indexOf(s);
}
function sessionStatus(week, s) {
  const date = E.dateOfDay(week, s.day);
  if (s.sport === "rest") return { kind: "rest", date };
  const logs = dayLogsFor(date, s.sport);
  const log = logs[sessionSlotIndex(week, s)] || (logs.length === 1 ? logs[0] : null);
  if (log) return { kind: "done", log, date };
  if (s.skipped) return { kind: "skipped", date };
  if (date === todayISO()) return { kind: "today", date };
  if (date < todayISO()) return { kind: "pending", date };
  return { kind: "planned", date };
}

function checkinFor(week) { return doc.checkins.find(c => c.weekId === week.id); }
function checkinDue() {
  const w = lastWeek();
  if (!w || checkinFor(w)) return null;
  if (todayISO() >= E.dateOfDay(w, "sun")) return w;
  return null;
}

/* History of completed weeks for the unlock state machine. */
function weekHistory() {
  const t = todayISO();
  return doc.weeks
    .filter(w => E.addDays(w.startDate, 6) < t)
    .map(w => {
      const ci = checkinFor(w);
      return {
        completion: ci ? ci.completion : E.weekCompletion(w, doc.logs),
        feel: ci ? ci.feel : undefined,
        isDeload: w.isDeload,
      };
    });
}

/* ---------------- boot ---------------- */

function boot() {
  try { doc = S.load(); }
  catch (e) { renderCorrupt(e.raw); return; }
  if (!doc) { renderFirstRun(); return; }
  start();
}

function start() {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  document.querySelectorAll("nav .tab").forEach(b =>
    b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#fab").addEventListener("click", openUnplannedLog);
  // remember the Diary scroll position within the session
  window.addEventListener("scroll", () => { if (tab === "week") diaryScroll = window.scrollY; }, { passive: true });
  setTab("today");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function renderFirstRun() {
  const def = E.snapToMonday(todayISO());
  document.body.insertAdjacentHTML("beforeend", `
    <div class="firstrun"><div class="wrap">
      <img class="fr-logo" src="./icons/logo-full.png" alt="Stephan Endurance — Plan. Perform. Progress.">
      <p class="note-sub">Your run + bike rebuild, on this phone and nowhere else. Easy weeks first, growth when you've earned it, deload every 4th week.</p>
      <div class="card">
        <div class="lab" style="margin-bottom:8px">Plan start</div>
        <div class="frow" style="border:none"><span class="l">Week 1 begins</span>
          <input type="date" id="fr-date" value="${def}"></div>
        <p class="row-sub" style="margin-top:6px">Weeks run Monday–Sunday — your pick snaps to a Monday.</p>
      </div>
      <button class="btn" id="fr-go">Start week 1</button>
      <p class="row-sub">Pre-loaded with your Garmin history (weight, VO₂, recent activities). Everything is editable later.</p>
    </div></div>`);
  $("#fr-go").addEventListener("click", () => {
    const v = $("#fr-date").value || def;
    doc = S.initDoc(E.snapToMonday(v), todayISO());
    S.save(doc);
    document.querySelector(".firstrun").remove();
    start();
    toast(`Week 1 starts ${fmtShort(doc.weeks[0].startDate)}`);
  });
}

function renderCorrupt(raw) {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="firstrun"><div class="wrap">
      <h1 style="font-size:24px;letter-spacing:.1em">Stored data won't parse</h1>
      <p class="note-sub">Something corrupted the saved data. Copy or download the raw text below first — it may be recoverable — then reset.</p>
      <textarea readonly>${esc(raw)}</textarea>
      <button class="btn ghost" id="cr-dl">Download raw data</button>
      <button class="btn danger" id="cr-reset">Reset the app</button>
    </div></div>`);
  $("#cr-dl").addEventListener("click", () => download(`remonte-raw-${todayISO()}.txt`, raw));
  $("#cr-reset").addEventListener("click", () =>
    openModal("Reset everything?", "The saved data will be deleted from this phone.", [
      { label: "Reset", cls: "danger", fn: () => { S.wipe(); location.reload(); } },
      { label: "Cancel", cls: "ghost" },
    ]));
}

/* ---------------- render dispatch ---------------- */

function setTab(name) {
  tab = name;
  document.querySelectorAll(".tab-page").forEach(p => p.classList.toggle("on", p.dataset.page === name));
  document.querySelectorAll("nav .tab").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  window.scrollTo(0, 0);
  render();
}

function render() {
  $("#fab").hidden = tab !== "week"; // the log-activity FAB lives on the Diary tab
  const cd = $("#coachdot");
  if (cd) cd.hidden = !(checkinDue() || hasFreshCoach()); // program + insights now on Coach
  renderBanner();
  ({ today: renderToday, week: renderDiary, progress: renderProgress, coach: renderCoach, settings: renderSettings })[tab]();
}

/* A badge on the Coach tab when there's an undismissed high-impact insight. */
function hasFreshCoach() {
  try {
    return E.coachInsights({ doc, todayISO: todayISO() })
      .some(i => i.impact * i.confidence >= 0.5);
  } catch { return false; }
}

/* ---------------- COACH ---------------- */

/* Program-adherence streak — a banner at the top of the Coach tab. */
function streakBlock() {
  const adh = E.programAdherence({ weeks: doc.weeks, logs: doc.logs, todayISO: todayISO() });
  return `<div class="card">
    <div class="hd"><span class="eyebrow">Program streak</span><span class="eyebrow tapx">${adh.adherence != null ? `${Math.round(adh.adherence * 100)}% adherence` : "following the plan"}</span></div>
    <div class="stat"><span class="midnum">${adh.current}</span><span class="unit">day streak · best ${adh.longest}</span></div>
    <div class="streakgrid">
      <div><b>${adh.sessionsRow}</b><span>sessions in a row</span></div>
      <div><b>${adh.weeksRow}</b><span>full weeks</span></div>
      <div><b>${adh.restRespected}</b><span>rests kept</span></div>
      <div><b>${adh.missed}</b><span>missed</span></div>
    </div>
    <p class="row-sub" style="margin-top:8px">Counts following your plan — completed sessions, respected rest days — not just any activity.</p></div>`;
}

function renderCoach() {
  const page = $('[data-page="coach"]');
  const ins = E.coachInsights({ doc, todayISO: todayISO() });
  const groups = ["recovery", "recommendation", "improvement", "strength", "trend"];
  const GROUP_TITLE = { recovery: "Recovery alerts", recommendation: "Recommendations",
    improvement: "Improvements", strength: "Strengths", trend: "Performance trends" };

  const week = currentWeek() || lastWeek();
  const due = checkinDue();
  let body = streakBlock() + (week ? programSection(week, due) : `<h1 class="page">Coach</h1>`) +
    `<div class="eyebrow" style="margin:14px 2px 2px">Your coach</div>
     <p class="row-sub" style="margin:2px 2px 6px">Reviewed offline from your own data after every workout and week.</p>`;
  if (!ins.length) {
    body += `<div class="card pc"><p class="row-sub">Nothing to flag yet — keep logging runs, rides, weigh-ins and RPE, and your coach will start spotting trends, risks and wins.</p></div>`;
  } else {
    for (const g of groups) {
      const items = ins.filter(i => i.category === g);
      if (!items.length) continue;
      body += `<div class="cgroup"><div class="gh">${GROUP_TITLE[g]}</div>`;
      for (const i of items) {
        const c = CAT_META[i.category] || CAT_META.trend;
        body += `<div class="card coachcard"><div class="cc-top"><span class="cdot" style="background:${c.color}"></span>
          <b>${esc(i.title)}</b><button class="cc-x" data-dismiss="${esc(i.id)}" aria-label="Dismiss">×</button></div>
          <p class="cc-body">${esc(i.body)}</p>
          <p class="cc-why">${esc(i.why || "")}</p>
          ${i.action ? `<button class="btn mini" data-act="${esc(i.id)}">${ACTION_LABEL[i.action.kind] || "Apply"}</button>` : ""}
          ${i.logId ? `<button class="btn ghost mini" data-pbid="${esc(i.logId)}">See the activity</button>` : ""}</div>`;
      }
      body += `</div>`;
    }
  }
  page.innerHTML = body;
  if (week) wireProgram(page, week, due);

  page.querySelectorAll("[data-dismiss]").forEach(b => b.addEventListener("click", () => {
    persist(() => { doc.coachDismissed = { ...doc.coachDismissed, [b.dataset.dismiss]: todayISO() }; });
  }));
  page.querySelectorAll("[data-pbid]").forEach(b => b.addEventListener("click", () => {
    const log = doc.logs.find(l => l.id === b.dataset.pbid); if (!log) return;
    openLogSheet({ date: log.date, sport: log.sport, log, title: logTitle(log) });
  }));
  page.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => {
    const insight = ins.find(i => i.id === b.dataset.act);
    if (insight) applyCoachAction(insight);
  }));
}

const ACTION_LABEL = { addQuality: "Add an interval session", addTempo: "Add a tempo session",
  addEasyVolume: "Add easy volume", insertRecoveryDay: "Make a day easy" };

function applyCoachAction(insight) {
  const week = currentWeek() || lastWeek();
  if (!week) { toast("No active week"); return; }
  const kind = insight.action.kind;
  const confirm = (msg, fn) => openModal("Apply this?", msg, [
    { label: "Do it", fn }, { label: "Not now", cls: "ghost" }]);

  if (kind === "addEasyVolume") {
    const bikes = week.sessions.filter(s => s.sport === "bike").length;
    const runs = week.sessions.filter(s => s.sport === "run").length;
    if (runs + bikes >= 6) { toast("Week's already full — try next week"); return; }
    confirm("Add one easy ride to this week, placed on your freshest day?", () => changeMix(week, runs, bikes + 1));
  } else if (kind === "addQuality" || kind === "addTempo") {
    confirm(kind === "addTempo" ? "Set this week's quality run to a tempo session?" : "Add an interval session to this week?", () => {
      persist(() => {
        if (!doc.settings.qualityOverride && !qstate().run) doc.settings.qualityOverride = true;
        const idx = weekIndex(week);
        const q = qstate();
        const allow = doc.settings.allowedTypes;
        const { week: nw } = E.relayoutWeek({
          week, runCount: week.sessions.filter(s => s.sport === "run").length,
          bikeCount: week.sessions.filter(s => s.sport === "bike").length,
          restDay: doc.settings.restDay, quality: { run: q.run || true, bike: q.bike },
          runQTemplate: kind === "addTempo" ? "runTempo" : E.qualityTemplateFor(doc.weeks.slice(0, idx), "run", allow),
          bikeQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "bike", allow),
          climbTarget: E.climbTargetAscent({ logs: doc.logs, weekNum: week.weekNum, settings: doc.settings }),
        });
        doc.weeks[idx] = nw;
      });
      toast("Done — check the Week tab");
    });
  } else if (kind === "insertRecoveryDay") {
    confirm("Turn this week's hardest remaining session into an easy one?", () => {
      persist(() => {
        const hard = week.sessions.filter(s => s.kind === "quality" || s.kind === "long")
          .sort((a, b) => b.targetMin - a.targetMin)[0];
        if (hard) { hard.kind = "easy"; hard.zone = 2; delete hard.qualityTemplate; delete hard.targetAscent; }
        week.targetMin = { run: E.sumSessions(week.sessions, "run"), bike: E.sumSessions(week.sessions, "bike") };
      });
      toast("Eased the hardest session");
    });
  }
}

function renderBanner() {
  const slot = $("#banner-slot");
  const since = doc.settings.lastExportAt || doc.createdAt;
  const days = Math.floor((E.parseISO(todayISO()) - E.parseISO(since)) / 864e5);
  if (days > 30 && !sessionStorage.getItem("bannerOff")) {
    slot.innerHTML = `<div class="banner"><span style="flex:1">${doc.settings.lastExportAt ? `Last backup ${days} days ago` : "No backup yet"} — your data lives only on this phone.</span><button id="bn-x" aria-label="dismiss">✕</button><button id="bn-go">Export</button></div>`;
    $("#bn-go").addEventListener("click", exportJSON);
    $("#bn-x").addEventListener("click", () => { sessionStorage.setItem("bannerOff", "1"); renderBanner(); });
  } else slot.innerHTML = "";
}

/* ---------------- TODAY ---------------- */

function renderToday() {
  const page = $('[data-page="today"]');
  const t = todayISO();
  const week = currentWeek();
  const due = checkinDue();

  let head = `<div class="phead"><div><div class="eyebrow">${fmtDate(t)}${week ? ` · <span class="cyt">Week ${week.weekNum}</span>` : ""}</div><h1 class="page">Today</h1></div><button class="iconbtn" id="td-plus" aria-label="Do a workout">＋</button></div>`;

  if (!week) {
    if (doc.weeks[0] && t < doc.weeks[0].startDate) {
      page.innerHTML = head + `<div class="card">
        <div class="t-chips"><span class="chip restc">BEFORE WEEK 1</span></div>
        <p class="note-sub">Week 1 starts <b>${fmtDate(doc.weeks[0].startDate)}</b>. Until then anything counts — tap ＋ to do a workout, or log it from the Diary.</p></div>`;
      $("#td-plus")?.addEventListener("click", openAdhocWorkout);
      return;
    }
    page.innerHTML = head + `<div class="card">
      <div class="t-chips"><span class="chip runc">PICK UP</span></div>
      <p class="note-sub">Pick up where you left off — close out your last week and the next one appears, starting this Monday.</p>
      <div class="t-actions"><button class="btn" id="td-checkin">Do the check-in</button></div></div>`;
    $("#td-checkin")?.addEventListener("click", () => openCheckin(due || lastWeek()));
    $("#td-plus")?.addEventListener("click", openAdhocWorkout);
    return;
  }

  const todayDay = E.DAYS[E.dayIndex(t)];
  const daySessions = week.sessions.filter(x => x.day === todayDay);
  const s = daySessions.find(x => x.sport !== "rest" && sessionStatus(week, x).kind !== "done") || daySessions[0];
  const st = sessionStatus(week, s);
  const second = daySessions.filter(x => x !== s && x.sport !== "rest");
  let card = "";

  if (s.sport === "rest") {
    card = `<div class="card">
      <div class="t-chips"><span class="chip restc">REST</span></div>
      <div class="bignum" style="font-size:44px">Rest day</div>
      <p class="t-note">The adaptation happens today. ${due ? "One thing left: the weekly check-in." : "See you tomorrow."}</p>
      ${due ? `<div class="t-actions"><button class="btn" id="td-checkin">Sunday check-in</button></div>` : ""}
    </div>`;
  } else if (st.kind === "done") {
    const l = st.log;
    card = `<div class="card">
      <div class="t-chips"><span class="chip ${sportClass(s.sport)}">${kindLabel(s).toUpperCase()}</span><span class="chip zc2">DONE ✓</span></div>
      <div class="bignum">${l.min}<small>min logged</small></div>
      <p class="t-note">${[l.km ? `${l.km} km` : "", l.km && l.sport === "run" ? E.fmtPace(l.min * 60 / l.km) + " /km" : "", l.ascent ? `${l.ascent} m ↑` : "", l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ") || "Nice. That's the whole job."}</p>
      ${evalChip(l, s)}
      <div class="t-actions"><button class="btn ghost" id="td-edit">Edit this log</button></div>
    </div>`;
  } else if (s.sport === "gym") {
    const venue = s.venue || "home";
    card = `<div class="card">
      <div class="t-chips"><span class="chip gymc">${s.kind === "quality" ? "GYM · QUALITY" : "GYM"}</span><span class="chip zc2">${venue === "gym" ? "AT THE GYM" : "AT HOME"}</span>${st.kind === "skipped" ? `<span class="chip restc">SKIPPED</span>` : ""}</div>
      <div class="bignum">${s.targetMin}<small>min</small></div>
      <div class="t-block"><div class="lab">Workout</div>
        <div class="t-pace-v">A full-body ${venue === "gym" ? "gym" : "home"} session. Open it to see today's exercises, run the timer, swap moves, or switch home ↔ gym.</div></div>
      ${second.length ? `<p class="row-sub" style="margin-top:10px">＋ also today: ${esc(second.map(x => kindLabel(x) + " · " + x.targetMin + " min").join(" · "))}</p>` : ""}
      <div class="t-actions">
        <button class="btn" id="td-workout">Open workout</button>
        ${st.kind !== "skipped" ? `<button class="btn ghost" id="td-skip">Skip today</button>` : ""}
      </div></div>`;
  } else {
    const z = zoneInfo(s);
    const tpl = s.qualityTemplate ? E.QUALITY_TEMPLATES[s.qualityTemplate] : null;
    const pace = s.sport === "run" ? E.paceHint(doc.logs, bounds(), s.kind === "quality" ? 4 : 2, doc.settings.easyPace) : null;
    card = `<div class="card">
      <div class="t-chips"><span class="chip ${sportClass(s.sport)}">${kindLabel(s).toUpperCase()}</span><span class="chip ${z.cls}">${z.label.toUpperCase()}</span>${st.kind === "skipped" ? `<span class="chip restc">SKIPPED</span>` : ""}</div>
      <div class="bignum">${s.targetMin}<small>min</small></div>
      <div class="t-block"><div class="lab">Heart rate target</div>
        <div class="midnum">${z.lo}–${z.hi} <span class="unit">bpm</span></div></div>
      ${tpl ? `<div class="t-block"><div class="lab">Session</div>
        <div class="t-pace-v">${tpl.label}</div>
        ${s.targetAscent ? `<p class="row-sub" style="margin-top:3px;color:var(--sand)">Target climb ≈ ${s.targetAscent} m of ascent</p>` : ""}
        <p class="row-sub" style="margin-top:3px">${E.QUALITY_WARMUP}</p></div>` : ""}
      ${pace && !tpl ? `<div class="t-block"><div class="lab">Pace · estimate</div>
        <div class="t-pace-v">≈ ${E.fmtPace(pace.lo)}–${E.fmtPace(pace.hi)} /km <span>${pace.learned ? `learned from your last ${pace.n} easy runs` : pace.manual ? "your pace setting — easy runs will tune this" : "starting estimate — easy runs tune this"}</span></div></div>` : ""}
      ${s.note ? `<p class="row-sub" style="margin-top:10px">${esc(s.note)}</p>` : ""}
      ${s.kind === "easy" && s.sport === "run" ? `<p class="t-note">Keep it conversational — walk breaks are fine. Same heart rate, faster pace is how the engine comes back.</p>` : ""}
      ${s.kind === "long" ? `<p class="t-note">Steady and unhurried — this ride is the week's anchor.</p>` : ""}
      ${second.length ? `<p class="row-sub" style="margin-top:10px">＋ also today: ${esc(second.map(x => kindLabel(x) + " · " + x.targetMin + " min").join(" · "))}</p>` : ""}
      <div class="t-actions">
        <button class="btn" id="td-log">Log this session</button>
        <button class="btn ghost" id="td-edit-s">Adjust / send to watch</button>
        ${st.kind !== "skipped" ? `<button class="btn ghost" id="td-skip">Skip today</button>` : ""}
      </div>
    </div>`;
  }

  // quiet one-tap for an unlogged yesterday — never a guilt banner
  let yLink = "";
  const yDate = E.addDays(t, -1);
  const yWeek = doc.weeks.find(w => yDate >= w.startDate && yDate <= E.addDays(w.startDate, 6));
  if (yWeek) {
    const ys = yWeek.sessions.find(x => x.day === E.DAYS[E.dayIndex(yDate)] && x.sport !== "rest");
    if (ys && !logFor(yDate, ys.sport) && !ys.skipped) {
      yLink = `<button class="linkrow" id="td-yest">Yesterday's ${SPORT_NAME[ys.sport].toLowerCase()} isn't logged — add it in 30 s →</button>`;
    }
  }

  const dots = week.sessions.map(x => {
    const xs = sessionStatus(week, x);
    const cls = xs.kind === "done" ? "f" : xs.kind === "skipped" ? "s" : xs.kind === "today" ? "t" : "";
    return `<span class="d ${cls}"></span>`;
  }).join("");
  const doneN = week.sessions.filter(x => sessionStatus(week, x).kind === "done").length;
  const totN = week.sessions.filter(x => x.sport !== "rest").length;

  page.innerHTML = head + card + yLink +
    `<div class="weekmini">${dots}&nbsp; Week ${week.weekNum} · ${doneN} of ${totN} done</div>`;

  $("#td-log")?.addEventListener("click", () =>
    openLogSheet({ date: t, sport: s.sport, prefillMin: s.targetMin, title: kindLabel(s), type: typeOfSession(s) }));
  $("#td-edit")?.addEventListener("click", () =>
    openLogSheet({ date: t, sport: s.sport, log: st.log, title: kindLabel(s) }));
  $("#td-edit-s")?.addEventListener("click", () => openSessionEditor(week, s, st));
  $("#td-workout")?.addEventListener("click", () => openWorkoutPage(week, s, t));
  $("#td-plus")?.addEventListener("click", openAdhocWorkout);
  $("#td-skip")?.addEventListener("click", () => openSkip(week, s));
  $("#td-checkin")?.addEventListener("click", () => openCheckin(due || week));
  $("#td-yest")?.addEventListener("click", () => {
    const ys = yWeek.sessions.find(x => x.day === E.DAYS[E.dayIndex(yDate)] && x.sport !== "rest");
    if (ys) openLogSheet({ date: yDate, sport: ys.sport, prefillMin: ys.targetMin, title: kindLabel(ys), type: typeOfSession(ys) });
  });
}

/* ---------------- logging ---------------- */

function openLogSheet({ date, sport, prefillMin = 45, title = "", log = null, type = null }) {
  const isEdit = !!log;
  let min = isEdit ? log.min : prefillMin;
  let rpe = isEdit ? (log.rpe || null) : null;
  let typ = isEdit ? (log.type || null) : (type || (sport !== "other" ? "easy" : null));
  const typeRow = LOG_TYPES[sport] ? `
    <div class="type-row"><span class="l">Type</span><span class="opts">${LOG_TYPES[sport].map(([k, lab]) =>
      `<button data-ty="${k}" class="${typ === k ? "on" : ""}">${lab}</button>`).join("")}</span></div>` : "";
  const isGym = sport === "gym";
  // edit mode: let the user fix a mis-entered sport (any sport; fields adapt)
  const activityRow = isEdit ? `
    <div class="type-row"><span class="l">Activity</span><span class="opts">${[["run", "Run"], ["trail", "Trail"], ["bike", "Ride"], ["hike", "Hike"], ["gym", "Gym"], ["other", "Other"]].map(([v, l]) =>
      `<button data-lgsp="${v}" class="${sport === v ? "on" : ""}">${l}</button>`).join("")}</span></div>` : "";
  let venue = isEdit ? (log.venue || "home") : "home";
  const venueRow = isGym ? `
    <div class="frow"><span class="l">Where</span>
      <span class="unitseg" style="margin-left:auto"><button class="useg ${venue === "home" ? "on" : ""}" data-venue="home">Home</button><button class="useg ${venue === "gym" ? "on" : ""}" data-venue="gym">Gym</button></span></div>` : "";
  const elev = sport === "bike" || sport === "trail" || sport === "hike";
  const elevRows = elev ? `
    <div class="frow"><span class="l">Ascent</span><input type="text" inputmode="numeric" id="lg-asc" placeholder="—" value="${isEdit && log.ascent != null ? log.ascent : ""}"><span class="suffix">m ↑</span></div>
    <div class="frow"><span class="l">Descent</span><input type="text" inputmode="numeric" id="lg-desc" placeholder="—" value="${isEdit && log.descent != null ? log.descent : ""}"><span class="suffix">m ↓</span></div>` : "";
  const sheet = openSheet(`
    <div class="sh-title">${isEdit ? "Edit" : "Log"} · ${esc(title || sport)}</div>
    <div class="sh-sub">${fmtDate(date)}${isEdit ? "" : " — pre-filled with the plan"}</div>
    ${activityRow}
    <div class="frow"><span class="l">Duration</span>
      <span class="stepper"><button data-d="-1">−</button><input type="text" inputmode="numeric" class="v dur" id="lg-min" value="${min}"><span class="suffix">min</span><button data-d="1">+</button></span></div>
    ${typeRow}
    ${venueRow}
    ${isGym ? "" : `<div class="frow"><span class="l">Distance</span><input type="text" step="0.01" inputmode="decimal" id="lg-km" placeholder="—" value="${isEdit && log.km != null ? log.km : ""}"><span class="suffix">km</span></div>`}
    ${elevRows}
    <div class="frow"><span class="l">Avg heart rate</span><input type="text" inputmode="numeric" id="lg-hr" placeholder="—" value="${isEdit && log.avgHR != null ? log.avgHR : ""}"><span class="suffix">bpm</span></div>
    <div class="frow"><span class="l">Max HR</span><input type="text" inputmode="numeric" id="lg-maxhr" placeholder="—" value="${isEdit && log.maxHR != null ? log.maxHR : ""}"><span class="suffix">bpm</span></div>
    <div class="frow"><span class="l">Calories</span><input type="text" inputmode="numeric" id="lg-cal" placeholder="—" value="${isEdit && log.calories != null ? log.calories : ""}"><span class="suffix">kcal</span></div>
    <div class="rpe-row"><span class="l">RPE</span>${Array.from({ length: 10 }, (_, i) =>
      `<button data-rpe="${i + 1}" class="${rpe === i + 1 ? "on" : ""}">${i + 1}</button>`).join("")}</div>
    <div class="frow"><span class="l">Note</span><input type="text" id="lg-note" placeholder="optional" value="${isEdit ? esc(log.note || "") : ""}"></div>
    <button class="btn" id="lg-save">${isEdit ? "Save changes" : "Save session"}</button>
    ${isEdit ? `<button class="btn danger" id="lg-del">Delete this log</button>` : ""}
  `);
  const minInput = sheet.querySelector("#lg-min");
  const readMin = () => { const v = Math.round(num(minInput.value) ?? min); return Math.max(1, v || 1); };
  sheet.querySelectorAll("[data-lgsp]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.lgsp === sport) return;
    closeOverlay();
    openLogSheet({ date, sport: b.dataset.lgsp, log, title: SPORT_NAME[b.dataset.lgsp] || b.dataset.lgsp });
  }));
  sheet.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => {
    minInput.value = Math.max(1, readMin() + parseInt(b.dataset.d, 10));
  }));
  sheet.querySelectorAll("[data-ty]").forEach(b => b.addEventListener("click", () => {
    typ = b.dataset.ty;
    sheet.querySelectorAll("[data-ty]").forEach(x => x.classList.toggle("on", x.dataset.ty === typ));
  }));
  sheet.querySelectorAll("[data-venue]").forEach(b => b.addEventListener("click", () => {
    venue = b.dataset.venue;
    sheet.querySelectorAll("[data-venue]").forEach(x => x.classList.toggle("on", x.dataset.venue === venue));
  }));
  sheet.querySelectorAll("[data-rpe]").forEach(b => b.addEventListener("click", () => {
    rpe = rpe === +b.dataset.rpe ? null : +b.dataset.rpe;
    sheet.querySelectorAll("[data-rpe]").forEach(x => x.classList.toggle("on", +x.dataset.rpe === rpe));
  }));
  sheet.querySelector("#lg-save").addEventListener("click", () => {
    min = readMin();
    const kmEl = sheet.querySelector("#lg-km");
    const km = kmEl ? num(kmEl.value) : null;
    const hr = num(sheet.querySelector("#lg-hr").value);
    const mhr = num(sheet.querySelector("#lg-maxhr").value);
    const asc = sheet.querySelector("#lg-asc") ? num(sheet.querySelector("#lg-asc").value) : null;
    const desc = sheet.querySelector("#lg-desc") ? num(sheet.querySelector("#lg-desc").value) : null;
    const cal = num(sheet.querySelector("#lg-cal").value);
    const note = sheet.querySelector("#lg-note").value.trim();
    closeOverlay();
    persist(() => {
      if (isEdit) {
        Object.assign(log, { sport, min, km: km ?? undefined, avgHR: hr ?? undefined, maxHR: mhr ?? undefined,
                             ascent: asc ?? undefined, descent: desc ?? undefined, calories: cal ?? undefined,
                             rpe: rpe ?? undefined, note: note || undefined, type: typ ?? undefined,
                             venue: isGym ? venue : undefined });
      } else {
        doc.logs.push({ id: S.uid(), date, sport, min, km: km ?? undefined,
                        avgHR: hr ?? undefined, maxHR: mhr ?? undefined, ascent: asc ?? undefined,
                        descent: desc ?? undefined, calories: cal ?? undefined, rpe: rpe ?? undefined,
                        note: note || undefined, type: typ ?? undefined,
                        venue: isGym ? venue : undefined, source: "manual" });
        doc.logs.sort((a, b) => (a.date < b.date ? -1 : 1));
      }
    });
    toast(isEdit ? "Updated ✓" : "Logged ✓");
  });
  sheet.querySelector("#lg-del")?.addEventListener("click", () => {
    closeOverlay();
    openModal("Delete this log?", `${fmtShort(log.date)} · ${log.sport} · ${log.min} min`, [
      { label: "Delete", cls: "danger", fn: () => { persist(() => { doc.logs = doc.logs.filter(l => l.id !== log.id); }); toast("Deleted"); } },
      { label: "Keep it", cls: "ghost" },
    ]);
  });
}

function openUnplannedLog() {
  let sport = "run";
  const sheet = openSheet(`
    <div class="sh-title">Log an activity</div>
    <div class="sh-sub">Unplanned sessions count too — "other" stays out of the plan math</div>
    <div class="seg" id="ul-sport" style="flex-wrap:wrap">
      <button data-sp="run" class="on">Run</button><button data-sp="trail">Trail</button><button data-sp="bike">Ride</button><button data-sp="hike">Hike</button><button data-sp="gym">Gym</button><button data-sp="other">Other</button></div>
    <div class="frow"><span class="l">Date</span><input type="date" id="ul-date" value="${todayISO()}" max="${todayISO()}"></div>
    <button class="btn" id="ul-next">Continue</button>
  `);
  sheet.querySelectorAll("[data-sp]").forEach(b => b.addEventListener("click", () => {
    sport = b.dataset.sp;
    sheet.querySelectorAll("[data-sp]").forEach(x => x.classList.toggle("on", x === b));
  }));
  sheet.querySelector("#ul-next").addEventListener("click", () => {
    const date = sheet.querySelector("#ul-date").value || todayISO();
    closeOverlay();
    openLogSheet({ date, sport, prefillMin: 45, title: sport === "bike" ? "Ride" : sport[0].toUpperCase() + sport.slice(1) });
  });
}

/* ---------------- skip flow ---------------- */

function openSkip(week, s) {
  const t = todayISO();
  const restDays = week.sessions.filter(x =>
    x.sport === "rest" && E.dateOfDay(week, x.day) > t);
  const buttons = [];
  if (restDays.length) {
    buttons.push({ label: "Move it to another day", fn: () => pickMoveDay(week, s, restDays) });
  }
  buttons.push({
    label: "Drop it — gone, no debt", cls: "ghost",
    fn: () => { persist(() => { s.skipped = true; }); toast("Dropped. Tomorrow's a new day."); },
  });
  buttons.push({ label: "Cancel", cls: "ghost" });
  openModal(`Skip ${kindLabel(s).toLowerCase()}?`,
    restDays.length ? "Move it onto a free day this week, or let it go." : "No free days left this week — dropping it is fine.",
    buttons);
}

function pickMoveDay(week, s, restDays) {
  const sheet = openSheet(`
    <div class="sh-title">Move to…</div>
    <div class="sh-sub">Free days this week</div>
    ${restDays.map(r => `<button class="srow" data-day="${r.day}"><span class="l">${fmtDate(E.dateOfDay(week, r.day))}</span><span class="chev">›</span></button>`).join("")}
  `);
  sheet.querySelectorAll("[data-day]").forEach(b => b.addEventListener("click", () => {
    const targetDay = b.dataset.day;
    const doMove = () => {
      persist(() => {
        const rest = week.sessions.find(x => x.day === targetDay);
        const oldDay = s.day;
        s.day = targetDay;
        rest.day = oldDay;
        week.sessions.sort((a, x) => E.DAYS.indexOf(a.day) - E.DAYS.indexOf(x.day));
      });
      toast(`Moved to ${fmtShort(E.dateOfDay(week, targetDay))}`);
    };
    closeOverlay();
    if (s.sport === "run") {
      const layout = {};
      week.sessions.forEach(x => { layout[x.day === s.day ? targetDay : x.day] = x.sport === "run" ? "run" : x.sport; });
      layout[s.day] = "rest"; layout[targetDay] = "run";
      if (E.consecutiveRunDays(layout).length && !doc.settings.warnedRunAdjacency) {
        openModal("Back-to-back runs", "This puts two runs on consecutive days. At current load that's the main injury risk — sure?", [
          { label: "Move anyway", fn: () => { doc.settings.warnedRunAdjacency = true; doMove(); } },
          { label: "Leave it", cls: "ghost" },
        ]);
        return;
      }
    }
    doMove();
  }));
}

/* ---------------- WEEK ---------------- */

/* The training program for one week: totals, the editable day list, the
   coming-weeks projection and the Sunday check-in. Rendered on the Coach tab. */
function programSection(week, due) {
  const end = E.addDays(week.startDate, 6);
  const runDone = Math.min(week.targetMin.run, sportLogged(week, "run"));
  const bikeDone = Math.min(week.targetMin.bike, sportLogged(week, "bike"));

  const dayRows = week.sessions.map((s, i) => {
    const st = sessionStatus(week, s);
    const d = E.parseISO(st.date).getUTCDate();
    const dn = s.day.toUpperCase();
    let sub = "", stIcon = "";
    if (st.kind === "done") {
      const l = st.log;
      const tyTag = l.type && l.type !== "easy" ? (l.type === "climb" ? "climbing" : l.type) : "";
      sub = [tyTag, `${l.min} min`, l.km ? `${l.km} km` : "", E.isRunType(l) && l.km ? E.fmtPace(l.min * 60 / l.km) + " /km" : "", l.ascent ? `${l.ascent} m↑` : "", l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ");
      stIcon = `<span class="st done"><svg viewBox="0 0 24 24"><path d="M5 13l4.2 4L19 7"/></svg></span>`;
    } else if (st.kind === "skipped") {
      sub = "skipped — gone, no debt";
      stIcon = `<span class="st skip"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></span>`;
    } else if (st.kind === "today") {
      if (s.sport === "gym") sub = `today · ${s.venue === "gym" ? "gym" : "home"} workout — tap to open`;
      else { const z = zoneInfo(s); sub = `today · ${z.label} · ${z.lo}–${z.hi} bpm`; }
      stIcon = `<span class="st now"></span>`;
    } else if (st.kind === "pending") {
      sub = "not logged yet";
      stIcon = `<span class="st pend"></span>`;
    } else if (st.kind === "rest") {
      sub = due && s.day === "sun" ? "check-in is open" : week.isDeload ? "deload — recover on purpose" : "check-in opens here Sunday";
      stIcon = `<span class="st" style="background:none"></span>`;
    } else if (s.sport === "gym") {
      sub = `${s.venue === "gym" ? "Gym" : "Home"} · full-body${s.kind === "quality" ? " · harder day" : ""}`;
      stIcon = `<span class="st plan"></span>`;
    } else {
      const z = zoneInfo(s);
      sub = s.qualityTemplate ? E.QUALITY_TEMPLATES[s.qualityTemplate].label : `${z.label} · ${z.lo}–${z.hi} bpm`;
      stIcon = `<span class="st plan"></span>`;
    }
    const icon = ICONS[s.sport === "rest" ? "rest" : s.sport];
    return `<button class="day ${st.kind === "today" ? "today" : ""}" data-di="${i}" ${s.sport === "rest" ? "disabled" : ""}>
      <span class="dt"><b>${d}</b><span>${dn}</span></span>
      <span class="ic ${sportClass(s.sport)}">${icon}</span>
      <span class="tx"><b>${kindLabel(s)}${s.targetMin ? ` · ${s.targetMin} min` : ""}</b><span>${sub}</span></span>
      ${stIcon}</button>`;
  }).join("");

  return `
    <div><div class="eyebrow">${fmtShort(week.startDate)} – ${fmtShort(end)}${week.isDeload ? ` · <span style="color:var(--sand)">DELOAD</span>` : ""}</div>
    <h1 class="page">Week ${week.weekNum}</h1></div>
    ${due ? `<button class="card" id="wk-checkin" style="display:flex;gap:12px;align-items:center;border-color:rgba(86,219,232,.35)">
       <span style="flex:1;text-align:left"><b>Sunday check-in is open</b><br><span class="row-sub">2 minutes: weight, feel, next week's volume</span></span>
       <span class="chip runc">GO →</span></button>` : ""}
    <div class="card" style="padding:13px 16px"><div class="tot">
      <div class="row"><span class="nm">Run</span><span class="bar"><i style="width:${pct(runDone, week.targetMin.run)}%;background:var(--cy)"></i></span><span class="qty">${sportLogged(week, "run")} / ${week.targetMin.run} min</span></div>
      <div class="row"><span class="nm">Ride</span><span class="bar"><i style="width:${pct(bikeDone, week.targetMin.bike)}%;background:var(--bike)"></i></span><span class="qty">${sportLogged(week, "bike")} / ${week.targetMin.bike} min</span></div>
      ${week.targetMin.gym > 0 ? `<div class="row"><span class="nm">Gym</span><span class="bar"><i style="width:${pct(sportLogged(week, "gym"), week.targetMin.gym)}%;background:#c98bdb"></i></span><span class="qty">${sportLogged(week, "gym")} / ${week.targetMin.gym} min</span></div>` : ""}
    </div></div>
    <div class="card days">${dayRows}</div>
    ${comingWeeksCard()}
    <button class="btn ghost mini" id="wk-watch">Export this week to watch (.FIT)</button>`;
}
function wireProgram(page, week, due) {
  page.querySelectorAll("[data-di]").forEach(b => b.addEventListener("click", () => {
    const s = week.sessions[+b.dataset.di];
    const st = sessionStatus(week, s);
    if (st.kind === "done") openLogSheet({ date: st.date, sport: s.sport, log: st.log, title: kindLabel(s), type: typeOfSession(s) });
    else if (s.sport === "gym") openWorkoutPage(week, s, st.date || E.dateOfDay(week, s.day));
    else openSessionEditor(week, s, st);
  }));
  $("#wk-checkin")?.addEventListener("click", () => openCheckin(due));
  $("#wk-watch")?.addEventListener("click", () => exportWeekToWatch(week));
}

/* The Diary (was the Week tab): a day-by-day calendar of what you actually did
   each week (same layout as the Coach program), steppable with ◀ ▶, then the
   full activity history below, paginated. */
let diaryWeekOffset = 0, diaryScroll = 0, diaryPage = 0, diaryFilterSport = "all", diaryFilterMonth = "all";
function logExtra(l) {
  return [l.km ? `${l.km} km` : "",
    l.km && l.sport === "run" ? E.fmtPace(l.min * 60 / l.km) + " /km" : "",
    l.km && l.sport === "bike" ? (l.km / (l.min / 60)).toFixed(1) + " km/h" : "",
    l.ascent ? `${l.ascent} m ↑` : "", l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ");
}
function hrow(l) {
  const extra = logExtra(l);
  return `<button class="hrow" data-id="${l.id}">
    <span class="ic ${sportClass(l.sport)}" style="width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center">${ICONS[l.sport] || ICONS.other}</span>
    <span class="hd2"><b>${logTitle(l)} · ${l.min} min</b><span>${fmtShort(l.date)}${extra ? " · " + extra : ""}${l.note ? " · " + esc(l.note) : ""}</span></span>
    <span class="src">${(l.source || "manual").toUpperCase()}</span></button>`;
}
function renderDiary() {
  const page = $('[data-page="week"]');
  const t = todayISO();
  const mon = E.addDays(t, -E.dayIndex(t));
  const from = E.addDays(mon, -7 * diaryWeekOffset), to = E.addDays(from, 6);
  const sum = E.weekSummary(doc.logs, bounds(), from, to);

  // day-by-day calendar for the selected week — same layout as the Coach program
  const dayCal = E.DAYS.map((dy, i) => {
    const date = E.addDays(from, i);
    const dd = E.parseISO(date).getUTCDate(), dn = dy.toUpperCase(), isToday = date === t;
    const dayLogs = doc.logs.filter(l => l.date === date);
    if (!dayLogs.length) {
      const future = date > t;
      return `<div class="day rest"><span class="dt"><b>${dd}</b><span>${dn}</span></span>
        <span class="ic restc">${ICONS.rest}</span>
        <span class="tx"><b style="color:var(--mut)">${future ? "—" : "Rest"}</b><span>${future ? "upcoming" : "nothing logged"}</span></span></div>`;
    }
    return dayLogs.map((l, j) => {
      const extra = logExtra(l);
      return `<button class="day ${isToday ? "today" : ""}" data-lid="${l.id}">
        <span class="dt">${j === 0 ? `<b>${dd}</b><span>${dn}</span>` : ""}</span>
        <span class="ic ${sportClass(l.sport)}">${ICONS[l.sport] || ICONS.other}</span>
        <span class="tx"><b>${logTitle(l)} · ${l.min} min</b><span>${extra || "done"}</span></span>
        <span class="st done"><svg viewBox="0 0 24 24"><path d="M5 13l4.2 4L19 7"/></svg></span></button>`;
    }).join("");
  }).join("");
  // per-sport summary for the selected week — a bar per performed sport (length
  // ∝ time), with the week's total time, distance and calories underneath
  const DSPORTS = [["run", "Run", "var(--cy)"], ["trail", "Trail", "#56dbe8"], ["bike", "Ride", "#8e9df8"], ["hike", "Hike", "#7fd6c0"], ["gym", "Gym", "#c98bdb"], ["other", "Other", "var(--mut)"]];
  const perf = DSPORTS.filter(([sp]) => sum.bySport[sp] && sum.bySport[sp].count);
  const maxMin = Math.max(1, ...perf.map(([sp]) => sum.bySport[sp].min));
  const sumBars = perf.map(([sp, lab, col]) => {
    const s = sum.bySport[sp];
    return `<div class="row"><span class="nm">${lab}</span><span class="bar"><i style="width:${Math.max(4, Math.round(s.min / maxMin * 100))}%;background:${col}"></i></span><span class="qty">${s.count}× · ${fmtDur(s.min)}</span></div>`;
  }).join("");
  const summaryCard = sum.total.count
    ? `<div class="card" style="padding:13px 16px"><div class="tot">${sumBars}</div>
        <div class="wktot">${fmtDur(sum.total.min)}${sum.total.km ? ` · ${sum.total.km.toFixed(1)} km` : ""}${sum.total.cal ? ` · ${Math.round(sum.total.cal).toLocaleString()} kcal` : ""}</div></div>`
    : `<div class="card"><p class="row-sub">Nothing logged ${diaryWeekOffset === 0 ? "this week yet" : "that week"} — tap ＋ to add an activity.</p></div>`;

  // full activity history with type + month filters, newest first, paginated
  const all = [...doc.logs].sort((a, b) => (a.date > b.date ? -1 : 1));
  const months = [...new Set(all.map(l => l.date.slice(0, 7)))].sort().reverse();
  if (diaryFilterMonth !== "all" && !months.includes(diaryFilterMonth)) diaryFilterMonth = "all";
  let filtered = all;
  if (diaryFilterSport !== "all") filtered = filtered.filter(l => (l.sport || "other") === diaryFilterSport);
  if (diaryFilterMonth !== "all") filtered = filtered.filter(l => l.date.slice(0, 7) === diaryFilterMonth);
  const filtering = diaryFilterSport !== "all" || diaryFilterMonth !== "all";
  const PER = 50, pages = Math.max(1, Math.ceil(filtered.length / PER));
  diaryPage = Math.max(0, Math.min(diaryPage, pages - 1));
  const slice = filtered.slice(diaryPage * PER, diaryPage * PER + PER);
  const label = diaryWeekOffset === 0 ? "This week" : diaryWeekOffset === 1 ? "Last week" : `${diaryWeekOffset} weeks ago`;
  const SPORTS = [["run", "Run"], ["trail", "Trail"], ["bike", "Ride"], ["hike", "Hike"], ["gym", "Gym"], ["other", "Other"]];
  const monthLabel = m => fmtDate(m + "-01", { month: "short", year: "numeric" });

  page.innerHTML = `
    <div class="phead"><h1 class="page">Diary</h1></div>
    <div class="diary-nav">
      <button class="iconbtn sm" id="dy-prev" aria-label="earlier">‹</button>
      <span class="dy-label">${label}<small>${fmtShort(from)} – ${fmtShort(to)}</small></span>
      <button class="iconbtn sm" id="dy-next" aria-label="later" ${diaryWeekOffset <= 0 ? "disabled" : ""}>›</button>
    </div>
    ${summaryCard}
    <div class="card days">${dayCal}</div>
    <div class="eyebrow" style="margin:8px 2px 2px">All activity · ${filtered.length}${filtering ? ` of ${all.length}` : ""}</div>
    <div class="diary-filter">
      <select id="df-sport" class="rangesel"><option value="all">All types</option>${SPORTS.map(([v, l]) => `<option value="${v}" ${diaryFilterSport === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select id="df-month" class="rangesel"><option value="all">All months</option>${months.map(m => `<option value="${m}" ${diaryFilterMonth === m ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
    </div>
    <div class="card hlist">${slice.map(hrow).join("") || `<p class="row-sub" style="padding:10px 0">${filtering ? "No activities match this filter." : "Nothing yet — your logged activities show here."}</p>`}</div>
    ${pages > 1 ? `<div class="diary-nav">
      <button class="iconbtn sm" id="hp-prev" ${diaryPage <= 0 ? "disabled" : ""} aria-label="previous page">‹</button>
      <span class="dy-label">Page ${diaryPage + 1} of ${pages}</span>
      <button class="iconbtn sm" id="hp-next" ${diaryPage >= pages - 1 ? "disabled" : ""} aria-label="next page">›</button>
    </div>` : ""}
    <div style="height:76px"></div>`;
  $("#dy-prev").addEventListener("click", () => { diaryWeekOffset++; renderDiary(); });
  $("#dy-next").addEventListener("click", () => { if (diaryWeekOffset > 0) { diaryWeekOffset--; renderDiary(); } });
  $("#df-sport").addEventListener("change", e => { diaryFilterSport = e.target.value; diaryPage = 0; renderDiary(); });
  $("#df-month").addEventListener("change", e => { diaryFilterMonth = e.target.value; diaryPage = 0; renderDiary(); });
  $("#hp-prev")?.addEventListener("click", () => { if (diaryPage > 0) { diaryPage--; renderDiary(); } });
  $("#hp-next")?.addEventListener("click", () => { if (diaryPage < pages - 1) { diaryPage++; renderDiary(); } });
  const openLog = id => { diaryScroll = window.scrollY; const log = doc.logs.find(l => l.id === id); if (log) openLogSheet({ date: log.date, sport: log.sport, log, title: logTitle(log) }); };
  page.querySelectorAll("[data-lid]").forEach(b => b.addEventListener("click", () => openLog(b.dataset.lid)));
  page.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => openLog(b.dataset.id)));
  requestAnimationFrame(() => window.scrollTo(0, diaryScroll));
}

const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;
function sportLogged(week, sport) {
  const end = E.addDays(week.startDate, 6);
  const match = sport === "run" ? E.isRunType : l => l.sport === sport;
  return doc.logs.filter(l => match(l) && l.source !== "seed" &&
    l.date >= week.startDate && l.date <= end).reduce((a, l) => a + (l.min || 0), 0);
}

function changeMix(week, runCount, bikeCount, gymCount = null) {
  const idx = weekIndex(week);
  const prev = idx > 0 ? doc.weeks[idx - 1] : null;
  const qs = qstate();
  const ci = doc.checkins.find(c => c.weekId === week.id);
  const allow = doc.settings.allowedTypes;
  const gym = gymCount == null ? week.sessions.filter(s => s.sport === "gym").length : gymCount;
  const { week: newWeek, warnings } = E.relayoutWeek({
    week, runCount, bikeCount, gymCount: gym,
    prevRunMin: prev ? prev.targetMin.run : null,
    restDay: doc.settings.restDay,
    quality: ci?.noQuality ? { run: false, bike: false } : { run: qs.run, bike: qs.bike },
    runQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "run", allow),
    bikeQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "bike", allow),
    climbTarget: E.climbTargetAscent({ logs: doc.logs, weekNum: week.weekNum, settings: doc.settings }),
    gymVenue: doc.settings.gymVenueDefault || "home",
    gymHard: allow.gymStrength !== false,
  });
  const apply = () => {
    persist(() => {
      doc.weeks[idx] = newWeek;
      // counts become the source of truth; keep the derived layout in sync
      doc.settings.weeklyCounts = { run: runCount, bike: bikeCount, gym };
      doc.settings.layout = E.placeLayout({ run: runCount, bike: bikeCount, gym, restDay: doc.settings.restDay });
    });
    toast(`${runCount} run · ${bikeCount} ride${gym ? ` · ${gym} gym` : ""}`);
  };
  if (warnings.includes("consecutive-runs") && !doc.settings.warnedRunAdjacency) {
    openModal("Back-to-back runs", "This mix forces runs on consecutive days — the main injury risk at current load. Keep it anyway?", [
      { label: "Keep it", fn: () => { doc.settings.warnedRunAdjacency = true; apply(); } },
      { label: "Undo", cls: "ghost" },
    ]);
  } else apply();
}

/* The weekly-mix control (moved here from the Week tab): run / ride / gym
   counts. Applies via changeMix, which reschedules and stores the counts. */
function openWeeklyMix(week) {
  // works even before the plan's first week starts — fall back to the next/first
  week = week || currentWeek() || doc.weeks.find(w => E.addDays(w.startDate, 6) >= todayISO()) || doc.weeks[doc.weeks.length - 1];
  if (!week) { toast("No plan week yet"); return; }
  const cur = doc.settings.weeklyCounts || { run: 3, bike: 3, gym: 0 };
  let r = week.sessions.filter(s => s.sport === "run").length || cur.run;
  let b = week.sessions.filter(s => s.sport === "bike").length || cur.bike;
  let g = week.sessions.filter(s => s.sport === "gym").length;
  const gymOn = doc.settings.allowedTypes.gymStrength !== false || doc.settings.allowedTypes.gymCardio !== false || doc.settings.allowedTypes.gymMobility !== false;
  const sheet = openSheet(`
    <div class="sh-title">Weekly mix</div>
    <div class="sh-sub">How many of each, per week. They're scheduled around your rest day automatically — fine-tune individual days in the layout editor.</div>
    <div class="mixrow" data-k="run"><span class="l">Runs</span><span class="ud"><button data-d="-1">−</button><b id="mx-run">${r}</b><button data-d="1">+</button></span></div>
    <div class="mixrow" data-k="bike"><span class="l">Rides</span><span class="ud"><button data-d="-1">−</button><b id="mx-bike">${b}</b><button data-d="1">+</button></span></div>
    <div class="mixrow" data-k="gym"><span class="l">Gym workouts${gymOn ? "" : " <i class='row-sub'>· enable in Workouts allowed</i>"}</span><span class="ud"><button data-d="-1">−</button><b id="mx-gym">${g}</b><button data-d="1">+</button></span></div>
    <p class="row-sub" id="mx-note"></p>
    <button class="btn" id="mx-save">Apply to this week</button>
  `);
  const clamp = v => Math.max(0, Math.min(6, v));
  const refresh = () => {
    sheet.querySelector("#mx-run").textContent = r;
    sheet.querySelector("#mx-bike").textContent = b;
    sheet.querySelector("#mx-gym").textContent = g;
    const tot = r + b + g;
    sheet.querySelector("#mx-note").textContent = tot === 0 ? "Add at least one session." :
      tot > 6 ? `${tot} sessions — the extras stack as a second session on your freshest day.` : "";
    sheet.querySelector("#mx-save").disabled = tot === 0;
  };
  sheet.querySelectorAll(".mixrow").forEach(row => row.querySelectorAll("[data-d]").forEach(btn => btn.addEventListener("click", () => {
    const d = +btn.dataset.d, k = row.dataset.k;
    if (k === "run") r = clamp(r + d); else if (k === "bike") b = clamp(b + d); else g = clamp(g + d);
    refresh();
  })));
  refresh();
  sheet.querySelector("#mx-save").addEventListener("click", () => { closeOverlay(); changeMix(week, r, b, g); });
}

/* Re-lay a week around the current rest day / counts (used after moving the
   rest day). Mutates doc.weeks in place — call inside persist(). */
function reflowWeek(week) {
  if (!week) return;
  const idx = weekIndex(week);
  const qs = qstate();
  const ci = doc.checkins.find(c => c.weekId === week.id);
  const allow = doc.settings.allowedTypes;
  const runs = week.sessions.filter(s => s.sport === "run").length;
  const bikes = week.sessions.filter(s => s.sport === "bike").length;
  const { week: nw } = E.relayoutWeek({
    week, runCount: runs, bikeCount: bikes, restDay: doc.settings.restDay,
    quality: ci?.noQuality ? { run: false, bike: false } : { run: qs.run, bike: qs.bike },
    runQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "run", allow),
    bikeQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "bike", allow),
    climbTarget: E.climbTargetAscent({ logs: doc.logs, weekNum: week.weekNum, settings: doc.settings }),
  });
  doc.weeks[idx] = nw;
}

/* When a workout family is toggled off, swap any planned session of that
   family in the current week to the next allowed one (or to easy). */
function applyAllowedToCurrentWeek() {
  const week = currentWeek() || lastWeek();
  if (!week) return;
  const allow = doc.settings.allowedTypes;
  const idx = weekIndex(week);
  const famKeyOf = t => t.sport === "run"
    ? { intervals: "runIntervals", tempo: "runTempo", hills: "runHills" }[t.family]
    : { intervals: "bikeIntervals", climb: "bikeClimb" }[t.family];
  for (const s of week.sessions) {
    if (s.kind !== "quality" || !s.qualityTemplate) continue;
    const t = E.QUALITY_TEMPLATES[s.qualityTemplate];
    if (allow[famKeyOf(t)] === false) {
      const repl = E.qualityTemplateFor(doc.weeks.slice(0, idx), s.sport, allow);
      if (repl) { s.qualityTemplate = repl; s.zone = E.QUALITY_TEMPLATES[repl].zone;
                  if (repl !== "bikeClimb") delete s.targetAscent; }
      else { s.kind = "easy"; s.zone = 2; delete s.qualityTemplate; delete s.targetAscent; }
    }
  }
  week.targetMin = { run: E.sumSessions(week.sessions, "run"), bike: E.sumSessions(week.sessions, "bike") };
}

function openRestDaySheet() {
  const st = doc.settings;
  const sheet = openSheet(`
    <div class="sh-title">Rest day</div>
    <div class="sh-sub">Pick your day off — the week's sessions redistribute around it.</div>
    ${E.DAYS.map(d => `<button class="srow" data-rd="${d}"><span class="l">${DAY_LABEL[d]}</span>${st.restDay === d ? `<span class="v" style="color:var(--cy)">current</span>` : `<span class="chev">›</span>`}</button>`).join("")}
  `);
  sheet.querySelectorAll("[data-rd]").forEach(b => b.addEventListener("click", () => {
    const day = b.dataset.rd;
    closeOverlay();
    if (day === st.restDay) return;
    persist(() => {
      const runs = E.DAYS.filter(d => st.layout[d] === "run").length || 3;
      const bikes = E.DAYS.filter(d => st.layout[d] === "bike" || st.layout[d] === "bike-long").length || 3;
      st.restDay = day;
      st.layout = E.placeLayout(runs, bikes, day);
      reflowWeek(currentWeek() || lastWeek());
    });
    toast(`Rest day → ${DAY_LABEL[day]}`);
  }));
}

function unlockCard() {
  const qs = qstate();
  let pips, text;
  if (qs.override) {
    pips = [true, true, true, true];
    text = `<b>Intervals unlocked manually</b> — the consistency gate is off (Settings → Plan).`;
  } else if (!qs.run) {
    pips = [0, 1, 2].map(i => i < qs.progress.done).concat([null]);
    text = `<b>Intervals unlock after 3 consistent weeks — ${qs.progress.done} done.</b> Easy weeks now buy harder sessions later.`;
  } else if (!qs.bike) {
    pips = [true, qs.progress.sinceRun >= 1, qs.progress.sinceRun >= 2, null];
    text = `<b>Run intervals unlocked.</b> Ride intervals after ${2 - qs.progress.sinceRun} more consistent week${2 - qs.progress.sinceRun === 1 ? "" : "s"}.`;
  } else {
    pips = [true, true, true, true];
    text = `<b>Intervals unlocked</b> — one quality run and one quality ride per week, never on deloads.`;
  }
  return `<div class="card unlock" style="padding:13px 16px">
    <span class="pips">${pips.map(p => `<i class="${p ? "f" : ""}"></i>`).join("")}</span>
    <p>${text}</p></div>`;
}

/* Read-only projection of the next 3 weeks at the default growth rate. */
function comingWeeksCard() {
  if (!doc.weeks.length) return "";
  const q = qstate();
  const proj = E.projectWeeks({ weeks: doc.weeks, settings: doc.settings,
                                quality: { run: q.run, bike: q.bike }, logs: doc.logs });
  if (!proj.length) return "";
  const ratePct = Math.round(doc.settings.growthRate * 100);
  return `<div class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin-bottom:10px">Coming weeks</div>
    ${proj.map(p => `<div class="cw">
      <span class="d"><b>W${p.weekNum}</b><span>${fmtShort(p.startDate)}</span></span>
      <span class="t"><b>${fmtDur(p.total)}</b><span>run ${fmtDur(p.run)} · ride ${fmtDur(p.bike)}</span></span>
      ${p.isDeload ? `<span class="chip" style="color:var(--sand);border-color:rgba(230,211,163,.35)">DELOAD</span>`
        : p.hasQuality ? `<span class="chip zc4">intervals</span>` : ""}
    </div>`).join("")}
    <p class="row-sub" style="margin-top:9px">Projection at your default +${ratePct} % — each week is set for real at the Sunday check-in.</p>
  </div>`;
}

/* The planned session's workout type, used to prefill the log sheet. */
function typeOfSession(s) {
  if (!s || s.sport === "rest") return null;
  if (s.kind === "long") return "long";
  if (s.kind === "quality") return E.QUALITY_TEMPLATES[s.qualityTemplate]?.family || "intervals";
  return "easy";
}

/* Workout-type options per sport for the per-session editor. Each maps to a
   {kind, qualityTemplate?} the session takes on. Gated by allowedTypes. */
function sessionTypeOptions(sport) {
  const a = doc.settings.allowedTypes || {};
  if (sport === "run") return [
    a.easyRun !== false && { id: "easy", label: "Easy", kind: "easy" },
    a.runTempo !== false && { id: "runTempo", label: "Tempo", kind: "quality", tpl: "runTempo" },
    a.runIntervals !== false && { id: "runQ1", label: "Intervals", kind: "quality", tpl: "runQ1" },
    a.runHills !== false && { id: "runHills", label: "Hills", kind: "quality", tpl: "runHills" },
    a.longRun !== false && { id: "long", label: "Long", kind: "long" },
  ].filter(Boolean);
  return [
    a.easyRide !== false && { id: "easy", label: "Easy", kind: "easy" },
    a.bikeIntervals !== false && { id: "bikeQ1", label: "Sweet spot", kind: "quality", tpl: "bikeQ1" },
    a.bikeClimb !== false && { id: "bikeClimb", label: "Climb", kind: "quality", tpl: "bikeClimb" },
    a.longRide !== false && { id: "long", label: "Long", kind: "long" },
  ].filter(Boolean);
}
function currentTypeId(s) {
  if (s.kind === "quality") return s.qualityTemplate;
  if (s.kind === "long") return "long";
  return "easy";
}

/* Full per-session editor: change duration, zone, type, climb target, note;
   log it, or send the structured workout to a Garmin watch (.FIT). */
function openSessionEditor(week, s, st) {
  const a = doc.settings.allowedTypes || {};
  const activities = [
    RUN_BASE.some(k => a[k] !== false) && { sport: "run", label: "Run" },
    RIDE_BASE.some(k => a[k] !== false) && { sport: "bike", label: "Ride" },
    GYM_BASE.some(k => a[k] !== false) && { sport: "gym", label: "Gym" },
  ].filter(Boolean);
  const opts = sessionTypeOptions(s.sport);
  let chosen = opts.find(o => o.id === currentTypeId(s)) || opts[0];
  let dur = s.targetMin, zone = s.zone || 2;
  const sheet = openSheet(`
    <div class="sh-title">${fmtDate(st.date)}</div>
    <div class="sh-sub">${SPORT_NAME[s.sport]} session — adjust anything, or switch the activity</div>
    ${activities.length > 1 ? `<div class="type-row"><span class="l">Activity</span><span class="opts" id="se-act">${activities.map(act =>
      `<button data-actsw="${act.sport}" class="${act.sport === s.sport ? "on" : ""}">${act.label}</button>`).join("")}</span></div>` : ""}
    <div class="type-row"><span class="l">Type</span><span class="opts" id="se-types">${opts.map(o =>
      `<button data-se="${o.id}" class="${o.id === chosen.id ? "on" : ""}">${o.label}</button>`).join("")}</span></div>
    <div class="frow"><span class="l">Duration</span>
      <span class="stepper"><button data-d="-5">−</button><input type="text" inputmode="numeric" class="v dur" id="se-min" value="${dur}"><span class="suffix">min</span><button data-d="5">+</button></span></div>
    <div class="type-row"><span class="l">Target zone</span><span class="opts" id="se-zones">${[1,2,3,4,5].map(z =>
      `<button data-z="${z}" class="${z === zone ? "on" : ""}">Z${z}</button>`).join("")}</span></div>
    <div class="frow" id="se-climb-row" ${chosen.id === "bikeClimb" ? "" : "hidden"}><span class="l">Climb target</span><input type="text" inputmode="numeric" id="se-asc" placeholder="—" value="${s.targetAscent || ""}"><span class="suffix">m ↑</span></div>
    <div class="frow"><span class="l">Note</span><input type="text" id="se-note" placeholder="optional" value="${esc(s.note || "")}"></div>
    <div id="se-detail" class="callout"></div>
    <button class="btn" id="se-log">Log this session</button>
    <button class="btn ghost" id="se-watch">Send to watch (.FIT)</button>
    <button class="btn ghost" id="se-save">Save changes</button>
  `);
  const minInput = sheet.querySelector("#se-min");
  const readMin = () => Math.max(5, Math.round(num(minInput.value) ?? dur) || 5);
  const refresh = () => {
    const climb = chosen.id === "bikeClimb";
    sheet.querySelector("#se-climb-row").hidden = !climb;
    const tpl = chosen.tpl ? E.QUALITY_TEMPLATES[chosen.tpl] : null;
    sheet.querySelector("#se-detail").innerHTML = tpl
      ? `${esc(tpl.label)}<br><span class="row-sub">${E.QUALITY_WARMUP}</span>`
      : `Keep it ${chosen.id === "long" ? "steady and unhurried" : "conversational"} at Z${zone}.`;
  };
  refresh();
  const recompute = () => { week.targetMin = { run: E.sumSessions(week.sessions, "run"), bike: E.sumSessions(week.sessions, "bike"), gym: E.sumSessions(week.sessions, "gym") }; };
  sheet.querySelectorAll("[data-actsw]").forEach(b => b.addEventListener("click", () => {
    const ns = b.dataset.actsw;
    if (ns === s.sport) return;
    const keep = readMin();
    if (ns === "gym") {
      closeOverlay();
      persist(() => {
        Object.assign(s, { sport: "gym", kind: "easy", targetMin: E.snapGymMinutes(keep || 45),
          venue: doc.settings.gymVenueDefault || "home",
          gym: { seed: E.hashSeed(`${week.id}-${s.day}-${s.slot ?? 0}`), avoidIds: [], swaps: {} } });
        delete s.zone; delete s.qualityTemplate; delete s.targetAscent; recompute();
      });
      openWorkoutPage(week, s, st.date);
      return;
    }
    closeOverlay();
    persist(() => {
      Object.assign(s, { sport: ns, kind: "easy", zone: 2, targetMin: keep || (ns === "run" ? 35 : 60) });
      delete s.qualityTemplate; delete s.targetAscent; delete s.gym; delete s.venue; recompute();
    });
    openSessionEditor(week, s, sessionStatus(week, s));
  }));
  sheet.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { minInput.value = Math.max(5, readMin() + +b.dataset.d); }));
  sheet.querySelectorAll("[data-se]").forEach(b => b.addEventListener("click", () => {
    chosen = opts.find(o => o.id === b.dataset.se);
    sheet.querySelectorAll("[data-se]").forEach(x => x.classList.toggle("on", x === b));
    zone = chosen.tpl ? E.QUALITY_TEMPLATES[chosen.tpl].zone : (chosen.id === "long" ? 2 : 2);
    sheet.querySelectorAll("[data-z]").forEach(x => x.classList.toggle("on", +x.dataset.z === zone));
    refresh();
  }));
  sheet.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => {
    zone = +b.dataset.z;
    sheet.querySelectorAll("[data-z]").forEach(x => x.classList.toggle("on", x === b));
  }));
  const applyEdits = () => {
    dur = readMin();
    s.targetMin = dur; s.zone = zone; s.kind = chosen.kind;
    if (chosen.kind === "quality") s.qualityTemplate = chosen.tpl; else delete s.qualityTemplate;
    const asc = sheet.querySelector("#se-asc") ? num(sheet.querySelector("#se-asc").value) : null;
    if (chosen.id === "bikeClimb") s.targetAscent = asc ?? E.climbTargetAscent({ logs: doc.logs, weekNum: week.weekNum, settings: doc.settings });
    else delete s.targetAscent;
    const note = sheet.querySelector("#se-note").value.trim();
    s.note = note || undefined;
    recompute();
  };
  sheet.querySelector("#se-save").addEventListener("click", () => { closeOverlay(); persist(applyEdits); toast("Session updated"); });
  sheet.querySelector("#se-log").addEventListener("click", () => {
    applyEdits(); closeOverlay(); S.save(doc);
    openLogSheet({ date: st.date, sport: s.sport, prefillMin: s.targetMin, title: kindLabel(s), type: typeOfSession(s) });
  });
  sheet.querySelector("#se-watch").addEventListener("click", () => { applyEdits(); S.save(doc); sendSessionToWatch(s, st.date); });
}

/* Build + download a .FIT structured workout for one session. */
function sessionFit(s, date) {
  const steps = E.workoutSteps(s, bounds());
  const name = `${kindLabel(s)} ${fmtShort(date)}`.slice(0, 22);
  const bytes = F.encodeWorkout({ name, sport: s.sport === "bike" ? "bike" : "run", steps });
  return { bytes, file: `${date}-${(s.qualityTemplate || s.kind)}.fit` };
}
function sendSessionToWatch(s, date) {
  const { bytes, file } = sessionFit(s, date);
  downloadBytes(file, bytes);
  toast("Workout file ready");
  openModal("Load onto your Garmin", "Open Garmin Connect → Workouts → Import, and pick this .FIT — it syncs to your watch and guides each step. Or copy it into the watch's GARMIN/NEWFILES folder over USB.", [{ label: "Got it", cls: "ghost" }]);
}
function exportWeekToWatch(week) {
  const files = [];
  for (const s of week.sessions) {
    if (s.sport === "rest") continue;
    const { bytes, file } = sessionFit(s, E.dateOfDay(week, s.day));
    files.push({ name: file, data: bytes });
  }
  if (!files.length) { toast("No sessions to export"); return; }
  downloadBytes(`week-${week.startDate}-workouts.zip`, makeZip(files));
  openModal("Week exported", `${files.length} workout files zipped. Unzip, then import each .FIT in Garmin Connect → Workouts → Import (or drop them in the watch's GARMIN/NEWFILES over USB).`, [{ label: "Got it", cls: "ghost" }]);
}
function downloadBytes(filename, bytes) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

function openHistory() {
  const logs = [...doc.logs].sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 50);
  const sheet = openSheet(`
    <div class="sh-title">All activity</div>
    <div class="sh-sub">Last ${logs.length} — tap to edit</div>
    ${logs.map(l => {
      const extra = [l.km ? `${l.km} km` : "",
        l.km && l.sport === "run" ? E.fmtPace(l.min * 60 / l.km) + " /km" : "",
        l.km && l.sport === "bike" ? (l.km / (l.min / 60)).toFixed(1) + " km/h" : "",
        l.ascent ? `${l.ascent} m ↑` : "",
        l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ");
      return `<button class="hrow" data-id="${l.id}">
        <span class="ic ${sportClass(l.sport)}" style="width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center">${ICONS[l.sport] || ICONS.other}</span>
        <span class="hd2"><b>${logTitle(l)} · ${l.min} min</b><span>${fmtShort(l.date)}${extra ? " · " + extra : ""}${l.note ? " · " + esc(l.note) : ""}</span></span>
        <span class="src">${l.source.toUpperCase()}</span></button>`;
    }).join("") || `<p class="note-sub" style="padding:14px 0">Nothing yet.</p>`}
  `);
  sheet.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
    const log = doc.logs.find(l => l.id === b.dataset.id);
    closeOverlay();
    openLogSheet({ date: log.date, sport: log.sport, log, title: logTitle(log) });
  }));
}

/* ---------------- CHECK-IN ---------------- */

function openCheckin(week) {
  if (checkinFor(week)) { toast("Already checked in"); return; }
  const completion = E.weekCompletion(week, doc.logs);
  const state = { step: 1, weightKg: null, feel: null, hrv7d: null, sleep: null, chosenPct: null };
  const lastKg = doc.weighIns.length ? doc.weighIns[doc.weighIns.length - 1].kg : null;

  document.body.insertAdjacentHTML("beforeend", `<div class="checkin" id="checkin"><div class="wrap"></div></div>`);
  const el = $("#checkin");
  requestAnimationFrame(() => el.classList.add("show"));
  const close = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 320); };

  const stepsBar = () => `<div class="steps">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= state.step ? "f" : ""}"></i>`).join("")}</div>`;
  const head = sub => `<div><div class="eyebrow">Week ${week.weekNum} · <span class="cyt">${Math.round(completion * 100)} % complete</span></div>
    <h1 class="page">Check-in</h1>${stepsBar()}<p class="row-sub" style="margin-top:8px">${sub}</p></div>`;
  const navBtns = (nextLabel = "Continue", skippable = false) =>
    `<button class="btn" id="ci-next">${nextLabel}</button>
     ${skippable ? `<button class="btn ghost" id="ci-skip">Skip</button>` : ""}
     <button class="btn ghost" id="ci-back">${state.step === 1 ? "Not now" : "Back"}</button>`;

  function render1() {
    el.querySelector(".wrap").innerHTML = head("Step 1 — weight. Optional, but the trend is half the goal.") + `
      <div class="card"><div class="frow" style="border:none"><span class="l">Weight today</span>
        <input type="text" step="0.1" inputmode="decimal" id="ci-kg" placeholder="${lastKg ?? "—"}" value="${state.weightKg ?? ""}"><span class="suffix">kg</span></div></div>
      ${navBtns("Continue", true)}`;
    wire(() => { state.weightKg = num(el.querySelector("#ci-kg").value); go(2); }, () => go(2));
  }
  function render2() {
    el.querySelector(".wrap").innerHTML = head("Step 2 — how did the week feel?") + `
      <div class="feelgrid">${[["1", "rough"], ["2", "meh"], ["3", "fine"], ["4", "good"], ["5", "great"]].map(([n, w]) =>
        `<button data-feel="${n}" class="${state.feel === +n ? "on" : ""}"><b>${n}</b>${w}</button>`).join("")}</div>
      ${navBtns()}`;
    el.querySelectorAll("[data-feel]").forEach(b => b.addEventListener("click", () => {
      state.feel = +b.dataset.feel;
      el.querySelectorAll("[data-feel]").forEach(x => x.classList.toggle("on", +x.dataset.feel === state.feel));
    }));
    wire(() => { if (!state.feel) { toast("Pick 1–5"); return; } go(3); });
  }
  function render3() {
    el.querySelector(".wrap").innerHTML = head("Step 3 — recovery signals. Both optional.") + `
      <div class="card">
        <div class="frow"><span class="l">HRV · 7-day avg</span><input type="text" inputmode="numeric" id="ci-hrv" placeholder="—" value="${state.hrv7d ?? ""}"><span class="suffix">ms</span></div>
        <div class="frow" style="border:none"><span class="l">Sleep quality</span>
          <span class="seg" style="border:none;padding:0;flex:1;justify-content:flex-end">${[1, 2, 3, 4, 5].map(n =>
            `<button data-sleep="${n}" style="flex:0 0 44px" class="${state.sleep === n ? "on" : ""}">${n}</button>`).join("")}</span></div>
      </div>
      ${navBtns("Continue", true)}`;
    el.querySelectorAll("[data-sleep]").forEach(b => b.addEventListener("click", () => {
      state.sleep = state.sleep === +b.dataset.sleep ? null : +b.dataset.sleep;
      el.querySelectorAll("[data-sleep]").forEach(x => x.classList.toggle("on", +x.dataset.sleep === state.sleep));
    }));
    wire(() => { state.hrv7d = num(el.querySelector("#ci-hrv").value); go(4); }, () => go(4));
  }

  function render4() {
    const rec = E.recommendRate({ completion, feel: state.feel, hrv7d: state.hrv7d, settings: doc.settings });
    const nextNum = doc.weeks.length + 1;
    const startDate = E.nextStartDate(week, todayISO());
    const prevLoad = E.lastLoadWeek(doc.weeks);
    const nextIsDeload = E.isDeloadWeek(nextNum, doc.settings.deloadEvery);
    const history = weekHistory().concat([{ completion, feel: state.feel, isDeload: week.isDeload }]);
    const qs = doc.settings.qualityOverride
      ? { run: true, bike: true, override: true } : E.qualityState(history);
    const recap = `<div class="recap">
      <span class="chip"><b>${Math.round(completion * 100)} %</b>&nbsp;complete</span>
      <span class="chip">felt&nbsp;<b>${state.feel} / 5</b></span>
      ${state.weightKg ? `<span class="chip"><b>${state.weightKg}</b>&nbsp;kg</span>` : ""}
      ${state.hrv7d ? `<span class="chip">HRV&nbsp;<b>${state.hrv7d}</b>&nbsp;ms</span>` : ""}</div>`;

    const allow = doc.settings.allowedTypes;
    const build = ratePct => nextIsDeload
      ? E.deloadWeek({ prevLoadWeek: prevLoad, startDate, weekNum: nextNum })
      : E.planNextWeek({
          prevLoadWeek: prevLoad, chosenRate: ratePct / 100, settings: doc.settings,
          startDate, weekNum: nextNum, logs: doc.logs,
          quality: { run: qs.run, bike: qs.bike }, noQuality: rec.noQuality,
          runQTemplate: E.qualityTemplateFor(doc.weeks, "run", allow),
          bikeQTemplate: E.qualityTemplateFor(doc.weeks, "bike", allow),
        });

    const previewRows = nw => nw.sessions.filter(s => s.sport !== "rest").map(s => {
      const old = week.sessions.find(o => o.day === s.day && o.sport === s.sport);
      return `<div class="pv"><span class="d">${s.day.toUpperCase()}</span><span class="s">${kindLabel(s)}</span>
        <span class="m">${old ? `<span>${old.targetMin} → </span>` : ""}<b>${s.targetMin}</b> <span>min</span></span></div>`;
    }).join("");

    if (nextIsDeload) {
      const nw = build(0);
      el.querySelector(".wrap").innerHTML = head("Step 4 — next week.") + recap + `
        <div class="card prop">
          <div class="eyebrow">Week ${nextNum} · <span style="color:var(--sand)">scheduled deload</span></div>
          <div class="top"><span class="rate" style="color:var(--sand)">60 %</span><span class="rec" style="color:var(--sand);border-color:rgba(230,211,163,.4)">automatic</span></div>
          <p class="why">Every ${ordinal(doc.settings.deloadEvery)} week absorbs the work: everything easy, long ride capped at 90 min. No decision needed.</p>
          <div class="nextline"><span class="midnum">${fmtDur(E.plannedMinutes(nw))}</span><span class="unit">next week · ${fmtDur(E.plannedMinutes(week))} this week</span></div>
          <div class="preview">${previewRows(nw)}</div>
        </div>
        <button class="btn" id="ci-confirm">Lock in week ${nextNum}</button>
        <button class="btn ghost" id="ci-back">Back</button>`;
      el.querySelector("#ci-confirm").addEventListener("click", () => confirm2(rec, 0, nw));
      el.querySelector("#ci-back").addEventListener("click", () => go(3));
      return;
    }

    const recPct = Math.round(rec.rate * 100);
    state.chosenPct = state.chosenPct ?? recPct;
    el.querySelector(".wrap").innerHTML = head("Step 4 — next week's volume. Slide to override.") + recap + `
      <div class="card prop">
        <div class="eyebrow">Week ${nextNum} proposal</div>
        <div class="top"><span class="rate" id="ci-rate"></span><span class="rec" id="ci-rec">recommended</span></div>
        <p class="why">${rec.reason}${rec.noQuality && qs.run ? " Intervals sit out next week." : ""}</p>
        <input type="range" min="-20" max="15" step="1" id="ci-slider" value="${state.chosenPct}" aria-label="volume change">
        <div class="ticks"><span>−20 %</span><span>0</span><span>+15 %</span></div>
        <div class="nextline"><span class="midnum" id="ci-tot"></span><span class="unit">next week · ${fmtDur(E.plannedMinutes(week))} this week</span></div>
        <div class="preview" id="ci-preview"></div>
        <p class="foot">Runs grow max +10 % per week — anything extra goes to the bike.${E.isDeloadWeek(nextNum + 1, doc.settings.deloadEvery) ? ` Week ${nextNum + 1} will be a deload.` : ""}</p>
      </div>
      <button class="btn" id="ci-confirm"></button>
      <button class="btn ghost" id="ci-back">Back</button>`;

    let nw = build(state.chosenPct);
    const update = () => {
      nw = build(state.chosenPct);
      el.querySelector("#ci-rate").textContent = `${state.chosenPct > 0 ? "+" : ""}${state.chosenPct} %`;
      el.querySelector("#ci-rate").style.color = state.chosenPct >= 0 ? "var(--cy)" : "var(--sand)";
      el.querySelector("#ci-rec").style.opacity = state.chosenPct === recPct ? 1 : 0.35;
      el.querySelector("#ci-tot").textContent = fmtDur(E.plannedMinutes(nw));
      el.querySelector("#ci-preview").innerHTML = previewRows(nw);
      el.querySelector("#ci-confirm").textContent = `Lock in week ${nextNum}`;
    };
    update();
    el.querySelector("#ci-slider").addEventListener("input", e => { state.chosenPct = +e.target.value; update(); });
    el.querySelector("#ci-confirm").addEventListener("click", () => confirm2(rec, state.chosenPct / 100, nw));
    el.querySelector("#ci-back").addEventListener("click", () => go(3));
  }

  function confirm2(rec, chosenRate, newWeek) {
    state.step = 5;
    persist(() => {
      doc.checkins.push({
        weekId: week.id, completion: Math.round(completion * 100) / 100,
        feel: state.feel, weightKg: state.weightKg ?? undefined,
        hrv7d: state.hrv7d ?? undefined, sleep: state.sleep ?? undefined,
        recommendedRate: rec.rate, chosenRate, noQuality: rec.noQuality || undefined,
      });
      if (state.weightKg) {
        doc.weighIns = doc.weighIns.filter(w => w.date !== todayISO());
        doc.weighIns.push({ date: todayISO(), kg: state.weightKg });
        doc.weighIns.sort((a, b) => (a.date < b.date ? -1 : 1));
      }
      doc.weeks.push(newWeek);
    });
    close();
    toast(`Week ${newWeek.weekNum} locked in ✓`);
  }

  function wire(onNext, onSkip) {
    el.querySelector("#ci-next")?.addEventListener("click", onNext);
    el.querySelector("#ci-skip")?.addEventListener("click", onSkip);
    el.querySelector("#ci-back")?.addEventListener("click", () => state.step === 1 ? close() : go(state.step - 1));
  }
  function go(n) { state.step = n; [render1, render2, render3, render4][n - 1](); }
  go(1);
}

const ordinal = n => n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10] || "th");

/* ---------------- GYM WORKOUT PAGE ---------------- */

/* Expand a planned gym session into its (deterministic, seed-driven) workout. */
function workoutForSession(s) {
  const st = doc.settings;
  return W.generateGymWorkout({
    minutes: s.targetMin, venue: s.venue || "home",
    equipment: st.equipment || {}, banned: st.bannedExercises || [],
    avoidIds: (s.gym && s.gym.avoidIds) || [], swaps: (s.gym && s.gym.swaps) || {},
    hard: s.kind === "quality", focus: (s.gym && s.gym.focus) || "full", seed: (s.gym && s.gym.seed) || 1,
  });
}

/* Short beep + a vibrate buzz on each work/rest transition. */
let _audio = null;
function beep(freq = 880, ms = 120) {
  try {
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audio.createOscillator(), g = _audio.createGain();
    o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(_audio.destination);
    g.gain.setValueAtTime(0.0008, _audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.28, _audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, _audio.currentTime + ms / 1000);
    o.start(); o.stop(_audio.currentTime + ms / 1000 + 0.02);
  } catch {}
  if (navigator.vibrate) try { navigator.vibrate(55); } catch {}
}

/* Flatten a workout into timer steps. A reps block → self-paced "reps" steps
   with a 45 s rest between sets; a timed block → work/rest countdown steps. */
function workoutSteps(workout) {
  const steps = [];
  for (const b of workout.blocks) {
    const label = W.CATEGORY_LABELS[b.category] || b.category;
    if (b.mode === "reps") {
      for (let n = 1; n <= b.sets; n++) {
        steps.push({ kind: "reps", name: b.name, instr: b.instr, label, setNo: n, sets: b.sets, reps: b.reps, uni: b.unilateral });
        if (n < b.sets) steps.push({ kind: "rest", name: "Rest", sec: 45, label });
      }
    } else {
      for (let r = 0; r < b.rounds; r++) {
        steps.push({ kind: "work", name: b.name, instr: b.instr, sec: b.work, label, round: r + 1, rounds: b.rounds, uni: b.unilateral });
        if (b.rest > 0 && r < b.rounds - 1) steps.push({ kind: "rest", name: "Rest", sec: b.rest, label });
      }
    }
  }
  return steps;
}

/* Fullscreen workout page: overview → live timer → completion log. `session`
   is a live reference inside doc.weeks, so refresh/swap/ban/venue persist. */
function openWorkoutPage(week, session, dateISO) {
  document.body.insertAdjacentHTML("beforeend", `<div class="checkin workoutpg" id="workoutpg"><div class="wrap"></div></div>`);
  const el = $("#workoutpg");
  requestAnimationFrame(() => el.classList.add("show"));
  let tick = null;
  const stop = () => { if (tick) { clearInterval(tick); tick = null; } };
  const close = () => { stop(); el.classList.remove("show"); setTimeout(() => el.remove(), 320); persist(); };
  const wrap = el.querySelector(".wrap");
  let workout = workoutForSession(session);

  const gymState = () => (session.gym = session.gym || { avoidIds: [], swaps: {} });
  function paintOverview() {
    stop();
    const venue = session.venue || "home";
    const focus = (session.gym && session.gym.focus) || "full";
    const eq = workout.equipmentNeeded.length
      ? workout.equipmentNeeded.map(k => W.EQUIPMENT_LABELS[k] || k).join(", ") : "Bodyweight only";
    const blockMeta = b => b.mode === "reps"
      ? `${b.sets} × ${b.reps} reps${b.unilateral ? " / side" : ""}`
      : `${b.rounds} × ${b.work}s${b.rest ? " / " + b.rest + "s" : ""}`;
    wrap.innerHTML = `
      <div class="wpg-head"><button class="iconbtn" id="wp-close" aria-label="Close">✕</button>
        <div class="eyebrow">${week ? "Week " + week.weekNum + " · " : ""}${fmtShort(dateISO)}</div>
        <h1 class="page">${venue === "gym" ? "Gym workout" : "Home workout"}</h1></div>
      <div class="wpg-meta">
        <span class="chip">${workout.minutes} min</span>
        <span class="chip ${workout.estIntensity === "high" ? "zc4" : "zc2"}">${workout.estIntensity === "high" ? "Harder day" : "Steady"}</span>
        <span class="chip">${W.FOCUS_LABELS[focus]}</span>
      </div>
      <div class="wpg-venue">
        <span class="unitseg"><button class="useg ${venue === "home" ? "on" : ""}" data-venue="home">Home</button><button class="useg ${venue === "gym" ? "on" : ""}" data-venue="gym">Gym</button></span>
        <button class="chip" id="wp-refresh" style="margin-left:auto">↻ Refresh</button>
      </div>
      <div class="wpg-chips">${W.FOCUSES.map(f => `<button class="fchip ${focus === f ? "on" : ""}" data-focus="${f}">${W.FOCUS_LABELS[f]}</button>`).join("")}</div>
      <div class="wpg-chips">${[30, 45, 60, 75, 90].map(m => `<button class="fchip ${session.targetMin === m ? "on" : ""}" data-dur="${m}">${m}m</button>`).join("")}</div>
      <p class="row-sub">Equipment · ${esc(eq)}</p>
      <div class="wpg-blocks">${workout.blocks.map(b => `
        <div class="wblock"><div class="wblock-hd"><b>${W.CATEGORY_LABELS[b.category] || b.category}</b><span>${blockMeta(b)}</span></div>
          <div class="wex">
            <span class="wex-n">${esc(b.name)}${b.unilateral ? " <i class='uni'>each side</i>" : ""}</span>
            <span class="wex-i">${esc(b.instr)}</span>
            <span class="wex-act"><button class="lk" data-swap="${b.bi}">swap</button><button class="lk bad" data-ban="${b.id}">ban</button></span>
          </div></div>`).join("")}</div>
      <button class="btn" id="wp-start">Do workout now</button>
      <button class="btn ghost" id="wp-log">Log it as done</button>`;
    wrap.querySelector("#wp-close").addEventListener("click", close);
    wrap.querySelectorAll("[data-focus]").forEach(b => b.addEventListener("click", () => {
      if (focus === b.dataset.focus) return;
      gymState().focus = b.dataset.focus; gymState().swaps = {};
      S.save(doc); workout = workoutForSession(session); paintOverview();
    }));
    wrap.querySelectorAll("[data-dur]").forEach(b => b.addEventListener("click", () => {
      const m = +b.dataset.dur; if (session.targetMin === m) return;
      session.targetMin = m; gymState().swaps = {};
      S.save(doc); workout = workoutForSession(session); paintOverview();
    }));
    wrap.querySelectorAll("[data-venue]").forEach(b => b.addEventListener("click", () => {
      if (session.venue === b.dataset.venue) return;
      session.venue = b.dataset.venue; gymState();
      S.save(doc); workout = workoutForSession(session); paintOverview();
    }));
    wrap.querySelector("#wp-refresh").addEventListener("click", () => {
      session.gym = session.gym || { avoidIds: [], swaps: {} };
      session.gym.avoidIds = [...new Set([...(session.gym.avoidIds || []), ...W.workoutExerciseIds(workout)])].slice(-80);
      session.gym.swaps = {};
      session.gym.seed = (Math.random() * 4294967296) >>> 0;
      S.save(doc); workout = workoutForSession(session); paintOverview(); toast("New workout ✓");
    });
    wrap.querySelectorAll("[data-swap]").forEach(b => b.addEventListener("click", () => {
      const bi = +b.dataset.swap, blk = workout.blocks.find(x => x.bi === bi); if (!blk) return;
      const shown = new Set(W.workoutExerciseIds(workout));
      const pool = W.filterEligible({ venue: session.venue || "home", equipment: doc.settings.equipment || {}, banned: doc.settings.bannedExercises || [] })
        .filter(e => e.category === blk.category && !shown.has(e.id));
      if (!pool.length) { toast("No alternative available"); return; }
      session.gym = session.gym || { avoidIds: [], swaps: {} };
      session.gym.swaps = { ...(session.gym.swaps || {}), [bi]: pool[Math.floor(Math.random() * pool.length)].id };
      S.save(doc); workout = workoutForSession(session); paintOverview();
    }));
    wrap.querySelectorAll("[data-ban]").forEach(b => b.addEventListener("click", () => {
      doc.settings.bannedExercises = [...new Set([...(doc.settings.bannedExercises || []), b.dataset.ban])];
      S.save(doc); workout = workoutForSession(session); paintOverview(); toast("Won't show that again");
    }));
    wrap.querySelector("#wp-start").addEventListener("click", paintTimer);
    wrap.querySelector("#wp-log").addEventListener("click", paintDone);
  }

  let steps = [], idx = 0, remaining = 0, paused = false;
  const gotoStep = i => { idx = Math.max(0, Math.min(steps.length - 1, i)); remaining = steps[idx].kind === "reps" ? 0 : steps[idx].sec; renderStep(); };
  const advance = () => { if (idx + 1 >= steps.length) { stop(); paintDone(); return; } gotoStep(idx + 1); };
  function paintTimer() {
    stop();
    steps = workoutSteps(workout);
    if (!steps.length) { toast("Nothing to run"); return; }
    paused = false; gotoStep(0);
    tick = setInterval(() => {
      if (paused || steps[idx].kind === "reps") return; // rep sets are self-paced
      remaining--;
      if (remaining <= 2 && remaining >= 0) beep(remaining === 0 ? 1320 : 720, 90);
      if (remaining < 0) { advance(); return; }
      const c = wrap.querySelector(".wt-count"); if (c) c.textContent = remaining;
      const p = wrap.querySelector(".wt-prog i"); if (p) p.style.width = Math.round((idx / steps.length) * 100) + "%";
    }, 1000);
  }
  function renderStep() {
    const s = steps[idx], nx = steps[idx + 1];
    const cls = s.kind === "work" ? "work" : s.kind === "reps" ? "reps" : "rest";
    const stage = s.kind === "reps" ? esc(s.label) + " · set " + s.setNo + "/" + s.sets
      : s.kind === "work" ? esc(s.label) + " · round " + s.round + "/" + s.rounds : "Recover";
    const mid = s.kind === "reps"
      ? `<div class="wt-reps">${s.reps}<small>reps${s.uni ? " · each side" : ""}</small></div><button class="btn wt-done" id="wt-done">Done →</button>`
      : `<div class="wt-count">${remaining}</div>`;
    wrap.innerHTML = `<div class="wtimer ${cls}">
      <button class="iconbtn wtimer-x" id="wt-quit" aria-label="Close">✕</button>
      <div class="wt-stage">${stage}</div>
      <div class="wt-name">${esc(s.name)}${s.uni && s.kind === "work" ? " <i class='uni'>each side</i>" : ""}</div>
      ${mid}
      ${(s.kind === "work" || s.kind === "reps") && s.instr ? `<div class="wt-instr">${esc(s.instr)}</div>` : ""}
      <div class="wt-next">${nx ? "Next · " + esc(nx.name) : "Final effort!"}</div>
      <div class="wt-ctrls">
        <button class="btn ghost" id="wt-back">‹</button>
        <button class="btn" id="wt-pause">${paused ? "Resume" : "Pause"}</button>
        <button class="btn ghost" id="wt-skip">›</button></div>
      <div class="wt-prog"><i style="width:${Math.round((idx / steps.length) * 100)}%"></i></div></div>`;
    wrap.querySelector("#wt-quit").addEventListener("click", paintOverview);
    wrap.querySelector("#wt-pause").addEventListener("click", () => { paused = !paused; renderStep(); });
    wrap.querySelector("#wt-skip").addEventListener("click", advance);
    wrap.querySelector("#wt-back").addEventListener("click", () => gotoStep(idx - 1));
    wrap.querySelector("#wt-done")?.addEventListener("click", () => { beep(1320, 90); advance(); });
  }

  function paintDone() {
    stop();
    wrap.innerHTML = `
      <div class="wpg-head"><button class="iconbtn" id="wd-close" aria-label="Close">✕</button>
        <h1 class="page">Nice work</h1><p class="row-sub">Log it so it counts toward your load and streak.</p></div>
      <div class="card">
        <div class="frow"><span class="l">Time</span><input type="text" inputmode="numeric" id="wd-min" value="${session.targetMin}"><span class="suffix">min</span></div>
        <div class="frow"><span class="l">Avg HR</span><input type="text" inputmode="numeric" id="wd-hr" placeholder="—"><span class="suffix">bpm</span></div>
        <div class="frow"><span class="l">Max HR</span><input type="text" inputmode="numeric" id="wd-maxhr" placeholder="—"><span class="suffix">bpm</span></div>
        <div class="frow"><span class="l">Calories</span><input type="text" inputmode="numeric" id="wd-cal" placeholder="—"><span class="suffix">kcal</span></div>
        <div class="frow" style="border:none"><span class="l">Effort</span>
          <span class="seg rpe" style="border:none;padding:0;flex:1;justify-content:flex-end;flex-wrap:wrap">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button data-rpe="${n}" style="flex:0 0 30px;min-height:38px">${n}</button>`).join("")}</span></div>
      </div>
      <p class="row-sub">No heart rate? It still counts toward your time and streak — just not the aerobic/anaerobic split.</p>
      <button class="btn" id="wd-save">Save workout</button>
      <button class="btn ghost" id="wd-skip">Not now</button>`;
    let rpe = null;
    wrap.querySelectorAll("[data-rpe]").forEach(b => b.addEventListener("click", () => {
      rpe = rpe === +b.dataset.rpe ? null : +b.dataset.rpe;
      wrap.querySelectorAll("[data-rpe]").forEach(x => x.classList.toggle("on", +x.dataset.rpe === rpe));
    }));
    wrap.querySelector("#wd-close").addEventListener("click", close);
    wrap.querySelector("#wd-skip").addEventListener("click", close);
    wrap.querySelector("#wd-save").addEventListener("click", () => {
      const min = num(wrap.querySelector("#wd-min").value) || session.targetMin;
      doc.logs.push({ id: S.uid(), date: dateISO, sport: "gym", min, venue: session.venue || "home",
        avgHR: num(wrap.querySelector("#wd-hr").value) ?? undefined, maxHR: num(wrap.querySelector("#wd-maxhr").value) ?? undefined,
        calories: num(wrap.querySelector("#wd-cal").value) ?? undefined, rpe: rpe ?? undefined, source: "manual" });
      doc.logs.sort(byDate);
      close(); toast("Workout logged ✓");
    });
  }

  paintOverview();
}

/* ---------------- AD-HOC WORKOUT (Today ＋) ---------------- */

/* A one-off workout to do today that isn't in the program. */
function openAdhocWorkout() {
  // every activity is offered — the "Workouts allowed" toggles are for the PLAN,
  // not for spontaneously doing a workout today (the two are independent)
  const acts = [["run", "Run"], ["trail", "Trail"], ["bike", "Ride"], ["hike", "Hike"], ["gym", "Gym"]];
  const sheet = openSheet(`
    <div class="sh-title">Do a workout</div>
    <div class="sh-sub">A one-off for today — not part of your program. We'll suggest one sized to your training.</div>
    <div class="adhoc-acts">${acts.map(([sp, l]) => `<button class="btn ghost adhoc-act" data-asp="${sp}">${l}</button>`).join("")}</div>
  `);
  sheet.querySelectorAll("[data-asp]").forEach(b => b.addEventListener("click", () => {
    const sp = b.dataset.asp;
    closeOverlay();
    if (sp === "gym") {
      openWorkoutPage(null, { sport: "gym", kind: "easy", targetMin: 45, venue: doc.settings.gymVenueDefault || "home",
        gym: { seed: (Math.random() * 4294967296) >>> 0, avoidIds: [], swaps: {}, focus: "full" } }, todayISO());
    } else openAdhocSession(sp);
  }));
}

/* Run/ride one-off: an adaptive prescription (suggestSession) you can adjust,
   then send to watch or log. Never written into doc.weeks. */
/* Ungated workout types for the ad-hoc "+" — the plan's allowed-types don't
   apply here; you can do any activity, any type, as a one-off. */
const ADHOC_TYPES = {
  run:   [{ id: "easy", label: "Easy", kind: "easy" }, { id: "runTempo", label: "Tempo", kind: "quality", tpl: "runTempo" }, { id: "runQ1", label: "Intervals", kind: "quality", tpl: "runQ1" }, { id: "runHills", label: "Hills", kind: "quality", tpl: "runHills" }, { id: "long", label: "Long", kind: "long" }],
  trail: [{ id: "easy", label: "Easy", kind: "easy" }, { id: "long", label: "Long", kind: "long" }, { id: "runQ1", label: "Intervals", kind: "quality", tpl: "runQ1" }],
  bike:  [{ id: "easy", label: "Easy", kind: "easy" }, { id: "bikeQ1", label: "Sweet spot", kind: "quality", tpl: "bikeQ1" }, { id: "bikeClimb", label: "Climb", kind: "quality", tpl: "bikeClimb" }, { id: "long", label: "Long", kind: "long" }],
  hike:  [{ id: "easy", label: "Hike", kind: "easy" }, { id: "long", label: "Big day", kind: "long" }],
};
function openAdhocSession(sport) {
  const opts = ADHOC_TYPES[sport] || ADHOC_TYPES.run;
  let chosen = opts[0];
  const presc = () => E.suggestSession(doc.logs, sport, chosen.id, { settings: doc.settings, weekNum: currentWeek()?.weekNum || 1 });
  let p = presc(), dur = p.targetMin, zone = p.zone;
  const sheet = openSheet(`
    <div class="sh-title">${SPORT_NAME[sport]} today</div>
    <div class="sh-sub">A suggestion sized from your recent training — adjust anything, then do it.</div>
    <div class="type-row"><span class="l">Type</span><span class="opts" id="ah-types">${opts.map(o =>
      `<button data-ah="${o.id}" class="${o.id === chosen.id ? "on" : ""}">${o.label}</button>`).join("")}</span></div>
    <div class="frow"><span class="l">Duration</span>
      <span class="stepper"><button data-d="-5">−</button><input type="text" inputmode="numeric" class="v dur" id="ah-min" value="${dur}"><span class="suffix">min</span><button data-d="5">+</button></span></div>
    <div class="type-row"><span class="l">Target zone</span><span class="opts" id="ah-zones">${[1, 2, 3, 4, 5].map(z =>
      `<button data-z="${z}" class="${z === zone ? "on" : ""}">Z${z}</button>`).join("")}</span></div>
    <div id="ah-detail" class="callout"></div>
    <button class="btn" id="ah-watch">Send to watch (.FIT)</button>
    <button class="btn" id="ah-log">Log it now</button>
  `);
  const minInput = sheet.querySelector("#ah-min");
  const readMin = () => Math.max(5, Math.round(num(minInput.value) ?? dur) || 5);
  const sessionObj = () => {
    const s = { sport, kind: chosen.kind, targetMin: readMin(), zone };
    if (chosen.kind === "quality") s.qualityTemplate = chosen.tpl;
    if (chosen.id === "bikeClimb" && p.targetAscent) s.targetAscent = p.targetAscent;
    return s;
  };
  const refresh = () => {
    const tpl = chosen.tpl ? E.QUALITY_TEMPLATES[chosen.tpl] : null;
    const pace = (sport === "run" || sport === "trail") ? E.paceHint(doc.logs, bounds(), zone, doc.settings.easyPace) : null;
    const lines = [p.note || (tpl ? tpl.label : "")];
    if (pace) lines.push(`Pace ≈ ${E.fmtPace(pace.lo)}–${E.fmtPace(pace.hi)} /km at Z${zone}`);
    if (chosen.id === "bikeClimb" && p.targetAscent) lines.push(`Target climb ≈ ${p.targetAscent} m of ascent`);
    sheet.querySelector("#ah-detail").innerHTML = lines.filter(Boolean).join("<br>");
  };
  refresh();
  sheet.querySelectorAll("[data-ah]").forEach(b => b.addEventListener("click", () => {
    chosen = opts.find(o => o.id === b.dataset.ah);
    sheet.querySelectorAll("[data-ah]").forEach(x => x.classList.toggle("on", x === b));
    p = presc(); dur = p.targetMin; zone = p.zone; minInput.value = dur;
    sheet.querySelectorAll("[data-z]").forEach(x => x.classList.toggle("on", +x.dataset.z === zone));
    refresh();
  }));
  sheet.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { minInput.value = Math.max(5, readMin() + +b.dataset.d); }));
  sheet.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => {
    zone = +b.dataset.z; sheet.querySelectorAll("[data-z]").forEach(x => x.classList.toggle("on", x === b)); refresh();
  }));
  sheet.querySelector("#ah-watch").addEventListener("click", () => sendSessionToWatch(sessionObj(), todayISO()));
  sheet.querySelector("#ah-log").addEventListener("click", () => {
    const s = sessionObj();
    closeOverlay();
    openLogSheet({ date: todayISO(), sport, prefillMin: s.targetMin, title: SPORT_NAME[sport] || sport, type: typeOfSession(s) });
  });
}

/* ---------------- PROGRESS ---------------- */

let ridgeSel = null;

function ridgeDetail(vol) {
  if (ridgeSel == null || !vol[ridgeSel]) return "";
  const p = vol[ridgeSel];
  const tot = p.run + p.bike + (p.hike || 0) + (p.gym || 0);
  const parts = [];
  parts.push(tot > 0 ? `<b>${fmtDur(tot)}</b> — run ${fmtDur(p.run)} · ride ${fmtDur(p.bike)}${p.hike ? ` · hike ${fmtDur(p.hike)}` : ""}${p.gym ? ` · gym ${fmtDur(p.gym)}` : ""}` : "no activity logged");
  if (p.target) parts.push(`${Math.round(((p.run + p.bike) / p.target) * 100)} % of the ${fmtDur(p.target)} plan`);
  if (p.isDeload) parts.push(`<span style="color:var(--sand)">deload</span>`);
  const end = p.end || E.addDays(p.start, 6);
  return `<div class="callout">${fmtFull(p.start)} – ${fmtFull(end)} · ${parts.join(" · ")}</div>`;
}

let lineSel = {}; // cardId -> {si,pi} | null
let cardToggle = {}; // cardId -> which side of a merged card is showing
const X0 = "2025-01-01";
const dnum = iso => Math.round((E.parseISO(iso) - E.parseISO(X0)) / 864e5);
const dnumDate = n => E.addDays(X0, n);
const byDate = (a, b) => (a.date < b.date ? -1 : 1);
/* Intermediate date ticks for a chart, computed from its own x-range so they
   always land inside the plotted area. pts = flat array of {x} (dnum). */
function xTicksFor(pts) {
  if (!pts || pts.length < 3) return undefined;
  const xs = pts.map(p => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
  if (hi - lo < 14) return undefined;
  const n = (hi - lo) > 80 ? 4 : (hi - lo) > 35 ? 3 : 2;
  const out = [];
  for (let i = 1; i < n; i++) { const x = Math.round(lo + (hi - lo) * i / n); out.push({ x, label: fmtShort(dnumDate(x)) }); }
  return out;
}

const CARD_LABEL = {
  volume: "Training volume", load: "Load", trainingLoad: "Training load",
  calories: "Calories burned", caloriesByType: "Calories by activity", weight: "Weight",
  pace: "Pace at easy HR", coach: "Coach summary", bests: "Personal bests",
  vo2: "VO₂ max", balance: "Aerobic / anaerobic", speedByType: "Speed by type",
  distance: "Distance", ascent: "Climbing", paceVsRpe: "Pace vs RPE",
  efficiency: "Efficiency trend", rpeHeatmap: "RPE calendar", rpeByType: "RPE by type",
  consistency: "Consistency",
};

/* A small Run/Ride (or A/B) toggle in a merged card's header. */
function cardTabs(cardId, tabs, cur) {
  return `<span class="ctabs">${tabs.map(([v, l]) =>
    `<button class="ctab ${cur === v ? "on" : ""}" data-ctab="${cardId}" data-ctv="${v}">${l}</button>`).join("")}</span>`;
}

const seriesAvg = pts => pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : null;
/* A small "average over the range" read-out under a chart's header. */
function avgLine(parts) {
  const txt = parts.filter(Boolean).join(" · ");
  return txt ? `<div class="avgline">avg · ${txt}</div>` : "";
}

function lineDetail(id, series, fmtVal) {
  const sel = lineSel[id];
  const p = sel && series[sel.si] && series[sel.si].points[sel.pi];
  if (!p) return "";
  const link = p.id ? ` <button class="lk seeact" data-openlog="${p.id}">see this activity →</button>` : "";
  return `<div class="callout">${fmtFull(p.date)} · ${fmtVal(p, sel.si)}${link}</div>`;
}

function renderProgress() {
  const page = $('[data-page="progress"]');
  const t = todayISO();
  const B = bounds();

  const wi = doc.weighIns, lastW = wi.length ? wi[wi.length - 1] : null;
  const vo2 = doc.vo2History, lastV = vo2.length ? vo2[vo2.length - 1] : null;
  const vo2AtTarget = lastW && lastV ? E.vo2AtTargetWeight(lastV.value, lastW.kg, doc.settings.targetWeightKg) : null;

  // ----- time-range window -----
  const pr0 = doc.settings.progressRange;
  // "All time" needs the earliest dated point we have
  const earliest = [...doc.logs.map(l => l.date), ...wi.map(w => w.date), ...vo2.map(v => v.date)].sort()[0];
  const win = E.rangeWindow(pr0.preset === "all" ? { ...pr0, from: earliest || E.addDays(t, -83) } : pr0, t);
  const nW = Math.max(1, Math.ceil(win.days / 7));
  const inRange = d => d >= win.from && d <= win.to;
  const R = arr => arr.filter(p => inRange(p.date));

  // ----- data series (range-filtered) -----
  // weight + VO₂ now honour the range selector like every other chart
  const wPts = R(wi.map(w => ({ x: dnum(w.date), y: w.kg, date: w.date })));
  const vPts = R(vo2.map(v => ({ x: dnum(v.date), y: v.value, date: v.date })));
  const easyRuns = doc.logs.filter(l => E.isRunType(l) && (l.min || 0) >= 20 && l.km > 0 &&
    l.avgHR != null && l.avgHR >= 105 && l.avgHR <= 155).sort(byDate);
  const pPts = R(easyRuns.map(l => ({ x: dnum(l.date), y: l.min * 60 / l.km, date: l.date, id: l.id })));
  const hint = E.paceHint(doc.logs, B, 2, doc.settings.easyPace);

  const speedPts = (filter) => R(doc.logs.filter(l => l.km > 0 && l.min > 0 && filter(l)).sort(byDate)
    .map(l => ({ x: dnum(l.date), y: l.km * 60 / l.min, date: l.date, id: l.id })));
  // climbing only: climb-type rides, trail runs, hikes — where ascent is the point
  const ascentPts = R(doc.logs.filter(l => l.ascent > 0 &&
    ((l.sport === "bike" && l.type === "climb") || l.sport === "trail" || l.sport === "hike")).sort(byDate)
    .map(l => ({ x: dnum(l.date), y: l.ascent, date: l.date, id: l.id })));
  const rpeList = doc.logs.filter(l => l.rpe != null && ["run", "trail", "bike", "hike", "gym"].includes(l.sport) && inRange(l.date)).sort(byDate);

  // bucketed series honour the week/month toggle
  const unit = doc.settings.progressRange.unit || "week";
  const buckets = E.bucketize(win.from, win.to, unit);
  const todayD = t;
  const vol = buckets.map(bk => {
    const v = E.volumeInRange(doc.logs, bk.start, bk.end);
    const plans = doc.weeks.filter(w => w.startDate >= bk.start && w.startDate <= bk.end);
    return { ...v, start: bk.start, end: bk.end, label: bk.label,
             target: plans.reduce((a, w) => a + E.plannedMinutes(w), 0) || null,
             isDeload: plans.length === 1 && plans[0].isDeload,
             current: todayD >= bk.start && todayD <= bk.end };
  });
  const loadB = buckets.map(bk => ({ start: bk.start, label: bk.label, load: E.loadInRange(doc.logs, B, bk.start, bk.end) }));
  const intB = buckets.map(bk => ({ start: bk.start, label: bk.label, ...E.intensityInRange(doc.logs, B, bk.start, bk.end) }));
  const calB = buckets.map(bk => ({ start: bk.start, label: bk.label, total: E.caloriesInRange(doc.logs, bk.start, bk.end) }));
  const load = E.trainingLoad({ logs: doc.logs, bounds: B, todayISO: t, n: 12 }); // ACWR is a "now" metric
  const lf = E.loadFocus(doc.logs, B, win.from, win.to);
  const exLoad = E.dailyLoad(doc.logs, B, win.from, win.to);
  const cons = E.consistency({ weeks: doc.weeks, logs: doc.logs, todayISO: t });
  const bests = E.personalBests({ logs: doc.logs, manualBests: doc.manualBests });
  const calTypes = E.caloriesByType({ logs: doc.logs, todayISO: win.to, n: nW });
  const calSplit = E.plannedVsUnplannedCalories({ weeks: doc.weeks, logs: doc.logs, from: win.from, to: win.to });
  const calTypeCounts = {};
  doc.logs.forEach(l => { if (l.calories > 0 && inRange(l.date)) calTypeCounts[l.sport] = (calTypeCounts[l.sport] || 0) + 1; });
  const vo2Cat = lastV ? E.vo2Category(lastV.value, doc.settings.age, doc.settings.sex) : null;

  // rolling efficiency (running speed ÷ RPE)
  const effLogs = doc.logs.filter(l => E.isRunType(l) && l.rpe && l.km > 0 && l.min > 0 && inRange(l.date)).sort(byDate);
  const rollEff = (days) => effLogs.map(l => {
    const win = effLogs.filter(x => x.date <= l.date && x.date >= E.addDays(l.date, -days));
    const vals = win.map(x => (x.km * 60 / x.min) / x.rpe);
    return { x: dnum(l.date), y: vals.reduce((a, b) => a + b, 0) / vals.length, date: l.date };
  });

  // ----- card renderers -----
  const wrap = (id, inner) => `<div class="chartwrap" data-card="${id}">${inner}</div>`;
  const tip = id => lineSel[id] ? "TAP AGAIN TO CLEAR" : "TAP A POINT";

  const anyHike = vol.some(v => v.hike > 0);
  const anyGym = vol.some(v => v.gym > 0);
  const CARDS = {
    volume: () => `
      <div class="hd"><span class="eyebrow">${unit === "month" ? "Monthly" : "Weekly"} volume</span><span class="eyebrow tapx">${ridgeSel == null ? "TAP A BAR" : "TAP AGAIN TO CLEAR"}</span></div>
      ${unit === "month"
        ? wrap("volume", C.stackedBars(vol, { keys: ["bike", "run", "hike", "gym"], colors: ["#5d6ccc", "var(--cy)", "#7fd6c0", "#c98bdb"], labelEvery: 1, fmtY: v => fmtDur(Math.round(v)) }))
        : wrap("volume", C.ridgeChart(vol, { selected: ridgeSel }))}
      <div class="legend2"><span><i style="background:var(--cy)"></i>run</span><span><i style="background:#5d6ccc"></i>ride</span>${anyHike ? `<span><i style="background:#7fd6c0"></i>hike</span>` : ""}${anyGym ? `<span><i style="background:#c98bdb"></i>gym</span>` : ""}<span><i style="background:var(--sand);height:3px;border-radius:1px;width:12px;vertical-align:2px"></i>target</span></div>
      ${ridgeDetail(vol)}`,

    trainingLoad: () => {
      const ld = loadB.map(w => ({ x: dnum(w.start), y: w.load, date: w.start }));
      const band = E.trainingLoadBand(doc.logs, B, buckets).map(b => ({ x: dnum(b.start), lo: b.lo, hi: b.hi }));
      const statusTxt = { undertraining: "Undertraining", optimal: "Optimal", overreaching: "Overreaching", "high-risk": "High risk", building: "Building base" }[load.status];
      const statusCol = load.status === "high-risk" ? "var(--bad)" : load.status === "optimal" ? "var(--cy)" : "var(--sand)";
      return `
      <div class="hd"><span class="eyebrow">Training load</span>${load.acwr != null ? `<span class="chip" style="color:${statusCol};border-color:${statusCol}33">${statusTxt} · ${load.acwr.toFixed(2)}</span>` : `<span class="eyebrow tapx">build a baseline</span>`}</div>
      ${ld.filter(p => p.y > 0).length >= 2
        ? wrap("trainingLoad", C.lineChart(ld, { axis: true, taps: true, color: "#8e9df8", band, selected: lineSel.trainingLoad, xLabels: [loadB[0].label, loadB[loadB.length - 1].label], xTicks: xTicksFor(ld) }))
        : `<p class="row-sub">Log a few sessions and your acute-vs-chronic load appears here, flagging over- and under-training.</p>`}
      ${lineDetail("trainingLoad", [{ points: ld }], p => `load ${Math.round(p.y)}`)}
      <div class="legend2"><span><i style="background:rgba(122,196,90,.5)"></i>optimal range</span></div>
      ${load.acwr != null ? `<div class="callout">7-day load <b>${load.acute}</b> vs 4-week baseline <b>${load.chronic}</b>. Stay in the <b>green band</b> — above it is overload, below is detraining.</div>` : ""}`;
    },

    load: () => {
      const view = cardToggle.load || "focus";
      const tabs = cardTabs("load", [["focus", "Focus"], ["daily", "Daily"]], view);
      const legend = `<div class="legend2"><span><i style="background:#5fbf6a"></i>low aerobic</span><span><i style="background:#e6a13c"></i>high aerobic</span><span><i style="background:#e8554e"></i>anaerobic</span></div>`;
      if (view === "daily") {
        const rows = exLoad.map(d => ({ ...d, label: fmtShort(d.date) }));
        const has = rows.some(r => r.total > 0);
        const labelEvery = Math.max(1, Math.round(rows.length / 6));
        return `
        <div class="hd"><span class="eyebrow">Load · daily</span>${tabs}</div>
        ${has ? wrap("load", C.stackedBars(rows.map((r, i) => ({ ...r, label: i % labelEvery === 0 ? shortDay(r.date) : "" })), { keys: ["low", "high", "anaerobic"], colors: ["#5fbf6a", "#e6a13c", "#e8554e"], height: 128, labelEvery: 1, fmtY: v => Math.round(v) }))
          : `<p class="row-sub">Each day's training load, coloured by intensity — appears as you log sessions.</p>`}
        ${legend}`;
      }
      const segs = [
        { key: "low", label: "Low aerobic", color: "#5fbf6a" },
        { key: "high", label: "High aerobic", color: "#e6a13c" },
        { key: "anaerobic", label: "Anaerobic", color: "#e8554e" },
      ];
      const bars = lf.total > 0 ? segs.map(s => {
        const val = lf[s.key], [lo, hi] = lf.opt[s.key];
        const w = Math.max(2, Math.round(val / lf.total * 100));
        const inOpt = val >= lo && val <= hi;
        const optL = Math.round(lo / lf.total * 100), optR = Math.round(hi / lf.total * 100);
        return `<div class="lf-row">
          <span class="lf-name"><i style="background:${s.color}"></i>${s.label}</span>
          <span class="lf-track"><i class="lf-fill" style="width:${w}%;background:${s.color}"></i><i class="lf-opt" style="left:${optL}%;width:${Math.max(2, optR - optL)}%"></i></span>
          <span class="lf-val ${inOpt ? "ok" : ""}">${Math.round(val)}</span>
        </div>`;
      }).join("") : "";
      return `
      <div class="hd"><span class="eyebrow">Load · focus</span>${tabs}</div>
      ${lf.total > 0
        ? `<div class="stat"><span class="midnum">${Math.round(lf.total)}</span><span class="unit">total load · ${lf.focus.toLowerCase()}</span></div>
           <div class="lf">${bars}</div>
           <div class="callout">The shaded band is the polarized optimal range — most load low-aerobic, a slice high-aerobic, a sprinkle anaerobic.</div>`
        : `<p class="row-sub">Log sessions with heart rate and your load splits into low-aerobic, high-aerobic and anaerobic — Garmin-style.</p>`}`;
    },

    weight: () => `
      <div class="hd"><span class="eyebrow">Weight</span><button class="eyebrow tapx lk" id="pg-tw">target ${doc.settings.targetWeightKg.toFixed(1)} ✎</button></div>
      <div class="stat"><span class="midnum">${lastW ? lastW.kg.toFixed(1) : "—"}</span><span class="unit">kg · ${lastW ? fmtShort(lastW.date) : ""}</span></div>
      ${wPts.length >= 2 ? wrap("weight", C.lineChart(wPts, { axis: true, taps: true, emaAlpha: 0.25, fmtY: v => v.toFixed(0), target: doc.settings.targetWeightKg, targetLabel: `${doc.settings.targetWeightKg.toFixed(0)} kg`, selected: lineSel.weight, xLabels: [fmtShort(wPts[0].date), fmtShort(wPts[wPts.length - 1].date)], xTicks: xTicksFor(wPts) })) : `<p class="row-sub">${wi.length >= 2 ? "No weigh-ins in this range — widen it or check All time." : "Two weigh-ins start the trend."}</p>`}
      ${lineDetail("weight", [{ points: wPts }], p => `${p.y.toFixed(1)} kg`)}
      ${vo2AtTarget ? `<div class="callout">Same fitness at ${doc.settings.targetWeightKg.toFixed(0)} kg → <b>VO₂ ≈ ${vo2AtTarget}</b>. Lighter chassis, same engine.</div>` : ""}
      <button class="btn ghost mini" id="pg-weigh">Add weigh-in</button>`,

    pace: () => `
      <div class="hd"><span class="eyebrow">Pace at easy HR</span><span class="chip zc2" style="font-size:11px">Z2 · ${E.zoneMid(B, 2)} bpm</span></div>
      ${hint.learned
        ? `<div class="stat"><span class="midnum">${E.fmtPace((hint.lo + hint.hi) / 2)}</span><span class="unit">/km · learned from ${hint.n} easy runs</span></div>`
        : `<div class="stat"><span class="midnum" style="color:var(--sub)">${E.fmtPace(hint.lo)}–${E.fmtPace(hint.hi)}</span><span class="unit">/km · ${hint.manual ? "your pace setting" : "starting estimate"}</span></div>`}
      ${pPts.length ? avgLine([`${E.fmtPace(seriesAvg(pPts))} /km over ${win.label.toLowerCase()}`]) : ""}
      ${pPts.length >= 2
        ? wrap("pace", C.lineChart(pPts, { height: 116, axis: true, taps: true, avg: true, invert: true, fmtY: v => E.fmtPace(v), selected: lineSel.pace, xLabels: [fmtShort(easyRuns[0].date), fmtShort(easyRuns[easyRuns.length - 1].date)] }))
        : `<p class="row-sub">Run easy (Z2, ≤ ${B[1].hi} bpm for 20+ min) and this chart wakes up.</p>`}
      ${lineDetail("pace", [{ points: pPts }], p => `${E.fmtPace(p.y)} /km`)}`,

    vo2: () => {
      const SEGS = ["#e8554e", "#e6a13c", "#5fbf6a", "#4a90e2", "#8e6ff0"];
      const cat = vo2Cat
        ? `<div class="vo2cat">${C.vo2Gauge({ pos: vo2Cat.pos, color: vo2Cat.color, segs: SEGS })}
             <div class="vo2cat-lab" style="color:${vo2Cat.color}">${vo2Cat.label}<small>${doc.settings.sex === "female" ? "women" : "men"} ${vo2Cat.bracketLabel}</small></div></div>`
        : "";
      return `
      <div class="hd"><span class="eyebrow">VO₂ max · Garmin</span>${!vo2Cat && lastV ? `<button class="eyebrow tapx lk" id="vo2-setcat">rate it →</button>` : ""}</div>
      <div class="vo2top">
        <div class="stat"><span class="midnum">${lastV ? lastV.value : "—"}</span><span class="unit">${lastV ? fmtShort(lastV.date) : "add your first reading"}</span></div>
        ${cat}
      </div>
      ${vPts.length >= 2 ? wrap("vo2", C.lineChart(vPts, { height: 104, axis: true, taps: true, color: "#8e9df8", fmtY: v => v.toFixed(0), selected: lineSel.vo2, xLabels: [fmtShort(vPts[0].date), fmtShort(vPts[vPts.length - 1].date)], xTicks: xTicksFor(vPts) })) : (vo2.length >= 2 ? `<p class="row-sub">No readings in this range — widen it or check All time.</p>` : "")}
      ${lineDetail("vo2", [{ points: vPts }], p => `${p.y} ml/kg/min`)}
      <button class="btn ghost mini" id="pg-vo2">Add reading</button>`;
    },

    distance: () => {
      const sport = cardToggle.distance || "run";
      const tabs = cardTabs("distance", [["run", "Run"], ["bike", "Ride"]], sport);
      const label = sport === "run" ? "run" : "ride";
      const regCol = sport === "run" ? "var(--cy)" : "#8e9df8";
      const d = E.distanceSplit(doc.logs, sport, win.from, win.to);
      const long = d.long.map(l => ({ x: dnum(l.date), y: l.km, date: l.date, id: l.id }));
      const reg = d.regular.map(l => ({ x: dnum(l.date), y: l.km, date: l.date, id: l.id }));
      const ser = [];
      if (reg.length) ser.push({ points: reg, color: regCol });
      if (long.length) ser.push({ points: long, color: "var(--sand)" });
      const al = seriesAvg(long), ar = seriesAvg(reg);
      return `
      <div class="hd"><span class="eyebrow">Distance · long vs regular</span>${tabs}</div>
      ${avgLine([al != null ? `long ${al.toFixed(1)}` : "", ar != null ? `regular ${ar.toFixed(1)}` : "", "km"])}
      ${ser.some(s => s.points.length >= 2) ? wrap("distance", C.lineChart(null, { series: ser, axis: true, taps: true, avg: true, fmtY: v => v.toFixed(0), selected: lineSel.distance, xTicks: xTicksFor([...reg, ...long]) })) : `<p class="row-sub">Log ${label}s with distance — long ones are tracked apart from regular, so you can watch the long ${label} grow.</p>`}
      <div class="legend2"><span><i style="background:var(--sand)"></i>long ${label}</span><span><i style="background:${regCol}"></i>regular</span></div>
      ${lineDetail("distance", ser, p => `${p.y.toFixed(1)} km`)}`;
    },

    balance: () => {
      const w = E.intensityInRange(doc.logs, B, win.from, win.to);
      const pts = intB.filter(x => x.total > 0).map(x => ({ x: dnum(x.start), y: x.hardPct * 100, date: x.start }));
      const tPct = w.total ? w.threshold / w.total : 0, aPct = w.total ? w.anaerobic / w.total : 0;
      let advice = "";
      if (w.total) {
        if (w.hardPct > 0.35) advice = "You're skewing <b>hard</b> — most training should be easy. Add easy aerobic volume to protect recovery and let the hard days land.";
        else if (w.hardPct < 0.10) advice = "Almost all easy — you're <b>light on intensity</b>. One weekly tempo or interval session would sharpen your top end.";
        else if (aPct < 0.03) advice = "Solid aerobic base with some threshold, but <b>little anaerobic</b> — add short, sharp Z4–Z5 intervals to build speed.";
        else advice = "Nicely polarized — you're close to the <b>80/20 sweet spot</b>. Keep it here.";
      }
      return `
      <div class="hd"><span class="eyebrow">Aerobic / anaerobic</span>${w.total ? `<span class="eyebrow tapx">${Math.round(w.easyPct * 100)}% easy</span>` : ""}</div>
      ${pts.length >= 2 ? wrap("balance", C.lineChart(pts, { axis: true, taps: true, color: "var(--sand)", target: 20, targetLabel: "20%", fmtY: v => v + "%", selected: lineSel.balance, xLabels: [fmtShort(pts[0].date), fmtShort(pts[pts.length - 1].date)] })) : `<p class="row-sub">Log sessions with heart rate to see your easy-vs-hard balance against the 80/20 line.</p>`}
      ${lineDetail("balance", [{ points: pts }], p => `${Math.round(p.y)}% hard`)}
      ${w.total ? `<div class="callout">Over ${win.label.toLowerCase()}: <b>${Math.round(w.easyPct * 100)}%</b> easy · <b>${Math.round(tPct * 100)}%</b> threshold · <b>${Math.round(aPct * 100)}%</b> anaerobic.<br>${advice}</div>` : ""}`;
    },

    speedByType: () => {
      const sport = cardToggle.speedByType || "run";
      const tabs = cardTabs("speedByType", [["run", "Run"], ["bike", "Ride"]], sport);
      let ser, avg, legend, empty;
      if (sport === "run") {
        const longIds = new Set(E.distanceSplit(doc.logs, "run", win.from, win.to).long.map(x => x.id));
        const hardT = l => ["tempo", "intervals", "hills"].includes(l.type);
        const long = speedPts(l => E.isRunType(l) && longIds.has(l.id));
        const easy = speedPts(l => E.isRunType(l) && !longIds.has(l.id) && !hardT(l));
        const hard = speedPts(l => E.isRunType(l) && !longIds.has(l.id) && hardT(l));
        ser = [];
        if (easy.length) ser.push({ points: easy, color: "var(--cy)" });
        if (long.length) ser.push({ points: long, color: "#7fd6c0" });
        if (hard.length) ser.push({ points: hard, color: "var(--sand)" });
        avg = avgLine([easy.length ? `easy ${seriesAvg(easy).toFixed(1)}` : "", long.length ? `long ${seriesAvg(long).toFixed(1)}` : "", hard.length ? `hard ${seriesAvg(hard).toFixed(1)}` : "", "km/h"]);
        legend = `<span><i style="background:var(--cy)"></i>easy</span><span><i style="background:#7fd6c0"></i>long</span><span><i style="background:var(--sand)"></i>tempo/hard</span>`;
        empty = "Log runs with distance to compare easy, long and hard-day speeds over time.";
      } else {
        const longIds = new Set(E.distanceSplit(doc.logs, "bike", win.from, win.to).long.map(x => x.id));
        const climb = speedPts(l => l.sport === "bike" && l.type === "climb");
        const longRide = speedPts(l => l.sport === "bike" && l.type !== "climb" && longIds.has(l.id));
        const easy = speedPts(l => l.sport === "bike" && l.type !== "climb" && !longIds.has(l.id));
        ser = [];
        if (easy.length) ser.push({ points: easy, color: "#8e9df8" });
        if (climb.length) ser.push({ points: climb, color: "var(--sand)" });
        if (longRide.length) ser.push({ points: longRide, color: "#7fd6c0" });
        avg = avgLine([easy.length ? `easy ${seriesAvg(easy).toFixed(1)}` : "", climb.length ? `climb ${seriesAvg(climb).toFixed(1)}` : "", longRide.length ? `long ${seriesAvg(longRide).toFixed(1)}` : "", "km/h"]);
        legend = `<span><i style="background:#8e9df8"></i>easy/int</span><span><i style="background:var(--sand)"></i>climb</span><span><i style="background:#7fd6c0"></i>long</span>`;
        empty = "Log rides with distance — easy/interval, climbing and long-ride speeds are tracked separately.";
      }
      return `
      <div class="hd"><span class="eyebrow">Speed by type</span>${tabs}</div>
      ${avg}
      ${ser.some(s => s.points.length >= 2) ? wrap("speedByType", C.lineChart(null, { series: ser, axis: true, taps: true, avg: true, fmtY: v => v.toFixed(0), selected: lineSel.speedByType, xTicks: xTicksFor(ser.flatMap(s => s.points)) })) : `<p class="row-sub">${empty}</p>`}
      <div class="legend2">${legend}</div>
      ${lineDetail("speedByType", ser, p => `${p.y.toFixed(1)} km/h`)}`;
    },

    ascent: () => {
      const view = cardToggle.ascent || "ride";
      const tabs = cardTabs("ascent", [["ride", "Ride"], ["hike", "Hike"]], view);
      const pts = view === "hike"
        ? R(doc.logs.filter(l => l.sport === "hike" && l.ascent > 0).sort(byDate).map(l => ({ x: dnum(l.date), y: l.ascent, date: l.date, id: l.id })))
        : R(doc.logs.filter(l => l.ascent > 0 && ((l.sport === "bike" && l.type === "climb") || l.sport === "trail")).sort(byDate).map(l => ({ x: dnum(l.date), y: l.ascent, date: l.date, id: l.id })));
      const am = seriesAvg(pts);
      const what = view === "hike" ? "hike" : "ride/trail";
      return `
      <div class="hd"><span class="eyebrow">Climbing</span>${tabs}</div>
      ${am != null ? avgLine([`${Math.round(am).toLocaleString()} m per outing`, `${pts.length} ${view === "hike" ? "hike" : "climb"}${pts.length === 1 ? "" : "s"} in ${win.label.toLowerCase()}`]) : ""}
      ${pts.length >= 2 ? wrap("ascent", C.lineChart(pts, { axis: true, taps: true, avg: true, color: "var(--sand)", fmtY: v => Math.round(v), selected: lineSel.ascent, xTicks: xTicksFor(pts) })) : `<p class="row-sub">${view === "hike" ? "Hikes" : "Climbing rides and trail runs"} with ascent logged appear here — your ${what} climbing over time.</p>`}
      ${lineDetail("ascent", [{ points: pts }], p => `${Math.round(p.y)} m climbed`)}`;
    },

    paceVsRpe: () => {
      const sp = doc.logs.filter(l => E.isRunType(l) && l.km > 0 && l.min > 0 && l.rpe && inRange(l.date)).sort(byDate);
      const speed = sp.map(l => ({ x: dnum(l.date), y: l.km * 60 / l.min, date: l.date, id: l.id }));
      const rpe = sp.map(l => ({ x: dnum(l.date), y: l.rpe, date: l.date, id: l.id }));
      const ser = [{ points: speed, color: "var(--cy)" }, { points: rpe, color: "var(--sand)" }];
      return `
      <div class="hd"><span class="eyebrow">Pace vs RPE</span><span class="eyebrow tapx">efficiency</span></div>
      ${speed.length >= 2 ? wrap("paceVsRpe", C.lineChart(null, { series: ser, axis: true, taps: true, fmtY: v => v.toFixed(0), selected: lineSel.paceVsRpe })) : `<p class="row-sub">Log runs with distance and RPE — when speed climbs while RPE stays flat, you're getting more efficient.</p>`}
      <div class="legend2"><span><i style="background:var(--cy)"></i>speed km/h</span><span><i style="background:var(--sand)"></i>RPE</span></div>
      ${lineDetail("paceVsRpe", ser, (p, si) => si === 0 ? `${p.y.toFixed(1)} km/h` : `RPE ${p.y}`)}`;
    },

    efficiency: () => {
      const e7 = rollEff(7), e28 = rollEff(28);
      const ser = [];
      if (e28.length) ser.push({ points: e28, color: "#8e9df8" });
      if (e7.length) ser.push({ points: e7, color: "var(--cy)" });
      return `
      <div class="hd"><span class="eyebrow">Running efficiency</span><span class="eyebrow tapx">speed ÷ RPE</span></div>
      ${e7.length ? avgLine([`${seriesAvg(e7).toFixed(2)} over ${win.label.toLowerCase()}`]) : ""}
      ${e7.length >= 2 ? wrap("efficiency", C.lineChart(null, { series: ser, axis: true, taps: true, avg: true, fmtY: v => v.toFixed(1), selected: lineSel.efficiency })) : `<p class="row-sub">Log runs with distance and RPE — a rising line means more speed for the same effort.</p>`}
      <div class="legend2"><span><i style="background:var(--cy)"></i>7-day</span><span><i style="background:#8e9df8"></i>28-day</span></div>
      ${lineDetail("efficiency", ser, p => p.y.toFixed(2))}`;
    },

    rpeHeatmap: () => {
      const cells = rpeList.slice(-56).map(l => ({
        band: E.rpeDeviation(l, doc.logs).band,
        title: `${fmtShort(l.date)} · ${logTitle(l)} · RPE ${l.rpe}`,
      }));
      return `
      <div class="hd"><span class="eyebrow">RPE calendar</span><span class="eyebrow tapx">felt vs expected</span></div>
      ${cells.length ? `<div class="heat">${C.heatmapCells(cells)}</div>
        <div class="legend2"><span><i style="background:rgba(86,219,232,.55)"></i>easier</span><span><i style="background:rgba(143,161,179,.30)"></i>normal</span><span><i style="background:rgba(232,107,107,.6)"></i>harder</span></div>
        <div class="callout" id="heat-detail" data-cells='${esc(JSON.stringify(rpeList.slice(-56).map(l => `${fmtShort(l.date)} · ${logTitle(l)} · RPE ${l.rpe}`)))}'>Tap a square to see the session.</div>`
        : `<p class="row-sub">Add an RPE when you log — each workout becomes a square here, red when it felt harder than it should.</p>`}`;
    },

    rpeByType: () => {
      const colors = { easy: "var(--cy)", long: "#7fd6c0", tempo: "var(--sand)", intervals: "#e89b5a", hills: "#e86b6b", climb: "#8e9df8" };
      const ser = [];
      const avgParts = [];
      for (const ty of ["easy", "long", "tempo", "intervals", "hills", "climb"]) {
        const pts = rpeList.filter(l => (l.type || "easy") === ty).map(l => ({ x: dnum(l.date), y: l.rpe, date: l.date, ty, id: l.id }));
        if (pts.length) { ser.push({ points: pts, color: colors[ty] }); avgParts.push(`${ty} ${seriesAvg(pts).toFixed(1)}`); }
      }
      return `
      <div class="hd"><span class="eyebrow">RPE by type</span><span class="eyebrow tapx">1–10</span></div>
      ${avgParts.length ? avgLine(avgParts) : ""}
      ${ser.some(s => s.points.length >= 2) ? wrap("rpeByType", C.lineChart(null, { series: ser, axis: true, taps: true, avg: true, fmtY: v => v.toFixed(0), selected: lineSel.rpeByType })) : `<p class="row-sub">Tag your logs with a type and RPE to see each kind's effort trend on its own.</p>`}
      ${lineDetail("rpeByType", ser, p => `${p.ty} · RPE ${p.y}`)}`;
    },

    consistency: () => `
      <div class="hd"><span class="eyebrow">Consistency</span><span class="eyebrow" style="letter-spacing:.04em;${cons.streak ? "color:var(--cy)" : ""}">${cons.streak ? `STREAK · ${cons.streak} WK${cons.streak > 1 ? "S" : ""} ≥ 80 %` : "LAST 12 PLAN WEEKS"}</span></div>
      ${cons.cells.length ? `<div class="cells">${C.consistencyCells(cons.cells)}</div>` : `<p class="row-sub">This strip fills as plan weeks complete.</p>`}`,

    bests: () => `
      <div class="hd"><span class="eyebrow">Personal bests</span><button class="eyebrow tapx lk" id="pg-pb">add ＋</button></div>
      ${bests.length ? `<div class="pbs">${bests.map(p => `<button class="pb" ${p.logId ? `data-pbid="${p.logId}"` : ""}>
        <span class="pl">${p.label}</span><span class="pv">${fmtBest(p)}</span><span class="pd">${p.manual ? "manual" : fmtShort(p.date)}</span></button>`).join("")}</div>`
        : `<p class="row-sub">Your records appear as you log — biggest climb, longest ride, fastest 5K/10K/half/marathon, 40K.</p>`}`,

    calories: () => {
      const series = calB.map(w => ({ x: dnum(w.start), y: w.total, date: w.start }));
      const total = series.reduce((a, p) => a + p.y, 0);
      const nonzero = series.filter(p => p.y > 0);
      const splitTot = calSplit.planned + calSplit.unplanned;
      const avgC = seriesAvg(series);
      const curFrom = unit === "month" ? t.slice(0, 7) + "-01" : E.addDays(t, -E.dayIndex(t));
      const curCal = E.caloriesInRange(doc.logs, curFrom, t);
      return `
      <div class="hd"><span class="eyebrow">Calories burned</span><span class="eyebrow tapx">per ${unit}</span></div>
      <div class="stat"><span class="midnum">${total.toLocaleString()}</span><span class="unit">kcal · ${win.label.toLowerCase()}</span></div>
      ${avgC != null && series.length > 1 ? avgLine([`${Math.round(avgC).toLocaleString()} kcal / ${unit}`, `this ${unit} ${Math.round(curCal).toLocaleString()} kcal`]) : ""}
      ${nonzero.length >= 2 ? wrap("calories", C.lineChart(series, { axis: true, taps: true, avg: true, color: "#e6a45a", fmtY: v => Math.round(v), selected: lineSel.calories, xLabels: [calB[0].label, calB[calB.length - 1].label] })) : `<p class="row-sub">Log or import activities with calories to see your energy output over time.</p>`}
      ${lineDetail("calories", [{ points: series }], p => `${Math.round(p.y).toLocaleString()} kcal`)}
      ${splitTot > 0 ? `<div class="callout">Planned <b>${calSplit.planned.toLocaleString()}</b> · unplanned <b>${calSplit.unplanned.toLocaleString()}</b> kcal in this range.</div>` : ""}`;
    },

    caloriesByType: () => `
      <div class="hd"><span class="eyebrow">Calories by activity</span><span class="eyebrow tapx">${win.label.toLowerCase()}</span></div>
      ${calTypes.total > 0 ? `<div class="catbars">${calTypes.buckets.map(b => {
        const n = calTypeCounts[b.sport] || 0, avg = n ? Math.round(b.cal / n) : 0;
        return `<div class="catbar"><span class="cl">${b.label}</span><span class="bar"><i style="width:${Math.round(b.share * 100)}%;background:var(--cy)"></i></span><span class="cv">${b.cal.toLocaleString()}<small>${n ? ` · ${n}× · ${avg.toLocaleString()} avg` : ""}</small></span></div>`;
      }).join("")}</div>
        ${calTypes.top ? (() => { const tn = calTypeCounts[calTypes.top.sport] || 0; return `<div class="callout">Most of it — ${Math.round(calTypes.top.share * 100)}% — came from ${calTypes.top.label}${tn ? `, averaging <b>${Math.round(calTypes.top.cal / tn).toLocaleString()}</b> kcal across ${tn} session${tn === 1 ? "" : "s"}` : ""}.</div>`; })() : ""}`
        : `<p class="row-sub">Once activities carry calories, this breaks them down by sport.</p>`}`,

    coach: () => {
      const ins = E.coachInsights({ doc, todayISO: t }).slice(0, 2);
      return `
      <div class="hd"><span class="eyebrow">Coach</span><button class="eyebrow tapx lk" id="pg-coach">open →</button></div>
      ${ins.length ? ins.map(i => coachMini(i)).join("") : `<p class="row-sub">Your coach is gathering data — insights appear as you log workouts and weigh-ins.</p>`}`;
    },
  };

  const order = doc.settings.progressCards.filter(c => c.on && CARDS[c.id]);
  const pr = doc.settings.progressRange;
  const RANGE_OPTS = [["thisWeek", "This week"], ["4w", "4 weeks"], ["8w", "8 weeks"], ["12w", "12 weeks"], ["3m", "3 months"], ["6m", "6 months"], ["ytd", "Year to date"], ["all", "All time"]];
  const rangeBar = `<div class="rangebar">
    <button class="iconbtn sm" id="rg-prev" aria-label="earlier">‹</button>
    <select id="rg-preset" class="rangesel">${RANGE_OPTS.map(([v, l]) => `<option value="${v}" ${pr.preset === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="iconbtn sm" id="rg-next" aria-label="later" ${pr.offset <= 0 ? "disabled" : ""}>›</button>
    <span class="unitseg" style="margin-left:auto">
      <button class="useg ${unit === "week" ? "on" : ""}" data-unit="week">Week</button>
      <button class="useg ${unit === "month" ? "on" : ""}" data-unit="month">Month</button>
    </span>
    <button class="chip ${pr.compare ? "zc2" : ""}" id="rg-compare">vs prev</button>
    <span class="rglabel">${fmtShort(win.from)}–${fmtShort(win.to)}</span>
  </div>`;
  page.innerHTML = `
    <div class="phead"><h1 class="page">Progress</h1><button class="iconbtn" id="pg-customize" aria-label="Customize">${ICONS_UI.sliders}</button></div>
    ${rangeBar}
    ${order.map(c => `<div class="card pc">${CARDS[c.id]()}</div>`).join("") ||
      `<p class="row-sub" style="padding:20px 4px">No cards selected. Tap the sliders icon to choose what to show.</p>`}`;

  // ----- wiring -----
  const setRange = patch => { doc.settings.progressRange = { ...pr, ...patch }; persist(); };
  page.querySelector("#rg-preset").addEventListener("change", e => setRange({ preset: e.target.value, offset: 0 }));
  page.querySelector("#rg-prev").addEventListener("click", () => setRange({ offset: pr.offset + 1 }));
  page.querySelector("#rg-next").addEventListener("click", () => { if (pr.offset > 0) setRange({ offset: pr.offset - 1 }); });
  page.querySelector("#rg-compare").addEventListener("click", () => setRange({ compare: !pr.compare }));
  page.querySelectorAll(".useg").forEach(b => b.addEventListener("click", () => setRange({ unit: b.dataset.unit })));
  page.querySelector("#vo2-setcat")?.addEventListener("click", openVo2Rate);
  page.querySelector("#pg-customize").addEventListener("click", openProgressCustomize);
  page.querySelectorAll("[data-wi]").forEach(r => r.addEventListener("click", () => {
    ridgeSel = ridgeSel === +r.dataset.wi ? null : +r.dataset.wi; renderProgress();
  }));
  page.querySelectorAll("[data-ctab]").forEach(b => b.addEventListener("click", () => {
    cardToggle[b.dataset.ctab] = b.dataset.ctv; lineSel[b.dataset.ctab] = null; renderProgress();
  }));
  page.querySelectorAll("[data-si]").forEach(r => r.addEventListener("click", () => {
    const card = r.closest(".chartwrap")?.dataset.card; if (!card) return;
    const si = +r.dataset.si, pi = +r.dataset.pi;
    const cur = lineSel[card];
    lineSel[card] = (cur && cur.si === si && cur.pi === pi) ? null : { si, pi };
    renderProgress();
  }));
  const heatDetail = page.querySelector("#heat-detail");
  page.querySelectorAll("[data-hi]").forEach(c => c.addEventListener("click", () => {
    try { const arr = JSON.parse(heatDetail.dataset.cells); heatDetail.textContent = arr[+c.dataset.hi] || ""; } catch {}
  }));
  page.querySelector("#pg-weigh")?.addEventListener("click", () => openValueSheet({
    title: "Add weigh-in", label: "Weight", suffix: "kg", step: "0.1",
    value: lastW ? lastW.kg : "", withDate: true,
    onSave: (v, date) => { doc.weighIns = doc.weighIns.filter(w => w.date !== date); doc.weighIns.push({ date, kg: v }); doc.weighIns.sort(byDate); },
  }));
  page.querySelector("#pg-vo2")?.addEventListener("click", () => openValueSheet({
    title: "Add VO₂ reading", label: "VO₂ max", suffix: "ml/kg/min", step: "0.1",
    value: lastV ? lastV.value : "", withDate: true,
    onSave: (v, date) => { doc.vo2History = doc.vo2History.filter(x => x.date !== date); doc.vo2History.push({ date, value: v }); doc.vo2History.sort(byDate); },
  }));
  page.querySelector("#pg-tw")?.addEventListener("click", () => openValueSheet({
    title: "Target weight", label: "Target", suffix: "kg", step: "0.1", value: doc.settings.targetWeightKg, min: 40, max: 150,
    onSave: v => { doc.settings.targetWeightKg = v; },
  }));
  page.querySelector("#pg-pb")?.addEventListener("click", openAddBest);
  page.querySelector("#pg-coach")?.addEventListener("click", () => setTab("coach"));
  page.querySelectorAll("[data-pbid]").forEach(b => b.addEventListener("click", () => {
    const log = doc.logs.find(l => l.id === b.dataset.pbid); if (!log) return;
    openLogSheet({ date: log.date, sport: log.sport, log, title: logTitle(log) });
  }));
  page.querySelectorAll("[data-openlog]").forEach(b => b.addEventListener("click", () => {
    const log = doc.logs.find(l => l.id === b.dataset.openlog); if (!log) return;
    openLogSheet({ date: log.date, sport: log.sport, log, title: logTitle(log) });
  }));
}

/* Format a personal-best value for display. */
function fmtBest(p) {
  if (p.unit === "time") { const s = Math.round(p.value); const m = Math.floor(s / 60), ss = s % 60, h = Math.floor(m / 60);
    return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; }
  if (p.unit === "min") return fmtDur(Math.round(p.value));
  if (p.unit === "m") return `${Math.round(p.value)} m`;
  return `${(+p.value).toFixed(1)} km`;
}

const PB_FIELDS = [
  ["run5k", "5K time", "time"], ["run10k", "10K time", "time"], ["runHalf", "Half marathon", "time"],
  ["runFull", "Marathon", "time"], ["bike40k", "40K ride", "time"], ["biggestAscent", "Biggest climb", "m"],
  ["longestRide", "Longest ride", "km"], ["longestRun", "Longest run", "km"],
];
function openAddBest() {
  let key = "run5k";
  const sheet = openSheet(`
    <div class="sh-title">Add a personal best</div>
    <div class="sh-sub">Record one from before you started logging. Time as mm:ss or h:mm:ss.</div>
    <div class="frow"><span class="l">Record</span>
      <select id="pb-key" class="sel">${PB_FIELDS.map(([k, lab]) => `<option value="${k}">${lab}</option>`).join("")}</select></div>
    <div class="frow"><span class="l">Value</span><input type="text" id="pb-val" placeholder="e.g. 22:30 or 1240"><span class="suffix" id="pb-unit">mm:ss</span></div>
    <div class="frow"><span class="l">Date</span><input type="date" id="pb-date" value="${todayISO()}" max="${todayISO()}"></div>
    <button class="btn" id="pb-save">Save record</button>
  `);
  const unitFor = k => (PB_FIELDS.find(f => f[0] === k)[2] === "time" ? "mm:ss" : PB_FIELDS.find(f => f[0] === k)[2]);
  sheet.querySelector("#pb-key").addEventListener("change", e => { key = e.target.value; sheet.querySelector("#pb-unit").textContent = unitFor(key); });
  sheet.querySelector("#pb-save").addEventListener("click", () => {
    const field = PB_FIELDS.find(f => f[0] === key);
    const raw = sheet.querySelector("#pb-val").value.trim();
    let value = null;
    if (field[2] === "time") {
      const m = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
      if (m) value = (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
    } else value = num(raw);
    if (value == null) { toast("Enter a value (time as mm:ss)"); return; }
    const date = sheet.querySelector("#pb-date").value || todayISO();
    closeOverlay();
    persist(() => {
      doc.manualBests = (doc.manualBests || []).filter(b => b.key !== key);
      doc.manualBests.push({ key, value, date });
    });
    toast("Record saved ✓");
  });
}

/* Quick age + sex capture so the VO₂ fitness-category gauge can rate you
   against the norms — also editable in Settings. */
function openVo2Rate() {
  let sex = doc.settings.sex || "male";
  const sheet = openSheet(`
    <div class="sh-title">Rate my VO₂ max</div>
    <div class="sh-sub">VO₂ norms depend on age and sex — set both and your reading gets a Poor → Superior rating.</div>
    <div class="frow"><span class="l">Age</span><input type="number" id="vr-age" inputmode="numeric" min="14" max="100" value="${doc.settings.age || ""}" placeholder="years"></div>
    <div class="frow"><span class="l">Sex</span>
      <span class="segpick" id="vr-sex">
        <button class="${sex === "male" ? "on" : ""}" data-v="male">Male</button>
        <button class="${sex === "female" ? "on" : ""}" data-v="female">Female</button>
      </span></div>
    <button class="btn" id="vr-save">Save</button>
  `);
  sheet.querySelectorAll("#vr-sex button").forEach(b => b.addEventListener("click", () => {
    sex = b.dataset.v; sheet.querySelectorAll("#vr-sex button").forEach(x => x.classList.toggle("on", x === b));
  }));
  sheet.querySelector("#vr-save").addEventListener("click", () => {
    const age = num(sheet.querySelector("#vr-age").value);
    closeOverlay();
    persist(() => { doc.settings.age = age; doc.settings.sex = sex; });
    toast("Saved ✓");
  });
}

function openProgressCustomize() {
  const cards = doc.settings.progressCards;
  const sheet = openSheet(`
    <div class="sh-title">Customize Progress</div>
    <div class="sh-sub">Toggle cards on or off, drag the handle to reorder.</div>
    <div id="cust-list" class="cust-list">
      ${cards.map(c => `<div class="cust-row" data-id="${c.id}" draggable="false">
        <span class="drag" data-drag>⋮⋮</span>
        <span class="l">${CARD_LABEL[c.id] || c.id}</span>
        <span class="switch ${c.on ? "on" : ""}" data-toggle></span>
      </div>`).join("")}
    </div>
    <button class="btn" id="cust-done">Done</button>
  `);
  const list = sheet.querySelector("#cust-list");
  list.querySelectorAll("[data-toggle]").forEach(sw => sw.addEventListener("click", () => {
    const id = sw.closest(".cust-row").dataset.id;
    const c = cards.find(x => x.id === id); c.on = !c.on;
    sw.classList.toggle("on", c.on);
  }));
  wireReorder(list, () => {
    const ids = [...list.querySelectorAll(".cust-row")].map(r => r.dataset.id);
    doc.settings.progressCards = ids.map(id => cards.find(c => c.id === id));
  });
  sheet.querySelector("#cust-done").addEventListener("click", () => { closeOverlay(); persist(); });
}

/* Pointer-based drag reordering of a vertical list via the .drag handle. */
function wireReorder(list, onChange) {
  list.querySelectorAll("[data-drag]").forEach(h => h.addEventListener("pointerdown", e => {
    e.preventDefault();
    const drag = h.closest(".cust-row");
    drag.classList.add("dragging");
    // document-level listeners + live row positions, so one grab can travel the
    // whole list (moving the row in the DOM never interrupts the drag)
    const move = ev => {
      ev.preventDefault();
      const y = ev.clientY;
      const rows = [...list.querySelectorAll(".cust-row:not(.dragging)")];
      const after = rows.find(r => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (after) list.insertBefore(drag, after);
      else list.appendChild(drag);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      drag.classList.remove("dragging"); onChange();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }));
}

function openValueSheet({ title, label, suffix, step = "1", value = "", withDate = false, min, max, allowClear = false, onSave }) {
  const sheet = openSheet(`
    <div class="sh-title">${title}</div>
    ${withDate ? `<div class="frow"><span class="l">Date</span><input type="date" id="vs-date" value="${todayISO()}" max="${todayISO()}"></div>` : ""}
    <div class="frow"><span class="l">${label}</span><input type="text" step="${step}" inputmode="decimal" id="vs-val" value="${value}" placeholder="—">${suffix ? `<span class="suffix">${suffix}</span>` : ""}</div>
    <button class="btn" id="vs-save">Save</button>
    ${allowClear ? `<button class="btn ghost" id="vs-clear">Clear value</button>` : ""}
  `);
  sheet.querySelector("#vs-save").addEventListener("click", () => {
    const v = num(sheet.querySelector("#vs-val").value);
    if (v == null || (min != null && v < min) || (max != null && v > max)) { toast(min != null ? `Enter ${min}–${max}` : "Enter a number"); return; }
    const date = withDate ? (sheet.querySelector("#vs-date").value || todayISO()) : null;
    closeOverlay();
    persist(() => onSave(v, date));
    toast("Saved ✓");
  });
  sheet.querySelector("#vs-clear")?.addEventListener("click", () => {
    closeOverlay();
    persist(() => onSave(null, null));
    toast("Cleared");
  });
}

/* ---------------- SETTINGS ---------------- */

const METHOD_LABEL = { pctmax: "% of max HR", karvonen: "Karvonen (HR reserve)", lthr: "Lactate threshold", custom: "Custom bounds" };

function renderSettings() {
  const page = $('[data-page="settings"]');
  const st = doc.settings;
  const b = bounds();
  const lay = st.layout;
  const exportDays = st.lastExportAt
    ? Math.floor((E.parseISO(todayISO()) - E.parseISO(st.lastExportAt)) / 864e5) : null;

  page.innerHTML = `
    <h1 class="page">Settings</h1>
    <div class="group"><div class="gh">Heart rate</div><div class="scard">
      <button class="srow" id="st-max"><span class="l">Max HR<span>${st.maxHRAuto ? "auto-updates from your activities" : "set manually"}</span></span><span class="v">${st.maxHR} bpm</span><span class="chev">›</span></button>
      <button class="srow tog" data-tog="maxHRAuto"><span class="l">Auto-update max HR<span>raise it when an activity goes higher</span></span><span class="switch ${st.maxHRAuto ? "on" : ""}"></span></button>
      <button class="srow" id="st-age"><span class="l">Age<span>estimates max HR (208 − 0.7 × age)</span></span><span class="v ${st.age ? "" : "add"}">${st.age ? st.age + " yr" : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-sex"><span class="l">Sex<span>rates your VO₂ max against age/sex norms</span></span><span class="v ${st.sex ? "" : "add"}">${st.sex ? (st.sex === "female" ? "Female" : "Male") : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-rhr"><span class="l">Resting HR<span>adding it switches zones to Karvonen</span></span><span class="v ${st.restingHR ? "" : "add"}">${st.restingHR ? st.restingHR + " bpm" : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-lthr"><span class="l">Lactate threshold<span>optional — enables LTHR-based zones</span></span><span class="v ${st.lthr ? "" : "add"}">${st.lthr ? st.lthr + " bpm" : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-method"><span class="l">Zone method</span><span class="v">${METHOD_LABEL[st.zoneMethod] || st.zoneMethod}</span><span class="chev">›</span></button>
    </div></div>
    <div class="group"><div class="gh">Zones</div><div class="scard">
      ${b.map((z, i) => `<div class="zr"><span class="chip zc${z.z}">Z${z.z}</span><span class="what">${E.ZONE_NAMES[i]}</span><span class="range">${z.lo} – ${z.hi}</span></div>`).join("")}
      <button class="srow" id="st-custom" style="border-top:1px solid var(--line)"><span class="l" style="color:var(--cy)">Customize zones<span>your own bpm bounds — every plan and chart updates</span></span><span class="chev">›</span></button>
    </div></div>
    <div class="group"><div class="gh">Plan</div><div class="scard">
      <button class="srow" id="st-mix"><span class="l">Weekly mix<span>runs · rides · gym per week</span></span><span class="v">${st.weeklyCounts.run} · ${st.weeklyCounts.bike} · ${st.weeklyCounts.gym}</span><span class="chev">›</span></button>
      <button class="srow" id="st-tw"><span class="l">Target weight</span><span class="v">${st.targetWeightKg.toFixed(1)} kg</span><span class="chev">›</span></button>
      <button class="srow" id="st-gr"><span class="l">Weekly growth<span>also drives the “Coming weeks” projection</span></span><span class="v">+${Math.round(st.growthRate * 100)} %</span><span class="chev">›</span></button>
      <button class="srow" id="st-dl"><span class="l">Deload</span><span class="v">every ${ordinal(st.deloadEvery)} week</span><span class="chev">›</span></button>
      <button class="srow" id="st-rest"><span class="l">Rest day<span>the week reflows around your day off</span></span><span class="v">${DAY_LABEL[st.restDay] || "Sunday"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-climb"><span class="l">Climb target<span>base ascent for climbing rides</span></span><span class="v">${st.climbBaseAscent} m</span><span class="chev">›</span></button>
      <button class="srow" id="st-pace"><span class="l">Easy pace<span>your run pace hint until the app has learned</span></span><span class="v ${st.easyPace ? "" : "add"}">${st.easyPace ? `${E.fmtPace(st.easyPace.lo)}–${E.fmtPace(st.easyPace.hi)}` : "Auto"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-quality"><span class="l">Intervals<span>${st.qualityOverride ? "manually unlocked — the gate is off" : "earned after 3 consistent weeks"}</span></span><span class="v ${st.qualityOverride ? "add" : ""}">${st.qualityOverride ? "Unlocked" : qstate().run ? "Earned" : "Locked"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-lay"><span class="l">Weekly layout<span>applies from the next generated week</span></span>
        <span class="laychips">${E.DAYS.map(d => { const v = Array.isArray(lay[d]) ? lay[d][0] : lay[d]; const c = v === "run" ? "lr" : v === "gym" ? "lg" : v === "rest" ? "lx" : "lb"; return `<i class="${c}">${d[0].toUpperCase()}</i>`; }).join("")}</span><span class="chev">›</span></button>
    </div></div>
    <div class="group"><div class="gh">Workouts allowed</div><div class="scard">
      ${WORKOUT_TOGGLES.map(([key, label, sub]) => `
        <button class="srow tog" data-fam="${key}"><span class="l">${label}<span>${sub}</span></span>
          <span class="switch ${st.allowedTypes[key] !== false ? "on" : ""}"></span></button>`).join("")}
    </div></div>
    <div class="group"><div class="gh">Home equipment</div><div class="scard">
      <p class="row-sub" style="padding:6px 14px 2px">Switch on what you own — home workouts only pick exercises you can actually do.</p>
      ${Object.entries(W.EQUIPMENT_LABELS).filter(([k]) => W.HOME_EQUIPMENT.includes(k)).map(([key, label]) => `
        <button class="srow tog" data-equip="${key}"><span class="l">${label}</span>
          <span class="switch ${st.equipment[key] ? "on" : ""}"></span></button>`).join("")}
    </div></div>
    <div class="group"><div class="gh">Data — yours, on this phone</div><div class="scard">
      <button class="srow" id="st-export"><span class="l">Export JSON<span>${exportDays == null ? "never exported yet" : exportDays === 0 ? "exported today" : `last export · ${exportDays} day${exportDays > 1 ? "s" : ""} ago`}</span></span><span class="v add">Export</span></button>
      <button class="srow" id="st-import"><span class="l">Import JSON</span><span class="chev">›</span></button>
      <button class="srow" id="st-csv"><span class="l">Import Garmin CSV<span>Garmin Connect → Activities → Export CSV</span></span><span class="chev">›</span></button>
      <button class="srow" id="st-reset"><span class="l">Reset all data</span><span class="v danger">Reset…</span></button>
    </div></div>
    <p class="row-sub" style="text-align:center;padding:6px 0 2px">Remonte · offline · no accounts, no tracking</p>
    <input type="file" id="st-file-json" accept="application/json,.json" hidden>
    <input type="file" id="st-file-csv" accept=".csv,text/csv" hidden>`;

  $("#st-max").addEventListener("click", () => openValueSheet({
    title: "Max HR", label: "Max HR", suffix: "bpm", value: st.maxHR, min: 120, max: 220,
    onSave: v => { st.maxHR = Math.round(v); toast("Zones updated"); },
  }));
  page.querySelector('[data-tog="maxHRAuto"]').addEventListener("click", () => {
    persist(() => { st.maxHRAuto = !st.maxHRAuto; });
  });
  $("#st-age").addEventListener("click", openAgeSheet);
  $("#st-sex").addEventListener("click", openSexSheet);
  $("#st-rhr").addEventListener("click", () => openValueSheet({
    title: "Resting HR", label: "Resting HR", suffix: "bpm", value: st.restingHR ?? "", min: 30, max: 100, allowClear: !!st.restingHR,
    onSave: v => {
      st.restingHR = v ? Math.round(v) : null;
      if (v && st.zoneMethod === "pctmax") { st.zoneMethod = "karvonen"; toast("Zones switched to Karvonen"); }
      else if (!v && st.zoneMethod === "karvonen") { st.zoneMethod = "pctmax"; toast("Back to % of max"); }
    },
  }));
  $("#st-lthr").addEventListener("click", () => openValueSheet({
    title: "Lactate threshold HR", label: "LTHR", suffix: "bpm", value: st.lthr ?? "", min: 100, max: 210, allowClear: !!st.lthr,
    onSave: v => {
      st.lthr = v ? Math.round(v) : null;
      if (v && st.zoneMethod !== "lthr") toast("Saved — pick “Lactate threshold” as zone method to use it");
      if (!v && st.zoneMethod === "lthr") st.zoneMethod = "pctmax";
    },
  }));
  $("#st-method").addEventListener("click", openMethodSheet);
  $("#st-custom").addEventListener("click", openCustomZones);
  $("#st-tw").addEventListener("click", () => openValueSheet({
    title: "Target weight", label: "Target", suffix: "kg", step: "0.1", value: st.targetWeightKg, min: 40, max: 150,
    onSave: v => { st.targetWeightKg = v; },
  }));
  $("#st-gr").addEventListener("click", openGrowthSheet);
  $("#st-dl").addEventListener("click", () => openValueSheet({
    title: "Deload cadence", label: "Every Nth week", value: st.deloadEvery, min: 2, max: 8,
    onSave: v => { st.deloadEvery = Math.round(v); },
  }));
  $("#st-rest").addEventListener("click", openRestDaySheet);
  $("#st-climb").addEventListener("click", () => openValueSheet({
    title: "Climb target", label: "Base ascent", suffix: "m", step: "50", value: st.climbBaseAscent, min: 100, max: 3000,
    onSave: v => { st.climbBaseAscent = Math.round(v / 10) * 10; toast("Climb target updated"); },
  }));
  $("#st-pace").addEventListener("click", openPaceSheet);
  page.querySelectorAll("[data-fam]").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.fam;
    const turningOff = st.allowedTypes[key] !== false;
    if (turningOff && (RUN_BASE.includes(key) || RIDE_BASE.includes(key))) {
      const group = RUN_BASE.includes(key) ? RUN_BASE : RIDE_BASE;
      const stillOn = group.filter(k => k !== key && st.allowedTypes[k] !== false);
      if (!stillOn.length) { toast("Keep at least one " + (group === RUN_BASE ? "run" : "ride") + " type"); return; }
    }
    persist(() => {
      st.allowedTypes = { ...st.allowedTypes, [key]: !turningOff };
      applyAllowedToCurrentWeek();
    });
  }));
  page.querySelectorAll("[data-equip]").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.equip;
    persist(() => { st.equipment = { ...st.equipment, [key]: !st.equipment[key] }; });
  }));
  $("#st-mix")?.addEventListener("click", () => openWeeklyMix(currentWeek()));
  $("#st-quality").addEventListener("click", () => {
    const qs = qstate();
    if (st.qualityOverride) {
      openModal("Put the gate back?", "Interval sessions return behind the consistency gate (3 of the last 4 weeks ≥ 80 %). Already-planned sessions stay as they are.", [
        { label: "Re-lock the gate", fn: () => { persist(() => { st.qualityOverride = false; }); toast("Gate back on"); } },
        { label: "Keep unlocked", cls: "ghost" },
      ]);
    } else if (qs.run && qs.bike) {
      toast("Already earned — intervals are unlocked");
    } else {
      openModal("Unlock intervals now?", "This skips the 3-consistent-weeks gate that protects the rebuild. New planned weeks get one quality run and one quality ride — this week updates if you remix it.", [
        { label: "Unlock now", fn: () => { persist(() => { st.qualityOverride = true; }); toast("Intervals unlocked"); } },
        { label: "Keep the gate", cls: "ghost" },
      ]);
    }
  });
  $("#st-lay").addEventListener("click", openLayoutEditor);
  $("#st-export").addEventListener("click", exportJSON);
  $("#st-import").addEventListener("click", () => $("#st-file-json").click());
  $("#st-csv").addEventListener("click", () => $("#st-file-csv").click());
  $("#st-file-json").addEventListener("change", e => importJSON(e.target.files[0]));
  $("#st-file-csv").addEventListener("change", e => importCSV(e.target.files[0]));
  $("#st-reset").addEventListener("click", () =>
    openModal("Reset all data?", "Everything on this phone is deleted — plan, logs, weigh-ins. Export first if in doubt.", [
      { label: "Export, then decide", cls: "ghost", fn: exportJSON },
      { label: "Delete everything", cls: "danger", fn: () => { S.wipe(); location.reload(); } },
      { label: "Cancel", cls: "ghost" },
    ]));
}

function openMethodSheet() {
  const st = doc.settings;
  const opts = [
    ["pctmax", "% of max HR", "the default — needs only max HR"],
    ["karvonen", "Karvonen", st.restingHR ? "uses your HR reserve" : "needs resting HR first"],
    ["lthr", "Lactate threshold", st.lthr ? "zones from your LTHR" : "needs an LTHR value first"],
    ["custom", "Custom bounds", st.customZones ? "your own numbers" : "set bounds via “Customize zones”"],
  ];
  const ok = m => m === "pctmax" || (m === "karvonen" && st.restingHR) || (m === "lthr" && st.lthr) || (m === "custom" && st.customZones);
  const sheet = openSheet(`
    <div class="sh-title">Zone method</div>
    ${opts.map(([m, l, sub]) => `<button class="srow" data-m="${m}">
      <span class="l">${l}<span>${sub}</span></span>
      <span class="v ${st.zoneMethod === m ? "add" : ""}">${st.zoneMethod === m ? "✓" : ""}</span></button>`).join("")}
  `);
  sheet.querySelectorAll("[data-m]").forEach(btn => btn.addEventListener("click", () => {
    const m = btn.dataset.m;
    if (!ok(m)) { toast(opts.find(o => o[0] === m)[2]); return; }
    closeOverlay();
    persist(() => { doc.settings.zoneMethod = m; });
    toast("Zones updated");
  }));
}

function openCustomZones() {
  const b = bounds();
  const sheet = openSheet(`
    <div class="sh-title">Customize zones</div>
    <div class="sh-sub">Your bpm bounds — overrides the formula everywhere</div>
    ${b.map((z, i) => `<div class="frow"><span class="chip zc${z.z}" style="flex:none">Z${z.z}</span>
      <input type="text" inputmode="numeric" data-lo="${i}" value="${z.lo}" style="text-align:center">
      <span class="suffix">–</span>
      <input type="text" inputmode="numeric" data-hi="${i}" value="${z.hi}" style="text-align:center"></div>`).join("")}
    <button class="btn" id="cz-save">Use these zones</button>
  `);
  sheet.querySelector("#cz-save").addEventListener("click", () => {
    const zones = [];
    for (let i = 0; i < 5; i++) {
      const lo = num(sheet.querySelector(`[data-lo="${i}"]`).value);
      const hi = num(sheet.querySelector(`[data-hi="${i}"]`).value);
      if (lo == null || hi == null || lo >= hi) { toast(`Z${i + 1}: low must be under high`); return; }
      zones.push({ lo: Math.round(lo), hi: Math.round(hi) });
    }
    closeOverlay();
    persist(() => { doc.settings.customZones = zones; doc.settings.zoneMethod = "custom"; });
    toast("Custom zones active");
  });
}

function openAgeSheet() {
  const st = doc.settings;
  let age = st.age || "";
  const sheet = openSheet(`
    <div class="sh-title">Age</div>
    <div class="sh-sub">Used only to estimate a starting max HR. A real max seen in your activities always wins.</div>
    <div class="frow"><span class="l">Age</span><input type="text" inputmode="numeric" id="ag-val" value="${age}" placeholder="—"><span class="suffix">years</span></div>
    <div class="callout" id="ag-est">Enter your age to see the estimate.</div>
    <button class="btn" id="ag-apply">Save &amp; use as max HR</button>
    <button class="btn ghost" id="ag-save">Save age only</button>
    ${st.age ? `<button class="btn ghost" id="ag-clear">Clear</button>` : ""}
  `);
  const input = sheet.querySelector("#ag-val");
  const est = () => E.estMaxHRFromAge(num(input.value));
  const refresh = () => {
    const e = est();
    sheet.querySelector("#ag-est").innerHTML = e
      ? `Estimated max HR ≈ <b>${e} bpm</b> (208 − 0.7 × age). Your zones recompute from this.`
      : "Enter your age to see the estimate.";
  };
  input.addEventListener("input", refresh); refresh();
  sheet.querySelector("#ag-apply").addEventListener("click", () => {
    const a = num(input.value), e = est();
    if (!e) { toast("Enter a valid age"); return; }
    closeOverlay();
    persist(() => { st.age = Math.round(a); st.maxHR = e; });
    toast(`Max HR set to ${e} from age`);
  });
  sheet.querySelector("#ag-save").addEventListener("click", () => {
    const a = num(input.value);
    if (!a) { toast("Enter a valid age"); return; }
    closeOverlay();
    persist(() => { st.age = Math.round(a); });
    toast("Age saved");
  });
  sheet.querySelector("#ag-clear")?.addEventListener("click", () => {
    closeOverlay(); persist(() => { st.age = null; }); toast("Cleared");
  });
}

function openSexSheet() {
  const st = doc.settings;
  const sheet = openSheet(`
    <div class="sh-title">Sex</div>
    <div class="sh-sub">VO₂ max norms differ by sex — used only to rate your reading Poor → Superior. Nothing else changes.</div>
    <div class="frow"><span class="l">Sex</span>
      <span class="segpick" id="sx-pick">
        <button class="${st.sex === "male" ? "on" : ""}" data-v="male">Male</button>
        <button class="${st.sex === "female" ? "on" : ""}" data-v="female">Female</button>
      </span></div>
    ${st.sex ? `<button class="btn ghost" id="sx-clear">Clear</button>` : ""}
  `);
  sheet.querySelectorAll("#sx-pick button").forEach(b => b.addEventListener("click", () => {
    closeOverlay(); persist(() => { st.sex = b.dataset.v; }); toast("Saved ✓");
  }));
  sheet.querySelector("#sx-clear")?.addEventListener("click", () => {
    closeOverlay(); persist(() => { st.sex = null; }); toast("Cleared");
  });
}

/* "6:30" → 390 sec/km, within sane bounds. */
function parsePace(str) {
  const m = String(str).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const sec = +m[1] * 60 + +m[2];
  return sec >= 180 && sec <= 600 ? sec : null;
}

function openPaceSheet() {
  const st = doc.settings;
  const cur = st.easyPace;
  const sheet = openSheet(`
    <div class="sh-title">Easy pace</div>
    <div class="sh-sub">Your Z2 range, like 6:30 — used for run pace hints until the app has learned from 3 easy runs with HR + distance, then the learned pace takes over.</div>
    <div class="frow"><span class="l">From</span><input type="text" inputmode="numeric" id="ep-lo" placeholder="6:30" value="${cur ? E.fmtPace(cur.lo) : ""}"><span class="suffix">/km</span></div>
    <div class="frow"><span class="l">To</span><input type="text" inputmode="numeric" id="ep-hi" placeholder="7:00" value="${cur ? E.fmtPace(cur.hi) : ""}"><span class="suffix">/km</span></div>
    <button class="btn" id="ep-save">Save</button>
    ${cur ? `<button class="btn ghost" id="ep-clear">Back to automatic</button>` : ""}
  `);
  sheet.querySelector("#ep-save").addEventListener("click", () => {
    let lo = parsePace(sheet.querySelector("#ep-lo").value);
    let hi = parsePace(sheet.querySelector("#ep-hi").value);
    if (lo == null || hi == null) { toast("Use min:sec, e.g. 6:30 (3:00–10:00)"); return; }
    if (lo > hi) [lo, hi] = [hi, lo];
    closeOverlay();
    persist(() => { st.easyPace = { lo, hi }; });
    toast("Easy pace set ✓");
  });
  sheet.querySelector("#ep-clear")?.addEventListener("click", () => {
    closeOverlay();
    persist(() => { st.easyPace = null; });
    toast("Back to automatic");
  });
}

function openGrowthSheet() {
  const st = doc.settings;
  let v = Math.round(st.growthRate * 100);
  const sheet = openSheet(`
    <div class="sh-title">Weekly growth</div>
    <div class="sh-sub">Default proposal after a good week</div>
    <div class="nextline"><span class="midnum" id="gr-v">+${v} %</span></div>
    <input type="range" min="0" max="15" step="1" id="gr-slider" value="${v}">
    <div class="ticks"><span>0</span><span>+15 %</span></div>
    <button class="btn" id="gr-save">Save</button>
  `);
  sheet.querySelector("#gr-slider").addEventListener("input", e => {
    v = +e.target.value;
    sheet.querySelector("#gr-v").textContent = `+${v} %`;
  });
  sheet.querySelector("#gr-save").addEventListener("click", () => {
    closeOverlay();
    persist(() => { st.growthRate = v / 100; });
    toast("Saved ✓");
  });
}

function openLayoutEditor() {
  const lay = {}; for (const d of E.DAYS) { const v = doc.settings.layout[d]; lay[d] = Array.isArray(v) ? (v[0] || "rest") : (v || "rest"); }
  const OPTS = [["run", "Run"], ["bike", "Ride"], ["bike-long", "Long"], ["gym", "Gym"], ["rest", "Rest"]];
  const sheet = openSheet(`
    <div class="sh-title">Weekly layout</div>
    <div class="sh-sub">Applies when the next week is generated</div>
    ${E.DAYS.map(d => `<div class="seg" data-day="${d}">
      <span class="l" style="flex:0 0 44px;align-self:center;color:var(--sub);font-weight:700;font-size:13px">${d.toUpperCase()}</span>
      ${OPTS.map(([v, l]) => `<button data-v="${v}" class="${lay[d] === v ? "on" : ""}">${l}</button>`).join("")}</div>`).join("")}
    <button class="btn" id="ly-save">Save for next week</button>
    <button class="btn ghost" id="ly-now">Apply to this week too</button>
    <button class="btn ghost" id="ly-auto">Auto-schedule this week (best for me)</button>
  `);
  sheet.querySelectorAll(".seg[data-day]").forEach(row => {
    row.querySelectorAll("[data-v]").forEach(btn => btn.addEventListener("click", () => {
      lay[row.dataset.day] = btn.dataset.v;
      row.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("on", x === btn));
    }));
  });
  const cutoffNote = () => {
    const t = todayISO(), w = currentWeek();
    if (!w) return "";
    const di = E.dayIndex(t);
    return di >= 6 ? "" : ` Only ${E.DAYS.slice(di + 1).map(d => d.toUpperCase()).join(", ")} change — done and today stay put.`;
  };
  // rebuild the current week's *future* days from a day→sport map, freezing past+today
  const applyToCurrentWeek = (mapForFuture) => {
    const w = currentWeek(); if (!w) { toast("No active week"); return; }
    const t = todayISO(), di = E.dayIndex(t);
    persist(() => {
      // freeze sessions on past+today; replace future days per the map
      for (const s of w.sessions) {
        const sdi = E.DAYS.indexOf(s.day);
        if (sdi <= di) continue; // protect past + today
        const want = mapForFuture[s.day] || "rest";
        if (want === "rest") { Object.assign(s, { sport: "rest", kind: "rest", targetMin: 0, zone: 0 }); delete s.qualityTemplate; delete s.gym; delete s.venue; }
        else if (want === "run" || want === "bike") { Object.assign(s, { sport: want, kind: "easy", targetMin: s.targetMin || (want === "run" ? 35 : 60), zone: 2 }); delete s.qualityTemplate; delete s.gym; delete s.venue; }
        else if (want === "bike-long") { Object.assign(s, { sport: "bike", kind: "long", targetMin: Math.max(s.targetMin, 90), zone: 2 }); delete s.qualityTemplate; delete s.gym; delete s.venue; }
        else if (want === "gym") { Object.assign(s, { sport: "gym", kind: "easy", targetMin: E.snapGymMinutes(s.targetMin || 45), venue: doc.settings.gymVenueDefault || "home", gym: { seed: E.hashSeed(`${w.id}-${s.day}-${s.slot ?? 0}`), avoidIds: [], swaps: {} } }); delete s.qualityTemplate; delete s.zone; }
      }
      w.targetMin = { run: E.sumSessions(w.sessions, "run"), bike: E.sumSessions(w.sessions, "bike"), gym: E.sumSessions(w.sessions, "gym") };
    });
  };
  sheet.querySelector("#ly-now").addEventListener("click", () => {
    closeOverlay();
    persist(() => { doc.settings.layout = lay; });
    applyToCurrentWeek(lay);
    toast("Applied to this week");
  });
  sheet.querySelector("#ly-auto").addEventListener("click", () => {
    closeOverlay();
    const w = currentWeek(); if (!w) { toast("No active week"); return; }
    persist(() => { reflowWeek(w); }); // placeLayout = fatigue-aware optimal
    toast("Auto-scheduled for your condition");
  });
  sheet.querySelector("#ly-save").addEventListener("click", () => {
    const doSave = () => {
      closeOverlay();
      persist(() => { doc.settings.layout = lay; });
      toast("Layout saved — next week uses it");
    };
    const consec = E.consecutiveRunDays(lay);
    if (consec.length && !doc.settings.warnedRunAdjacency) {
      closeOverlay();
      openModal("Back-to-back runs", `Runs land on consecutive days (${consec.map(p => p.join("+")).join(", ")}) — the main injury risk at current load. Keep it anyway?`, [
        { label: "Keep it", fn: () => { doc.settings.warnedRunAdjacency = true; persist(() => { doc.settings.layout = lay; }); toast("Layout saved"); } },
        { label: "Go back", cls: "ghost", fn: openLayoutEditor },
      ]);
      return;
    }
    doSave();
  });
}

/* ---------------- data in / out ---------------- */

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function exportJSON() {
  doc.settings.lastExportAt = todayISO();
  S.save(doc);
  download(`remonte-export-${todayISO()}.json`, S.exportText(doc));
  toast("Exported — keep it somewhere safe");
  render();
}

function importJSON(file) {
  if (!file) return;
  file.text().then(text => {
    const v = S.validateImport(text);
    if (!v.ok) { openModal("Can't import", esc(v.error), [{ label: "OK", cls: "ghost" }]); return; }
    const inc = v.doc;
    const sum = `${inc.logs.length} activities · ${(inc.weeks || []).length} plan weeks · ${(inc.weighIns || []).length} weigh-ins`;
    openModal("Import data", `Found ${sum}. Replace wipes what's here; merge adds anything missing and keeps current settings.`, [
      { label: "Replace everything", cls: "danger", fn: () => { doc = inc; persist(); toast("Imported — replaced"); } },
      { label: "Merge into current", fn: () => { doc = S.mergeDocs(doc, inc); persist(); toast("Imported — merged"); } },
      { label: "Cancel", cls: "ghost" },
    ]);
  });
  $("#st-file-json").value = "";
}

const csvLog = r => ({ id: S.uid(), date: r.date, time: r.time, sport: r.sport, min: r.min,
                       km: r.km ?? undefined, avgHR: r.avgHR ?? undefined, maxHR: r.maxHR ?? undefined,
                       ascent: r.ascent ?? undefined, descent: r.descent ?? undefined,
                       calories: r.calories ?? undefined, note: r.note || undefined, source: "csv" });

function importCSV(file) {
  if (!file) return;
  file.text().then(text => {
    const parsed = E.parseGarminCSV(text);
    if (parsed.error) { openModal("Can't import", esc(parsed.error), [{ label: "OK", cls: "ghost" }]); return; }
    const { fresh, enrich, unchanged } = E.classifyImport(parsed.rows, doc.logs);
    const c = parsed.counts;

    const finish = () => {
      closeOverlay();
      persist(() => {
        for (const r of fresh) doc.logs.push(csvLog(r));
        for (const { log, fill } of enrich) Object.assign(log, fill); // gap-fill missing fields only
        doc.logs.sort((a, b) => (a.date < b.date ? -1 : 1));
      });
      toast(`Added ${fresh.length}${enrich.length ? ` · updated ${enrich.length}` : ""}`);
    };

    if (!fresh.length && !enrich.length) {
      toast(unchanged.length ? `Already up to date (${unchanged.length} known)` : "Nothing to import");
      $("#st-file-csv").value = ""; return;
    }
    const parts = [];
    if (fresh.length) parts.push(`add <b>${fresh.length}</b> new ${fresh.length === 1 ? "activity" : "activities"}`);
    if (enrich.length) parts.push(`fill in missing data (calories, HR, ascent…) on <b>${enrich.length}</b> existing`);
    openModal("Import Garmin CSV",
      `This will ${parts.join(" and ")}${unchanged.length ? `. ${unchanged.length} are already complete` : ""}${c.bad ? ` · ${c.bad} unreadable` : ""}.`,
      [{ label: "Import", fn: finish }, { label: "Cancel", cls: "ghost" }]);
  });
  $("#st-file-csv").value = "";
}

/* ---------------- go ---------------- */
boot();
