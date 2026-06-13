/* Minimal store-only (no compression) ZIP writer — pure, offline, no deps.
   Used to bundle a week's .FIT workouts into one download. */

const u16 = (a, v) => a.push(v & 0xFF, (v >> 8) & 0xFF);
const u32 = (a, v) => a.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF);

export function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

/* files: [{ name, data: Uint8Array }] → a Uint8Array of the .zip. */
export function makeZip(files) {
  const enc = s => new TextEncoder().encode(s);
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc(f.name);
    const crc = crc32(f.data), size = f.data.length;
    const lh = [];
    u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0); u16(lh, 0); // sig, version, flags, method=store
    u16(lh, 0); u16(lh, 0);                                   // mod time/date
    u32(lh, crc); u32(lh, size); u32(lh, size);
    u16(lh, nameBytes.length); u16(lh, 0);
    const lha = new Uint8Array(lh);
    chunks.push(lha, nameBytes, f.data);

    const cd = [];
    u32(cd, 0x02014b50); u16(cd, 20); u16(cd, 20); u16(cd, 0); u16(cd, 0);
    u16(cd, 0); u16(cd, 0);
    u32(cd, crc); u32(cd, size); u32(cd, size);
    u16(cd, nameBytes.length); u16(cd, 0); u16(cd, 0); u16(cd, 0); u16(cd, 0);
    u32(cd, 0); u32(cd, offset);
    central.push(new Uint8Array(cd), nameBytes);
    offset += lha.length + nameBytes.length + size;
  }
  let centralSize = 0; for (const c of central) centralSize += c.length;
  const eocd = [];
  u32(eocd, 0x06054b50); u16(eocd, 0); u16(eocd, 0);
  u16(eocd, files.length); u16(eocd, files.length);
  u32(eocd, centralSize); u32(eocd, offset); u16(eocd, 0);

  const all = [...chunks, ...central, new Uint8Array(eocd)];
  let total = 0; for (const c of all) total += c.length;
  const out = new Uint8Array(total); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
