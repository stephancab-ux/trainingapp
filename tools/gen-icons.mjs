/* Generates the PWA icons (mountain-ridge mark) as PNGs via headless
   chromium. Dev-only tool — the generated PNGs are committed, so this only
   needs re-running when the mark changes:
     node tools/gen-icons.mjs
   Requires playwright + a chromium build (PLAYWRIGHT_BROWSERS_PATH). */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

/* pad: extra safe-zone for maskable icons (fraction of the canvas). */
function svgMark(pad = 0) {
  const s = 100 - pad * 200, o = pad * 100;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#0b1320"/>
    <g transform="translate(${o} ${o}) scale(${s / 100})">
      <line x1="10" y1="24" x2="90" y2="24" stroke="#e6d3a3" stroke-width="3.5"
            stroke-dasharray="7 6" stroke-linecap="round"/>
      <path d="M0 80 L20 45 L38 62 L60 28 L80 55 L100 40 L100 88 L0 88 Z" fill="#4a5ab8"/>
      <path d="M0 86 L16 64 L30 74 L48 50 L66 70 L84 58 L100 68 L100 100 L0 100 Z" fill="#56dbe8"/>
    </g>
  </svg>`;
}

const browser = await chromium.launch();
const targets = [
  { file: "icon-512.png", size: 512, pad: 0 },
  { file: "icon-192.png", size: 192, pad: 0 },
  { file: "icon-512-maskable.png", size: 512, pad: 0.12 },
  { file: "apple-touch-icon.png", size: 180, pad: 0 },
];
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
  await page.setContent(`<body style="margin:0">${svgMark(t.pad)}</body>`);
  await page.screenshot({ path: path.join(outDir, t.file) });
  await page.close();
  console.log("wrote icons/" + t.file);
}
await browser.close();
