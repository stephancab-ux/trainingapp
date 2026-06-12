/* Remonte UI — renders the four tabs, the check-in flow and all sheets.
   All training rules live in engine.js; all persistence in store.js. */
import * as E from "./engine.js";
import * as S from "./store.js";
import * as C from "./charts.js";

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
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(E.parseISO(iso));
}
const fmtShort = iso => fmtDate(iso, { day: "numeric", month: "short" });

const ICONS = {
  run: `<svg viewBox="0 0 24 24"><circle cx="14" cy="5" r="2"/><path d="M11.5 20l2-5-3-3 3.5-4 2.5 3h3M8 12l2-3M7 20l2.5-4"/></svg>`,
  bike: `<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-6.5h4.5L18 17M10 10.5L8.5 7H6.5M14.5 10.5L13 7h2.5"/></svg>`,
  rest: `<svg viewBox="0 0 24 24"><path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a7 7 0 0 0 9.5 9.5z"/></svg>`,
  other: `<svg viewBox="0 0 24 24"><path d="M3 18.5l5.5-8 3.5 4.5 4-6.5 5 10z"/></svg>`,
};
const sportClass = sp => sp === "run" ? "runc" : sp === "bike" ? "bikec" : "restc";

/* Workout-type tags on logs (v1.1). Purely descriptive — no plan math. */
const LOG_TYPES = {
  run:  [["easy", "Easy"], ["tempo", "Tempo"], ["intervals", "Intervals"], ["hills", "Hills"], ["long", "Long"]],
  bike: [["easy", "Easy"], ["climb", "Climbing"], ["intervals", "Intervals"], ["long", "Long"]],
};
const TYPE_NAME = {
  run:  { easy: "Easy run", tempo: "Tempo run", intervals: "Interval run", hills: "Hill run", long: "Long run" },
  bike: { easy: "Easy ride", climb: "Climbing ride", intervals: "Interval ride", long: "Long ride" },
};
function logTitle(l) {
  return TYPE_NAME[l.sport]?.[l.type] ||
    (l.sport === "bike" ? "Ride" : l.sport[0].toUpperCase() + l.sport.slice(1));
}

function kindLabel(s) {
  if (s.sport === "rest") return "Rest";
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
    if (e.target.closest("input, select, textarea")) return;
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
  S.save(doc);
  render();
}

/* ---------------- plan state helpers ---------------- */

const lastWeek = () => doc.weeks[doc.weeks.length - 1];
function currentWeek() {
  const t = todayISO();
  return doc.weeks.find(w => t >= w.startDate && t <= E.addDays(w.startDate, 6)) || null;
}
function weekIndex(w) { return doc.weeks.findIndex(x => x.id === w.id); }

function logFor(date, sport) {
  return doc.logs.find(l => l.date === date && l.sport === sport && l.source !== "seed");
}
function sessionStatus(week, s) {
  const date = E.dateOfDay(week, s.day);
  if (s.sport === "rest") return { kind: "rest", date };
  const log = logFor(date, s.sport);
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
  setTab("today");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function renderFirstRun() {
  const def = E.snapToMonday(todayISO());
  document.body.insertAdjacentHTML("beforeend", `
    <div class="firstrun"><div class="wrap">
      <h1>REM<em>O</em>NTE</h1>
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
  $("#weekdot").hidden = !checkinDue();
  $("#fab").hidden = tab !== "week";
  renderBanner();
  ({ today: renderToday, week: renderWeek, progress: renderProgress, settings: renderSettings })[tab]();
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

  let head = `<div><div class="eyebrow">${fmtDate(t)}${week ? ` · <span class="cyt">Week ${week.weekNum}</span>` : ""}</div><h1 class="page">Today</h1></div>`;

  if (!week) {
    if (doc.weeks[0] && t < doc.weeks[0].startDate) {
      page.innerHTML = head + `<div class="card">
        <div class="t-chips"><span class="chip restc">BEFORE WEEK 1</span></div>
        <p class="note-sub">Week 1 starts <b>${fmtDate(doc.weeks[0].startDate)}</b>. Until then anything easy counts — log it from the Week tab if you like.</p></div>`;
      return;
    }
    page.innerHTML = head + `<div class="card">
      <div class="t-chips"><span class="chip runc">PICK UP</span></div>
      <p class="note-sub">Pick up where you left off — close out your last week and the next one appears, starting this Monday.</p>
      <div class="t-actions"><button class="btn" id="td-checkin">Do the check-in</button></div></div>`;
    $("#td-checkin")?.addEventListener("click", () => openCheckin(due || lastWeek()));
    return;
  }

  const s = week.sessions[E.dayIndex(t)];
  const st = sessionStatus(week, s);
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
      <p class="t-note">${[l.km ? `${l.km} km` : "", l.km && l.sport === "run" ? E.fmtPace(l.min * 60 / l.km) + " /km" : "", l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ") || "Nice. That's the whole job."}</p>
      <div class="t-actions"><button class="btn ghost" id="td-edit">Edit this log</button></div>
    </div>`;
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
        <p class="row-sub" style="margin-top:3px">${E.QUALITY_WARMUP}</p></div>` : ""}
      ${pace && !tpl ? `<div class="t-block"><div class="lab">Pace · estimate</div>
        <div class="t-pace-v">≈ ${E.fmtPace(pace.lo)}–${E.fmtPace(pace.hi)} /km <span>${pace.learned ? `learned from your last ${pace.n} easy runs` : pace.manual ? "your pace setting — easy runs will tune this" : "starting estimate — easy runs tune this"}</span></div></div>` : ""}
      ${s.note ? `<p class="row-sub" style="margin-top:10px">${esc(s.note)}</p>` : ""}
      ${s.kind === "easy" && s.sport === "run" ? `<p class="t-note">Keep it conversational — walk breaks are fine. Same heart rate, faster pace is how the engine comes back.</p>` : ""}
      ${s.kind === "long" ? `<p class="t-note">Steady and unhurried — this ride is the week's anchor.</p>` : ""}
      <div class="t-actions">
        <button class="btn" id="td-log">Log this session</button>
        ${st.kind !== "skipped" ? `<button class="btn ghost" id="td-skip">Skip today</button>` : ""}
      </div>
    </div>`;
  }

  // quiet one-tap for an unlogged yesterday — never a guilt banner
  let yLink = "";
  const yDate = E.addDays(t, -1);
  const yWeek = doc.weeks.find(w => yDate >= w.startDate && yDate <= E.addDays(w.startDate, 6));
  if (yWeek) {
    const ys = yWeek.sessions[E.dayIndex(yDate)];
    if (ys.sport !== "rest" && !logFor(yDate, ys.sport) && !ys.skipped) {
      yLink = `<button class="linkrow" id="td-yest">Yesterday's ${ys.sport === "run" ? "run" : "ride"} isn't logged — add it in 30 s →</button>`;
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
  $("#td-skip")?.addEventListener("click", () => openSkip(week, s));
  $("#td-checkin")?.addEventListener("click", () => openCheckin(due || week));
  $("#td-yest")?.addEventListener("click", () => {
    const ys = yWeek.sessions[E.dayIndex(yDate)];
    openLogSheet({ date: yDate, sport: ys.sport, prefillMin: ys.targetMin, title: kindLabel(ys), type: typeOfSession(ys) });
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
  const sheet = openSheet(`
    <div class="sh-title">${isEdit ? "Edit" : "Log"} · ${esc(title || sport)}</div>
    <div class="sh-sub">${fmtDate(date)}${isEdit ? "" : " — pre-filled with the plan"}</div>
    <div class="frow"><span class="l">Duration</span>
      <span class="stepper"><button data-d="-5">−</button><span class="v" id="lg-min">${min} min</span><button data-d="5">+</button></span></div>
    ${typeRow}
    <div class="frow"><span class="l">Distance</span><input type="number" step="0.01" inputmode="decimal" id="lg-km" placeholder="—" value="${isEdit && log.km != null ? log.km : ""}"><span class="suffix">km</span></div>
    <div class="frow"><span class="l">Avg heart rate</span><input type="number" inputmode="numeric" id="lg-hr" placeholder="—" value="${isEdit && log.avgHR != null ? log.avgHR : ""}"><span class="suffix">bpm</span></div>
    <div class="rpe-row"><span class="l">RPE</span>${Array.from({ length: 10 }, (_, i) =>
      `<button data-rpe="${i + 1}" class="${rpe === i + 1 ? "on" : ""}">${i + 1}</button>`).join("")}</div>
    <div class="frow"><span class="l">Note</span><input type="text" id="lg-note" placeholder="optional" value="${isEdit ? esc(log.note || "") : ""}"></div>
    <button class="btn" id="lg-save">${isEdit ? "Save changes" : "Save session"}</button>
    ${isEdit ? `<button class="btn danger" id="lg-del">Delete this log</button>` : ""}
  `);
  sheet.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => {
    min = Math.max(5, min + parseInt(b.dataset.d, 10));
    sheet.querySelector("#lg-min").textContent = `${min} min`;
  }));
  sheet.querySelectorAll("[data-ty]").forEach(b => b.addEventListener("click", () => {
    typ = b.dataset.ty;
    sheet.querySelectorAll("[data-ty]").forEach(x => x.classList.toggle("on", x.dataset.ty === typ));
  }));
  sheet.querySelectorAll("[data-rpe]").forEach(b => b.addEventListener("click", () => {
    rpe = rpe === +b.dataset.rpe ? null : +b.dataset.rpe;
    sheet.querySelectorAll("[data-rpe]").forEach(x => x.classList.toggle("on", +x.dataset.rpe === rpe));
  }));
  sheet.querySelector("#lg-save").addEventListener("click", () => {
    const km = num(sheet.querySelector("#lg-km").value);
    const hr = num(sheet.querySelector("#lg-hr").value);
    const note = sheet.querySelector("#lg-note").value.trim();
    closeOverlay();
    persist(() => {
      if (isEdit) {
        Object.assign(log, { min, km: km ?? undefined, avgHR: hr ?? undefined,
                             rpe: rpe ?? undefined, note: note || undefined,
                             type: typ ?? undefined });
      } else {
        doc.logs.push({ id: S.uid(), date, sport, min, km: km ?? undefined,
                        avgHR: hr ?? undefined, rpe: rpe ?? undefined,
                        note: note || undefined, type: typ ?? undefined, source: "manual" });
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
    <div class="seg" id="ul-sport">
      <button data-sp="run" class="on">Run</button><button data-sp="bike">Ride</button><button data-sp="other">Other</button></div>
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

function renderWeek() {
  const page = $('[data-page="week"]');
  const week = currentWeek() || lastWeek();
  const due = checkinDue();
  if (!week) { page.innerHTML = `<h1 class="page">Week</h1>`; return; }

  const end = E.addDays(week.startDate, 6);
  const runDone = Math.min(week.targetMin.run, sportLogged(week, "run"));
  const bikeDone = Math.min(week.targetMin.bike, sportLogged(week, "bike"));
  const runs = week.sessions.filter(x => x.sport === "run").length;
  const bikes = week.sessions.filter(x => x.sport === "bike").length;

  const dayRows = week.sessions.map((s, i) => {
    const st = sessionStatus(week, s);
    const d = E.parseISO(st.date).getUTCDate();
    const dn = E.DAYS[i].toUpperCase();
    let sub = "", stIcon = "";
    if (st.kind === "done") {
      const l = st.log;
      const tyTag = l.type && l.type !== "easy" ? (l.type === "climb" ? "climbing" : l.type) : "";
      sub = [tyTag, `${l.min} min`, l.km ? `${l.km} km` : "", l.sport === "run" && l.km ? E.fmtPace(l.min * 60 / l.km) + " /km" : "", l.avgHR ? `${l.avgHR} bpm` : ""].filter(Boolean).join(" · ");
      stIcon = `<span class="st done"><svg viewBox="0 0 24 24"><path d="M5 13l4.2 4L19 7"/></svg></span>`;
    } else if (st.kind === "skipped") {
      sub = "skipped — gone, no debt";
      stIcon = `<span class="st skip"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></span>`;
    } else if (st.kind === "today") {
      const z = zoneInfo(s);
      sub = `today · ${z.label} · ${z.lo}–${z.hi} bpm`;
      stIcon = `<span class="st now"></span>`;
    } else if (st.kind === "pending") {
      sub = "not logged yet";
      stIcon = `<span class="st pend"></span>`;
    } else if (st.kind === "rest") {
      sub = due && s.day === "sun" ? "check-in is open" : week.isDeload ? "deload — recover on purpose" : "check-in opens here Sunday";
      stIcon = `<span class="st" style="background:none"></span>`;
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

  page.innerHTML = `
    <div><div class="eyebrow">${fmtShort(week.startDate)} – ${fmtShort(end)}${week.isDeload ? ` · <span style="color:var(--sand)">DELOAD</span>` : ""}</div>
    <h1 class="page">Week ${week.weekNum}</h1></div>
    ${due ? `<button class="card" id="wk-checkin" style="display:flex;gap:12px;align-items:center;border-color:rgba(86,219,232,.35)">
       <span style="flex:1;text-align:left"><b>Sunday check-in is open</b><br><span class="row-sub">2 minutes: weight, feel, next week's volume</span></span>
       <span class="chip runc">GO →</span></button>` : ""}
    <div class="card" style="padding:13px 16px"><div class="tot">
      <div class="row"><span class="nm">Run</span><span class="bar"><i style="width:${pct(runDone, week.targetMin.run)}%;background:var(--cy)"></i></span><span class="qty">${sportLogged(week, "run")} / ${week.targetMin.run} min</span></div>
      <div class="row"><span class="nm">Ride</span><span class="bar"><i style="width:${pct(bikeDone, week.targetMin.bike)}%;background:var(--bike)"></i></span><span class="qty">${sportLogged(week, "bike")} / ${week.targetMin.bike} min</span></div>
    </div></div>
    <div class="card days">${dayRows}</div>
    <div class="mix">
      <div class="half"><span class="mlab">Runs<b>${runs}</b></span><span class="ud">
        <button id="run-up" ${runs >= 4 || runs + bikes >= 6 ? "disabled" : ""}>+</button>
        <button id="run-dn" ${runs <= 0 ? "disabled" : ""}>−</button></span></div>
      <div class="half"><span class="mlab">Rides<b>${bikes}</b></span><span class="ud">
        <button id="bike-up" ${bikes >= 5 || runs + bikes >= 6 ? "disabled" : ""}>+</button>
        <button id="bike-dn" ${bikes <= 0 ? "disabled" : ""}>−</button></span></div>
    </div>
    ${unlockCard()}
    ${comingWeeksCard()}
    <button class="linkrow" id="wk-history">All activity →</button>`;

  page.querySelectorAll("[data-di]").forEach(b => b.addEventListener("click", () => {
    const s = week.sessions[+b.dataset.di];
    const st = sessionStatus(week, s);
    if (st.kind === "done") openLogSheet({ date: st.date, sport: s.sport, log: st.log, title: kindLabel(s), type: typeOfSession(s) });
    else if (s.kind === "quality") openWorkoutChooser(week, s, st);
    else openLogSheet({ date: st.date, sport: s.sport, prefillMin: s.targetMin, title: kindLabel(s), type: typeOfSession(s) });
  }));
  $("#wk-checkin")?.addEventListener("click", () => openCheckin(due));
  $("#wk-history").addEventListener("click", openHistory);
  const remix = (dr, db) => () => changeMix(week, runs + dr, bikes + db);
  $("#run-up")?.addEventListener("click", remix(1, 0));
  $("#run-dn")?.addEventListener("click", remix(-1, 0));
  $("#bike-up")?.addEventListener("click", remix(0, 1));
  $("#bike-dn")?.addEventListener("click", remix(0, -1));
}

const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;
function sportLogged(week, sport) {
  const end = E.addDays(week.startDate, 6);
  return doc.logs.filter(l => l.sport === sport && l.source !== "seed" &&
    l.date >= week.startDate && l.date <= end).reduce((a, l) => a + (l.min || 0), 0);
}

function changeMix(week, runCount, bikeCount) {
  const idx = weekIndex(week);
  const prev = idx > 0 ? doc.weeks[idx - 1] : null;
  const qs = qstate();
  const ci = doc.checkins.find(c => c.weekId === week.id);
  const { week: newWeek, warnings } = E.relayoutWeek({
    week, runCount, bikeCount,
    prevRunMin: prev ? prev.targetMin.run : null,
    quality: ci?.noQuality ? { run: false, bike: false } : { run: qs.run, bike: qs.bike },
    runQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "run"),
    bikeQTemplate: E.qualityTemplateFor(doc.weeks.slice(0, idx), "bike"),
  });
  const apply = () => {
    persist(() => { doc.weeks[idx] = newWeek; });
    toast(`${runCount} runs · ${bikeCount} rides`);
  };
  if (warnings.includes("consecutive-runs") && !doc.settings.warnedRunAdjacency) {
    openModal("Back-to-back runs", "This mix forces runs on consecutive days — the main injury risk at current load. Keep it anyway?", [
      { label: "Keep it", fn: () => { doc.settings.warnedRunAdjacency = true; apply(); } },
      { label: "Undo", cls: "ghost" },
    ]);
  } else apply();
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
                                quality: { run: q.run, bike: q.bike } });
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

/* Tap a planned quality session: log it, or swap the workout type. */
function openWorkoutChooser(week, s, st) {
  const cur = E.QUALITY_TEMPLATES[s.qualityTemplate];
  const count = doc.weeks.reduce((a, w) =>
    a + w.sessions.filter(x => x.sport === s.sport && x.kind === "quality").length, 0);
  const intervalKey = cur?.family === "intervals" ? s.qualityTemplate
    : s.sport === "run" ? (count >= 4 ? "runQ2" : "runQ1") : (count >= 4 ? "bikeQ2" : "bikeQ1");
  const keys = s.sport === "run" ? [intervalKey, "runTempo", "runHills"] : [intervalKey, "bikeClimb"];

  const sheet = openSheet(`
    <div class="sh-title">${kindLabel(s)} · ${s.targetMin} min</div>
    <div class="sh-sub">${fmtDate(st.date)} — ${E.QUALITY_WARMUP.toLowerCase()}</div>
    <button class="btn" id="qc-log">Log this session</button>
    <div class="sh-sub" style="margin-top:16px;text-transform:uppercase;letter-spacing:.08em;font-size:11px">Swap the workout</div>
    ${keys.map(k => {
      const t = E.QUALITY_TEMPLATES[k];
      const on = k === s.qualityTemplate;
      return `<button class="srow" data-q="${k}">
        <span class="l">${t.name}<span>${t.label}</span></span>
        ${on ? `<span class="v" style="color:var(--cy)">current</span>` : `<span class="chev">›</span>`}
      </button>`;
    }).join("")}
  `);
  sheet.querySelector("#qc-log").addEventListener("click", () => {
    closeOverlay();
    openLogSheet({ date: st.date, sport: s.sport, prefillMin: s.targetMin,
                   title: kindLabel(s), type: typeOfSession(s) });
  });
  sheet.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.q;
    if (k === s.qualityTemplate) { closeOverlay(); return; }
    const t = E.QUALITY_TEMPLATES[k];
    closeOverlay();
    persist(() => { s.qualityTemplate = k; s.zone = t.zone; });
    toast(`${t.name} on ${fmtShort(st.date)}`);
  }));
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
        <input type="number" step="0.1" inputmode="decimal" id="ci-kg" placeholder="${lastKg ?? "—"}" value="${state.weightKg ?? ""}"><span class="suffix">kg</span></div></div>
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
        <div class="frow"><span class="l">HRV · 7-day avg</span><input type="number" inputmode="numeric" id="ci-hrv" placeholder="—" value="${state.hrv7d ?? ""}"><span class="suffix">ms</span></div>
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

    const build = ratePct => nextIsDeload
      ? E.deloadWeek({ prevLoadWeek: prevLoad, startDate, weekNum: nextNum })
      : E.planNextWeek({
          prevLoadWeek: prevLoad, chosenRate: ratePct / 100, settings: doc.settings,
          startDate, weekNum: nextNum,
          quality: { run: qs.run, bike: qs.bike }, noQuality: rec.noQuality,
          runQTemplate: E.qualityTemplateFor(doc.weeks, "run"),
          bikeQTemplate: E.qualityTemplateFor(doc.weeks, "bike"),
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

/* ---------------- PROGRESS ---------------- */

let ridgeSel = null;

function ridgeDetail(vol) {
  if (ridgeSel == null || !vol[ridgeSel]) return "";
  const p = vol[ridgeSel];
  const tot = p.run + p.bike;
  const parts = [];
  parts.push(tot > 0 ? `<b>${fmtDur(tot)}</b> — run ${fmtDur(p.run)} · ride ${fmtDur(p.bike)}` : "no activity logged");
  if (p.target) parts.push(`${Math.round((tot / p.target) * 100)} % of the ${fmtDur(p.target)} target`);
  else parts.push("no plan that week");
  if (p.isDeload) parts.push(`<span style="color:var(--sand)">deload</span>`);
  return `<div class="callout">${fmtShort(p.start)} – ${fmtShort(E.addDays(p.start, 6))} · ${parts.join(" · ")}</div>`;
}

function renderProgress() {
  const page = $('[data-page="progress"]');
  const t = todayISO();
  const vol = E.weeklyVolume({ logs: doc.logs, weeks: doc.weeks, todayISO: t, n: 12 });

  const wi = doc.weighIns;
  const lastW = wi.length ? wi[wi.length - 1] : null;
  const vo2 = doc.vo2History;
  const lastV = vo2.length ? vo2[vo2.length - 1] : null;
  const vo2AtTarget = lastW && lastV ? E.vo2AtTargetWeight(lastV.value, lastW.kg, doc.settings.targetWeightKg) : null;

  const dayOff = (iso, from) => Math.round((E.parseISO(iso) - E.parseISO(from)) / 864e5);
  const wPts = wi.map(w => ({ x: dayOff(w.date, wi[0].date), y: w.kg }));
  const vPts = vo2.map(v => ({ x: dayOff(v.date, vo2[0].date), y: v.value }));

  const easyRuns = doc.logs.filter(l => l.sport === "run" && (l.min || 0) >= 20 && l.km > 0 &&
    l.avgHR != null && l.avgHR >= 105 && l.avgHR <= 155).sort((a, b) => (a.date < b.date ? -1 : 1));
  const pPts = easyRuns.map(l => ({ x: dayOff(l.date, easyRuns[0]?.date || t), y: l.min * 60 / l.km }));
  const hint = E.paceHint(doc.logs, bounds(), 2, doc.settings.easyPace);

  const cons = E.consistency({ weeks: doc.weeks, logs: doc.logs, todayISO: t });

  page.innerHTML = `
    <h1 class="page">Progress</h1>
    <div class="card pc">
      <div class="hd"><span class="eyebrow">Weekly volume</span><span class="eyebrow" style="letter-spacing:.04em">${ridgeSel == null ? "LAST 12 WEEKS · TAP A WEEK" : "TAP AGAIN TO CLEAR"}</span></div>
      ${C.ridgeChart(vol, { selected: ridgeSel })}
      <div class="legend2"><span><i style="background:var(--cy)"></i>run</span><span><i style="background:#5d6ccc"></i>ride</span><span><i style="background:var(--sand);height:3px;border-radius:1px;width:12px;vertical-align:2px"></i>target</span><span><i style="background:#2a3744"></i>deload cols</span></div>
      ${ridgeDetail(vol)}
    </div>
    <div class="card pc">
      <div class="hd"><span class="eyebrow">Weight</span></div>
      <div class="stat"><span class="midnum">${lastW ? lastW.kg.toFixed(1) : "—"}</span><span class="unit">kg · ${lastW ? fmtShort(lastW.date) : ""}</span><span style="flex:1"></span><span class="unit" style="color:var(--sand)">target ${doc.settings.targetWeightKg.toFixed(1)}</span></div>
      ${wPts.length >= 2 ? C.lineChart(wPts, { emaAlpha: 0.25, target: doc.settings.targetWeightKg, targetLabel: `${doc.settings.targetWeightKg.toFixed(0)} kg`, xLabels: [fmtShort(wi[0].date), fmtShort(lastW.date)] }) : `<p class="row-sub">Two weigh-ins start the trend.</p>`}
      ${vo2AtTarget ? `<div class="callout">Same fitness at ${doc.settings.targetWeightKg.toFixed(0)} kg → <b>VO₂ ≈ ${vo2AtTarget}</b> (${lastV.value} today). Lighter chassis, same engine.</div>` : ""}
      <button class="btn ghost mini" id="pg-weigh">Add weigh-in</button>
    </div>
    <div class="card pc">
      <div class="hd"><span class="eyebrow">Pace at easy HR</span><span class="chip zc2" style="font-size:11px">Z2 · ${E.zoneMid(bounds(), 2)} bpm</span></div>
      ${hint.learned
        ? `<div class="stat"><span class="midnum">${E.fmtPace((hint.lo + hint.hi) / 2)}</span><span class="unit">/km · learned from ${hint.n} easy runs</span></div>`
        : `<div class="stat"><span class="midnum" style="color:var(--sub)">${E.fmtPace(hint.lo)}–${E.fmtPace(hint.hi)}</span><span class="unit">/km · ${hint.manual ? "your pace setting" : "starting estimate"}</span></div>`}
      ${pPts.length >= 2
        ? C.lineChart(pPts, { height: 110, xLabels: [fmtShort(easyRuns[0].date), fmtShort(easyRuns[easyRuns.length - 1].date)], lastLabel: E.fmtPace(pPts[pPts.length - 1].y), invert: true })
        : `<p class="row-sub">Run easy (Z2, ≤ ${bounds()[1].hi} bpm for 20+ min) and this chart wakes up — same heart rate getting faster is the clearest rebuild signal.</p>`}
    </div>
    <div class="card pc">
      <div class="hd"><span class="eyebrow">VO₂ max · Garmin</span></div>
      <div class="stat"><span class="midnum">${lastV ? lastV.value : "—"}</span><span class="unit">${lastV ? fmtShort(lastV.date) : "add your first reading"}</span></div>
      ${vPts.length >= 2 ? C.lineChart(vPts, { height: 96, color: "#8e9df8", xLabels: [fmtShort(vo2[0].date), fmtShort(lastV.date)] }) : ""}
      <button class="btn ghost mini" id="pg-vo2">Add reading</button>
    </div>
    <div class="card pc">
      <div class="hd"><span class="eyebrow">Consistency</span><span class="eyebrow" style="letter-spacing:.04em;${cons.streak ? "color:var(--cy)" : ""}">${cons.streak ? `STREAK · ${cons.streak} WEEK${cons.streak > 1 ? "S" : ""} ≥ 80 %` : "LAST 12 PLAN WEEKS"}</span></div>
      ${cons.cells.length ? `<div class="cells">${C.consistencyCells(cons.cells)}</div>` : `<p class="row-sub">Your first week is in progress — this strip fills as weeks complete.</p>`}
    </div>`;

  page.querySelectorAll("[data-wi]").forEach(r => r.addEventListener("click", () => {
    ridgeSel = ridgeSel === +r.dataset.wi ? null : +r.dataset.wi;
    renderProgress();
  }));
  $("#pg-weigh").addEventListener("click", () => openValueSheet({
    title: "Add weigh-in", label: "Weight", suffix: "kg", step: "0.1",
    value: lastW ? lastW.kg : "", withDate: true,
    onSave: (v, date) => {
      doc.weighIns = doc.weighIns.filter(w => w.date !== date);
      doc.weighIns.push({ date, kg: v });
      doc.weighIns.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  }));
  $("#pg-vo2").addEventListener("click", () => openValueSheet({
    title: "Add VO₂ reading", label: "VO₂ max", suffix: "ml/kg/min", step: "0.1",
    value: lastV ? lastV.value : "", withDate: true,
    onSave: (v, date) => {
      doc.vo2History = doc.vo2History.filter(x => x.date !== date);
      doc.vo2History.push({ date, value: v });
      doc.vo2History.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  }));
}

function openValueSheet({ title, label, suffix, step = "1", value = "", withDate = false, min, max, allowClear = false, onSave }) {
  const sheet = openSheet(`
    <div class="sh-title">${title}</div>
    ${withDate ? `<div class="frow"><span class="l">Date</span><input type="date" id="vs-date" value="${todayISO()}" max="${todayISO()}"></div>` : ""}
    <div class="frow"><span class="l">${label}</span><input type="number" step="${step}" inputmode="decimal" id="vs-val" value="${value}" placeholder="—">${suffix ? `<span class="suffix">${suffix}</span>` : ""}</div>
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
      <button class="srow" id="st-max"><span class="l">Max HR</span><span class="v">${st.maxHR} bpm</span><span class="chev">›</span></button>
      <button class="srow" id="st-rhr"><span class="l">Resting HR<span>adding it switches zones to Karvonen</span></span><span class="v ${st.restingHR ? "" : "add"}">${st.restingHR ? st.restingHR + " bpm" : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-lthr"><span class="l">Lactate threshold<span>optional — enables LTHR-based zones</span></span><span class="v ${st.lthr ? "" : "add"}">${st.lthr ? st.lthr + " bpm" : "Add"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-method"><span class="l">Zone method</span><span class="v">${METHOD_LABEL[st.zoneMethod] || st.zoneMethod}</span><span class="chev">›</span></button>
    </div></div>
    <div class="group"><div class="gh">Zones</div><div class="scard">
      ${b.map((z, i) => `<div class="zr"><span class="chip zc${z.z}">Z${z.z}</span><span class="what">${E.ZONE_NAMES[i]}</span><span class="range">${z.lo} – ${z.hi}</span></div>`).join("")}
      <button class="srow" id="st-custom" style="border-top:1px solid var(--line)"><span class="l" style="color:var(--cy)">Customize zones<span>your own bpm bounds — every plan and chart updates</span></span><span class="chev">›</span></button>
    </div></div>
    <div class="group"><div class="gh">Plan</div><div class="scard">
      <button class="srow" id="st-tw"><span class="l">Target weight</span><span class="v">${st.targetWeightKg.toFixed(1)} kg</span><span class="chev">›</span></button>
      <button class="srow" id="st-gr"><span class="l">Weekly growth<span>also drives the “Coming weeks” projection</span></span><span class="v">+${Math.round(st.growthRate * 100)} %</span><span class="chev">›</span></button>
      <button class="srow" id="st-dl"><span class="l">Deload</span><span class="v">every ${ordinal(st.deloadEvery)} week</span><span class="chev">›</span></button>
      <button class="srow" id="st-pace"><span class="l">Easy pace<span>your run pace hint until the app has learned</span></span><span class="v ${st.easyPace ? "" : "add"}">${st.easyPace ? `${E.fmtPace(st.easyPace.lo)}–${E.fmtPace(st.easyPace.hi)}` : "Auto"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-quality"><span class="l">Intervals<span>${st.qualityOverride ? "manually unlocked — the gate is off" : "earned after 3 consistent weeks"}</span></span><span class="v ${st.qualityOverride ? "add" : ""}">${st.qualityOverride ? "Unlocked" : qstate().run ? "Earned" : "Locked"}</span><span class="chev">›</span></button>
      <button class="srow" id="st-lay"><span class="l">Weekly layout<span>applies from the next generated week</span></span>
        <span class="laychips">${E.DAYS.map(d => `<i class="${lay[d] === "run" ? "lr" : lay[d] === "rest" ? "lx" : "lb"}">${d[0].toUpperCase()}</i>`).join("")}</span><span class="chev">›</span></button>
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
  $("#st-pace").addEventListener("click", openPaceSheet);
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
      <input type="number" inputmode="numeric" data-lo="${i}" value="${z.lo}" style="text-align:center">
      <span class="suffix">–</span>
      <input type="number" inputmode="numeric" data-hi="${i}" value="${z.hi}" style="text-align:center"></div>`).join("")}
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
  const lay = { ...doc.settings.layout };
  const OPTS = [["run", "Run"], ["bike", "Ride"], ["bike-long", "Long"], ["rest", "Rest"]];
  const sheet = openSheet(`
    <div class="sh-title">Weekly layout</div>
    <div class="sh-sub">Applies when the next week is generated</div>
    ${E.DAYS.map(d => `<div class="seg" data-day="${d}">
      <span class="l" style="flex:0 0 44px;align-self:center;color:var(--sub);font-weight:700;font-size:13px">${d.toUpperCase()}</span>
      ${OPTS.map(([v, l]) => `<button data-v="${v}" class="${lay[d] === v ? "on" : ""}">${l}</button>`).join("")}</div>`).join("")}
    <button class="btn" id="ly-save">Save layout</button>
  `);
  sheet.querySelectorAll(".seg[data-day]").forEach(row => {
    row.querySelectorAll("[data-v]").forEach(btn => btn.addEventListener("click", () => {
      lay[row.dataset.day] = btn.dataset.v;
      row.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("on", x === btn));
    }));
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

function importCSV(file) {
  if (!file) return;
  file.text().then(text => {
    const parsed = E.parseGarminCSV(text);
    if (parsed.error) { openModal("Can't import", esc(parsed.error), [{ label: "OK", cls: "ghost" }]); return; }
    const { fresh, dupes } = E.dedupeImports(parsed.rows, doc.logs);
    const c = parsed.counts;
    const freshC = { run: fresh.filter(r => r.sport === "run").length, bike: fresh.filter(r => r.sport === "bike").length, other: fresh.filter(r => r.sport === "other").length };
    openModal("Garmin CSV",
      `Add <b>${fresh.length}</b> activities (${freshC.run} runs · ${freshC.bike} rides · ${freshC.other} other)?<br>` +
      `Skipping ${dupes.length} duplicate${dupes.length === 1 ? "" : "s"}${c.bad ? ` · ${c.bad} unreadable row${c.bad === 1 ? "" : "s"}` : ""}. Runs and rides count toward plan weeks.`, [
      {
        label: `Add ${fresh.length} ${fresh.length === 1 ? "activity" : "activities"}`, fn: () => {
          persist(() => {
            for (const r of fresh) {
              doc.logs.push({ id: S.uid(), date: r.date, time: r.time, sport: r.sport, min: r.min,
                              km: r.km ?? undefined, avgHR: r.avgHR ?? undefined,
                              note: r.note || undefined, source: "csv" });
            }
            doc.logs.sort((a, b) => (a.date < b.date ? -1 : 1));
          });
          toast(`Added ${fresh.length} · skipped ${dupes.length}`);
        },
      },
      { label: "Cancel", cls: "ghost" },
    ]);
  });
  $("#st-file-csv").value = "";
}

/* ---------------- go ---------------- */
boot();
