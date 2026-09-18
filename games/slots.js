import { el, clear, sleep, mult, toast } from "../ui.js";
import { stageShell, weightedPickIndex, SPIN_EASE_CSS, spinBlur, BLUR_TICK, randInt,
  SETTLE_MS, settleOffset, setSettleVars, beginSettle, endSettle, clearSettle } from "./common.js";
import { infoBtn, openInfo, svgEl, gridMap, legend, sec, ul, note, cap, payChips } from "./infocard.js";
import { sfx } from "../audio.js";
import { spriteEl, spriteRow, spriteHtml, preloadSprites } from "../sprites.js";

/* Each symbol has artwork in src/sprites/ (see sprites/README.md) plus the emoji
   `glyph` it used to be drawn with. The glyph is now the FALLBACK: if the image
   fails to load, the <img> swaps itself for the emoji (src/sprites.js), so a
   half-uploaded sprite folder degrades to the old look instead of blank reels. */
const SYMBOLS = [
  { id: "cherry", glyph: "\u{1F352}", sprite: "cherry", w: 30, three: 4, two: 1, leftPair: true, tier: 0 },
  { id: "lemon", glyph: "\u{1F34B}", sprite: "lemon", w: 25, three: 7, two: 0, tier: 0 },
  { id: "bell", glyph: "\u{1F514}", sprite: "bell", w: 18, three: 14, two: 2, tier: 1 },
  { id: "gem", glyph: "\u{1F48E}", sprite: "diamond", w: 13, three: 34, two: 3, tier: 1 },
  { id: "seven", glyph: "7\uFE0F\u20E3", sprite: "seven", w: 9, three: 60, two: 4, tier: 2 },
  { id: "star", glyph: "\u2B50", sprite: "star", w: 5, three: 200, two: 10, tier: 2 },
];

const byId = {};
for (const s of SYMBOLS) byId[s.id] = s;

/* one symbol's artwork, at a caller-chosen artwork size */
function symIcon(s, base) {
  return spriteEl(s.sprite, { fallback: s.glyph, base });
}

/* a piece of text with a symbol's artwork inside it: "3× <cherry> — 4x" */
function symLine(s, before, after, base) {
  return el("span", { class: "spr-row" },
    before ? document.createTextNode(before) : null,
    symIcon(s, base),
    after ? document.createTextNode(after) : null
  );
}

const CELL_H = 118;

/* A pair normally pays wherever the two symbols sit, but the cherry pair only
   counts on the left two reels — on the last two it pays nothing. */
function pairLabel(s) {
  if (!s.two) return "\u2013";
  return s.leftPair ? "1st two " + s.two + "x" : "pair " + s.two + "x";
}

function weightsFor(luck) {
  return SYMBOLS.map((s) => {
    let m = 1;
    if (s.tier === 1) m = 1 + luck * 0.2;
    if (s.tier === 2) m = 1 + luck * 0.4;
    return s.w * m;
  });
}

function evaluate(ids) {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  let best = null;
  for (const s of SYMBOLS) {
    const c = counts[s.id] || 0;
    if (c >= 3 && s.three) {
      if (!best || s.three > best.pay) best = { sym: s, pay: s.three, kind: 3 };
    } else if (c === 2 && s.two) {
      /* left-anchored pairs (the cherry) must start on reel 1 */
      if (s.leftPair && !(ids[0] === s.id && ids[1] === s.id)) continue;
      if (!best || s.two > best.pay) best = { sym: s, pay: s.two, kind: 2 };
    }
  }
  return best;
}

export default {
  id: "slots",
  name: "Slots",
  icon: "\u{1F3B0}",
  action: "SPIN",
  blurb: "Three reels, six symbols. Match three, land a premium pair, or catch two cherries on the first two reels.",
  payoutNote: () =>
    'Match <b>3 symbols</b> for a big payout, a <b>pair</b> of ' +
    spriteHtml("bell") + "/" + spriteHtml("diamond") + "/" + spriteHtml("seven") + "/" + spriteHtml("star") + ', ' +
    'or ' + spriteHtml("cherry") + spriteHtml("cherry") + ' on the <b>first two reels</b> \u2014 that one returns your credit (<b>1x</b>). ' +
    'Top prize: three ' + spriteHtml("star") + ' = <span class="k">200x</span>. Base return <b>95.7%</b>; Lucky Coin perks load the reels a little.',
  minBet: 1,
  /* the best triple on the paytable */
  maxWinMult: Math.max(...SYMBOLS.map((s) => s.three)),

  create(app) {
    const root = stageShell(
      "Slot Machine",
      "Match symbols across the payline. Premium symbols pay on pairs, two cherries pay on the first two reels.",
      { info: infoBtn(() => openInfoCard(), "PAY TABLE") },
      el("div", { class: "slots-wrap" },
        el("div", { class: "slot-result", id: "slotResultEl", text: "Place your bet and pull the lever" }),
        el("div", { class: "slot-cabinet" },
          el("div", { class: "slot-marquee" },
            el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i"))),
            el("span", { class: "marquee-title", text: "LUCKY SEVENS" }),
            el("span", { class: "sub", text: "MAX WIN 200x" }),
            el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i")))
          ),
          el("div", { class: "reels", id: "reelsEl" },
            el("div", { class: "payline" }),
            ...[0, 1, 2].map(() =>
              el("div", { class: "reel" }, el("div", { class: "reel-strip" }))
            )
          ),
          el("div", { class: "slot-paywrap" },
            el("div", { class: "pay-head", text: "Payouts per credit" }),
            el("div", { class: "slot-pay" },
              ...SYMBOLS.slice().reverse().map((s) =>
                el("div", { class: "paychip" },
                  symIcon(s),
                  el("b", { text: s.three + "x" }),
                  el("span", { class: "pair", text: pairLabel(s) })
                )
              )
            )
          )
        ),
      )
    );

    const resultEl = root.querySelector("#slotResultEl");
    const reelEls = Array.from(root.querySelectorAll(".reel"));

    function metrics(reel) {
      const c = reel.querySelector(".reel-cell");
      const h = (c && c.offsetHeight) || CELL_H;
      const inner = reel.clientHeight || h;
      return { h, off: (h - inner) / 2 };
    }

    function randSym(a, b) {
      for (let i = 0; i < 14; i++) {
        const s = SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
        if (s.id !== a && s.id !== b) return s;
      }
      return SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
    }

    let staticSyms = [SYMBOLS[0], SYMBOLS[2], SYMBOLS[3]];
    let busy = false, recenterRaf = 0;
    const blurTimers = reelEls.map(() => 0);
    const settleTimers = reelEls.map(() => 0);
    const landYs = reelEls.map(() => 0);

    /* one drum cell: the symbol's artwork, with the emoji as its fallback */
    function cellFor(s) {
      return el("div", { class: "reel-cell" }, symIcon(s));
    }

    function setStatic(syms) {
      staticSyms = syms.slice();
      reelEls.forEach((reel, i) => {
        const strip = reel.querySelector(".reel-strip");
        clear(strip);
        clearSettle(strip);
        strip.style.transition = "none";
        strip.style.filter = "";
        strip.appendChild(cellFor(syms[i]));
        const m = metrics(reel);
        strip.style.transform = "translateY(" + (-m.off) + "px)";
      });
    }
    setStatic(staticSyms);

    // The stage is often still hidden when create() runs, so the very first
    // measurement reads zero-height boxes and the resting symbols land a hair
    // off the payline. Re-centre them as soon as the cabinet is on screen, and
    // again on any resize, so the row always sits on the line.
    function recenter() {
      if (busy) return;
      setStatic(staticSyms);
    }
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (recenterRaf) return;
        recenterRaf = requestAnimationFrame(() => { recenterRaf = 0; recenter(); });
      });
      ro.observe(root.querySelector(".reels"));
    }
    recenterRaf = requestAnimationFrame(() => { recenterRaf = 0; recenter(); });

    function driveBlur(i, dur) {
      stopBlur(i);
      const strip = reelEls[i].querySelector(".reel-strip");
      const cell = strip.querySelector(".reel-cell");
      const h = (cell && cell.offsetHeight) || CELL_H;
      const maxBlur = Math.max(6, Math.min(17, h * 0.11));
      const t0 = performance.now();
      strip.style.filter = "blur(" + maxBlur.toFixed(1) + "px)";
      blurTimers[i] = setInterval(() => {
        const t = (performance.now() - t0) / dur;
        strip.style.filter = "blur(" + spinBlur(t, maxBlur).toFixed(2) + "px)";
      }, BLUR_TICK);
    }

    function stopBlur(i) {
      if (blurTimers[i]) { clearInterval(blurTimers[i]); blurTimers[i] = 0; }
      const strip = reelEls[i].querySelector(".reel-strip");
      if (strip) strip.style.filter = "";
    }

    function startSettle(i) {
      const strip = reelEls[i].querySelector(".reel-strip");
      if (settleTimers[i]) { clearTimeout(settleTimers[i]); settleTimers[i] = 0; }
      beginSettle(strip);
      settleTimers[i] = setTimeout(() => {
        settleTimers[i] = 0;
        endSettle(strip, landYs[i]);
      }, SETTLE_MS);
    }

    function stopSettle(i) {
      if (settleTimers[i]) { clearTimeout(settleTimers[i]); settleTimers[i] = 0; }
      clearSettle(reelEls[i].querySelector(".reel-strip"));
    }

    function startSpin(reel, targetSym, dur, count) {
      const strip = reel.querySelector(".reel-strip");
      clear(strip);
      clearSettle(strip);
      strip.style.filter = "";
      const rows = [];
      let prev = "";
      for (let i = 0; i < count - 1; i++) {
        const s = randSym(prev, i === count - 2 ? targetSym.id : null);
        prev = s.id;
        rows.push(cellFor(s));
      }
      rows.push(cellFor(targetSym));
      rows.forEach((r) => strip.appendChild(r));
      const m = metrics(reel);
      const idx = reelEls.indexOf(reel);
      const landY = -((count - 1) * m.h + m.off);
      const over = settleOffset(m.h);
      landYs[idx] = landY;
      setSettleVars(strip, landY, over);
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      void strip.offsetWidth;
      strip.style.transition = "transform " + dur + "ms " + SPIN_EASE_CSS;
      strip.style.transform = "translateY(" + (landY - over) + "px)";
      driveBlur(idx, dur);
    }

    function burst(reel) {
      const fx = el("div", { class: "reel-landfx" });
      reel.appendChild(fx);
      setTimeout(() => { if (fx.parentNode) fx.parentNode.removeChild(fx); }, 460);
    }

    function clearHighlights() {
      reelEls.forEach((r) => {
        r.classList.remove("win", "spinning", "landed");
        const strip = r.querySelector(".reel-strip");
        if (strip) { strip.style.filter = ""; clearSettle(strip); }
      });
      for (let i = 0; i < blurTimers.length; i++) stopBlur(i);
      for (let i = 0; i < settleTimers.length; i++) stopSettle(i);
      const cab = root.querySelector(".slot-cabinet");
      if (cab) cab.classList.remove("thump");
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      clearHighlights();
      resultEl.className = "slot-result";
      resultEl.textContent = instant ? "" : "Spinning\u2026";

      const luck = app.effects().luck;
      const weights = weightsFor(luck);
      const ids = [];
      const syms = [];
      if (app.cheat) {
        const idx = weightedPickIndex(weights);
        for (let i = 0; i < 3; i++) { ids.push(SYMBOLS[idx].id); syms.push(SYMBOLS[idx]); }
      } else {
        for (let i = 0; i < 3; i++) {
          const idx = weightedPickIndex(weights);
          ids.push(SYMBOLS[idx].id);
          syms.push(SYMBOLS[idx]);
        }
      }
      const win = evaluate(ids);

      if (instant) {
        setStatic(syms);
      } else {
        busy = true;
        reelEls.forEach((r) => { r.classList.add("spinning"); r.classList.remove("landed"); });
        const durs = [900, 1700, 2500].map((d) => d + randInt(110));
        const counts = [18, 34, 50].map((c) => c + randInt(9));
        sfx.spin(durs[durs.length - 1]);
        reelEls.forEach((reel, i) => startSpin(reel, syms[i], durs[i], counts[i]));
        for (let i = 0; i < reelEls.length; i++) {
          await sleep(i === 0 ? durs[0] : durs[i] - durs[i - 1]);
          stopBlur(i);
          const reel = reelEls[i];
          reel.classList.remove("spinning");
          reel.classList.add("landed");
          sfx.reelStop(0);
          burst(reel);
          startSettle(i);
          setTimeout(() => reel.classList.remove("landed"), 440);
          if (i === reelEls.length - 1) {
            const cab = root.querySelector(".slot-cabinet");
            if (cab) {
              cab.classList.remove("thump");
              void cab.offsetWidth;
              cab.classList.add("thump");
              setTimeout(() => cab.classList.remove("thump"), 330);
            }
            if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* blocked */ } }
          }
        }
        staticSyms = syms.slice();
      }
      busy = false;
      reelEls.forEach((r) => r.classList.remove("spinning"));

      if (win) {
        if (win.kind === 3) reelEls.forEach((r) => r.classList.add("win"));
        else reelEls.forEach((reel, i) => { if (ids[i] === win.sym.id) reel.classList.add("win"); });
        const before = win.kind === 3 ? "3\u00D7 " : (win.sym.leftPair ? "FIRST 2 " : "2\u00D7 ");
        const after = "  \u2014  " + win.pay + "x";
        resultEl.className = "slot-result win";
        clear(resultEl);
        resultEl.appendChild(symLine(win.sym, before, after));
        if (!instant) toast(symLine(win.sym, before, after), "win", 1600);
      } else {
        resultEl.className = "slot-result lose";
        /* two cherries on the right-hand reels look like a win but are not —
           say why instead of a bare "no match" */
        const late = ids[0] !== "cherry" && ids[1] === "cherry" && ids[2] === "cherry";
        clear(resultEl);
        resultEl.appendChild(spriteRow(syms.map((s) => ({ name: s.sprite, fallback: s.glyph }))));
        resultEl.appendChild(document.createTextNode("  \u2014  " +
          (late ? "two cherries only pay on the first two reels" : "no match")));
      }

      return { multiplier: win ? win.pay : 0 };
    }

    function destroy() {
      if (ro) { ro.disconnect(); ro = null; }
      if (recenterRaf) { cancelAnimationFrame(recenterRaf); recenterRaf = 0; }
      for (let i = 0; i < blurTimers.length; i++) stopBlur(i);
      for (let i = 0; i < settleTimers.length; i++) stopSettle(i);
      reelEls.forEach((r, i) => {
        r.classList.remove("landed", "spinning");
        const strip = r.querySelector(".reel-strip");
        if (strip) { clearSettle(strip); strip.style.transform = "translateY(" + landYs[i] + "px)"; }
        const fx = r.querySelector(".reel-landfx");
        if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
      });
      const cab = root.querySelector(".slot-cabinet");
      if (cab) cab.classList.remove("thump");
    }

    function openInfoCard() {
      const map = gridMap(3, 1, { cell: 56, gap: 9 });
      map.svg.appendChild(svgEl("polyline", {
        class: "ic-curve", stroke: "#f2c14e", "stroke-width": 4,
        points: [0, 1, 2].map((c) => map.px(c) + "," + map.py(0)).join(" "),
      }));
      const capEl = cap("");
      /* `cells` are sprite names (see sprites/README.md), drawn into the diagram */
      const scen = [
        { label: "3 MATCH", cells: ["star", "star", "star"], win: true,
          note: "Three of the same symbol anywhere on the payline \u2014 three " + spriteHtml("star") + " is the top prize at <b>200\u00D7</b> your credit." },
        { label: "PAIR", cells: ["bell", "bell", "cherry"], win: true,
          note: "A <b>pair</b> pays when it's a premium symbol \u2014 " + spriteHtml("bell") + spriteHtml("bell") + " = <b>2\u00D7</b>, and the pair of " + spriteHtml("star") + " pays <b>10\u00D7</b>." },
        { label: "CHERRY PAIR", cells: ["cherry", "cherry", "lemon"], win: true,
          note: "The <b>first two reels</b> both " + spriteHtml("cherry") + " returns <b>1\u00D7</b> \u2014 your credit back. Move the pair to the last two reels and it pays nothing." },
        { label: "NO WIN", cells: ["cherry", "lemon", "bell"], win: false,
          note: "Three <b>different</b> symbols \u2014 no match, nothing pays." },
      ];
      const lg = legend(scen.map((s, i) => ({
        label: s.label, value: i, color: s.win ? "#f2c14e" : "#8b98b4",
      })), (i) => {
        const s = scen[i == null ? 0 : i];
        map.cells[0].forEach((cellNode, c) => {
          clear(cellNode);
          cellNode.appendChild(spriteEl(s.cells[c]));
          cellNode.classList.toggle("lit", s.win);
          if (s.win) cellNode.style.setProperty("--lc", "#f2c14e");
          else cellNode.style.removeProperty("--lc");
        });
        capEl.innerHTML = s.note;
      }, null, 0);

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" },
          el("div", { class: "ic-visual" }, el("div", { class: "ic-scroll" }, map.node), capEl, lg.node)
        ),
        el("div", { class: "ic-col" },
          sec("How a spin wins",
            ul([
              "All three reels are read together: you win if <b>three of the same symbol</b> land on the payline, if a <b>pair</b> of a premium symbol lands, or if the first two reels are both " + spriteHtml("cherry") + ".",
              "Only your single best result pays \u2014 you never collect two prizes from one spin.",
              "The payline runs straight through the middle of all three reels.",
            ])
          ),
          sec("Pairs",
            ul([
              spriteHtml("bell") + ", " + spriteHtml("diamond") + ", " + spriteHtml("seven") + " and " + spriteHtml("star") + " pay on a pair as well as a triple.",
              spriteHtml("cherry") + spriteHtml("cherry") + " pays <b>1\u00D7</b> \u2014 your credit back \u2014 but only when it sits on the <b>first two reels</b>. The same pair on the last two reels pays nothing.",
              spriteHtml("lemon") + " only pays when all three match.",
              spriteHtml("star") + " is the long shot: <b>200\u00D7</b> a triple, <b>10\u00D7</b> a pair.",
            ])
          ),
          sec("Lucky Coin perks",
            ul([
              "Each Lucky Coin stack nudges the odds of the premium symbols up on every reel \u2014 a small, capped tilt, not a different machine.",
              "The paytable never changes, and the return stays under <b>100%</b> at every luck level.",
            ])
          )
        )
      );

      const pay = payChips(SYMBOLS.slice().reverse().map((s) => ({
        sprite: s.sprite, glyph: s.glyph, main: s.three + "x", note: s.two ? pairLabel(s) : "no pair",
      })));

      openInfo("Lucky Sevens \u2014 Pay Table", el("div", { class: "ic" },
        top,
        sec("Pays per credit", pay, note("Three of a kind is paid per credit staked. A pair pays for the four premium symbols, and " + spriteHtml("cherry") + spriteHtml("cherry") + " pays 1\u00D7 on the first two reels only \u2014 the last two pay nothing. <b>Base return is 95.7%</b> \u2014 the house keeps 4.3 cents on the dollar."))
      ));
    }

    /* warm the six symbol files before the first spin, so the opening reels
       never flash empty (they are cached from here on — see src/sprites.js) */
    preloadSprites(SYMBOLS.map((s) => s.sprite));

    return { root, play, actionLabel: "SPIN", destroy };
  },
};
