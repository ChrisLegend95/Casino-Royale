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
  froggerBlockSec: cfg("froggerBlockSec", 0.34),
  // Frogger's hurry-up (see the header note in src/games/frogger.js). The grass
  // stays perfectly safe -- nothing on it can kill you -- but loitering on it
  // costs you your rung: the first froggerPatienceSec spent standing on a piece
  // of grass is free, and every second after that drains `froggerPatienceDecay`
  // off the banked multiplier, cumulatively for the whole run. It is the
  // non-fatal hurry-up the machine's own notes ask for, and it is what stops
  // "wait out every convoy forever" from being a free money printer.
  froggerPatienceSec: cfg("froggerPatienceSec", 1.0),
  froggerPatienceDecay: cfg("froggerPatienceDecay", 0.95),

  // Save generation -- see the comment on `saveVersion` in main.pjs. A stored save
  // is only accepted when its `v` equals this, so bumping the knob in main.pjs
  // wipes every player's progress (GitHub Pages visitors included) on their next
  // load. `loadFlags.wipedSave` records that it happened, so main.js can say so.
  saveVersion: cfg("saveVersion", 2),

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
  // the maze pot: a clear pays arcadeWinShare of it, it resets to arcadePotBase and
  // climbs arcadePotStep per maze it survives. Tuned so even a perfect player returns
  // under 100% (0.35 * 2.8 = 0.98) while the reference bot's return is unchanged.
  arcadeWinShare: cfg("arcadeWinShare", 0.35),
  arcadePotBase: cfg("arcadePotBase", 2.8),
  arcadePotStep: cfg("arcadePotStep", 2.1),
  arcadePotCap: cfg("arcadePotCap", 14),
  // colour-memory ("Neon Recall") tunables -- see main.pjs for what they do
  memStartLen: cfg("memStartLen", 3),
  memLevels: cfg("memLevels", 19),
  memMaxLen: cfg("memMaxLen", 20),
  // the fitted ladder: a rung pays memLadderRtp / the reference player's chance of
  // clearing that many colours (perfect to memSkillKnee, then memSkillDecay per
  // colour). memLadderCap is the machine's own ceiling.
  memSkillKnee: cfg("memSkillKnee", 5),
  memLadderRtp: cfg("memLadderRtp", 0.95),
  memSkillDecay: cfg("memSkillDecay", 0.93),
  memLadderCap: cfg("memLadderCap", 8),
  // the machine's table maximum (it overrides the house level limit): see main.js
  memTableBase: cfg("memTableBase", 100),
  memTableMax: cfg("memTableMax", 2000),
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
  levelReward: cfg("levelReward", 5),
  // ---- balance book (see main.pjs) ----
  // Luck is a per-round odds nudge, hard-capped at luckCap and tuned per machine
  // so no game is ever pushed past 100% by it. Fat Stacks and Safety Net pay on
  // the STAKE: Fat Stacks up to +25% of the stake on a win (50 stacks), Safety Net
  // up to +10% back on a loss (20 stacks). Fortune is the endless one and pays on
  // the PROFIT instead (+0.1% of a win per stack), so it does scale with a big
  // multiplier -- see the balance book in main.pjs.
  levelLuck: cfg("levelLuck", 0.0006),
  luckCoin: cfg("luckCoin", 0.005),
  luckCap: cfg("luckCap", 0.08),
  winBonusStack: cfg("winBonusStack", 0.005),
  rebateStack: cfg("rebateStack", 0.005),
  profitStack: cfg("profitStack", 0.001),
  // THE PIT'S RAKE-BACK BUDGET (see the balance book in main.pjs). This is the
  // cap on what the STAKE-bounded perks -- Fat Stacks plus Safety Net -- may
  // hand back on one round, as a fraction of the stake, and it is deliberately
  // smaller than the thinnest house edge in the building (roulette's 2.7%). It
  // is what stops a perk build from turning any table into a printer: a player
  // may claw back a slice of the house's edge, never all of it. It is applied
  // in applyPerks() (main.js). It does NOT bound the endless Fortune perk,
  // which pays on the PROFIT instead and is priced as the long-run power curve,
  // nor the level comp (bounded separately -- see grantXp below).
  perkBudget: cfg("perkBudget", 0.015),
  // Gambler: the house TABLE LIMIT multiplier per stack (+0.5 = +50% a stack).
  // It moves a LIMIT, never a payout, and a machine's own maxBet() still wins --
  // see tableLimit() in main.js.
  gamblerStack: cfg("gamblerStack", 0.5),
  // On the House: the chance per stack that a losing round is comped in full (a
  // push, bounded by the loss itself -- see playRound in main.js). Deliberately
  // small: the comp hands back a WHOLE stake on the round it fires, so its
  // expected contribution is this chance times P(lose), and that number has to
  // fit inside the rake-back budget above. Five stacks is a 1% chance -- about
  // half a point of return on a coin-flip table.
  compStack: cfg("compStack", 0.002),
  // Pit Boss's Nephew: the loan principal's bonus multiplier per stack (+0.5 =
  // x1.5 at one stack). The repayment is derived from the principal as always,
  // so a bigger loan is a bigger debt -- see loanPrincipal() below.
  nephewStack: cfg("nephewStack", 0.5),
  tableLimitBase: cfg("tableLimitBase", 400),
  tableLimitExp: cfg("tableLimitExp", 1.35),
  maxWinMult: cfg("maxWinMult", 1000),
  // Cloud saves (optional Google sign-in, see cloudsave.js). On by default so the
  // GitHub Pages build gets the button; main.pjs sets it to 0 for the Perchance
  // build (its iframe origin needs its own OAuth entry) -- flip that knob to 1 to
  // turn it on there too. With no client ID configured the button explains the
  // 5-minute setup instead of signing anyone in.
  cloudSaves: cfg("cloudSaves", 1),
  // treasure chest payouts (four of the nine chests pay -- one chest each --
  // one chest is a Lucky Star that grants a free re-pick, and the other four
  // are traps; see the comment in src/games/chest.js).
  // The star's re-pick averages a random chest, so the table returns
  // (high + gem + mid + low) / 8. Defaults (4 + 2 + 1 + 0.5) return 93.75%,
  // a real house edge. The four prizes MUST sum to less than eight or this
  // machine is a money printer.
  chestHigh: cfg("chestHigh", 4),
  chestGem: cfg("chestGem", 2),
  chestMid: cfg("chestMid", 1),
  chestLow: cfg("chestLow", 0.5),
  // texas hold'em -- see main.pjs for what each of these does. The House sells
  // you a seat (a flat seat charge on the buy-in) instead of taking a rake, which
  // makes the table exactly symmetric: a seat that pays the charge and plays like
  // the other seats returns 1 - holdemFee. See the machine note in DEV-NOTES.md.
  holdemFee: cfg("holdemFee", 0.03),
  // big blinds per stack. Scales with the stake, so the game is the same shape at
  // every bet; a short stack wins more hands but has less room to play.
  holdemDepth: cfg("holdemDepth", 25),
  // how many bots sit down against you (the machine has its own 1/2/3 picker too)
  holdemBots: cfg("holdemBots", 3),
  // Luck buys a discount on YOUR OWN seat charge -- never a rigged deal, which is
  // the one thing a poker table must not do. 0.5 = up to half off at the luck cap.
  // It is deliberately not larger: the cage's whole-dollar payout rounding is worth
  // up to +0.9% of the stake at a tiny buy-in, and the luck discount has to leave
  // the luck-capped return comfortably under 100%. See DEV-NOTES.md.
  holdemLuckFee: cfg("holdemLuckFee", 0.5),
  // the table minimum. The felt runs on cents (blinds, fractional pots) but the cage
  // pays whole dollars, and that rounding is worth up to ~0.9% of the stake at a $25
  // buy-in -- more than the whole seat charge at the luck cap. From $50 up it is
  // inside +/-0.2%, so the table opens there and the rounding can never out-earn the
  // charge. (The machine pays the EXACT stack ratio to main.js, so the whole-dollar
  // rounding is the only rounding in the payout.)
  holdemMinBet: cfg("holdemMinBet", 50),
  // russian roulette -- see main.pjs for what each of these does
  rrChambers: cfg("rrChambers", 6),
  rrRake: cfg("rrRake", 0),  // the whole ladder: [[bank multiplier, live rounds], ...] per round, read from
  // the pjs function in main.pjs (revolver.js falls back to the same rows if null)
  rrLadder: cfgLadder("rrLadder"),
  // Wheelhouse ("slots-wheel") -- the five bonus-wheel multipliers, in the order
  // they sit on the disc (see src/games/slots-wheel-math.js). Every segment is
  // equally likely and each pays that multiple of the TOTAL stake, so the wheel
  // is worth their MEAN per trigger: 11.6 with these defaults. Three or more
  // wheel scatters ANYWHERE on the grid bring the wheel in -- about 1 spin in 143
  // -- so the wheel is worth roughly 8% of the machine's return and each of these
  // is a direct multiplier on it. See the balance book in main.pjs before
  // touching them. Keep them ascending: the disc is drawn in this order and the
  // landed label is the one that reads upright.
  wheelMult1: cfg("wheelMult1", 3),
  wheelMult2: cfg("wheelMult2", 5),
  wheelMult3: cfg("wheelMult3", 10),
  wheelMult4: cfg("wheelMult4", 15),
  wheelMult5: cfg("wheelMult5", 25),

  // ---- the slot jackpots (one bank per 5-reel cabinet) ----
  // THE TWO 5-REEL MACHINES EACH KEEP THEIR OWN PROGRESSIVE. A losing spin on a
  // cabinet puts `jackpotRate` of the amount it LOST -- not of the whole stake
  // -- aside for THAT CABINET'S pot -- Fortune Lines feeds Fortune Lines,
  // Wheelhouse feeds Wheelhouse -- and a sign can only ever empty the bank of
  // the machine it landed on. The house keeps `jackpotHouseCut` of each slice
  // and the rest climbs that cabinet's meter, so with the defaults (5%, half) a
  // meter gains 0.025 of every loss. A spin that pays the player back AT LEAST
  // their stake -- a win, or a push that returns the stake exactly -- pays no
  // slice at all (main.js decides that after the round resolves, on a strict
  // `payout < stake` test), so a bank is fed only by rounds the player actually
  // lost money on AT THAT CABINET. A bank is emptied by three JACKPOT symbols
  // anywhere on THAT machine's drums (about 1 in 4,100 on Fortune Lines and
  // 1 in 4,500 on Wheelhouse -- see the balance book in main.pjs and the
  // jackpot section of DEV-NOTES.md).
  //
  // THE FEED IS A TRANSFER, NOT AN EDGE, AND IT IS SIZED TO KEEP THE MACHINE
  // UNDER 100%. Nothing is charged to the player -- the payout is untouched and
  // the slice comes out of the loss the house already holds -- so the only term
  // that moves the player's long-run return is the part that reaches the POT.
  // With the defaults that is 0.025 of the loss: 1.88 points on Fortune Lines
  // and 1.64 on Wheelhouse, measured over the machines' own spin distribution.
  // The figures the two cabinets advertise (93.65% / 96.38% cold) are therefore
  // their own model figures (91.77% / 94.74%) PLUS the pot, which is the honest
  // long-run return of a cabinet whose meters are eventually always collected;
  // a player who never sees a pot realizes exactly the model figure. The house's
  // realized hold is correspondingly its model edge MINUS the pot -- 6.35 points
  // on Fortune Lines, 3.62 on Wheelhouse. If the feed is ever raised, the pot's
  // share must stay under the thinner of those edges: at the old 0.30 x 0.8 the
  // pot was worth 18 points against an 8.2-point edge, which is how both
  // cabinets came to advertise under 100% while actually paying over 110%.
  //
  // LUCKY SEVENS HAS NO POT AT ALL -- the player's call: the 3-reel machine is
  // the plain one. No sign, no meter, no slice taken off any spin, and the whole
  // of its edge is its paytable (95.679% cold / 96.687% at the luck cap; six
  // symbols, every one of them paying -- the dead stop it used to carry came off
  // the drum at the player's request and the ladder came down with it). It is
  // not in JACKPOT_GAMES below, which is what makes `isJackpotGame("slots")`
  // false, so `playRound` can never feed it and no bank can be conjured for it;
  // its old bank is paid back to the player on load (see hydrateState).
  jackpotRate: cfg("jackpotRate", 0.05),
  jackpotHouseCut: cfg("jackpotHouseCut", 0.5),
};

/* The cabinets that carry a progressive meter. They are also the only machines
   whose spins feed, and can take, a bank -- a jackpot sign only ever appears on
   these drums, so nothing else in the pit has a pot to charge. Lucky Sevens is
   deliberately NOT here: it has no jackpot at all (see the block above). */
export const JACKPOT_GAMES = ["slots-multi", "slots-wheel"];
export function isJackpotGame(id) { return JACKPOT_GAMES.indexOf(id) !== -1; }
function emptyBank() { return { amount: 0, fed: 0, best: 0, hits: 0 }; }
function newJackpotBanks() {
  const out = {};
  for (const id of JACKPOT_GAMES) out[id] = emptyBank();
  return out;
}

const SAVE_KEY = "casino-royale.save.v1";
const HISTORY_MAX = 150;
/* bump when the shape of stats.byGame changes, so older saves get rebuilt once */
const BYGAME_MIGRATION = 3;

function newRun() {
  return {
    v: CONFIG.saveVersion,
    money: CONFIG.startingMoney,
    level: 1,
    xp: 0,
    perks: {},
    history: [],
    arcade: { pot: 5 },
    frogger: { bestDepth: 0, bestMult: 1 },
    memory: { bestLen: 0, bestMult: 1 },
    revolver: { bestMult: 1, runs: 0, busts: 0 },
    holdem: { bots: CONFIG.holdemBots, bestMult: 1, bestPot: 0, helper: false },
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
    /* one progressive bank PER 5-REEL CABINET (see the jackpot block below).
       Fortune Lines and Wheelhouse each feed and empty their OWN pot, so a sign
       on one can never take a bank the other paid for. Per bank: `amount` is the
       pot on that cabinet's meter, `fed` is everything the player has ever put
       into THAT bank, `best` is the biggest pot it has ever taken, `hits` how
       many times it has landed. Lucky Sevens has no bank at all; a save that
       still carries one has it paid to the player (see hydrateState). */
    jackpots: newJackpotBanks(),
    infMoney: false,
    infMoneySaved: 0,
    cheatWin: false,
    /* when this run was last written to storage -- cloud saves use it to decide
       which side of a two-device conflict is the newer save */
    savedAt: Date.now(),
  };
}

export const state = newRun();

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ---------- persistence ---------- */
const SAVE_DEBOUNCE_MS = 250;
let saveTimer = null;
export function saveState(immediate, opts) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  /* `keepStamp` is for adopting a save from somewhere else (cloud / save file):
     the incoming `savedAt` is kept so the two copies stay comparable, instead of
     being re-stamped "now" and looking newer than the copy they came from. */
  const keepStamp = !!(opts && opts.keepStamp);
  const write = () => {
    if (!keepStamp) state.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    /* the cloud sync (cloudsave.js) listens for this instead of polling */
    emit("saved", state.savedAt);
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, SAVE_DEBOUNCE_MS);
}
export const SAVE_DEBOUNCE = SAVE_DEBOUNCE_MS;

/* How the last loadState() went. `wipedSave` means the save it found was written by
   a different save generation (see CONFIG.saveVersion) and was thrown away -- the
   boot code uses it to tell the player their run was reset by the update. */
export const loadFlags = { wipedSave: false, paidSlotsPot: 0 };

/* Merge a parsed save object into the live state, shape-normalising every field on
   the way. loadState() calls this after its generation check; the cloud loader
   calls it (through applySaveObject) for a downloaded save, so both paths agree on
   what a valid save is. Assumes `data` already passed the version + shape checks. */
function hydrateState(data) {
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
  state.holdem = Object.assign({ bots: CONFIG.holdemBots, bestMult: 1, bestPot: 0, helper: false }, data.holdem || {});
  if (!Number.isFinite(state.holdem.bots) || state.holdem.bots < 1) state.holdem.bots = 1;
  if (state.holdem.bots > 3) state.holdem.bots = 3;
  /* the helper chip is a coaching aid, so it ships OFF and only a save that
     says otherwise turns it on (a save from before the toggle is off) */
  state.holdem.helper = state.holdem.helper === true;
  /* the jackpot banks are running totals, so a save that predates them (or a
     hand-edited one) must come back as sane numbers, never a NaN on a meter.
     Every cabinet that still carries a pot is copied through as it stands. Two
     things a save can carry that are no longer collected are REFUNDED rather
     than dropped, because a bank is only ever the players' own money (it was fed
     by their losing spins): Lucky Sevens' bank, now the machine has no pot, and
     the even older single shared `jackpot` object when the player was standing
     at a machine that has no meter at all. The refund is paid into the balance
     once, and `loadFlags.paidSlotsPot` carries the figure up to the boot code
     for a toast. It cannot pay twice: the state written back has no slots bank
     in it, so the next load finds nothing to refund. */
  let jackpotRefund = 0;
  const refundBank = (bank) => {
    if (!bank || typeof bank !== "object") return;
    const amount = Number(bank.amount);
    if (Number.isFinite(amount) && amount > 0) jackpotRefund += amount;
  };
  state.jackpots = newJackpotBanks();
  const savedBanks = data.jackpots && typeof data.jackpots === "object" ? data.jackpots : null;
  if (savedBanks) {
    for (const id of JACKPOT_GAMES) {
      const b = savedBanks[id];
      if (b && typeof b === "object") state.jackpots[id] = Object.assign(emptyBank(), b);
    }
    refundBank(savedBanks.slots);
  } else if (data.jackpot && typeof data.jackpot === "object") {
    if (isJackpotGame(data.machine)) {
      state.jackpots[data.machine] = Object.assign(emptyBank(), data.jackpot);
    } else {
      refundBank(data.jackpot);
    }
  }
  delete state.jackpot;
  for (const id of JACKPOT_GAMES) {
    const j = state.jackpots[id];
    for (const k of ["amount", "fed", "best", "hits"]) {
      const v = Number(j[k]);
      j[k] = Number.isFinite(v) && v > 0 ? v : 0;
    }
    j.amount = round2(j.amount);
  }
  if (!state.stats.byGame || typeof state.stats.byGame !== "object") state.stats.byGame = {};
  /* the marker must come from the save itself -- newRun()'s default would otherwise
     make every old save look already-migrated */
  if ((Number((data.stats || {}).byGameV) || 0) !== BYGAME_MIGRATION) {
    migrateByGame(true);
    state.stats.byGameV = BYGAME_MIGRATION;
  }
  if (!Number.isFinite(state.money)) state.money = CONFIG.startingMoney;
  state.money = Math.round(state.money);
  /* a pot that is no longer collected (see the bank block above) goes back into
     the balance, rounded along with the money it joins; the boot code reads the
     figure off loadFlags and tells the player where it came from */
  if (jackpotRefund > 0) {
    loadFlags.paidSlotsPot = round2(jackpotRefund);
    state.money = Math.round(state.money + jackpotRefund);
  }
  state.infMoney = !!state.infMoney;
  state.cheatWin = !!state.cheatWin;
  if (!Number.isFinite(state.infMoneySaved) || state.infMoneySaved < 0) state.infMoneySaved = state.money;
  if (state.infMoney) state.money = Math.round(state.infMoneySaved);
  if (!Number.isFinite(state.arcade.pot) || state.arcade.pot < 1) state.arcade.pot = 5;
  if (!Number.isFinite(state.level) || state.level < 1) state.level = 1;
  if (!Number.isFinite(state.xp) || state.xp < 0) state.xp = 0;
  if (!Number.isFinite(state.savedAt) || state.savedAt <= 0) state.savedAt = Date.now();
  return true;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;
    /* The save generation check comes FIRST, before anything is merged: a save from
       another build is discarded instead of migrated, which is what makes bumping
       `saveVersion` (main.pjs) a global reset for every player. */
    if ((Number(data.v) || 0) !== CONFIG.saveVersion) {
      loadFlags.wipedSave = true;
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
      return false;
    }
    hydrateState(data);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- cloud saves (cloudsave.js) ---------- *
   The sync layer needs three things from here: a plain snapshot of the live run to
   upload, the same snapshot reduced to the numbers a conflict dialog shows, and a
   validated way to put somebody else's snapshot back into the live state. Nothing
   in this block touches the network. */

/* A deep copy of the current run, safe to JSON.stringify and hand around. */
export function saveSnapshot() {
  if (!Number.isFinite(state.savedAt) || state.savedAt <= 0) state.savedAt = Date.now();
  return JSON.parse(JSON.stringify(state));
}

/* The quick facts about any saved run, local or cloud, for "you have $X at level Y"
   comparisons. Tolerates junk input (that is the point: it runs on cloud files). */
export function snapshotSummary(save) {
  const s = save && typeof save === "object" ? save : {};
  const st = s.stats && typeof s.stats === "object" ? s.stats : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    money: Math.round(num(s.money, 0)),
    level: Math.max(1, Math.round(num(s.level, 1))),
    plays: Math.max(0, Math.round(num(st.plays, 0))),
    runs: Math.max(1, Math.round(num(st.runs, 1))),
    peak: Math.round(num(st.peak, 0)),
    bestWin: Math.round(num(st.biggestWin, 0)),
    cheats: Math.max(0, Math.round(num(st.cheats, 0))),
    startedAt: num(st.startedAt, 0),
    savedAt: num(s.savedAt, 0),
  };
}

/* Is this snapshot still an untouched run? A brand-new device writes one of these
   the moment the page loads, so the cloud logic must never let it silently
   overwrite a real save from another machine -- it always asks instead. */
export function isFreshSnapshot(save) {
  const s = snapshotSummary(save);
  return s.money <= CONFIG.startingMoney && s.level <= 1 && s.plays === 0 && s.runs <= 1 && s.peak <= CONFIG.startingMoney;
}

/* Put a save object (already parsed) into the live state. Refuses -- without
   touching anything -- anything that is not this save generation, or that has no
   usable money field, so a stale or hand-mangled cloud file can never destroy the
   run the player is holding. Returns {ok:true, summary} or {ok:false, reason}. */
export function applySaveObject(data, opts) {
  if (!data || typeof data !== "object") return { ok: false, reason: "shape" };
  if ((Number(data.v) || 0) !== CONFIG.saveVersion) return { ok: false, reason: "version" };
  if (!Number.isFinite(Number(data.money))) return { ok: false, reason: "shape" };
  hydrateState(data);
  saveState(true, { keepStamp: !!(opts && opts.keepStamp) });
  emit("loaded");
  emit("money", state.money);
  return { ok: true, summary: snapshotSummary(state) };
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

/* ---------- the slot jackpots (one bank per 5-reel cabinet) ----------
   THE TWO 5-REEL MACHINES EACH HAVE THEIR OWN PROGRESSIVE. (Lucky Sevens has
   none: not in JACKPOT_GAMES, so `isJackpotGame` is false for it and main.js
   never feeds it -- see the block at the tunables.) A bank is funded by the
   players' own stakes on THAT CABINET -- but only by the money they actually
   LOSE there, never by the stake itself. Every spin whose payout comes back
   UNDER the stake puts CONFIG.jackpotRate (30%) of that LOSS aside (main.js
   decides that, after the round resolves, on the actual shortfall -- a winning
   spin is never taxed, and neither is a push, which hands the stake straight
   back), the house keeps CONFIG.jackpotHouseCut of the slice, and the
   remainder goes on that cabinet's meter. Nothing is conjured: a pot is a slice
   of money that has already been lost AT THAT MACHINE, so paying it out returns
   most of what the machine took. (The house cut is what the HOUSE keeps of the
   feed; the other half is handed back to whoever wins the pot, so a pot
   machine's long-run return is its model figure PLUS 0.025 x the loss it takes
   -- 1.88 points on Fortune Lines, 1.64 on Wheelhouse, which is where the
   93.65% and 96.38% the two cabinets advertise come from. THAT is the number
   that has to stay under 100%, and it is sized to: the pot's share is smaller
   than the machine's own edge, so the house's realized hold is its edge minus
   the pot and can never go negative. Charging the LOSS rather than the stake is
   half the reason the arithmetic closes -- with the feed on a flat 30% of the
   STAKE and 80% of it to the pot, the pot handed back about 18 points of a
   machine whose edge is 8.2, which is a money printer for anyone patient enough
   to collect it. The balance book in main.pjs and the jackpot section of
   DEV-NOTES carry the working.) That is also why a bank needs no cap and no
   seed: it can never pay more than was put into it. Keeping
   one bank per cabinet means one machine's losers never fund another machine's
   winner.

   Each machine's maths arms its own trigger: three or more JACKPOT symbols
   anywhere on ITS drums (evaluateGrid in slots-wheel-math.js and
   slots-multi-math.js). A wild never stands in for one, and the symbol itself
   pays nothing -- it is a scatter in the same family as the wagon wheel.

   The banks live in the run (and therefore in the save and in cloud saves), so
   each of a regular's meters keeps climbing between sessions. */

/* the bank a call belongs to. Anything that is not one of the two pot cabinets
   (or a call with no id at all) falls back to the cabinet the player is
   standing at, then to Fortune Lines, so a bad caller can never invent a
   phantom bank or write a pot onto `undefined` -- and, in particular, a stray
   call on Lucky Sevens' behalf can never quietly charge the player for a pot
   that machine does not carry. */
function jackpotBankId(gameId) {
  if (isJackpotGame(gameId)) return gameId;
  if (isJackpotGame(state.machine)) return state.machine;
  return JACKPOT_GAMES[0];
}
function jackpotBank(gameId) {
  if (!state.jackpots || typeof state.jackpots !== "object") state.jackpots = newJackpotBanks();
  const id = jackpotBankId(gameId);
  let bank = state.jackpots[id];
  if (!bank || typeof bank !== "object") { bank = emptyBank(); state.jackpots[id] = bank; }
  return bank;
}

/* `loss` is the amount the round FAILED to return -- main.js passes
   `roundStake - payout` on a strict `payout < stake` test, never the whole
   stake. See the tunables above for why the feed is charged on the loss. */
export function jackpotFeed(loss, gameId) {
  const rate = Math.max(0, Number(CONFIG.jackpotRate) || 0);
  const feed = round2((Number(loss) || 0) * rate);
  if (!(feed > 0)) return 0;
  const cut = Math.min(1, Math.max(0, Number(CONFIG.jackpotHouseCut) || 0));
  const pot = round2(feed * (1 - cut));
  const j = jackpotBank(gameId);
  j.amount = round2(j.amount + pot);
  j.fed = round2(j.fed + feed);
  emit("jackpot", { game: jackpotBankId(gameId), amount: j.amount });
  return pot;
}

/* take the whole pot (three jackpots landed on that machine). Empties that
   cabinet's meter and returns the money for the caller to bank; the caller owns
   the books and the celebration, exactly as it does for a machine's own
   payout. The other two banks are untouched. */
export function jackpotTake(gameId) {
  const j = jackpotBank(gameId);
  const pot = Math.max(0, Math.round(j.amount));
  j.amount = 0;
  if (pot > j.best) j.best = pot;
  j.hits += 1;
  emit("jackpot", { game: jackpotBankId(gameId), amount: 0 });
  return pot;
}

export function jackpotPot(gameId) {
  return Math.max(0, jackpotBank(gameId).amount);
}

/* the whole bank for a cabinet, for readouts that want more than the pot (the
   info cards show what a machine has fed and taken). Returns a copy, so a
   caller can never scribble on live state. */
export function jackpotBankView(gameId) {
  return Object.assign(emptyBank(), jackpotBank(gameId));
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
/* `rewardScale` is 1 for ordinary hand-played rounds; it is 1/(xp multiplier)
   when the XP on the round was boosted (Scholarship stacks, IDLE). The level
   reward is a COMP ON MONEY RISKED -- it has to stay smaller than every
   machine's edge (see the balance book in main.pjs) -- so the XP perks and IDLE
   buy faster LEVELS, never a bigger comp per dollar staked. Without this, a
   maxed Scholar idling a thin-edge table would earn a comp larger than that
   table's edge and the comp itself would become the printer. */
export function grantXp(amount, rewardScale = 1) {
  if (!(amount > 0)) return [];
  state.xp += amount;
  const gained = [];
  const scale = Number.isFinite(rewardScale) && rewardScale > 0 ? rewardScale : 1;
  let guard = 0;
  while (state.xp >= xpNeeded(state.level) && guard++ < 500) {
    state.xp -= xpNeeded(state.level);
    state.level += 1;
    const reward = Math.round(CONFIG.levelReward * state.level * scale);
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
/* `boost` is the Pit Boss's Nephew multiplier (0 by default, +0.5 per stack): it
   stretches the PRINCIPAL, and the repayment is derived from that principal with
   the same interest, so a bigger loan is a bigger debt. Nothing else about the
   loan moves -- the clock, the interest rate and the default rule are unchanged,
   which is what keeps a perk that hands out more rope from also loosening the
   knot. */
export function loanPrincipal(boost = 0) {
  const mult = 1 + Math.max(0, Number(boost) || 0);
  return Math.max(1000, Math.round((CONFIG.loanBase + CONFIG.loanPerLevel * (state.level - 1)) * mult));
}
export function loanRepay(principal) {
  return Math.round(principal * (1 + CONFIG.loanInterest));
}
export function takeLoan(boost = 0) {
  const principal = loanPrincipal(boost);
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
