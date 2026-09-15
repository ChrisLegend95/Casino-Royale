import { el } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, sec, ul, note } from "./infocard.js";
import { state, saveState, CONFIG } from "../state.js";
import { sfx } from "../audio.js";
import {
  FROG_CONST, TIERS, mulberry32, makeLane, stepLane, laneCars, laneHit, timeUntilHit,
  clearFor, multFor, perHopFor, overlappedLanes, blockSecFor,
  tierOf, isSafeLane, isSummit, nextIsland, atmosphereFor,
} from "./frogger-math.js";

/* =========================================================
   Frogger Gamble — a tiny frog crosses a 100-lane road.

   The frog sits on a fixed column and its ONLY controls are
   CROSS (hop up one lane) and BANK (take the money and run).
   It starts safe on the verge at x1.00.

   The road is ten blocks of ten lanes. Every tenth lane is a
   SAFE ISLAND -- a traffic-free grass median where nothing can
   touch you and you can rest as long as you like. Lane 100 is
   the summit: crossing it finishes the run.

   The nine real lanes in each block are a TIER, and every tier
   is a step nastier than the one before it: faster traffic,
   tighter guaranteed windows, longer convoys, bigger vehicles,
   and (from the sixth block on) night, drizzle and storms.
   The safe pocket you get for landing also shortens as you go.

   Traffic is irregular: each lane is a little convoy of cars
   with randomly-sized widths and randomly-sized gaps, looping
   for ever. Nothing is hidden behind a dice roll -- you can
   watch every bumper coming, and the frog's column is lit
   green/red by whether the lane above is open long enough.

   Landing in a gap makes the road BLOCK that lane behind you:
   traffic in it holds still and you get a short safe pocket to
   stand in, so stopping is never free. Hopping while a car is
   coming still flattens you mid-air, and banking is always safe.

   The traffic model lives in frogger-math.js and can be
   re-simulated headlessly.
   ========================================================= */

const C = FROG_CONST;
const VIEW_LANES = 5.05;    // lane units visible vertically
const FROG_SCREEN = 0.7;    // where the frog sits down the canvas
const READY_SEC = 1.15;     // "road's clear" beat before the cars appear
const FADE_SEC = 0.5;       // how long the traffic takes to arrive
const HOP_LIFT = 0.42;      // sprite lift at the top of a hop, in lane units

function multText(m) {
  return "\u00D7" + m.toFixed(2);
}

export default {
  id: "frogger",
  name: "Frogger Gamble",
  icon: "\u{1F438}",
  action: "CROSS THE ROAD",
  canIdle: false,
  minBet: 1,
  blurb: "A frog, a 100-lane road, and one button. Ten brutal blocks, a safe island every tenth lane, and a summit worth \u00D710.50.",
  payoutNote: () =>
    "You start safe on the verge at <b>\u00D71.00</b>. The road is <b>100 lanes</b> in ten blocks of ten, and " +
    "every tenth lane (<b>10, 20, 30 \u2026 100</b>) is a <b>SAFE ISLAND</b> \u2014 no traffic, nothing can touch you, " +
    "rest as long as you like. The nine lanes between islands are a tier, and each tier hits harder than the last. " +
    "Rungs widen a notch per block: <b>+0.05</b> a lane in the first block, <b>+0.14</b> a lane in the last \u2014 " +
    "<b>\u00D71.50</b> at lane 10, <b>\u00D74.50</b> at 50 and <b>\u00D710.50</b> on the summit. " +
    "Traffic is irregular and you can watch it coming: if one reaches your column you're flattened and the whole " +
    "stake is lost. <b>CROSS</b> to hop, <b>BANK</b> to keep what you've got. Land in a gap and the road " +
    "<b>blocks the lane behind you</b> \u2014 but that pocket gets shorter the deeper you are. Jump while a car " +
    "is coming and you get splatted.",

  create(app) {
    if (!state.frogger || !Number.isFinite(state.frogger.bestDepth)) {
      state.frogger = { bestDepth: 0, bestMult: C.startMult };
    }
    if (!Number.isFinite(state.frogger.bestMult) || state.frogger.bestMult < C.startMult) {
      state.frogger.bestMult = C.startMult;
    }
    // the safe-pocket length is a root tunable so the machine can be made as
    // punishing (short) or as safe (long) as the player wants
    if (Number.isFinite(CONFIG.froggerBlockSec) && CONFIG.froggerBlockSec > 0) {
      C.blockHi = CONFIG.froggerBlockSec;
      C.blockMin = Math.min(C.blockMin, C.blockHi);
    }

    const canvas = el("canvas", { class: "frogger-canvas" });
    const statusEl = el("div", { class: "frogger-status", text: "PRESS CROSS THE ROAD TO PLAY" });

    const hudMult = el("span", { text: "1.00" });
    const hudLanes = el("span", { text: "1" });
    const hudNext = el("span", { text: "1.05" });
    const hudIsland = el("span", { text: "10" });
    const hudBest = el("span", { text: "1.00" });
    const dangerFill = el("i");
    const dangerLabel = el("span", { class: "fd-label", text: "ROAD CLEAR" });

    // the tier track: one bar per ten-lane block, filling as you cross it
    const ftTier = el("span", { class: "ft-tier", text: "TIER 1 / 10" });
    const ftName = el("span", { class: "ft-name", text: TIERS[0].name });
    const ftIsland = el("span", { class: "ft-island", text: "ISLAND 10" });
    const ftBars = [];
    const trackWrap = el("div", { class: "ft-track" },
      ...TIERS.map((T, k) => {
        const fill = el("i");
        const bar = el("span", {
          class: "ft-bar", title: "Lanes " + (k * 10 + 1) + "\u2013" + ((k + 1) * 10) + " \u00B7 " + T.name,
        }, fill);
        ftBars.push({ bar, fill });
        return bar;
      })
    );

    const crossBtn = el("button", { class: "fbtn cross", type: "button", "aria-label": "Cross" },
      el("span", { class: "glyph", text: "\u25B2" }),
      el("span", { class: "lbl", text: "CROSS" }),
      el("span", { class: "key", text: "\u2191 / space" })
    );
    const bankBtn = el("button", { class: "fbtn bank", type: "button", "aria-label": "Bank" },
      el("span", { class: "glyph", text: "\u20BF" }),
      el("span", { class: "lbl", text: "BANK" }),
      el("span", { class: "key", text: "\u2193 / enter" })
    );

    const root = stageShell(
      "Frogger Gamble",
      "Cross the road one lane at a time. Every lane pays more than the last \u2014 the cars are right there, so it's your call when to go.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "frogger-wrap" },
        el("div", { class: "slot-cabinet frogger-cab" },
          el("div", { class: "slot-marquee" },
            el("span", { class: "lights" }, el("i"), el("i"), el("i")),
            el("span", { class: "marquee-title", text: "FROGGER GAMBLE" }),
            el("span", { class: "sub", text: "100 LANES \u00B7 10 BLOCKS \u00B7 1 PLAYER" }),
            el("span", { class: "lights" }, el("i"), el("i"), el("i"))
          ),
          el("div", { class: "frogger-hud" },
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Bank now" }),
              el("span", { class: "v gold", text: "\u00D7" }, hudMult)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Lanes crossed" }),
              el("span", { class: "v" }, hudLanes, el("em", { class: "of", text: "/ " + C.summit }))),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Next lane" }),
              el("span", { class: "v" }, el("span", { text: "\u00D7" }), hudNext)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Next island" }),
              el("span", { class: "v safe" }, el("span", { class: "pin", text: "\u25C6" }), hudIsland)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Best banked" }),
              el("span", { class: "v" }, el("span", { text: "\u00D7" }), hudBest))
          ),
          el("div", { class: "frogger-tier" },
            el("div", { class: "ft-head" }, ftTier, ftName, ftIsland),
            trackWrap
          ),
          el("div", { class: "frogger-danger" },
            el("div", { class: "fd-bar" }, dangerFill),
            dangerLabel
          ),
          el("div", { class: "frogger-screen" }, canvas),
          statusEl,
          el("div", { class: "frogger-controls" }, crossBtn, bankBtn)
        )
      )
    );

    const ctx = canvas.getContext("2d");

    /* ---------- state ---------- */
    let cssW = 420, cssH = 336, dpr = 1, laneH = 60;
    let seed = 1;
    let lanes = [null];
    let phase = "idle";        // idle | ready | run | done
    let readyT = 0, fade = 1, doneT = 0;
    let blockT = 0;            // seconds of safe pocket left in the lane we're standing in
    let camY = 0;
    let depth = 0;
    let resolveRun = null;
    let outcome = null;
    let rafId = 0, lastT = 0, destroyed = false, sizeTick = 0;
    let floaters = [];
    let shake = 0;
    let banner = null;         // { text, t, life, cls }
    let attractT = 0;
    let atmoT = 0;             // weather clock (rain animation)
    let atmo = { night: 0, rain: 0 };   // eased toward the current tier's weather
    let drawnCars = [];        // this frame's visible cars, for the headlight pass
    let queued = null;         // a "bank" pressed mid-hop, applied on landing (hops never buffer)

    const frog = { lane: 0, y: 0, from: 0, to: 1, t: 0, rest: 0, hop: 0, arc: 0, state: "rest", squash: 0, deadLane: 0 };

    /* ---------- lanes ---------- */
    function laneRng(i) {
      return mulberry32(((seed ^ Math.imul(i, 0x9e3779b1)) >>> 0) || 1);
    }
    function ensureLane(i) {
      for (let n = lanes.length; n <= i; n++) lanes.push(makeLane(n, laneRng(n)));
      return lanes[i];
    }
    function buildWorld(newSeed) {
      seed = newSeed >>> 0 || 1;
      lanes = [null];
      ensureLane(C.maxLanes);
    }
    function liveLanes() {
      return Math.min(lanes.length - 1, frog.lane + 5);
    }

    /* ---------- fx ---------- */
    function float(text, worldY, cls) {
      floaters.push({ text, y: worldY, t: 0, life: 0.8, cls: cls || "" });
    }
    function showBanner(text, cls, life) {
      banner = { text, cls: cls || "", t: 0, life: life || 1.6 };
    }

    /* ---------- hud ---------- */
    function currentMult() { return multFor(depth); }

    /* Which block of ten are we in, how full is each block's bar, and which
       island is next. Safe islands get their own flag so the track lights up
       the moment the frog is standing on one. */
    function refreshTierUI() {
      const lane = Math.max(1, Math.min(C.summit, Math.floor(frog.lane) || 1));
      const t = tierOf(lane);
      const standing = isSafeLane(frog.lane);
      ftTier.textContent = "TIER " + (t + 1) + " / " + TIERS.length;
      ftName.textContent = TIERS[t].name;
      ftName.style.setProperty("--tc", TIERS[t].accent);
      const ahead = nextIsland(Math.max(1, Math.floor(frog.lane) + (standing ? 0 : 1)));
      ftIsland.textContent = standing
        ? (isSummit(frog.lane) ? "SUMMIT" : "ISLAND " + frog.lane)
        : (ahead >= C.summit ? "SUMMIT 100" : "ISLAND " + ahead);
      ftIsland.classList.toggle("here", standing);
      hudIsland.textContent = String(standing ? frog.lane : ahead);
      for (let k = 0; k < ftBars.length; k++) {
        const from = k * C.islandEvery, to = (k + 1) * C.islandEvery;
        const p = Math.max(0, Math.min(1, (frog.lane - from) / (to - from)));
        ftBars[k].fill.style.width = (p * 100).toFixed(1) + "%";
        ftBars[k].bar.classList.toggle("now", t === k);
        ftBars[k].bar.classList.toggle("done", frog.lane >= to);
      }
    }

    function refreshHud() {
      const m = phase === "run" || phase === "done" ? currentMult() : C.startMult;
      hudMult.textContent = m.toFixed(2);
      hudLanes.textContent = String(depth);
      hudNext.textContent = multFor(depth + 1).toFixed(2);
      hudBest.textContent = (state.frogger.bestMult || C.startMult).toFixed(2);
      refreshTierUI();
    }
    function refreshDanger() {
      if (phase !== "run") {
        dangerFill.style.width = "0%";
        dangerLabel.textContent = phase === "idle" ? "PRESS PLAY" : "ROAD CLEAR";
        dangerFill.className = "";
        return;
      }
      const standing = frog.state === "rest" && isSafeLane(frog.lane);
      const next = ensureLane(frog.lane + 1);
      const nextIsland = isSafeLane(frog.lane + 1);
      // An island never lapses, so the bar sits full green and reads as a rest
      // stop. Standing on one, the label still counts the window in the lane
      // above down, so you know when it is worth leaving.
      if (standing || nextIsland) {
        dangerFill.style.width = "100%";
        dangerFill.className = "safe";
        if (standing) {
          const w = timeUntilHit(next, C.frogX, C.frogHalfW);
          dangerLabel.textContent = !Number.isFinite(w) || w <= 0.001
            ? (isSummit(frog.lane) ? "THE SUMMIT" : "SAFE ISLAND")
            : w > 0.6 ? "SAFE \u00B7 WINDOW OPEN"
              : "SAFE \u00B7 " + w.toFixed(2) + "s";
        } else {
          dangerLabel.textContent = isSummit(frog.lane + 1) ? "SUMMIT AHEAD" : "SAFE ISLAND AHEAD";
        }
        return;
      }
      // While the pocket holds you are untouchable where you stand: the bar
      // counts the pocket down. Once it lapses the frog's own lane is live
      // again, and the bar counts whichever of (own lane, lane above) will
      // reach the column first.
      if (frog.state === "rest" && blockT > 0) {
        const total = Math.max(0.001, blockSecFor(Math.max(1, frog.lane)));
        dangerFill.style.width = (clamp(blockT / total, 0, 1) * 100).toFixed(1) + "%";
        dangerFill.className = "safe";
        dangerLabel.textContent = "SAFE " + blockT.toFixed(1) + "s";
        return;
      }
      const t = frog.state === "hop"
        ? timeUntilHit(next, C.frogX, C.frogHalfW)
        : Math.min(timeUntilHit(lanes[frog.lane], C.frogX, C.frogHalfW), timeUntilHit(next, C.frogX, C.frogHalfW));
      const ref = Math.max(C.cwFloor, Number.isFinite(next && next.cw) ? next.cw : C.cwFloor);
      const f = clamp(t / ref, 0, 1);
      dangerFill.style.width = (f * 100).toFixed(1) + "%";
      dangerFill.className = t < 0.3 ? "hot" : t < 0.6 ? "warm" : "";
      const lead = frog.state === "rest" ? "MOVE! CAR IN " : "CAR IN ";
      dangerLabel.textContent = t <= 0.001 ? "BLOCKED!" : lead + t.toFixed(2) + "s";
    }

    /* ---------- round flow ---------- */
    function resetFrog() {
      frog.lane = 0; frog.y = 0; frog.from = 0; frog.to = 1; frog.t = 0;
      frog.rest = 0; frog.hop = 0; frog.arc = 0; frog.state = "rest"; frog.squash = 0; frog.deadLane = 0;
      depth = 0; camY = 0; floaters = []; banner = null; shake = 0; queued = null; blockT = 0;
      atmo = { night: 0, rain: 0 };
    }

    function startRun() {
      // the frog begins resting on the verge, exactly even at x1.00 -- the
      // first lane is a crossing the player has to choose, not a free step
      frog.lane = 0; frog.y = 0; frog.from = 0; frog.to = 0; frog.t = 0;
      frog.state = "rest"; frog.rest = C.settleSec; frog.hop = 0; frog.arc = 0;
      depth = 0; camY = 0; queued = null; blockT = 0;
      phase = "run";
      crossBtn.disabled = false;
      bankBtn.disabled = false;
      sfx.ready();
      statusEl.className = "frogger-status";
      statusEl.textContent = "ON THE VERGE \u2014 " + TIERS[0].name + " \u00B7 first island at lane 10";
      refreshHud();
      refreshDanger();
    }

    function onLanded() {
      if (frog.lane > 0) {
        depth = frog.lane;
        const island = isSafeLane(depth);
        blockT = island ? 0 : blockSecFor(depth);
        float(multText(multFor(depth)), frog.y + 0.35, "good");
        sfx.hop();
        if (island) {
          sfx.win(1);
          showBanner(isSummit(depth) ? "SUMMIT \u2014 \u00D7" + multFor(depth).toFixed(2) : "ISLAND " + depth, "good", 1.6);
          statusEl.className = "frogger-status won";
          statusEl.textContent = isSummit(depth)
            ? "THE SUMMIT \u2014 all " + C.summit + " lanes"
            : "SAFE ISLAND " + depth + " \u2014 nothing reaches you here. Next: " +
              TIERS[Math.min(TIERS.length - 1, tierOf(depth + 1))].name;
        } else {
          const prev = lanes[frog.lane - 1];
          if (prev && frog.lane > 1 && timeWithin(prev, 0.4) && Math.random() < 0.5) sfx.horn();
        }
      }
      refreshHud();
      if (phase === "run" && isSummit(frog.lane)) finish(currentMult(), "summit");
    }

    function timeWithin(lane, sec) {
      const t = timeUntilHit(lane, C.frogX, C.frogHalfW);
      return Number.isFinite(t) && t < sec;
    }

    function doCross() {
      const to = frog.lane + 1;
      if (to > C.summit) return;
      ensureLane(Math.min(C.maxLanes, to + 2));
      frog.from = frog.y; frog.to = to; frog.t = 0; frog.state = "hop"; frog.hop = 0;
      sfx.blip();
    }

    function cross() {
      if (phase === "ready") { if (readyT > 0.35) readyT = 0.35; return; }
      if (phase !== "run") return;
      // A hop is always a deliberate call: a press made mid-hop is dropped
      // rather than buffered, so a mashed button can never fling the frog into
      // a lane the player never actually looked at. BANK does buffer, because
      // that one can never hurt you.
      if (frog.state === "rest" && frog.rest >= C.settleSec) { queued = null; doCross(); }
    }

    function doBank() {
      sfx.bank();
      float("BANKED " + multText(currentMult()), frog.y + 0.35, "good");
      finish(currentMult(), "bank");
    }

    function bank() {
      if (phase !== "run") return;
      if (frog.state === "rest") { queued = null; doBank(); }
      else if (frog.state === "hop") queued = "bank";
    }

    function finish(mult, kind) {
      phase = "done";
      doneT = kind === "summit" ? 2.4 : 1.0;
      outcome = { multiplier: mult };
      crossBtn.disabled = true;
      bankBtn.disabled = true;
      if (kind !== "splat") {
        const best = state.frogger;
        const m = multFor(depth);
        if (depth > (best.bestDepth || 0) || m > (best.bestMult || 0)) {
          best.bestDepth = Math.max(best.bestDepth || 0, depth);
          best.bestMult = Math.max(best.bestMult || 0, m);
          saveState();
        }
      }
      refreshHud();
      const lanesWord = " lane" + (depth === 1 ? "" : "s");
      if (kind === "splat") {
        statusEl.className = "frogger-status lost";
        statusEl.textContent = "SPLAT \u2014 flattened on lane " + (frog.deadLane || frog.lane) + " after " + depth + lanesWord;
        showBanner("SPLAT!", "bad", 1.4);
      } else if (kind === "summit") {
        statusEl.className = "frogger-status won";
        statusEl.textContent = "SUMMIT! ALL " + C.summit + " LANES \u2014 BANKED " + multText(mult);
        showBanner("SUMMIT \u2014 " + multText(mult), "good", 2.4);
        shake = 0.2;
      } else {
        statusEl.className = "frogger-status won";
        statusEl.textContent = "BANKED " + multText(mult) + " \u2014 " + depth + lanesWord + " crossed";
        showBanner("BANKED " + multText(mult), "good", 1.6);
      }
      const r = resolveRun;
      resolveRun = null;
      if (r) r(outcome);
    }

    function die(killerLane) {
      frog.state = "splat";
      frog.deadLane = killerLane;
      frog.squash = 1;
      shake = 0.45;
      sfx.squish();
      finish(0, "splat");
    }

    /* ---------- update ---------- */
    function update(dt) {
      attractT += dt;
      ensureLane(Math.min(C.maxLanes, frog.lane + 4));
      const top = liveLanes();
      // The road "blocks" under a resting frog: traffic in the lane it is
      // standing in holds still, so an open gap you land in stays open while
      // you decide (see `blockT`). Every other lane keeps moving -- including
      // the one you are hopping out of and the one you are hopping into -- so
      // a car that arrives while you are mid-hop still flattens you. Once the
      // pocket lapses the lane starts flowing again and standing there is no
      // longer free.
      if (frog.state === "rest") blockT = Math.max(0, blockT - dt);
      const held = frog.state === "rest" && blockT > 0 ? frog.lane : -1;
      for (let i = 1; i <= top; i++) {
        if (i === held) continue;
        stepLane(lanes[i], dt);
      }

      if (frog.state === "hop") {
        frog.t += dt;
        const p = Math.min(1, frog.t / C.hopSec);
        frog.hop = p;
        frog.arc = Math.sin(Math.PI * p);
        frog.y = frog.from + (frog.to - frog.from) * p;
        if (p >= 1) {
          frog.y = frog.to;
          frog.lane = frog.to;
          frog.state = "rest";
          frog.rest = 0;
          frog.arc = 0;
          frog.hop = 0;
          onLanded();
          if (queued === "bank" && phase === "run") { queued = null; doBank(); }
          if (phase !== "run") return;
        }
      } else if (frog.state === "rest") {
        frog.rest += dt;
      }

      camY += (frog.y - camY) * Math.min(1, dt * 9);
      if (frog.state !== "splat") {
        const touched = overlappedLanes(frog.y, C.frogHalfH, lanes.length - 1);
        for (const i of touched) {
          // The lane you're jumping out of can't touch you: the road holds it
          // back (and the frog is airborne anyway, so the cars pass beneath).
          // What kills you is the lane you're jumping INTO.
          if (frog.state === "hop" && i === frog.lane) continue;
          if (laneHit(lanes[i], C.frogX, C.frogHalfW)) { die(i); return; }
        }
      }
    }

    function updateFx(dt) {
      for (const f of floaters) f.t += dt;
      floaters = floaters.filter((f) => f.t < f.life);
      if (shake > 0) shake = Math.max(0, shake - dt);
      if (banner) { banner.t += dt; if (banner.t > banner.life) banner = null; }
      camY += (frog.y - camY) * Math.min(1, dt * 9);
    }

    /* =========================================================
       drawing
       ========================================================= */
    function roundRect(x, y, w, h, r) {
      const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function drawCar(x0, x1, cy, hpx, lane, alpha) {
      const wpx = x1 - x0;
      const h = hpx * 0.76;
      const y = cy - h / 2;
      const dir = lane.dir;
      ctx.save();
      ctx.globalAlpha = alpha;
      // ground shadow
      ctx.fillStyle = "rgba(0,0,0,.38)";
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, cy + hpx * 0.34, wpx * 0.5, hpx * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      const rad = Math.min(h * 0.3, wpx * 0.2);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, lane.body);
      g.addColorStop(0.55, lane.body);
      g.addColorStop(1, lane.shade);
      ctx.fillStyle = g;
      roundRect(x0, y, wpx, h, rad);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = Math.max(1, hpx * 0.02);
      ctx.stroke();

      const truck = lane.kind === "truck";
      const front = dir > 0 ? x1 : x0;
      const back = dir > 0 ? x0 : x1;

      if (truck) {
        // cab at the front, box behind
        const cabW = Math.min(wpx * 0.34, wpx - h * 0.6);
        const cabX = dir > 0 ? x1 - cabW : x0;
        ctx.fillStyle = lane.shade;
        roundRect(cabX, y - h * 0.06, cabW, h * 1.12, rad * 0.8);
        ctx.fill();
        ctx.fillStyle = "rgba(180,220,255,.5)";
        const wsW = cabW * 0.5;
        roundRect(dir > 0 ? cabX + cabW - wsW - cabW * 0.14 : cabX + cabW * 0.14, y - h * 0.02, wsW, h * 0.44, rad * 0.4);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.25)";
        ctx.lineWidth = Math.max(1, hpx * 0.015);
        for (let i = 1; i <= 3; i++) {
          const lx = (dir > 0 ? x0 + wpx * 0.06 : x0 + wpx * 0.94) + (dir > 0 ? 1 : -1) * i * wpx * 0.12;
          ctx.beginPath();
          ctx.moveTo(lx, y + h * 0.12);
          ctx.lineTo(lx, y + h * 0.88);
          ctx.stroke();
        }
      } else {
        // windscreen + roof
        ctx.fillStyle = "rgba(175,215,255,.55)";
        const wsW = wpx * 0.26;
        const wsX = dir > 0 ? x1 - wsW - wpx * 0.16 : x0 + wpx * 0.16;
        roundRect(wsX, y + h * 0.1, wsW, h * 0.8, rad * 0.5);
        ctx.fill();
        ctx.fillStyle = "rgba(175,215,255,.35)";
        const rwW = wpx * 0.2;
        const rwX = dir > 0 ? x0 + wpx * 0.2 : x1 - rwW - wpx * 0.2;
        roundRect(rwX, y + h * 0.14, rwW, h * 0.72, rad * 0.5);
        ctx.fill();
      }

      // wheels
      ctx.fillStyle = "#0b0d12";
      const wr = h * 0.2;
      for (const wx of [x0 + wpx * 0.2, x1 - wpx * 0.2]) {
        roundRect(wx - wr, y + h - wr * 0.4, wr * 2, wr * 1.15, wr * 0.4);
        ctx.fill();
      }

      // lights
      const ly = cy;
      ctx.fillStyle = "#fff4c2";
      ctx.beginPath();
      ctx.arc(front - dir * wpx * 0.06, y + h * 0.22, Math.max(1.4, h * 0.09), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(front - dir * wpx * 0.06, y + h * 0.78, Math.max(1.4, h * 0.09), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff5a4d";
      ctx.fillRect(back - dir * wpx * 0.02 - (dir > 0 ? 0 : 2), y + h * 0.14, 3, Math.max(2, h * 0.16));
      ctx.fillRect(back - dir * wpx * 0.02 - (dir > 0 ? 0 : 2), y + h * 0.7, 3, Math.max(2, h * 0.16));

      // headlight glow on the tarmac
      const gl = ctx.createLinearGradient(front, 0, front + dir * hpx * 1.5, 0);
      gl.addColorStop(0, "rgba(255,244,194,.20)");
      gl.addColorStop(1, "rgba(255,244,194,0)");
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.moveTo(front, y + h * 0.1);
      ctx.lineTo(front + dir * hpx * 1.5, y + h * 0.55);
      ctx.lineTo(front + dir * hpx * 1.5, y + h * 1.5);
      ctx.lineTo(front, y + h * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawChevron(cx, cy, dir, size, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "rgba(255,255,255,.16)";
      ctx.lineWidth = Math.max(1.2, size * 0.22);
      ctx.lineCap = "round";
      for (let k = -1; k <= 1; k++) {
        const x = cx + dir * k * size * 0.9;
        ctx.beginPath();
        ctx.moveTo(x - dir * size * 0.3, cy - size * 0.42);
        ctx.lineTo(x + dir * size * 0.3, cy);
        ctx.lineTo(x - dir * size * 0.3, cy + size * 0.42);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------- safe islands -------------------------------------------------
       Every tenth lane is a traffic-free median. It reads as a completely
       different surface from the tarmac -- grass, kerbs, scenery -- so the
       player can tell at a glance that this lane is the one that cannot hurt
       them. The summit (lane 100) is the same idea in gold with a checkered
       kerb. */
    function drawKerb(y, h, checkered) {
      const t = Math.max(2, h * (checkered ? 0.15 : 0.11));
      for (const yy of [y, y + h - t]) {
        if (checkered) {
          for (let x = 0, i = 0; x < cssW; x += t, i++) {
            ctx.fillStyle = i % 2 ? "#0d1320" : "#f6f9ff";
            ctx.fillRect(x, yy, t, t);
          }
        } else {
          ctx.fillStyle = "#c8d2e6";
          ctx.fillRect(0, yy, cssW, t);
          ctx.fillStyle = "#39435a";
          const sw = t * 1.7;
          for (let x = 0; x < cssW + sw; x += sw * 2) ctx.fillRect(x, yy, sw, t);
        }
      }
    }

    function drawDecor(it, y, h, xOf) {
      const cx = xOf(it.x);
      const cy = y + h * 0.5;
      const s = h * 0.28 * it.s;
      if (it.kind === "tree") {
        ctx.fillStyle = "#463121";
        ctx.fillRect(cx - s * 0.1, cy, s * 0.2, s * 0.85);
        const cg = ctx.createRadialGradient(cx - s * 0.22, cy - s * 0.72, s * 0.05, cx, cy - s * 0.5, s * 1.1);
        cg.addColorStop(0, "#7fe09b");
        cg.addColorStop(1, "#1b5530");
        ctx.fillStyle = cg;
        for (const [dx, dy, rr] of [[-0.44, -0.36, 0.5], [0.42, -0.42, 0.48], [0, -0.82, 0.56]]) {
          ctx.beginPath();
          ctx.arc(cx + dx * s, cy + dy * s, s * rr, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (it.kind === "bush") {
        ctx.fillStyle = "#2b7a49";
        for (const [dx, dy, rr] of [[-0.5, 0.26, 0.5], [0.5, 0.3, 0.46], [0, -0.16, 0.6]]) {
          ctx.beginPath();
          ctx.arc(cx + dx * s, cy + dy * s, s * rr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(150,240,180,.3)";
        ctx.beginPath();
        ctx.arc(cx - s * 0.22, cy - s * 0.36, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (it.kind === "flower") {
        const cols = ["#ffe08a", "#ff9ec4", "#9fd0ff", "#ffb36b", "#e6a8ff"];
        for (let k = 0; k < 3; k++) {
          const fxp = cx + (k - 1) * s * 0.5;
          const top = cy - s * (0.4 + ((it.seed + k * 7) % 5) * 0.14);
          ctx.strokeStyle = "#2f8a55";
          ctx.lineWidth = Math.max(1, h * 0.02);
          ctx.beginPath();
          ctx.moveTo(fxp, cy + s * 0.6);
          ctx.lineTo(fxp, top);
          ctx.stroke();
          ctx.fillStyle = cols[(it.seed + k) % cols.length];
          ctx.beginPath();
          ctx.arc(fxp, top, s * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (it.kind === "pond") {
        ctx.fillStyle = "rgba(16,54,102,.92)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.16, s * 1.05, s * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(150,215,255,.45)";
        ctx.lineWidth = Math.max(1, h * 0.02);
        ctx.stroke();
        ctx.fillStyle = "#3fa864";
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.3, cy + s * 0.1, s * 0.3, s * 0.14, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(205,245,255,.5)";
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.38, cy + s * 0.05, s * 0.2, s * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (it.kind === "lamp") {
        ctx.fillStyle = "#59657e";
        ctx.fillRect(cx - h * 0.018, cy - s * 1.0, h * 0.036, s * 1.75);
        const lg = ctx.createRadialGradient(cx, cy - s * 1.05, 0, cx, cy - s * 1.05, s * 1.9);
        lg.addColorStop(0, "rgba(255,233,168," + (0.16 + atmo.night * 0.42).toFixed(3) + ")");
        lg.addColorStop(1, "rgba(255,233,168,0)");
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(cx, cy - s * 1.05, s * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath();
        ctx.ellipse(cx, cy - s * 1.05, s * 0.26, s * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawIsland(lane, yTop, yBot, xOf) {
      const y = Math.min(yTop, yBot);
      const h = Math.abs(yBot - yTop);
      const summit = !!lane.summit;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      if (summit) {
        g.addColorStop(0, "#6f5410");
        g.addColorStop(0.45, "#b58d26");
        g.addColorStop(1, "#5b430b");
      } else {
        g.addColorStop(0, "#2b7343");
        g.addColorStop(0.45, "#3d9c5c");
        g.addColorStop(1, "#1f5535");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, y, cssW, h);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, cssW, h);
      ctx.clip();

      // mown stripes, so a flat green band still reads as grass
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let x = -h; x < cssW + h; x += h * 1.3) ctx.fillRect(x, y, h * 0.62, h);

      // the milestone number, stencilled clear of the frog's column
      const numX = xOf(C.roadW - 0.7);
      const numY = y + h * 0.52;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 " + Math.round(h * 0.62) + "px 'Bebas Neue', Impact, sans-serif";
      ctx.fillStyle = summit ? "rgba(38,26,0,.34)" : "rgba(6,30,16,.32)";
      ctx.fillText(String(lane.index), numX + h * 0.03, numY + h * 0.04);
      ctx.fillStyle = summit ? "rgba(255,246,212,.66)" : "rgba(233,255,241,.44)";
      ctx.fillText(String(lane.index), numX, numY);

      if (summit) {
        // a little finish-flag pole on the far side of the road
        const px = xOf(0.8);
        ctx.fillStyle = "#e8dcc0";
        ctx.fillRect(px - h * 0.018, y + h * 0.12, h * 0.036, h * 0.7);
        const c = Math.max(2, h * 0.1);
        for (let r = 0; r < 3; r++) {
          for (let cc = 0; cc < 4; cc++) {
            ctx.fillStyle = (r + cc) % 2 ? "#101826" : "#f6f9ff";
            ctx.fillRect(px + h * 0.018 + cc * c, y + h * 0.12 + r * c, c, c);
          }
        }
      }
      for (const it of lane.decor) drawDecor(it, y, h, xOf);
      ctx.restore();

      drawKerb(y, h, summit);
    }

    function drawFrog(cx, cy, unit) {
      const dead = frog.state === "splat";
      const stretch = dead ? 0 : Math.sin(Math.PI * frog.hop);
      const sx = 1 - 0.2 * stretch;
      const sy = 1 + 0.28 * stretch;
      const r = unit * 0.3;
      ctx.save();
      ctx.translate(cx, cy);
      // shadow stays on the ground while the sprite rides the arc
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath();
      ctx.ellipse(0, unit * 0.26 * (dead ? 0.4 : 1), r * (dead ? 1.5 : 1.05), r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(0, -frog.arc * unit * HOP_LIFT);
      ctx.scale(sx, dead ? 0.42 : sy);

      const body = dead ? "#4b7a5c" : "#3ddc84";
      const dark = dead ? "#22392a" : "#1c8a51";

      // legs
      ctx.fillStyle = dark;
      const legY = r * 0.55;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.72, legY, r * 0.3, r * 0.42, s * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // body
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, dead ? "#6ea881" : "#8af0b4");
      g.addColorStop(0.5, body);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.02, r * 0.94, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(6,32,18,.7)";
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.stroke();
      // belly
      ctx.fillStyle = "rgba(232,255,240,.8)";
      ctx.beginPath();
      ctx.ellipse(0, r * 0.22, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      // eyes
      for (const s of [-1, 1]) {
        const ex = s * r * 0.42, ey = -r * 0.62;
        ctx.fillStyle = "#f4fff8";
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(6,32,18,.55)";
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.stroke();
        ctx.fillStyle = "#10201a";
        if (dead) {
          ctx.lineWidth = Math.max(1, r * 0.11);
          ctx.strokeStyle = "#10201a";
          for (const d of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(ex - r * 0.16, ey - r * 0.16);
            ctx.lineTo(ex + r * 0.16, ey + r * 0.16);
            ctx.moveTo(ex + r * 0.16, ey - r * 0.16);
            ctx.lineTo(ex - r * 0.16, ey + r * 0.16);
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(ex, ey + r * 0.03, r * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    function draw(dt = 0) {
      const w = cssW, h = cssH;
      laneH = w / C.roadW;
      const xOf = (x) => x * laneH;
      const yOf = (wy) => h * FROG_SCREEN - (wy - camY) * laneH;

      // The weather belongs to the tier the frog is about to walk into, and
      // it eases in rather than snapping, so crossing an island feels like
      // the road changing character ahead of you.
      const target = atmosphereFor(Math.max(1, Math.min(C.summit, frog.lane + 2)));
      atmo.night += (target.night - atmo.night) * Math.min(1, dt * 2.4);
      atmo.rain += (target.rain - atmo.rain) * Math.min(1, dt * 1.7);
      atmoT += dt;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // tarmac
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#1a1f2b");
      bg.addColorStop(1, "#0f131b");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const topWorld = camY + (h * FROG_SCREEN) / laneH;
      const botWorld = camY + (h * FROG_SCREEN - h) / laneH;
      const iLo = Math.max(1, Math.floor(botWorld - 0.5));
      const iHi = Math.min(C.maxLanes, Math.ceil(topWorld + 0.5));

      // lane surface + direction chevrons (islands get scenery instead)
      for (let i = iLo; i <= iHi; i++) {
        const lane = ensureLane(i);
        const y0 = yOf(i - 0.5), y1 = yOf(i + 0.5);
        if (lane.safe) { drawIsland(lane, y0, y1, xOf); continue; }
        ctx.fillStyle = i % 2 ? "rgba(255,255,255,.022)" : "rgba(0,0,0,.10)";
        ctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
        const step = lane.chevStep;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
        ctx.clip();
        for (let x = ((lane.phase % step) + step) % step - step; x < C.roadW + step; x += step) {
          drawChevron(xOf(x), (y0 + y1) / 2, lane.dir, laneH * 0.16, 1);
        }
        ctx.restore();
      }

      // lane dividers (an island brings its own kerbs)
      ctx.strokeStyle = "rgba(236,242,255,.20)";
      ctx.lineWidth = Math.max(1.4, laneH * 0.03);
      ctx.setLineDash([laneH * 0.34, laneH * 0.26]);
      for (let i = iLo; i <= iHi + 1; i++) {
        if (isSafeLane(i - 1) || isSafeLane(i)) continue;
        const y = yOf(i - 0.5);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // the verge the frog starts on
      const kerbY = yOf(0.5);
      if (kerbY < h) {
        const gg = ctx.createLinearGradient(0, kerbY, 0, h);
        gg.addColorStop(0, "#1c4a2a");
        gg.addColorStop(1, "#0d2415");
        ctx.fillStyle = gg;
        ctx.fillRect(0, kerbY, w, h - kerbY);
        ctx.fillStyle = "#8b9a86";
        ctx.fillRect(0, kerbY - Math.max(2, laneH * 0.05), w, Math.max(2, laneH * 0.05));
      }

      // the pocket the road clears under a resting frog
      if (phase === "run" && frog.state === "rest" && frog.lane >= 1 && blockT > 0) {
        const py0 = yOf(frog.lane - 0.5), py1 = yOf(frog.lane + 0.5);
        const py = Math.min(py0, py1), ph = Math.abs(py1 - py0);
        const pg = ctx.createLinearGradient(0, py, 0, py + ph);
        pg.addColorStop(0, "rgba(93,243,154,.16)");
        pg.addColorStop(0.5, "rgba(93,243,154,.05)");
        pg.addColorStop(1, "rgba(93,243,154,.16)");
        ctx.fillStyle = pg;
        ctx.fillRect(0, py, w, ph);
        ctx.strokeStyle = "rgba(93,243,154,.55)";
        ctx.lineWidth = Math.max(1.3, laneH * 0.026);
        ctx.beginPath();
        ctx.moveTo(0, py + 0.5);
        ctx.lineTo(w, py + 0.5);
        ctx.moveTo(0, py + ph - 0.5);
        ctx.lineTo(w, py + ph - 0.5);
        ctx.stroke();
      }

      // traffic
      drawnCars.length = 0;
      for (let i = iLo; i <= iHi; i++) {
        const lane = lanes[i];
        if (!lane || lane.safe) continue;
        const cy = yOf(i);
        const half = laneH * 0.36;
        for (const car of laneCars(lane, C.roadW, 1.5)) {
          const x0 = xOf(car.x), x1 = xOf(car.x + car.w);
          if (x1 < -laneH || x0 > w + laneH) continue;
          drawCar(x0, x1, cy, half * 2, car, fade);
          drawnCars.push({ x0, x1, cy, dir: car.dir });
        }
      }

      // weather: a night wash over the whole road, then every headlight
      // punched back through it
      if (atmo.night > 0.02) {
        ctx.save();
        ctx.fillStyle = "rgba(5,9,24," + (0.66 * atmo.night).toFixed(3) + ")";
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        for (const c of drawnCars) {
          const hx = c.dir > 0 ? c.x1 : c.x0;
          const gl = ctx.createRadialGradient(hx, c.cy, 0, hx, c.cy, laneH * 1.15);
          gl.addColorStop(0, "rgba(255,242,190," + (0.4 * atmo.night).toFixed(3) + ")");
          gl.addColorStop(1, "rgba(255,242,190,0)");
          ctx.fillStyle = gl;
          ctx.beginPath();
          ctx.arc(hx, c.cy, laneH * 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // the frog's column: sight line + destination window
      const fx = xOf(C.frogX);
      const colW = Math.max(6, C.frogHalfW * 2 * laneH);
      if (phase === "run" && frog.state !== "splat" && depth < C.summit) {
        const next = ensureLane(frog.lane + 1);
        const open = clearFor(next, C.frogX, C.frogHalfW, C.hopSec);
        const flag = open ? "1" : "0";
        if (canvas.dataset.laneOpen !== flag) canvas.dataset.laneOpen = flag;
        const ny0 = yOf(frog.lane + 0.5), ny1 = yOf(frog.lane + 1.5);
        const pulse = 0.5 + 0.5 * Math.sin(attractT * 7);
        ctx.fillStyle = open
          ? "rgba(93,243,154," + (0.10 + 0.10 * pulse) + ")"
          : "rgba(255,90,77," + (0.13 + 0.10 * pulse) + ")";
        ctx.fillRect(fx - colW, Math.min(ny0, ny1), colW * 2, Math.abs(ny1 - ny0));
        ctx.strokeStyle = open ? "rgba(93,243,154,.75)" : "rgba(255,90,77,.8)";
        ctx.lineWidth = Math.max(1.4, laneH * 0.028);
        ctx.strokeRect(fx - colW, Math.min(ny0, ny1), colW * 2, Math.abs(ny1 - ny0));
      } else if (canvas.dataset.laneOpen !== "0") {
        canvas.dataset.laneOpen = "0";
      }
      // faint sight line up the column
      const lg = ctx.createLinearGradient(0, yOf(frog.lane + 0.5), 0, yOf(frog.lane + 3.0));
      lg.addColorStop(0, "rgba(190,230,255,.16)");
      lg.addColorStop(1, "rgba(190,230,255,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(fx - colW * 0.35, yOf(frog.lane + 3.4), colW * 0.7, Math.abs(yOf(frog.lane + 3.4) - yOf(frog.lane + 0.5)));

      // frog
      const groundY = yOf(frog.y);
      if (phase === "ready" || phase === "idle" || phase === "run" || phase === "done") {
        drawFrog(fx, groundY, laneH);
      }
      if (frog.state === "splat") {
        ctx.save();
        ctx.strokeStyle = "rgba(180,30,40,.85)";
        ctx.lineWidth = Math.max(1.5, laneH * 0.03);
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(fx + Math.cos(a) * laneH * 0.3, groundY + Math.sin(a) * laneH * 0.18);
          ctx.lineTo(fx + Math.cos(a) * laneH * 0.62, groundY + Math.sin(a) * laneH * 0.36);
          ctx.stroke();
        }
        ctx.restore();
      }

      // danger ring. Resting = a closed green ring ("nothing can reach you
      // here"); hopping = a countdown ring fed by whichever lane can still
      // hit the frog while it's over the paint.
      if (phase === "run" && frog.state === "rest") {
        // standing on an island is untouchable, so the ring closes completely
        const island = isSafeLane(frog.lane);
        const pocket = !island && blockT > 0;
        const t = pocket
          ? blockT
          : timeUntilHit(lanes[frog.lane], C.frogX, C.frogHalfW);
        const selfCw = lanes[frog.lane] && lanes[frog.lane].cw;
        const ref = pocket
          ? Math.max(0.001, blockSecFor(Math.max(1, frog.lane)))
          : Math.max(C.cwFloor, Number.isFinite(selfCw) ? selfCw : C.cwFloor);
        const safe = island || pocket || frog.lane === 0;
        const f = safe ? 1 : clamp(t / ref, 0, 1);
        ctx.save();
        ctx.lineWidth = Math.max(2.5, laneH * 0.07);
        ctx.lineCap = "round";
        ctx.strokeStyle = safe
          ? "rgba(93,243,180,.8)"
          : t < 0.3 ? "rgba(255,74,60,.95)" : "rgba(255,193,78,.9)";
        ctx.beginPath();
        ctx.arc(fx, groundY, laneH * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
        ctx.stroke();
        ctx.restore();
      } else if (phase === "run" && frog.state === "hop") {
        const nxt = ensureLane(frog.lane + 1);
        const t = timeUntilHit(nxt, C.frogX, C.frogHalfW);
        const ref = Math.max(C.cwFloor, Number.isFinite(nxt && nxt.cw) ? nxt.cw : C.cwFloor);
        const f = Number.isFinite(t) ? clamp(t / ref, 0, 1) : 1;
        ctx.save();
        ctx.lineWidth = Math.max(2.5, laneH * 0.07);
        ctx.lineCap = "round";
        ctx.strokeStyle = t < 0.08 ? "rgba(255,74,60,.95)" : t < 0.3 ? "rgba(255,193,78,.9)" : "rgba(120,230,180,.75)";
        ctx.beginPath();
        ctx.arc(fx, groundY, laneH * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
        ctx.stroke();
        ctx.restore();
      }

      // rain, in front of everything in the world but behind the HUD text
      if (atmo.rain > 0.02) {
        ctx.save();
        ctx.strokeStyle = "rgba(186,214,255," + (0.3 * atmo.rain).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1, laneH * 0.022);
        ctx.lineCap = "round";
        const n = Math.round(64 * atmo.rain);
        const span = w + h;
        for (let k = 0; k < n; k++) {
          const sx = ((k * 97.13 + atmoT * laneH * 3.4) % span) - h;
          const sy = ((k * 173.7 + atmoT * laneH * 13) % (h + 40)) - 20;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - laneH * 0.2, sy + laneH * 0.46);
          ctx.stroke();
        }
        ctx.restore();
      }

      // floaters
      for (const f of floaters) {
        const p = f.t / f.life;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p * p);
        ctx.font = "700 " + Math.round(laneH * 0.42) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = f.cls === "bad" ? "#ff8f99" : "#7dffb4";
        ctx.shadowColor = "rgba(0,0,0,.85)";
        ctx.shadowBlur = 8;
        ctx.fillText(f.text, fx, yOf(f.y) - p * laneH * 0.9);
        ctx.restore();
      }

      // banners
      if (banner) {
        const p = banner.t / banner.life;
        ctx.save();
        ctx.globalAlpha = clamp((1 - p) * 2.2, 0, 1);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 " + Math.round(laneH * 0.85) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.fillStyle = banner.cls === "bad" ? "#ff6a72" : "#ffe08a";
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 14;
        ctx.fillText(banner.text, w / 2, h * 0.4);
        ctx.restore();
      }

      if (phase === "ready") {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const blink = 0.55 + 0.45 * Math.sin(attractT * 6);
        ctx.globalAlpha = blink;
        ctx.font = "700 " + Math.round(laneH * 0.72) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.fillStyle = "#ffe08a";
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 14;
        ctx.fillText("GET READY", w / 2, h * 0.4);
        ctx.globalAlpha = 0.85;
        ctx.font = "600 " + Math.round(laneH * 0.34) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.fillStyle = "#cdd8ee";
        ctx.fillText("the road clears in " + Math.max(0, readyT).toFixed(1) + "s", w / 2, h * 0.4 + laneH * 0.72);
        ctx.restore();
      }

      if (phase === "idle") {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const blink = 0.5 + 0.5 * Math.sin(attractT * 4);
        ctx.globalAlpha = blink;
        ctx.font = "700 " + Math.round(laneH * 0.62) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.fillStyle = "#ffe08a";
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 14;
        ctx.fillText("CROSS THE ROAD TO PLAY", w / 2, h * 0.36);
        ctx.restore();
      }

      // hit vignette
      if (shake > 0) {
        ctx.save();
        ctx.globalAlpha = clamp(shake / 0.45, 0, 1) * 0.5;
        const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
        vg.addColorStop(0, "rgba(255,0,0,0)");
        vg.addColorStop(1, "rgba(255,0,0,.95)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    /* ---------- loop ---------- */
    function paused() {
      if (!document.body.contains(canvas)) return true;
      const layer = document.getElementById("modalLayer");
      if (layer && !layer.hidden) return true;
      return false;
    }

    function loop(t) {
      if (destroyed) return;
      const dt = clamp((t - lastT) / 1000 || 0, 0, 0.05);
      lastT = t;
      if ((sizeTick++ % 10) === 0) resize();
      if (!paused()) {
        if (phase === "idle") {
          attractT += dt;
          for (let i = 1; i <= C.maxLanes; i++) stepLane(lanes[i], dt);
          updateFx(dt);
        } else if (phase === "ready") {
          attractT += dt;
          readyT -= dt;
          if (readyT <= 0) startRun();
        } else if (phase === "run") {
          if (fade < 1) fade = Math.min(1, fade + dt / FADE_SEC);
          update(dt);
          refreshDanger();
        } else if (phase === "done") {
          updateFx(dt);
          if (doneT > 0) doneT -= dt;
        }
      }
      draw(dt);
      if (phase === "done" && doneT <= 0) { rafId = 0; return; }
      rafId = requestAnimationFrame(loop);
    }

    /* ---------- sizing ---------- */
    let lastW = 0, lastH = 0;
    function resize() {
      const box = canvas.parentElement;
      const cw = Math.max(220, Math.min((box.clientWidth || 420) - 18, 560));
      const ch = Math.round(cw * (VIEW_LANES / C.roadW));
      if (cw === lastW && ch === lastH) return;
      lastW = cw; lastH = ch;
      cssW = cw; cssH = ch;
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      laneH = cw / C.roadW;
      draw();
    }
    let roRaf = 0;
    function scheduleResize() {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => { roRaf = 0; if (!destroyed) resize(); });
    }
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(scheduleResize);
      ro.observe(canvas.parentElement);
    }
    window.addEventListener("resize", scheduleResize);

    /* ---------- input ---------- */
    function onKey(e) {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key;
      const isCross = k === "ArrowUp" || k === "w" || k === "W" || k === " ";
      const isBank = k === "ArrowDown" || k === "s" || k === "S" || k === "Enter";
      if (!isCross && !isBank) return;
      if (phase !== "run" && phase !== "ready") return;
      e.preventDefault();
      if (e.repeat) return;
      if (isCross) cross(); else bank();
    }
    window.addEventListener("keydown", onKey);

    function tap(fn) {
      return (e) => { e.preventDefault(); fn(); };
    }
    crossBtn.addEventListener("pointerdown", tap(() => { cross(); }));
    bankBtn.addEventListener("pointerdown", tap(() => { bank(); }));
    canvas.addEventListener("pointerdown", tap(() => { if (phase === "run" || phase === "ready") cross(); }));

    /* ---------- lifecycle ---------- */
    async function play(stake, opts) {
      if (opts && opts.instant) return { multiplier: 1 };
      destroyed = false;
      outcome = null;
      floaters = [];
      banner = null;
      shake = 0;
      buildWorld((Math.random() * 0xffffffff) >>> 0);
      resetFrog();
      fade = 0;
      phase = "ready";
      readyT = READY_SEC;
      statusEl.className = "frogger-status";
      statusEl.textContent = "GET READY \u2014 STAY OFF THE ROAD";
      crossBtn.disabled = false;
      bankBtn.disabled = true;
      refreshHud();
      refreshDanger();
      lastT = performance.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
      const result = await new Promise((resolve) => { resolveRun = resolve; });
      return { multiplier: result ? result.multiplier : 0 };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (roRaf) { cancelAnimationFrame(roRaf); roRaf = 0; }
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", scheduleResize);
      if (ro) ro.disconnect();
      phase = "done";
      crossBtn.disabled = true;
      bankBtn.disabled = true;
      const r = resolveRun;
      resolveRun = null;
      if (r) r({ multiplier: 1, cancelled: true });
    }

    function openInfoCard() {
      // one row per island: the ladder only needs the ten milestones, since the
      // rungs between them are a straight line
      const maxM = multFor(C.summit);
      const ladder = el("div", { class: "ic-ladder" },
        ...TIERS.map((T, k) => {
          const at = (k + 1) * C.islandEvery;
          const m = multFor(at);
          const summit = at >= C.summit;
          return el("div", { class: "rung" + (summit ? " top" : "") },
            el("span", { text: "LANE " + at }),
            el("span", { class: "bar", style: { width: Math.max(3, (m / maxM) * 100) + "%", background: "linear-gradient(90deg," + T.accent + ",rgba(255,120,90,.85))" } }),
            el("span", { class: "v", text: "\u00D7" + m.toFixed(2) })
          );
        })
      );

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-hint", text: "PAYOUT LADDER \u2014 ONE RUNG PER ISLAND, +0.05\u2192+0.14 A LANE" }),
        el("div", { class: "ic-scroll", style: { width: "100%", display: "flex", justifyContent: "center" } }, ladder),
        el("div", { class: "ic-hint", text: "BANK WHENEVER YOU LIKE \u2014 ANY LANE, ANY TIME" })
      );

      const tiers = el("div", { class: "ic-tiers" },
        ...TIERS.map((T, k) => {
          const from = k * C.islandEvery + 1;
          const to = (k + 1) * C.islandEvery - 1;
          const at = (k + 1) * C.islandEvery;
          return el("div", { class: "ic-tier", style: { "--tc": T.accent } },
            el("span", { class: "tn", text: String(T.n).padStart(2, "0") }),
            el("span", { class: "nm" },
              el("b", { text: T.name }),
              el("span", { text: "lanes " + from + "\u2013" + to + " \u00B7 " + T.speed[0].toFixed(2) + "\u2192" + T.speed[1].toFixed(2) + "/s" })
            ),
            el("span", { class: "wn" },
              el("b", { text: T.cw[0].toFixed(2) + "\u2192" + T.cw[1].toFixed(2) + "s" }),
              el("span", { text: "window" })
            ),
            el("span", { class: "ms" },
              el("b", { text: "\u00D7" + multFor(at).toFixed(2) }),
              el("span", { text: at >= C.summit ? "summit" : "island " + at })
            )
          );
        })
      );

      const kvRow = (k, v) => el("div", { class: "row" }, el("span", { text: k }), el("span", { class: "v", text: v }));
      const kv = el("div", { class: "ic-kv" },
        kvRow("Start on the verge", "\u00D7" + C.startMult.toFixed(2)),
        kvRow("First block, per lane", "+" + perHopFor(1).toFixed(2)),
        kvRow("Last block, per lane", "+" + perHopFor(C.summit).toFixed(2)),
        kvRow("Lane 1 safe pocket", blockSecFor(1).toFixed(2) + "s"),
        kvRow("Lane 50 safe pocket", blockSecFor(50).toFixed(2) + "s"),
        kvRow("Summit safe pocket", blockSecFor(C.summit).toFixed(2) + "s")
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How you play",
            ul([
              "You begin safe on the verge, exactly even at <b>\u00D7" + C.startMult.toFixed(2) + "</b> \u2014 banking there just returns your stake.",
              "<b>CROSS</b> hops one lane out. Every lane crossed pays a little more than the last.",
              "<b>BANK</b> takes the money and ends the run. It is always safe, and you can take it on any lane.",
            ])
          ),
          sec("The road",
            ul([
              "The road is <b>" + C.summit + " lanes</b>, in ten blocks of ten.",
              "Every tenth lane \u2014 <b>10, 20, 30 \u2026 90</b> \u2014 is a <b>SAFE ISLAND</b>: grass, scenery, no traffic, and nothing can ever touch you there. Rest as long as you like.",
              "<b>Lane 100 is the SUMMIT</b>: cross into it and the run ends on its own for <b>\u00D7" + multFor(C.summit).toFixed(2) + "</b>.",
            ])
          ),
          sec("Escalation",
            ul([
              "The nine lanes between islands are a <b>tier</b>, and each tier starts harder than the one before it ended \u2014 crossing an island is stepping up.",
              "Traffic gets <b>faster</b> (" + TIERS[0].speed[0].toFixed(2) + "/s at the start, " + TIERS[9].speed[1].toFixed(2) + "/s on the final stretch), convoys get <b>longer and bigger</b> (big rigs in the last blocks), and the guaranteed clear window <b>shrinks</b> from " + TIERS[0].cw[0].toFixed(2) + "s to " + TIERS[9].cw[1].toFixed(2) + "s.",
              "<b>THE INTERCHANGE</b> (lanes 71\u201379) is the chaos tier \u2014 neighbouring lanes run at wildly different speeds.",
              "From <b>NIGHT CROSSING</b> onward the road descends into darkness, then rain, then a storm: you cross the final tiers by headlight.",
            ])
          ),
          sec("Payout",
            ul([
              "Each block widens the rungs by <b>+" + C.perHopStep.toFixed(2) + "</b>: <b>+" + perHopFor(1).toFixed(2) + "</b> a lane in the first block, <b>+" + perHopFor(C.summit).toFixed(2) + "</b> a lane in the last \u2014 a straight line inside a tier, steeper every tier.",
              "<b>\u00D7" + multFor(10).toFixed(2) + "</b> at island 10, <b>\u00D7" + multFor(50).toFixed(2) + "</b> at 50, and <b>\u00D7" + multFor(C.summit).toFixed(2) + "</b> on the summit.",
            ])
          ),
          sec("Safe pockets",
            ul([
              "Land in a gap and the road <b>blocks that lane behind you</b> \u2014 traffic holds still for a moment.",
              "That pocket is <b>" + blockSecFor(1).toFixed(2) + "s</b> on the first lane and only <b>" + blockSecFor(C.summit).toFixed(2) + "s</b> near the summit, so standing still never stays free.",
              "Islands are exempt \u2014 the pocket there never lapses.",
              "Nothing is decided by a dice roll: every car is on screen, and the column ahead is lit green/red by whether it is open long enough.",
            ])
          ),
          sec("Getting flattened",
            ul([
              "If a car reaches your column while you are hopping, the frog is flattened and the <b>whole stake is lost</b>.",
              "Banking is the only guaranteed exit \u2014 the deeper you go, the more you are risking.",
            ])
          )
        )
      );

      openInfo("Frogger Gamble \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("The ten tiers", tiers,
          note("Islands are the rest stops: nothing reaches you, so they are the natural place to decide whether to push on or bank.")),
        sec("Your payout", kv,
          note("Your <b>banked multiplier</b> is paid on your stake \u2014 a \u00D710 bank on a $10 bet returns $100. The HUD keeps your best bank so far."))
      ));
    }

    // attract screen: build a world and let the traffic run behind the glass
    buildWorld((Math.random() * 0xffffffff) >>> 0);
    resetFrog();
    fade = 1;
    refreshHud();
    resize();
    refreshDanger();
    lastT = performance.now();
    if (!rafId) rafId = requestAnimationFrame(loop);

    app.onBetChange = () => { refreshHud(); };

    return { root, play, actionLabel: "CROSS THE ROAD", destroy };
  },
};
