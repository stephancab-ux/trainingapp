/* Remonte charts — hand-rolled SVG strings, no DOM, no dependencies.
   Colors are passed in CSS-variable form where possible; literal fallbacks
   match app.css. */
import { ema } from "./engine.js";

const CY = "#56dbe8", BIKE = "#5d6ccc", SAND = "#e6d3a3",
      MUT = "#5b6e80", SUB = "#8fa1b3", LINE = "rgba(148,178,204,.2)";

const svg = (w, h, inner) =>
  `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block" role="img">${inner}</svg>`;

/* The alpine signature: weekly volume as a mountain ridge. Run is the cyan
   snowcap on the ride's rock; sand dashes mark each week's target; deload
   weeks render faded, as cols between peaks. vol: engine.weeklyVolume().
   Pass `selected` to highlight one column; transparent hit rects carry
   data-wi for tap-to-inspect. */
export function ridgeChart(vol, { width = 352, height = 158, selected = null, colors = {}, labelEvery = 0 } = {}) {
  if (!vol.length) return "";
  const RUN = colors.run || CY, RIDE = colors.bike || BIKE, HIKE = colors.hike || "#7fd6c0", GYM = colors.gym || "#c98bdb";
  const T = p => p.run + p.bike + (p.hike || 0) + (p.gym || 0);
  const W = width, H = height, base = H - 16;
  const max = Math.max(60, ...vol.map(v => Math.max(T(v), v.target || 0))) * 1.07;
  const n = vol.length, gap = 3, bw = (W - gap * (n - 1)) / n;
  const y = v => base - (v / max) * (base - 10);
  let s = "";
  let far = `M0 ${base}`;
  vol.forEach((p, i) => { far += ` L${(i + 0.5) * (bw + gap)} ${y(T(p) * 0.62 + max * 0.12)}`; });
  s += `<path d="${far} L${W} ${base} Z" fill="rgba(86,219,232,.05)"/>`;
  vol.forEach((p, i) => {
    const x = i * (bw + gap), runTop = p.bike + p.run, hikeTop = runTop + (p.hike || 0), tot = T(p);
    const dim = selected != null && selected !== i;
    const op = (p.isDeload ? 0.45 : 1) * (dim ? 0.45 : 1);
    s += `<g opacity="${op}">`;
    s += `<rect x="${x}" y="${y(p.bike)}" width="${bw}" height="${Math.max(0, base - y(p.bike))}" fill="${RIDE}"/>`;
    s += `<rect x="${x}" y="${y(runTop)}" width="${bw}" height="${Math.max(0, y(p.bike) - y(runTop))}" ${p.hike || p.gym ? "" : "rx=\"2.5\""} fill="${RUN}"/>`;
    if (p.hike) s += `<rect x="${x}" y="${y(hikeTop)}" width="${bw}" height="${Math.max(0, y(runTop) - y(hikeTop))}" ${p.gym ? "" : "rx=\"2.5\""} fill="${HIKE}"/>`;
    if (p.gym) s += `<rect x="${x}" y="${y(tot)}" width="${bw}" height="${Math.max(0, y(hikeTop) - y(tot))}" rx="2.5" fill="${GYM}"/>`;
    s += `</g>`;
    if (p.target) s += `<line x1="${x - 1}" y1="${y(p.target)}" x2="${x + bw + 1}" y2="${y(p.target)}" stroke="${SAND}" stroke-width="1.6" stroke-dasharray="4 3" opacity="${dim ? 0.4 : 1}"/>`;
    if (p.isDeload) s += `<text x="${x + bw / 2}" y="${H - 3}" fill="${MUT}" font-size="9" text-anchor="middle" font-weight="700">col</text>`;
    if (p.current) s += `<rect x="${x - 1}" y="${Math.min(y(tot), y(p.target || 0)) - 4}" width="${bw + 2}" height="2" rx="1" fill="rgba(86,219,232,.5)"/>`;
    if (selected === i) s += `<rect x="${x - 1.5}" y="${Math.min(y(Math.max(tot, p.target || 0, 30))) - 3}" width="${bw + 3}" height="${base - Math.min(y(Math.max(tot, p.target || 0, 30))) + 3}" rx="3" fill="none" stroke="rgba(86,219,232,.8)" stroke-width="1.5"/>`;
  });
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${LINE}"/>`;
  // x-axis date labels (evenly spaced; skip deload columns which show the "col" marker)
  if (labelEvery) vol.forEach((p, i) => {
    if (i % labelEvery === 0 && p.label && !p.isDeload)
      s += `<text x="${((i + 0.5) * (bw + gap)).toFixed(1)}" y="${H - 3}" fill="${MUT}" font-size="9" text-anchor="middle">${p.label}</text>`;
  });
  const peak = Math.max(...vol.map(T));
  if (peak > 0 && selected == null) {
    const hh = Math.floor(peak / 60), mm = Math.round(peak % 60);
    s += `<text x="${W}" y="${y(peak) - 5}" fill="${MUT}" font-size="9.5" text-anchor="end" font-weight="650">${hh} h ${String(mm).padStart(2, "0")}</text>`;
  }
  // hit targets last so they sit on top
  vol.forEach((_, i) => {
    s += `<rect data-wi="${i}" x="${i * (bw + gap) - gap / 2}" y="0" width="${bw + gap}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
  });
  return svg(W, H, s);
}

/* Generic dotted line chart. Supports multiple series, optional EMA overlay,
   a dashed target line, min/max y-axis labels, tap targets per point
   (data-pi/data-si), and a highlighted selection. points: [{x, y}] with x
   already linearized; or pass `series: [{points, color, emaAlpha}]`. */
export function lineChart(points, opts = {}) {
  const { width = 352, height = 140, target = null, targetLabel = "",
          emaAlpha = null, xLabels = null, lastLabel = null, invert = false,
          color = CY, padTop = 12, padBottom = 20, axis = false, fmtY = null,
          selected = null, taps = false, avg = false, band = null, xTicks = null } = opts;
  const series = opts.series || (points && points.length ? [{ points, color, emaAlpha }] : []);
  const all = series.flatMap(se => se.points);
  if (all.length < 2) return "";
  const W = width, H = height, L = axis ? 30 : 8, R = target != null ? 46 : 12;
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const bandVals = band ? band.flatMap(b => [b.lo, b.hi]) : [];
  let lo = Math.min(...ys, ...(target != null ? [target] : []), ...bandVals);
  let hi = Math.max(...ys, ...(target != null ? [target] : []), ...bandVals);
  const pad = Math.max((hi - lo) * 0.12, 0.5);
  lo -= pad; hi += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs) || 1;
  const X = v => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const Y = v => invert
    ? padTop + ((v - lo) / (hi - lo)) * (H - padTop - padBottom)
    : padTop + ((hi - v) / (hi - lo)) * (H - padTop - padBottom);
  let s = "";
  const rLabels = []; // right-edge dashed-line labels (target + averages), nudged apart at the end
  // Garmin-style optimal-range band, drawn behind everything
  if (band && band.length >= 2) {
    const top = band.map(b => `${X(b.x).toFixed(1)},${Y(b.hi).toFixed(1)}`).join(" ");
    const bot = band.slice().reverse().map(b => `${X(b.x).toFixed(1)},${Y(b.lo).toFixed(1)}`).join(" ");
    s += `<polygon points="${top} ${bot}" fill="rgba(122,196,90,.22)"/>`;
  }
  if (axis) {
    const yf = fmtY || (v => Math.round(v));
    s += `<line x1="${L}" y1="${Y(hi)}" x2="${L}" y2="${Y(lo)}" stroke="${LINE}"/>`;
    s += `<text x="${L - 4}" y="${Y(hi) + 8}" fill="${MUT}" font-size="9" text-anchor="end">${yf(invert ? lo : hi)}</text>`;
    s += `<text x="${L - 4}" y="${Y(lo)}" fill="${MUT}" font-size="9" text-anchor="end">${yf(invert ? hi : lo)}</text>`;
  }
  if (target != null) {
    s += `<line x1="${L}" y1="${Y(target)}" x2="${W - 14}" y2="${Y(target)}" stroke="${SAND}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
    rLabels.push({ y0: Y(target), text: targetLabel, color: SAND, weight: 700, op: 1 });
  }
  // faint dashed mean line per series (range average), drawn under the points
  if (avg) {
    const yf = fmtY || (v => Math.round(v));
    series.forEach(se => {
      if (!se.points.length) return;
      const m = se.points.reduce((a, p) => a + p.y, 0) / se.points.length;
      const col = se.color || color;
      s += `<line x1="${L}" y1="${Y(m)}" x2="${W - 4}" y2="${Y(m)}" stroke="${col}" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.45"/>`;
      rLabels.push({ y0: Y(m), text: yf(m), color: col, weight: 650, op: 0.85 });
    });
  }
  series.forEach((se, si) => {
    const pts = se.points, col = se.color || color;
    if (pts.length < 2) {
      pts.forEach(p => { s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="${col}"/>`; });
      return;
    }
    const raw = pts.map(p => `${X(p.x)},${Y(p.y)}`).join(" ");
    if (se.emaAlpha) {
      s += `<polyline points="${raw}" fill="none" stroke="rgba(143,161,179,.35)" stroke-width="1.2"/>`;
      const sm = ema(pts.map(p => p.y), se.emaAlpha);
      s += `<polyline points="${pts.map((p, i) => `${X(p.x)},${Y(sm[i])}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
    } else if (se.segColors) {
      // each segment coloured by its right endpoint's status (Load · Trend)
      for (let i = 1; i < pts.length; i++)
        s += `<line x1="${X(pts[i - 1].x)}" y1="${Y(pts[i - 1].y)}" x2="${X(pts[i].x)}" y2="${Y(pts[i].y)}" stroke="${se.segColors[i] || col}" stroke-width="2.4"/>`;
    } else {
      s += `<polyline points="${raw}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
    }
    pts.forEach((p, i) => {
      const sel = selected && selected.si === si && selected.pi === i;
      const dotCol = se.segColors ? (se.segColors[i] || col) : (i === pts.length - 1 ? col : "#365562");
      s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${sel ? 4.5 : 2.5}" fill="${sel ? "#fff" : dotCol}" ${sel ? `stroke="${col}" stroke-width="2"` : ""}/>`;
    });
  });
  // place the collected right-edge labels, nudging any that would overlap so all stay readable
  if (rLabels.length) {
    rLabels.sort((a, b) => a.y0 - b.y0);
    const GAP = 11; let prev = -Infinity;
    for (const lab of rLabels) { lab.y = Math.max(lab.y0, prev + GAP); prev = lab.y; }
    const top = padTop + 8, bot = H - padBottom - 2, overflow = rLabels[rLabels.length - 1].y - bot;
    if (overflow > 0) for (const lab of rLabels) lab.y = Math.max(top, lab.y - overflow);
    for (const lab of rLabels)
      s += `<text x="${W - 2}" y="${lab.y}" fill="${lab.color}" font-size="9.5" text-anchor="end" font-weight="${lab.weight}" opacity="${lab.op}">${lab.text}</text>`;
  }
  if (xLabels) {
    s += `<text x="${L}" y="${H - 4}" fill="${MUT}" font-size="9.5" font-weight="650">${xLabels[0]}</text>`;
    s += `<text x="${W - 4}" y="${H - 4}" fill="${MUT}" font-size="9.5" text-anchor="end" font-weight="650">${xLabels[1]}</text>`;
  }
  // intermediate axis date ticks across the range
  if (xTicks) xTicks.forEach(t => {
    s += `<text x="${X(t.x).toFixed(1)}" y="${H - 4}" fill="${MUT}" font-size="9" text-anchor="middle" font-weight="600">${t.label}</text>`;
  });
  if (lastLabel) {
    const lastSe = series[series.length - 1].points;
    const last = lastSe[lastSe.length - 1];
    s += `<text x="${Math.min(X(last.x), W - 8)}" y="${Y(last.y) - 7}" fill="#9be8f0" font-size="10" text-anchor="end" font-weight="750">${lastLabel}</text>`;
  }
  if (taps) {
    series.forEach((se, si) => se.points.forEach((p, i) => {
      s += `<rect data-si="${si}" data-pi="${i}" x="${X(p.x) - 9}" y="0" width="18" height="${H}" fill="transparent" style="cursor:pointer"/>`;
    }));
  }
  return svg(W, H, s);
}

/* RPE heatmap calendar cells — one per workout, coloured by how it felt vs
   expected. cells: [{id, band, title}]. Returns inner HTML for a wrap grid. */
const BAND_BG = { green: "rgba(86,219,232,.55)", yellow: "rgba(143,161,179,.30)",
                  red: "rgba(232,107,107,.6)", none: "#1a242f" };
export function heatmapCells(cells) {
  if (!cells.length) return "";
  return cells.map((c, i) =>
    `<i data-hi="${i}" style="background:${BAND_BG[c.band] || BAND_BG.none};cursor:pointer" title="${c.title || ""}"></i>`).join("");
}

/* Consistency strip cells — returns inner HTML for a 12-col grid. */
export function consistencyCells(cells, slots = 12) {
  const pad = Math.max(0, slots - cells.length);
  const blanks = Array.from({ length: pad }, () => `<i style="background:#141d27"></i>`);
  return blanks.concat(cells.map(c => {
    const p = Math.min(1.2, c.pct);
    const bg = p >= 0.8 ? `rgba(86,219,232,${0.35 + Math.min(p, 1) * 0.55})`
             : p >= 0.5 ? "rgba(86,219,232,.28)"
             : "rgba(86,219,232,.10)";
    const ring = c.isDeload ? "box-shadow:inset 0 0 0 1.5px rgba(230,211,163,.35);" : "";
    return `<i style="background:${bg};${ring}" title="${c.id} · ${Math.round(c.pct * 100)} %"></i>`;
  })).join("");
}

/* A compact 5-segment semicircle dial (VO₂ fitness category). pos 0–1 marks
   where the value sits; segs = 5 colours poor→superior. */
export function vo2Gauge({ pos = 0.5, color = CY, segs }) {
  const W = 116, H = 64, cx = 58, cy = 58, r = 44, sw = 8;
  const pt = a => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
  const seg = (a0, a1, col) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${col}" stroke-width="${sw}" fill="none"/>`; };
  let s = "";
  for (let i = 0; i < 5; i++) s += seg(180 - i * 36, 180 - (i + 1) * 36, segs[i]);
  const [mx, my] = pt(180 - pos * 180);
  s += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="6" fill="#fff" stroke="${color}" stroke-width="3"/>`;
  return svg(W, H, s);
}

/* A circular progress ring — faint full circle + a coloured arc for `pct` (0–1).
   Content (trophy, day count) is overlaid via CSS by the caller. */
export function progressRing({ pct = 0, color = CY, size = 132, sw = 10 }) {
  const r = (size - sw) / 2 - 2, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1a2530" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
  </svg>`;
}

/* Stacked vertical bars. rows: [{label?, total, ...keyVals}]; keys+colors map
   the stack order. Used for daily exercise load + monthly volume. */
export function stackedBars(rows, { keys, colors, width = 352, height = 120, fmtY = null, labelEvery = 0, target = null } = {}) {
  if (!rows.length) return "";
  const W = width, H = height, base = H - 14, top = 10;
  const max = Math.max(1, ...rows.map(r => keys.reduce((a, k) => a + (r[k] || 0), 0)), target || 0);
  const n = rows.length, gap = n > 40 ? 0.6 : n > 18 ? 1.5 : 3, bw = (W - gap * (n - 1)) / n;
  const y = v => base - (v / max) * (base - top);
  let s = "";
  rows.forEach((r, i) => {
    let acc = 0; const x = i * (bw + gap);
    keys.forEach((k, ki) => { const v = r[k] || 0; if (v <= 0) return; s += `<rect x="${x.toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${Math.max(0.6, bw).toFixed(1)}" height="${((v / max) * (base - top)).toFixed(1)}" fill="${colors[ki]}"/>`; acc += v; });
    s += `<rect data-wi="${i}" x="${(x - gap / 2).toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
  });
  if (target) s += `<line x1="0" y1="${y(target)}" x2="${W}" y2="${y(target)}" stroke="${SAND}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${LINE}"/>`;
  if (fmtY) s += `<text x="2" y="${top + 7}" fill="${MUT}" font-size="9">${fmtY(max)}</text>`;
  if (labelEvery) rows.forEach((r, i) => { if (r.label && i % labelEvery === 0) s += `<text x="${(i * (bw + gap) + bw / 2).toFixed(1)}" y="${H - 2}" fill="${MUT}" font-size="9" text-anchor="middle">${r.label}</text>`; });
  return svg(W, H, s);
}
