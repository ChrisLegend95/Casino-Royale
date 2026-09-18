/* =========================================================
   frogger-math.js — the traffic + collision model behind Frogger Gamble.

   No DOM in here, so the model can be calibrated and re-tuned headlessly
   (Monte-Carlo over a bot player, and an exhaustive "god planner" that finds
   the best schedule a perfect player could execute).

   Units: one lane is 1.0 tall, the road is FROG_CONST.roadW wide, the frog
   sits at a fixed FROG_CONST.frogX, and time is in seconds. The renderer
   only ever multiplies by `laneH`, which keeps the physics independent of
   canvas resolution.

   THE ROAD IS 100 LANES LONG, in ten blocks of ten.

     - Every tenth lane (10, 20, ... 90) is a SAFE ISLAND: a traffic-free
       grass median. Lane 100 is the SUMMIT — also safe, and crossing into it
       finishes the run.
     - The other nine lanes of a block are a TIER, and each tier has its own
       character (see TIERS below): the side street gives you ~0.67s windows at
       2.9 lanes/second, the final stretch gives you ~0.37s windows at 6.2-6.85.
       Every tier is a step up in speed, window pressure and vehicle size, and
       the pool of clear windows ratchets down block by block — with an
       unbounded rest as you step onto each median, which is what the grass is
       for. Convoy sizes are deliberately irregular (a lane draws anywhere
       between two and eleven vehicles), so two lanes in the same tier rarely
       look alike. The step out of the ISLAND 10 median is the sharpest of the
       whole road: the guaranteed window profile drops from 0.67-0.60s to
       0.54-0.48s, the traffic jumps in speed, the vehicles get bigger, and the
       pocket you land in shortens. It is the wall the machine is built around
       — and it sits exactly where the first real bankable rung does. Measured
       (DEV-NOTES.md): with 3s of patience on the grass a perfect planner
       cleared that block only ~25% of the time; with the clock gone it is a
       step, not a gate.

   ONLY THE CARS CAN KILL YOU. The verge and every median are safe for as long
   as the player cares to stand there: no traffic reaches the grass and there
   is no clock on it. What ends a run is stepping into a live lane and still
   being there when a car reaches the frog's column — a frog that never jumps
   simply waits on the grass for ever and banks ×1.00.

   THAT IS A DELIBERATE LOOSENING. The traffic is deterministic and fully on
   screen, so with no clock a patient (or scripted) player can watch every lane
   until it lines up and stroll deep into the road having taken no real risk at
   all. The old build paid for that with `restSec`, a sweep clock on the grass
   that killed the frog after a few seconds; it is gone, so the ladder below is
   no longer fitted against a bound — it is a fixed paytable measured against
   the road's actual generosity. DEV-NOTES.md ("the god harness") has the
   measured reach curve, the patience table showing what the clock used to buy
   the house, and the receipts for the decision.

   A lane is an endless, *irregular* stream of vehicles: it holds a handful
   of cars with randomly-sized widths and randomly-sized gaps, and that whole
   little convoy repeats spatially every `loopLen`. Because the gaps vary, the
   lane does not tick like a metronome -- some windows are wide, some are
   tight. What is guaranteed is the *minimum* window: `cw` is the least amount
   of daylight the frog's column ever gets, and it is the difficulty dial. A
   faster lane at the same `cw` is mostly cosmetic: the cars are further apart,
   so the convoy takes the same time to come round again.

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
  // ---- the payout ladder (see `multFor`) --------------------------------
  // THERE ARE TEN RUNGS, ONE PER ISLAND, AND YOU CAN ONLY BANK ON STANDING
  // GRASS. Banking anywhere else is a money printer: the landing spot is a
  // free choice, so "hop into one lane and take x1.00" would be a guaranteed
  // even-money exit, and "bank on the deepest lane I can legally reach" would
  // cash every intermediate rung. Restricting the cash-out to the ten medians
  // kills both, and turns every island into a real push-or-bank decision.
  // Rung i is what a run banked at lane 10*i pays.
  //
  // THE DOCTRINE (historical). With a clock on the grass, no strategy of any
  // kind could beat `rtp`. A strategy is a rule that decides, on each bankable
  // island, whether to bank or push on, so the best any strategy can do is the
  // best *banking schedule* -- and a schedule is a partition of the run's
  // outcomes by the deepest island reached. If P_j is the chance a perfect
  // player reaches island j (P_11 = 0) then the schedule that banks everywhere
  // yields
  //
  //     EV = SUM_j (P_j - P_j+1) x rung_j   <=   rtp
  //
  // and since banking earlier is just another schedule, EVERY strategy was
  // bounded by that maximum. The ten rungs exist so the left side has only ten
  // terms, and they were fitted (headlessly, with a 99% upper bound on the
  // god's reach) so that SUM never crossed rtp. That was the anti-farming
  // proof -- and it leaned entirely on the `restSec` sweep clock. Measured
  // (DEV-NOTES.md, the god harness; the number is what the planner banks by
  // reaching as deep as it can): 3s of grass patience is worth 1.19 of stake,
  // 6s 1.28, 10s 1.35, 20s 1.46, 40s 1.61, 90s 2.10, and unlimited patience
  // 4.72. THE CLOCK IS GONE (see the header note), so the SUM bound is
  // retired: what follows is a fixed paytable, not a proof. It is kept because
  // it is what the road was tuned and measured against, and because the
  // realistic player's numbers are unchanged by the removal -- a myopic bot
  // reaches island 10 in 19.4% of runs and returns 0.243 of stake, with the
  // clock and without it (it never stands still long enough for the clock to
  // matter). If you ever want the bound back, add a non-fatal hurry-up (a
  // shrinking payout, say) rather than a death, and re-measure before touching
  // the rungs.
  //
  // (The old note here claimed rung_i ~= rtp / P_i. That is NOT the bound --
  // it is far too generous, because it would allow every island to return rtp
  // *simultaneously* on the same branch. DEV-NOTES.md derives the correct one
  // and prints the fitted ladder.)
  //
  // The shape it was fitted to: the ladder's early rungs carry almost all the
  // budget (they own most of the probability mass), so rung 1 was set near
  // rtp / P_1 and the deep rungs can only be paid out of the thin tail of mass
  // that dies before them. A big top rung is affordable exactly when the god's
  // deep reach is measured tightly enough to bound it.
  ladderRungs: [1.25, 1.35, 1.50, 1.75, 2.25, 3.50, 6.00, 12.00, 25.00, 50.00],
  ladderCap: 1000,    // never advertise more than this (keep == maxWinMult in main.pjs)
  rtp: 0.90,          // the ceiling the ladder was fitted to (documentation only)
  roadW: 7,           // visible road width, lane units
  frogX: 3.5,         // the frog's fixed column
  maxLanes: 101,      // lanes 1..100 are crossable; 101 is the far kerb
  summit: 100,        // crossing lane 100 completes the run
  islandEvery: 10,    // lanes 10,20,...,100 are traffic-free safe islands
  cwFloor: 0.9,       // HUD reference when a lane has no meaningful window
  // how long the road holds traffic back (a safe pocket) after each landing.
  // Every landing buys a genuine safe pocket; it shrinks as you get deeper --
  // per lane AND per tier, so every island you cross costs you pocket as well
  // as window. It is the only moment a live lane stops for you, so it is the
  // budget a frog has to pick the next window. The floor is load-bearing: the
  // frog needs 0.164s to climb out of its own lane, so a pocket shorter than
  // ~0.26s stops being an escape hatch and the deep road becomes a death trap
  // that not even a perfect planner crosses (measured -- see DEV-NOTES.md).
  blockHi: 0.34, blockDecay: 0.0015, blockTierStep: 0.010, blockMin: 0.26,
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

   RANDOMNESS IS PART OF THE DESIGN. `speedJ`, `gapVar` and the per-vehicle
   width jitter in `makeLane` are deliberately wide, and the convoy range spans
   five or six vehicles (two to seven in the side street, six to eleven on the
   final stretch), so two lanes of the same tier rarely look alike and no lane
   can be memorised. What stays fixed is the *guaranteed* window `cw`, which is
   the actual difficulty dial -- everything else is texture.

   THE ISLAND 10 WALL. The step out of the side street is the only one in the
   road that changes the *character* of the traffic: the guaranteed window
   profile falls from 0.67-0.60s to 0.54-0.48s, the traffic speeds up by a
   tenth of a lane per second, and the vehicles get bigger.
   Every later step is a smaller fraction of what came before, which is what
   makes the first island the machine's real gatekeeper -- and it is
   deliberately the gatekeeper, because the ladder only starts paying there.
   These are the tiers a headless sweep (DEV-NOTES.md, "the tier sweep") chose,
   widened in a later randomness pass that was measured to leave the difficulty
   where it was (DEV-NOTES.md, "more random traffic"): t1 is a touch faster than
   the original side street, and the island-10 wall is the measured sharpest
   step in the road. */
export const TIERS = [
  { n: 1,  name: "SIDE STREET",     accent: "#5cf39a",
    speed: [2.90, 3.50], speedJ: 0.195, cw: [0.670, 0.595], cwJ: 0.036,
    cars: [2, 7], carW: [1.00, 1.35], gapVar: [0.950, 1.150] },
  { n: 2,  name: "DOWNTOWN",        accent: "#7dd3a0",
    speed: [3.60, 4.20], speedJ: 0.221, cw: [0.539, 0.484], cwJ: 0.032,
    cars: [3, 8], carW: [1.15, 1.60], gapVar: [0.775, 0.975] },
  { n: 3,  name: "THE FREEWAY",     accent: "#8fc9ff",
    speed: [4.00, 4.60], speedJ: 0.234, cw: [0.512, 0.474], cwJ: 0.030,
    cars: [3, 8], carW: [1.20, 1.75], gapVar: [0.750, 0.925] },
  { n: 4,  name: "RUSH HOUR",       accent: "#ffd23f",
    speed: [4.40, 5.00], speedJ: 0.260, cw: [0.484, 0.456], cwJ: 0.028,
    cars: [4, 9], carW: [1.10, 1.70], gapVar: [0.700, 0.875] },
  { n: 5,  name: "THE EXPRESSWAY",  accent: "#ff9f43",
    speed: [4.80, 5.40], speedJ: 0.286, cw: [0.465, 0.437], cwJ: 0.026,
    cars: [4, 9], carW: [1.15, 1.90], gapVar: [0.650, 0.825] },
  { n: 6,  name: "NIGHT CROSSING",  accent: "#8ea2ff",
    speed: [5.20, 5.80], speedJ: 0.312, cw: [0.446, 0.419], cwJ: 0.024,
    cars: [4, 9], carW: [1.15, 2.00], gapVar: [0.600, 0.775] },
  { n: 7,  name: "THE INTERCHANGE", accent: "#c58bff",
    speed: [5.50, 6.10], speedJ: 0.338, cw: [0.428, 0.400], cwJ: 0.022,
    cars: [5, 10], carW: [1.20, 2.05], gapVar: [0.550, 0.725] },
  { n: 8,  name: "STORM FRONT",     accent: "#63d7ff",
    speed: [5.80, 6.40], speedJ: 0.364, cw: [0.419, 0.391], cwJ: 0.022,
    cars: [5, 10], carW: [1.20, 2.10], gapVar: [0.500, 0.675] },
  { n: 9,  name: "THE GAUNTLET",    accent: "#ff7a6b",
    speed: [6.00, 6.60], speedJ: 0.390, cw: [0.409, 0.381], cwJ: 0.021,
    cars: [5, 10], carW: [1.25, 2.15], gapVar: [0.463, 0.638] },
  { n: 10, name: "FINAL STRETCH",   accent: "#ffe08a",
    speed: [6.20, 6.85], speedJ: 0.416, cw: [0.400, 0.372], cwJ: 0.020,
    cars: [6, 11], carW: [1.30, 2.20], gapVar: [0.425, 0.600] },
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

/* Every tenth lane is a rest stop: no traffic, no collisions and no clock.
   The frog may stand on one for as long as the player likes. */
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

/* You can only cash out on standing grass: the verge or one of the ten
   medians. Everywhere else the only move is to push on. */
export function isBankable(lane) {
  const i = Math.floor(Number(lane));
  if (!Number.isFinite(i) || i < 0) return false;
  return i === 0 || isSafeLane(i);
}

export function atmosphereFor(lane) { return ATMO[tierOf(lane)] || ATMO[0]; }

/* ---------- lane construction ------------------------------------------- */

/* A safe island: no convoy, and a little scenery for the renderer to draw
   (generated here so it is deterministic per world seed). */
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
  // The floor keeps a lane from ever becoming a solid wall: the frog needs
  // 0.164s of daylight to cross a lane, so anything at or under that would be
  // an impassable barrier (and the whole ladder beyond it dead). 0.24 leaves
  // the deepest tier enough room to be *barely* crossable.
  const cw = Math.max(0.24, lerp(prof.cw[0], prof.cw[1], w) + (r() - 0.5) * prof.cwJ);
  // spatial gap that yields at least `cw` seconds of daylight at this speed
  const minGap = cw * speed;
  const count = prof.cars[0] + Math.floor(r() * (prof.cars[1] - prof.cars[0] + 1));
  const gv = lerp(prof.gapVar[0], prof.gapVar[1], w);
  const carW = lerp(prof.carW[0], prof.carW[1], w);

  const cars = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    // Widths spread far wider than the tier average -- a per-vehicle factor of
    // 0.62 to 1.38 of the tier's mean, so a single lane can mix a motorbike
    // with a bus. Width never touches the guaranteed window (that comes from
    // `minGap` alone), so the whole spread is free visual and behavioural
    // variety rather than a difficulty dial.
    const cwi = Math.max(0.5, carW * (0.62 + r() * 0.76));
    const kind = cwi < 0.95 ? "bike" : cwi < 1.20 ? "car" : cwi < 1.60 ? "wagon" : cwi < 2.00 ? "truck" : "bus";
    const p = PAINT[Math.floor(r() * PAINT.length) % PAINT.length];
    cars.push({
      off: x, w: cwi, kind,
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
   one. Between them it is over the paint and belongs to both -- which is why
   a car reaching the column in the first `leaveCurrent` seconds of a hop
   still flattens the frog. */
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

/* THE LADDER IS TEN RUNGS: one per island, and only islands (and the verge)
   are bankable.

        lane   0    10     20     30     40     50     60     70     80     90    100
        mult  x1.00 x1.25  x1.35  x1.50  x1.75  x2.25  x3.50  x6.00 x12.00 x25.00 x50.00

   Why it looks like that:

     - LANE 0 IS A REFUND, NOT A RUNG. Banking on the verge hands the stake
       straight back (x1.00), so entering the machine costs nothing and the
       only way to make money is to cross.
     - THE LADDER IS FITTED TO THE BOUND, NOT TO A PER-ISLAND IDENTITY. See
       the note above `ladderRungs`: what has to hold is
       SUM_j (P_j - P_j+1) x rung_j <= rtp, where P_j is the measured chance
       that a perfect player reaches island j. That single inequality caps
       every possible stopping rule at once, because the god banking at every
       island IS the best rule available.
     - IT PUSHES YOU OFF THE FIRST ISLAND. rung 1 (x1.25) is only a little
       above even, and island 2 (x1.35) is where the real step is: the side
       street is the one block a good player can clear most of the time, so
       that is where the budget has to be spent, and it is not enough there to
       make standing still attractive. Taking the island-10 wall at speed
       starts paying real money.
     - THE TOP END IS PAID FOR OUT OF THE TAIL, NOT OUT OF THIN AIR. A x50
       summit is only affordable because the god's chance of reaching island
       100 is bounded below 1.8 parts in ten thousand; the deep rungs are
       sized from a 99%-upper-bound measurement, so the ladder survives even
       an unlucky calibration re-run.
     - THE RUNG YOU ARE HOLDING IS THE LAST ISLAND YOU REACHED. Mid-block you
       are carrying the rung you already banked past, and the next bankable
       number is the island ahead: the HUD shows both, and the gap between
       them is the risk you are being paid to take.
     - NOTHING IS LINEAR AND NOTHING COMPOUNDS PER LANE. Paying per lane is a
       printer because the god's reach per lane stays high forever; paying
       only at islands keeps the ten rungs far enough apart that each one can
       be set from the measured chance of getting there.

   The cap exists so a summit run cannot advertise a number the platform would
   refuse to pay: ladderCap must equal maxWinMult in main.pjs. */
export function islandIndexAt(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, Math.min(C.summit, Math.floor(Number(depth) || 0)));
  return Math.min(C.ladderRungs.length, Math.floor(d / C.islandEvery));
}

export function rungFor(islandIndex) {
  const C = FROG_CONST;
  const i = Math.floor(Number(islandIndex) || 0);
  if (i <= 0) return C.startMult;
  return Math.min(C.ladderCap, C.ladderRungs[Math.min(C.ladderRungs.length - 1, i - 1)]);
}

/* the multiplier a run banked at `depth` pays (the last island at or before
   it; x1.00 anywhere in the first block) */
export function multFor(depth) { return rungFor(islandIndexAt(depth)); }

/* the rung the frog is walking towards, for the HUD */
export function nextIslandRung(depth) { return rungFor(islandIndexAt(depth) + 1); }

/* How long the road blocks traffic in the lane a frog has just landed in.
   Every landing buys a genuine safe pocket; it shrinks as you get deeper, and
   it takes a second hit at every island you cross, so the pocket you get in
   DOWNTOWN is shorter than any pocket in the side street. With the shipped
   numbers it runs 0.34s off the verge, 0.32s through the side street, 0.30s
   at the island-10 wall, and settles onto the 0.26s floor early in block 3.
   Islands ignore it entirely -- nothing holds traffic back on a median
   because there is no traffic there. */
export function blockSecFor(depth) {
  const C = FROG_CONST;
  const d = Math.max(0, depth - 1);
  const t = tierOf(Math.max(1, depth));
  const base = C.blockHi - d * C.blockDecay - t * (C.blockTierStep || 0);
  return Math.max(C.blockMin, base);
}
