/* =========================================================
   frogger-math.js — the traffic + collision model behind Frogger Gamble.

   No DOM in here, so the model can be calibrated and re-tuned headlessly
   (Monte-Carlo over a bot player; see README.md for the measured numbers).

   Units: one lane is 1.0 tall, the road is FROG_CONST.roadW wide, the frog
   sits at a fixed FROG_CONST.frogX, and time is in seconds. The renderer
   only ever multiplies by `laneH`, which keeps the physics independent of
   canvas resolution.

   A lane is an endless, *irregular* stream of vehicles: it holds a handful
   of cars with randomly-sized widths and randomly-sized gaps, and that whole
   little convoy repeats spatially every `loopLen`. Because the gaps vary, the
   lane does not tick like a metronome -- some windows are wide, some are
   tight. What is guaranteed is the *minimum* window: `cw` is the least amount
   of daylight the fox's column ever gets, and it is the difficulty dial.
   Lane 1 gives you 1.70s of guaranteed daylight; lane 14, with fast long
   traffic, gives 0.78s. Every gap in the lane is at least that long.

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
  startMult: 1.0,     // the free step onto the road leaves you exactly even
  step2Mult: 1.2,     // the first lane you *choose* to cross
  step3Mult: 1.4,     // the second lane you choose to cross
  midLane: 10,        // ...compounding to x10 once you've crossed ten lanes
  midMult: 10,
  roadW: 7,           // visible road width, lane units
  frogX: 3.5,         // the frog's fixed column
  maxLanes: 40,       // lanes generated up front
  ramp: 13,           // difficulty ramps over this many lanes, then holds
  // lane 1 -> lane 14 ramps
  speedLo: 1.8, speedHi: 3.4, speedJ: 0.25,
  cwLo: 1.7, cwHi: 0.78, cwJ: 0.04,   // guaranteed clear window, seconds
  carWLo: 0.85, carWHi: 1.8, carWJ: 0.1,
  carsLo: 2, carsHi: 5,               // vehicles per repeating convoy
  gapVar: 1.0,                        // extra random gap, as a fraction of the minimum
  // how long the road holds traffic back (a safe pocket) after each landing
  blockHi: 1.8, blockDecay: 0.06, blockMin: 0.9,
  // the frog starts mid-road with this much daylight before the first car arrives
  initLo: 0.7, initHi: 1.4,
  scan: 14,
};

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

/* Build one lane: a small convoy of distinct vehicles with distinct gaps.
   The convoy repeats every `loopLen`; `phase` slides the whole thing along
   the road over time. Vehicles are laid out front-to-back in increasing x
   (the direction of travel is handled by `phase` moving, not by mirroring),
   so the set of clear windows is exactly the set of gaps -- mirrored lanes
   show the same windows in the opposite order, which is what you'd expect. */
export function makeLane(index, rng = Math.random) {
  const C = FROG_CONST;
  const r = rng;
  const t = Math.min(1, Math.max(0, (index - 1) / C.ramp));
  const speed = C.speedLo + t * (C.speedHi - C.speedLo) + (r() - 0.5) * C.speedJ;
  const cw = Math.max(0.4, C.cwLo + t * (C.cwHi - C.cwLo) + (r() - 0.5) * C.cwJ);
  // spatial gap that yields at least `cw` seconds of daylight at this speed
  const minGap = cw * speed;
  const count = C.carsLo + Math.floor(r() * (C.carsHi - C.carsLo + 1));

  const cars = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = Math.max(0.5, C.carWLo + t * (C.carWHi - C.carWLo) + (r() - 0.5) * C.carWJ);
    const p = PAINT[Math.floor(r() * PAINT.length) % PAINT.length];
    cars.push({
      off: x, w,
      kind: w < 1.05 ? "car" : w < 1.5 ? "wagon" : "truck",
      body: p[0], shade: p[1],
    });
    x += w + minGap + r() * C.gapVar * minGap;
  }

  const lead = cars[0];
  const loopLen = x;
  return {
    index,
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
  lane.phase = mod(lane.phase + lane.dir * lane.speed * dtSec, lane.loopLen);
}

// the same lane as it will be `tauSec` from now (used for lookahead / bot play)
export function laneAt(lane, tauSec) {
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
  if (!lane) return false;
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

/* depth = lanes crossed from the verge. The frog is automatically stepped one
   lane onto the road (where it is exactly even), and every lane it *chooses*
   to cross pays more than the last:

     lanes  1     2     3     4     5     6     7     8     9     10   ...  20
     mult   x1.00 x1.20 x1.40 x1.85 x2.46 x3.25 x4.31 x5.70 x7.55 x10.0 ... x20.0

   The first two chosen lanes are the gentle x1.2 / x1.4 rungs, then the prize
   compounds to x10 by the tenth lane; from there it adds a flat x1 per lane,
   so the twentieth lane is exactly x20 and it keeps climbing after that. */
export function multFor(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, depth);
  if (d <= 1) return C.startMult;
  if (d === 2) return C.step2Mult;
  if (d === 3) return C.step3Mult;
  if (d <= C.midLane) {
    return C.step3Mult * Math.pow(C.midMult / C.step3Mult, (d - 3) / (C.midLane - 3));
  }
  return C.midMult + (d - C.midLane);
}

/* How long the road blocks traffic in the lane a frog has just landed in.
   Every landing buys a genuine safe pocket; it shrinks as you get deeper,
   which is what keeps a patient player honest. Set FROG_CONST.blockHi huge
   (or wire it to a root tunable) for a pocket that never lapses. */
export function blockSecFor(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, depth - 1);
  return Math.max(C.blockMin, C.blockHi - d * C.blockDecay);
}
