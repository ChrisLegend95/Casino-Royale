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

   One mode: the same pattern, one colour longer each pass. The
   order you already learned stays put, so all you carry is the
   new colour on the end. Nothing is re-rolled and there is
   nothing to choose before a run starts.

   The ladder is 19 LEVELS of difficulty, each level one colour
   longer than the last: 3..21 colours. A rung is FITTED, never
   compounded: it pays memLadderRtp divided by the chance the
   reference player has of clearing that many colours, so that
   player's return is flat at memLadderRtp and the ladder holds
   no free money at all. The reference curve is perfect to
   memSkillKnee colours and then memSkillDecay per extra colour,
   which is why the first memSkillKnee colours pay exactly x1.00
   -- clear them, bank, and you have won nothing but lost
   nothing. (The old ladder paid x1.26 for a THREE-colour
   pattern and compounded to x295 at the summit, so a player
   could bank the trivial first pass forever, or take a fortune
   off a single good run.)

   The top of the ladder is therefore also the machine's ceiling,
   with memLadderCap as a hard guard just above the summit, and
   the machine carries a TABLE MAXIMUM of its own -- memTableBase
   x (level + 1), capped at memTableMax -- instead of the house
   level limit, because a skill table is the one place where a
   good player would otherwise be able to stake a fortune
   against a ladder he cannot lose. Those two numbers together
   cap what a single run can possibly win.

   Flash and gap timings start at memFlashMs/memGapMs and
   shrink by memFlashDecay/memGapDecay for EVERY extra colour,
   down to memMinFlashMs/memMinGapMs, so a pattern gets both
   longer and faster as it grows and a long one blurs past —
   that decay, not any RNG, is the difficulty curve. Both floors
   are reached around 17 colours, and the ramp is frozen at
   memMaxLen colours: past that a pattern only gets longer, it
   cannot flash any faster.
   ========================================================= */

/* The four pads. `key` is what the pad is LABELLED with (the tooltip and the
   info card's legend), `codes` is what actually plays it: the wheel is a compass,
   so green sits at the top, red on the right, gold at the bottom and blue on the
   left (see `midAngle` below) -- which means the arrow keys point at exactly the
   pad the player is looking at, and WASD falls on the same four directions. The
   old number-row keys are gone (the player asked for this): 1..4 named the pads
   in reading order, which on a wheel says nothing about where they are. */
const PADS = [
  { color: "#37d67a", dim: "#123a26", hov: "#1f7a48", glyph: "\u25B2", name: "green", key: "W / \u2191", codes: ["w", "arrowup"] },
  { color: "#ff5f6d", dim: "#3d1319", hov: "#8f2a34", glyph: "\u25C6", name: "red", key: "D / \u2192", codes: ["d", "arrowright"] },
  { color: "#f2c14e", dim: "#3a2d0c", hov: "#8a6a1f", glyph: "\u25CF", name: "gold", key: "S / \u2193", codes: ["s", "arrowdown"] },
  { color: "#4aa8ff", dim: "#122a44", hov: "#245f99", glyph: "\u25A0", name: "blue", key: "A / \u2190", codes: ["a", "arrowleft"] },
];
const N = PADS.length;
/* one lookup for the key handler: lower-cased `e.key` -> pad index */
const PAD_BY_KEY = {};
PADS.forEach((p, i) => { p.codes.forEach((c) => { PAD_BY_KEY[c] = i; }); });

/* Opening length: memStartLen colours (three). Resolved here, once, so the payout
   note, the info card and the engine cannot disagree. `levels` is how many
   difficulty levels the ladder runs (19 by default), and each level is one colour
   longer than the last, so the last level is `startLen + levels - 1` colours: 3..21.
   `speedCap` (memMaxLen) is where the flash/gap ramp freezes -- past that many
   colours a pattern still gets longer, it just cannot flash any faster. */
const startLen = clamp(Math.round(CONFIG.memStartLen) || 3, 2, 6);
const levels = clamp(Math.round(CONFIG.memLevels) || 27, 3, 60);
const speedCap = clamp(Math.round(CONFIG.memMaxLen) || 20, 2, 60);
const maxLen = startLen + levels - 1;

const CX = 100, CY = 100, R_OUT = 95, R_IN = 41;
const GAP_DEG = 3.2;

let gradSeq = 0;

const round2 = (n) => Math.round(n * 100) / 100;

/* The ladder is FITTED rather than compounded. A rung pays memLadderRtp divided by the
   chance the reference player has of clearing that many colours, so that player's
   return is FLAT at memLadderRtp -- every rung is a fair bet for exactly them, and only
   their read on their own memory decides. The reference curve is: perfect to
   memSkillKnee colours, then memSkillDecay per extra colour. So the first
   memSkillKnee colours pay exactly x1.00 -- a bank, not a win.

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
const skillDecay = clamp(CONFIG.memSkillDecay, 0.3, 0.999);
const ladderCap = Math.max(1, CONFIG.memLadderCap);
const multAt = (p) => {
  const n = startLen + clamp(Math.round(p), 0, levels) - 1;
  const extra = Math.max(0, n - knee);
  return round2(clamp(ladderRtp / Math.pow(skillDecay, extra), 1, ladderCap));
};
const summit = multAt(levels);
const machineMax = summit;

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
  /* no run can pay more than the cap allows, so advertise that rather than maxWinMult */
  maxWinMult: ladderCap,
  blurb: "Four neon pads, one ever-growing pattern. Repeat it to grow your bank \u2014 push your luck, or cash out before your memory does.",
  payoutNote: () =>
    "The machine flashes a pattern of colours; repeat it and your bank climbs. Then it is the only choice that matters: " +
    "<b>CASH OUT</b>, or <b>NEXT PASS</b> to add one more colour. Miss a pad and the whole stake is gone. " +
    "The ladder is <b>" + levels + " levels</b>, one colour each \u2014 from <b>" + startLen + " to " + maxLen +
    " colours</b>. The first <b>" + knee +
    " colours bank exactly \u00D7 1.00</b> \u2014 a push, not a win: there is no free money to compound, and every rung that does pay has to be earned. " +
    "Past them the bank climbs properly, to <b>\u00D7" + summit.toFixed(2) + "</b> at the last rung, " +
    "while the pattern flashes faster with every colour. No dice anywhere \u2014 it is your memory against the ladder.",
  create(app) {
    if (!state.memory || !Number.isFinite(state.memory.bestMult)) {
      state.memory = { bestLen: 0, bestMult: 1 };
    }
    if (!Number.isFinite(state.memory.bestLen) || state.memory.bestLen < 0) state.memory.bestLen = 0;
    /* a best-mult saved under the old compounding ladder (x295) is not a record the
       machine can still pay, so rescale it to the top of the ladder it can pay */
    if (!Number.isFinite(state.memory.bestMult) || state.memory.bestMult > machineMax) state.memory.bestMult = machineMax;

    /* the fitted ladder above; level p is level p of the 19, and multOf(0)
       is 1 -- nothing banked -- so the cash-out button and the HUD can call it blind */
    const multOf = multAt;

    /* Flash/gap time for a pattern of n colours: the base time shrunk by one decay
       step per colour beyond the opening length. `rampFor` freezes at speedCap colours
       (memMaxLen, 20 by default), so past that a pattern still gets longer but never
       flashes faster, and the floors stop a long pattern from collapsing into a single
       smear. */
    const rampFor = (n) => Math.max(0, Math.min(n, speedCap) - startLen);
    const flashFor = (n) => Math.max(CONFIG.memMinFlashMs, CONFIG.memFlashMs * Math.pow(CONFIG.memFlashDecay, rampFor(n)));
    const gapFor = (n) => Math.max(CONFIG.memMinGapMs, CONFIG.memGapMs * Math.pow(CONFIG.memGapDecay, rampFor(n)));

    /* ---------- closure state ---------- */
    let phase = "idle";         // idle | show | input | choose | over
    let seq = [];
    let pass = 0;               // sequences cleared this run
    let length = startLen;      // the sequence length on the wheel right now
    let inputIndex = 0;
    let inputResolve = null;
    let choiceResolve = null;
    let destroyed = false;
    let failInfo = null;

    const multFor = (p) => multOf(p);
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
    const hubLen = svgEl("text", { class: "mem-hub-len", x: CX, y: CY - 1, "text-anchor": "middle" }, String(startLen));
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
    const hudLen = el("span", { text: String(startLen) });
    const hudBank = el("span", { class: "gold", text: "1.00" });
    const hudNext = el("span", { text: multOf(1).toFixed(2) });
    const hudBest = el("span", { text: bestMult().toFixed(2) });

    /* The pip track is one pip per pass of the ladder, sized once: the opening length
       never changes now that the machine has a single mode. */
    const pips = [];
    const track = el("div", { class: "mem-track" });
    function buildTrack() {
      pips.length = 0;
      track.replaceChildren();
      for (let k = 0; k < levels; k++) {
        const pip = el("span", {
          class: "mem-pip",
          title: "Pass " + (k + 1) + " \u00B7 " + (startLen + k) + " colours \u00B7 \u00D7" + multOf(k + 1).toFixed(2),
        });
        pips.push(pip);
        track.appendChild(pip);
      }
    }
    buildTrack();

    /* ---------- controls ---------- */
    const cashKey = el("span", { class: "key", text: "bank your bet" });
    const nextKey = el("span", { class: "key", text: "grow to " + startLen + " colours" });
    const nextBtn = el("button", { class: "membtn go", type: "button", disabled: true, onclick: () => choose("next") },
      el("span", { class: "lbl", text: "NEXT PASS" }), nextKey
    );
    const cashBtn = el("button", { class: "membtn cash", type: "button", disabled: true, onclick: () => choose("cash") },
      el("span", { class: "lbl", text: "CASH OUT" }), cashKey
    );

    const msgEl = el("div", { class: "mem-msg", text: "Press START RECALL to pay your stake." });

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
      hudPass.textContent = pass + " / " + maxPass;
      hudLen.textContent = String(live ? length : (phase === "over" ? length : startLen));
      hudBank.textContent = multFor(pass).toFixed(2);
      hudNext.textContent = pass >= maxPass ? "\u2014" : multFor(pass + 1).toFixed(2);
      hudBest.textContent = bestMult().toFixed(2);
      hubLen.textContent = String(phase === "idle" ? startLen : length);
      hubSub.textContent = phase === "idle" ? "READY" : (phase === "over" ? "OVER" : "\u00D7" + multFor(pass).toFixed(2));
      cashKey.textContent = pass > 0 ? "take \u00D7" + multFor(pass).toFixed(2) : "bank your bet";
      nextKey.textContent = "grow to " + Math.min(maxLen, startLen + pass) + " colours";
      const locked = phase === "show" || phase === "input" || phase === "choose";
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
        const mp = levels;
        let p = 0;
        const chance = skillDecay;
        while (p < mp && Math.random() < chance) p++;
        const m = p > 0 ? multOf(p) : 0;
        pass = p;
        length = clamp(startLen + p - 1, startLen, maxLen);
        phase = "over";
        msgEl.className = "mem-msg " + (m > 0 ? "win" : "lose");
        msgEl.textContent = m > 0 ? "AUTO \u2014 banked \u00D7" + m.toFixed(2) : "AUTO \u2014 the pattern got away.";
        bankBest();
        refresh();
        return { multiplier: m };
      }

      pass = 0;
      seq = [];
      length = startLen;
      failInfo = null;
      phase = "show";
      msgEl.className = "mem-msg watch";
      msgEl.textContent = "GET READY";
      refresh();
      await sleep(320);

      let result = 0;
      let reason = "cash";
      try {
        for (;;) {
          pass++;
          length = startLen + pass - 1;
          if (pass === 1) seq = randomSeq(length);
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
          if (length >= maxLen) { reason = "summit"; result = multFor(pass); break; }

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
        msgEl.textContent = "SUMMIT \u2014 all " + maxLen + " colours. BANKED \u00D7" + result.toFixed(2);
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
      const len = clamp(startLen + pass - 1, startLen, maxLen);
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
          " (up to " + (startLen + pass - 1) + " colours) \u2014 all unbanked.";
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
      /* `e.key` for the arrows is `ArrowUp` & co., so lower-case the whole thing
         (letters must fold too: a shifted `W` is `"W"`, and Caps Lock makes every
         letter upper) before the lookup -- the table is all lower-case. */
      const lower = String(e.key || "").toLowerCase();
      /* arrows and WASD, one pad each (see PADS): the wheel is laid out like a
         compass, so `W`/`\u2191` is the top pad and so on. The arrows are CLAIMED
         for as long as this cabinet is mounted -- preventDefault stops them
         scrolling the page out from under a flashing pattern -- but they only
         PLAY during the input phase. */
      const pad = PAD_BY_KEY[lower];
      if (pad !== undefined) {
        e.preventDefault();
        if (phase === "input") padPress(pad);
        return;
      }
      if (lower === "c") {
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
      /* One row per COLOUR COUNT. The first few lengths are listed one by one (that is
         where the walking decision actually gets made), then every second colour. The
         bar is the bank in SQUARE-ROOT scale: the ladder only spans x1 to x7.3, so a
         linear bar would squash every rung under the summit into an invisible stub. */
      const lens = [];
      for (let n = startLen; n <= maxLen; n++) {
        if (n <= startLen + 9 || n === maxLen || n % 2 === 0) lens.push(n);
      }
      const at = (n) => multOf(n - startLen + 1);
      const barW = (v) => Math.max(4, Math.round((Math.sqrt(Math.max(v, 1)) / Math.sqrt(Math.max(summit, 1))) * 100));
      const ladder = el("div", { class: "ic-ladder mem" },
        ...lens.map((n) => {
          const v = at(n);
          const top = (n === maxLen);
          return el("div", { class: "rung" + (top ? " top" : "") },
            el("span", { text: n + " col" }),
            el("span", { class: "bar", style: { width: barW(v) + "%" } }),
            el("span", { class: "v", text: "\u00D7" + v.toFixed(2) })
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
              "Press <b>START RECALL</b> to pay your stake. The machine flashes a sequence of <b>" + startLen + " colours</b>.",
              "Repeat it by tapping the pads \u2014 the <b>arrow keys</b> or <b>WASD</b> play the same four pads, since the wheel is laid out like a compass (green up, red right, gold down, blue left). The pattern keeps its order and grows by one colour every pass, so all you carry into the next pass is the new colour on the end.",
              "Clear a pass and you choose: <b>CASH OUT</b> to keep your bank, or <b>NEXT PASS</b> to add one more colour to the pattern \u2014 which also makes it flash faster.",
              "Miss a single pad and the run ends \u2014 the stake and every unbanked multiplier are gone. Banked money is never at risk after you take it.",
            ])
          ),
          sec("When to take the money",
            ul([
              "The first <b>" + knee + " colours</b> bank exactly <b>\u00D7 1.00</b>: clear them, cash out, and you have risked your stake to win nothing \u2014 the ladder only starts to pay at <b>" + (knee + 1) + " colours</b>. Every rung above the knee is a real bet \u2014 the bank is <b>\u00D7" + at(10).toFixed(2) + "</b> at 10 colours, <b>\u00D7" + at(14).toFixed(2) + "</b> at 14 and <b>\u00D7" + at(18).toFixed(2) + "</b> at 18 \u2014 and it climbs for the same reason the pattern gets harder.",
              "The ladder is fitted to a <b>strong reader</b>: it pays exactly what the odds are worth to someone who clears <b>" + Math.round(skillDecay * 100) + "%</b> of the extra colours beyond the knee, which is a return of <b>" + Math.round(ladderRtp * 100) + "%</b> at every single rung. Clear better than that and pushing on pays; fall short and the machine is taking your money \u2014 and note the pattern is flashing faster every rung, so your odds are not standing still.",
              "Everyone believes they will remember one more colour. That belief is the house edge.",
            ])
          ),
          sec("The summit, and the table maximum",
            ul([
              "The ladder is <b>" + levels + " levels</b> long, each one a colour longer than the last: <b>" + startLen + "\u2013" + maxLen + " colours</b>. Clear the last one and the run cashes out by itself for <b>\u00D7" + summit.toFixed(2) + "</b> \u2014 and that is the ceiling: no single run can ever pay more than <b>\u00D7" + machineMax.toFixed(2) + "</b>.",
              "Because a sharp memory is worth real money here, this is also the one table with a <b>maximum of its own</b> instead of the house level limit: <b>$" + Math.round(app.tableLimit()) + "</b> right now. It climbs with your level, and it is what stops a perfect reader from staking a fortune against a ladder he cannot lose.",
              "Every colour also makes the flash <b>" + Math.round((1 - CONFIG.memFlashDecay) * 100) + "%</b> shorter and the gap <b>" + Math.round((1 - CONFIG.memGapDecay) * 100) + "%</b> shorter, until both hit their floors (<b>" + Math.round(CONFIG.memMinFlashMs) + "ms</b> a colour, " + Math.round(CONFIG.memMinGapMs) + "ms between) at roughly <b>17 colours</b>. The ramp is frozen at <b>" + speedCap + " colours</b>, so past that a pattern still gets longer but never flashes faster.",
              "There is no dice roll anywhere in this machine \u2014 the only randomness is which colours the pattern uses.",
            ])
          )
        )
      );
      openInfo("Neon Recall \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Payout ladder \u2014 bank \u00D7 by pattern length", ladder,
          note("Payouts are on your stake. The first <b>" + knee + " colours</b> bank exactly \u00D7 1.00 \u2014 a push, not a win \u2014 so the ladder only starts to pay above them: a \u00D7" + at(14).toFixed(2) + " bank on a $10 bet returns <b>$" + Math.round(10 * at(14)) + "</b>. The ladder is <b>" + levels + " levels</b> long and it is locked in <b>before</b> you pay, so there is no hidden scaling."))
      ));
    }

    refresh();
    return { root, play, actionLabel: "START RECALL", destroy };
  },
};
