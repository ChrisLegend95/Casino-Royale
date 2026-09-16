import { el, clear, sleep, toast } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, sec, ul, note, cap } from "./infocard.js";
import { CONFIG } from "../state.js";
import { sfx } from "../audio.js";

// Rocket Crash's climb is a curve, not a straight ramp. In log-multiplier space
//     ln(mult) = crashStart * t + crashAccel * t^2      (t = seconds in flight)
// so the climb rate starts at `crashStart` per second and picks up 2*crashAccel every
// second: the rocket eases off the pad and then gets faster and faster. `t` is the same
// quantity that feeds the chart's x-axis, so the drawn line is the real curve. With
// crashAccel = 0 this collapses to the old flat exponential (ln m = crashStart * t).
// These numbers only set HOW LONG each multiplier takes to arrive -- the crash point is
// drawn independently (P(crash >= m) = 0.97/m), so any tuning keeps the same 3% edge.
const GROW0 = Math.max(0.001, CONFIG.crashStart);
const GROW2 = Math.max(0, CONFIG.crashAccel);
const EDGE = 0.03;
const SCREEN_T = 3.2; // effective seconds of flight visible across the chart width

function mOf(t) {
  const tt = Math.max(0, t);
  return Math.exp(GROW0 * tt + GROW2 * tt * tt);
}
// inverse of mOf: the seconds of flight at which the rocket reaches a multiplier
function tOf(m) {
  const l = Math.log(Math.max(1, m));
  if (GROW2 <= 0) return l / GROW0;
  return (Math.sqrt(GROW0 * GROW0 + 4 * GROW2 * l) - GROW0) / (2 * GROW2);
}

function axisTopFor(maxM) {
  const m = Math.min(1e18, Math.max(1.06, maxM));
  return Math.max(10, Math.pow(10, Math.ceil(Math.log10(m * 1.05))));
}
const AXIS_SUFFIX = [[1e18, "Ex"], [1e15, "Px"], [1e12, "Tx"], [1e9, "Bx"], [1e6, "Mx"], [1e3, "kx"]];
function fmtAxis(v) {
  if (!Number.isFinite(v)) return "\u221Ex";
  for (const [n, s] of AXIS_SUFFIX) {
    if (v >= n) {
      const q = v / n;
      return (q >= 100 ? q.toFixed(0) : q >= 10 ? q.toFixed(1) : q.toFixed(2)) + s;
    }
  }
  return v.toFixed(2) + "x";
}
function fmtMult(v) {
  if (!Number.isFinite(v)) return "\u221Ex";
  return v >= 1e4 ? fmtAxis(v) : v.toFixed(2) + "x";
}
export default {
  id: "crash",
  name: "Rocket Crash",
  icon: "\u{1F680}",
  action: "LAUNCH",
  blurb: "The multiplier climbs \u2014 easing off the pad, then faster and faster. Cash out before the rocket blows up.",
  payoutNote: () =>
    'Cash out before the crash and you get <b>bet \u00D7 multiplier</b>. Base return <span class="k">97%</span>. ' +
    "The rocket eases off the pad and accelerates \u2014 the longer it flies the faster the multiplier compounds. " +
    "Flip <b>AUTO</b> on to bank at a target hands-free, or leave it off and hit <b>CASH OUT</b> yourself. Bank and the rocket still flies on \u2014 it re-rolls its own death, uncapped, so you watch where it <i>would</i> have blown. Lucky Coin perks push the rocket higher.",
  minBet: 1,
  canIdle: false,

  create(app) {
    const canvas = el("canvas", { id: "crashCanvas" });
    const multEl = el("div", { class: "crash-mult", text: "1.00x" });
    const box = el("div", { class: "crash-box" }, canvas, multEl);
    const historyEl = el("div", { class: "crash-history" }, el("span", { class: "panel-head", text: "HISTORY" }));

    const targetInput = el("input", { type: "number", min: "1.01", step: "0.01", value: "2.00" });
    const autoBtn = el("button", { class: "autotoggle on", type: "button", text: "AUTO: ON", onclick: () => setAuto(!autoCash) });
    const cashBtn = el("button", { class: "cashbtn", type: "button", text: "CASH OUT", disabled: true, onclick: () => cashOut() });
    const msgEl = el("div", { class: "bj-msg", text: "Set your target, then LAUNCH." });

    const root = stageShell(
      "Rocket Crash",
      "The multiplier eases off the pad, then climbs faster and faster. Get out before the kaboom.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "crash-wrap" },
        msgEl,
        box,
        el("div", { class: "crash-bar" },
          el("div", { class: "crash-field" },
            el("div", { class: "label" }, "Cash out"),
            el("div", { class: "crash-mode" }, autoBtn, targetInput)
          ),
          cashBtn,
          historyEl
        ),
      )
    );

    const history = [];
    let raf = null;
    let blastRaf = null;
    let roundResolve = null;
    let live = false;
    let curMult = 1;
    let crashPoint = 2;
    let trail = [];
    let stars = [];
    let autoCash = true;
    let startT = 0;      // real ms timestamp of the current launch
    let spectate = false; // rocket keeps flying after a cash-out
    let banked = 0;       // multiplier the player banked (0 = none this round)
    let warp = 1;         // time-compression factor for the post-cash tail
    let sBase = 0;        // effective clock at the moment of cash-out
    let rBase = 0;        // real clock at the moment of cash-out
    let ghostCrash = 0;   // where the rocket dies AFTER a cash-out (fresh roll)
    let blastP = 1;       // explosion shockwave progress (1 = finished/none)
    let endCrashed = false; // last finished round ended in a crash (for redraws)

    /* ---------- canvas ---------- */
    function initCanvas() {
      const wCss = Math.max(240, box.clientWidth);
      const hCss = 300;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(wCss * dpr)) {
        canvas.width = Math.round(wCss * dpr);
        canvas.height = Math.round(hCss * dpr);
      }
      canvas.style.width = wCss + "px";
      canvas.style.height = hCss + "px";
      if (stars.length === 0) {
        for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 1.5, v: 0.1 + Math.random() * 0.4 });
      }
      return { ctx: canvas.getContext("2d"), w: wCss, h: hCss };
    }

    function draw(crashed, cashed, starT) {
      const { ctx, w, h } = initCanvas();
      ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, crashed ? "#2a0d14" : "#131c31");
      g.addColorStop(1, "#070b13");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // stars
      for (const s of stars) {
        let sx = (s.x * w - starT * s.v * 260) % w;
        if (sx < 0) sx += w;
        ctx.globalAlpha = 0.25 + (s.s / 2) * 0.5;
        ctx.fillStyle = "#9fb6e6";
        ctx.fillRect(sx, s.y * h, s.s, s.s);
      }
      ctx.globalAlpha = 1;

      // explosion flash
      if (blastP < 0.55) {
        ctx.fillStyle = "rgba(255,152,80," + (0.26 * (1 - blastP / 0.55)).toFixed(3) + ")";
        ctx.fillRect(0, 0, w, h);
      }

      const pad = 34;
      const plotW = w - pad - 16;
      const plotH = h - pad - 18;
      const x0 = 16, y0 = h - 18;

      // grid
      ctx.strokeStyle = "rgba(140,160,200,.10)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        const y = y0 - (plotH * i) / 5;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y); ctx.stroke();
      }
      // Fixed-scale, scrollable chart. The y-axis tops out at the next power of ten
      // above the highest multiplier reached so far (never the hidden crash point), and
      // the x-axis shows a constant window of flight time that scrolls once the rocket
      // passes it. The rocket therefore explodes wherever it happens to be -- position
      // on the chart leaks nothing about when/where the crash will land.
      let maxM = 1;
      for (const p of trail) if (p.m > maxM) maxM = p.m;
      if (banked > maxM) maxM = banked;
      const topMult = axisTopFor(maxM);
      const lg = Math.log(topMult);
      const lastT = trail.length ? trail[trail.length - 1].t : 0;
      const viewT = Math.max(0, lastT - SCREEN_T);
      const px = (t) => x0 + clamp((t - viewT) / SCREEN_T, 0, 1) * plotW;
      const py = (m) => y0 - (Math.log(Math.max(1, m)) / lg) * plotH;
      let s0 = 0;
      while (s0 < trail.length - 1 && trail[s0].t < viewT) s0++;
      if (s0 > 0) s0--;
      const vis = trail.slice(s0);

      const strokePts = (pts, color, width, dash, glow) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(px(pts[0].t), py(pts[0].m));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].t), py(pts[i].m));
        ctx.setLineDash(dash || []);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = glow ? color : "transparent";
        ctx.shadowBlur = glow ? 16 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
      };
      const fillPts = (pts, fill) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(px(pts[0].t), py(pts[0].m));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].t), py(pts[i].m));
        ctx.lineTo(px(pts[pts.length - 1].t), y0);
        ctx.lineTo(px(pts[0].t), y0);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };

      // target guide line (only while a fresh round is in flight and auto is on)
      if (live && autoCash && banked === 0) {
        const ty = py(target());
        if (ty > 12 && ty < y0 - 4) {
          ctx.setLineDash([3, 6]);
          ctx.strokeStyle = "rgba(120,180,255,.45)";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(x0 + plotW, ty); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(150,200,255,.9)";
          ctx.font = "700 9.5px Inter, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText("TARGET " + target().toFixed(2) + "x", x0 + plotW - 3, ty - 4);
        }
      }

      if (vis.length > 1) {
        if (banked > 0 && !cashed) {
          // split view: the part the player banked, then where it would have gone
          let k = -1;
          for (let i = 0; i < vis.length; i++) if (vis[i].m >= banked) { k = i; break; }
          const got = k < 0 ? vis : k === 0 ? [] : vis.slice(0, k + 1);
          const rest = k < 0 ? [] : vis.slice(k);
          if (got.length > 1) {
            fillPts(got, "rgba(92,243,154,.13)");
            strokePts(got, "#5cf39a", 3, null, true);
          }
          if (rest.length > 1) {
            fillPts(rest, crashed ? "rgba(255,95,109,.12)" : "rgba(242,193,78,.10)");
            strokePts(rest, crashed ? "#ff5f6d" : "#f2c14e", crashed ? 3 : 2, crashed ? null : [7, 7], true);
          }
          // banked guide line
          const by = py(banked);
          if (by > 16 && by < y0 - 4) {
            ctx.setLineDash([2, 5]);
            ctx.strokeStyle = "rgba(92,243,154,.5)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x0 + plotW, by); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(92,243,154,.9)";
            ctx.font = "700 9.5px Inter, sans-serif";
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText("BANKED " + banked.toFixed(2) + "x", x0 + plotW - 3, by - 4);
          }
        } else {
          const col = crashed ? "#ff5f6d" : cashed ? "#5cf39a" : "#f2c14e";
          fillPts(vis, crashed ? "rgba(255,95,109,.14)" : cashed ? "rgba(92,243,154,.14)" : "rgba(242,193,78,.12)");
          strokePts(vis, col, 3, null, crashed || cashed);
        }
      }

      // rocket head
      const last = trail[trail.length - 1];
      if (last) {
        const rx = px(last.t), ry = py(last.m);
        if (crashed) {
          ctx.font = "32px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("\u{1F4A5}", rx, ry);
        } else {
          ctx.font = "30px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.translate(rx, ry);
          ctx.rotate(-0.5);
          ctx.fillText("\u{1F680}", 0, 0);
          ctx.restore();
        }

        // explosion shockwave
        if (blastP < 1) {
          const e = blastP;
          const maxR = Math.min(140, plotW * 0.55);
          const r = 8 + e * maxR;
          ctx.strokeStyle = "rgba(255,186,110," + (0.9 * (1 - e)).toFixed(3) + ")";
          ctx.lineWidth = 1 + 4 * (1 - e);
          ctx.beginPath(); ctx.arc(rx, ry, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255," + (0.5 * (1 - e) * (1 - e)).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(rx, ry, r * 0.58, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = "rgba(255,226,172," + Math.max(0, 0.5 * (1 - e * 1.7)).toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(rx, ry, Math.max(0.5, 34 * (1 - e * 1.4)), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.fillStyle = "#8b98b4";
      ctx.font = "600 10px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("1.00x", x0 + 2, y0 - 2);
      ctx.fillText(fmtAxis(topMult), x0 + 2, 14);
    }

    function renderHistory() {
      const label = historyEl.firstChild;
      clear(historyEl);
      historyEl.appendChild(label);
      for (const h of history) {
        const cls = h >= 3 ? "high" : h >= 1.5 ? "mid" : "low";
        historyEl.appendChild(el("span", { class: "chipx " + cls, text: fmtMult(h) }));
      }
    }

    function makeCrashPoint(luck) {
      const u = Math.random();
      let p = (1 - EDGE) / Math.max(1e-6, 1 - u);
      p = Math.floor(p * 100) / 100;
      let cp = Math.max(1, p);
      cp *= 1 + luck * 0.25;
      return Math.max(1, Math.floor(cp * 100) / 100);
    }

    // Where the rocket dies after you've banked. The rocket is already past `m`,
    // and the odds are memoryless, so the residual is simply m / (1 - u): the same
    // 0.97/m survival curve re-based to your cash-out. It is a fresh, independent
    // roll every time and has no upper bound -- it can blow a cent past your
    // cash-out, or run for billions, and nobody can know which until it does.
    function ghostFrom(m, luck) {
      const u = Math.random();
      let g = m / Math.max(1e-9, 1 - u);
      g *= 1 + luck * 0.25;
      g = Math.floor(g * 100) / 100;
      return Math.max(m + 0.01, g);
    }

    function stopLoop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      live = false;
      cashBtn.disabled = true;
    }

    function bankHistory(v) {
      history.unshift(v);
      while (history.length > 10) history.pop();
      renderHistory();
    }

    function blastAnim() {
      if (blastRaf) cancelAnimationFrame(blastRaf);
      const t0 = performance.now();
      const DUR = 780;
      blastP = 0;
      const frame = () => {
        const p = Math.min(1, (performance.now() - t0) / DUR);
        blastP = p;
        draw(true, false, 0);
        if (p < 1) blastRaf = requestAnimationFrame(frame);
        else blastRaf = null;
      };
      frame();
    }

    function crashVisual(alreadyBanked) {
      stopLoop();
      const shown = alreadyBanked ? ghostCrash : crashPoint;
      curMult = shown;
      endCrashed = true;
      multEl.className = "crash-mult crashed";
      multEl.textContent = fmtMult(shown);
      msgEl.className = "bj-msg " + (alreadyBanked ? "win" : "lose");
      msgEl.textContent = alreadyBanked
        ? "Blew up at " + fmtMult(shown) + " \u2014 you banked " + fmtMult(banked) + " in time."
        : "Crashed at " + fmtMult(shown) + " \u2014 you were too slow.";
      sfx.boom();
      blastAnim();
    }

    function finish(won, mult, reason) {
      if (!roundResolve) return;
      const resolve = roundResolve;
      roundResolve = null;
      cashBtn.disabled = true;

      if (reason === "crash") {
        bankHistory(crashPoint);
        crashVisual(false);
        resolve({ multiplier: 0, crashPoint });
        return;
      }

      // cash-out: bank the win, then keep the rocket flying so you can watch
      // where it would have blown -- a fresh, unbounded, memoryless re-roll.
      banked = mult;
      multEl.className = "crash-mult cashed";
      multEl.textContent = fmtMult(mult);
      ghostCrash = app.cheat ? Infinity : ghostFrom(mult, app.effects().luck);
      bankHistory(Number.isFinite(ghostCrash) ? ghostCrash : mult);

      const tEffBank = tOf(mult);
      spectate = true;
      sBase = tEffBank;
      rBase = (performance.now() - startT) / 1000;
      if (Number.isFinite(ghostCrash)) {
        const remain = Math.max(0, tOf(ghostCrash) - tEffBank);
        const tailFor = Math.min(3, Math.max(0.6, remain));
        warp = remain / tailFor;
      } else {
        warp = 1;
      }
      msgEl.className = "bj-msg win";
      msgEl.textContent = Number.isFinite(ghostCrash)
        ? "Banked " + fmtMult(mult) + " \u2014 keep watching where it would've blown\u2026"
        : "Banked " + fmtMult(mult) + " \u2014 cheat is on, so it never blows up.";
      draw(false, false, 0);
      resolve({ multiplier: won ? mult : 0, crashPoint });
    }

    function cashOut() {
      if (!live || !roundResolve) return;
      finish(true, curMult, "cash");
    }

    function target() {
      const v = Number(targetInput.value);
      return Number.isFinite(v) && v >= 1.01 ? v : 2;
    }

    function setAuto(on) {
      autoCash = !!on;
      autoBtn.textContent = "AUTO: " + (autoCash ? "ON" : "OFF");
      autoBtn.classList.toggle("on", autoCash);
      targetInput.disabled = !autoCash;
      if (!live) {
        msgEl.className = "bj-msg";
        msgEl.textContent = autoCash
          ? "Auto cash-out at " + target().toFixed(2) + "x \u2014 or hit CASH OUT. LAUNCH when ready."
          : "Manual mode \u2014 hit CASH OUT before the rocket blows. LAUNCH when ready.";
      }
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const luck = app.effects().luck;
      stopLoop();
      if (blastRaf) { cancelAnimationFrame(blastRaf); blastRaf = null; }
      blastP = 1;
      spectate = false;
      banked = 0;
      ghostCrash = 0;
      warp = 1;
      crashPoint = app.cheat ? Infinity : makeCrashPoint(luck);
      const tgt = target();

      if (instant) {
        endCrashed = crashPoint < tgt;
        // resolve off-screen: win only if the rocket reaches the target
        if (crashPoint >= tgt) {
          multEl.className = "crash-mult cashed";
          multEl.textContent = tgt.toFixed(2) + "x";
          msgEl.className = "bj-msg win";
          msgEl.textContent = "Auto cashed at " + tgt.toFixed(2) + "x";
          history.unshift(Number.isFinite(crashPoint) ? crashPoint : tgt); while (history.length > 10) history.pop(); renderHistory();
          curMult = 1; trail = [{ t: 0, m: 1 }, { t: tOf(tgt), m: tgt }];
          draw(false, true, 0);
          return { multiplier: tgt, crashPoint };
        }
        multEl.className = "crash-mult crashed";
        multEl.textContent = crashPoint.toFixed(2) + "x";
        msgEl.className = "bj-msg lose";
        msgEl.textContent = "Crashed at " + crashPoint.toFixed(2) + "x";
        history.unshift(crashPoint); while (history.length > 10) history.pop(); renderHistory();
        trail = [{ t: 0, m: 1 }, { t: tOf(crashPoint), m: crashPoint }];
        draw(true, false, 0);
        return { multiplier: 0, crashPoint };
      }

      multEl.className = "crash-mult";
      multEl.textContent = "1.00x";
      msgEl.className = "bj-msg";
      msgEl.textContent = autoCash
        ? "Auto cash-out at " + tgt.toFixed(2) + "x \u2014 or hit CASH OUT."
        : "Manual mode \u2014 hit CASH OUT before the rocket blows!";
      curMult = 1;
      trail = [{ t: 0, m: 1 }];
      endCrashed = false;
      live = true;
      cashBtn.disabled = false;

      return new Promise((resolve) => {
        roundResolve = resolve;
        startT = performance.now();
        const step = () => {
          const tReal = (performance.now() - startT) / 1000;
          // cheat mode never blows up -- let it climb for a beat, then park it
          if (spectate && !Number.isFinite(ghostCrash) && tReal - rBase > 6) {
            stopLoop();
            msgEl.textContent = "Banked " + fmtMult(banked) + " \u2014 cheat is on, so it never blows up.";
            draw(false, true, 0);
            return;
          }
          const t = spectate ? sBase + (tReal - rBase) * warp : tReal;
          curMult = mOf(t);
          const ceiling = spectate ? ghostCrash : crashPoint;
          if (curMult >= ceiling) {
            curMult = ceiling;
            trail.push({ t, m: ceiling });
            if (spectate) {
              spectate = false;
              crashVisual(true);
            } else {
              finish(false, 1, "crash");
            }
            return;
          }
          trail.push({ t, m: curMult });
          if (trail.length > 400) trail.shift();
          multEl.textContent = fmtMult(curMult);
          if (spectate) {
            if (multEl.className !== "crash-mult ghost") multEl.className = "crash-mult ghost";
          } else if (roundResolve && autoCash && curMult >= tgt) {
            finish(true, curMult, "cash");
          }
          draw(false, false, t);
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }

    function destroy() {
      stopLoop();
      if (blastRaf) { cancelAnimationFrame(blastRaf); blastRaf = null; }
      if (sizePoll) clearInterval(sizePoll);
      if (roundResolve) {
        const r = roundResolve;
        roundResolve = null;
        r({ multiplier: 0, crashPoint });
      }
    }

    initCanvas();
    draw(false, false, 0);
    if (window.ResizeObserver) new ResizeObserver(() => draw(endCrashed, false, 0)).observe(box);
    let lastBoxW = box.clientWidth;
    const sizePoll = setInterval(() => {
      if (!box.isConnected) { clearInterval(sizePoll); return; }
      if (Math.abs(box.clientWidth - lastBoxW) > 6) {
        lastBoxW = box.clientWidth;
        if (!live) draw(endCrashed, false, 0);
      }
    }, 320);

    function openInfoCard() {
      const rates = [[1.5, 0.6467], [2, 0.485], [3, 0.3233], [5, 0.194], [10, 0.097]];
      const ladder = el("div", { class: "ic-ladder" }, ...rates.map(([m, p]) =>
        el("div", { class: "rung" + (m >= 5 ? " hot" : "") },
          el("span", { text: m.toFixed(2) + "x" }),
          el("div", { class: "bar", style: { width: (p * 100).toFixed(1) + "%" } }),
          el("span", { class: "v", text: (p * 100).toFixed(1) + "%" })
        )
      ));
      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-hint", text: "CHANCE THE ROCKET REACHES EACH MULTIPLIER" }),
        el("div", { class: "ic-scroll", style: { width: "100%" } }, ladder),
        cap("Every level is a fresh coin flip: reaching <b>2.00x</b> is a <b>48.5%</b> shot no matter how many times you've cashed at 1.30x.")
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How a round wins",
            ul([
              "The multiplier climbs from <b>1.00x</b> the moment you launch — slowly at first, then faster and faster: it eases off the pad, so the first couple of seconds only get you to about <b>2.00x</b>, but the climb keeps accelerating, and deep multipliers arrive in a blink.",
              "Press <b>CASH OUT</b> at any time and you bank <b>bet \u00D7 multiplier</b>.",
              "After you bank, the rocket <i>always</i> keeps flying \u2014 it shows you where it would have blown up, so you see how close you cut it. Your payout is locked in the moment you cash out.",
              "Wait too long and the rocket blows up \u2014 you lose the whole bet.",
            ])
          ),
          sec("Manual vs auto cash-out",
            ul([
              "<b>AUTO: ON</b> — set a target (default <b>2.00x</b>) and the rocket banks itself the instant it reaches it.",
              "<b>AUTO: OFF</b> — manual mode. The rocket climbs until <i>you</i> hit <b>CASH OUT</b>, or it blows up.",
              "Idle mode is off here \u2014 this table needs a human hand.",
            ])
          ),
          sec("The crash point",
            ul([
              "It's drawn up front as <b>(1 \u2212 0.03) / (1 \u2212 u)</b> for a random <b>u</b>, then rounded down to a cent.",
              "That gives <b>P(crash \u2265 m) = 0.97 / m</b> \u2014 so the house keeps a flat <b>3%</b> edge.",
              "It's <b>memoryless</b>: surviving to 2.00x tells you nothing about 3.00x.",
              "<b>The pace is not the odds:</b> the climb curve only decides <i>when</i> each multiplier shows up \u2014 the crash point is drawn before launch, so a lazy start and a wild finish never change that flat 3%.",
              "<b>No peeking:</b> the chart's axes never scale to the crash point — the rocket blows up wherever it happens to be, so its position on the chart tells you nothing about what's coming.",
              "<b>Where it would have blown:</b> the instant you cash out, the rocket's death is re-rolled from the same memoryless odds, conditioned on having got this far \u2014 that is <b>cash-out \u00D7 / (1 \u2212 u)</b>. There's <b>no cap</b>: it can blow a cent above your cash-out or run for billions, and every round re-rolls from scratch.",
            ])
          ),
          sec("Lucky Coin perks",
            ul([
              "Each stack lifts the drawn crash point by <b>+25%</b> of itself, so the rocket runs a little further.",
              "Your cash-out multiplier is unchanged \u2014 the extra height is pure edge.",
            ])
          )
        )
      );

      openInfo("Rocket Crash \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Reach odds", note("Reach odds are <b>0.97 / m</b> for any target <span style='white-space:nowrap'><b>m</b></span> \u2014 set a modest target to win often, or a tall one to win big."))
      ));
    }

    return { root, play, actionLabel: "LAUNCH", destroy };
  },
};
