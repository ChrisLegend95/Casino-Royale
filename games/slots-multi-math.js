export const REELS = 5;
export const ROWS = 3;

export const WILD_ID = "wild";
export const SCATTER_ID = "scatter";
/* The symbol that arms this machine's progressive (see the jackpot block in
   src/state.js). It is a SCATTER in the same sense the wagon wheel is: it pays
   nothing on a payline and BREAKS the line it lands on, and three or more of
   them ANYWHERE on the fifteen cells takes the pot. It carries no luck scaling
   either -- luck buys line pays, never pot chances.
   
   Its weight is the one number that decides how often the pot goes: at 1.0 of
   a 121.6-weight drum (117.6 on the two outer drums, which carry no wild) a
   grid lands three or more about once in 4,091 spins. The exact figures come
   from a Poisson-binomial over the fifteen cells, not a sim -- see DEV-NOTES.
   That weight was taken off the `star` (2.5 -> 1.5) so the reels keep their
   total: the exact tuner prices the donation at 0.841 points of line return,
   which is what the feature costs this machine. */
export const JACKPOT_ID = "jackpot";
export const JACKPOT = { id: JACKPOT_ID, sprite: "jackpot", glyph: "\u{1F3B0}", w: 1.0 };

/* `glyph` is the emoji this symbol used to be drawn with, kept as the fallback
   for when the artwork cannot be loaded; `sprite` is the file in src/sprites/
   (see sprites/README.md). `banana` became `watermelon` when the symbols took
   their artwork from the supplied sheet — the pays, weights and tiers below
   are untouched, only the picture changed. */
export const SYMBOLS = [
  { id: "cherry", sprite: "cherry", glyph: "\u{1F352}", w: 24, tier: 0, pay: { 3: 8, 4: 25, 5: 110 } },
  { id: "lemon", sprite: "lemon", glyph: "\u{1F34B}", w: 22, tier: 0, pay: { 3: 10, 4: 30, 5: 140 } },
  { id: "watermelon", sprite: "watermelon", glyph: "\u{1F349}", w: 20, tier: 0, pay: { 3: 12, 4: 35, 5: 170 } },
  { id: "grape", sprite: "grapes", glyph: "\u{1F347}", w: 18, tier: 0, pay: { 3: 15, 4: 40, 5: 230 } },
  { id: "bell", sprite: "bell", glyph: "\u{1F514}", w: 14, tier: 1, pay: { 3: 28, 4: 110, 5: 420 } },
  { id: "gem", sprite: "diamond", glyph: "\u{1F48E}", w: 9, tier: 1, pay: { 3: 50, 4: 230, 5: 950 } },
  { id: "seven", sprite: "seven", glyph: "7\uFE0F\u20E3", w: 5, tier: 2, pay: { 3: 100, 4: 450, 5: 700 } },
  { id: "star", sprite: "star", glyph: "\u2B50", w: 1.5, tier: 2, pay: { 3: 200, 4: 700, 5: 1000 } },
];

/* the wild wears the machine's own WILD banner; the scatter — which is what
   awards the free spins — wears the BONUS banner (both row 6 of the sheet) */
export const WILD = { id: WILD_ID, sprite: "wild", glyph: "\u{1F0CF}", w: 4, pay: { 3: 250, 4: 800, 5: 1000 } };
export const SCATTER = { id: SCATTER_ID, sprite: "bonus", glyph: "\u{1F4A0}", w: 3.1, pay: { 3: 5, 4: 25, 5: 130 } };

export const SYMBOL_BY_ID = {};
for (const s of SYMBOLS) SYMBOL_BY_ID[s.id] = s;
SYMBOL_BY_ID[WILD_ID] = WILD;
SYMBOL_BY_ID[SCATTER_ID] = SCATTER;
SYMBOL_BY_ID[JACKPOT_ID] = JACKPOT;

export const PAYROW = [...SYMBOLS, WILD];

export const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

export const MAX_LINES = LINES.length;

const CFG = {
  wildReels: [1, 2, 3],
  freeBoost: 0.14,
  retriggerCap: 40,
  /* Luck coefficients, kept small so the machine stays under 100% even at the
     luck cap (see the balance book in main.pjs). Together they are worth about
     +1.1% of return at the cap -- an edge, not a printer. */
  tierLuck1: 0.48,
  tierLuck2: 0.96,
  luckBonus: 0.32,
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
  out.push({ id: SCATTER_ID, w: SCATTER.w });
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
   random draw produced is replaced by another draw from the same drum. (On the
   3-reel machine the whole grid is forced, so there the jackpot is simply kept
   out of the cheat pool -- see slots.js.) */
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
      if (id === SCATTER_ID || id === JACKPOT_ID) break;
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
  let scatterCount = 0;
  const scatterCells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) {
      if (grid[r][c] === SCATTER_ID) { scatterCount++; scatterCells.push([r, c]); }
    }
  }
  const scatterPay = scatterCount >= 3 ? Math.round((SCATTER.pay[Math.min(5, scatterCount)] || 0) * lm) : 0;
  /* this machine's progressive: three or more JACKPOT symbols ANYWHERE on the grid
     (a wild does not stand in for one, and the symbol pays nothing itself -- it
     only arms the pot), exactly as the machine's card and meter say */
  let jackpotCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) if (grid[r][c] === JACKPOT_ID) jackpotCount++;
  }
  const jackpot = jackpotCount >= 3;
  return { wins, scatterCount, scatterCells, scatterPay, jackpot, jackpotCount };
}

export function freeSpinsFor(scatterCount) {
  if (scatterCount >= 5) return 20;
  if (scatterCount === 4) return 15;
  if (scatterCount === 3) return 10;
  return 0;
}

export function spinWinUnits(ev, activeLines) {
  const n = activeLines || MAX_LINES;
  return ev.wins.reduce((a, w) => a + w.pay, 0) + ev.scatterPay * n;
}

export function resolveSpinSequence(rng, luck, activeLines, opts) {
  const n = activeLines || MAX_LINES;
  const lm = luckMultFor(luck);
  const spins = [];
  let lineUnits = 0;
  let scatterUnits = 0;
  let awarded = 0;
  let remaining = 0;

  const baseGrid = opts && opts.rig ? riggedBaseGrid(rng, luck, n) : spinGrid(rng, luck);
  const baseEv = evaluateGrid(baseGrid, n, lm);
  const baseScatterUnits = baseEv.scatterPay * n;
  lineUnits += baseEv.wins.reduce((a, w) => a + w.pay, 0);
  scatterUnits += baseScatterUnits;
  spins.push({ grid: baseGrid, ev: baseEv, kind: "base" });
  /* the progressive can be armed by the base spin or by any free spin in the
     sequence (a free spin is still a spin on the reels) */
  let jackpot = !!baseEv.jackpot;
  remaining = freeSpinsFor(baseEv.scatterCount);
  awarded = remaining;

  const cap = CFG.retriggerCap;
  while (remaining > 0 && awarded < cap) {
    remaining--;
    const g = spinGrid(rng, luck + CFG.freeBoost);
    const ev = evaluateGrid(g, n, lm);
    if (ev.jackpot) jackpot = true;
    lineUnits += ev.wins.reduce((a, w) => a + w.pay, 0);
    scatterUnits += ev.scatterPay * n;
    spins.push({ grid: g, ev, kind: "free" });
    const more = freeSpinsFor(ev.scatterCount);
    if (more) { remaining += more; awarded += more; }
  }

  const totalUnits = lineUnits + scatterUnits;
  return {
    spins,
    lineUnits,
    scatterUnits,
    totalUnits,
    multiplier: totalUnits / n,
    jackpot,
    freeAwarded: awarded,
    freePlayed: spins.length - 1,
    baseWinUnits: spinWinUnits(baseEv, n),
    scatterCount: baseEv.scatterCount,
  };
}
