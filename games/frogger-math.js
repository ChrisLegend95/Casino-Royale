/* =========================================================
   frogger-math.js — the traffic + collision model behind Frogger Gamble.

   No DOM in here, so the model can be calibrated and re-tuned headlessly
   (Monte-Carlo over a bot player).

   Units: one lane is 1.0 tall, the road is FROG_CONST.roadW wide, the frog
   sits at a fixed FROG_CONST.frogX, and time is in seconds. The renderer
   only ever multiplies by `laneH`, which keeps the physics independent of
   canvas resolution.

   THE ROAD IS 100 LANES LONG, in ten blocks of ten.

     - Every tenth lane (10, 20, ... 90) is a SAFE ISLAND: a traffic-free
       grass median where nothing can touch the frog and it can rest as long
       as it likes. Lane 100 is the SUMMIT — also safe, and crossing into it
       finishes the run.
     - The other nine lanes of a block are a TIER, and each tier has its own
       character (see TIERS below): a side street gives you 1.8s windows at
       1.6 lanes/sec, the final stretch gives you 0.52s windows at 4.8. Each
       tier *starts* harder than the one before it ended, so crossing an
       island is always stepping up into nastier traffic.

   A lane is an endless, *irregular* stream of vehicles: it holds a handful
   of cars with randomly-sized widths and randomly-sized gaps, and that whole
   little convoy repeats spatially every `loopLen`. Because the gaps vary, the
   lane does not tick like a metronome -- some windows are wide, some are
   tight. What is guaranteed is the *minimum* window: `cw` is the least amount
   of daylight the frog's column ever gets, and it is the difficulty dial.

   The frog's own collision box is deliberately tiny (0.28 wide) so a lane
   reads as "wide open" whenever it genuinely is. Everything the player must
   judge is on screen: the cars stream past, and the only question is whether
   the lane above is open long enough to hop into. Nothing here is hidden.
   ========================================================= */

export const FROG_CONST = {
  hopSec: 0.2,        // how long a hop lane-to-lane takes
  settleSec: 0.12,    // dead time after landing before the next hop is allowed
  frogHalfW: 0.14,    // horizontal collision half-width, lane units (forgiving vs sprite)
  frogHalfH: 0.32,    // vertical collision half-height, lane units
  startMult: 1.0,     // you begin safe on the verge, exactly even
  perHop: 0.05,       // base gain for every lane crossed
  perHopStep: 0.01,   // each 10-lane block widens the rungs by this much
  roadW: 7,           // visible road width, lane units
  frogX: 3.5,         // the frog's fixed column
  maxLanes: 101,      // lanes 1..100 are crossable; 101 is the far kerb
  summit: 100,        // crossing lane 100 completes the run
  islandEvery: 10,    // lanes 10,20,...,100 are traffic-free safe islands
  cwFloor: 0.85,      // HUD reference when a lane has no meaningful window
  // how long the road holds traffic back (a safe pocket) after each landing.
  // Every landing buys a genuine safe pocket; it shrinks as you get deeper,
  // which is what keeps a patient player honest.
  blockHi: 1.75, blockDecay: 0.0125, blockMin: 0.5,
  // the frog starts mid-road with this much daylight before the first car arrives
  initLo: 0.7, initHi: 1.4,
  scan: 14,
};

/* Ten blocks of ten lanes. Each entry gives the profile at the FIRST lane of
   the block and at its LAST (interpolated across the nine real lanes; the
   tenth is the island). A block always starts harder than the previous one
   ended, so the milestone itself is the step.

     speed   lanes/second        cw    guaranteed clear window (seconds)
     cars    vehicles per convoy carW  vehicle width (lanes)
     gapVar  extra gap, x minGap speedJ lane-to-lane speed spread
*/
export const TIERS = [
  { n: 1,  name: "SIDE STREET",     accent: "#5cf39a",
    speed: [1.55, 1.95], speedJ: 0.10, cw: [1.82, 1.64], cwJ: 0.05,
    cars: [2, 2], carW: [0.85, 1.15], gapVar: [0.55, 0.72] },
  { n: 2,  name: "DOWNTOWN",        accent: "#7dd3a0",
    speed: [2.05, 2.45], speedJ: 0.14, cw: [1.58, 1.44], cwJ: 0.05,
    cars: [2, 3], carW: [0.95, 1.35], gapVar: [0.70, 0.88] },
  { n: 3,  name: "THE FREEWAY",     accent: "#8fc9ff",
    speed: [2.55, 2.95], speedJ: 0.16, cw: [1.40, 1.28], cwJ: 0.045,
    cars: [3, 4], carW: [1.20, 1.95], gapVar: [0.85, 1.02] },
  { n: 4,  name: "RUSH HOUR",       accent: "#ffd23f",
    speed: [3.05, 3.45], speedJ: 0.18, cw: [1.24, 1.14], cwJ: 0.045,
    cars: [4, 5], carW: [0.95, 1.55], gapVar: [1.00, 1.18] },
  { n: 5,  name: "THE EXPRESSWAY",  accent: "#ff9f43",
    speed: [3.55, 3.95], speedJ: 0.20, cw: [1.10, 1.00], cwJ: 0.04,
    cars: [4, 5], carW: [1.10, 1.95], gapVar: [1.10, 1.28] },
  { n: 6,  name: "NIGHT CROSSING",  accent: "#8ea2ff",
    speed: [3.85, 4.15], speedJ: 0.22, cw: [0.96, 0.88], cwJ: 0.04,
    cars: [4, 6], carW: [1.00, 1.80], gapVar: [1.20, 1.38] },
  { n: 7,  name: "THE INTERCHANGE", accent: "#c58bff",
    speed: [3.95, 4.30], speedJ: 0.55, cw: [0.84, 0.78], cwJ: 0.035,
    cars: [5, 6], carW: [1.10, 2.00], gapVar: [1.30, 1.50] },
  { n: 8,  name: "STORM FRONT",     accent: "#63d7ff",
    speed: [4.15, 4.45], speedJ: 0.30, cw: [0.74, 0.69], cwJ: 0.035,
    cars: [5, 6], carW: [1.15, 2.10], gapVar: [1.42, 1.62] },
  { n: 9,  name: "THE GAUNTLET",    accent: "#ff7a6b",
    speed: [4.30, 4.60], speedJ: 0.34, cw: [0.66, 0.61], cwJ: 0.03,
    cars: [5, 7], carW: [1.20, 2.20], gapVar: [1.52, 1.72] },
  { n: 10, name: "FINAL STRETCH",   accent: "#ffe08a",
    speed: [4.45, 4.85], speedJ: 0.38, cw: [0.58, 0.52], cwJ: 0.03,
    cars: [6, 7], carW: [1.25, 2.30], gapVar: [1.60, 1.85] },
];

/* Weather per tier: a night wash over the whole road, and a rain overlay.
   The back half of the road descends into a night storm, which is exactly
   where the traffic is already at its worst. */
const ATMO = [
  { night: 0,    rain: 0 },
  { night: 0,    rain: 0 },
  { night: 0,    rain: 0 },
  { night: 0,    rain: 0 },
  { night: 0,    rain: 0 },
  { night: 1.0,  rain: 0 },
  { night: 0.55, rain: 0.35 },
  { night: 0.35, rain: 1.0 },
  { night: 0.80, rain: 0.55 },
  { night: 1.0,  rain: 0.90 },
];

const PAINT = [
  ["#ff5d73", "#8c1f30"],
  ["#4d9fff", "#1b3f7d"],
  ["#ffd23f", "#9a7412"],
  ["#5cf39a", "#186b3f"],
  ["#c58bff", "#5a2f8f"],
  ["#ff9f43", "#8f4a10"],
  ["#e9eefb", "#7c8496"],
  ["#37d0c8", "#0f5b56"],
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n, m) => ((n % m) + m) % m;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- road geography ---------------------------------------------- */

export function tierOf(lane) {
  const C = FROG_CONST;
  const i = Math.max(1, Math.min(C.summit, Math.floor(Number(lane) || 1)));
  return Math.min(TIERS.length - 1, Math.floor((i - 1) / C.islandEvery));
}

export function tierName(lane) { return TIERS[tierOf(lane)].name; }

export function isSummit(lane) { return Math.floor(Number(lane) || 0) >= FROG_CONST.summit; }

/* Every tenth lane is a rest stop: no traffic, no collisions, no clock. */
export function isSafeLane(lane) {
  const C = FROG_CONST;
  const i = Math.floor(Number(lane));
  if (!Number.isFinite(i) || i <= 0) return false;
  return i <= C.summit && i % C.islandEvery === 0;
}

/* The next island at or after `lane` (the lane itself if you are standing on
   one, so callers that want "the one ahead" pass lane+1). */
export function nextIsland(lane) {
  const C = FROG_CONST;
  const l = Math.max(0, Math.min(C.summit, Math.floor(Number(lane) || 0)));
  const n = Math.floor(l / C.islandEvery) * C.islandEvery;
  return Math.min(C.summit, n <= l ? n + C.islandEvery : n);
}

export function atmosphereFor(lane) { return ATMO[tierOf(lane)] || ATMO[0]; }

/* ---------- lane construction ------------------------------------------- */

/* A safe island: no convoy, no clock, and a little scenery for the renderer
   to draw (generated here so it is deterministic per world seed). */
function makeIsland(index, r) {
  const C = FROG_CONST;
  const kinds = ["tree", "bush", "flower", "pond", "lamp", "tree", "bush", "flower"];
  const decor = [];
  const n = 3 + Math.floor(r() * 4);
  const left = Math.max(0.3, C.frogX - 0.95);          // scenery goes either
  const right = Math.min(C.roadW - 0.3, C.frogX + 0.95); // side of the frog's column
  for (let k = 0; k < n; k++) {
    const kind = kinds[Math.floor(r() * kinds.length) % kinds.length];
    const x = r() < 0.5
      ? 0.35 + r() * Math.max(0.1, left - 0.35)
      : right + r() * Math.max(0.1, (C.roadW - 0.35) - right);
    decor.push({ kind, x, s: 0.55 + r() * 0.7, seed: Math.floor(r() * 1000) });
  }
  return {
    index, safe: true, summit: index >= C.summit,
    dir: index % 2 === 1 ? 1 : -1,
    speed: 0, cw: Infinity, minGap: 0, cars: [], loopLen: 1, gap: 0,
    carW: 0, kind: "island", body: "#2f7a48", shade: "#173f26",
    chevStep: 1, phase: 0, decor,
  };
}

/* Build one lane: a small convoy of distinct vehicles with distinct gaps.
   The convoy repeats every `loopLen`; `phase` slides the whole thing along
   the road over time. Vehicles are laid out front-to-back in increasing x
   (the direction of travel is handled by `phase` moving, not by mirroring),
   so the set of clear windows is exactly the set of gaps -- mirrored lanes
   show the same windows in the opposite order, which is what you'd expect. */
export function makeLane(index, rng = Math.random) {
  const C = FROG_CONST;
  const r = rng;
  if (isSafeLane(index)) return makeIsland(index, r);

  const t = tierOf(index);
  const prof = TIERS[t];
  const w = clamp01((index - 1 - t * C.islandEvery) / (C.islandEvery - 1));

  const speed = Math.max(0.6, lerp(prof.speed[0], prof.speed[1], w) + (r() - 0.5) * prof.speedJ);
  const cw = Math.max(0.34, lerp(prof.cw[0], prof.cw[1], w) + (r() - 0.5) * prof.cwJ);
  // spatial gap that yields at least `cw` seconds of daylight at this speed
  const minGap = cw * speed;
  const count = prof.cars[0] + Math.floor(r() * (prof.cars[1] - prof.cars[0] + 1));
  const gv = lerp(prof.gapVar[0], prof.gapVar[1], w);
  const carW = lerp(prof.carW[0], prof.carW[1], w);

  const cars = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const cwi = Math.max(0.5, carW + (r() - 0.5) * 0.18);
    const p = PAINT[Math.floor(r() * PAINT.length) % PAINT.length];
    cars.push({
      off: x, w: cwi,
      kind: cwi < 1.05 ? "car" : cwi < 1.5 ? "wagon" : "truck",
      body: p[0], shade: p[1],
    });
    x += cwi + minGap + r() * gv * minGap;
  }

  const lead = cars[0];
  const loopLen = x;
  return {
    index, safe: false,
    dir: index % 2 === 1 ? 1 : -1,
    speed, cw, minGap,
    cars, loopLen,
    gap: minGap,
    // representative vehicle, used by the HUD and the lane's chevron tint
    carW: lead.w, kind: lead.kind, body: lead.body, shade: lead.shade,
    chevStep: (loopLen / cars.length) * 0.5,
    phase: r() * loopLen,
  };
}

export function stepLane(lane, dtSec) {
  if (!lane || lane.safe) return;
  lane.phase = mod(lane.phase + lane.dir * lane.speed * dtSec, lane.loopLen);
}

/* the same lane as it will be `tauSec` from now (used for lookahead / bot play) */
export function laneAt(lane, tauSec) {
  if (!lane || lane.safe) return lane;
  const phase = mod(lane.phase + lane.dir * lane.speed * tauSec, lane.loopLen);
  return {
    index: lane.index, dir: lane.dir, speed: lane.speed, carW: lane.carW,
    gap: lane.gap, loopLen: lane.loopLen, cw: lane.cw, minGap: lane.minGap,
    cars: lane.cars, phase, chevStep: lane.chevStep,
    kind: lane.kind, body: lane.body, shade: lane.shade,
  };
}

/* Every vehicle whose body is in (or near) the visible stretch of road.
   Returns `{x, w, dir, kind, body, shade}` so the renderer can draw each
   car with its own size and paint. */
export function laneCars(lane, roadW, pad = 2) {
  const out = [];
  if (!lane || lane.safe) return out;
  const L = lane.loopLen;
  for (const c of lane.cars) {
    const x0 = c.off + lane.phase;
    const kMin = Math.floor((-pad - x0) / L);
    const kMax = Math.ceil((roadW + pad - x0) / L);
    for (let k = kMin; k <= kMax; k++) {
      out.push({ x: x0 + k * L, w: c.w, dir: lane.dir, kind: c.kind, body: c.body, shade: c.shade });
    }
  }
  return out;
}

export function laneHit(lane, fx, halfW) {
  if (!lane || lane.safe) return false;
  const L = lane.loopLen;
  for (const c of lane.cars) {
    const x0 = c.off + lane.phase;
    const kMin = Math.floor((fx - halfW - x0) / L) - 1;
    const kMax = Math.ceil((fx + halfW - x0) / L) + 1;
    for (let k = kMin; k <= kMax; k++) {
      const x = x0 + k * L;
      if (x < fx + halfW && x + c.w > fx - halfW) return true;
    }
  }
  return false;
}

/* Seconds until a vehicle first reaches the frog's column (0 if one is on it
   now). The convoy is periodic in space with period `loopLen`, so it is also
   periodic in time with period `loopLen / speed` -- which lets us solve each
   car's next arrival exactly with a single modulo, no iteration. */
export function timeUntilHit(lane, fx, halfW) {
  if (!lane) return Infinity;
  if (lane.safe) return Infinity;
  const L = lane.loopLen;
  const v = lane.speed;
  const P = L / v;
  const nearEdge = fx - halfW;   // a right-moving car's nose crosses this first
  const farEdge = fx + halfW;    // a left-moving car's nose crosses this first
  let best = Infinity;
  for (const c of lane.cars) {
    const x0 = c.off + lane.phase;
    // the copy of this car whose left edge sits closest to the column
    const x = x0 + Math.round((fx - x0) / L) * L;
    if (x < farEdge && x + c.w > nearEdge) return 0;
    const dt = lane.dir > 0 ? (nearEdge - (x + c.w)) / v : (x - farEdge) / v;
    const t = mod(dt, P);
    if (t < best) best = t;
  }
  return best;
}

export function clearFor(lane, fx, halfW, durSec) {
  return timeUntilHit(lane, fx, halfW) > durSec;
}

/* Put the frog's column inside the lane's widest gap, with the next car due
   to arrive in exactly `margin` seconds (or as close to it as the widest gap
   allows). The convoy is rigid, so once the column is inside a gap, sliding
   the whole thing back and forth sweeps the remaining daylight. */
export function aimMargin(lane, fx, halfW, margin) {
  if (!lane || lane.safe) return lane;
  const L = lane.loopLen;
  const v = lane.speed;
  const nearEdge = fx - halfW;
  const farEdge = fx + halfW;
  let best = null;
  for (let k = 0; k < lane.cars.length; k++) {
    const a = lane.cars[k], b = lane.cars[(k + 1) % lane.cars.length];
    const gap = mod(b.off - (a.off + a.w), L);
    if (!best || gap > best.gap) best = { gap, a, b };
  }
  if (!best) return lane;
  // the column itself is 2*halfW wide, so the daylight available to it is the
  // gap minus the frog
  const cap = (best.gap - 2 * halfW) / v;
  const want = Math.min(margin, Math.max(0, cap - 0.001));
  if (lane.dir > 0) {
    // traffic comes from the left, so the car whose tail opens the widest gap
    // is the next one to reach the column
    lane.phase = mod(nearEdge - v * want - (best.a.off + best.a.w), L);
  } else {
    // mirror image: the next arrival is the car on the right
    lane.phase = mod(farEdge + v * want - best.b.off, L);
  }
  return lane;
}

/* The hop is hit-tested against the frog's actual y span, so these are the
   two moments that decide whether a hop is safe: by `leaveCurrent` the frog
   has climbed out of its old lane, and from `enterNext` it is inside the new
   one. Between them it is over the paint and belongs to both. */
export function hopTiming() {
  const C = FROG_CONST;
  return {
    leaveCurrent: C.hopSec * (0.5 + C.frogHalfH),
    enterNext: C.hopSec * (0.5 - C.frogHalfH),
  };
}

// lane indices whose band the frog's body currently touches
export function overlappedLanes(y, halfH, maxLane) {
  const out = [];
  const from = Math.max(1, Math.floor(y - halfH + 0.5));
  const to = Math.min(maxLane, Math.ceil(y + halfH + 0.5));
  for (let i = from; i <= to; i++) {
    if (y + halfH > i - 0.5 && y - halfH < i + 0.5) out.push(i);
  }
  return out;
}

/* ---------- payouts ------------------------------------------------------ */

/* How much one lane is worth. The rungs widen one notch per block, so the
   ladder stays a straight line *inside* a tier (you always know what the next
   hop pays) but each new tier climbs steeper than the last:

     lanes   1-10   11-20   21-30  ...  91-100
     per lane +0.05  +0.06   +0.07  ... +0.14

     lane   0     10     20     30     40     50     60     70     80     90    100
     mult  x1.00 x1.50  x2.10  x2.80  x3.60  x4.50  x5.50  x6.60  x7.80  x9.10 x10.50
*/
export function perHopFor(lane) {
  const C = FROG_CONST;
  return C.perHop + tierOf(Math.max(1, lane)) * C.perHopStep;
}

export function multFor(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, Math.min(C.summit, Math.floor(Number(depth) || 0)));
  let m = C.startMult;
  for (let i = 1; i <= d; i++) m += perHopFor(i);
  return m;
}

/* How long the road blocks traffic in the lane a frog has just landed in.
   Every landing buys a genuine safe pocket; it shrinks as you get deeper,
   from 1.75s on the first lane to 0.50s near the summit, which is what keeps
   a patient player honest. Islands ignore this entirely -- they never lapse. */
export function blockSecFor(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, depth - 1);
  return Math.max(C.blockMin, C.blockHi - d * C.blockDecay);
}
