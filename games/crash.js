import { el, clear, sleep, toast } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, sec, ul, note, cap } from "./infocard.js";

const RATE = 0.55;
const EDGE = 0.03;

export default {
  id: "crash",
  name: "Rocket Crash",
  icon: "\u{1F680}",
  action: "LAUNCH",
  blurb: "The multiplier climbs. Cash out before the rocket blows up.",
  payoutNote: () =>
    'Cash out before the crash and you get <b>bet \u00D7 multiplier</b>. Base return <span class="k">97%</span>. ' +
    "Flip <b>AUTO</b> on to bank at a target hands-free, or leave it off and hit <b>CASH OUT</b> yourself. Lucky Coin perks push the rocket higher.",
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
      "Watch the multiplier climb. Get out before the kaboom.",
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
    let roundResolve = null;
    let live = false;
    let curMult = 1;
    let crashPoint = 2;
    let tMax = 1;
    let trail = [];
    let stars = [];
    let autoCash = true;

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
      const live = !Number.isFinite(crashPoint);
      const refCap = live ? Math.max(2.2, curMult * 1.5) : crashPoint;
      const topMult = Math.max(2.2, refCap * 1.05, curMult * 1.05);
      const lg = Math.log(topMult);
      const effTMax = live ? Math.max(1, Math.log(Math.max(1.5, curMult * 1.5)) / RATE) : tMax;
      const px = (t) => x0 + clamp(t / effTMax, 0, 1) * plotW;
      const py = (m) => y0 - (Math.log(Math.max(1, m)) / lg) * plotH;

      if (trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (const pt of trail) ctx.lineTo(px(pt.t), py(pt.m));
        const col = crashed ? "#ff5f6d" : cashed ? "#5cf39a" : "#f2c14e";
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.shadowColor = col;
        ctx.shadowBlur = crashed || cashed ? 18 : 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineTo(px(trail[trail.length - 1].t), y0);
        ctx.lineTo(x0, y0);
        ctx.closePath();
        ctx.fillStyle = crashed ? "rgba(255,95,109,.14)" : cashed ? "rgba(92,243,154,.14)" : "rgba(242,193,78,.12)";
        ctx.fill();
      }

      // rocket head
      const last = trail[trail.length - 1];
      if (last) {
        const rx = px(last.t), ry = py(last.m);
        if (!crashed && !cashed) {
          ctx.font = "30px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.translate(rx, ry);
          ctx.rotate(-0.5);
          ctx.fillText("\u{1F680}", 0, 0);
          ctx.restore();
        } else if (crashed) {
          ctx.font = "32px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("\u{1F4A5}", rx, ry);
        }
      }
      ctx.fillStyle = "#8b98b4";
      ctx.font = "600 10px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("1.00x", x0 + 2, y0 - 2);
      ctx.fillText(topMult.toFixed(2) + "x", x0 + 2, 14);
    }

    function renderHistory() {
      const label = historyEl.firstChild;
      clear(historyEl);
      historyEl.appendChild(label);
      for (const h of history) {
        const cls = h >= 3 ? "high" : h >= 1.5 ? "mid" : "low";
        historyEl.appendChild(el("span", { class: "chipx " + cls, text: h.toFixed(2) + "x" }));
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

    function stopLoop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      live = false;
      cashBtn.disabled = true;
    }

    function finish(won, mult, reason) {
      if (!roundResolve) return;
      const resolve = roundResolve;
      roundResolve = null;
      stopLoop();
      if (reason === "crash") {
        curMult = crashPoint;
        multEl.className = "crash-mult crashed";
        multEl.textContent = crashPoint.toFixed(2) + "x";
        msgEl.className = "bj-msg lose";
        msgEl.textContent = "Crashed at " + crashPoint.toFixed(2) + "x \u2014 you were too slow.";
        history.unshift(crashPoint);
        while (history.length > 10) history.pop();
        renderHistory();
        draw(true, false, 0);
      } else {
        multEl.className = "crash-mult cashed";
        multEl.textContent = mult.toFixed(2) + "x";
        msgEl.className = "bj-msg win";
        msgEl.textContent = "Cashed out at " + mult.toFixed(2) + "x!";
        history.unshift(Number.isFinite(crashPoint) ? crashPoint : mult);
        while (history.length > 10) history.pop();
        renderHistory();
        draw(false, true, 0);
      }
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
      crashPoint = app.cheat ? Infinity : makeCrashPoint(luck);
      const tgt = target();

      if (instant) {
        // resolve off-screen: win only if the rocket reaches the target
        if (crashPoint >= tgt) {
          multEl.className = "crash-mult cashed";
          multEl.textContent = tgt.toFixed(2) + "x";
          msgEl.className = "bj-msg win";
          msgEl.textContent = "Auto cashed at " + tgt.toFixed(2) + "x";
          history.unshift(Number.isFinite(crashPoint) ? crashPoint : tgt); while (history.length > 10) history.pop(); renderHistory();
          curMult = 1; trail = [{ t: 0, m: 1 }, { t: 1, m: tgt }]; tMax = 1;
          draw(false, true, 0);
          return { multiplier: tgt, crashPoint };
        }
        multEl.className = "crash-mult crashed";
        multEl.textContent = crashPoint.toFixed(2) + "x";
        msgEl.className = "bj-msg lose";
        msgEl.textContent = "Crashed at " + crashPoint.toFixed(2) + "x";
        history.unshift(crashPoint); while (history.length > 10) history.pop(); renderHistory();
        trail = [{ t: 0, m: 1 }, { t: 1, m: crashPoint }]; tMax = 1;
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
      tMax = Math.max(1, Math.log(Math.max(1.5, Number.isFinite(crashPoint) ? crashPoint : 4)) / RATE);
      live = true;
      cashBtn.disabled = false;

      return new Promise((resolve) => {
        roundResolve = resolve;
        const t0 = performance.now();
        const step = () => {
          const t = (performance.now() - t0) / 1000;
          curMult = Math.exp(RATE * t);
          if (curMult >= crashPoint) {
            curMult = crashPoint;
            trail.push({ t: Math.min(t, tMax), m: crashPoint });
            finish(false, 1, "crash");
            return;
          }
          multEl.textContent = curMult.toFixed(2) + "x";
          trail.push({ t, m: curMult });
          if (trail.length > 400) trail.shift();
          if (autoCash && curMult >= tgt) {
            finish(true, curMult, "cash");
            return;
          }
          draw(false, false, t);
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }

    initCanvas();
    draw(false, false, 0);
    if (window.ResizeObserver) new ResizeObserver(() => draw(false, false, 0)).observe(box);
    let lastBoxW = box.clientWidth;
    const sizePoll = setInterval(() => {
      if (!box.isConnected) { clearInterval(sizePoll); return; }
      if (Math.abs(box.clientWidth - lastBoxW) > 6) {
        lastBoxW = box.clientWidth;
        if (!live) draw(false, false, 0);
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
              "The multiplier climbs from <b>1.00x</b> upwards the moment you launch.",
              "Press <b>CASH OUT</b> at any time and you bank <b>bet \u00D7 multiplier</b>.",
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

    return { root, play, actionLabel: "LAUNCH" };
  },
};
