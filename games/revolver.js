import { el, fmt, sleep, floatAtElement } from "../ui.js";
import { stageShell, clamp, round2 } from "./common.js";
import { svgEl, infoBtn, openInfo, sec, ul, note, cap, payChips } from "./infocard.js";
import { state, saveState, CONFIG } from "../state.js";
import { sfx, preloadSpin } from "../audio.js";

/* =========================================================
   Russian Roulette -- a ten-rung ladder, a six-chamber drum,
   and one live round waiting for you to get greedy.

   Six chambers, one buy-in at x1.00. Every shot is a FRESH load
   and a FRESH whirl: nothing carries over and the drum has no
   memory of you. rrLadder (main.pjs) is the whole game -- one row
   per round, giving the bank a blank climbs to and the live rounds
   the next load carries. With the shipped rows the opening round
   is x1.10 on one live round and the tenth is x15.00 on five of
   the six chambers, so the ladder gets richer and deadlier at the
   same time.

   SPIN       The drum whirls, the hammer falls. A blank climbs the
              bank to the next rung and moves the round counter on;
              the live round ends the run and the bank is gone.

   CASH OUT   Any time, at whatever the bank is standing at. The
              bank is never paid until you ask for it, and the number
              on the HUD is exactly what you keep -- rrRake is a cage
              cut and ships at 0. Surviving the top rung takes SPIN
              away entirely: there is nothing left to climb for, so
              the run has to be banked.

   The round being played is shown (the HUD's Round cell, and the
   message after each blank names the next load), but the drum
   itself is never a tell: the load is shuffled fresh for every
   spin and nothing marks where the round is sitting.

   The ladder is NOT fair at any rung. Surviving to round n and
   cashing there returns (the chained survival odds) x (that rung's
   multiplier): 0.917 for round 1, then 0.833, 0.793, 0.579 ... down
   to 0.036 at the top. The whole game is the nerve to walk away,
   and the maths is on the side of whoever does.
   ========================================================= */

const CH = clamp(Math.round(CONFIG.rrChambers) || 6, 4, 8);
const RAKE = clamp(CONFIG.rrRake, 0, 0.5);

/* The shipped ladder, used whenever CONFIG.rrLadder is missing or unusable, so a
   broken or absent pjs table still leaves a playable machine (the rrLadder block in
   main.pjs explains the rows and prints the returns they imply). */
const DEFAULT_LADDER = [
  [1.10, 1], [1.20, 1], [1.37, 1], [1.50, 2], [2.00, 2],
  [2.75, 2], [3.50, 3], [5.00, 3], [7.50, 4], [15.00, 5],
];

/* Normalise whatever came out of main.pjs into ascending {mult, live} rungs: rows
   that are not a sane [multiplier > 1, live >= 1] pair are dropped, live rounds are
   clamped to the drum (a table promising more live rounds than chambers would be
   capped at all-but-one anyway) and the multiplier is rounded to the 2dp the HUD
   prints. */
function buildLadder(src) {
  const rows = [];
  const list = Array.isArray(src) ? src : [];
  for (const r of list) {
    if (!Array.isArray(r)) continue;
    const mult = round2(Number(r[0]));
    const live = Math.round(Number(r[1]));
    if (!Number.isFinite(mult) || mult <= 1 || !Number.isFinite(live) || live < 1) continue;
    rows.push({ mult, live: clamp(live, 1, CH - 1) });
  }
  if (!rows.length) {
    for (const pair of DEFAULT_LADDER) rows.push({ mult: round2(pair[0]), live: clamp(pair[1], 1, CH - 1) });
  }
  rows.sort((a, b) => (a.mult - b.mult) || (a.live - b.live));
  return rows;
}

const LADDER = buildLadder(CONFIG.rrLadder);
const RUNGS = LADDER.length;
const TOP_MULT = LADDER[RUNGS - 1].mult;
const TOP_LIVE = LADDER[RUNGS - 1].live;
/* where the HUD starts calling the bank hot, and where a blank is worth confetti:
   the middle rung and the 60%-up rung of whatever ladder is in play */
const HOT_MULT = LADDER[Math.max(0, Math.ceil(RUNGS / 2) - 1)].mult;
const BIG_MULT = LADDER[Math.max(0, Math.ceil(RUNGS * 0.6) - 1)].mult;

/* The rung standing on the table after `survived` blanks. This single lookup decides
   both how heavy the next load is and what the next blank pays, so the ladder in
   main.pjs is the only thing that shapes a run. Past the top rung it sticks on the
   last row (SPIN is disabled there, so nothing should ever ask). */
function rungFor(survived) {
  return LADDER[clamp(Math.floor(survived) || 0, 0, RUNGS - 1)];
}

const CX = 100, CY = 106, RING_R = 62, HOLE_R = 17.5, STEP = 360 / CH;
const SPIN_MS = 1800;
/* The whirl is cut to the recorded cylinder: the take plays at a rate fitted so
   its final clack lands on the end of the spin, and the drum passes exactly one
   chamber per clack. SPIN_MS is how long that spin lasts -- the only knob that
   changes how fast the drum goes round. SPINS_MIN/SPINS_MAX are the whole
   revolutions the fallback uses when the recording is unavailable, since a
   synthesized whirl has no clack times to cut to. */
const SPINS_MIN = 3, SPINS_MAX = 5;

const r2 = (n) => Math.round(n * 100) / 100;

/* the load sitting in the drum this spin -- only ever consulted to answer
   "was the chamber the hammer landed on live?", never shown to the player */
function rolledLoad(live) {
  const arr = new Uint8Array(CH);
  for (let i = 0; i < live; i++) arr[i] = 1;
  for (let i = CH - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function ptAt(deg, r) {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/* a live round / an empty chamber, drawn at local (0,0) so it stays upright */
function chamberFace() {
  return svgEl("g", { class: "rr-face" },
    svgEl("g", { class: "rr-bullet" },
      svgEl("path", { d: "M-3.4 -5 C-3.4 -9.4 -1.1 -11.6 0 -13.6 C1.1 -11.6 3.4 -9.4 3.4 -5 Z" }),
      svgEl("rect", { x: -3.4, y: -5.1, width: 6.8, height: 9.4, rx: 1.1 }),
      svgEl("rect", { class: "rr-rim", x: -4.2, y: 2.9, width: 8.4, height: 2.4, rx: 1.2 })
    ),
    svgEl("g", { class: "rr-empty" },
      svgEl("circle", { r: 6.2 }),
      svgEl("path", { d: "M-3.2 -3.2 L3.2 3.2 M3.2 -3.2 L-3.2 3.2" })
    )
  );
}

/* gradients + sheen shared by the play drum and the info-card mini */
function drumDefs() {
  return svgEl("defs", {},
    svgEl("radialGradient", { id: "rrDrumGrad", cx: "38%", cy: "25%", r: "88%" },
      svgEl("stop", { offset: "0%", "stop-color": "#3f4d75" }),
      svgEl("stop", { offset: "33%", "stop-color": "#242f4b" }),
      svgEl("stop", { offset: "72%", "stop-color": "#131b2b" }),
      svgEl("stop", { offset: "100%", "stop-color": "#05080e" })
    ),
    svgEl("radialGradient", { id: "rrCaseGrad", cx: "38%", cy: "16%", r: "96%" },
      svgEl("stop", { offset: "0%", "stop-color": "#a3b4da" }),
      svgEl("stop", { offset: "36%", "stop-color": "#5d6e98" }),
      svgEl("stop", { offset: "72%", "stop-color": "#2b3550" }),
      svgEl("stop", { offset: "100%", "stop-color": "#151c2a" })
    ),
    svgEl("radialGradient", { id: "rrHoleGrad", cx: "34%", cy: "26%", r: "82%" },
      svgEl("stop", { offset: "0%", "stop-color": "#7d8fb9" }),
      svgEl("stop", { offset: "40%", "stop-color": "#3c486c" }),
      svgEl("stop", { offset: "100%", "stop-color": "#141a29" })
    ),
    svgEl("radialGradient", { id: "rrGlassGrad", cx: "50%", cy: "38%", r: "76%" },
      svgEl("stop", { offset: "0%", "stop-color": "#151f31" }),
      svgEl("stop", { offset: "58%", "stop-color": "#06090f" }),
      svgEl("stop", { offset: "100%", "stop-color": "#000104" })
    ),
    svgEl("linearGradient", { id: "rrBrassGrad", x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
      svgEl("stop", { offset: "0%", "stop-color": "#7a570f" }),
      svgEl("stop", { offset: "28%", "stop-color": "#f5da86" }),
      svgEl("stop", { offset: "58%", "stop-color": "#d9a02a" }),
      svgEl("stop", { offset: "100%", "stop-color": "#66430d" })
    ),
    svgEl("linearGradient", { id: "rrSteelGrad", x1: "0%", y1: "0%", x2: "0%", y2: "100%" },
      svgEl("stop", { offset: "0%", "stop-color": "#a8b8de" }),
      svgEl("stop", { offset: "48%", "stop-color": "#5b6a94" }),
      svgEl("stop", { offset: "100%", "stop-color": "#28314a" })
    ),
    svgEl("radialGradient", { id: "rrSheen" },
      svgEl("stop", { offset: "0%", "stop-color": "rgba(255,255,255,.26)" }),
      svgEl("stop", { offset: "52%", "stop-color": "rgba(255,255,255,.07)" }),
      svgEl("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" })
    )
  );
}

function cylBack() {
  return [
    svgEl("circle", { class: "rr-case", cx: CX, cy: CY, r: 92 }),
    svgEl("circle", { class: "rr-drum", cx: CX, cy: CY, r: 86 }),
    svgEl("ellipse", {
      class: "rr-sheen", cx: CX - 26, cy: CY - 36, rx: 54, ry: 40,
      transform: "rotate(-32 " + (CX - 26) + " " + (CY - 36) + ")",
    }),
    svgEl("circle", { class: "rr-track", cx: CX, cy: CY, r: RING_R }),
    svgEl("circle", { class: "rr-bevel", cx: CX, cy: CY, r: 85.2 }),
  ];
}

/* a still drum for the info card, with the live rounds spread around the ring */
function miniCyl(liveIdx) {
  const svg = svgEl("svg", { class: "rr-svg rr-mini", viewBox: "0 0 200 200" });
  svg.appendChild(drumDefs());
  for (const node of cylBack()) svg.appendChild(node);
  for (let i = 0; i < CH; i++) {
    const [x, y] = ptAt(-90 + i * STEP, RING_R);
    const live = liveIdx.indexOf(i) !== -1;
    const g = svgEl("g", {
      class: "rr-ch open " + (live ? "live" : "blank"),
      transform: "translate(" + r2(x) + " " + r2(y) + ")",
    });
    g.appendChild(svgEl("circle", { class: "rr-hole", r: HOLE_R }));
    g.appendChild(svgEl("circle", { class: "rr-glass", r: HOLE_R - 3.4 }));
    g.appendChild(chamberFace());
    svg.appendChild(g);
  }
  svg.appendChild(svgEl("circle", { class: "rr-pin", cx: CX, cy: CY, r: 9 }));
  return svg;
}

export default {
  id: "revolver",
  name: "Russian Roulette",
  icon: "\u{1F52B}",
  action: "LOAD THE CYLINDER",
  canIdle: false,
  minBet: 1,
  blurb: "Six chambers and a ten-rung ladder you buy into once: a blank climbs the bank up the ladder, the live round ends the run and takes it. It opens at ×" +
    LADDER[0].mult.toFixed(2) + " on " + LADDER[0].live + " live round and the top rung is ×" + TOP_MULT.toFixed(2) +
    " on " + TOP_LIVE + " of the " + CH + " chambers — a single empty one. Cash out any time, and the number the bank shows is exactly what you keep.",
  payoutNote: () =>
    "One buy-in at ×1.00, one bank, and a drum re-loaded and spun fresh before every shot. Each round is one rung of a <b>" + RUNGS +
    "-round ladder</b>: round 1 pays ×" + LADDER[0].mult.toFixed(2) + " on <b>" + LADDER[0].live + " live</b> of " + CH +
    ", and the top rung pays ×" + TOP_MULT.toFixed(2) + " on <b>" + TOP_LIVE + " live</b> — a single empty chamber left. A blank climbs to the next rung; the live round ends the run and the bank goes with it. There is nothing left to spin for once you are at the top, so <b>CASH OUT</b> any time " +
    (RAKE > 0
      ? "keeps what you hold less a <b>" + (RAKE * 100).toFixed(1) + "%</b> cut at the cage."
      : "keeps exactly what the bank says — no cut, no fine print."),

  create(app) {
    if (!state.revolver || !Number.isFinite(state.revolver.bestMult)) {
      state.revolver = { bestMult: 1, runs: 0, busts: 0 };
    }
    preloadSpin();
    const R = state.revolver;
    if (!Number.isFinite(R.runs)) R.runs = 0;
    if (!Number.isFinite(R.busts)) R.busts = 0;
    const bestOf = () => (Number.isFinite(R.bestMult) ? R.bestMult : 1);

    /* ---------- run state ---------- */
    let stake = Math.max(1, Math.round(Number(app.bet) || 1));
    let bank = 1;               // the multiplier on the table, opened at x1.00
    let blanks = 0;             // rounds survived this run
    let order = rolledLoad(rungFor(0).live);
    let landIdx = 0;            // the chamber under the hammer
    let outcome = null;         // null | "safe" | "dead"
    let phase = "idle";         // idle | ready | spinning | over
    let destroyed = false;
    let busy = false;
    let quiet = false;
    let actionResolve = null;
    let rotOff = 0;
    let tweenRaf = null;
    let tweenResolve = null;
    let queued = null;
    let hurtTimer = null;

    const canAct = () => phase === "ready" && !!actionResolve && !destroyed;
    const netNow = () => round2(bank * (1 - RAKE));           // what the cage would pay

    /* ---------- the drum ---------- */
    const svg = svgEl("svg", { class: "rr-svg", viewBox: "0 0 200 200", role: "img", "aria-label": "A revolver cylinder" });
    svg.appendChild(drumDefs());
    for (const node of cylBack()) svg.appendChild(node);

    const notches = svgEl("g", { class: "rr-notches" });
    for (let i = 0; i < CH; i++) {
      const a = -90 + i * STEP + STEP / 2;
      const [x1, y1] = ptAt(a, 74);
      const [x2, y2] = ptAt(a, 84.5);
      notches.appendChild(svgEl("line", { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) }));
    }
    svg.appendChild(notches);

    const chambers = [];
    for (let i = 0; i < CH; i++) {
      const g = svgEl("g", { class: "rr-ch" });
      g.appendChild(svgEl("circle", { class: "rr-hole", r: HOLE_R }));
      g.appendChild(svgEl("circle", { class: "rr-glass", r: HOLE_R - 3.4 }));
      g.appendChild(chamberFace());
      svg.appendChild(g);
      chambers.push(g);
    }

    svg.appendChild(svgEl("circle", { class: "rr-pin", cx: CX, cy: CY, r: 9 }));
    svg.appendChild(svgEl("circle", { class: "rr-pin2", cx: CX, cy: CY, r: 3.2 }));
    const flash = svgEl("circle", { class: "rr-flash", cx: CX, cy: CY - RING_R, r: HOLE_R + 4 });
    svg.appendChild(flash);
    const hammer = svgEl("g", { class: "rr-hammer" },
      svgEl("rect", { x: 95.4, y: 3, width: 9.2, height: 8, rx: 2.4 }),
      svgEl("path", { d: "M93.5 10.5 L106.5 10.5 L104 20 L96 20 Z" })
    );
    svg.appendChild(hammer);
    const pointer = svgEl("path", { class: "rr-pointer", d: "M" + CX + " 25 l-6.5 -9.8 l13 0 Z" });
    svg.appendChild(pointer);

    /* ---------- hud / chrome ---------- */
    const hudRound = el("span", { text: "1/" + RUNGS });
    const hudBank = el("span", { text: "1.00" });
    const hudCash = el("span", { text: fmt(stake) });
    const hudBest = el("span", { text: bestOf().toFixed(2) });
    const bigMult = el("b", { class: "rr-bigmult", text: "\u00D71.00" });
    const msgEl = el("div", { class: "rr-msg", text: "" });
    const hintEl = el("div", { class: "rr-hint" });

    /* ---------- controls ---------- */
    const spinSub = el("span", { class: "key", text: "round 1 of " + RUNGS });
    const cashSub = el("span", { class: "key", text: "keep " + fmt(stake) });
    const spinBtn = el("button", { class: "rrbtn spin", type: "button", disabled: true, onclick: () => act("spin") },
      el("span", { class: "lbl", text: "SPIN" }), spinSub);
    const cashBtn = el("button", { class: "rrbtn cash", type: "button", disabled: true, onclick: () => act("cash") },
      el("span", { class: "lbl", text: "CASH OUT" }), cashSub);

    const cab = el("div", { class: "slot-cabinet rr-cab" },
      el("div", { class: "slot-marquee" },
        el("span", { class: "lights" }, el("i"), el("i"), el("i")),
        el("span", { class: "marquee-title", text: "RUSSIAN ROULETTE" }),
        el("span", { class: "sub", text: CH + " CHAMBERS · " + RUNGS + " ROUNDS" }),
        el("span", { class: "lights" }, el("i"), el("i"), el("i"))
      ),
      el("div", { class: "rr-hud" },
        el("div", { class: "ahud" }, el("span", { class: "k", text: "Round" }), el("span", { class: "v" }, hudRound)),
        el("div", { class: "ahud" }, el("span", { class: "k", text: "Bank" }), el("span", { class: "v gold" }, el("span", { text: "\u00D7" }), hudBank)),
        el("div", { class: "ahud" }, el("span", { class: "k", text: "Cash out" }), el("span", { class: "v" }, hudCash)),
        el("div", { class: "ahud" }, el("span", { class: "k", text: "Best ever" }), el("span", { class: "v" }, el("span", { text: "\u00D7" }), hudBest))
      ),
      el("div", { class: "rr-screen" }, svg, bigMult),
      msgEl,
      el("div", { class: "rr-controls" }, spinBtn, cashBtn),
      hintEl
    );

    const root = stageShell(
      "Russian Roulette",
      "Six chambers and a " + RUNGS + "-round ladder you buy into once — round 1 pays ×" + LADDER[0].mult.toFixed(2) +
      " and the top rung pays ×" + TOP_MULT.toFixed(2) + " on " + TOP_LIVE + " of the " + CH + " chambers, with a single empty one left.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "rr-wrap" }, cab)
    );

    /* ---------- drum rendering ---------- */
    function paint() {
      for (let i = 0; i < CH; i++) {
        const g = chambers[i];
        const [x, y] = ptAt(-90 + (i - landIdx) * STEP + rotOff, RING_R);
        g.setAttribute("transform", "translate(" + r2(x) + " " + r2(y) + ")");
        const hit = i === landIdx;
        const armed = phase === "ready" || phase === "spinning";
        g.classList.toggle("now", hit && armed);
        g.classList.toggle("live", hit && outcome === "dead");
        g.classList.toggle("blank", hit && outcome === "safe");
        g.classList.toggle("dead", hit && outcome === "dead");
      }
      notches.setAttribute("transform", "rotate(" + r2(-landIdx * STEP + rotOff) + " " + CX + " " + CY + ")");
    }

    /* Where the whirl has got to, as a fraction of the whole spin, at spin-time
       fraction k. With the recorded cylinder's clack times (`keys`, ascending
       fractions of the spin) the drum steps exactly one chamber per clack, in
       proportion to the gaps between them, and rocks out on the latch when it
       locks. With no take to follow it is the old quart-out: a hard snap and a
       long glide. */
    function spinProgress(keys, k) {
      if (!keys || !keys.length) return 1 - Math.pow(1 - k, 4);
      if (k <= 0) return 0;
      const n = keys.length;
      const last = keys[n - 1];
      if (k >= last) {
        if (k >= 1) return 1;
        /* the drum has locked under the pin: it overshoots by exactly the speed
           it arrived with (so the motion stays continuous) and settles back */
        const tail = Math.max(1e-6, 1 - last);
        const arrive = Math.max(1e-6, last - keys[n - 2]);
        const speed = (1 / n) / arrive;               // chambers per fraction of the spin
        const ov = (speed * tail) / Math.PI;
        return 1 + ov * Math.sin((Math.PI * (k - last)) / tail);
      }
      if (k < keys[0]) return (k / Math.max(1e-6, keys[0])) * (1 / n);
      let i = 0;
      while (i < n - 1 && keys[i + 1] <= k) i++;
      const k0 = keys[i];
      return (i + 1) / n + ((k - k0) / Math.max(1e-6, keys[i + 1] - k0)) * (1 / n);
    }

    /* one long whirl: rotOff sweeps `from` -> 0 (the landing chamber ends under
       the hammer) and the chambers smear in proportion to how fast they are
       actually moving, frame to frame. `delayMs` holds the whole thing back by
       the audio output latency, so the picture keeps step with the sound the
       player is hearing rather than the one being emitted. */
    function animateSpin(from, ms, keys, delayMs) {
      return new Promise((resolve) => {
        if (tweenRaf) { cancelAnimationFrame(tweenRaf); tweenRaf = null; }
        rotOff = from;
        paint();
        if (destroyed || ms <= 0) { rotOff = 0; setBlur(0); paint(); resolve(); return; }
        const start = performance.now() + (Number(delayMs) || 0);
        const span = Math.abs(from);
        let prevP = 0, prevT = start, blur = 0;
        const step = (t) => {
          const k = Math.min(1, (t - start) / ms);
          const p = spinProgress(keys, k);
          rotOff = from * (1 - p);
          const v = ((p - prevP) * span * 1000) / Math.max(1, t - prevT);   // degrees per second
          prevP = p; prevT = t;
          blur += (10 * Math.pow(Math.min(1, v / 3000), 1.3) - blur) * 0.4;
          setBlur(blur);
          paint();
          if (k < 1 && !destroyed) tweenRaf = requestAnimationFrame(step);
          else { tweenRaf = null; tweenResolve = null; rotOff = 0; setBlur(0); paint(); resolve(); }
        };
        tweenResolve = resolve;            // so a whirl cut short can still resolve
        tweenRaf = requestAnimationFrame(step);
      });
    }

    function setBlur(px) {
      svg.style.setProperty("--rr-blur", px.toFixed(2) + "px");
    }

    /* ---------- ui ---------- */
    function refresh() {
      const ready = phase === "ready";
      const over = phase === "over";
      const spinning = phase === "spinning";
      const top = blanks >= RUNGS;                  // stood on the last rung: nothing left to climb
      const round = Math.min(blanks + 1, RUNGS);    // the round on the table now
      const net = netNow();
      hudRound.textContent = round + "/" + RUNGS;
      hudRound.parentElement.className = "v" + (top ? " warn" : "");
      hudBank.textContent = bank.toFixed(2);
      hudBank.parentElement.className = "v " + (bank <= 0 ? "bad" : bank >= BIG_MULT ? "safe" : "gold");
      hudCash.textContent = fmt(stake * net);
      hudBest.textContent = bestOf().toFixed(2);
      bigMult.textContent = "\u00D7" + bank.toFixed(2);
      bigMult.classList.toggle("hot", bank >= HOT_MULT);
      spinBtn.disabled = !ready || top;
      cashBtn.disabled = !(ready && bank > 0);
      spinSub.textContent = spinning ? "the drum is turning…"
        : ready && top ? "top of the ladder \u2014 cash it"
          : ready ? "round " + round + " of " + RUNGS + " \u00B7 " + rungFor(blanks).live + " live"
            : over && bank > 0 ? "run banked" : "the drum is loaded";
      cashSub.textContent = ready ? "keep " + fmt(stake * net)
        : over && bank > 0 ? "banked " + fmt(stake * net) : "nothing to bank";
      svg.classList.toggle("ready", ready);
      svg.classList.toggle("spinning", spinning);
      svg.classList.toggle("over", over);
      paint();
    }

    function say(html, cls) {
      msgEl.className = "rr-msg" + (cls ? " " + cls : "");
      msgEl.innerHTML = html;
    }

    function popMult() {
      bigMult.classList.remove("pop");
      void bigMult.getBoundingClientRect();
      bigMult.classList.add("pop");
    }

    function hurt() {
      const wrap = root.querySelector(".rr-wrap");
      if (!wrap) return;
      wrap.classList.remove("hurt");
      void wrap.getBoundingClientRect();
      wrap.classList.add("hurt");
      if (hurtTimer) clearTimeout(hurtTimer);
      hurtTimer = setTimeout(() => { if (!destroyed) wrap.classList.remove("hurt"); }, 760);
    }

    /* ---------- the shot ---------- */
    /* wipe last spin's flash classes so a stale "safe" can never tint the
       chamber the hammer is about to land on */
    function clearShotFx() {
      svg.classList.remove("cocking", "fired", "bang", "safe");
    }

    function fire(dead) {
      return new Promise((resolve) => {
        if (destroyed) { resolve(); return; }
        svg.classList.remove("cocking", "fired", "bang", "safe");
        void svg.getBoundingClientRect();
        svg.classList.add("cocking");
        sfx.cock();
        setTimeout(() => {
          if (destroyed) { resolve(); return; }
          outcome = dead ? "dead" : "safe";
          svg.classList.add("fired");
          paint();
          if (dead) { svg.classList.add("bang"); sfx.gunshot(); }
          else { svg.classList.add("safe"); sfx.dryFire(); }
          setTimeout(resolve, dead ? 620 : 250);
        }, 230);
      });
    }

    async function spin() {
      const rung = rungFor(blanks);
      order = rolledLoad(rung.live);
      landIdx = Math.floor(Math.random() * CH);
      const dead = !!order[landIdx];
      outcome = null;
      clearShotFx();
      phase = "spinning";
      refresh();
      const turns = SPINS_MIN + Math.floor(Math.random() * (SPINS_MAX - SPINS_MIN + 1));
      const plan = sfx.cylinder(SPIN_MS, turns, CH) || { ms: SPIN_MS, steps: turns * CH, keys: null };
      await animateSpin(-plan.steps * STEP, plan.ms, plan.keys, plan.delayMs);
      if (destroyed) return false;
      await sleep(quiet ? 0 : 170);
      if (destroyed) return false;
      await fire(dead);
      if (destroyed) return false;

      if (dead) {
        bank = 0;
        phase = "over";
        R.busts = (R.busts || 0) + 1;
        saveState();
        hurt();
        say("<b>BANG.</b> The round was live \u2014 the bank goes with you and the run ends here.", "lose");
        if (!quiet) sfx.lose();
        refresh();
        return true;
      }

      bank = rung.mult;
      blanks += 1;
      const round = Math.min(blanks + 1, RUNGS);
      const next = rungFor(blanks);
      say("<b>CLICK \u2014 blank.</b> The bank climbs to \u00D7<b>" + bank.toFixed(2) + "</b> \u00B7 round " + blanks +
        " survived" + (blanks === RUNGS
          ? " \u2014 <b>that is the top of the ladder</b>, and there is nothing left to spin for."
          : ", and round <b>" + round + "</b> loads <b>" + next.live + " live</b>."), "win");
      popMult();
      if (!quiet) {
        floatAtElement(svg, "\u00D7" + bank.toFixed(2), "win");
        if (bank >= BIG_MULT) app.confetti(bank >= TOP_MULT ? 60 : 28);
      }
      refresh();
      return false;
    }

    async function cashOut() {
      phase = "over";
      const m = netNow();
      if (m > bestOf()) R.bestMult = m;
      saveState();
      say("<b>CASHED OUT at ×" + m.toFixed(2) + ".</b> " + blanks + " round" + (blanks === 1 ? "" : "s") +
        " survived and a live round that never found you. " +
        (RAKE > 0
          ? "The cage takes its " + (RAKE * 100).toFixed(1) + "% and the money is yours."
          : "The bank is yours, to the cent."), "win");
      sfx.cash(m >= TOP_MULT ? 4 : m >= BIG_MULT ? 3 : m >= LADDER[Math.min(RUNGS - 1, 1)].mult ? 2 : 1);
      if (!quiet && m >= BIG_MULT) app.confetti(m >= TOP_MULT ? 90 : 40);
      refresh();
      return m;
    }

    /* ---------- the turn loop ---------- */
    /* A press is honoured the moment the round is listening. The SPIN button is
       live from the first frame of the run, before the table has finished
       settling, so a press during that beat is held rather than swallowed. */
    function waitAction() {
      return new Promise((resolve) => {
        actionResolve = resolve;
        phase = "ready";
        refresh();
        if (queued) { const w = queued; queued = null; act(w); }
      });
    }

    function act(what) {
      if (!actionResolve) {
        if (phase === "ready") queued = what;
        return;
      }
      const r = actionResolve;
      actionResolve = null;
      refresh();
      r(what);
    }

    async function runLoop() {
      for (;;) {
        if (destroyed) return 0;
        const what = await waitAction();
        if (destroyed) return 0;
        if (what === "abort") return 0;
        if (what === "cash") return await cashOut();
        const dead = await spin();
        if (destroyed) return 0;
        if (dead) return 0;
      }
    }

    /* ---------- a run ---------- */
    async function play(s, opts) {
      if (busy) return { multiplier: 0 };
      if (opts && opts.instant) return { multiplier: 1 };
      busy = true;
      destroyed = false;
      stake = Math.max(1, Math.round(Number(s) || stake || 1));
      bank = 1;
      blanks = 0;
      outcome = null;
      order = rolledLoad(rungFor(0).live);
      actionResolve = null;
      quiet = false;
      phase = "ready";
      R.runs = (R.runs || 0) + 1;
      say("<b>Round 1 of " + RUNGS + ": ×" + LADDER[0].mult.toFixed(2) + " on " + LADDER[0].live + " live.</b> A blank climbs the ladder; the live round ends the run and takes the bank. Cash out while your nerve holds.", "info");
      refresh();
      await sleep(520);
      if (destroyed) { busy = false; return { multiplier: 1, cancelled: true }; }
      let result = 0;
      try { result = await runLoop(); } catch (err) { console.error(err); }
      if (destroyed) { busy = false; return { multiplier: 1, cancelled: true }; }
      phase = "over";
      refresh();
      busy = false;
      return { multiplier: result };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      quiet = true;
      phase = "over";
      queued = null;
      if (tweenRaf) { cancelAnimationFrame(tweenRaf); tweenRaf = null; }
      if (tweenResolve) { const r = tweenResolve; tweenResolve = null; r(); }
      if (hurtTimer) { clearTimeout(hurtTimer); hurtTimer = null; }
      window.removeEventListener("keydown", onKey);
      const r = actionResolve;
      actionResolve = null;
      if (r) r("abort");
    }

    /* ---------- keyboard ---------- */
    function onKey(e) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "spacebar" || k === "p" || k === "s") { if (!spinBtn.disabled) { e.preventDefault(); act("spin"); } }
      else if (k === "c") { if (!cashBtn.disabled) act("cash"); }
    }
    window.addEventListener("keydown", onKey);

    /* ---------- info card ---------- */
    function openInfoCard() {
      /* live-round positions for a still drum holding `n` rounds, spread around the
         ring so a reader can count them at a glance */
      const idxFor = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(Math.round((k * CH) / n)); return a; };

      /* The ladder with the maths attached: `reach` is the chance of surviving to the
         END of that round (the chained 1 - live/CH of every rung up to and including
         it) and `ret` is what a buy-in cashed there returns on average. Both are read
         off the live table, so retuning main.pjs retunes this card too. */
      let reach = 1;
      const rows = LADDER.map((r, i) => {
        reach *= 1 - r.live / CH;
        return { n: i + 1, mult: r.mult, live: r.live, reach, ret: reach * r.mult };
      });
      const best = rows.reduce((a, b) => (b.ret > a.ret ? b : a), rows[0]);
      const top = rows[rows.length - 1];
      const pct = (v) => (v * 100).toFixed(1) + "%";

      const runSec = sec("The run", ul([
        "You buy in <b>once</b> at ×1.00 and there is nothing to top up — no extra spin, no re-load and no second life is ever charged to your balance.",
        "The HUD's <b>Round</b> cell is the round on the table, and the ladder has <b>" + RUNGS + " rungs</b>. The drum is re-loaded and spun fresh before <i>every</i> shot, and nothing marks where the live round is sitting.",
        "Your run ends when you <b>CASH OUT</b>, or when the round finds you — and the bank goes with it.",
      ]));

      const spinSec = sec("SPIN — one rung at a time", ul([
        "The bank opens at ×1.00. A blank climbs it to the <b>next rung</b>: ×" + LADDER[0].mult.toFixed(2) + " on the first, ×" + TOP_MULT.toFixed(2) + " on the " + RUNGS + "th and last.",
        "The live round ends the run and takes the whole bank — there is no partial payout and nothing to salvage.",
        "<b>Nothing you know changes the next spin.</b> The load is shuffled fresh every time, the drum has no memory, and the last blank has no say in the next one.",
      ]));

      const heavierSec = sec("Every rung is heavier", ul([
        "The ladder pays more and loads deadlier at the same time: round 1 carries <b>" + LADDER[0].live + " live</b> of the " + CH +
        " chambers and the top rung carries <b>" + TOP_LIVE + "</b> — a single empty chamber left.",
        "The table below is the whole game: the round, the bank it pays, the live rounds it loads, and the average return on a buy-in cashed there. Nothing on the screen telegraphs the load while you play — the round you are on is the only thing shown.",
      ]));

      const cashSec = sec("CASH OUT — the only way to keep it", ul([
        RAKE > 0
          ? "Any time, at whatever the bank is standing at. The cage takes its <b>" + (RAKE * 100).toFixed(1) + "%</b> and the rest is yours."
          : "Any time, and the multiplier the bank shows is <b>exactly</b> what you keep — no cut, no fine print.",
        "Surviving the top rung takes <b>SPIN</b> away entirely: the drum cannot get heavier and there is nothing left to climb for, so the run has to be banked.",
        "There is no cap on the bank beyond the ladder's own top.",
      ]));

      const ladder = el("div", { class: "ic-ladder rr" },
        el("div", { class: "rung hd" },
          el("span", { class: "n", text: "R" }),
          el("div"),
          el("span", { class: "v", text: "BANK" }),
          el("span", { class: "lv", text: "DRUM" }),
          el("span", { class: "rt", text: "RET" })
        ),
        ...rows.map((r) => el("div", {
          class: "rung" + (r.n === RUNGS ? " top" : r.ret === best.ret ? " best" : r.live >= CH / 2 ? " hot" : ""),
        },
          el("span", { class: "n", text: String(r.n) }),
          el("div", { class: "bar", style: "width:" + Math.round((r.live / CH) * 100) + "%" }),
          el("span", { class: "v", text: "\u00D7" + r.mult.toFixed(2) }),
          el("span", { class: "lv", text: r.live + " live" }),
          el("span", { class: "rt", text: pct(r.ret) })
        ))
      );

      const minis = el("div", { class: "rr-minis" },
        el("div", { class: "rr-mini-card" }, miniCyl(idxFor(LADDER[0].live)), cap("Round 1 · " + LADDER[0].live + " live")),
        el("div", { class: "rr-mini-card" }, miniCyl(idxFor(TOP_LIVE)), cap("Round " + RUNGS + " · " + TOP_LIVE + " live"))
      );

      const visual = el("div", { class: "ic-visual" },
        minis,
        cap("The drum is re-loaded and spun fresh before every shot, and it is never the same drum twice — it gets heavier as you climb. There is no round to find and no chamber to read, only the spin, the click, and the bang."),
        ladder
      );

      const topEl = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" }, runSec, spinSec, heavierSec, cashSec)
      );

      const pay = payChips([
        { glyph: "\u{1F4A8}", main: "\u00D7" + LADDER[0].mult.toFixed(2), note: "round 1 — a blank" },
        { glyph: "\u{1F480}", main: "LOSE ALL", note: "the live round", cls: "scat" },
        { glyph: "\u{1F4C8}", main: LADDER[0].live + "\u2192" + TOP_LIVE, note: "live rounds, rising", cls: "scat" },
        { glyph: "\u{1F3C1}", main: "\u00D7" + TOP_MULT.toFixed(2), note: "the top rung", cls: "scat" },
      ]);

      openInfo("Russian Roulette — How to Win", el("div", { class: "ic" },
        topEl,
        sec("On the table", pay,
          note("<b>What the ladder pays.</b> The <i>RET</i> column is what a buy-in cashed on that rung returns on average — the chance of surviving that far times the multiplier it pays. " +
            "The best of them is <b>round " + best.n + " at " + pct(best.ret) + "</b>, and every rung above it returns less (the top rung returns " + pct(top.ret) + "). " +
            "So the ladder's edge is " + pct(1 - best.ret) + ", and it sits with whoever walks away: one more spin is always the worse bet, however tempting the next rung looks." +
            (RAKE > 0 ? " The cage's " + (RAKE * 100).toFixed(1) + "% cut comes off on top of that." : "")))
      ));
    }

    /* ---------- boot ---------- */
    refresh();
    say("<b>" + CH + " chambers, " + RUNGS + " rounds, one buy-in.</b> Round 1 pays ×" + LADDER[0].mult.toFixed(2) +
      " and the ladder tops out at ×" + TOP_MULT.toFixed(2) + ". Load the cylinder when you are ready.", "info");
    hintEl.innerHTML = "<kbd>SPACE</kbd> spin \u00B7 <kbd>C</kbd> cash out";
    paint();

    return { root, play, actionLabel: "LOAD THE CYLINDER", destroy };
  },
};
