import {
  CONFIG, state, loadState, saveState, resetRun, addMoney, canAfford, round2, roundMoney,
  grantXp, xpProgress, xpNeeded, recordPlay, takeLoan, repayLoan, failLoan,
  loanExpired, loanRemainingMs, loanPrincipal, loanRepay, on, emit, clearSave, loadFlags,
  jackpotFeed, jackpotTake, isJackpotGame,
} from "./state.js";
import { PERKS, PERK_ORDER, perkCost, stacksOf, isMaxed, buyPerk, computeEffects, perkShopCount, maxOutFinitePerks } from "./perks.js";
import {
  el, clear, fmt, fmtShort, mult, pct, toast, modal, confirmDialog, confetti,
  floatText, floatAtElement, animateNumber, flavor, clamp,
  closeAllModals, winPopup, privacyUrl,
} from "./ui.js";
import { GAMES, gameById } from "./games/index.js";
import { sfx, installGlobalSounds, isEnabled, setEnabled as setSoundEnabled, toggle as toggleSound } from "./audio.js";
import { installMusicGesture, isMusicEnabled, toggleMusic } from "./music.js";
import { initCloud, cloud } from "./cloudsave.js";

/* =========================================================
   boot
   ========================================================= */
const hadSave = loadState();
if (state.bet === undefined) state.bet = 10;
if (!Number.isFinite(state.idle.bet) || state.idle.bet < 1) state.idle.bet = CONFIG.idleDefaultBet;
if (!state.idle.bet) state.idle.bet = CONFIG.idleDefaultBet;
if (hadSave) saveState(true);
/* A save from an older save generation is dropped on load (see `saveVersion` in
   main.pjs / state.js) -- say so, so the player isn't left wondering where their run
   went. Deferred a moment so it lands after the first render, not underneath it. */
if (loadFlags.wipedSave) {
  setTimeout(() => toast("Updated! Your old save was reset \u2014 new run, " + fmt(CONFIG.startingMoney) + " to start.", "gold", 5600), 700);
}
/* The 3-reel machine lost its progressive (and took no slice off any spin), so a
   bank it was still holding when this version arrived is the player's own money
   sitting in a pot that no longer exists. state.js pays it into the balance on
   load and reports it here, so the windfall is explained rather than mysterious. */
if (loadFlags.paidSlotsPot > 0) {
  const paid = loadFlags.paidSlotsPot;
  setTimeout(() => toast("Lucky Sevens has no jackpot any more \u2014 its pot (" + fmt(paid) + ") has been paid into your balance.", "gold", 6400), 760);
}

const topbar = {
  money: document.getElementById("moneyEl"),
  level: document.getElementById("levelEl"),
  xpFill: document.getElementById("xpFillEl"),
  xpText: document.getElementById("xpTextEl"),
  tierTag: document.getElementById("tierEl"),
  luck: document.getElementById("luckEl"),
  bestWin: document.getElementById("bestWinEl"),
  idleBtn: document.getElementById("idleToggleBtn"),
  idleBet: document.getElementById("idleBetInput"),
  shopBtn: document.getElementById("perkShopBtn"),
  loanBtn: document.getElementById("loanBtn"),
  historyBtn: document.getElementById("historyBtn"),
  bankruptBtn: document.getElementById("bankruptBtn"),
  badge: document.getElementById("perkBadge"),
  loanBar: document.getElementById("loanBar"),
  loanText: document.getElementById("loanText"),
  loanClock: document.getElementById("loanClock"),
  loanFill: document.getElementById("loanFill"),
  loanRepayBtn: document.getElementById("loanRepayBtn"),
  stage: document.getElementById("stage"),
  nav: document.getElementById("machineNav"),
  betPanel: document.getElementById("betPanel"),
};

let game = gameById(state.machine);
let inst = null;
let playing = false;
let roundStake = 0;
let idleTimer = null;
let tickTimer = null;
let moneyShown = state.money;
let endModalOpen = false;

/* =========================================================
   game controller api handed to each game module
   ========================================================= */
const app = {
  effects: () => computeEffects(),
  get cheat() { return !!state.cheatWin; },
  get money() { return state.money; },
  get bet() { return currentBet(); },
  /* the live house economy, so a machine can quote the same numbers the bet
     panel does without re-deriving them (the level drives the limit) */
  tableLimit: () => tableLimit(),
  houseMaxMult: () => CONFIG.maxWinMult,
  canAfford,
  spend(n) {
    if (n > 0 && canAfford(n)) {
      addMoney(-n);
      roundStake += n;
      renderTop();
      return true;
    }
    return false;
  },
  toast,
  confetti,
  floatAtElement,
  fmt,
  refreshBet() { if (betInput) setBet(currentBet()); },
  /* a machine's own "play again" button can start a fresh round on the same
     table without the player hunting for the side panel's PLAY button */
  playAgain() { return playRound(false); },
};

/* =========================================================
   line betting (multi-line machines charge bet x lines)
   ========================================================= */
function betUnits() {
  if (inst && typeof inst.getBetUnits === "function") {
    const n = Math.floor(Number(inst.getBetUnits()));
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 1;
}

function lineBetCost(stake) {
  return round2(stake * betUnits());
}

/* The house table limit: the most you may stake on one round of ANY machine.
   It grows with your level; a machine may still override it with its own
   maxBet(), but nothing ships without a limit any more.
   The limit caps a round's LOSS as much as its win, so one bad hand can never
   take the whole bankroll. */
function tableLimit() {
  let lim = CONFIG.tableLimitBase * Math.pow(Math.max(1, state.level), CONFIG.tableLimitExp);
  /* The Gambler's levers: the perk lifts the HOUSE limit only. It is a limit,
     never an edge -- no return, no advertised top and no payout moves with it --
     and a machine with a table maximum of its OWN (Neon Recall's memory ladder)
     still overrides it below, because that ceiling is load-bearing for that
     machine's balance. */
  lim *= Math.max(1, computeEffects().tableMult);
  if (typeof game.maxBet === "function") {
    const v = Number(game.maxBet(state.level));
    if (Number.isFinite(v) && v > 0) lim = v;
  }
  if (!Number.isFinite(lim) || lim <= 0) return Infinity;
  return Math.max(1, Math.floor(lim));
}

function betCap() {
  const units = Math.max(1, betUnits());
  const lim = tableLimit();
  if (state.infMoney) return Math.max(1, Math.floor((Number.isFinite(lim) ? lim : 1e9) / units));
  return Math.floor(Math.min(state.money, lim) / units);
}

/* =========================================================
   perks / economics
   ========================================================= */
/* plain-text balance for labels: the infinity glyph when the money cheat is on */
function moneyLabel() {
  return state.infMoney ? "\u221E" : fmt(state.money);
}

/* The Pit Boss's Nephew's stretch on the credit line: 0 stacks = 1, +0.5 a stack.
   Only the PRINCIPAL is stretched -- the interest rate and the clock are not --
   so a bigger loan is a bigger debt, which is the whole joke of the perk. */
function loanBoost() {
  return Math.max(0, computeEffects().loanMult);
}

/* Perks pay a small bonus on top of whatever the game returned, and the whole
   of the STAKE-bounded side of them (Fat Stacks on a win, Safety Net on a loss)
   is capped by the pit's rake-back budget, CONFIG.perkBudget. Two rules, both
   load-bearing:

   1. A stake bonus can never pay more than the round itself made or lost.
      Fat Stacks is a slice of the stake, but it is min()'d against the PROFIT
      first, so a bet that wins by a hair cannot be magnified into a fortune:
      "win 1% of the stake, collect 25% of it back" was a printer at any target
      where the win is small (Rocket Crash at x1.01 was the worst of them).
      Safety Net is min()'d against the loss for the same reason -- a machine
      that can lose only part of the stake (Texas Hold'em returns your stack, so
      a hand can come back at x0.96) must never pay back more than was dropped.
   2. The two together are then clamped to CONFIG.perkBudget x the stake -- the
      most the pit hands back on one round. That number is deliberately under
      the thinnest house edge in the building (roulette's 2.7%), so no stack of
      perks can ever turn a table into a money printer: the player can claw back
      a slice of the house's edge, never all of it.

   Fortune is the exception and is deliberately different -- profitBonus is a
   flat percentage of the PROFIT, applied OUTSIDE the budget, so a big
   multiplier does scale it. That is the intended long-run power curve (the one
   route by which a fully grown regular can get ahead of the house), and it can
   never invent money on a round that did not win: a loss and a push are
   untouched. It is also priced out of reach on purpose -- the cost climbs 35% a
   stack while the pay does not, so it never pays for itself.

   `usePerks` is false at tables that opt out -- the House's blackjack, where the
   edge is already razor thin. */
function applyPerks(stake, rawMult, eff, usePerks = true) {
  const base = stake * rawMult;
  const profit = base - stake;
  if (!usePerks) return { payout: roundMoney(base), profit: roundMoney(profit) };
  const budget = Math.max(0, stake * CONFIG.perkBudget);
  if (profit > 0) {
    const flat = Math.min(Math.min(stake * eff.winBonus, profit), budget);
    const bonus = flat + profit * eff.profitBonus;
    return { payout: roundMoney(base + bonus), profit: roundMoney(profit + bonus) };
  }
  if (profit < 0) {
    const refund = Math.min(Math.min(stake * eff.rebate, -profit), budget);
    return { payout: roundMoney(base + refund), profit: roundMoney(profit + refund) };
  }
  return { payout: roundMoney(base), profit: 0 };
}

/* =========================================================
   playing a round
   ========================================================= */
function currentBet() {
  const v = Number(betInput.value);
  return Number.isFinite(v) ? v : 0;
}

function resolveStake() {
  const min = game.minBet || 1;
  const cap = betCap();
  let v = Math.floor(currentBet());
  if (!Number.isFinite(v) || v < min) v = min;
  if (v > cap) v = Math.max(0, cap);
  return v;
}

async function playRound(instant = false, opts = {}) {
  if (playing) return;
  if (!betInput) return;
  const gameId = game.id;
  const min = game.minBet || 1;
  if (!state.infMoney && state.money < min) {
    handleBankrupt();
    return;
  }
  const stake = resolveStake();
  const units = betUnits();
  const cost = lineBetCost(stake);
  if (stake <= 0) {
    toast(units > 1 ? "Not enough for " + units + " lines at that bet." : "Bet something first.", "info", 2600);
    return;
  }
  if (cost <= 0 || !canAfford(cost)) {
    toast(units > 1
      ? units + " lines \u00D7 " + fmt(stake) + " = " + fmt(cost) + ", but you have " + fmt(state.money) + "."
      : "Not enough money for that bet.", "lose", 3000);
    return;
  }
  if (typeof inst.canPlay === "function" && !inst.canPlay()) {
    toast(game.pickHint || "Make your bet first.", "info", 2800);
    return;
  }

  playing = true;
  setPlayEnabled(false);
  roundStake = cost;
  addMoney(-cost);
  /* THE TWO 5-REEL MACHINES keep a progressive pot each, and the slice is set
     aside AFTER the spin resolves -- because it is only charged when the spin
     actually LOSES (a win, and a push that hands the stake straight back, are
     both exempt -- see below). The house takes its cut on the way in; feeding
     is charged against the STAKE, which is why it scales with the bet and can
     never be farmed, and only the machine the player is actually spinning can
     take its own pot with three jackpot symbols anywhere on its drums. Lucky
     Sevens has no pot at all, so no spin there is charged a penny for one. */
  renderTop();

  let res = { multiplier: 0 };
  try {
    res = await inst.play(stake, { instant, idle: !!opts.idle, auto: !!opts.idle });
  } catch (err) {
    console.error(err);
    res = { multiplier: 0 };
  }

  const eff = computeEffects();
  if (state.cheatWin && (Number(res.multiplier) || 0) < 1.02) {
    res = Object.assign({}, res, { multiplier: 1.02 + Math.random() * 0.48, rescued: true });
  }
  /* HOUSE MAXIMUM: no round pays more than maxWinMult x the stake, whatever the
     machine, its luck or its perks produced. Every advertised top sits under it;
     it only bites on Rocket Crash's free-flown multiplier; every other machine's own
     ladder/odds cap sits under it, and Neon Recall advertises that tighter top. */
  const rawMult = Math.max(0, Number(res.multiplier) || 0);
  const mult = Math.min(CONFIG.maxWinMult, rawMult);
  res = Object.assign({}, res, { multiplier: mult, capped: rawMult > mult });
  let { payout, profit } = applyPerks(roundStake, mult, eff, !game.noPerks);
  /* ON THE HOUSE: a comped loss comes back whole. It is rolled only on a genuine
     LOSS, it is bounded by that loss (a round can only be comped back to exactly
     its own stake), it is skipped at `noPerks` tables, and it is rolled BEFORE
     the pot is added -- a round that is about to win a pot was not a loss. A comp
     is a PUSH: neither a win nor a loss for the books, so it pays no XP, feeds no
     jackpot and reads as a refund on the history line. */
  let comped = false;
  if (!game.noPerks && profit < 0 && eff.compChance > 0 && Math.random() < eff.compChance) {
    payout = roundMoney(roundStake);
    profit = 0;
    comped = true;
  }
  /* The jackpot is paid OUTSIDE the machine's multiplier, the house maximum and
     the perk maths. It is the players' own money being handed back, not a win
     the house is funding, so clamping it as if it were a 1000x round would let
     the ceiling quietly confiscate a pot that had grown past it -- and the perks
     must not ride a pot that was never a bet. `jackpotTake(gameId)` empties THIS
     MACHINE'S meter (which the LED board is subscribed to, so it zeroes on
     screen immediately) and returns what was in it; the other pot machine's bank
     is untouched. The `isJackpotGame` test is belt-and-braces: only a machine
     that carries a bank can report `jackpot`, and a stray truthy flag on any
     other table must never be able to make `jackpotTake` fall back to a bank
     that is not its own. */
  let jackpotWon = 0;
  if (res.jackpot && isJackpotGame(gameId)) {
    jackpotWon = jackpotTake(gameId);
    payout = roundMoney(payout + jackpotWon);
    profit = roundMoney(profit + jackpotWon);
  }
  if (payout > 0) addMoney(payout);
  /* THE JACKPOT SLICE IS ONLY CHARGED ON A GENUINE LOSS, AND ONLY BY THE
     CABINET THAT TOOK THE SPIN. A round that pays the player back AT LEAST
     their stake -- a win, or a push that hands the stake straight back -- pays
     no jackpot contribution at all, so a bank is funded only by the rounds the
     player actually lost money on at that machine. The slice is charged against
     the LOSS (stake minus payout), never the whole stake: a bank is the
     players' own money coming back, and charging the stake meant the pot handed
     back more than the machine's own edge could ever take (see the balance book
     in main.pjs) -- a money printer for anyone patient enough to collect it. On
     the loss it is a slice of what the machine really took, so the machine's
     return stays under 100% whether or not the pot is ever hit. It goes into
     THIS MACHINE'S pot, which only its own three jackpot symbols can empty. */
  const roundLost = payout < roundStake;
  if (roundLost && isJackpotGame(gameId)) {
    jackpotFeed(roundStake - payout, gameId);
  }
  recordPlay({ game: gameId, stake: roundStake, payout, multiplier: mult });
  renderHistoryPanel();

  /* XP is a comp on money actually risked. A round that returned exactly the
     stake -- a bank on the verge at x1.00, a push, a cash-out before the first
     shot -- earns nothing (otherwise "start a round, immediately bank at x1.00,
     repeat" is a risk-free level-and-money printer), and a table whose edge is
     thinner than the comp (blackjack) opts out with `noXp`. The XP perks and
     IDLE do boost the XP, and so buy levels faster -- but they must not inflate
     the CASH comp, or a maxed Scholar idling a thin-edge table would earn more
     back per dollar than that table's edge takes, and the comp itself would be
     the printer. So the reward is scaled by the reciprocal of the multiplier:
     everyone earns the same comp per dollar RISKED, whatever they have bought. */
  const xpMult = (opts.idle ? CONFIG.idleXpMult : 1) * eff.xpMult;
  const xpGain = (profit === 0 || game.noXp) ? 0 : roundStake * CONFIG.xpRate * xpMult;
  const levels = grantXp(xpGain, xpMult > 0 ? 1 / xpMult : 1);

  playing = false;
  refreshPlayEnabled();
  renderTop();

  if (!instant) {
    if (payout > 0 && profit > 0) {
      const mm = mult;
      let tier = 1;
      if (profit >= 100 || mm >= 3) tier = 2;
      if (profit >= 750 || mm >= 12) tier = 3;
      if (profit >= 4000 || mm >= 40) tier = 4;
      sfx.win(tier);
      sfx.cash(tier);
      /* SHOWBOAT: still no money in it -- just a louder room. The confetti scales
         with the stacks, and a full three stacks puts the SHOWBOAT banner on the
         popup (below) and calls the pit's attention to a big one. */
      if (eff.showboat > 0) {
        confetti(25 + 40 * eff.showboat);
        if (eff.showboat >= 3 && (mm >= 8 || profit >= 500)) {
          toast("SHOWBOAT \\u2014 the whole pit is watching you.", "gold", 3000);
        }
      }
    } else if (payout === 0) {
      sfx.lose();
    }
    if (res.capped) toast("House maximum \u2014 paid at \u00D7" + mult.toFixed(2) + ".", "gold", 2600);
  }

  /* the pot gets its own, louder celebration, and its own popup -- the ordinary
     win popup is suppressed below so a jackpot cannot show two of them */
  if (!instant && jackpotWon > 0) {
    confetti(150);
    winPopup({ amount: jackpotWon, mult: 0, label: "JACKPOT" });
    toast("JACKPOT \u2014 " + fmt(jackpotWon) + " from the " + game.name + " jackpot!", "gold", 5200);
    if (inst && typeof inst.onJackpot === "function") {
      try { inst.onJackpot(); } catch (err) { console.error(err); }
    }
  }

  if (!instant && profit > 0 && jackpotWon <= 0 && (!opts.idle || profit >= 50)) {
    winPopup({
      amount: profit,
      mult,
      label: (eff.showboat >= 3 && (mult >= 8 || profit >= 500))
        ? "SHOWBOAT"
        : (opts.idle ? "IDLE WIN" : "YOU WIN"),
    });
  }
  if (!instant && comped) {
    /* the comp gets its own small celebration and its own float: the ordinary
       one below would print a "$0 loss", which is exactly the wrong story */
    sfx.win(1);
    sfx.cash(1);
    confetti(30);
    toast("ON THE HOUSE \\u2014 the floor manager eats that one. " + fmt(roundStake) + " back on the pile.", "gold", 3600);
    floatAtElement(topbar.money, "+" + fmt(roundStake), "win");
  } else if (!instant && payout > 0) {
    floatAtElement(topbar.money, (profit > 0 ? "+" : "") + fmt(profit), profit > 0 ? "win" : "lose");
  }
  if (levels.length) {
    const tierSize = Math.max(1, Math.round(CONFIG.xpTierSize));
    const milestone = levels.some((l) => l.level > 1 && (l.level - 1) % tierSize === 0);
    const reward = levels.reduce((a, l) => a + l.reward, 0);
    if (milestone) {
      toast("MILESTONE \u2014 LEVEL " + state.level + "!  +" + fmt(reward) +
        " and a wider table limit. XP per level just got " + Math.max(1, CONFIG.xpTierSpike).toFixed(2).replace(/\.?0+$/, "") + "\u00D7 harder.", "gold", 4200);
    } else {
      toast("LEVEL " + state.level + "!  +" + fmt(reward) + " and a wider table limit.", "gold", 3200);
    }
    sfx.levelUp();
    confetti(45);
  } else if (!instant && profit > 0 && (roundStake >= 50 || profit >= 200)) {
    if (profit >= 500 || mult >= 8) confetti(40);
  }

  saveState();
  checkLoanReady();
  if (!state.infMoney) {
    if (state.money <= 0.004 && !state.loan.active) handleBankrupt();
    else if (state.money <= 0.004 && state.loan.active) failLoanFlow();
  }
}

function setPlayEnabled(on) {
  if (!playBtn) return;
  playBtn.disabled = !on;
}

function refreshPlayEnabled() {
  if (!playBtn) return;
  const ok = !playing && (!(inst && typeof inst.canPlay === "function") || !!inst.canPlay());
  playBtn.disabled = !ok;
}

/* =========================================================
   topbar render
   ========================================================= */
function renderTop() {
  if (state.infMoney) {
    cancelAnimationFrame(topbar.money.__anim || 0);
    topbar.money.__anim = 0;
    topbar.money.textContent = "\u221E";
    topbar.money.classList.add("inf");
    moneyShown = state.money;
  } else {
    topbar.money.classList.remove("inf");
    animateNumber(topbar.money, moneyShown, state.money, 380);
    moneyShown = state.money;
  }
  topbar.level.textContent = String(state.level);
  const prog = xpProgress();
  topbar.xpFill.style.width = (prog.pct * 100).toFixed(1) + "%";
  topbar.xpFill.classList.toggle("tiered", prog.tier > 0);
  topbar.xpText.textContent = fmtShort(prog.xp) + " / " + fmtShort(prog.need) + " XP";
  if (topbar.tierTag) {
    const tag = topbar.tierTag;
    const spikeTxt = prog.spike.toFixed(2).replace(/\.?0+$/, "");
    tag.classList.toggle("wall", prog.wallNext);
    if (prog.wallNext) {
      tag.hidden = false;
      tag.textContent = "\u26A0 NEXT TIER";
      tag.title = "Milestone ahead \u2014 the next level costs " + Math.max(1, CONFIG.xpTierSpike).toFixed(2).replace(/\.?0+$/, "") + "\u00D7 more XP.";
    } else if (prog.tier > 0) {
      tag.hidden = false;
      tag.textContent = "\u2605 TIER " + (prog.tier + 1) + " \u00D7" + spikeTxt;
      tag.title = "Milestone tier " + (prog.tier + 1) + " \u2014 XP per level is inflated \u00D7" + spikeTxt + ".";
    } else {
      tag.hidden = true;
    }
  }
  const eff = computeEffects();
  topbar.luck.textContent = "+" + (eff.luck * 100).toFixed(1) + "%";
  topbar.bestWin.textContent = fmt(state.stats.biggestWin);
  updateBadge();
  updateIdleUI();
  updateLoanUI();
}

function updateBadge() {
  const n = perkShopCount();
  topbar.badge.textContent = String(n);
  topbar.badge.classList.toggle("zero", n === 0);
}

/* =========================================================
   machine nav
   ========================================================= */
function buildNav() {
  clear(topbar.nav);
  topbar.nav.appendChild(el("div", { class: "nav-head", text: "The Floor" }));
  const edges = {
    slots: "return 95.7% \u00B7 max 200x",
    "slots-multi": "return 93.6% \u00B7 max 1000x \u00B7 own jackpot",
    "slots-wheel": "return 96.4% \u00B7 x25 wheel \u00B7 own jackpot",
    roulette: "house edge 2.7%",
    blackjack: "house edge 0.5% \u00B7 no perks",
    horse: "house edge 8%",
    crash: "house edge 3% \u00B7 max 1000x \u00B7 no idle",
    arcade: "beat it \u00B7 take " + Math.round(CONFIG.arcadeWinShare * 100) + "% \u00B7 no idle",
    frogger: "timing \u00B7 10 islands \u00B7 no idle",
    memory: "fitted ladder \u00B7 table max \u00B7 no idle",
    chest: "house edge 6.25% \u00B7 4 of 9 pay",
    revolver: "10 rungs \u00B7 house edge 8.3% \u00B7 no idle",
    holdem: "seat charge 3% \u00B7 beat the bots",
  };
  for (const g of GAMES) {
    const btn = el("button", {
      class: "machine-btn" + (g.id === game.id ? " active" : ""),
      type: "button",
      "data-id": g.id,
      onclick: () => mountGame(g.id),
    },
      el("span", { class: "machine-icon", text: g.icon }),
      el("span", { class: "machine-meta" },
        el("span", { class: "machine-name", text: g.name }),
        el("span", { class: "machine-edge", text: edges[g.id] || "" })
      )
    );
    topbar.nav.appendChild(btn);
  }
}

function mountGame(id) {
  if (inst && typeof inst.destroy === "function") {
    try { inst.destroy(); } catch (err) { console.error(err); }
  }
  game = gameById(id);
  state.machine = id;
  saveState();
  if (game.canIdle === false && state.idle.on) {
    state.idle.on = false;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    saveState();
    toast("Idle switched off \u2014 this machine is played by hand.", "info", 2600);
  }
  buildNav();
  clear(topbar.stage);
  try {
    inst = game.create(app);
  } catch (err) {
    console.error(err);
    topbar.stage.appendChild(el("div", { class: "stage-inner", text: "This table failed to open. Check the console." }));
    return;
  }
  topbar.stage.appendChild(inst.root);
  topbar.stage.appendChild(playBar);
  placePlayButton();
  if (playBtn) {
    playBtn.textContent = inst.actionLabel || game.action;
  }
  renderBetTotal();
  setBet(currentBet());
  renderPayoutNote();
  markCheatsheets();
}

/* =========================================================
   bet panel
   ========================================================= */
let betInput, playBtn, noteEl, statsEl, betTotalEl, historyEl, tableMiniEl;

/* ---- where the PLAY button lives ----
   Wide screens: a bar pinned along the bottom of the stage, centred under the game, so
   it sits next to the machine's own buttons instead of off in the right-hand column.
   Narrow screens: back inside the bet panel, under the chips, where the stake controls
   are (the stage's game buttons are the only thing above it there).
   It is always the SAME element, reparented on the media query, so machines keep
   disabling/labelling `playBtn` by reference. */
const playBar = el("div", { class: "playbar", hidden: true });
/* kept in step with `@media (max-width:1040px)` in styles.css: below that the
   layout is a single column and the bet panel sits under the stage, so the
   play button belongs back inside it there. */
const wideLayout = window.matchMedia("(min-width:1041px)");
function placePlayButton() {
  if (!playBtn) return;
  if (wideLayout.matches) {
    if (playBtn.parentNode !== playBar) playBar.appendChild(playBtn);
    playBar.hidden = false;
  } else {
    if (playBtn.parentNode !== topbar.betPanel) topbar.betPanel.insertBefore(playBtn, noteEl);
    playBar.hidden = true;
  }
}
wideLayout.addEventListener("change", placePlayButton);
/* Belt and braces: a window resize always re-runs the placement, so the button
   can never be left inside a bar the CSS has just hidden (the media-query
   change event alone is enough in a normal browser, but this costs nothing --
   the function is idempotent). */
window.addEventListener("resize", placePlayButton);

function buildBetPanel() {
  clear(topbar.betPanel);
  betInput = el("input", { class: "bet-input", type: "number", min: "1", step: "1", value: String(Math.max(1, Math.floor(state.bet || 10))) });
  betInput.addEventListener("input", () => { state.bet = currentBet(); saveState(); renderBetTotal(); });
  betInput.addEventListener("change", () => setBet(betInput.value));

  const chips = [
    ["+10", () => bump(10)],
    ["+25", () => bump(25)],
    ["+100", () => bump(100)],
    ["\u00D72", () => setBet(currentBet() * 2)],
    ["\u00BD", () => setBet(Math.floor(currentBet() / 2))],
    ["MAX", () => setBet(Math.floor(state.money))],
  ];

  playBtn = el("button", { class: "playbtn", type: "button", text: game.action, onclick: () => playRound(false) });
  noteEl = el("div", { class: "payout-note" });
  statsEl = el("div", { class: "statgrid" });

  topbar.betPanel.appendChild(el("div", { class: "panel-head", text: "Your bet" }));
  topbar.betPanel.appendChild(el("div", { class: "bet-display" },
    el("span", { class: "label", text: "Amount" }),
    betInput
  ));
  betTotalEl = el("div", { class: "bet-total", hidden: true });
  topbar.betPanel.appendChild(betTotalEl);
  topbar.betPanel.appendChild(el("div", { class: "chips" },
    ...chips.map(([label, fn]) => el("button", { class: "chip", type: "button", text: label, onclick: fn }))
  ));
  topbar.betPanel.appendChild(noteEl);
  topbar.betPanel.appendChild(el("div", { class: "panel-head", text: "Session" }));
  topbar.betPanel.appendChild(statsEl);
  topbar.betPanel.appendChild(el("div", { class: "panel-headrow" },
    el("div", { class: "panel-head", text: "History" }),
    el("button", { class: "linkbtn", type: "button", text: "VIEW ALL", onclick: openHistoryModal })
  ));
  tableMiniEl = el("div", { class: "hist-mini-wrap", hidden: true });
  topbar.betPanel.appendChild(tableMiniEl);
  historyEl = el("div", { class: "hist hist-recent" });
  topbar.betPanel.appendChild(historyEl);
  renderStats();
  renderHistoryPanel();
}

function bump(n) { setBet(currentBet() + n); }
function setBet(v) {
  const min = game.minBet || 1;
  const cap = betCap();
  let x = Math.floor(Number(v) || 0);
  if (x < min) x = min;
  if (x > cap) x = Math.max(min, cap);
  betInput.value = String(x);
  state.bet = x;
  saveState();
  renderBetTotal();
}

function renderBetTotal() {
  if (inst && typeof inst.onBetChange === "function") {
    try { inst.onBetChange(); } catch (err) { console.error(err); }
  }
  if (!betTotalEl) return;
  const units = betUnits();
  const per = currentBet();
  const bits = [];
  if (units > 1) {
    const label = (game && game.unitLabel) || (inst && inst.unitLabel) || "lines";
    bits.push("<b>" + units + " " + label + "</b> \u00D7 " + fmt(per) + " each = <b>" + fmt(lineBetCost(per)) + "</b> total per spin");
  }
  const lim = tableLimit();
  if (Number.isFinite(lim)) bits.push("table limit <b>" + fmt(lim) + "</b>");
  /* Each machine may declare its own ceiling (maxWinMult on the descriptor); the house-wide
     CONFIG.maxWinMult is the fallback, and it is a TRUE upper bound for every machine, so the
     line is never a lie -- just tighter for a machine that cannot reach the house clamp. */
  const winMult = (game && Number(game.maxWinMult) > 0) ? game.maxWinMult : CONFIG.maxWinMult;
  bits.push("max win <b>" + fmt(winMult * Math.max(1, lineBetCost(per))) + "</b>");
  if (!bits.length) {
    betTotalEl.hidden = true;
  } else {
    betTotalEl.hidden = false;
    betTotalEl.innerHTML = bits.join(" \u00B7 ");
  }
  refreshPlayEnabled();
}

function renderStats() {
  if (!statsEl) return;
  clear(statsEl);
  const s = state.stats;
  const cells = [
    ["Wagered", fmt(s.wagered)],
    ["Hands", String(s.plays)],
    ["Won", fmt(s.won)],
    ["Lost", fmt(s.lost)],
    ["Best win", fmt(s.biggestWin)],
    ["Best mult", (s.bestMult || 0).toFixed(2) + "x"],
  ];
  for (const [k, v] of cells) {
    statsEl.appendChild(el("div", { class: "statcell" }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v })));
  }
}

/* =========================================================
   play history (per-hand win / loss list)
   ========================================================= */
function historyRows(list) {
  const rows = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] || {};
    const g = gameById(e.g || "unknown");
    const stake = Math.round(Number(e.s) || 0);
    const profit = Math.round(Number(e.p) || 0) - stake;
    const kind = profit > 0 ? "win" : profit < 0 ? "lose" : "push";
    const m = Number(e.m) || 0;
    rows.push(el("div", { class: "hist-row " + kind },
      el("span", { class: "hist-icon", text: g.icon || "\u2753" }),
      el("span", { class: "hist-meta" },
        el("span", { class: "hist-g", text: g.name || e.g || "Unknown" }),
        el("span", { class: "hist-sub", text: "bet " + fmt(stake) + (m > 1 ? "  \u00B7  " + mult(m) : "") })
      ),
      el("span", { class: "hist-res", text: kind === "win" ? "WIN" : kind === "lose" ? "LOSS" : "PUSH" }),
      el("span", { class: "hist-amt " + kind, text: profit === 0 ? fmt(0) : (profit > 0 ? "+" : "-") + fmt(Math.abs(profit)) })
    ));
  }
  return rows;
}

function histEmpty(text) {
  return el("div", { class: "hist-empty", text });
}

/* ---------------------------------------------------------
   per-table breakdown ("what did this table do to me?")
   gross profit won, gross money lost, net difference, win rate
   --------------------------------------------------------- */

/* One row per machine — played tables first (busiest at the top), then the
   ones still sitting dark, so the list always covers the whole floor. */
function tableBreakdown() {
  const byGame = state.stats.byGame || {};
  const rows = GAMES.map((g, order) => {
    const s = byGame[g.id] || {};
    const plays = Math.max(0, Math.round(Number(s.plays) || 0));
    const staked = Math.max(0, Math.round(Number(s.staked) || 0));
    const returned = Math.max(0, Math.round(Number(s.returned) || 0));
    const wins = Math.max(0, Math.round(Number(s.wins) || 0));
    const losses = Math.max(0, Math.round(Number(s.losses) || 0));
    return {
      g, order, plays, staked, returned, wins, losses,
      won: Math.max(0, Math.round(Number(s.won) || 0)),
      lost: Math.max(0, Math.round(Number(s.lost) || 0)),
      /* net = returned - staked, which by construction equals won - lost */
      net: returned - staked,
      pushes: Math.max(0, plays - wins - losses),
      rate: plays > 0 ? wins / plays : null,
    };
  });
  rows.sort((a, b) => (b.plays - a.plays) || (a.order - b.order));
  return rows;
}

function signed(n) {
  const v = Math.round(Number(n) || 0);
  return (v > 0 ? "+" : v < 0 ? "-" : "") + fmt(Math.abs(v));
}

function rateText(r) {
  return r.rate === null ? "\u2014" : Math.round(100 * r.rate) + "%";
}

/* tooltip spelling out the win/loss/push record behind a win rate */
function recordText(r) {
  const bits = [r.plays + (r.plays === 1 ? " hand" : " hands")];
  bits.push(r.wins + (r.wins === 1 ? " win" : " wins"));
  bits.push(r.losses + (r.losses === 1 ? " loss" : " losses"));
  if (r.pushes) bits.push(r.pushes + (r.pushes === 1 ? " push" : " pushes"));
  return r.g.name + " \u00B7 " + bits.join(", ");
}

/* compact side-panel version: icon, table, net, win rate */
function tableSummaryMini() {
  const played = tableBreakdown().filter((r) => r.plays > 0);
  if (!played.length) return null;
  const MAX = 6;
  const shown = played.slice(0, MAX);
  const wrap = el("div", { class: "hist-mini" },
    el("div", { class: "hmin-row hmin-head" },
      el("span", {}),
      el("span", { text: "Table" }),
      el("span", { text: "Net" }),
      el("span", { text: "Win\u00A0%" })
    )
  );
  for (const r of shown) {
    wrap.appendChild(el("div", { class: "hmin-row", title: recordText(r) + " \u00B7 net " + signed(r.net) },
      el("span", { class: "hmin-icon", text: r.g.icon || "\u2753" }),
      el("span", { class: "hmin-name", text: r.g.name }),
      el("span", { class: "hmin-net " + (r.net > 0 ? "good" : r.net < 0 ? "bad" : ""), text: signed(r.net) }),
      el("span", { class: "hmin-rate", text: rateText(r) })
    ));
  }
  if (played.length > shown.length) {
    wrap.appendChild(el("div", { class: "hmin-more" },
      el("button", { class: "linkbtn", type: "button", text: "+" + (played.length - shown.length) + " more \u00B7 VIEW ALL", onclick: openHistoryModal })
    ));
  }
  return wrap;
}

/* full version for the history modal: every table, with totals */
function tableBreakdownTable() {
  const rows = tableBreakdown();
  const played = rows.filter((r) => r.plays > 0);
  if (!played.length) return null;

  const grid = (cls, ...cells) => el("div", { class: cls }, ...cells);
  const wrap = el("div", { class: "hist-gtable" },
    grid("hgt-head",
      el("span", { text: "Table" }),
      el("span", { text: "Hands" }),
      el("span", { text: "Won" }),
      el("span", { text: "Lost" }),
      el("span", { text: "Net" }),
      el("span", { text: "Win rate" })
    )
  );

  for (const r of played) {
    const ncls = r.net > 0 ? "good" : r.net < 0 ? "bad" : "hgt-mut";
    wrap.appendChild(grid("hgt-row", 
      el("span", { class: "hgt-name", text: (r.g.icon || "\u2753") + " " + r.g.name }),
      el("span", { text: String(r.plays) }),
      el("span", { class: "good", text: r.won ? fmt(r.won) : "\u2014" }),
      el("span", { class: "bad", text: r.lost ? fmt(r.lost) : "\u2014" }),
      el("span", { class: "hgt-net " + ncls }, r.net > 0 ? el("span", { class: "hgt-sign", text: "+" }) : null, fmt(Math.abs(r.net))),
      el("span", { class: "hgt-rate", title: recordText(r), text: rateText(r) })
    ));
  }

  const total = played.reduce((a, r) => {
    a.plays += r.plays; a.won += r.won; a.lost += r.lost; a.net += r.net; a.wins += r.wins; a.losses += r.losses; a.pushes += r.pushes;
    return a;
  }, { plays: 0, won: 0, lost: 0, net: 0, wins: 0, losses: 0, pushes: 0 });
  const totalNetCls = total.net > 0 ? "good" : total.net < 0 ? "bad" : "hgt-mut";
  wrap.appendChild(grid("hgt-row hgt-total",
    el("span", { class: "hgt-name", text: "All tables" }),
    el("span", { text: String(total.plays) }),
    el("span", { class: "good", text: total.won ? fmt(total.won) : "\u2014" }),
    el("span", { class: "bad", text: total.lost ? fmt(total.lost) : "\u2014" }),
    el("span", { class: "hgt-net " + totalNetCls }, total.net > 0 ? el("span", { class: "hgt-sign", text: "+" }) : null, fmt(Math.abs(total.net))),
    el("span", { class: "hgt-rate", title: total.plays + " hands, " + total.wins + " wins, " + total.losses + " losses" + (total.pushes ? ", " + total.pushes + " pushes" : ""), text: Math.round(100 * (total.plays ? total.wins / total.plays : 0)) + "%" })
  ));

  const dark = rows.filter((r) => r.plays === 0);
  if (dark.length) {
    wrap.appendChild(el("div", { class: "hgt-split" },
      el("span", { text: "Not played yet" }),
      el("span", { text: dark.length + (dark.length === 1 ? " table" : " tables") })
    ));
    for (const r of dark) {
      wrap.appendChild(grid("hgt-row hgt-idle",
        el("span", { class: "hgt-name", text: (r.g.icon || "\u2753") + " " + r.g.name }),
        el("span", { text: "0" }),
        el("span", { text: "\u2014" }),
        el("span", { text: "\u2014" }),
        el("span", { text: "\u2014" }),
        el("span", { text: "\u2014" })
      ));
    }
  }

  return wrap;
}

function renderHistoryPanel() {
  if (!historyEl) return;
  const h = Array.isArray(state.history) ? state.history : [];
  if (tableMiniEl) {
    clear(tableMiniEl);
    const mini = h.length ? tableSummaryMini() : null;
    if (mini) tableMiniEl.appendChild(mini);
    tableMiniEl.hidden = !mini;
  }
  clear(historyEl);
  if (!h.length) { historyEl.appendChild(histEmpty("No hands played yet.")); return; }
  for (const row of historyRows(h.slice(-14))) historyEl.appendChild(row);
}

let historyModal = null;

function openHistoryModal() {
  /* guard: re-clicking the HISTORY button (or double-tapping on touch) should not
     stack a second identical sheet on top of the first */
  if (historyModal) return;
  const h = Array.isArray(state.history) ? state.history : [];
  const stats = state.stats;
  const listWrap = el("div", { class: "hist hist-full" });
  if (!h.length) listWrap.appendChild(histEmpty("You have not played a hand yet."));
  else for (const row of historyRows(h)) listWrap.appendChild(row);

  /* lifetime totals, so the headline figures agree with the per-table sheet below
     (the hand log itself only keeps the most recent hands) */
  const plays = Math.max(0, Math.round(Number(stats.plays) || 0));
  const wins = Math.max(0, Math.round(Number(stats.wins) || 0));
  const losses = Math.max(0, Math.round(Number(stats.losses) || 0));
  const pushes = Math.max(0, plays - wins - losses);
  const net = Math.round((Number(stats.won) || 0) - (Number(stats.lost) || 0));

  const body = el("div", {},
    el("div", { class: "hist-summary" },
      el("span", {}, el("b", { text: plays.toLocaleString("en-US") }), "hands"),
      el("span", { class: "good" }, el("b", { text: wins.toLocaleString("en-US") }), "wins"),
      el("span", { class: "bad" }, el("b", { text: losses.toLocaleString("en-US") }), "losses"),
      pushes ? el("span", {}, el("b", { text: pushes.toLocaleString("en-US") }), "pushes") : null,
      el("span", { class: net >= 0 ? "good" : "bad" }, el("b", { text: signed(net) }), "net")
    )
  );

  const table = tableBreakdownTable();
  if (table) {
    body.appendChild(el("div", { class: "hist-sub-head", text: "By table" }));
    body.appendChild(table);
    body.appendChild(el("div", { class: "hist-note", text: "Won and Lost are the gross profit and gross losses on that table \u2014 Net is the difference. Pushes count as hands but as neither a win nor a loss, so the win rate is wins \u00F7 hands." }));
    body.appendChild(el("div", { class: "hist-sub-head", text: h.length ? "Recent hands \u00B7 last " + h.length : "Every hand" }));
  }
  body.appendChild(listWrap);

  historyModal = modal({
    title: "Play History",
    width: 660,
    body,
    buttons: [{ label: "CLOSE", cls: "gold" }],
    onClose: () => { historyModal = null; },
  });
}

function renderPayoutNote() {
  if (!noteEl) return;
  const eff = computeEffects();
  const extras = [];
  if (eff.winBonus > 0) extras.push("+" + (eff.winBonus * 100).toFixed(1) + "% of stake on a win");
  if (eff.rebate > 0) extras.push((eff.rebate * 100).toFixed(1) + "% of stake back on a loss");
  if (eff.luck > 0) extras.push("+" + (eff.luck * 100).toFixed(1) + "% luck");
  if (eff.profitBonus > 0) extras.push("+" + (eff.profitBonus * 100).toFixed(1) + "% profit on a win");
  if (game.noPerks) extras.push("perks & luck do not apply at this table");
  clear(noteEl);
  noteEl.appendChild(el("div", { html: typeof game.payoutNote === "function" ? game.payoutNote() : "" }));
  if (extras.length) {
    noteEl.appendChild(el("div", { style: { marginTop: "7px", color: "#5cf39a", fontWeight: "700" }, text: "Perks active: " + extras.join(" \u00B7 ") }));
  }
}

function markCheatsheets() { /* reserved */ }

/* =========================================================
   idle mode
   ========================================================= */
function idleBet() {
  const v = Math.floor(Number(topbar.idleBet.value) || 0);
  return v >= 1 ? v : 1;
}

function updateIdleUI() {
  topbar.idleBtn.textContent = state.idle.on ? "IDLE ON" : "IDLE OFF";
  topbar.idleBtn.classList.toggle("on", state.idle.on);
  if (document.activeElement !== topbar.idleBet) {
    topbar.idleBet.value = String(Math.max(1, Math.floor(state.idle.bet || CONFIG.idleDefaultBet)));
  }
}

function setIdle(on) {
  if (on && game.canIdle === false) {
    toast("This machine is played by hand \u2014 no idle mode.", "info", 2800);
    return;
  }
  state.idle.on = !!on;
  saveState();
  updateIdleUI();
  if (state.idle.on) {
    toast("Idle on \u2014 auto-playing at " + fmt(idleBet()) + " per hand.", "info", 2200);
    scheduleIdle(200);
  } else if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdle(ms) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(idleLoop, ms);
}

async function idleLoop() {
  idleTimer = null;
  if (!state.idle.on) return;
  if (game.canIdle === false) { setIdle(false); return; }
  if (!document.getElementById("modalLayer").hidden) { scheduleIdle(600); return; }
  if (playing) { scheduleIdle(240); return; }
  const bet = idleBet();
  if (lineBetCost(bet) > state.money) {
    setIdle(false);
    toast("Idle stopped: balance is below the " + (betUnits() > 1 ? betUnits() + "-line bet." : "idle bet."), "lose", 3000);
    return;
  }
  const savedBet = betInput.value;
  betInput.value = String(bet);
  await playRound(false, { idle: true });
  betInput.value = savedBet;
  if (!state.idle.on) return;
  const eff = computeEffects();
  const interval = clamp(300 / Math.max(0.4, eff.idleSpeed), 80, 1200);
  scheduleIdle(interval);
}

/* =========================================================
   loans / bankruptcy
   ========================================================= */
/* ---- the loan bar ----

   The bar is the loan's whole live UI: the clock, a progress fill that measures
   the player's balance against what they owe, and a PAY BACK button that is
   always on screen while a loan is live, so the debt can be settled at any
   moment. The debt is NOT snatched out of the balance the instant the player can
   afford it any more -- they asked to be given the choice -- so a loan is only
   ended by (a) the player pressing a button (here, or in the Loan Status modal),
   (b) the clock reaching zero with the balance able to cover it
   (settleLoanAtDeadline), or (c) a default. `repayReady` is the state the bar is
   painted from; `repayOfferFor` holds the `takenAt` of the loan whose one-time
   offer has already been raised, so a new loan gets its own offer and the same
   loan is never nagged about twice. */
let repayReady = false;
let repayOfferFor = 0;

function updateLoanUI() {
  const L = state.loan;
  const bar = topbar.loanBar;
  if (!L.active) {
    if (!bar.hidden) bar.hidden = true;
    bar.classList.remove("ready");
    repayReady = false;
    return;
  }
  bar.hidden = false;
  const ms = loanRemainingMs();
  const secs = Math.ceil(ms / 1000);
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  topbar.loanClock.textContent = (hh > 0 ? hh + ":" : "") + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  topbar.loanClock.classList.toggle("warn", secs <= 300);
  topbar.loanFill.style.width = clamp((state.money / L.repay) * 100, 0, 100).toFixed(1) + "%";

  /* "ready" is the one state the player cares about: the balance could clear the
     debt right now. It turns the bar and the button gold, puts the figure on the
     button, and swaps the sentence to the two ways out. */
  repayReady = state.money >= L.repay;
  bar.classList.toggle("ready", repayReady);
  const btn = topbar.loanRepayBtn;
  if (btn) {
    btn.classList.toggle("ready", repayReady);
    btn.classList.toggle("short", !repayReady);
    btn.textContent = repayReady ? "PAY BACK " + fmt(L.repay) : "PAY BACK";
    btn.title = repayReady
      ? "Hand over " + fmt(L.repay) + " and end the loan now"
      : "You need " + fmt(L.repay) + " to clear the loan \u2014 you have " + fmt(state.money);
  }
  clear(topbar.loanText);
  topbar.loanText.appendChild(el("span", { html: repayReady
    ? "You can settle this whenever you like \u2014 <b>" + fmt(L.repay) + "</b> of your <b>" + fmt(state.money) + "</b>. " +
      "Press PAY BACK, or leave it to the clock at 00:00. <b>Get back under " + fmt(L.repay) + " and you default.</b>"
    : "Repay <b>" + fmt(L.repay) + "</b> before the clock runs out \u2014 you have <b>" + fmt(state.money) + "</b>. " +
      "Default and every perk, level and chip is gone." }));
}

/* Reaching the repay target does not pay the debt off by itself any more: it
   raises the one-time offer below and then leaves the decision -- and the whole
   balance -- alone. Called after every round and every tick. */
function checkLoanReady() {
  const L = state.loan;
  if (!L.active) return;
  updateLoanUI();
  if (!repayReady || repayOfferFor === L.takenAt || endModalOpen) return;
  /* don't stack the offer on top of a window the player is already reading --
     it waits for the next tick, when the layer is clear again */
  const layer = document.getElementById("modalLayer");
  if (layer && !layer.hidden) return;
  repayOfferFor = L.takenAt;
  showLoanReadyOffer();
}

/* the "you can pay the loan back now" window: pay it, or let the clock do it */
function showLoanReadyOffer() {
  const L = state.loan;
  modal({
    title: "You can pay the loan back now",
    width: 620,
    body: el("div", {},
      el("div", { class: "gameover-emoji", text: "\u{1F4B0}" }),
      el("div", { class: "gameover-sub", text: "Your balance has reached the repay target. The debt is settled whenever you say \u2014 or by the clock when it runs out." }),
      el("div", { class: "offerbox" },
        offerCell("You owe", fmt(L.repay)),
        offerCell("Your balance", fmt(state.money)),
        offerCell("Time left", clockText(loanRemainingMs()))
      ),
      el("div", { class: "loanrules", html:
        "You do <b>not</b> have to hand it over now. Leave it and <b>the clock does it for you</b>: when the timer reaches 00:00 the <b>" +
        fmt(L.repay) + "</b> comes straight out of your balance and the loan ends \u2014 play on exactly as normal until then. " +
        "<span class='danger'>The money is still yours to bet in the meantime, though, and if the balance is under <b>" +
        fmt(L.repay) + "</b> when the clock runs out, you default: every perk, level and chip is gone.</span>" })
    ),
    buttons: [
      { label: "PAY BACK NOW", cls: "gold", onClick: () => payLoanNow() },
      { label: "LET THE CLOCK DO IT", cls: "ghost" },
    ],
  });
}

/* The player pressing a button. `repayLoan` re-checks affordability itself, so a
   balance that slipped back under the target while the offer sat on screen is
   reported rather than quietly doing nothing. */
function payLoanNow() {
  if (!state.loan.active) return false;
  const L = state.loan;
  const cleared = repayLoan();
  if (!cleared) {
    toast("You need " + fmt(L.repay) + " to settle it \u2014 you have " + fmt(state.money) + " right now.", "lose", 3800);
    updateLoanUI();
    return false;
  }
  toast("LOAN REPAID \u2014 " + fmt(cleared.repay) + " cleared. You're free.", "gold", 4200);
  confetti(80);
  renderTop();
  return true;
}

/* the bar's PAY BACK button. Handing over the player's own money is worth one
   confirmation, and the dialog says plainly that doing nothing is also fine. */
async function tryRepayNow() {
  if (!state.loan.active) return;
  const L = state.loan;
  if (!canAfford(L.repay)) {
    toast("You still need " + fmt(L.repay - state.money) + " to clear the loan \u2014 leave it to the clock and it settles itself at 00:00.", "lose", 4200);
    return;
  }
  const ok = await confirmDialog("Pay the loan back now?",
    "This takes " + fmt(L.repay) + " out of your " + fmt(state.money) + " balance and ends the loan straight away. " +
    "You can also leave it alone: a loan still standing when the clock runs out is paid out of your balance automatically.",
    "PAY " + fmt(L.repay), "gold");
  if (!ok) return;
  payLoanNow();
}

/* The clock ran out with the loan still standing -- the "let it do it by itself"
   half of the bargain. If the balance covers the debt it is paid and the player
   carries on; if it does not, the loan defaults. */
function settleLoanAtDeadline() {
  if (!state.loan.active) return;
  if (state.money >= state.loan.repay || state.infMoney) {
    const cleared = repayLoan();
    if (cleared) {
      toast("The clock ran out \u2014 the loan settled itself: " + fmt(cleared.repay) + " taken from your balance.", "gold", 4800);
      confetti(50);
      renderTop();
    }
  } else {
    failLoanFlow();
  }
}

function tick() {
  if (!state.loan.active) return;
  if (loanExpired()) { settleLoanAtDeadline(); return; }
  updateLoanUI();
  checkLoanReady();
}

function handleBankrupt() {
  if (endModalOpen) return;
  if (state.infMoney) return;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  state.idle.on = false;
  updateIdleUI();
  if (state.loan.active) { failLoanFlow(); return; }
  if (!state.stats) return;
  state.stats.bankruptcies = (state.stats.bankruptcies || 0) + 1;
  saveState(true);
  showBankruptModal();
}

function showBankruptModal() {
  endModalOpen = true;
  openRunReport({ broke: true });
}

/* =========================================================
   run report — win/loss history, per-machine breakdown, jokes
   ========================================================= */
function offerCell(k, v, s) {
  return el("div", { class: "offer" },
    el("div", { class: "k", text: k }),
    el("div", { class: "v", text: v }),
    s ? el("div", { class: "s", text: s }) : null
  );
}

function clockText(ms) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  return (hh > 0 ? hh + ":" : "") + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}

function streakInfo(h) {
  let hot = 0, cold = 0, cur = 0, curWin = false;
  for (const e of h) {
    const win = e.p > e.s;
    if (win === curWin) cur++;
    else { curWin = win; cur = 1; }
    if (win) hot = Math.max(hot, cur); else cold = Math.max(cold, cur);
  }
  return { hot, cold };
}

function perGameRows() {
  const byGame = state.stats.byGame || {};
  return Object.keys(byGame)
    .map((id) => {
      const g = gameById(id);
      const s = byGame[id];
      return { g, s, net: Math.round(s.returned - s.staked) };
    })
    .filter((r) => r.s.plays > 0)
    .sort((a, b) => b.s.plays - a.s.plays);
}

function reportJokes(rows, net) {
  const stats = state.stats;
  const h = state.history || [];
  const jokes = [];
  const { hot, cold } = streakInfo(h);
  const wins = stats.wins || 0;
  const plays = stats.plays || 0;

  if (plays === 0) {
    jokes.push("You have not played a single hand. Bold strategy — the house respects a coward.");
  } else {
    jokes.push("You played <b>" + plays.toLocaleString("en-US") + "</b> hands and the reels have memorised your face.");
  }

  const wagered = Math.round(stats.wagered || 0);
  if (wagered >= 5) {
    const cups = Math.floor(wagered / 5);
    const cars = Math.floor(wagered / 12000);
    const homes = Math.floor(wagered / 350000);
    if (homes >= 1) jokes.push("You pushed <b>" + fmt(wagered) + "</b> across the felt. That is roughly <b>" + homes + "</b> " + (homes === 1 ? "house" : "houses") + " where you live.");
    else if (cars >= 1) jokes.push("You wagered <b>" + fmt(wagered) + "</b> — about <b>" + cars + "</b> " + (cars === 1 ? "decent used car" : "decent used cars") + ".");
    else jokes.push("You wagered <b>" + fmt(wagered) + "</b>. That is <b>" + cups.toLocaleString("en-US") + "</b> cups of coffee you will never drink.");
  }

  if (net > 0) jokes.push("You are <b>up " + fmt(net) + "</b>. Somewhere a pit boss is being shouted at.");
  else if (net < 0) jokes.push("You are <b>down " + fmt(-net) + "</b>. The house edge is not a suggestion.");
  else if (plays > 0) jokes.push("You broke exactly even. The casino would like to study you.");

  if (rows.length) {
    const fav = rows[0];
    jokes.push("Your home away from home was " + fav.g.icon + " <b>" + fav.g.name + "</b> — " + fav.s.plays.toLocaleString("en-US") + " hands.");
    const worst = rows.slice().sort((a, b) => a.net - b.net)[0];
    if (worst && worst.net < 0) jokes.push(worst.g.icon + " <b>" + worst.g.name + "</b> took <b>" + fmt(-worst.net) + "</b> off you. It is not personal. It is math.");
    const bestGame = rows.slice().sort((a, b) => b.net - a.net)[0];
    if (bestGame && bestGame.net > 0 && bestGame !== worst) jokes.push(bestGame.g.icon + " <b>" + bestGame.g.name + "</b> actually paid you <b>" + fmt(bestGame.net) + "</b>. Treasure it.");
  }

  if (stats.biggestWin > 0) jokes.push("Biggest single hit: <b>" + fmt(stats.biggestWin) + "</b> profit, at <b>" + (stats.bestMult || 0).toFixed(2) + "x</b>.");
  if (hot >= 3) jokes.push("Longest hot streak: <b>" + hot + "</b> wins in a row. You told nobody.");
  if (cold >= 4) jokes.push("Longest cold streak: <b>" + cold + "</b> losses in a row. The machine sent a thank-you card.");
  if (stats.bankruptcies > 0) jokes.push("You have hit the floor <b>" + stats.bankruptcies + "</b> " + (stats.bankruptcies === 1 ? "time" : "times") + ". The floor is getting used to you.");
  if (state.loan.active) jokes.push("The man in the suit is still waiting outside. He has your name on a clipboard.");
  if (stats.loansFailed > 0) jokes.push("You defaulted on <b>" + stats.loansFailed + "</b> " + (stats.loansFailed === 1 ? "loan" : "loans") + ". That is a permanent record, apparently.");
  if (wins === 0 && plays >= 10) jokes.push("Zero winning hands in " + plays + " tries. Statistically impressive, honestly.");

  const flavourLine = flavor("reportJokes");
  if (flavourLine) jokes.push(flavourLine);

  return jokes;
}

function reportNode() {
  const stats = state.stats;
  const rows = perGameRows();
  const net = Math.round((stats.won || 0) - (stats.lost || 0));
  const h = state.history || [];
  const { hot, cold } = streakInfo(h);
  const wraps = el("div", { class: "report" });

  wraps.appendChild(el("div", { class: "report-grid" },
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Hands" }), el("div", { class: "rv", text: (stats.plays || 0).toLocaleString("en-US") })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Wagered" }), el("div", { class: "rv", text: fmt(stats.wagered) })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: net >= 0 ? "Net up" : "Net down" }), el("div", { class: "rv " + (net >= 0 ? "good" : "bad"), text: fmt(Math.abs(net)) })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Win rate" }), el("div", { class: "rv", text: (stats.plays ? Math.round(100 * (stats.wins || 0) / stats.plays) : 0) + "%" })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Biggest hit" }), el("div", { class: "rv good", text: fmt(stats.biggestWin) })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Best mult" }), el("div", { class: "rv", text: (stats.bestMult || 0).toFixed(2) + "x" })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Hot streak" }), el("div", { class: "rv", text: hot + (hot === 1 ? " win" : " wins") })),
    el("div", { class: "rcell" }, el("div", { class: "rk", text: "Cold streak" }), el("div", { class: "rv", text: cold + (cold === 1 ? " loss" : " losses") }))
  ));

  if (rows.length) {
    const table = el("div", { class: "report-table" },
      el("div", { class: "rt-head" },
        el("span", { text: "Machine" }),
        el("span", { text: "Hands" }),
        el("span", { text: "Wagered" }),
        el("span", { text: "Net" })
      )
    );
    for (const r of rows) {
      table.appendChild(el("div", { class: "rt-row" },
        el("span", { class: "rt-name", text: r.g.icon + " " + r.g.name }),
        el("span", { text: String(r.s.plays) }),
        el("span", { text: fmt(r.s.staked) }),
        el("span", { class: r.net >= 0 ? "good" : "bad", text: (r.net > 0 ? "+" : r.net < 0 ? "-" : "") + fmt(Math.abs(r.net)) })
      ));
    }
    wraps.appendChild(table);
  }

  const jokes = reportJokes(rows, net);
  const list = el("div", { class: "report-jokes" });
  for (const j of jokes) list.appendChild(el("div", { class: "joke", html: j }));
  wraps.appendChild(list);

  return wraps;
}

function openRunReport({ broke = false } = {}) {
  const principal = loanPrincipal(loanBoost());
  const repay = loanRepay(principal);
  const canLoan = !state.loan.active;

  const body = el("div", {},
    el("div", { class: "gameover-emoji", text: broke ? "\u{1F4B8}" : "\u{1F4CB}" }),
    el("div", { class: "gameover-title", text: broke ? "BANKRUPT" : "RUN REPORT" }),
    el("div", { class: "gameover-sub", text: broke
      ? (flavor("bankruptFlavor") || "You are out of chips.")
      : "Everything you won, everything you lost, and a few things you would rather not read." }),
    reportNode(),
    canLoan ? el("div", { class: "offerbox" },
      offerCell("Loan offer", fmt(principal), "you must repay " + fmt(repay)),
      offerCell("Time limit", CONFIG.loanMinutes + ":00", "real time, ticking while you play"),
      offerCell("If you default", "ALL", "perks, level and stats reset")
    ) : null,
    canLoan ? el("div", { class: "loanrules", html:
      "Take the loan and you get <b>" + fmt(principal) + "</b> on the spot, but you must climb back to <b>" + fmt(repay) +
      "</b> within <b>" + CONFIG.loanMinutes + " real minutes</b>. <span class='danger'>Hitting zero while a loan is active is an immediate default.</span> " +
      "Or start a fresh run at " + fmt(CONFIG.startingMoney) + " with no perks and level 1."
    }) : null
  );

  const buttons = [
    { label: "START OVER (" + fmt(CONFIG.startingMoney) + ")", cls: "red", keepOpen: true, onClick: async (m) => {
        const ok = await confirmDialog("Start a new run?", "Perks, level and stats all reset to zero. Are you sure?", "Restart", "red");
        if (ok) { m.close(); endModalOpen = false; doReset(); }
    } },
  ];
  if (canLoan) buttons.push({ label: "TAKE THE LOAN", cls: "gold", keepOpen: true, onClick: (m) => {
    m.close();
    endModalOpen = false;
    const loan = takeLoan(loanBoost());
    if (state.bet < 1) setBet(10);
    tooltipLoan(loan);
    renderTop();
  } });
  if (!broke) buttons.push({ label: "BACK TO THE TABLE", cls: "ghost" });

  modal({
    title: broke ? "The Cage Is Empty" : "Run Report",
    dismissible: !broke,
    width: 760,
    body,
    buttons,
    onClose: () => { endModalOpen = false; },
  });
}

/* =========================================================
   loan button
   ========================================================= */
function openLoanModal() {
  if (state.loan.active) {
    const L = state.loan;
    const ms = loanRemainingMs();
    const canRepay = canAfford(L.repay);
    const body = el("div", {},
      el("div", { class: "gameover-emoji", text: "\u{1F3E6}" }),
      el("div", { class: "gameover-sub", text: "The clock is still running. Reach the repay target and you can settle it whenever you like." }),
      el("div", { class: "offerbox" },
        offerCell("Principal", fmt(L.principal)),
        offerCell("You must repay", fmt(L.repay)),
        offerCell("Time left", clockText(ms)),
        offerCell("Balance", fmt(state.money))
      ),
      el("div", { class: "loanrules", html:
        "Your balance is <b>" + fmt(state.money) + "</b> of the <b>" + fmt(L.repay) + "</b> you owe. " +
        (canRepay
          ? "You can settle it right now if you want \u2014 or leave it and the clock takes the <b>" + fmt(L.repay) + "</b> out of your balance when it hits 00:00."
          : "Keep playing \u2014 reach the target and you can pay it back on the spot or leave the clock to do it. " +
            "<span class='danger'>Hit zero before then and you lose every perk and level.</span>")
      })
    );
    modal({
      title: "Loan Status",
      width: 600,
      body,
      buttons: canRepay
        ? [
            { label: "PAY BACK " + fmt(L.repay) + " NOW", cls: "gold", onClick: () => { payLoanNow(); } },
            { label: "KEEP PLAYING", cls: "ghost" },
          ]
        : [{ label: "KEEP PLAYING", cls: "gold" }],
    });
    return;
  }

  const principal = loanPrincipal(loanBoost());
  const repay = loanRepay(principal);
  modal({
    title: "The Loan Window",
    width: 600,
    body: el("div", {},
      el("div", { class: "gameover-emoji", text: "\u{1F3E6}" }),
      el("div", { class: "gameover-sub", text: flavor("loanFlavor") || "Money now. Consequences later." }),
      el("div", { class: "offerbox" },
        offerCell("You receive", fmt(principal), "into your balance immediately"),
        offerCell("You must repay", fmt(repay), "interest included"),
        offerCell("Time limit", CONFIG.loanMinutes + ":00", "real time, ticking while you play")
      ),
      el("div", { class: "loanrules", html:
        "Get your balance to <b>" + fmt(repay) + "</b> and you are safe: hand the <b>" + fmt(repay) +
        "</b> over whenever you like with the <b>PAY BACK</b> button on the loan bar, or leave it and the clock takes it out of your balance when it reaches 00:00. " +
        "<span class='danger'>If the balance is under " + fmt(repay) + " when the timer hits zero, or you hit zero while the loan is live, you lose every perk, every level and all progress.</span>"
      })
    ),
    buttons: [
      { label: "TAKE THE LOAN (" + fmt(principal) + ")", cls: "gold", onClick: () => {
          const loan = takeLoan(loanBoost());
          if (state.bet < 1) setBet(10);
          tooltipLoan(loan);
          renderTop();
      } },
      { label: "NOT YET", cls: "ghost" },
    ],
  });
}

function tooltipLoan(loan) {
  toast("Loan received: " + fmt(loan.principal) + ". Repay " + fmt(loan.repay) + " within " + CONFIG.loanMinutes + " minutes.", "info", 4200);
  modal({
    title: "The Clock Is Running",
    dismissible: true,
    width: 600,
    body: el("div", {},
      el("div", { class: "gameover-emoji", text: "\u23F0" }),
      el("div", { class: "gameover-sub", text: flavor("loanFlavor") || "Money now. Consequences later." }),
      el("div", { class: "loantimer", text: CONFIG.loanMinutes + ":00 remaining" }),
      el("div", { class: "loanrules", html:
        "You received <b>" + fmt(loan.principal) + "</b>. Get your balance to <b>" + fmt(loan.repay) +
        "</b> and the debt clears automatically (the " + fmt(loan.repay) + " is taken from your balance). " +
        "<span class='danger'>If the timer hits zero first, you lose every perk, every level and all progress.</span>"
      })
    ),
    buttons: [{ label: "LET'S GAMBLE", cls: "gold", onClick: () => {} }],
  });
}

function failLoanFlow() {
  if (endModalOpen) return;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  state.idle.on = false;
  failLoan();
  saveState(true);
  showGameOver("Loan defaulted", "The clock beat you. The man in the suit takes the chips, the perks, the level \u2014 all of it.");
}

function showGameOver(title, reason) {
  endModalOpen = true;
  renderTop();
  modal({
    title: "Run Over",
    dismissible: false,
    width: 620,
    body: el("div", {},
      el("div", { class: "gameover-emoji", text: "\u{1F480}" }),
      el("div", { class: "gameover-title", text: title.toUpperCase() }),
      el("div", { class: "gameover-sub", text: reason }),
      el("div", { class: "offerbox" },
        el("div", { class: "offer" }, el("div", { class: "k", text: "Reached level" }), el("div", { class: "v", text: String(state.level) })),
        el("div", { class: "offer" }, el("div", { class: "k", text: "Total wagered" }), el("div", { class: "v", text: fmtShort(state.stats.wagered) })),
        el("div", { class: "offer" }, el("div", { class: "k", text: "Biggest win" }), el("div", { class: "v", text: fmtShort(state.stats.biggestWin) }))
      )
    ),
    buttons: [{ label: "START OVER AT " + fmt(CONFIG.startingMoney), cls: "gold", onClick: () => doReset() }],
  });
}

function doReset() {
  endModalOpen = false;
  closeAllModals();
  resetRun();
  if (state.bet === undefined) state.bet = 10;
  moneyShown = state.money;
  if (betInput) betInput.value = "10";
  topbar.loanBar.hidden = true;
  mountGame(state.machine);
  renderTop();
  renderStats();
  renderHistoryPanel();
  renderPayoutNote();
  toast("Fresh start. " + fmt(state.money) + " on the table.", "gold", 2600);
}

/* =========================================================
   perk shop
   ========================================================= */
function openPerkShop() {
  const grid = el("div", { class: "perk-grid" });
  const banner = el("div", { class: "shopbanner" });

  const caps = PERK_ORDER
    .filter((id) => PERKS[id].max !== Infinity)
    .map((id) => PERKS[id].name + " " + PERKS[id].max)
    .join(", ");
  const body = el("div", {}, banner, el("p", { class: "shop-note", html:
    "Perks are permanent for the run and <b>stack</b> on every purchase. Stack caps: " + caps + ". " +
    "Fat Stacks and Safety Net pay on your <b>stake</b>, never on the payout, so they cushion your losses without ever riding a jackpot \u2014 and between them they can hand back at most <b>" + (CONFIG.perkBudget * 100).toFixed(1) + "% of the stake on one round</b>, the pit's rake-back budget, which sits under the thinnest edge in the building. You can claw back a slice of the house's edge; you cannot take all of it. " +
    "<b>Fortune</b> is the exception and never caps: each stack lifts the <b>profit on a winning round</b> by " + (CONFIG.profitStack * 100).toFixed(1) + "%, forever \u2014 same odds, bigger reward \u2014 and the price climbs with every stack. " +
    "The pit's little favours sit at the end of the shelf: <b>Gambler</b> lifts the house table limit " +
    "(a bigger felt, never better odds), <b>On the House</b> occasionally eats a losing round whole, " +
    "<b>Pit Boss's Nephew</b> stretches your credit line, and <b>Showboat</b> is pure spectacle \u2014 it pays nothing at all. " +
    "Hover a card's <b>i</b> (or tap it) for that perk's full write-up."
  }), grid);

  function renderBanner() {
    const eff = computeEffects();
    clear(banner);
    banner.appendChild(el("div", { class: "statline" },
      el("div", { class: "item" }, el("b", { text: moneyLabel() }), "balance"),
      el("div", { class: "item" }, el("b", { text: "+" + (eff.winBonus * 100).toFixed(1) + "%" }), "win bonus"),
      el("div", { class: "item" }, el("b", { text: (eff.rebate * 100).toFixed(1) + "%" }), "loss rebate"),
      el("div", { class: "item" }, el("b", { text: "+" + (eff.profitBonus * 100).toFixed(1) + "%" }), "profit"),
      el("div", { class: "item" }, el("b", { text: "+" + (eff.luck * 100).toFixed(1) + "%" }), "luck"),
      el("div", { class: "item" }, el("b", { text: "+" + ((eff.xpMult - 1) * 100).toFixed(0) + "%" }), "xp"),
      el("div", { class: "item" }, el("b", { text: "+" + ((eff.idleSpeed - 1) * 100).toFixed(0) + "%" }), "idle speed"),
      el("div", { class: "item" }, el("b", { text: (eff.compChance * 100).toFixed(0) + "%" }), "losses comped"),
      el("div", { class: "item" }, el("b", { text: game ? fmt(tableLimit()) : "\u2014" }), "table limit")
    ));
    banner.appendChild(el("div", { style: { fontSize: "11px", color: "#8b98b4" }, text: "Level " + state.level + " \u00B7 " + state.stats.plays + " hands played" }));
  }

  /* ---- the info window ----
     Each perk's real write-up (why it exists, what it pays on, where it stops) is
     a paragraph of prose -- far too much for a card two inches wide, which is why
     the old inline copy was clipped where the card ran out. The prose now lives in
     this one floating window, which opens on hover of a card's header and follows
     its card if the shelf scrolls. It is pointer-events:none so it can never sit
     between the player and a BUY button, and the little badge pins it open for
     touch and keyboard, where "hover" does not exist. */
  const pop = el("div", { class: "perk-pop", hidden: true });
  const cardById = {};
  let popped = false;     /* the window is on screen */
  let popPinned = false;  /* it was opened by click/focus, so leaving the card leaves it up */
  let popId = null;       /* which perk it is showing */
  let popAnchor = null;   /* the card element it belongs to */

  function placePop() {
    if (!popAnchor || pop.hidden) return;
    const r = popAnchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight, pad = 10;
    const left = clamp(r.left + r.width / 2 - w / 2, pad, Math.max(pad, innerWidth - w - pad));
    /* above the card by default, under it when the card is near the top of the
       window -- and either way never off the edge, so a card half-scrolled out of
       the shelf still gets a readable window instead of one hanging off-screen */
    let top = r.top - h - 10;
    const below = top < pad;
    if (below) top = r.bottom + 10;
    top = clamp(top, pad, Math.max(pad, innerHeight - h - pad));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.classList.toggle("below", below);
  }

  function showPop(id, anchor) {
    const p = PERKS[id];
    const n = stacksOf(id);
    const maxed = isMaxed(id);
    popped = true; popId = id; popAnchor = anchor;
    clear(pop);
    pop.appendChild(el("div", { class: "pp-head" },
      el("div", { class: "pp-icon", text: p.icon }),
      el("div", {},
        el("div", { class: "pp-name", text: p.name }),
        el("div", { class: "pp-stack", text: n + (p.max === Infinity ? " / \u221E stacks" : " / " + p.max + " stacks") })
      )
    ));
    pop.appendChild(el("div", { class: "pp-body", text: p.blurb }));
    pop.appendChild(el("div", { class: "pp-now", text: n > 0 ? "Now: " + p.stacks(n) + "." : "First stack: " + p.stacks(1) + "." }));
    if (maxed) pop.appendChild(el("div", { class: "pp-max", text: "Fully stacked \u2014 there is nothing left to buy here." }));
    pop.hidden = false;
    placePop();
  }

  function hidePop() {
    popped = false; popPinned = false; popId = null; popAnchor = null;
    pop.hidden = true;
  }

  document.body.appendChild(pop);
  addEventListener("scroll", placePop, true);
  addEventListener("resize", placePop);
  const popKey = (e) => { if (e.key === "Escape") hidePop(); };
  const popDown = (e) => { if (popped && !(popAnchor && popAnchor.contains(e.target))) hidePop(); };
  addEventListener("keydown", popKey);
  addEventListener("pointerdown", popDown, true);

  function renderGrid() {
    clear(grid);
    for (const id of PERK_ORDER) {
      const p = PERKS[id];
      const n = stacksOf(id);
      const maxed = isMaxed(id);
      const cost = perkCost(id);
      const afford = canAfford(cost);
      const card = el("div", { class: "perk" + (maxed ? " maxed" : "") });
      cardById[id] = card;

      const badge = el("button", {
        class: "perk-info", type: "button",
        "aria-label": "What " + p.name + " does",
        onfocus: () => showPop(id, card),
        onblur: () => { if (!popPinned) hidePop(); },
        onclick: (e) => {
          e.stopPropagation();
          if (popped && popPinned && popId === id) hidePop();
          else { popPinned = true; showPop(id, card); }
        },
      }, el("span", { class: "perk-i-glyph", text: "i" }));

      const head = el("div", { class: "perk-top" },
        el("div", { class: "perk-icon", text: p.icon }),
        el("div", {},
          el("div", { class: "perk-name", text: p.name }),
          el("div", { class: "perk-stack", text: n + (p.max === Infinity ? " / \u221E stacks" : " / " + p.max + " stacks") })
        ),
        badge
      );
      /* The card's long prose used to sit right here and got clipped by the card
         it was in. Now the header row is the hover target: the window opens while
         the pointer is on the icon, the name or the badge, and the badge alone
         pins it open for touch and keyboard. */
      head.addEventListener("mouseenter", () => { if (!popPinned) showPop(id, card); });
      head.addEventListener("mouseleave", () => { if (!popPinned) hidePop(); });
      card.appendChild(head);

      /* the one line the card keeps for itself: what this perk is doing right now
         (or what the next stack would do), never the full argument */
      card.appendChild(el("div", {
        class: "perk-now" + (n > 0 ? " on" : ""),
        text: (n > 0 ? "Now: " + p.stacks(n) : "Next: " + p.stacks(1)) + ".",
      }));

      const pips = el("div", { class: "pips" });
      if (p.max === Infinity) {
        for (let i = 0; i < 10; i++) pips.appendChild(el("div", { class: "pip" + (i < Math.min(10, n) ? " on" : "") }));
      } else {
        for (let i = 0; i < p.max; i++) pips.appendChild(el("div", { class: "pip" + (i < n ? " on" : "") }));
      }
      card.appendChild(pips);

      const buyBtn = el("button", {
        class: "btn " + (afford && !maxed ? "gold" : "ghost") + " sm",
        type: "button",
        text: maxed ? "MAXED" : "BUY",
        disabled: maxed || !afford,
        onclick: () => {
          const r = buyPerk(id, 1);
          if (r.ok) {
            toast(p.name + " upgraded! " + p.stacks(stacksOf(id)), "gold", 1800);
            renderAll();
            renderTop();
            renderPayoutNote();
          } else if (r.reason === "poor") toast("Not enough money for " + p.name + ".", "lose", 1600);
        },
      });
      const maxBtn = el("button", {
        class: "btn sm",
        type: "button",
        text: "MAX",
        disabled: maxed || !afford,
        onclick: () => {
          const r = buyPerk(id, 50);
          if (r.ok) {
            toast(p.name + " \u00D7" + r.bought + " for " + fmt(r.spent) + " \u2014 now " + p.stacks(stacksOf(id)), "gold", 2200);
            renderAll();
            renderTop();
            renderPayoutNote();
          } else if (r.reason === "poor") toast("Not enough money.", "lose", 1600);
        },
      });

      card.appendChild(el("div", { class: "perk-buy" },
        el("div", { class: "perk-cost" + (!afford && !maxed ? " cant" : ""), text: maxed ? "\u2014" : fmt(cost) }),
        el("div", { class: "perk-actions" }, buyBtn, maxBtn)
      ));
      grid.appendChild(card);
    }
  }

  /* a re-render rebuilds every card, so an open window has to be re-hung on the
     new element -- and dropped entirely if it is no longer wanted. A pinned window
     survives the redraw (buying a stack must not close the write-up you are
     reading), a hover one does not. */
  function renderAll() {
    const keep = popPinned ? popId : null;
    renderBanner();
    renderGrid();
    if (keep && cardById[keep]) { showPop(keep, cardById[keep]); popPinned = true; }
    else hidePop();
  }

  renderAll();
  const offPerks = on("perks", renderAll);
  const offMoney = on("money", renderAll);
  modal({
    title: "Perk Shop",
    width: 780,
    body,
    onClose: () => {
      offPerks(); offMoney();
      removeEventListener("scroll", placePop, true);
      removeEventListener("resize", placePop);
      removeEventListener("keydown", popKey);
      removeEventListener("pointerdown", popDown, true);
      pop.remove();
    },
    buttons: [
      { label: "NEW RUN (reset everything)", cls: "ghost", keepOpen: true, onClick: async (mm) => {
          const ok = await confirmDialog("Start a new run?", "This wipes your money, perks, level and stats back to the beginning.", "Reset", "red");
          if (ok) { mm.close(); doReset(); }
      } },
      { label: "CLOSE", cls: "gold", onClick: () => {} },
    ],
  });
}

/* =========================================================
   wiring
   ========================================================= */
topbar.idleBtn.addEventListener("click", () => setIdle(!state.idle.on));
topbar.idleBet.addEventListener("change", () => {
  let v = Math.floor(Number(topbar.idleBet.value) || 0);
  if (v < 1) v = 1;
  state.idle.bet = v;
  topbar.idleBet.value = String(v);
  saveState();
});
topbar.shopBtn.addEventListener("click", openPerkShop);
topbar.loanBtn.addEventListener("click", openLoanModal);
if (topbar.loanRepayBtn) topbar.loanRepayBtn.addEventListener("click", tryRepayNow);
topbar.historyBtn.addEventListener("click", openHistoryModal);
topbar.bankruptBtn.addEventListener("click", () => {
  if (endModalOpen) return;
  if (state.infMoney) { toast("\u221E money is on \u2014 you can't go broke.", "gold", 2400); return; }
  openRunReport({ broke: state.money < (game.minBet || 1) });
});

/* =========================================================
   sound
   ========================================================= */
const soundBtn = document.getElementById("soundBtn");
function renderSoundBtn() {
  const on = isEnabled();
  soundBtn.textContent = on ? "\u{1F50A}" : "\u{1F507}";
  soundBtn.classList.toggle("muted", !on);
  soundBtn.title = on ? "Sound on" : "Sound off";
  soundBtn.setAttribute("aria-label", on ? "Mute sound" : "Unmute sound");
}
soundBtn.addEventListener("click", () => {
  toggleSound();
  if (isEnabled()) sfx.click();
  renderSoundBtn();
});
renderSoundBtn();

/* music has its own toggle, separate from the game sound effects */
const musicBtn = document.getElementById("musicBtn");
function renderMusicBtn() {
  const on = isMusicEnabled();
  musicBtn.textContent = "\u{1F3B5}";
  musicBtn.classList.toggle("muted", !on);
  musicBtn.title = on ? "Music on" : "Music off";
  musicBtn.setAttribute("aria-label", on ? "Mute music" : "Unmute music");
}
musicBtn.addEventListener("click", () => {
  toggleMusic();
  renderMusicBtn();
});
renderMusicBtn();
installMusicGesture();
installGlobalSounds();

/* =========================================================
   cheat / code entry
   ========================================================= */
/* infinite money: freeze the real balance, show the infinity glyph, and let
   every purchase through. Turning it off restores the frozen balance. */
function setInfMoney(on) {
  on = !!on;
  if (on === state.infMoney) return state.infMoney;
  if (on) {
    state.infMoneySaved = Math.round(state.money);
    state.infMoney = true;
    toast("\u221E MONEY ON \u2014 the house is paying for everything.", "gold", 2600);
    confetti(45);
  } else {
    state.infMoney = false;
    state.money = Math.round(Number.isFinite(state.infMoneySaved) ? state.infMoneySaved : state.money);
    toast("\u221E MONEY OFF \u2014 back to " + fmt(state.money) + ".", "info", 2600);
  }
  saveState(true);
  moneyShown = state.money;
  renderTop();
  renderStats();
  if (betInput) setBet(currentBet());
  return state.infMoney;
}

/* always-win cheat: boosts luck to the cap and rescues any losing round. */
function setCheatWin(on) {
  state.cheatWin = !!on;
  saveState(true);
  renderTop();
  toast(state.cheatWin ? "ALWAYS WIN ON \u2014 you can't lose a round." : "ALWAYS WIN OFF.", state.cheatWin ? "gold" : "info", 2400);
  return state.cheatWin;
}

function grantMoney(amount, opts = {}) {
  let v = Math.floor(Number(amount) || 0);
  if (!(v > 0)) { toast("Enter an amount to grant.", "lose", 1600); return 0; }
  v = Math.min(v, 1e15);
  addMoney(v);
  if (state.infMoney) state.infMoneySaved = Math.round((Number(state.infMoneySaved) || 0) + v);
  state.stats.cheats = (state.stats.cheats || 0) + 1;
  state.stats.cheatWinnings = (state.stats.cheatWinnings || 0) + v;
  saveState(true);
  renderTop();
  renderStats();
  if (!opts.silent) {
    toast("Granted " + fmt(v) + ".", "gold", 2200);
    confetti(40);
  }
  return v;
}

const CHEAT_CODES = {
  winnerwinnerchikendinner: 1000,
  losergottoeat: 20000,
  isuckatthisgame: 100000,
  whosyourdaddy: 100,
};
const cheatPanel = document.getElementById("cheatPanel");
const cheatInput = document.getElementById("cheatInput");
const cheatBtn = document.getElementById("cheatBtn");

/* ---- admin gate ----
   The word "admin" no longer opens the console on its own: it puts the code window
   into password mode. Only the SHA-256 of the password lives in this file, so the
   plaintext is not sitting in the source for anyone who opens devtools. Be honest
   about what this is: a lock on the door, not a vault. The whole game runs in the
   player's own browser and the save is editable by hand, so a determined cheater
   walks around it — this just stops the password from being readable at a glance.
   The unlock lasts for the session (it resets on reload) and wrong guesses are
   rate-limited. To change the password: sha256 the new one and paste the hex here. */
const ADMIN_PASS_HASH = "eff79a6ac71a2d2e7191427ee2174a7602c67923d131a6309368f5aab2d88957";
const ADMIN_MAX_TRIES = 3;
const ADMIN_LOCKOUT_MS = 30000;
let adminUnlocked = false;
let adminPrompt = false;
let adminTries = 0;
let adminLockUntil = 0;

const cheatHintEl = document.getElementById("cheatHintEl");

function sha256Hex(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then((buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""));
}
function isAdminPass(code) {
  return sha256Hex(code).then((h) => h === ADMIN_PASS_HASH).catch(() => false);
}

function cheatMode(mode) {
  adminPrompt = mode === "pass";
  cheatPanel.classList.toggle("asking", adminPrompt);
  cheatPanel.classList.remove("denied");
  cheatInput.type = adminPrompt ? "password" : "text";
  cheatInput.placeholder = adminPrompt ? "admin password…" : "enter code…";
  if (cheatHintEl) {
    cheatHintEl.hidden = !adminPrompt;
    cheatHintEl.textContent = adminPrompt ? "RESTRICTED \u2014 ADMIN PASSWORD REQUIRED" : "";
  }
  cheatInput.value = "";
}

function askAdminPass() {
  cheatMode("pass");
  setCheatOpen(true);
}

function unlockAdmin() {
  adminUnlocked = true;
  adminTries = 0;
  cheatMode("code");
  setCheatOpen(false);
  toast("Admin access granted.", "gold", 2000);
  openCheatAdmin();
}

function denyAdmin(msg) {
  cheatPanel.classList.remove("denied");
  void cheatPanel.offsetWidth;
  cheatPanel.classList.add("denied");
  toast(msg, "lose", 2400);
}

async function tryAdminPass(code) {
  const now = Date.now();
  if (now < adminLockUntil) {
    denyAdmin("Locked out for another " + Math.ceil((adminLockUntil - now) / 1000) + "s.");
    return;
  }
  if (await isAdminPass(code)) { unlockAdmin(); return; }
  adminTries++;
  const left = ADMIN_MAX_TRIES - adminTries;
  if (left <= 0) {
    adminTries = 0;
    adminLockUntil = Date.now() + ADMIN_LOCKOUT_MS;
    denyAdmin("Access denied \u2014 locked for " + ADMIN_LOCKOUT_MS / 1000 + "s.");
    return;
  }
  cheatInput.value = "";
  cheatInput.focus();
  denyAdmin("Wrong password. " + left + " attempt" + (left === 1 ? "" : "s") + " left.");
}

function setCheatOpen(open) {
  cheatPanel.hidden = !open;
  if (open) { cheatInput.value = ""; setTimeout(() => cheatInput.focus(), 0); }
  else cheatMode("code");
}
cheatBtn.addEventListener("click", () => setCheatOpen(cheatPanel.hidden));
cheatInput.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") { e.stopPropagation(); setCheatOpen(false); return; }
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();
  const code = cheatInput.value.trim();
  if (!code) { setCheatOpen(false); return; }
  if (adminPrompt) { cheatInput.value = ""; tryAdminPass(code); return; }
  setCheatOpen(false);
  const key = code.toLowerCase();
  if (key === "admin") {
    if (adminUnlocked) openCheatAdmin();
    else askAdminPass();
    return;
  }
  if (await isAdminPass(code)) { unlockAdmin(); return; }
  const reward = CHEAT_CODES[key];
  if (Number.isFinite(reward)) {
    addMoney(reward);
    state.stats.cheats = (state.stats.cheats || 0) + 1;
    state.stats.cheatWinnings = (state.stats.cheatWinnings || 0) + reward;
    saveState(true);
    renderTop();
    toast("Code accepted \u2014 " + fmt(reward) + " added.", "gold", 2800);
    confetti(55);
  } else {
    toast("Invalid code.", "lose", 1600);
  }
});

/* =========================================================
   admin console (type "admin" in the code window)
   ========================================================= */
const CHEATER_TIERS = [
  { min: 0, emoji: "\u{1F607}", title: "INNOCENT BYSTANDER", text: "You have not actually cheated yet \u2014 you merely typed the magic word. We will let this one slide. We will also be watching you." },
  { min: 1, emoji: "\u{1F914}", title: "CURIOSITY SEEKER", text: "One little code. Hardly a crime. Still, the house keeps a very long memory and an even longer ledger, and your name is now pencilled into both." },
  { min: 20000, emoji: "\u{1F608}", title: "PETTY CHEATER", text: "You are comfortably cheating now. Nothing catastrophic, but you have definitely looked the croupier in the eye and told a bold-faced lie with a straight face." },
  { min: 100000, emoji: "\u{1F921}", title: "SERIAL CHEATER", text: "This is a lifestyle. You do not gamble any more \u2014 you audit the house and quietly help yourself to whatever you are owed." },
  { min: 500000, emoji: "\u{1F47D}", title: "CASINO MENACE", text: "Security has your photo on the wall. The pit boss has started drinking. Somewhere in a windowless office, an actuary is quietly crying into a spreadsheet." },
  { min: 2000000, emoji: "\u{1F451}", title: "GOD OF THE HOUSE", text: "You are no longer a player. You are a force of nature. The casino is merely a suggestion, and you have decided to ignore it." },
];

function cheaterTier() {
  const w = state.stats.cheatWinnings || 0;
  let tier = CHEATER_TIERS[0];
  let next = null;
  for (let i = 0; i < CHEATER_TIERS.length; i++) {
    if (w >= CHEATER_TIERS[i].min) { tier = CHEATER_TIERS[i]; next = CHEATER_TIERS[i + 1] || null; }
  }
  const pctFill = next ? Math.max(6, Math.min(100, (w / next.min) * 100)) : 100;
  return { tier, next, pctFill };
}

function openCheatAdmin() {
  const cheats = state.stats.cheats || 0;
  const winnings = state.stats.cheatWinnings || 0;
  const { tier, next, pctFill } = cheaterTier();

  const rows = Object.entries(CHEAT_CODES).map(([code, reward]) =>
    el("div", { class: "cheat-row" },
      el("code", { class: "cheat-code", text: code }),
      el("span", { class: "cheat-reward", text: "+" + fmt(reward) })
    )
  );
  rows.push(el("div", { class: "cheat-row here" },
    el("code", { class: "cheat-code", text: "admin" }),
    el("span", { class: "cheat-reward meta", text: "this menu" })
  ));

  const winBtn = el("button", { class: "btn sm ghost", type: "button", onclick: () => { setCheatWin(!state.cheatWin); sync(); } });
  const infBtn = el("button", { class: "btn sm ghost", type: "button", onclick: () => { setInfMoney(!state.infMoney); sync(); } });
  function sync() {
    winBtn.textContent = "ALWAYS WIN: " + (state.cheatWin ? "ON" : "OFF");
    winBtn.className = "btn sm " + (state.cheatWin ? "gold" : "ghost");
    infBtn.textContent = "\u221E MONEY: " + (state.infMoney ? "ON" : "OFF");
    infBtn.className = "btn sm " + (state.infMoney ? "gold" : "ghost");
    maxPerksBtn.disabled = PERK_ORDER.every((id) => PERKS[id].max === Infinity || stacksOf(id) >= PERKS[id].max);
    maxPerksBtn.className = "btn sm " + (maxPerksBtn.disabled ? "ghost" : "gold");
  }

  const customInput = el("input", { class: "cheat-amount", type: "number", min: "1", step: "1000", value: "10000", placeholder: "amount" });
  customInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); grantMoney(customInput.value); } });
  const presetRow = el("div", { class: "cheat-presets" },
    ...[1000, 10000, 100000, 1000000, 1000000000].map((v) =>
      el("button", { class: "btn ghost sm", type: "button", text: "+" + fmtShort(v), onclick: () => grantMoney(v) })
    )
  );

  const maxPerksBtn = el("button", { class: "btn sm ghost", type: "button", text: "MAX ALL PERKS (excl. \u221E)", onclick: () => {
    const n = maxOutFinitePerks();
    renderTop();
    renderStats();
    sync();
    if (n > 0) { toast("Maxed every finite perk (+" + n + " stacks). Fortune left endless.", "gold", 2600); confetti(55); }
    else toast("All finite perks are already maxed.", "info", 1900);
  }});

  const tools = el("div", { class: "cheat-tools" },
    el("div", { class: "cheat-heading", text: "CHEAT TOOLS" }),
    el("div", { class: "cheat-toolrow" },
      el("span", { class: "cheat-toolname", text: "Always win every round" }), winBtn),
    el("div", { class: "cheat-toolrow" },
      el("span", { class: "cheat-toolname", text: "Infinite money (\u221E)" }), infBtn),
    el("div", { class: "cheat-toolrow column" },
      el("span", { class: "cheat-toolname", text: "Grant yourself money" }),
      el("div", { class: "cheat-grant" }, customInput,
        el("button", { class: "btn gold sm", type: "button", text: "GIVE", onclick: () => grantMoney(customInput.value) }))),
    presetRow,
    el("div", { class: "cheat-toolrow" },
      el("span", { class: "cheat-toolname", text: "Max out every perk" }), maxPerksBtn)
  );
  sync();

  const body = el("div", { class: "cheatadmin" },
    el("div", { class: "cheat-badge", text: tier.emoji }),
    el("div", { class: "cheat-kicker", text: "OFFICIAL CHEATER RANKING" }),
    el("div", { class: "cheat-rank", text: tier.title }),
    el("div", { class: "cheat-meter" },
      el("div", { class: "cheat-meter-fill", style: "width:" + pctFill + "%" })
    ),
    el("div", { class: "cheat-next", text: next
      ? "Next rank: " + next.title + " at " + fmt(next.min) + " cheated."
      : "Maximum rank reached. There is nothing left to cheat. Only legend remains." }),
    el("p", { class: "cheat-blurb", text: tier.text }),
    el("div", { class: "cheat-statline" },
      el("span", {}, el("b", { text: String(cheats) }), " code" + (cheats === 1 ? "" : "s") + " used"),
      el("span", {}, el("b", { text: fmt(winnings) }), " cheated out of the house")
    ),
    tools,
    el("div", { class: "cheat-heading", text: "FORTUNE CODES \u2014 type into the \u{1F511} window" }),
    el("div", { class: "cheat-list" }, rows),
    el("div", { class: "cheat-foot", html:
      "Cheating is <b>not</b> a victimless crime. The house has feelings. The house also has your address, and it remembers everything." })
  );

  modal({
    title: "Admin Console",
    width: 560,
    body,
    buttons: [{ label: "CHEAT ON", cls: "gold" }],
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  if (!document.getElementById("modalLayer").hidden) return;
  e.preventDefault();
  playRound(false);
});

on("money", () => { renderStats(); });
on("perks", () => { renderPayoutNote(); });

/* =========================================================
   cloud saves (optional Google sign-in -- see cloudsave.js)
   ========================================================= */
/* A cloud save (or a loaded save file) replaces the whole run, so every panel that
   mirrors that state is rebuilt rather than re-rendered: the stage is re-mounted on
   the incoming machine, and the nav, bet panel, stats, badge and loan bar follow it.
   `canApply` keeps this from ever firing in the middle of a round. */
function reloadAfterCloudSave() {
  closeAllModals();
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  moneyShown = state.money;
  if (!Number.isFinite(state.bet) || state.bet < 1) state.bet = 10;
  mountGame(state.machine || "slots");
  renderTop();
  renderStats();
  if (state.idle.on) setIdle(true);
}

initCloud({
  enabled: !!CONFIG.cloudSaves,
  onApplied: reloadAfterCloudSave,
  canApply: () => !playing,
});

/* =========================================================
   init
   ========================================================= */
/* The privacy policy link (footer, plus the same link inside the cloud panel).
   Resolved at boot because the correct address differs per build -- see privacyUrl(). */
const privacyEl = document.getElementById("privacyLink");
if (privacyEl) privacyEl.href = privacyUrl();

buildBetPanel();
mountGame(state.machine);
renderTop();
renderStats();

tickTimer = setInterval(tick, 500);

window.casino = {
  state, app, playRound, get game() { return game; },
  computeEffects, perkCost, buyPerk, takeLoan, repayLoan, resetRun, clearSave,
  mountGame, setIdle, renderTop, doReset,
  setInfMoney, setCheatWin, grantMoney, maxOutFinitePerks,
  openHistoryModal, renderHistoryPanel,
  sfx, isSoundEnabled: isEnabled, setSoundEnabled, toggleSound,
  cloud,
};

if (loanExpired()) {
  /* The clock ran out while the tab was closed. Settle it the same way
     settleLoanAtDeadline would: out of the balance if that covers the debt,
     otherwise a default. (It used to fail the loan on sight, which contradicted
     the "leave it and the clock does it for you" promise the loan now makes.) */
  const cleared = (state.money >= state.loan.repay || state.infMoney) ? repayLoan() : false;
  if (cleared) {
    toast("The clock ran out while you were away \u2014 the loan settled itself: " + fmt(cleared.repay) + " taken from your balance.", "gold", 5600);
    renderTop();
  } else {
    failLoanFlow();
  }
} else if (state.loan.active) {
  if (CONFIG.loanMinutes * 60000 - loanRemainingMs() > 0) {
    toast("Loan still running \u2014 " + fmt(state.loan.repay) + " to repay.", "info", 3600);
  }
}

console.log("Casino Royale ready. Balance " + fmt(state.money) + ", level " + state.level + ".");
