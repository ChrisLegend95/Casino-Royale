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
    max: 50,
    baseCost: 250,
    growth: 1.6,
    blurb: "A slice extra on every winning hand \u2014 up to +25% of your stake at fifty stacks. It is a cut of your STAKE, not of the payout, so it can never ride a jackpot upward.",
    effect: (n) => ({ winBonus: n * CONFIG.winBonusStack }),
    stacks: (n) => `+${(n * CONFIG.winBonusStack * 100).toFixed(1)}% of your stake on a win`,
  },
  safetyNet: {
    name: "Safety Net",
    icon: "\u{1F6DF}",
    max: 20,
    baseCost: 250,
    growth: 1.6,
    blurb: "The house quietly hands back a slice of every losing stake \u2014 up to 10% at twenty stacks. Flat and stake-bounded, so it can never ride a jackpot.",
    effect: (n) => ({ rebate: n * CONFIG.rebateStack }),
    stacks: (n) => `refund ${(n * CONFIG.rebateStack * 100).toFixed(1)}% of your stake on a loss`,
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
};

export const PERK_ORDER = ["fortune", "luckyCoin", "fatStacks", "safetyNet", "quickHands", "scholarship"];

export function stacksOf(id) {
  return state.perks[id] || 0;
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
  const e = { luck: 0, winBonus: 0, rebate: 0, profitBonus: 0, xpMult: 1, idleSpeed: 1 };
  e.luck += Math.max(0, state.level - 1) * CONFIG.levelLuck;
  for (const id of Object.keys(state.perks)) {
    const p = PERKS[id];
    if (!p) continue;
    const n = state.perks[id] || 0;
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
