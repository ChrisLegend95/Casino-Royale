import { el, clear, sleep, toast } from "../ui.js";
import { stageShell, round2 } from "./common.js";
import { infoBtn, openInfo, gridMap, legend, sec, ul, note, cap, payChips } from "./infocard.js";
import { CONFIG } from "../state.js";
import { spriteEl, preloadSprites } from "../sprites.js";

/* =========================================================
   Treasure Chests — nine chests, one pick per play.

   Four of them pay, on a tiered table (chestHigh / chestGem /
   chestMid / chestLow in main.pjs — the default split is a
   champion x4, a gem x2, cash x1, a coin x0.5); ONE is a Lucky
   Star that hands you a second pick; the other four are traps.
   Which chest holds what is reshuffled every round.

   The star's second pick is worth, on average, exactly what a
   random chest is worth, so the whole table returns the sum of the
   four prizes divided by the eight non-star chests:
       4 + 2 + 1 + 0.5 (+ 4 x 0) = 7.5 over 8  ->  93.75%
   of your bet — a real house edge. The four prizes MUST sum to less
   than eight or the machine prints money, so the board is nine cells
   (four paying, four traps, one star) and never fewer. The grid in
   styles.css is three columns because the board is three by three.
   ========================================================= */

const COUNT = 9;
const REWARD_SLOTS = 4;

const TIER_CLASS = ["big", "gem", "", ""];

/* The chests, the prizes, the star and the traps all show artwork from
   src/sprites/ (name table in sprites/README.md). TIER_SPRITE is the prize
   ladder, top first, and FALLBACK is the emoji each one degrades to if its
   file cannot be loaded -- see src/sprites.js. A closed chest is the
   `treasure` sprite, which is what this machine is named after. */
const TIER_SPRITE = ["trophy", "diamond", "mystery", "coin"];
const FALLBACK = {
  trophy: "\u{1F3C6}", diamond: "\u{1F48E}", mystery: "\u{1F4B0}", coin: "\u{1FA99}",
  skull: "\u{1F480}", treasure: "\u{1F381}", star: "\u2B50",
};

/* one chest's icon: the artwork, or its emoji if the file is missing */
function chestIcon(sprite) {
  return spriteEl(sprite, { fallback: FALLBACK[sprite] });
}

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default {
  id: "chest",
  name: "Treasure Chests",
  icon: "\u{1F9F0}",
  action: "OPEN A CHEST",
  blurb: "Nine chests: four pay, four are traps, and one Lucky Star gives you a second pick.",
  minBet: 1,
  /* one pick, one prize -- the top chest is the ceiling */
  maxWinMult: Math.max(CONFIG.chestHigh, CONFIG.chestGem, CONFIG.chestMid, CONFIG.chestLow),
  payoutNote: () =>
    "Nine chests: <b>four of them pay</b>, four are traps, and one is a " +
    "<b>\u2B50 Lucky Star</b> that hands you a free second pick. The paying chests hold " +
    "<b>\u00D7" + CONFIG.chestHigh + "</b>, <b>\u00D7" + CONFIG.chestGem + "</b>, <b>\u00D7" + CONFIG.chestMid +
    "</b> and <b>\u00D7" + CONFIG.chestLow + "</b> on your bet, hidden in random chests each play. " +
    "Expected return is <b>" + round2(((CONFIG.chestHigh + CONFIG.chestGem + CONFIG.chestMid + CONFIG.chestLow) / 8) * 100) + "%</b> of your bet \u2014 a real house edge, like every other table.",

  create(app) {
    let slots = new Array(COUNT).fill(0);
    let star = -1;
    let pickResolver = null;
    let busy = false;

    const iconEls = [];
    const multEls = [];
    const btns = [];
    const grid = el("div", { class: "chest-grid" });

    for (let i = 0; i < COUNT; i++) {
      const icon = el("div", { class: "chest-icon" }, chestIcon("treasure"));
      const mult = el("div", { class: "chest-mult", text: "" });
      const btn = el("button", {
        class: "chest",
        type: "button",
        disabled: true,
        "data-i": i,
        onclick: () => choose(i),
      }, icon, mult);
      iconEls.push(icon);
      multEls.push(mult);
      btns.push(btn);
      grid.appendChild(btn);
    }

    const msgEl = el("div", { class: "chest-msg", text: "Pick a chest. Four of them pay." });
    const detailEl = el("div", { class: "chest-detail", text: "" });

    const root = stageShell(
      "Treasure Chests",
      "Nine chests on the table. Four hold money, four are traps, and one is a Lucky Star that lets you pick again.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "chest-wrap" },
        el("div", { class: "slot-cabinet chest-cab" },
          el("div", { class: "slot-marquee" },
            el("span", { class: "lights" }, el("i"), el("i"), el("i")),
            el("span", { class: "marquee-title", text: "TREASURE CHESTS" }),
            el("span", { class: "sub", text: "4 PAY \u00B7 \u2B50 SECOND CHANCE \u00B7 4 TRAPS" }),
            el("span", { class: "lights" }, el("i"), el("i"), el("i"))
          ),
          grid,
          msgEl,
          detailEl
        )
      )
    );

    function layout() {
      slots = new Array(COUNT).fill(0);
      const spots = shuffled(COUNT);
      const mults = [CONFIG.chestHigh, CONFIG.chestGem, CONFIG.chestMid, CONFIG.chestLow];
      for (let k = 0; k < REWARD_SLOTS; k++) slots[spots[k]] = mults[k];
      /* the ninth chest is the Lucky Star */
      star = spots[REWARD_SLOTS];
    }

    function tierOf(m) {
      if (m >= CONFIG.chestHigh) return 0;
      if (m >= CONFIG.chestGem) return 1;
      if (m >= CONFIG.chestMid) return 2;
      return 3;
    }

    function setEnabled(on, spent) {
      for (let i = 0; i < COUNT; i++) btns[i].disabled = !on || !!(spent && spent.has(i));
    }

    function resetVisual() {
      for (let i = 0; i < COUNT; i++) {
        btns[i].className = "chest";
        clear(iconEls[i]);
        iconEls[i].appendChild(chestIcon("treasure"));
        multEls[i].textContent = "";
      }
    }

    function choose(i) {
      if (!pickResolver) return;
      const r = pickResolver;
      pickResolver = null;
      setEnabled(false, null);
      r(i);
    }

    function waitPick(spent) {
      return new Promise((resolve) => {
        pickResolver = resolve;
        setEnabled(true, spent);
      });
    }

    function setIcon(i, sprite) {
      clear(iconEls[i]);
      iconEls[i].appendChild(chestIcon(sprite));
    }

    function revealChest(i, wasStar) {
      const btn = btns[i];
      btn.classList.add("open");
      if (i === star) {
        btn.classList.add(wasStar ? "star-spent" : "star");
        setIcon(i, "star");
        multEls[i].textContent = wasStar ? "used" : "PICK AGAIN";
        return;
      }
      const m = slots[i];
      if (m > 0) {
        const tier = tierOf(m);
        btn.classList.add("hit");
        if (TIER_CLASS[tier]) btn.classList.add(TIER_CLASS[tier]);
        setIcon(i, TIER_SPRITE[tier]);
        multEls[i].textContent = "\u00D7" + m;
      } else {
        btn.classList.add("trap");
        setIcon(i, "skull");
        multEls[i].textContent = "trap";
      }
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const auto = instant || !!(opts && (opts.idle || opts.auto));
      if (busy) return { multiplier: 0 };
      busy = true;
      layout();
      resetVisual();
      const spent = new Set();
      msgEl.className = "chest-msg";
      msgEl.textContent = instant
        ? "Picking\u2026"
        : auto ? "Picking a chest\u2026"
        : "Pick a chest. Four of them pay.";
      detailEl.textContent = "";

      let chosen = null;
      while (chosen === null) {
        let i;
        if (auto) {
          const open = [];
          for (let k = 0; k < COUNT; k++) if (!spent.has(k)) open.push(k);
          i = open[Math.floor(Math.random() * open.length)];
        } else {
          i = await waitPick(spent);
        }
        if (i < 0) { busy = false; return { multiplier: 1 }; }
        if (app.cheat && i !== star) {
          /* reward rig: whatever the player opened is now the top prize */
          const hi = slots.indexOf(CONFIG.chestHigh);
          if (hi !== -1 && hi !== i) { const t = slots[i]; slots[i] = slots[hi]; slots[hi] = t; }
        }
        revealChest(i, false);
        if (i === star) {
          /* the star pays nothing itself -- it buys another pick */
          spent.add(i);
          setEnabled(false, spent);
          msgEl.className = "chest-msg star";
          msgEl.textContent = "\u2B50 THE LUCKY STAR \u2014 pick again!";
          detailEl.innerHTML = "The star chest is spent. <b>Choose another.</b>";
          if (!instant) {
            app.confetti(18);
            await sleep(900);
          }
          continue;
        }
        chosen = i;
      }

      btns[chosen].classList.add(slots[chosen] > 0 ? "won" : "lost");

      if (instant) {
        for (let i = 0; i < COUNT; i++) if (i !== chosen) revealChest(i, i === star ? spent.has(star) : false);
      } else {
        await sleep(520);
        for (let i = 0; i < COUNT; i++) {
          if (i === chosen) continue;
          if (i === star) { if (spent.has(star)) revealChest(i, true); continue; }
          revealChest(i, false);
          await sleep(105);
        }
      }

      const mult = slots[chosen];
      if (mult > 0) {
        const tier = tierOf(mult);
        msgEl.className = "chest-msg win";
        msgEl.textContent = tier === 0
          ? "THE BIG ONE! \u00D7" + mult + " on your bet."
          : "\u00D7" + mult + " \u2014 you picked a paying chest.";
        const missed = [];
        for (let i = 0; i < COUNT; i++) if (i !== chosen && slots[i] > 0) missed.push("\u00D7" + slots[i]);
        detailEl.innerHTML = missed.length
          ? "<b>" + missed.join("</b> and <b>") + "</b> were still hiding in there."
          : "";
        if (!instant && tier === 0) app.confetti(80);
        else if (!instant) app.confetti(22);
      } else {
        msgEl.className = "chest-msg lose";
        msgEl.textContent = "TRAP. The chest was a dud.";
        const best = Math.max.apply(null, slots);
        const where = slots.indexOf(best);
        detailEl.innerHTML = "\u00D7" + best + " was sitting at chest " + (where + 1) + ". It always is.";
        if (!instant) toast("Ouch \u2014 trapped.", "lose", 1600);
      }

      busy = false;
      return { multiplier: mult };
    }

    function destroy() {
      if (pickResolver) {
        const r = pickResolver;
        pickResolver = null;
        r(-1);
      }
    }

    function openInfoCard() {
      const map = gridMap(3, 3, { cell: 46, gap: 8 });
      const prizeSum = CONFIG.chestHigh + CONFIG.chestGem + CONFIG.chestMid + CONFIG.chestLow;
      const TIERS = [
        { r: 0, c: 0, s: TIER_SPRITE[0], m: CONFIG.chestHigh },
        { r: 0, c: 2, s: TIER_SPRITE[1], m: CONFIG.chestGem },
        { r: 2, c: 0, s: TIER_SPRITE[2], m: CONFIG.chestMid },
        { r: 2, c: 2, s: TIER_SPRITE[3], m: CONFIG.chestLow },
      ];
      const TRAPS = [[0, 1], [1, 0], [1, 2], [2, 1]];
      const STAR = [1, 1];
      const put = (r, c, sprite, lit, color) => {
        const node = map.cells[r][c];
        clear(node);
        node.appendChild(chestIcon(sprite));
        Object.assign(node.style, { display: "grid", placeItems: "center", lineHeight: "1" });
        node.classList.toggle("lit", !!lit);
        if (color) node.style.setProperty("--lc", color);
        else node.style.removeProperty("--lc");
      };
      const capEl = cap("");
      const modes = [
        { label: "ALL", color: "#8b98b4",
          note: "Nine chests, one pick. What's inside is <b>reshuffled every play</b> \u2014 the grid gives nothing away." },
        { label: "PAYS", color: "#37d67a",
          note: "Exactly <b>four</b> chests pay: \u00D7" + CONFIG.chestHigh + ", \u00D7" + CONFIG.chestGem + ", \u00D7" + CONFIG.chestMid + " and \u00D7" + CONFIG.chestLow + " on your bet, one of each." },
        { label: "TRAPS", color: "#ff5f6d",
          note: "Exactly <b>four</b> chests are traps. Pick one and the whole bet is gone." },
        { label: "STAR", color: "#f2c14e",
          note: "Exactly <b>one</b> \u2B50 Lucky Star \u2014 it pays nothing itself, but hands you a <b>free second pick</b>." },
      ];
      const lg = legend(modes.map((m, i) => ({ label: m.label, value: i, color: m.color })),
        (i) => {
          const mode = modes[i == null ? 0 : i];
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) put(r, c, "treasure", false, null);
          if (mode.label === "PAYS") TIERS.forEach((t) => put(t.r, t.c, t.s, true, "#37d67a"));
          if (mode.label === "TRAPS") TRAPS.forEach(([r, c]) => put(r, c, "skull", true, "#ff5f6d"));
          if (mode.label === "STAR") put(STAR[0], STAR[1], "star", true, "#f2c14e");
          capEl.innerHTML = mode.note;
        }, null, 0);

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" },
          el("div", { class: "ic-visual" }, el("div", { class: "ic-scroll" }, map.node), capEl, lg.node)
        ),
        el("div", { class: "ic-col" },
          sec("The setup",
            ul([
              "Nine chests sit on the table and you open <b>exactly one</b>.",
              "<b>Four pay</b>, <b>four are traps</b>, and <b>one is a \u2B50 Lucky Star</b>.",
              "Which chest holds what is shuffled fresh every round \u2014 no chest is ever 'due'.",
            ])
          ),
          sec("The Lucky Star",
            ul([
              "The \u2B50 pays nothing on its own \u2014 it grants a <b>free second pick</b> instead.",
              "The star chest is spent, so the re-pick is drawn from the <b>other eight</b>.",
              "That second pick is worth exactly what a random chest is worth, so it just pays again.",
            ])
          ),
          sec("Expected return",
            ul([
              "One of each of the four prizes is always out there: " + prizeSum + " over eight non-star chests, so the average chest is worth <b>" + round2(prizeSum / 8) + "</b> on your bet.",
              "The star's re-pick is worth that same average, which makes the whole table return <b>" + round2((prizeSum / 8) * 100) + "%</b> of your bet.",
              "The prizes are tuned so the four of them sum to less than eight \u2014 that is where the house edge lives.",
            ])
          )
        )
      );

      const pay = payChips([
        { sprite: TIER_SPRITE[0], glyph: FALLBACK.trophy, main: "\u00D7" + CONFIG.chestHigh, note: "one chest" },
        { sprite: TIER_SPRITE[1], glyph: FALLBACK.diamond, main: "\u00D7" + CONFIG.chestGem, note: "one chest" },
        { sprite: TIER_SPRITE[2], glyph: FALLBACK.mystery, main: "\u00D7" + CONFIG.chestMid, note: "one chest" },
        { sprite: TIER_SPRITE[3], glyph: FALLBACK.coin, main: "\u00D7" + CONFIG.chestLow, note: "one chest" },
        { sprite: "star", glyph: FALLBACK.star, main: "RE-PICK", note: "one chest", cls: "scat" },
      ]);

      openInfo("Treasure Chests \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Pays on your bet", pay, note("Prizes are on your stake, not per credit \u2014 so \u00D7" + CONFIG.chestHigh + " on a $10 bet pays $" + (10 * CONFIG.chestHigh) + "."))
      ));
    }

    /* the closed chests paint their artwork on the first frame, not after it */
    preloadSprites(["treasure", "skull", "star"].concat(TIER_SPRITE));

    return { root, play, actionLabel: "OPEN A CHEST", destroy };
  },
};
