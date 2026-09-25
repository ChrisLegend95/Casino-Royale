import { CONFIG } from "../state.js";

/* =========================================================
   Wheelhouse ("slots-wheel") -- the maths.

   Five drums, three rows, TWENTY-FIVE paylines, and one bonus: land
   THREE or more WHEEL scatters anywhere on the grid and the wheel drops
   over the reels, spins, and pays a straight multiplier of your TOTAL
   stake -- x3, x5, x10, x15 or x25. Three is the trigger (deliberately
   easy to reach), and there is no separate scatter cash prize: the wheel
   itself is the event, and it fires about once in 143 spins.

   This module owns the reels, the line table, the paytable and the
   wheel, so the UI (slots-wheel.js) and the balance book in main.pjs
   can both read the same numbers. Kept deliberately plain: no free
   spins, no retriggers, no multiplier ladders -- one bonus, and it is
   the wheel.
   ========================================================= */

export const REELS = 5;
export const ROWS = 3;

export const WILD_ID = "wild";
export const BONUS_ID = "bonus";
/* The symbol that arms this machine's progressive (see the jackpot block in
   src/state.js). Like the wheel it is a scatter: it pays nothing on a payline,
   it BREAKS the line it lands on, and three or more of them ANYWHERE on the
   fifteen cells takes the pot -- a wild does not stand in for one, and luck
   never touches it (luck buys line pays, never pot chances).

   Its weight is the one number that decides how often the pot goes: at 1.0 of
   a 124.15-weight drum (the wild sits on all five here) a grid lands three or
   more about once in 4,522 spins. Exact, from a Poisson-binomial over the
   fifteen cells -- see DEV-NOTES. That weight came off the `crown` (2.2 ->
   1.2) so the drums keep their total; the exact tuner prices the donation at
   0.954 points of line return, which is what the feature costs this machine. */
export const JACKPOT_ID = "jackpot";
export const JACKPOT = { id: JACKPOT_ID, sprite: "jackpot", glyph: "\u{1F3B0}", w: 1.0 };

/* `glyph` is the emoji this symbol falls back to if its artwork cannot be
   loaded (see src/sprites.js); `w` is its weight on every drum. `tier` 0/1/2
   is what the Lucky Coin luck nudge scales (see reelWeights). `pay` is per
   line bet for a run of 3/4/5 from the left edge of a payline.

   The shape of the table is deliberate: the four cheapest symbols carry the
   bulk of the return (~75% of it) because three-of-a-kind on a 24-weight
   symbol is a hundred times more likely than anything on the crown, and the
   top of the table is squeezed flat against the house's 1000x line ceiling
   so the wheel -- not a lucky line -- is this machine's headline win. */
export const SYMBOLS = [
  { id: "cherry", sprite: "cherry", glyph: "\u{1F352}", w: 24, tier: 0, pay: { 3: 10, 4: 30, 5: 100 } },
  { id: "lemon", sprite: "lemon", glyph: "\u{1F34B}", w: 22, tier: 0, pay: { 3: 12, 4: 36, 5: 120 } },
  { id: "orange", sprite: "orange", glyph: "\u{1F34A}", w: 20, tier: 0, pay: { 3: 15, 4: 45, 5: 150 } },
  { id: "plum", sprite: "plum", glyph: "\u{1F7E3}", w: 18, tier: 0, pay: { 3: 20, 4: 60, 5: 200 } },
  { id: "bell", sprite: "bell", glyph: "\u{1F514}", w: 13, tier: 1, pay: { 3: 30, 4: 100, 5: 350 } },
  { id: "coin", sprite: "coin", glyph: "\u{1FA99}", w: 9, tier: 1, pay: { 3: 50, 4: 175, 5: 600 } },
  { id: "gem", sprite: "diamond", glyph: "\u{1F48E}", w: 6, tier: 1, pay: { 3: 80, 4: 300, 5: 800 } },
  { id: "seven", sprite: "seven", glyph: "7\uFE0F\u20E3", w: 3.6, tier: 2, pay: { 3: 150, 4: 500, 5: 900 } },
  { id: "crown", sprite: "crown", glyph: "\u{1F451}", w: 1.2, tier: 2, pay: { 3: 250, 4: 700, 5: 1000 } },
];

/* The wild sits on EVERY drum (unlike Fortune Lines, where it is nailed to
   the middle three). That is what makes its own pay row real: a run has to
   start on drum 1, so a wild that never reaches drum 1 can never pay on its
   own line, and the head of a paytable would be advertising a combination
   the reels cannot produce. With a wild on drum 1, five wilds is a genuine
   (1 in ~3 billion) jackpot, and a wild leading a line is the sight the
   machine is built around.

   The WHEEL wears the sheet's own wheel artwork and is the scatter that
   brings the bonus round in. Its weight is the ONE number that decides how
   often the bonus fires: at weight 3.35 a grid lands three or more of them
   about once in 143 spins, which is where the wheel's ~8% slice of the
   return comes from (see the balance book in main.pjs). It carries no cash
   pay of its own -- the wheel IS the prize. */
export const WILD = { id: WILD_ID, sprite: "wild", glyph: "\u{1F0CF}", w: 3, pay: { 3: 250, 4: 800, 5: 1000 } };
export const BONUS = { id: BONUS_ID, sprite: "wheel", glyph: "\u{1F3A1}", w: 3.35 };

export const SYMBOL_BY_ID = {};
for (const s of SYMBOLS) SYMBOL_BY_ID[s.id] = s;
SYMBOL_BY_ID[WILD_ID] = WILD;
SYMBOL_BY_ID[BONUS_ID] = BONUS;
SYMBOL_BY_ID[JACKPOT_ID] = JACKPOT;

export const PAYROW = [...SYMBOLS, WILD];

/* Twenty-five paylines, one row index per drum. The first nine are the
   flat/twin/V shapes every multi-line machine has; the rest are the
   interleaved paths that make a twenty-five-line board feel busy. */
export const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 1, 1, 2],
  [2, 1, 1, 1, 0],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [1, 0, 2, 0, 1],
  [1, 2, 0, 2, 1],
  [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2],
];

export const MAX_LINES = LINES.length;

/* ---- the wheel ----
   Five equal segments, so the five multipliers are equally likely and the
   wheel is honest: no hidden house weighting behind the pointer. The values
   themselves are read from main.pjs so the owner can retune them without
   touching this file -- but note that the wheel's whole expected value is
   their MEAN, so raising one of them raises the machine's return. */
export function wheelValues() {
  const vals = [CONFIG.wheelMult1, CONFIG.wheelMult2, CONFIG.wheelMult3, CONFIG.wheelMult4, CONFIG.wheelMult5];
  for (const v of vals) {
    if (!Number.isFinite(v) || v <= 0) return [3, 5, 10, 15, 25];
  }
  return vals;
}

/* which segment the pointer stops on; index is 0..4 and `value` is what it
   pays, as a multiple of the TOTAL stake (see resolveSpin) */
export function spinWheel(rng, values) {
  const vals = values && values.length ? values : wheelValues();
  const i = Math.min(vals.length - 1, Math.floor(rng() * vals.length));
  return { index: i, value: vals[i], count: vals.length };
}

export function wheelMean(values) {
  const v = values && values.length ? values : wheelValues();
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/* ---- the bonus round ----
   Three or more wheels anywhere makes the wheel appear. It pays a multiple
   of the TOTAL stake, which is what makes it worth the same no matter how
   many paylines are live (exactly like Fortune Lines' scatter). There is no
   separate scatter cash prize: at a 1-in-143 trigger the wheel is the whole
   event, and a consolation pay on top would have to come out of the wheel's
   own slice of the return. */
export const BONUS_TRIGGER = 3;

export function wheelFor(count) {
  return count >= BONUS_TRIGGER;
}

/* ---- the reels ----
   Luck lifts the mid and top symbols on every drum, exactly the way Fortune
   Lines does it, and it does NOT touch the wheel's weight. That is
   deliberate: the wheel is a straight multiple of the stake, so letting luck
   buy extra wheels would be the one uncapped odds lever in the building.
   The bonus probability still drifts very slightly DOWN with luck -- the
   nudge inflates the denominator that the wheel's fixed weight is divided by
   -- so `luckBonus` is set high enough to pay that back and then some: the
   machine returns ~94.7% cold and ~96.0% at the luck cap, and never crosses
   100% (see the balance book in main.pjs). */
const CFG = {
  wildReels: [0, 1, 2, 3, 4],
  tierLuck1: 0.5,
  tierLuck2: 1.0,
  /* flat lift on every line pay at the cap, on top of the tier nudge */
  luckBonus: 0.4,
};

export function reelWeights(reel, luck) {
  const out = [];
  for (const s of SYMBOLS) {
    let m = 1;
    if (s.tier === 1) m = 1 + luck * CFG.tierLuck1;
    if (s.tier === 2) m = 1 + luck * CFG.tierLuck2;
    out.push({ id: s.id, w: s.w * m });
  }
  if (CFG.wildReels.includes(reel)) out.push({ id: WILD_ID, w: WILD.w });
  out.push({ id: BONUS_ID, w: BONUS.w });
  out.push({ id: JACKPOT_ID, w: JACKPOT.w });
  return out;
}

function pick(table, rng) {
  let total = 0;
  for (const it of table) total += it.w;
  let r = rng() * total;
  for (const it of table) {
    r -= it.w;
    if (r <= 0) return it.id;
  }
  return table[table.length - 1].id;
}

export function spinGrid(rng, luck) {
  const tables = [];
  for (let i = 0; i < REELS; i++) tables.push(reelWeights(i, luck));
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(REELS));
  for (let c = 0; c < REELS; c++) {
    for (let r = 0; r < ROWS; r++) grid[r][c] = pick(tables[c], rng);
  }
  return grid;
}

/* A rigged grid may not contain a single jackpot symbol. The rig fills one live
   payline with a paying symbol, but the rest of the grid is still a random spin
   -- and a random spin could drop three jackpots, which would let the reward rig
   forge the progressive with other players' money. So every jackpot cell a
   random draw produced is replaced by another draw from the same drum. */
function stripJackpots(grid, rng, luck) {
  for (let c = 0; c < REELS; c++) {
    const table = reelWeights(c, luck).filter((it) => it.id !== JACKPOT_ID);
    let total = 0;
    for (const it of table) total += it.w;
    for (let r = 0; r < ROWS; r++) {
      if (grid[r][c] !== JACKPOT_ID) continue;
      let x = rng() * total;
      let pick = table[table.length - 1].id;
      for (const it of table) { x -= it.w; if (x <= 0) { pick = it.id; break; } }
      grid[r][c] = pick;
    }
  }
  return grid;
}

/* reward rig: fill one active payline with five of the same paying symbol, so
   the base spin always resolves to a real win while everything else stays random.
   The jackpot symbol is then stripped out of whatever the random grid produced,
   so no cheat spin may forge the progressive. */
export function riggedBaseGrid(rng, luck, activeLines) {
  const n = activeLines || MAX_LINES;
  const grid = stripJackpots(spinGrid(rng, luck), rng, luck);
  const li = Math.min(n - 1, Math.floor(rng() * n));
  const line = LINES[li];
  const pool = SYMBOLS;
  let total = 0;
  for (const s of pool) total += s.w;
  let r = rng() * total;
  let sym = pool[pool.length - 1];
  for (const s of pool) { r -= s.w; if (r <= 0) { sym = s; break; } }
  for (let c = 0; c < REELS; c++) grid[line[c]][c] = sym.id;
  return grid;
}

export function linePay(symId, run) {
  const s = SYMBOL_BY_ID[symId];
  if (!s) return 0;
  return s.pay[run] || 0;
}

/* the flat part of the luck nudge, applied to every line pay */
export function luckMultFor(luck) {
  return 1 + Math.max(0, luck) * CFG.luckBonus;
}

export function evaluateGrid(grid, activeLines, luckMult) {
  const lm = luckMult || 1;
  const wins = [];
  const n = activeLines || MAX_LINES;
  for (let li = 0; li < n; li++) {
    const line = LINES[li];
    let base = null;
    let run = 0;
    const cells = [];
    for (let c = 0; c < REELS; c++) {
      const id = grid[line[c]][c];
      if (id === BONUS_ID || id === JACKPOT_ID) break;
      if (id === WILD_ID) { run++; cells.push([line[c], c]); continue; }
      if (base === null) { base = id; run++; cells.push([line[c], c]); continue; }
      if (id === base) { run++; cells.push([line[c], c]); }
      else break;
    }
    if (run >= 3) {
      const symId = base === null ? WILD_ID : base;
      const pay = Math.round(linePay(symId, run) * lm);
      if (pay > 0) wins.push({ line: li, path: line, symId, run, pay, cells });
    }
  }
  let bonusCount = 0;
  const bonusCells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) {
      if (grid[r][c] === BONUS_ID) { bonusCount++; bonusCells.push([r, c]); }
    }
  }
  /* this machine's progressive: three or more JACKPOT symbols ANYWHERE on the grid
     (a wild does not stand in for one, and the symbol pays nothing itself -- it
     only arms the pot), exactly as the machine's card and meter say */
  let jackpotCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) if (grid[r][c] === JACKPOT_ID) jackpotCount++;
  }
  const jackpot = jackpotCount >= 3;
  return { wins, bonusCount, bonusCells, jackpot, jackpotCount };
}

/* everything a spin won, in units of the LINE bet (the UI multiplies by the
   line bet to get money). The wheel is NOT in here -- it pays a multiple of
   the TOTAL stake, and resolveSpin/wheelWinUnits add it separately. */
export function spinWinUnits(ev) {
  return ev.wins.reduce((a, w) => a + w.pay, 0);
}

export function wheelWinUnits(value, activeLines) {
  const n = activeLines || MAX_LINES;
  return value * n;
}

/* One spin, start to finish: the grid, the line wins, and -- if the wheel
   came in -- the segment it is going to stop on. The segment is drawn here,
   before any of the animation, so the drum and the wheel are two faces of
   the same result and the UI only has to draw it.

   `multiplier` is the whole spin's return as a multiple of the STAKE, which
   is what main.js feeds to the perk/payout pipeline. */
export function resolveSpin(rng, luck, activeLines, opts) {
  const n = activeLines || MAX_LINES;
  const lm = luckMultFor(luck);
  const grid = opts && opts.rig ? riggedBaseGrid(rng, luck, n) : spinGrid(rng, luck);
  const ev = evaluateGrid(grid, n, lm);
  const lineUnits = ev.wins.reduce((a, w) => a + w.pay, 0);

  let wheel = null;
  if (wheelFor(ev.bonusCount)) {
    const vals = wheelValues();
    const res = spinWheel(rng, vals);
    wheel = { index: res.index, count: res.count, value: res.value, values: vals, units: res.value * n };
  }

  const wheelUnits = wheel ? wheel.units : 0;
  const totalUnits = lineUnits + wheelUnits;

  return {
    grid,
    ev,
    lineUnits,
    wheel,
    wheelUnits,
    totalUnits,
    multiplier: totalUnits / n,
    /* armed this machine's progressive? (see the jackpot block in src/state.js) */
    jackpot: !!ev.jackpot,
    /* what the base spin alone paid, for the "no wheel, no win" wording */
    baseWinUnits: spinWinUnits(ev),
  };
}

/* every symbol this machine can draw, for warming the image cache */
export function spriteNames() {
  return PAYROW.map((s) => s.sprite).concat([BONUS.sprite, JACKPOT.sprite]);
}
