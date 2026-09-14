import { state, CONFIG, canAfford, addMoney, round2, saveState, emit } from "./state.js";

export const PERKS = {
  luckyCoin: {
    name: "Lucky Coin",
    icon: "\u{1F340}",
    max: 5,
    baseCost: 400,
    growth: 2.05,
    blurb: "A stacked coin tips the odds your way in every game.",
    effect: (n) => ({ luck: n * 0.012 }),
    stacks: (n) => `+${(n * 1.2).toFixed(1)}% win chance`,
  },
  fatStacks: {
    name: "Fat Stacks",
    icon: "\u{1F4B0}",
    max: 5,
    baseCost: 500,
    growth: 1.95,
    blurb: "Bigger payouts whenever you hit a winner.",
    effect: (n) => ({ winMult: n * 0.05 }),
    stacks: (n) => `+${n * 5}% winnings`,
  },
  safetyNet: {
    name: "Safety Net",
    icon: "\u{1F6DF}",
    max: 5,
    baseCost: 450,
    growth: 1.95,
    blurb: "The house quietly hands back part of what it takes.",
    effect: (n) => ({ rebate: n * 0.03 }),
    stacks: (n) => `refund ${n * 3}% of every loss`,
  },
  quickHands: {
    name: "Quick Hands",
    icon: "\u26A1",
    max: 5,
    baseCost: 350,
    growth: 1.85,
    blurb: "Idle mode plays faster, so the grind speeds up.",
    effect: (n) => ({ idleSpeed: n * 0.15 }),
    stacks: (n) => `idle runs ${n * 15}% faster`,
  },
  scholarship: {
    name: "Scholarship",
    icon: "\u{1F393}",
    max: 5,
    baseCost: 550,
    growth: 1.95,
    blurb: "Learn the tables faster. Levels are the fairest luck of all.",
    effect: (n) => ({ xpMult: n * 0.25 }),
    stacks: (n) => `+${n * 25}% XP gain`,
  },
  fortune: {
    name: "Fortune",
    icon: "\u{1F31F}",
    max: Infinity,
    baseCost: 200,
    growth: 1.35,
    blurb: "Raw reward. Every stack adds 1% to all winnings, forever. Never stops getting more expensive.",
    effect: (n) => ({ winMult: n * 0.01 }),
    stacks: (n) => `+${n}% winnings`,
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
  const e = { luck: 0, winMult: 1, rebate: 0, xpMult: 1, idleSpeed: 1 };
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
  e.luck = Math.max(0, Math.min(0.75, e.luck));
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

export function totalWinBonusPct() {
  const e = computeEffects();
  return round2((e.winMult - 1) * 100);
}
