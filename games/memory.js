import { el, sleep } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { svgEl, infoBtn, openInfo, sec, ul, note, cap } from "./infocard.js";
import { state, saveState, CONFIG } from "../state.js";
import { sfx } from "../audio.js";

/* =========================================================
   Neon Recall — a four-pad colour memory gamble.

   Four pads sit on a wheel. Each round the machine lights
   them in a sequence, one at a time, and you repeat it by
   tapping the pads back. Clear the sequence and the bank
   climbs; then you choose: take the money (CASH OUT) or let
   the machine add one more colour and go again (NEXT PASS).

   Nothing here is decided by a dice roll. There is no luck in
   the pattern — the house edge is your own memory, and the
   only real decision is the one gamblers always get wrong:
   when to walk.

   Two modes, chosen before a run starts:

     SEQUENCE  The same pattern, one colour longer each pass.
               The order you already learned stays put, so all
               you carry is the new colour on the end. Gentler
               bank: the same rung pays less than RANDOM's.

     RANDOM    The whole pattern is re-rolled at the new length
               every pass -- nothing carries over, it is a fresh
               read each time -- so it is worth more a colour,
               and it opens at FIVE colours, not three: a fresh
               read of three colours is no test at all.

   The ladder is 19 LEVELS of difficulty, each level one colour
   longer than the last: 3..21 colours in SEQUENCE and 5..23 in
   RANDOM. A rung is FITTED, never compounded: it pays
   memLadderRtp divided by the chance the reference player has
   of clearing that many colours, so that player's return is flat
   at memLadderRtp and the ladder holds no free money at all.
   The reference curve is perfect to memSkillKnee colours and
   then memSkillDecay per extra colour (memSkillDecayRand in
   RANDOM), which is why the first memSkillKnee colours pay
   exactly x1.00 -- clear them, bank, and you have won nothing
   but lost nothing. (The old ladder paid x1.26 for a
   THREE-colour pattern and compounded to x295 at the summit, so
   a player could bank the trivial first pass forever, or take a
   fortune off a single good run.)

   The top of the ladder is therefore also the machine's ceiling,
   with memLadderCap / memLadderCapRand as hard guards just above
   the summit, and the machine carries a TABLE MAXIMUM of its own
   -- memTableBase x (level + 1), capped at memTableMax -- instead
   of the house level limit, because a skill table is the one
   place where a good player would otherwise be able to stake a
   fortune against a ladder he cannot lose. Those two numbers
   together cap what a single run can possibly win.

   Flash and gap timings start at memFlashMs/memGapMs and
   shrink by memFlashDecay/memGapDecay for EVERY extra colour,
   down to memMinFlashMs/memMinGapMs, so a pattern gets both
   longer and faster as it grows and a long one blurs past —
   that decay, not any RNG, is the difficulty curve. Both floors
   are reached around 17 colours, and the ramp is frozen at
   memMaxLen colours: past that a pattern only gets longer, it
   cannot flash any faster.
   ========================================================= */

const PADS = [
  { color: "#37d67a", dim: "#123a26", hov: "#1f7a48", glyph: "\u25B2", name: "green", key: "1" },
  { color: "#ff5f6d", dim: "#3d1319", hov: "#8f2a34", glyph: "\u25C6", name: "red", key: "2" },
  { color: "#f2c14e", dim: "#3a2d0c", hov: "#8a6a1f", glyph: "\u25CF", name: "gold", key: "3" },
  { color: "#4aa8ff", dim: "#122a44", hov: "#245f99", glyph: "\u25A0", name: "blue", key: "4" },
];
const N = PADS.length;

/* Opening length per mode: SEQUENCE opens at memStartLen, RANDOM at
   memRandStartLen (a fresh read of only three colours is no test at all). Resolved
   here, once, so the payout note, the info card and the engine cannot disagree.
   `levels` is how many difficulty levels the ladder runs (19 by default), and each
   level is one colour longer than the last, so a mode's last level is
   `start + levels - 1` colours: 3..21 in SEQUENCE, 5..23 in RANDOM. `speedCap`
   (memMaxLen) is where the flash/gap ramp freezes -- past that many colours a
   pattern still gets longer, it just cannot flash any faster. */
const seqStart = clamp(Math.round(CONFIG.memStartLen) || 3, 2, 6);
const randStart = clamp(Math.round(CONFIG.memRandStartLen) || 5, 2, 12);
const levels = clamp(Math.round(CONFIG.memLevels) || 27, 3, 60);
const speedCap = clamp(Math.round(CONFIG.memMaxLen) || 20, 2, 60);
const startFor = (m) => (m === "rand" ? randStart : seqStart);
const maxLenFor = (m) => startFor(m) + levels - 1;

const CX = 100, CY = 100, R_OUT = 95, R_IN = 41;
const GAP_DEG = 3.2;

let gradSeq = 0;

const round2 = (n) => Math.round(n * 100) / 100;

/* The ladder is FITTED rather than compounded. A rung pays memLadderRtp divided by the
   chance the reference player has of clearing that many colours, so that player's
   return is FLAT at memLadderRtp -- every rung is a fair bet for exactly them, and only
   their read on their own memory decides. The reference curve is: perfect to
   memSkillKnee colours, then memSkillDecay per extra colour (memSkillDecayRand in
   RANDOM, which is a harder read). So the first memSkillKnee colours pay exactly
   x1.00 -- a bank, not a win.

   That knee is the whole point. The old ladder paid a fixed x1.26 for a THREE-colour
   pattern, so a player could clear the trivial first pass, bank it, and compound +26%
   a round forever without ever taking a real risk; the ladder also compounded to x295
   at the summit, which meant a good memoriser banked a fortune in a handful of rounds.
   A fitted ladder cannot do either: the easy rungs pay nothing, and the top is bounded
   by the reference player's own odds instead of by a growth rate.

   It lives at module scope rather than inside create() because the payout note, the
   info card and the running HUD all print it, and they must not be able to disagree. */
const knee = clamp(Math.round(CONFIG.memSkillKnee), 0, 60);
const ladderRtp = clamp(CONFIG.memLadderRtp, 0.05, 1.2);
const decayFor = (m) => clamp(m === "rand" ? CONFIG.memSkillDecayRand : CONFIG.memSkillDecay, 0.3, 0.999);
const capFor = (m) => Math.max(1, m === "rand" ? CONFIG.memLadderCapRand : CONFIG.memLadderCap);
const multAt = (m, p) => {
  const n = startFor(m) + clamp(Math.round(p), 0, levels) - 1;
  const extra = Math.max(0, n - knee);
  return round2(clamp(ladderRtp / Math.pow(decayFor(m), extra), 1, capFor(m)));
};
const summitSeq = multAt("seq", levels);
const summitRand = multAt("rand", levels);
const machineMax = Math.max(summitSeq, summitRand);

function pt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/* one slice of the annulus: outer arc out, inner arc back */
function sectorPath(k) {
  const mid = -90 + k * (360 / N);
  const half = 180 / N - GAP_DEG / 2;
  const a0 = mid - half, a1 = mid + half;
  const [x0, y0] = pt(R_OUT, a0);
  const [x1, y1] = pt(R_OUT, a1);
  const [x2, y2] = pt(R_IN, a1);
  const [x3, y3] = pt(R_IN, a0);
  return "M" + round2(x0) + " " + round2(y0) +
    " A" + R_OUT + " " + R_OUT + " 0 0 1 " + round2(x1) + " " + round2(y1) +
    " L" + round2(x2) + " " + round2(y2) +
    " A" + R_IN + " " + R_IN + " 0 0 0 " + round2(x3) + " " + round2(y3) + " Z";
}

function midAngle(k) { return -90 + k * (360 / N); }

/* the coloured, clickable pads of the wheel (no hub, no decoration) */
function padPaths() {
  const out = [];
  for (let k = 0; k < N; k++) {
    const p = svgEl("path", { class: "mem-pad", d: sectorPath(k), "data-i": k });
    p.style.setProperty("--pc", PADS[k].color);
    p.style.setProperty("--pcdim", PADS[k].dim);
    p.style.setProperty("--pchov", PADS[k].hov);
    const [gx, gy] = pt((R_OUT + R_IN) / 2, midAngle(k));
    p.appendChild(svgEl("title", {}, PADS[k].name + " pad (" + PADS[k].key + ")"));
    out.push(p);
    out.push(svgEl("text", {
      class: "mem-glyph", x: round2(gx), y: round2(gy) + 7, "text-anchor": "middle",
    }, PADS[k].glyph));
  }
  return out;
}

function hubDefs(id) {
  return svgEl("defs", {},
    svgEl("radialGradient", { id, cx: "50%", cy: "32%", r: "78%" },
      svgEl("stop", { offset: "0%", "stop-color": "#1c2842" }),
      svgEl("stop", { offset: "100%", "stop-color": "#090e18" })
    )
  );
}

/* a static, non-interactive wheel for the info card */
function miniWheel() {
  const id = "memgrad" + (++gradSeq);
  const svg = svgEl("svg", { class: "mem-wheel mini", viewBox: "0 0 200 200" });
  svg.appendChild(hubDefs(id));
  const ring = svgEl("circle", { class: "mem-ring", cx: CX, cy: CY, r: R_OUT, fill: "none" });
  const inner = svgEl("circle", { class: "mem-hub", cx: CX, cy: CY, r: R_IN, fill: "url(#" + id + ")" });
  for (const node of padPaths()) svg.appendChild(node);
  svg.appendChild(ring);
  svg.appendChild(inner);
  return svg;
}

export default {
  id: "memory",
  name: "Neon Recall",
  icon: "\u{1F9E0}",
  action: "START RECALL",
  canIdle: false,
  minBet: 1,
  /* The machine's own table maximum, which overrides the house level limit (see the
     maxBet() hook in main.js). A memory game is the one table where being good is
     worth money, so it is the one table that needs a lid on the stake: without it a
     perfect reader could stake the whole bankroll against a ladder he cannot lose. */
  maxBet: (level) => Math.min(CONFIG.memTableMax, CONFIG.memTableBase * (1 + Math.max(1, level))),
  /* no run can pay more than the caps allow, so advertise that rather than maxWinMult */
  maxWinMult: Math.max(capFor("seq"), capFor("rand")),
  blurb: "Four neon pads, one ever-growing pattern. Repeat it to grow your bank \u2014 push your luck, or cash out before your memory does.",
  payoutNote: () =>
    "The machine flashes a pattern of colours; repeat it and your bank climbs. Then it is the only choice that matters: " +
    "<b>CASH OUT</b>, or <b>NEXT PASS</b> to add one more colour. Miss a pad and the whole stake is gone. " +
    "The ladder is <b>" + levels + " levels</b>, one colour each \u2014 from <b>" + seqStart + " to " + maxLenFor("seq") +
    " colours</b> in SEQUENCE and <b>" + randStart + " to " + maxLenFor("rand") + "</b> in RANDOM. The first <b>" + knee +
    " colours bank exactly \u00D7 1.00</b> \u2014 a push, not a win: there is no free money to compound, and every rung that does pay has to be earned. " +
    "Past them the bank climbs properly, to <b>\u00D7" + summitSeq.toFixed(2) + "</b> in SEQUENCE and <b>\u00D7" + summitRand.toFixed(2) + "</b> in RANDOM, " +
    "while the pattern flashes faster with every colour. No dice anywhere \u2014 it is your memory against the ladder.",
  create(app) {
    if (!state.memory || !Number.isFinite(state.memory.bestMult)) {
      state.memory = { bestLen: 0, bestMult: 1 };
    }
    if (!Number.isFinite(state.memory.bestLen) || state.memory.bestLen < 0) state.memory.bestLen = 0;
    /* a best-mult saved under the old compounding ladder (x295) is not a record the
       machine can still pay, so rescale it to the top of the ladder it can pay */
    if (!Number.isFinite(state.memory.bestMult) || state.memory.bestMult > machineMax) state.memory.bestMult = machineMax;

    /* the fitted ladder above; level p is level p of the mode's 19, and multOf(m, 0)
       is 1 -- nothing banked -- so the cash-out button and the HUD can call it blind */
    const multOf = multAt;

    /* Flash/gap time for a pattern of n colours: the base time shrunk by one decay
       step per colour beyond the mode's opening length. `rampFor` freezes at
       speedCap colours (memMaxLen, 20 by default), so past that a pattern still gets
       longer but never flashes faster, and the floors stop a long pattern from
       collapsing into a single smear. */
    const rampFor = (n) => Math.max(0, Math.min(n, speedCap) - startFor(mode));
    const flashFor = (n) => Math.max(CONFIG.memMinFlashMs, CONFIG.memFlashMs * Math.pow(CONFIG.memFlashDecay, rampFor(n)));
    const gapFor = (n) => Math.max(CONFIG.memMinGapMs, CONFIG.memGapMs * Math.pow(CONFIG.memGapDecay, rampFor(n)));

    /* ---------- closure state ---------- */
    let mode = "seq";
    let phase = "idle";         // idle | show | input | choose | over
    let seq = [];
    let pass = 0;               // sequences cleared this run
    let length = seqStart;      // the sequence length on the wheel right now
    let inputIndex = 0;
    let inputResolve = null;
    let choiceResolve = null;
    let destroyed = false;
    let failInfo = null;

    const multFor = (p) => multOf(mode, p);
    const bestMult = () => (state.memory && Number.isFinite(state.memory.bestMult) ? state.memory.bestMult : 1);
    const bestLen = () => (state.memory && Number.isFinite(state.memory.bestLen) ? state.memory.bestLen : 0);

    /* ---------- the wheel ---------- */
    const gradId = "memgrad" + (++gradSeq);
    const wheel = svgEl("svg", {
      class: "mem-wheel", viewBox: "0 0 200 200",
      role: "group", "aria-label": "Neon Recall colour wheel",
    });
    wheel.appendChild(hubDefs(gradId));
    const padEls = [];
    for (let k = 0; k < N; k++) {
      const p = svgEl("path", { class: "mem-pad", d: sectorPath(k), "data-i": k, role: "button", tabindex: "0" });
      p.style.setProperty("--pc", PADS[k].color);
      p.style.setProperty("--pcdim", PADS[k].dim);
      p.style.setProperty("--pchov", PADS[k].hov);
      p.appendChild(svgEl("title", {}, PADS[k].name + " pad \u2014 key " + PADS[k].key));
      const [gx, gy] = pt((R_OUT + R_IN) / 2, midAngle(k));
      wheel.appendChild(p);
      wheel.appendChild(svgEl("text", { class: "mem-glyph", x: round2(gx), y: round2(gy) + 7, "text-anchor": "middle" }, PADS[k].glyph));
      padEls.push(p);
    }
    wheel.appendChild(svgEl("circle", { class: "mem-ring", cx: CX, cy: CY, r: R_OUT, fill: "none" }));
    wheel.appendChild(svgEl("circle", { class: "mem-hub", cx: CX, cy: CY, r: R_IN, fill: "url(#" + gradId + ")" }));
    const hubLen = svgEl("text", { class: "mem-hub-len", x: CX, y: CY - 1, "text-anchor": "middle" }, String(seqStart));
    const hubSub = svgEl("text", { class: "mem-hub-sub", x: CX, y: CY + 22, "text-anchor": "middle" }, "READY");
    wheel.appendChild(hubLen);
    wheel.appendChild(hubSub);

    function lightPad(i, on) {
      const p = padEls[i];
      if (p) p.classList.toggle("lit", !!on);
    }
    function lightAllOff() { for (let i = 0; i < N; i++) lightPad(i, false); }

    /* ---------- hud ---------- */
    const hudPass = el("span", { text: "0 / " + levels });
    const hudLen = el("span", { text: String(seqStart) });
    const hudBank = el("span", { class: "gold", text: "1.00" });
    const hudNext = el("span", { text: multOf("seq", 1).toFixed(2) });
    const hudBest = el("span", { text: bestMult().toFixed(2) });

    /* The pip track is one pip per pass of the CURRENT mode, and the two modes have
       different opening lengths (3 vs 5 colours), so it is rebuilt whenever the mode
       changes rather than sized once. setMode() refuses to run mid-pass, so there is
       never a live run to invalidate. */
    const pips = [];
    const track = el("div", { class: "mem-track" });
    function buildTrack() {
      const start = startFor(mode);
      const n = levels;
      pips.length = 0;
      track.replaceChildren();
      for (let k = 0; k < n; k++) {
        const pip = el("span", {
          class: "mem-pip",
          title: "Pass " + (k + 1) + " \u00B7 " + (start + k) + " colours \u00B7 \u00D7" + multOf(mode, k + 1).toFixed(2),
        });
        pips.push(pip);
        track.appendChild(pip);
      }
    }
    buildTrack();

    /* ---------- mode toggle ---------- */
    const seqBtn = el("button", { class: "mem-mode on", type: "button", onclick: () => setMode("seq") },
      el("span", { class: "mt", text: "SEQUENCE" }),
      el("span", { class: "ms", text: "The same pattern, one colour longer each pass. Easier \u2014 the order you already know stays put." })
    );
    const randBtn = el("button", { class: "mem-mode", type: "button", onclick: () => setMode("rand") },
      el("span", { class: "mt", text: "RANDOM" }),
      el("span", { class: "ms", text: "A brand-new pattern at the new length every pass, starting at " + randStart + " colours. Harder \u2014 nothing carries over. Pays more a level." })
    );
    function setMode(m) {
      if (phase === "show" || phase === "input" || phase === "choose") return;
      mode = m === "rand" ? "rand" : "seq";
      seqBtn.classList.toggle("on", mode === "seq");
      randBtn.classList.toggle("on", mode === "rand");
      buildTrack();
      if (phase === "idle") {
        msgEl.textContent = mode === "seq"
          ? "SEQUENCE \u2014 the pattern keeps its order and grows a colour each pass."
          : "RANDOM \u2014 a fresh pattern every pass, starting at " + randStart + " colours, for a steeper ladder.";
      }
      refresh();
    }

    /* ---------- controls ---------- */
    const cashKey = el("span", { class: "key", text: "bank your bet" });
    const nextKey = el("span", { class: "key", text: "grow to " + seqStart + " colours" });
    const nextBtn = el("button", { class: "membtn go", type: "button", disabled: true, onclick: () => choose("next") },
      el("span", { class: "lbl", text: "NEXT PASS" }), nextKey
    );
    const cashBtn = el("button", { class: "membtn cash", type: "button", disabled: true, onclick: () => choose("cash") },
      el("span", { class: "lbl", text: "CASH OUT" }), cashKey
    );

    const msgEl = el("div", { class: "mem-msg", text: "Pick a mode, then press START RECALL." });

    const root = stageShell(
      "Neon Recall",
      "Repeat the flashing pattern. Every pass adds a colour and multiplies the bank \u2014 cash out or push on, but miss one pad and the stake is gone.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "mem-wrap" },
        el("div", { class: "slot-cabinet mem-cab" },
          el("div", { class: "slot-marquee" },
            el("span", { class: "lights" }, el("i"), el("i"), el("i")),
            el("span", { class: "marquee-title", text: "NEON RECALL" }),
            el("span", { class: "sub", text: "4 PADS \u00B7 REPEAT THE FLASH \u00B7 NO IDLE" }),
            el("span", { class: "lights" }, el("i"), el("i"), el("i"))
          ),
          el("div", { class: "mem-modes" }, seqBtn, randBtn),
          el("div", { class: "mem-hud" },
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Bank now" }), el("span", { class: "v gold", text: "\u00D7" }, hudBank)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Pass" }), el("span", { class: "v" }, hudPass)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Colours" }), el("span", { class: "v" }, hudLen)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Next pass" }), el("span", { class: "v", text: "\u00D7" }, hudNext)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Best ever" }), el("span", { class: "v", text: "\u00D7" }, hudBest))
          ),
          el("div", { class: "mem-trackwrap" }, track),
          el("div", { class: "mem-screen" }, wheel),
          msgEl,
          el("div", { class: "mem-controls" }, nextBtn, cashBtn)
        )
      )
    );

    /* ---------- rendering ---------- */
    function refresh() {
      const live = phase === "show" || phase === "input" || phase === "choose";
      const maxPass = levels;
      const start = startFor(mode);
      hudPass.textContent = pass + " / " + maxPass;
      hudLen.textContent = String(live ? length : (phase === "over" ? length : start));
      hudBank.textContent = multFor(pass).toFixed(2);
      hudNext.textContent = pass >= maxPass ? "\u2014" : multFor(pass + 1).toFixed(2);
      hudBest.textContent = bestMult().toFixed(2);
      hubLen.textContent = String(phase === "idle" ? start : length);
      hubSub.textContent = phase === "idle" ? "READY" : (phase === "over" ? "OVER" : "\u00D7" + multFor(pass).toFixed(2));
      cashKey.textContent = pass > 0 ? "take \u00D7" + multFor(pass).toFixed(2) : "bank your bet";
      nextKey.textContent = "grow to " + Math.min(maxLenFor(mode), start + pass) + " colours";
      const locked = phase === "show" || phase === "input" || phase === "choose";
      seqBtn.disabled = locked;
      randBtn.disabled = locked;
      nextBtn.disabled = phase !== "choose";
      cashBtn.disabled = phase !== "choose";
      wheel.classList.toggle("watching", phase === "show");
      for (let k = 0; k < pips.length; k++) {
        pips[k].classList.toggle("done", k < pass);
        pips[k].classList.toggle("now", k === pass && locked);
        pips[k].classList.toggle("top", k === maxPass - 1);
      }
    }

    function updateInputPrompt() {
      msgEl.className = "mem-msg turn";
      msgEl.textContent = "YOUR TURN \u2014 " + inputIndex + " / " + seq.length;
    }

    /* ---------- sequence helpers ---------- */
    function randPad() {
      if (seq.length < 2) return Math.floor(Math.random() * N);
      // never the same pad three times running: it reads as a machine glitch
      for (let tries = 0; tries < 8; tries++) {
        const i = Math.floor(Math.random() * N);
        if (!(i === seq[seq.length - 1] && i === seq[seq.length - 2])) return i;
      }
      return Math.floor(Math.random() * N);
    }

    function randomSeq(n) {
      const out = [];
      let rejects = 0;
      while (out.length < n) {
        const i = Math.floor(Math.random() * N);
        const twice = out.length >= 2 && i === out[out.length - 1] && i === out[out.length - 2];
        /* never the same pad three times running -- but a degenerate RNG (a constant
           stub in the console, a seeded generator that never varies) would otherwise
           spin here forever, so after enough refuses just take the pad */
        if (twice && rejects++ < 64) continue;
        out.push(i);
      }
      return out;
    }

    async function showSequence() {
      phase = "show";
      failInfo = null;
      refresh();
      const n = seq.length;
      /* faster the longer the pattern gets -- flashFor()/gapFor() own the decay,
         the floors and the 20-colour cap */
      const flash = flashFor(n);
      const gap = gapFor(n);
      lightAllOff();
      msgEl.className = "mem-msg watch";
      msgEl.textContent = "WATCH \u2014 " + n + " colour" + (n === 1 ? "" : "s") + " \u00B7 " + Math.round(flash) + "ms each";
      await sleep(420);
      for (let k = 0; k < n; k++) {
        if (destroyed || phase !== "show") { lightAllOff(); return false; }
        const i = seq[k];
        lightPad(i, true);
        sfx.pad(i);
        await sleep(flash);
        lightPad(i, false);
        if (k < n - 1) await sleep(gap);
      }
      await sleep(Math.max(120, gap * 0.8));
      return true;
    }

    function waitInput() {
      return new Promise((resolve) => {
        inputIndex = 0;
        inputResolve = resolve;
        phase = "input";
        updateInputPrompt();
        refresh();
      });
    }

    function padPress(i) {
      if (phase !== "input" || !inputResolve) return;
      if (i === seq[inputIndex]) {
        sfx.pad(i);
        lightPad(i, true);
        setTimeout(() => { if (!destroyed) lightPad(i, false); }, 150);
        inputIndex++;
        updateInputPrompt();
        if (inputIndex >= seq.length) {
          const r = inputResolve;
          inputResolve = null;
          r(true);
        }
      } else {
        sfx.padWrong();
        lightPad(i, true);
        padEls[i].classList.add("wrong");
        failInfo = { at: inputIndex, expected: seq[inputIndex], got: i };
        const r = inputResolve;
        inputResolve = null;
        setTimeout(() => {
          lightPad(i, false);
          if (padEls[i]) padEls[i].classList.remove("wrong");
        }, 420);
        r(false);
      }
    }

    function choose(what) {
      if (!choiceResolve) return;
      const r = choiceResolve;
      choiceResolve = null;
      nextBtn.disabled = true;
      cashBtn.disabled = true;
      r(what);
    }

    function waitChoice() {
      return new Promise((resolve) => {
        choiceResolve = resolve;
        phase = "choose";
        refresh();
      });
    }

    /* ---------- round flow ---------- */
    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const auto = instant || !!(opts && (opts.idle || opts.auto));
      destroyed = false;
      lightAllOff();

      if (auto) {
        // unreachable in practice (canIdle is false), but a sane fallback: sim a run
        const start = startFor(mode);
        const mp = levels;
        let p = 0;
        const chance = decayFor(mode);
        while (p < mp && Math.random() < chance) p++;
        const m = p > 0 ? multOf(mode, p) : 0;
        pass = p;
        length = clamp(start + p - 1, start, maxLenFor(mode));
        phase = "over";
        msgEl.className = "mem-msg " + (m > 0 ? "win" : "lose");
        msgEl.textContent = m > 0 ? "AUTO \u2014 banked \u00D7" + m.toFixed(2) : "AUTO \u2014 the pattern got away.";
        bankBest();
        refresh();
        return { multiplier: m };
      }

      pass = 0;
      seq = [];
      length = startFor(mode);
      failInfo = null;
      phase = "show";
      msgEl.className = "mem-msg watch";
      msgEl.textContent = "GET READY \u2014 " + (mode === "seq" ? "SEQUENCE" : "RANDOM") + " mode";
      refresh();
      await sleep(320);

      let result = 0;
      let reason = "cash";
      try {
        for (;;) {
          pass++;
          length = startFor(mode) + pass - 1;
          if (pass === 1 || mode === "rand") seq = randomSeq(length);
          else seq = seq.concat([randPad()]);
          refresh();

          const shown = await showSequence();
          if (destroyed || !shown) break;

          const ok = await waitInput();
          if (destroyed) break;
          if (!ok) {
            // the sequence you fumbled doesn't count as cleared: roll the pass back
            // (so the HUD, the pips and the post-mortem all read honestly) while
            // `length` keeps pointing at the pattern that beat you
            reason = "wrong";
            pass = Math.max(0, pass - 1);
            break;
          }

          sfx.padPass();
          msgEl.className = "mem-msg win";
          msgEl.textContent = "PASS " + pass + " CLEARED \u2014 bank \u00D7" + multFor(pass).toFixed(2) + " or push on.";
          if (length >= maxLenFor(mode)) { reason = "summit"; result = multFor(pass); break; }

          const pick = await waitChoice();
          if (destroyed) break;
          if (pick === "cash") { reason = "cash"; result = multFor(pass); break; }
          if (pick === "abort") break;
        }
      } catch (err) {
        console.error(err);
      }

      if (destroyed) {
        lightAllOff();
        return { multiplier: 1, cancelled: true };
      }

      if (reason === "wrong") {
        await showFail();
        result = 0;
      } else if (reason === "summit") {
        phase = "over";
        lightAll(true);
        msgEl.className = "mem-msg win";
        msgEl.textContent = "SUMMIT \u2014 all " + maxLenFor(mode) + " colours. BANKED \u00D7" + result.toFixed(2);
        sfx.win(4);
        app.confetti(90);
        setTimeout(() => { if (!destroyed) lightAllOff(); }, 900);
      } else if (reason === "cash") {
        phase = "over";
        msgEl.className = "mem-msg win";
        msgEl.textContent = "BANKED \u00D7" + result.toFixed(2) + " \u2014 " + pass + " sequence" + (pass === 1 ? "" : "s") + " cleared.";
        sfx.win(result >= 5 ? 3 : result >= 2.5 ? 2 : 1);
        sfx.cash(result >= 5 ? 3 : 2);
        if (result >= 2.5) app.confetti(result >= 8 ? 70 : 30);
      } else {
        phase = "over";
      }

      if (result > 0) bankBest();
      refresh();
      return { multiplier: result };
    }

    function lightAll(on) { for (let i = 0; i < N; i++) lightPad(i, on); }

    function bankBest() {
      const start = startFor(mode);
      const len = clamp(start + pass - 1, start, maxLenFor(mode));
      let changed = false;
      if (len > (state.memory.bestLen || 0)) { state.memory.bestLen = len; changed = true; }
      if (pass > 0 && multFor(pass) > (state.memory.bestMult || 1)) { state.memory.bestMult = multFor(pass); changed = true; }
      if (changed) saveState();
    }

    /* the machine shows you what it wanted, then the lights go out */
    async function showFail() {
      phase = "over";
      const info = failInfo || { at: inputIndex, expected: seq[inputIndex] || 0, got: -1 };
      const want = info.expected;
      const cleared = pass === 0
        ? "Nothing was banked \u2014 that was still the first pattern."
        : "You had cleared " + pass + " sequence" + (pass === 1 ? "" : "s") +
          " (up to " + (startFor(mode) + pass - 1) + " colours) \u2014 all unbanked.";
      msgEl.className = "mem-msg lose";
      msgEl.textContent = "WRONG \u2014 it wanted " + PADS[want].name.toUpperCase() + " " + PADS[want].glyph + " next.";
      refresh();
      sfx.gameOver();
      for (let k = 0; k < 3; k++) {
        if (destroyed) return;
        lightAllOff();
        await sleep(150);
        lightPad(want, true);
        await sleep(240);
      }
      lightAllOff();
      if (destroyed) return;
      msgEl.innerHTML = "WRONG \u2014 it wanted <b>" + PADS[want].name.toUpperCase() + "</b>. " + cleared;
    }

    /* ---------- input ---------- */
    function tapPad(i, e) {
      if (e) e.preventDefault();
      padPress(i);
    }
    const padHandlers = PADS.map((_, i) => (e) => tapPad(i, e));
    for (let i = 0; i < N; i++) {
      padEls[i].addEventListener("pointerdown", padHandlers[i]);
      padEls[i].addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        tapPad(Number(e.currentTarget.getAttribute("data-i")) || 0);
      });
    }

    function onKey(e) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.repeat) return;
      const k = e.key;
      if (k >= "1" && k <= "4") {
        if (phase !== "input") return;
        e.preventDefault();
        padPress(Number(k) - 1);
        return;
      }
      if (k === "c" || k === "C") {
        if (phase !== "choose") return;
        e.preventDefault();
        choose("cash");
      }
    }
    window.addEventListener("keydown", onKey);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      phase = "over";
      window.removeEventListener("keydown", onKey);
      lightAllOff();
      const ir = inputResolve; inputResolve = null; if (ir) ir(false);
      const cr = choiceResolve; choiceResolve = null; if (cr) cr("abort");
    }

    /* ---------- info card ---------- */
    function openInfoCard() {
      const lastSeq = maxLenFor("seq");
      const lastRand = maxLenFor("rand");

      /* One row per COLOUR COUNT, not per level: the two modes open at different
         lengths, so a level-keyed table would sit SEQUENCE's 3-colour first pattern
         next to RANDOM's 5-colour one and quietly lie. A length shorter than a
         mode's opening length has no payout in that mode and prints a dash. The
         first few lengths are listed one by one (that is where the walking decision
         actually gets made), then every second colour. The table runs to whichever mode
         goes deepest (RANDOM, 23 colours) so that BOTH summits appear -- stopping at
         SEQUENCE's 21 would print RANDOM's top as x7.86 and hide the x10.88 it can pay.
         The bar is the bank in SQUARE-ROOT scale: the ladder only spans x1 to x11, so a
         linear bar would squash every rung under the summit into an invisible stub. */
      const lastLen = Math.max(lastSeq, lastRand);
      const lens = [];
      for (let n = seqStart; n <= lastLen; n++) {
        if (n <= seqStart + 9 || n === lastSeq || n === lastLen || n % 2 === 0) lens.push(n);
      }
      const at = (m, n) => (n < startFor(m) || n > maxLenFor(m) ? null : multOf(m, n - startFor(m) + 1));
      const barW = (v) => Math.max(4, Math.round((Math.sqrt(Math.max(v, 1)) / Math.sqrt(Math.max(summitRand, 1))) * 100));
      const show = (v) => (v === null ? "\u2014" : "\u00D7" + v.toFixed(2));
      const ladder = el("div", { class: "ic-ladder mem" },
        ...lens.map((n) => {
          const s = at("seq", n), r = at("rand", n);
          const top = (n === lastSeq || n === lastRand);
          const ref = r === null ? s : r;
          return el("div", { class: "rung" + (top ? " top" : "") },
            el("span", { text: n + " col" }),
            el("span", { class: "bar", style: { width: barW(ref) + "%" } }),
            el("span", { class: "v", text: show(s) + " / " + show(r) })
          );
        })
      );

      const pads = el("div", { class: "mem-pads" },
        ...PADS.map((p, i) => {
          const sw = el("span", { class: "mem-swatch" });
          sw.style.background = p.color;
          return el("span", { class: "mem-padrow" },
            el("b", { text: p.key }), sw,
            el("span", { text: p.glyph + " " + p.name })
          );
        })
      );

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "mem-mini" }, miniWheel()),
        pads,
        cap("Every pad has its own <b>colour, glyph and note</b>, so a pattern can be learned by eye, by ear, or both.")
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How you play",
            ul([
              "Press <b>START RECALL</b> to pay your stake. The machine flashes a sequence of <b>" + seqStart + " colours</b> \u2014 <b>" + randStart + "</b> in RANDOM mode.",
              "Repeat it by tapping the pads (keys <b>1\u20134</b> also work). Get the whole thing right and you clear the pass.",
              "Then you choose: <b>CASH OUT</b> to keep your bank, or <b>NEXT PASS</b> to add one more colour to the pattern \u2014 which also makes it flash faster.",
              "Miss a single pad and the run ends \u2014 the stake and every unbanked multiplier are gone. Banked money is never at risk after you take it.",
            ])
          ),
          sec("Two modes",
            ul([
              "<b>SEQUENCE</b> \u2014 the same pattern, one colour longer each pass. The order you already learned stays put, so you only carry the new colour on the end. Opens at <b>" + seqStart + " colours</b> and its bank climbs to <b>\u00D7" + summitSeq.toFixed(2) + "</b> by the last rung.",
              "<b>RANDOM</b> \u2014 the whole pattern is re-rolled at the new length every pass. Nothing carries over and every read is fresh, so it opens at <b>" + randStart + " colours</b> and pays more for the same length: the rung at <b>14 colours</b> is worth <b>\u00D7" + at("rand", 14).toFixed(2) + "</b> where SEQUENCE pays <b>\u00D7" + at("seq", 14).toFixed(2) + "</b>, and its summit is <b>\u00D7" + summitRand.toFixed(2) + "</b>.",
              "The mode is locked for the duration of a run, so choose it before you start.",
            ])
          ),
          sec("When to take the money",
            ul([
              "The first <b>" + knee + " colours</b> bank exactly <b>\u00D7 1.00</b>: clear them, cash out, and you have risked your stake to win nothing. Every rung above them is a real bet \u2014 the bank is <b>\u00D7" + at("seq", 10).toFixed(2) + "</b> at 10 colours, <b>\u00D7" + at("seq", 14).toFixed(2) + "</b> at 14 and <b>\u00D7" + at("seq", 18).toFixed(2) + "</b> at 18 \u2014 and it climbs for the same reason the pattern gets harder.",
              "The ladder is fitted to a <b>strong reader</b>: it pays exactly what the odds are worth to someone who clears <b>" + Math.round(decayFor("seq") * 100) + "%</b> of the extra colours in SEQUENCE (" + Math.round(decayFor("rand") * 100) + "% in RANDOM), which is a return of <b>" + Math.round(ladderRtp * 100) + "%</b> at every single rung. Clear better than that and pushing on pays; fall short and the machine is taking your money \u2014 and note the pattern is flashing faster every rung, so your odds are not standing still.",
              "Everyone believes they will remember one more colour. That belief is the house edge.",
            ])
          ),
          sec("The summit, and the table maximum",
            ul([
              "The ladder is <b>" + levels + " levels</b> long, each one a colour longer than the last: <b>" + seqStart + "\u2013" + lastSeq + " colours</b> in SEQUENCE and <b>" + randStart + "\u2013" + lastRand + "</b> in RANDOM. Clear the last one and the run cashes out by itself for <b>\u00D7" + summitSeq.toFixed(2) + "</b> in SEQUENCE or <b>\u00D7" + summitRand.toFixed(2) + "</b> in RANDOM \u2014 and that is the ceiling: no single run can ever pay more than <b>\u00D7" + machineMax.toFixed(2) + "</b>.",
              "Because a sharp memory is worth real money here, this is also the one table with a <b>maximum of its own</b> instead of the house level limit: <b>$" + Math.round(app.tableLimit()) + "</b> right now. It climbs with your level, and it is what stops a perfect reader from staking a fortune against a ladder he cannot lose.",
              "Every colour also makes the flash <b>" + Math.round((1 - CONFIG.memFlashDecay) * 100) + "%</b> shorter and the gap <b>" + Math.round((1 - CONFIG.memGapDecay) * 100) + "%</b> shorter, until both hit their floors (<b>" + Math.round(CONFIG.memMinFlashMs) + "ms</b> a colour, " + Math.round(CONFIG.memMinGapMs) + "ms between) at roughly <b>17 colours</b>. The ramp is frozen at <b>" + speedCap + " colours</b>, so past that a pattern still gets longer but never flashes faster.",
              "There is no dice roll anywhere in this machine \u2014 the only randomness is which colours the pattern uses.",
            ])
          )
        )
      );
      openInfo("Neon Recall \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Payout ladder \u2014 bank \u00D7 by pattern length (SEQUENCE / RANDOM)", ladder,
          note("Payouts are on your stake. The first <b>" + knee + " colours</b> bank exactly \u00D7 1.00 \u2014 a push, not a win \u2014 so the ladder only starts to pay above them: a \u00D7" + at("seq", 14).toFixed(2) + " bank on a $10 bet returns <b>$" + Math.round(10 * at("seq", 14)) + "</b>. The ladder is <b>" + levels + " levels</b> long and it is locked in <b>before</b> you pay, so there is no hidden scaling. RANDOM opens at <b>" + randStart + " colours</b>, which is why the shortest patterns show a dash in its column."))
      ));
    }

    refresh();
    return { root, play, actionLabel: "START RECALL", destroy };
  },
};
