import { el, fmt, sleep, floatAtElement } from "../ui.js";
import { stageShell, clamp, round2 } from "./common.js";
import { svgEl, infoBtn, openInfo, sec, ul, note, cap, payChips } from "./infocard.js";
import { state, saveState, CONFIG } from "../state.js";
import { sfx, preloadSpin } from "../audio.js";

/* =========================================================
   Russian Roulette -- one spin, double or nothing, and a drum
   that gets heavier the deeper you push.

   Six chambers. The first spin carries rrLiveStart live round;
   every time the bank DOUBLES the drum is re-loaded with one
   more, up to rrLiveMax -- so by the top five of the six
   chambers are live and a single empty one is left. The drum is
   re-loaded and spun FRESH before every shot.

   SPIN       The drum whirls, the hammer falls. A blank doubles
              the bank (rrDouble). A live round ends the run and
              the bank goes with it.

   CASH OUT   Any time, at whatever the bank is standing at. The
              bank is never paid until you ask for it, and the
              number on the HUD is exactly what you keep -- rrRake
              is a cage cut and ships at 0.

   There are no lives, no counters and no tells. Nothing shows you
   where the round is sitting, and nothing tells you how heavy the
   drum has become: it is a fresh load and a fresh whirl, always,
   and nothing you know changes the next spin.

   Because the danger climbs while the payout stays a flat x2, the
   run is generous to whoever stops early and brutal to whoever
   does not -- cashing at x4 or x8 beats x2 on average. That is
   deliberate: the whole game is the nerve to walk away, and not
   knowing how much drum is left between you and the round.
   ========================================================= */

const CH = clamp(Math.round(CONFIG.rrChambers) || 6, 4, 8);
const LIVE_START = clamp(Math.round(CONFIG.rrLiveStart === undefined ? 1 : CONFIG.rrLiveStart), 1, CH - 1);
const LIVE_MAX = clamp(Math.round(CONFIG.rrLiveMax === undefined ? CH - 1 : CONFIG.rrLiveMax), LIVE_START, CH - 1);
const DOUBLE = Math.max(1.01, Number(CONFIG.rrDouble) || 2);
const RAKE = clamp(CONFIG.rrRake, 0, 0.5);

/* How heavy the drum is for the NEXT spin. One live round to open, and one more
   every time the bank doubles -- so the deeper the run goes the deadlier the
   load, until only a single empty chamber is left. The player is never told
   this number: nothing on screen reveals how much drum is loaded. */
function liveFor(blanks) {
  return clamp(blanks, LIVE_START, LIVE_MAX);
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
  blurb: "Six chambers and a drum that re-loads heavier the further you push — one live round to open, five by the top, until a single empty chamber is left. A blank doubles the bank; the live round ends the run. Cash out any time, and the number the bank shows is exactly what you keep.",
  payoutNote: () =>
    "One buy-in, one bank, and a drum re-loaded and spun before every shot. It opens with <b>" + LIVE_START +
    " live</b> and gains a live round <b>every time the bank doubles</b>, up to <b>" + LIVE_MAX + " of " + CH +
    "</b> — so the deeper you push the deadlier the drum, and nothing on screen tells you how heavy it has become. A blank <b>doubles</b> the bank; the live round ends the run, and <b>CASH OUT</b> any time " +
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
    let blanks = 0;             // spins survived this run
    let order = rolledLoad(LIVE_START);
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
    const hudBank = el("span", { text: "1.00" });
    const hudCash = el("span", { text: fmt(stake) });
    const hudBest = el("span", { text: bestOf().toFixed(2) });
    const bigMult = el("b", { class: "rr-bigmult", text: "\u00D71.00" });
    const msgEl = el("div", { class: "rr-msg", text: "" });
    const hintEl = el("div", { class: "rr-hint" });

    /* ---------- controls ---------- */
    const spinSub = el("span", { class: "key", text: "double or nothing" });
    const cashSub = el("span", { class: "key", text: "keep " + fmt(stake) });
    const spinBtn = el("button", { class: "rrbtn spin", type: "button", disabled: true, onclick: () => act("spin") },
      el("span", { class: "lbl", text: "SPIN" }), spinSub);
    const cashBtn = el("button", { class: "rrbtn cash", type: "button", disabled: true, onclick: () => act("cash") },
      el("span", { class: "lbl", text: "CASH OUT" }), cashSub);

    const cab = el("div", { class: "slot-cabinet rr-cab" },
      el("div", { class: "slot-marquee" },
        el("span", { class: "lights" }, el("i"), el("i"), el("i")),
        el("span", { class: "marquee-title", text: "RUSSIAN ROULETTE" }),
        el("span", { class: "sub", text: CH + " CHAMBERS · DOUBLE OR NOTHING" }),
        el("span", { class: "lights" }, el("i"), el("i"), el("i"))
      ),
      el("div", { class: "rr-hud" },
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
      "Six chambers and a drum that re-loads heavier every time the bank doubles — one live round to open, five by the top, until a single empty chamber is left.",
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
      const net = netNow();
      hudBank.textContent = bank.toFixed(2);
      hudBank.parentElement.className = "v " + (bank <= 0 ? "bad" : bank >= 4 ? "safe" : "gold");
      hudCash.textContent = fmt(stake * net);
      hudBest.textContent = bestOf().toFixed(2);
      bigMult.textContent = "\u00D7" + bank.toFixed(2);
      bigMult.classList.toggle("hot", bank >= 8);
      spinBtn.disabled = !ready;
      cashBtn.disabled = !(ready && bank > 0);
      spinSub.textContent = spinning ? "the drum is turning…"
        : ready ? "double or nothing"
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
      const live = liveFor(blanks);
      order = rolledLoad(live);
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

      bank = round2(bank * DOUBLE);
      blanks += 1;
      say("<b>CLICK \u2014 blank.</b> The bank doubles to \u00D7<b>" + bank.toFixed(2) + "</b> \u00B7 " + blanks +
        " blank" + (blanks === 1 ? "" : "s") + " behind you.", "win");
      popMult();
      if (!quiet) {
        floatAtElement(svg, "\u00D7" + bank.toFixed(2), "win");
        if (bank >= 16) app.confetti(bank >= 64 ? 60 : 28);
      }
      refresh();
      return false;
    }

    async function cashOut() {
      phase = "over";
      const m = netNow();
      if (m > bestOf()) R.bestMult = m;
      saveState();
      say("<b>CASHED OUT at ×" + m.toFixed(2) + ".</b> " + blanks + " blank" + (blanks === 1 ? "" : "s") +
        " and a live round that never found you. " +
        (RAKE > 0
          ? "The cage takes its " + (RAKE * 100).toFixed(1) + "% and the money is yours."
          : "The bank is yours, to the cent."), "win");
      sfx.cash(m >= 32 ? 4 : m >= 8 ? 3 : m >= 2 ? 2 : 1);
      if (!quiet && m >= 4) app.confetti(m >= 32 ? 90 : 40);
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
      order = rolledLoad();
      actionResolve = null;
      quiet = false;
      phase = "ready";
      R.runs = (R.runs || 0) + 1;
      say("<b>" + CH + " chambers, spun fresh for every shot.</b> A blank doubles the bank; the live round ends the run and takes it. Cash out while your nerve holds.", "info");
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
      const idxFor = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(Math.round((k * CH) / n)); return a; };

      const runSec = sec("The run", ul([
        "You buy in <b>once</b>. The bank opens at <b>×1.00</b> and there is nothing to top up — nothing is ever charged to your balance to try again.",
        "<b>No lives and no counters.</b> There is no chamber track to read, no look to buy and no skip to spend. A single live round ends the run.",
        "Your run ends when you <b>CASH OUT</b>, or when the round finds you — and the bank goes with it.",
      ]));

      const spinSec = sec("SPIN — double or nothing", ul([
        "The drum is re-loaded and spun fresh before <i>every</i> shot. Survive and the bank <b>doubles</b> (×" + DOUBLE.toFixed(2) + "); take the live round and it is over — you lose the lot.",
        "<b>Nothing you know changes the next spin.</b> The drum has no memory and no tell: it never gets “hotter” or “safer”, and the last blank has no say in the next one.",
      ]));

      const heavierSec = sec("The drum gets heavier", ul([
        "It opens with <b>" + LIVE_START + " live</b> of the " + CH + " chambers. Every time the bank <b>doubles</b>, the next load carries <b>one more live round</b> — " +
        LIVE_START + ", " + (LIVE_START + 1) + ", " + (LIVE_START + 2) + "… up to <b>" + LIVE_MAX + " of " + CH + "</b>, until only a <b>single empty chamber</b> is left.",
        "Nothing on screen shows how heavy the drum has become while you play. The deeper you push the likelier the next spin is the one — the ladder below is the only place that shows it.",
      ]));

      const cashSec = sec("CASH OUT — the only way to keep it", ul([
        RAKE > 0
          ? "Any time, at whatever the bank is standing at. The cage takes its <b>" + (RAKE * 100).toFixed(1) + "%</b> and the rest is yours."
          : "Any time, and the multiplier the bank shows is <b>exactly</b> what you keep — no cut, no fine print.",
        "There is no cap on the bank. Stay as long as your nerve holds.",
      ]));

      const rungs = [];
      rungs.push(el("div", { class: "rung" },
        el("span", { text: "×1" }),
        el("div", { class: "bar", style: "width:" + Math.round((LIVE_START / CH) * 100) + "%" }),
        el("span", { class: "v", text: LIVE_START + " live" })
      ));
      for (let L = LIVE_START + 1; L <= LIVE_MAX; L++) {
        const bank = Math.pow(DOUBLE, L);
        const bankTxt = "×" + (bank >= 1000 ? Math.round(bank).toLocaleString("en-US") : bank.toFixed(0));
        const cls = "rung" + (L === LIVE_MAX ? " top" : L / CH >= 0.5 ? " hot" : "");
        rungs.push(el("div", { class: cls },
          el("span", { text: bankTxt }),
          el("div", { class: "bar", style: "width:" + Math.round((L / CH) * 100) + "%" }),
          el("span", { class: "v", text: L + " live" })
        ));
      }
      const ladder = el("div", { class: "ic-ladder" }, ...rungs);

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "rr-mini-wrap" }, miniCyl(idxFor(LIVE_START))),
        cap("The drum is re-loaded and spun fresh before every shot, and it is never the same drum twice — it gets heavier the deeper you go. There is no round to find and no chamber to read, only the spin, the click, and the bang."),
        ladder
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" }, runSec, spinSec, heavierSec, cashSec)
      );

      const pay = payChips([
        { glyph: "\u{1F4A8}", main: "\u00D7" + DOUBLE.toFixed(2), note: "blank — bank doubles" },
        { glyph: "\u{1F480}", main: "LOSE ALL", note: "the live round", cls: "scat" },
        { glyph: "\u{1F4C8}", main: LIVE_START + "\u2192" + LIVE_MAX, note: "live rounds, rising", cls: "scat" },
        { glyph: "\u26AA", main: "1 empty", note: "left at the top", cls: "scat" },
      ]);

      openInfo("Russian Roulette — How to Win", el("div", { class: "ic" },
        top,
        sec("On the table", pay,
          note("Nothing here is for sale: no insurance, no skips, no second life. The drum takes on a live round every time the bank doubles and never gives one back — so the deeper you go, the fewer empty chambers stand between you and the end."))
      ));
    }

    /* ---------- boot ---------- */
    refresh();
    say("<b>" + CH + " chambers, spun fresh for every shot.</b> Load the cylinder when you are ready.", "info");
    hintEl.innerHTML = "<kbd>SPACE</kbd> spin \u00B7 <kbd>C</kbd> cash out";
    paint();

    return { root, play, actionLabel: "LOAD THE CYLINDER", destroy };
  },
};
