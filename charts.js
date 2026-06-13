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
export function ridgeChart(vol, { width = 352, height = 158, selected = null } = {}) {
  if (!vol.length) return "";
  const W = width, H = height, base = H - 16;
  const max = Math.max(60, ...vol.map(v => Math.max(v.run + v.bike, v.target || 0))) * 1.07;
  const n = vol.length, gap = 3, bw = (W - gap * (n - 1)) / n;
  const y = v => base - (v / max) * (base - 10);
  let s = "";
  let far = `M0 ${base}`;
  vol.forEach((p, i) => { far += ` L${(i + 0.5) * (bw + gap)} ${y((p.run + p.bike) * 0.62 + max * 0.12)}`; });
  s += `<path d="${far} L${W} ${base} Z" fill="rgba(86,219,232,.05)"/>`;
  vol.forEach((p, i) => {
    const x = i * (bw + gap), tot = p.run + p.bike;
    const dim = selected != null && selected !== i;
    const op = (p.isDeload ? 0.45 : 1) * (dim ? 0.45 : 1);
    s += `<g opacity="${op}">`;
    s += `<rect x="${x}" y="${y(p.bike)}" width="${bw}" height="${Math.max(0, base - y(p.bike))}" fill="${BIKE}"/>`;
    s += `<rect x="${x}" y="${y(tot)}" width="${bw}" height="${Math.max(0, y(p.bike) - y(tot))}" rx="2.5" fill="${CY}"/>`;
    s += `</g>`;
    if (p.target) s += `<line x1="${x - 1}" y1="${y(p.target)}" x2="${x + bw + 1}" y2="${y(p.target)}" stroke="${SAND}" stroke-width="1.6" stroke-dasharray="4 3" opacity="${dim ? 0.4 : 1}"/>`;
    if (p.isDeload) s += `<text x="${x + bw / 2}" y="${H - 3}" fill="${MUT}" font-size="9" text-anchor="middle" font-weight="700">col</text>`;
    if (p.current) s += `<rect x="${x - 1}" y="${Math.min(y(tot), y(p.target || 0)) - 4}" width="${bw + 2}" height="2" rx="1" fill="rgba(86,219,232,.5)"/>`;
    if (selected === i) s += `<rect x="${x - 1.5}" y="${Math.min(y(Math.max(tot, p.target || 0, 30))) - 3}" width="${bw + 3}" height="${base - Math.min(y(Math.max(tot, p.target || 0, 30))) + 3}" rx="3" fill="none" stroke="rgba(86,219,232,.8)" stroke-width="1.5"/>`;
  });
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${LINE}"/>`;
  const peak = Math.max(...vol.map(v => v.run + v.bike));
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
          selected = null, taps = false } = opts;
  const series = opts.series || (points && points.length ? [{ points, color, emaAlpha }] : []);
  const all = series.flatMap(se => se.points);
  if (all.length < 2) return "";
  const W = width, H = height, L = axis ? 30 : 8, R = target != null ? 46 : 12;
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  let lo = Math.min(...ys, ...(target != null ? [target] : []));
  let hi = Math.max(...ys, ...(target != null ? [target] : []));
  const pad = Math.max((hi - lo) * 0.12, 0.5);
  lo -= pad; hi += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs) || 1;
  const X = v => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const Y = v => invert
    ? padTop + ((v - lo) / (hi - lo)) * (H - padTop - padBottom)
    : padTop + ((hi - v) / (hi - lo)) * (H - padTop - padBottom);
  let s = "";
  if (axis) {
    const yf = fmtY || (v => Math.round(v));
    s += `<line x1="${L}" y1="${Y(hi)}" x2="${L}" y2="${Y(lo)}" stroke="${LINE}"/>`;
    s += `<text x="${L - 4}" y="${Y(hi) + 8}" fill="${MUT}" font-size="9" text-anchor="end">${yf(invert ? lo : hi)}</text>`;
    s += `<text x="${L - 4}" y="${Y(lo)}" fill="${MUT}" font-size="9" text-anchor="end">${yf(invert ? hi : lo)}</text>`;
  }
  if (target != null) {
    s += `<line x1="${L}" y1="${Y(target)}" x2="${W - 14}" y2="${Y(target)}" stroke="${SAND}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
    s += `<text x="${W}" y="${Y(target) + 3.5}" fill="${SAND}" font-size="10" text-anchor="end" font-weight="700">${targetLabel}</text>`;
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
    } else {
      s += `<polyline points="${raw}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
    }
    pts.forEach((p, i) => {
      const sel = selected && selected.si === si && selected.pi === i;
      s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${sel ? 4.5 : 2.5}" fill="${sel ? "#fff" : (i === pts.length - 1 ? col : "#365562")}" ${sel ? `stroke="${col}" stroke-width="2"` : ""}/>`;
    });
  });
  if (xLabels) {
    s += `<text x="${L}" y="${H - 4}" fill="${MUT}" font-size="9.5" font-weight="650">${xLabels[0]}</text>`;
    s += `<text x="${W - 4}" y="${H - 4}" fill="${MUT}" font-size="9.5" text-anchor="end" font-weight="650">${xLabels[1]}</text>`;
  }
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
