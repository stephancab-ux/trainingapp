/* Minimal Garmin .FIT structured-workout encoder — pure, offline, no deps.
   Produces a workout file (file_id + workout + workout_step messages) that
   Garmin Connect (Workouts → Import) or the watch's NEWFILES folder accepts.
   Steps come from engine.workoutSteps(). HR targets use FIT's custom HR
   convention: value = bpm + 100. */

const SPORT_FIT = { run: 1, trail: 1, bike: 2, hike: 1, swim: 5 }; // running / cycling / swimming
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };
const U8_INVALID = 0xFF, U16_INVALID = 0xFFFF, U32_INVALID = 0xFFFFFFFF;

/* FIT CRC-16 (per the SDK). */
export function fitCRC(bytes, start = 0, end = bytes.length, crc = 0) {
  const T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
             0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let t = T[crc & 0xF]; crc = ((crc >> 4) & 0x0FFF) ^ t ^ T[b & 0xF];
    t = T[crc & 0xF]; crc = ((crc >> 4) & 0x0FFF) ^ t ^ T[(b >> 4) & 0xF];
  }
  return crc & 0xFFFF;
}

const u8 = (a, v) => a.push(v & 0xFF);
const u16 = (a, v) => a.push(v & 0xFF, (v >> 8) & 0xFF);
const u32 = (a, v) => a.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF);
const strN = (a, s, n) => { for (let i = 0; i < n; i++) a.push(i < s.length ? s.charCodeAt(i) & 0xFF : 0); };

/* base types: enum 0x00, uint8 0x02, uint16 0x84, uint32 0x86, string 0x07 */
function defMsg(data, localType, globalNum, fields) {
  data.push(0x40 | localType, 0x00, 0x00);   // def header, reserved, little-endian
  u16(data, globalNum);
  u8(data, fields.length);
  for (const f of fields) { u8(data, f.num); u8(data, f.size); u8(data, f.base); }
}

const NAME_LEN = 24;

export function encodeWorkout({ name = "Workout", sport = "run", steps = [] }) {
  // flatten: keep only valid step descriptors (objects)
  const data = [];

  // ---- file_id (global 0), local 0 ----
  defMsg(data, 0, 0, [
    { num: 0, size: 1, base: 0x00 },   // type (enum) = 5 workout
    { num: 1, size: 2, base: 0x84 },   // manufacturer (uint16)
    { num: 2, size: 2, base: 0x84 },   // product (uint16)
    { num: 4, size: 4, base: 0x86 },   // time_created (uint32)
  ]);
  data.push(0x00);                     // data header local 0
  u8(data, 5);                         // type = workout
  u16(data, 255);                      // manufacturer = development
  u16(data, 0);                        // product
  u32(data, 0);                        // time_created (0 = unknown)

  const validSteps = steps.length;

  // ---- workout (global 26), local 1 ----
  defMsg(data, 1, 26, [
    { num: 4, size: 1, base: 0x00 },          // sport (enum)
    { num: 6, size: 2, base: 0x84 },          // num_valid_steps (uint16)
    { num: 8, size: NAME_LEN, base: 0x07 },   // wkt_name (string)
  ]);
  data.push(0x01);
  u8(data, SPORT_FIT[sport] ?? 0);
  u16(data, validSteps);
  strN(data, name, NAME_LEN);

  // ---- workout_step (global 27), local 2 ----
  defMsg(data, 2, 27, [
    { num: 254, size: 2, base: 0x84 },   // message_index
    { num: 1,   size: 1, base: 0x00 },   // duration_type (enum)
    { num: 2,   size: 4, base: 0x86 },   // duration_value (uint32)
    { num: 3,   size: 1, base: 0x00 },   // target_type (enum)
    { num: 4,   size: 4, base: 0x86 },   // target_value (uint32)
    { num: 5,   size: 4, base: 0x86 },   // custom_target_value_low (uint32)
    { num: 6,   size: 4, base: 0x86 },   // custom_target_value_high (uint32)
    { num: 7,   size: 1, base: 0x00 },   // intensity (enum)
  ]);
  steps.forEach((s, i) => {
    data.push(0x02);
    u16(data, i);
    if (s.type === "repeat") {
      u8(data, 6);                       // duration_type = repeat_until_steps_cmplt
      u32(data, s.from);                 // duration_value = step index to repeat from
      u8(data, U8_INVALID);              // target_type
      u32(data, s.count);                // target_value = repeat count
      u32(data, U32_INVALID);
      u32(data, U32_INVALID);
      u8(data, U8_INVALID);              // intensity (n/a)
    } else {
      u8(data, 0);                       // duration_type = time
      u32(data, Math.round((s.seconds || 0) * 1000)); // ms
      if (s.hrLo && s.hrHi) {
        u8(data, 1);                     // target_type = heart_rate
        u32(data, 0);                    // target_value = 0 (custom range)
        u32(data, s.hrLo + 100);         // bpm + 100
        u32(data, s.hrHi + 100);
      } else {
        u8(data, 2);                     // target_type = open
        u32(data, U32_INVALID); u32(data, U32_INVALID); u32(data, U32_INVALID);
      }
      u8(data, INTENSITY[s.intensity] ?? 0);
    }
  });

  // ---- assemble: header (14) + data + file CRC ----
  const header = [];
  u8(header, 14);            // header size
  u8(header, 0x20);          // protocol version 2.0
  u16(header, 2132);         // profile version
  u32(header, data.length);  // data size
  strN(header, ".FIT", 4);   // data type
  const hcrc = fitCRC(header, 0, 12);
  u16(header, hcrc);

  const all = header.concat(data);
  const fcrc = fitCRC(all, 0, all.length);
  u16(all, fcrc);
  return new Uint8Array(all);
}
