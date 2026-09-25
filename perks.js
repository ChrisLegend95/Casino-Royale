import { state, CONFIG, canAfford, addMoney, saveState, emit } from "./state.js";

export const PERKS = {
  luckyCoin: {
    name: "Lucky Coin",
    icon: "\u{1F340}",
    max: 12,
    baseCost: 250,
    growth: 1.6,
    blurb: "A stacked coin tips the odds your way in every game. Deliberately small: luck is an edge here, never an income.",
    effect: (n) => ({ luck: n * CONFIG.luckCoin }),
    stacks: (n) => `+${(n * CONFIG.luckCoin * 100).toFixed(1)}% luck`,
  },
  fatStacks: {
    name: "Fat Stacks",
    icon: "\u{1F4B0}",
    max: 10,
    baseCost: 250,
    growth: 1.6,
    blurb: "A slice extra on every winning hand \u2014 up to +1.5% of your stake at ten stacks, which is the pit's whole rake-back budget for a winning round. It is a cut of your STAKE, not of the payout, and it can never pay more than the round actually won, so it can neither ride a jackpot upward nor turn a scratch win into a fortune. Keep it under the house's edge or it stops being a perk and becomes a job.",
    effect: (n) => ({ winBonus: n * CONFIG.winBonusStack }),
    stacks: (n) => `+${(Math.min(n * CONFIG.winBonusStack, CONFIG.perkBudget) * 100).toFixed(1)}% of your stake on a win${n * CONFIG.winBonusStack >= CONFIG.perkBudget ? " (the rake-back ceiling)" : ""}`,
  },
  safetyNet: {
    name: "Safety Net",
    icon: "\u{1F6DF}",
    max: 10,
    baseCost: 250,
    growth: 1.6,
    blurb: "The house quietly hands back a slice of every losing stake \u2014 up to 1.5% at ten stacks, the rake-back ceiling. Flat and stake-bounded: it refunds at most what you dropped, never a win, so it can never ride a jackpot.",
    effect: (n) => ({ rebate: n * CONFIG.rebateStack }),
    stacks: (n) => `refund ${(Math.min(n * CONFIG.rebateStack, CONFIG.perkBudget) * 100).toFixed(1)}% of your stake on a loss${n * CONFIG.rebateStack >= CONFIG.perkBudget ? " (the rake-back ceiling)" : ""}`,
  },
  quickHands: {
    name: "Quick Hands",
    icon: "\u26A1",
    max: 5,
    baseCost: 200,
    growth: 1.5,
    blurb: "Idle mode plays faster, so the grind speeds up.",
    effect: (n) => ({ idleSpeed: n * 0.15 }),
    stacks: (n) => `idle runs ${n * 15}% faster`,
  },
  scholarship: {
    name: "Scholarship",
    icon: "\u{1F393}",
    max: 5,
    baseCost: 250,
    growth: 1.6,
    blurb: "Learn the tables faster \u2014 every hand pays more XP, so levels (and the table limit that comes with them) arrive sooner.",
    effect: (n) => ({ xpMult: n * 0.25 }),
    stacks: (n) => `+${n * 25}% XP gain`,
  },
  fortune: {
    name: "Fortune",
    icon: "\u{1F31F}",
    max: Infinity,
    baseCost: 400,
    growth: 1.35,
    blurb: "Raw reward. Every stack lifts every table's profit by 0.1%, forever \u2014 same odds, bigger reward. Never stops getting more expensive.",
    effect: (n) => ({ profitBonus: n * CONFIG.profitStack }),
    stacks: (n) => `+${(n * CONFIG.profitStack * 100).toFixed(1)}% profit on a win`,
  },
  showboat: {
    name: "Showboat",
    icon: "\u{1F3A9}",
    max: 3,
    baseCost: 150,
    growth: 1.6,
    blurb: "Winning quietly was never the plan. Every stack makes a win louder \u2014 more confetti, a brighter cheer, and at full stacks a big win gets the SHOWBOAT treatment. There is no money in it whatsoever: this one is about being SEEN.",
    effect: (n) => ({ showboat: n }),
    stacks: (n) => `celebration \u00D7${n}${n >= 3 ? " \u00B7 big wins get the SHOWBOAT" : ""}`,
  },
  comp: {
    name: "On the House",
    icon: "\u{1F378}",
    max: 5,
    baseCost: 600,
    growth: 1.8,
    blurb: "The floor manager likes you. Every stack is a small chance that a round you LOSE is quietly comped \u2014 the whole stake back, no questions. It can only ever hand back the stake, never a win, so it rides nothing; and because it is a full refund rather than a slice it sits OUTSIDE the pit's rake-back budget, which is why five stacks is a 1% roll and not more.",
    effect: (n) => ({ compChance: n * CONFIG.compStack }),
    stacks: (n) => `${(n * CONFIG.compStack * 100).toFixed(1)}% of losing rounds comped`,
  },
  nephew: {
    name: "Pit Boss's Nephew",
    icon: "\u{1F574}",
    max: 3,
    baseCost: 400,
    growth: 1.7,
    blurb: "The man in the suit owes the pit boss a favour, and now you owe the man in the suit. Every stack stretches your credit line by half \u2014 more money on the spot, and a bigger number you have to climb back to. Nepotism is not a discount.",
    effect: (n) => ({ loanMult: n * CONFIG.nephewStack }),
    stacks: (n) => `\u00D7${(1 + n * CONFIG.nephewStack).toFixed(1)} credit line`,
  },
  gambler: {
    name: "Gambler",
    icon: "\u{1F3B2}",
    max: 5,
    baseCost: 5000,
    growth: 1.9,
    blurb: "The limit has never been what stopped you. Every stack lifts the HOUSE table limit by half, so you can put a proper bet on the felt \u2014 and a proper dent in the bankroll. It buys you a bigger table, never better odds, and the price nearly doubles a stack: this is not a perk for a beginner.",
    effect: (n) => ({ tableMult: n * CONFIG.gamblerStack }),
    stacks: (n) => `table limit \u00D7${(1 + n * CONFIG.gamblerStack).toFixed(1)}`,
  },
};

export const PERK_ORDER = ["fortune", "luckyCoin", "fatStacks", "safetyNet", "quickHands", "scholarship",
  "showboat", "comp", "nephew", "gambler"];

/* Levels are read through a clamp rather than trusted. A save written before a
   perk's cap was lowered -- or slammed to the old ceiling by the MAX ALL PERKS
   button that used to sit in the shop -- keeps its raw number in storage, but
   nothing downstream ever sees more than the cap, so an over-max stack count is
   inert rather than a hole. */
export function stacksOf(id) {
  const p = PERKS[id];
  const raw = Math.max(0, Number((state.perks || {})[id]) || 0);
  if (!p || p.max === Infinity) return raw;
  return Math.min(raw, p.max);
}
export function isMaxed(id) {
  const p = PERKS[id];
  if (!p) return true;
  if (p.max === Infinity) return false;
  return stacksOf(id) >= p.max;
}
export function perkCost(id) {
  const p = PERKS[id];
  if (!p) return Infinity;
  const n = stacksOf(id);
  const raw = p.baseCost * Math.pow(p.growth, n);
  return Math.max(p.baseCost, Math.round(raw / 5) * 5);
}

export function computeEffects() {
  /* `tableMult` is the one multiplier here (everything else is a bonus added to
     zero): the Gambler lifts the house TABLE LIMIT, never a payout, so it is the
     only effect that starts at 1. See `tableLimit()` in main.js. */
  const e = { luck: 0, winBonus: 0, rebate: 0, profitBonus: 0, xpMult: 1, idleSpeed: 1,
    tableMult: 1, compChance: 0, showboat: 0, loanMult: 0 };
  e.luck += Math.max(0, state.level - 1) * CONFIG.levelLuck;
  for (const id of Object.keys(state.perks)) {
    const p = PERKS[id];
    if (!p) continue;
    const n = stacksOf(id);
    if (n <= 0) continue;
    const eff = p.effect(n);
    for (const k of Object.keys(eff)) {
      e[k] = (e[k] || 0) + eff[k];
    }
  }
  /* a hard ceiling on luck, so no combination of levels + coins can ever tip a
     machine past 100% -- see the balance book in main.pjs */
  e.luck = Math.max(0, Math.min(Math.max(0, CONFIG.luckCap), e.luck));
  if (state.cheatWin) e.luck = 0.75;
  return e;
}

/* cheat: slam every finite-cap perk to its max in one go. The endless
   `Fortune` perk (max === Infinity) is deliberately left alone. */
export function maxOutFinitePerks() {
  let added = 0;
  for (const id of PERK_ORDER) {
    const p = PERKS[id];
    if (!p || p.max === Infinity) continue;
    const cur = stacksOf(id);
    if (cur < p.max) {
      state.perks[id] = p.max;
      added += p.max - cur;
    }
  }
  if (added > 0) {
    saveState();
    emit("perks");
  }
  return added;
}

export function buyPerk(id, count = 1) {
  const p = PERKS[id];
  if (!p) return { ok: false, reason: "unknown" };
  let bought = 0;
  let spent = 0;
  for (let i = 0; i < count; i++) {
    if (isMaxed(id)) break;
    const cost = perkCost(id);
    if (!canAfford(cost)) break;
    addMoney(-cost);
    state.perks[id] = (state.perks[id] || 0) + 1;
    bought++;
    spent += cost;
  }
  if (bought > 0) {
    saveState();
    emit("perks");
  }
  return { ok: bought > 0, bought, spent, reason: bought ? null : (isMaxed(id) ? "maxed" : "poor") };
}

export function perkShopCount() {
  let n = 0;
  for (const id of PERK_ORDER) {
    if (!isMaxed(id) && canAfford(perkCost(id))) n++;
  }
  return n;
}
