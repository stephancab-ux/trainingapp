/* Generates the PWA icons from the supplied logo (icons/logo-source.png) via
   headless chromium. The home-screen icon is the circular emblem (athletes +
   mountains, no wordmark); the maskable adds a safe-zone inset. Dev-only —
   the PNGs are committed, so re-run only when the logo changes:
     node tools/gen-icons.mjs
   Requires playwright + a chromium build (PLAYWRIGHT_BROWSERS_PATH). */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");
const srcPng = fs.readFileSync(path.join(outDir, "logo-source.png")).toString("base64");

/* Emblem crop from the 1254×1254 source — frames the runner + cyclist above
   the wordmark. Adjust if the source logo changes. */
const CROP = { sx: 300, sy: 86, side: 612 };
const BG = "#070a0f";

const browser = await chromium.launch();
const targets = [
  { file: "icon-512.png", size: 512, pad: 0 },
  { file: "icon-192.png", size: 192, pad: 0 },
  { file: "icon-512-maskable.png", size: 512, pad: 0.14 },
  { file: "apple-touch-icon.png", size: 180, pad: 0.04 },
];
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
  await page.setContent(`<body style="margin:0"><canvas id="c" width="${t.size}" height="${t.size}"></canvas>
    <img id="i" src="data:image/png;base64,${srcPng}"></body>`);
  await page.waitForFunction(() => { const i = document.getElementById("i"); return i && i.complete && i.naturalWidth; });
  await page.evaluate(({ size, pad, CROP, BG }) => {
    const ctx = document.getElementById("c").getContext("2d");
    ctx.fillStyle = BG; ctx.fillRect(0, 0, size, size);
    const inset = Math.round(size * pad), draw = size - inset * 2;
    ctx.drawImage(document.getElementById("i"), CROP.sx, CROP.sy, CROP.side, CROP.side, inset, inset, draw, draw);
  }, { size: t.size, pad: t.pad, CROP, BG });
  const data = await page.evaluate(() => document.getElementById("c").toDataURL("image/png").split(",")[1]);
  fs.writeFileSync(path.join(outDir, t.file), Buffer.from(data, "base64"));
  await page.close();
  console.log("wrote icons/" + t.file);
}
await browser.close();
