function cfg(name, fallback) {
  try {
    const g = typeof window !== "undefined" ? window.root : null;
    if (!g) return fallback;
    let v = g[name];
    if (v === undefined || v === null) return fallback;
    if (typeof v === "object" && typeof v.evaluateItem !== "undefined") v = v.evaluateItem;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch (e) {
    return fallback;
  }
}

/* The revolver's ladder is a table, not a scalar, so it needs its own reader:
   main.pjs defines it as a pjs function returning [[multiplier, liveRounds], ...].
   Same defensive posture as cfg() -- if root isn't up yet, the function is missing,
   or the rows are junk, return null and let revolver.js use its own fallback rows. */
function cfgLadder(name) {
  try {
    const g = typeof window !== "undefined" ? window.root : null;
    const fn = g ? g[name] : null;
    if (typeof fn !== "function") return null;
    const rows = fn();
    if (!Array.isArray(rows)) return null;
    const out = [];
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const mult = Number(r[0]);
      const live = Number(r[1]);
      if (!Number.isFinite(mult) || !Number.isFinite(live)) continue;
      out.push([mult, live]);
    }
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

export const CONFIG = {
  startingMoney: cfg("startingMoney", 1000),
  loanMinutes: cfg("loanMinutes", 60),
  loanInterest: cfg("loanInterest", 0.25),
  loanBase: cfg("loanBase", 1200),
  loanPerLevel: cfg("loanPerLevel", 250),
  idleDefaultBet: cfg("idleDefaultBet", 10),
  idleXpMult: cfg("idleXpMult", 3),
  froggerBlockSec: cfg("froggerBlockSec", 1.8),

  // Rocket Crash ("crash"). The rocket eases off the pad and accelerates: in log space
  // the climb is crashStart * t + crashAccel * t^2 (see the comment block in main.pjs).
  // These set the pace only -- the crash point, and therefore the 3% edge, is drawn
  // independently of them.
  crashStart: cfg("crashStart", 0.12),
  crashAccel: cfg("crashAccel", 0.084),

  // Ghost Muncher ("arcade"). See the comment block in main.pjs: the board is small
  // and the ghosts are slow on purpose, and the difficulty lives in fright/lives/time
  // plus Blinky's endgame ramp instead of in raw speed.
  arcadeCols: cfg("arcadeCols", 13),
  arcadeRows: cfg("arcadeRows", 9),
  arcadePacStepMs: cfg("arcadePacStepMs", 380),
  arcadeGhostStepMs: cfg("arcadeGhostStepMs", 600),
  arcadeLives: cfg("arcadeLives", 3),
  arcadeTimeLimit: cfg("arcadeTimeLimit", 70),
  arcadeFrightSec: cfg("arcadeFrightSec", 4),
  arcadePowerCells: cfg("arcadePowerCells", 2),
  arcadeGhost4Chance: cfg("arcadeGhost4Chance", 1),
  arcadeGhostRouting: cfg("arcadeGhostRouting", 2),
  arcadeFrightFlee: cfg("arcadeFrightFlee", 0.7),
  arcadeGhostBackoff: cfg("arcadeGhostBackoff", 6),
  arcadeElroyPace: cfg("arcadeElroyPace", 1.1),
  arcadeElroyHard: cfg("arcadeElroyHard", 1.22),
  arcadeElroyRush: cfg("arcadeElroyRush", 1.35),
  // colour-memory ("Neon Recall") tunables -- see main.pjs for what they do
  memStartLen: cfg("memStartLen", 3),
  memRandStartLen: cfg("memRandStartLen", 5),
  memMaxLen: cfg("memMaxLen", 20),
  memSeqStep: cfg("memSeqStep", 1.26),
  memRandStep: cfg("memRandStep", 1.33),
  memFlashMs: cfg("memFlashMs", 330),
  memGapMs: cfg("memGapMs", 130),
  memFlashDecay: cfg("memFlashDecay", 0.92),
  memGapDecay: cfg("memGapDecay", 0.94),
  memMinFlashMs: cfg("memMinFlashMs", 110),
  memMinGapMs: cfg("memMinGapMs", 55),
  xpBase: cfg("xpBase", 100),
  xpExp: cfg("xpExp", 1.3),
  xpTierSize: cfg("xpTierSize", 10),
  xpTierSpike: cfg("xpTierSpike", 2),
  xpRate: cfg("xpRate", 0.1),
  levelLuck: cfg("levelLuck", 0.002),
  levelReward: cfg("levelReward", 50),
  // treasure chest payouts (four of the nine chests pay, one more is a Lucky
  // Star that grants a second pick). The star's re-pick is worth the average
  // chest, so the table returns (high + gem + mid + low) * (9/8) / 9.
  // Defaults (10 + 3 + 2 + 1) average 2x (200% RTP).
  chestHigh: cfg("chestHigh", 10),
  chestGem: cfg("chestGem", 3),
  chestMid: cfg("chestMid", 2),
  chestLow: cfg("chestLow", 1),
  // roulette table limit: the most you may stake on one spin is
  // rouletteMaxBetBase * level^rouletteMaxBetExp, so your limit widens as you level.
  rouletteMaxBetBase: cfg("rouletteMaxBetBase", 400),
  rouletteMaxBetExp: cfg("rouletteMaxBetExp", 1.35),
  // russian roulette -- see main.pjs for what each of these does
  rrChambers: cfg("rrChambers", 6),
  rrRake: cfg("rrRake", 0),
  // the whole ladder: [[bank multiplier, live rounds], ...] per round, read from
  // the pjs function in main.pjs (revolver.js falls back to the same rows if null)
  rrLadder: cfgLadder("rrLadder"),
};

const SAVE_KEY = "casino-royale.save.v1";
const HISTORY_MAX = 150;
/* bump when the shape of stats.byGame changes, so older saves get rebuilt once */
const BYGAME_MIGRATION = 3;

function newRun() {
  return {
    v: 1,
    money: CONFIG.startingMoney,
    level: 1,
    xp: 0,
    perks: {},
    history: [],
    arcade: { pot: 5 },
    frogger: { bestDepth: 0, bestMult: 1 },
    memory: { bestLen: 0, bestMult: 1 },
    revolver: { bestMult: 1, runs: 0, busts: 0 },
    stats: {
      plays: 0,
      wagered: 0,
      won: 0,
      lost: 0,
      wins: 0,
      losses: 0,
      biggestWin: 0,
      bestMult: 0,
      peak: CONFIG.startingMoney,
      bankruptcies: 0,
      loansTaken: 0,
      loansRepaid: 0,
      loansFailed: 0,
      cheats: 0,
      cheatWinnings: 0,
      runs: 1,
      startedAt: Date.now(),
      byGame: {},
      byGameV: BYGAME_MIGRATION,
    },
    loan: { active: false, principal: 0, repay: 0, takenAt: 0, deadline: 0 },
    idle: { on: false, bet: CONFIG.idleDefaultBet },
    machine: "slots",
    infMoney: false,
    infMoneySaved: 0,
    cheatWin: false,
  };
}

export const state = newRun();

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ---------- persistence ---------- */
let saveTimer = null;
export function saveState(immediate) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const write = () => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 250);
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;
    const fresh = newRun();
    Object.assign(state, fresh, data);
    state.stats = Object.assign({}, fresh.stats, data.stats || {});
    state.loan = Object.assign({}, fresh.loan, data.loan || {});
    state.idle = Object.assign({}, fresh.idle, data.idle || {});
    state.perks = data.perks && typeof data.perks === "object" ? Object.assign({}, data.perks) : {};
    state.history = Array.isArray(data.history) ? data.history.slice(-HISTORY_MAX) : [];
    state.arcade = Object.assign({ pot: 5 }, data.arcade || {});
    state.frogger = Object.assign({ bestDepth: 0, bestMult: 1 }, data.frogger || {});
    state.memory = Object.assign({ bestLen: 0, bestMult: 1 }, data.memory || {});
    state.revolver = Object.assign({ bestMult: 1, runs: 0, busts: 0 }, data.revolver || {});
    if (!state.stats.byGame || typeof state.stats.byGame !== "object") state.stats.byGame = {};
    /* the marker must come from the save itself — newRun()'s default would otherwise
       make every old save look already-migrated */
    if ((Number((data.stats || {}).byGameV) || 0) !== BYGAME_MIGRATION) {
      migrateByGame(true);
      state.stats.byGameV = BYGAME_MIGRATION;
    }
    if (!Number.isFinite(state.money)) state.money = CONFIG.startingMoney;
    state.money = Math.round(state.money);
    state.infMoney = !!state.infMoney;
    state.cheatWin = !!state.cheatWin;
    if (!Number.isFinite(state.infMoneySaved) || state.infMoneySaved < 0) state.infMoneySaved = state.money;
    if (state.infMoney) state.money = Math.round(state.infMoneySaved);
    if (!Number.isFinite(state.arcade.pot) || state.arcade.pot < 1) state.arcade.pot = 5;
    if (!Number.isFinite(state.level) || state.level < 1) state.level = 1;
    if (!Number.isFinite(state.xp) || state.xp < 0) state.xp = 0;
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

/* Older saves only tracked staked/returned per table. Backfill the gross won/lost
   totals and the win/loss tally so the per-table breakdown has every field it needs.
   The retained hand history (last HISTORY_MAX hands) gives exact numbers for tables
   whose whole life fits inside it; for longer-lived tables we scale that sample up to
   the real hand count, and fall back to "the net went entirely one way" if the table
   has no hands left in the history at all. Totals are exact again for every hand
   played after this migration runs. */
function migrateByGame(force) {
  const byGame = state.stats.byGame;
  const hist = Array.isArray(state.history) ? state.history : [];

  /* per-table tallies over the retained history */
  const seen = {};
  for (const e of hist) {
    if (!e || !e.g) continue;
    const t = seen[e.g] || (seen[e.g] = { n: 0, w: 0, l: 0, won: 0, lost: 0 });
    const p = (Number(e.p) || 0) - (Number(e.s) || 0);
    t.n += 1;
    if (p > 0) { t.w += 1; t.won += p; }
    else if (p < 0) { t.l += 1; t.lost += -p; }
  }

  for (const id of Object.keys(byGame)) {
    const g = byGame[id];
    if (!g || typeof g !== "object") { delete byGame[id]; continue; }
    g.plays = Math.max(0, Math.round(Number(g.plays) || 0));
    g.staked = Math.max(0, Math.round(Number(g.staked) || 0));
    g.returned = Math.max(0, Math.round(Number(g.returned) || 0));
    g.best = Math.round(Number(g.best) || 0);

    const hasAll = Number.isFinite(g.wins) && Number.isFinite(g.losses) && Number.isFinite(g.won) && Number.isFinite(g.lost);
    if (!force && hasAll) continue;

    const t = seen[id];
    const net = g.returned - g.staked;
    if (t && t.n >= g.plays && g.plays > 0) {
      /* the history still holds every hand this table ever took — exact */
      g.wins = t.w;
      g.losses = t.l;
      g.won = Math.round(t.won);
      g.lost = Math.round(t.lost);
    } else if (t && t.n > 0 && g.plays > 0) {
      /* sampled win/loss ratio scaled up to every hand, then the gross money split
         around the net (which is exact): losing hands cost about one average stake */
      g.wins = Math.min(g.plays, Math.round(g.plays * (t.w / t.n)));
      g.losses = Math.max(0, Math.min(g.plays - g.wins, Math.round(g.plays * (t.l / t.n))));
      const avgStake = g.staked / g.plays;
      const gross = Math.round(g.losses * avgStake);
      if (net + gross >= 0) {
        g.lost = gross;
        g.won = gross + net;
      } else {
        g.won = Math.max(0, gross + net);
        g.lost = Math.max(0, -net);
      }
    } else {
      /* nothing survived to sample: bill the whole net to one side and call every
         hand a winner or a loser accordingly, so the record at least adds up */
      g.wins = net > 0 ? g.plays : 0;
      g.losses = net < 0 ? g.plays : 0;
      g.won = Math.max(0, net);
      g.lost = Math.max(0, -net);
    }
  }
}

/* ---------- events ---------- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

/* ---------- money ---------- */
export function roundMoney(n) {
  const v = Number(n) || 0;
  return Math.round(v);
}
export function addMoney(n) {
  if (state.infMoney) return state.money;
  const next = Math.round((Number(state.money) || 0) + (Number(n) || 0));
  state.money = next;
  if (state.money > state.stats.peak) state.stats.peak = state.money;
  emit("money", state.money);
  return state.money;
}
export function canAfford(n) {
  if (state.infMoney) return true;
  return state.money >= n - 1e-9;
}

/* ---------- xp / levels ---------- */
// Milestone tiers: XP needed per level is xpBase * L^xpExp, then multiplied by
// xpTierSpike once for every completed block of xpTierSize levels. So levelling is
// gentle inside a tier and then hits a hard wall at the start of the next tier
// (levels 11, 21, 31, ... with the defaults, where the cost doubles), which stops
// progression snowballing off a big bankroll.
export function xpTierFor(level) {
  const size = Math.max(1, Math.round(CONFIG.xpTierSize));
  return Math.floor((Math.max(1, level) - 1) / size);
}
export function xpTierSpikeFor(level) {
  return Math.pow(Math.max(1, CONFIG.xpTierSpike), xpTierFor(level));
}
export function xpNeeded(level) {
  const lv = Math.max(1, level);
  return Math.round(CONFIG.xpBase * Math.pow(lv, CONFIG.xpExp) * xpTierSpikeFor(lv));
}
export function grantXp(amount) {
  if (!(amount > 0)) return [];
  state.xp += amount;
  const gained = [];
  let guard = 0;
  while (state.xp >= xpNeeded(state.level) && guard++ < 500) {
    state.xp -= xpNeeded(state.level);
    state.level += 1;
    const reward = Math.round(CONFIG.levelReward * state.level);
    addMoney(reward);
    gained.push({ level: state.level, reward });
  }
  emit("level", gained);
  return gained;
}
export function xpProgress() {
  const need = xpNeeded(state.level);
  const size = Math.max(1, Math.round(CONFIG.xpTierSize));
  return {
    xp: state.xp,
    need,
    pct: Math.max(0, Math.min(1, state.xp / need)),
    tier: xpTierFor(state.level),
    spike: xpTierSpikeFor(state.level),
    wallNext: state.level % size === 0,
  };
}

/* ---------- loan ---------- */
export function loanPrincipal() {
  return Math.max(1000, Math.round(CONFIG.loanBase + CONFIG.loanPerLevel * (state.level - 1)));
}
export function loanRepay(principal) {
  return Math.round(principal * (1 + CONFIG.loanInterest));
}
export function takeLoan() {
  const principal = loanPrincipal();
  const repay = loanRepay(principal);
  state.loan = {
    active: true,
    principal,
    repay,
    takenAt: Date.now(),
    deadline: Date.now() + CONFIG.loanMinutes * 60 * 1000,
  };
  state.stats.loansTaken++;
  addMoney(principal);
  saveState(true);
  emit("loan");
  return state.loan;
}
export function loanRemainingMs() {
  if (!state.loan.active) return 0;
  return Math.max(0, state.loan.deadline - Date.now());
}
export function loanExpired() {
  return state.loan.active && Date.now() >= state.loan.deadline;
}
export function repayLoan() {
  if (!state.loan.active) return false;
  if (!canAfford(state.loan.repay)) return false;
  addMoney(-state.loan.repay);
  state.stats.loansRepaid++;
  const cleared = { repay: state.loan.repay, principal: state.loan.principal };
  state.loan = { active: false, principal: 0, repay: 0, takenAt: 0, deadline: 0 };
  saveState(true);
  emit("loan", cleared);
  return cleared;
}
export function failLoan() {
  state.stats.loansFailed++;
  state.loan = { active: false, principal: 0, repay: 0, takenAt: 0, deadline: 0 };
  saveState(true);
  emit("loan");
}

/* ---------- run reset ---------- */
export function resetRun() {
  const keepIdleBet = state.idle.bet;
  const keepMachine = state.machine;
  const runs = (state.stats.runs || 1) + 1;
  Object.assign(state, newRun());
  state.stats.runs = runs;
  state.stats.startedAt = Date.now();
  state.idle.bet = keepIdleBet;
  state.machine = keepMachine;
  saveState(true);
  emit("reset");
  emit("money", state.money);
  return state;
}

/* ---------- misc ---------- */
export function recordPlay({ game, stake, payout, multiplier }) {
  const s = Math.round(Number(stake) || 0);
  const p = Math.round(Number(payout) || 0);
  const m = Number(multiplier) || 0;
  state.stats.plays += 1;
  state.stats.wagered += s;
  const profit = p - s;
  if (profit > 0) {
    state.stats.won += profit;
    state.stats.wins = (state.stats.wins || 0) + 1;
    if (profit > state.stats.biggestWin) state.stats.biggestWin = profit;
  } else if (profit < 0) {
    state.stats.lost += -profit;
    state.stats.losses = (state.stats.losses || 0) + 1;
  }
  if (m > state.stats.bestMult) state.stats.bestMult = m;

  if (!state.stats.byGame || typeof state.stats.byGame !== "object") state.stats.byGame = {};
  const id = game || "unknown";
  const g = state.stats.byGame[id] || (state.stats.byGame[id] = { plays: 0, staked: 0, returned: 0, best: 0, won: 0, lost: 0, wins: 0, losses: 0 });
  g.plays += 1;
  g.staked += s;
  g.returned += p;
  if (profit > g.best) g.best = profit;
  /* gross profit won / gross money lost on THIS table (pushes count in neither,
     but they do count as hands played, so the win rate is wins / hands) */
  if (profit > 0) { g.won = (g.won || 0) + profit; g.wins = (g.wins || 0) + 1; }
  else if (profit < 0) { g.lost = (g.lost || 0) - profit; g.losses = (g.losses || 0) + 1; }

  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({ g: id, s, p, m: Math.round(m * 100) / 100, t: Date.now() });
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
}
