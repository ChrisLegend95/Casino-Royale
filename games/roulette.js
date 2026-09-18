import { el, clear, sleep, toast, confetti, randInt, fmt, mult as multTxt } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, gridMap, legend, sec, ul, note, cap, payChips } from "./infocard.js";
import { state } from "../state.js";

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? "zero" : RED.has(n) ? "red" : "black");
const SPIN_MS = 4600;

const OUTSIDE = [
  { key: "red", label: "RED", pay: 2, cls: "rb", test: (n) => colorOf(n) === "red" },
  { key: "black", label: "BLACK", pay: 2, cls: "rb", test: (n) => colorOf(n) === "black" },
  { key: "even", label: "EVEN", pay: 2, test: (n) => n !== 0 && n % 2 === 0 },
  { key: "odd", label: "ODD", pay: 2, test: (n) => n % 2 === 1 },
  { key: "low", label: "1\u201318", pay: 2, test: (n) => n >= 1 && n <= 18 },
  { key: "high", label: "19\u201336", pay: 2, test: (n) => n >= 19 && n <= 36 },
  { key: "d1", label: "1st 12", pay: 3, test: (n) => n >= 1 && n <= 12 },
  { key: "d2", label: "2nd 12", pay: 3, test: (n) => n >= 13 && n <= 24 },
  { key: "d3", label: "3rd 12", pay: 3, test: (n) => n >= 25 && n <= 36 },
  { key: "c1", label: "COL 1", pay: 3, test: (n) => n > 0 && n % 3 === 1 },
  { key: "c2", label: "COL 2", pay: 3, test: (n) => n > 0 && n % 3 === 2 },
  { key: "c3", label: "COL 3", pay: 3, test: (n) => n > 0 && n % 3 === 0 },
];

function outsideByKey(k) { return OUTSIDE.find((b) => b.key === k); }
const STRAIGHT_PAY = 36;
function numSpot(n) { return { id: "n" + n, kind: "number", n, pay: STRAIGHT_PAY }; }
function outSpot(o) { return { id: "o" + o.key, kind: "outside", key: o.key, pay: o.pay }; }
function spotWins(s, n) {
  if (s.kind === "number") return s.n === n;
  const o = outsideByKey(s.key);
  return o ? o.test(n) : false;
}
/* the controller reads this to explain why SPIN is disabled */
const pickState = { hint: "Pick at least one spot on the felt first." };

export default {
  id: "roulette",
  name: "Roulette",
  icon: "\u{1F3A1}",
  action: "SPIN",
  blurb: "European wheel \u2014 click as many spots as you like. Every spot takes a chip of the same size, and the total can't pass the table limit.",
  payoutNote: () =>
    'Click any number of spots \u2014 <span class="k">every spot takes a chip of your bet</span>, so the number on the felt is your bet \u00D7 the spots you picked, hard-capped by the table limit. ' +
    'Even-money spots pay <span class="k">2x</span>, dozens/columns <span class="k">3x</span>, a straight number <span class="k">36x</span>. ' +
    "Base return 97.3%, the best of any wheel here. Lucky Coin perks give a small, capped chance of nudging a losing ball onto one of your spots.",
  unitLabel: "spots",
  minBet: 1,
  /* one pocket is the whole edge, so the best single spot (a straight) is the ceiling */
  maxWinMult: STRAIGHT_PAY,
  get pickHint() { return pickState.hint; },

  create(app) {
    const history = [];
    const picks = new Map();
    let spinning = false;
    let covered = new Set();
    let winN = -1;
    let ballPos = { a: 0, r: 0.88 };

    const wheelBox = el("div", { class: "roul-wheelbox" },
      el("div", { class: "roul-pointer" }),
      el("canvas", { id: "roulCanvas" }),
      el("div", { class: "roul-ball" }),
      el("div", { class: "roul-ring" }),
      el("div", { class: "roul-hub", id: "roulHub", text: "\u2013" }),
      el("div", { class: "roul-flash" }),
      el("div", { class: "roul-burst" })
    );

    const segWrap = el("div", { class: "seg" });
    const numGrid = el("div", { class: "numgrid" });
    const summaryEl = el("div", { class: "roul-summary" });
    const detailEl = el("div", { class: "roul-limit" });
    const resultEl = el("div", { class: "roul-msg", text: "Pick your spots, then spin." });
    const clearBtn = el("button", {
      class: "chip", type: "button", text: "\u2715 CLEAR FELT",
      onclick: () => { if (!spinning) { picks.clear(); app.refreshBet(); } },
    });
    const historyWrap = el("div", { class: "roul-history" },
      el("span", { class: "roul-hlabel", text: "LAST" })
    );

    const numBtns = [];
    const outBtns = [];

    for (const o of OUTSIDE) {
      const chip = el("span", { class: "pchip o" });
      const btn = el("button", {
        class: "segbtn " + (o.cls || ""), type: "button", "data-key": o.key,
        onclick: () => toggle(outSpot(o)),
      }, el("span", { class: "seg-label", text: o.label }), chip);
      outBtns.push({ btn, chip, key: o.key });
      segWrap.appendChild(btn);
    }
    for (let n = 0; n <= 36; n++) {
      const chip = el("span", { class: "pchip" });
      const btn = el("button", {
        class: "numbtn " + colorOf(n), type: "button", "data-n": n,
        onclick: () => toggle(numSpot(n)),
      }, el("span", { class: "nlabel", text: String(n) }), chip);
      numBtns.push({ btn, chip, n });
      numGrid.appendChild(btn);
    }

    const root = stageShell(
      "Roulette",
      "European wheel \u2014 one zero, 37 pockets. Every spot you click takes a chip of the same size; the total can't pass the table limit.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "roul-wrap" },
        wheelBox,
        el("div", { class: "roul-side" },
          summaryEl,
          detailEl,
          resultEl,
          el("div", { class: "panel-head", text: "Outside bets" }),
          segWrap,
          el("div", { class: "panel-head", text: "Straight up" }),
          numGrid,
          el("div", { class: "roul-tools" }, clearBtn),
          historyWrap
        )
      )
    );

    const canvas = root.querySelector("#roulCanvas");
    const hub = root.querySelector("#roulHub");
    const ball = root.querySelector(".roul-ball");
    const flashEl = root.querySelector(".roul-flash");
    const burstEl = root.querySelector(".roul-burst");

    /* ---------- felt selection ---------- */
    function toggle(spot) {
      if (spinning) return;
      if (picks.has(spot.id)) {
        picks.delete(spot.id);
        app.refreshBet();
        return;
      }
      /* every chip is the same size, so adding a spot adds one more full bet;
         refuse the click rather than let the felt pass the table limit */
      const bet = Math.max(1, Math.floor(app.bet || 0));
      const total = bet * (picks.size + 1);
      if (total > app.tableLimit()) {
        toast("Table limit is " + fmt(app.tableLimit()) + " a spin \u2014 that chip would put " + fmt(total) + " on the felt.", "info", 3000);
        return;
      }
      /* red and black are the two halves of the same spin \u2014 backing both only
         donates a chip to the zero, so the second one clears the first */
      if (spot.key === "red") picks.delete("oblack");
      if (spot.key === "black") picks.delete("ored");
      picks.set(spot.id, spot);
      app.refreshBet();
    }
    function lockFelt(on) {
      for (const { btn } of numBtns) btn.disabled = on;
      for (const { btn } of outBtns) btn.disabled = on;
      clearBtn.disabled = on;
    }
    function numbersCovered() {
      const list = [...picks.values()];
      const out = [];
      for (let n = 0; n <= 36; n++) if (list.some((s) => spotWins(s, n))) out.push(n);
      return out;
    }

    /* called by the controller whenever the bet changes */
    function paint() {
      const list = [...picks.values()];
      const k = list.length;
      const bet = Math.max(0, Math.floor(app.bet || 0));
      const total = bet * k;

      for (const { btn, chip, n } of numBtns) {
        const on = picks.has("n" + n);
        btn.classList.toggle("on", on);
        chip.textContent = on ? fmt(bet) : "";
      }
      for (const { btn, chip, key } of outBtns) {
        const on = picks.has("o" + key);
        btn.classList.toggle("on", on);
        chip.textContent = on ? fmt(bet) : "";
      }

      covered = new Set(list.filter((s) => s.kind === "number").map((s) => s.n));
      for (const { btn, n } of numBtns) btn.classList.toggle("marked", covered.has(n));
      drawWheel();

      clear(summaryEl);
      if (!k) {
        summaryEl.appendChild(el("span", { class: "rs-warn", text: "Pick one or more spots to build your bet." }));
      } else {
        summaryEl.appendChild(el("span", {},
          el("b", { text: String(k) }), " spot" + (k === 1 ? "" : "s"),
          " \u00B7 ", el("b", { text: fmt(bet) }), " a chip"));
        const limit = app.tableLimit();
        summaryEl.appendChild(el("span", {
          class: total > limit ? "rs-warn" : "rs-ok",
          text: " \u00B7 " + fmt(total) + (total > limit ? " breaks the " + fmt(limit) + " table limit" : " on the felt"),
        }));
      }
      pickState.hint = "Pick at least one spot on the felt first.";
      detailEl.textContent = "Table limit " + fmt(app.tableLimit()) + " per spin \u00B7 level " + state.level;
    }

    /* ---------- wheel ---------- */
    function drawWheel() {
      const box = wheelBox;
      const size = Math.max(120, box.clientWidth);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.height = Math.round(size * dpr);
      canvas.style.width = canvas.style.height = size + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = size / 2, cy = size / 2, R = size / 2 - 3, r = R * 0.63;
      const s = (Math.PI * 2) / 37;
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < 37; i++) {
        const a0 = -Math.PI / 2 + i * s - s / 2;
        const a1 = a0 + s;
        const num = ORDER[i];
        ctx.beginPath();
        ctx.arc(cx, cy, R, a0, a1);
        ctx.arc(cx, cy, r, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = num === 0 ? "#12734a" : RED.has(num) ? "#b3232f" : "#161c2a";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (covered.has(num) || num === winN) {
          ctx.beginPath();
          ctx.arc(cx, cy, R - 5, a0, a1);
          ctx.strokeStyle = num === winN ? "#fff6d8" : "rgba(242,193,78,.85)";
          ctx.lineWidth = num === winN ? 6 : 4;
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a0 + s / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,.75)";
        ctx.shadowBlur = 4;
        ctx.font = "800 " + Math.max(10, Math.min(14, size * 0.038)) + "px Inter, sans-serif";
        ctx.fillText(String(num), R * 0.87, 0);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "#5a6c92";
      ctx.lineWidth = Math.max(3, size * 0.014);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(242,193,78,.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    drawWheel();
    if (window.ResizeObserver) {
      let last = wheelBox.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(wheelBox.clientWidth - last) > 6) { last = wheelBox.clientWidth; drawWheel(); placeBall(ballPos.a, ballPos.r); }
      }).observe(wheelBox);
    }
    let lastWheelW = wheelBox.clientWidth;
    const sizePoll = setInterval(() => {
      if (!wheelBox.isConnected) { clearInterval(sizePoll); return; }
      if (Math.abs(wheelBox.clientWidth - lastWheelW) > 6) {
        lastWheelW = wheelBox.clientWidth;
        drawWheel();
        placeBall(ballPos.a, ballPos.r);
      }
    }, 320);

    /* ---------- the ball ---------- */
    function placeBall(angleDeg, rFrac) {
      ballPos = { a: angleDeg, r: rFrac };
      const size = Math.max(120, wheelBox.clientWidth);
      const bs = clamp(size * 0.05, 8, 16);
      ball.style.width = ball.style.height = bs + "px";
      const rad = (angleDeg * Math.PI) / 180;
      const radius = rFrac * (size / 2 - 3);
      const x = size / 2 + radius * Math.sin(rad);
      const y = size / 2 - radius * Math.cos(rad);
      ball.style.transform = "translate(" + (x - bs / 2) + "px," + (y - bs / 2) + "px)";
    }
    let ballTimer = null;
    function stopBall() { if (ballTimer) { clearInterval(ballTimer); ballTimer = null; } }
    function rollBall(dur, instant) {
      stopBall();
      const finalA = 0;
      if (instant || dur <= 0) { placeBall(finalA, 0.88); return Promise.resolve(); }
      const turns = 7 + Math.floor(Math.random() * 4);
      const startA = 360 * Math.random();
      const delta = (finalA - turns * 360) - startA;
      const t0 = performance.now();
      return new Promise((resolve) => {
        ballTimer = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / dur);
          const e = 1 - Math.pow(1 - k, 4);
          const a = startA + delta * e;
          const rad = 1.07 - 0.19 * (1 - Math.pow(1 - k, 2));
          placeBall(a, rad);
          if (k >= 1) { stopBall(); placeBall(finalA, 0.88); resolve(); }
        }, 16);
      });
    }

    /* ---------- effects ---------- */
    function flashWin(col) {
      flashEl.className = "roul-flash";
      void flashEl.offsetWidth;
      flashEl.className = "roul-flash on " + col;
    }
    function chipBurst(col, count) {
      const n = Math.min(64, Math.max(6, count));
      for (let i = 0; i < n; i++) {
        const c = el("div", { class: "rchip " + col });
        const ang = Math.random() * Math.PI * 2;
        const dist = 26 + Math.random() * 120;
        c.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
        c.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
        c.style.animationDelay = (Math.random() * 0.16).toFixed(2) + "s";
        burstEl.appendChild(c);
        setTimeout(() => c.remove(), 1600);
      }
    }

    let rot = 0;
    function spinTo(n, dur, instant) {
      const s = 360 / 37;
      const idx = ORDER.indexOf(n);
      const want = (360 - idx * s) % 360;
      const jitter = (Math.random() - 0.5) * s * 0.6;
      const cur = ((rot % 360) + 360) % 360;
      const delta = (((want + jitter - cur) % 360) + 360) % 360;
      rot = rot + 360 * 7 + delta;
      if (instant) {
        canvas.style.transition = "none";
        canvas.style.transform = "rotate(" + rot + "deg)";
        void canvas.offsetWidth;
        canvas.style.transition = "";
        return Promise.resolve();
      }
      canvas.style.transform = "rotate(" + rot + "deg)";
      return sleep(dur);
    }

    function pushHistory(n) {
      history.unshift(n);
      while (history.length > 12) history.pop();
      clear(historyWrap);
      historyWrap.appendChild(el("span", { class: "roul-hlabel", text: "LAST" }));
      for (const h of history) {
        historyWrap.appendChild(el("span", { class: "hdot " + colorOf(h), text: String(h) }));
      }
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const luck = app.effects().luck;

      if (opts && opts.idle) {
        picks.clear();
        const key = Math.random() < 0.5 ? "red" : "black";
        picks.set("o" + key, outSpot(outsideByKey(key)));
        paint();
      }
      const list = [...picks.values()];
      const k = list.length;
      if (!k) return { multiplier: 0 };

      let n;
      if (app.cheat) {
        /* reward rig: every chip is the same size, so drop the ball onto the
           best-paying spot the player backed, then a number it covers */
        let bi = 0;
        for (let i = 1; i < k; i++) if (list[i].pay > list[bi].pay) bi = i;
        const spot = list[bi];
        if (spot.kind === "number") {
          n = spot.n;
        } else {
          const cands = [];
          for (let x = 0; x <= 36; x++) if (spotWins(spot, x)) cands.push(x);
          n = cands.length ? cands[randInt(0, cands.length - 1)] : ORDER[randInt(0, 36)];
        }
      } else {
        n = ORDER[randInt(0, 36)];
        if (!list.some((s) => spotWins(s, n))) {
          /* The luck nudge. The chance scales DOWN with the best price on the felt
             (chance = luck * k / bestPay), so the return it adds stays a flat
             sliver whether you backed a colour or a single number -- without that
             division a straight-up bet would convert ~97% of its losses into a
             36x win and the wheel would print money. See the balance book in
             main.pjs. */
          const bestPay = Math.max.apply(null, list.map((s) => s.pay));
          const chance = clamp(luck * 0.05 / Math.max(2, bestPay), 0, 0.5);
          if (chance > 0 && Math.random() < chance) {
            const cover = numbersCovered();
            if (cover.length) n = cover[randInt(0, cover.length - 1)];
          }
        }
      }

      spinning = true;
      lockFelt(true);
      winN = -1;
      drawWheel();
      wheelBox.classList.remove("won", "miss");
      wheelBox.classList.add("spinning");
      resultEl.className = "roul-msg";
      resultEl.textContent = "No more bets\u2026";
      hub.textContent = instant ? String(n) : "\u2026";
      hub.className = "roul-hub";

      await Promise.all([
        spinTo(n, instant ? 0 : SPIN_MS, instant),
        rollBall(instant ? 0 : SPIN_MS, instant),
      ]);

      wheelBox.classList.remove("spinning");
      wheelBox.classList.add("hasball");
      const col = colorOf(n);
      winN = n;
      drawWheel();
      hub.textContent = String(n);
      hub.className = "roul-hub " + col;
      void hub.offsetWidth;
      hub.classList.add("pop");
      flashWin(col);

      /* every chip is the same stake, so the round is worth stake x k and each
         winning spot pays its own odds on its own chip */
      let ret = 0;
      const wonSpots = [];
      for (const s of list) if (spotWins(s, n)) { ret += stake * s.pay; wonSpots.push(s); }
      const mult = ret / (stake * k);

      for (const { btn, n: num } of numBtns) btn.classList.toggle("won", wonSpots.some((s) => s.kind === "number" && s.n === num));
      for (const { btn, key } of outBtns) btn.classList.toggle("won", wonSpots.some((s) => s.kind === "outside" && s.key === key));

      pushHistory(n);

      if (wonSpots.length) {
        wheelBox.classList.add("won");
        chipBurst(col, 8 + Math.round(mult * 3));
        if (mult >= 4) confetti(60);
        const names = wonSpots.map((s) => (s.kind === "number" ? s.n + " straight" : outsideByKey(s.key).label)).join(" + ");
        resultEl.className = "roul-msg win";
        resultEl.textContent = n + " " + col.toUpperCase() + " \u2014 " + names + " \u00B7 paid " + multTxt(mult);
        if (!instant) toast("Roulette: " + n + " " + col.toUpperCase() + " \u2014 " + multTxt(mult), "win", 1700);
      } else {
        wheelBox.classList.add("miss");
        resultEl.className = "roul-msg lose";
        resultEl.textContent = n + " " + col.toUpperCase() + " \u2014 none of your spots.";
      }

      spinning = false;
      lockFelt(false);
      return { multiplier: mult };
    }

    function destroy() {
      stopBall();
      clearInterval(sizePoll);
    }

    function openInfoCard() {
      const map = gridMap(3, 13, { cell: 30, gap: 3 });
      map.cells[0][1].remove();
      map.cells[0][2].remove();
      const zero = map.cells[0][0];
      zero.textContent = "0";
      Object.assign(zero.style, {
        gridColumn: "1 / -1", display: "grid", placeItems: "center",
        fontSize: "12px", fontWeight: "800", color: "#d9ffe9",
        background: "linear-gradient(180deg,#12734a,#0b4b31)",
      });
      const numCells = {};
      for (let r = 1; r <= 12; r++) {
        for (let c = 0; c < 3; c++) {
          const n = (r - 1) * 3 + c + 1;
          const node = map.cells[r][c];
          node.textContent = String(n);
          Object.assign(node.style, {
            display: "grid", placeItems: "center", fontSize: "11.5px", fontWeight: "700",
            color: RED.has(n) ? "#ffe0e3" : "#dfe7f5",
            background: RED.has(n) ? "linear-gradient(180deg,#7e1f28,#58131a)" : "linear-gradient(180deg,#1b2333,#11161f)",
          });
          numCells[n] = node;
        }
      }
      const nums = [];
      for (let n = 1; n <= 36; n++) nums.push(n);
      const blacks = nums.filter((n) => !RED.has(n));
      const FAMILIES = [
        { label: "STRAIGHT", color: "#37d67a", nums: [17],
          cap: "Back a single pocket \u2014 a <b>straight</b>. It pays <b>36x</b>, and the ball has 1 chance in 37 of landing there." },
        { label: "RED", color: "#ff5f6d", nums: [...RED],
          cap: "The <b>18 red</b> pockets pay <b>2x</b> \u2014 double your money if the ball lands on any of them." },
        { label: "BLACK", color: "#8b98b4", nums: blacks,
          cap: "The <b>18 black</b> pockets pay <b>2x</b>. Red and black together are all 36 non-zero numbers." },
        { label: "EVEN", color: "#f2c14e", nums: nums.filter((n) => n % 2 === 0),
          cap: "<b>18 even</b> pockets pay <b>2x</b>. Zero is neither even nor odd here \u2014 it loses this bet." },
        { label: "ODD", color: "#f2c14e", nums: nums.filter((n) => n % 2 === 1),
          cap: "The <b>18 odd</b> pockets pay <b>2x</b>. Again, zero loses." },
        { label: "1\u201318", color: "#f2c14e", nums: nums.filter((n) => n <= 18),
          cap: "The <b>low half</b> \u2014 1 through 18 \u2014 pays <b>2x</b>." },
        { label: "19\u201336", color: "#f2c14e", nums: nums.filter((n) => n >= 19),
          cap: "The <b>high half</b> \u2014 19 through 36 \u2014 pays <b>2x</b>." },
        { label: "1st 12", color: "#7fe3ff", nums: nums.filter((n) => n <= 12),
          cap: "A <b>dozen</b> bet: the 12 lowest numbers pay <b>3x</b>." },
        { label: "2nd 12", color: "#7fe3ff", nums: nums.filter((n) => n >= 13 && n <= 24),
          cap: "The middle <b>dozen</b>, 13\u201324, pays <b>3x</b>." },
        { label: "3rd 12", color: "#7fe3ff", nums: nums.filter((n) => n >= 25),
          cap: "The top <b>dozen</b>, 25\u201336, pays <b>3x</b>." },
        { label: "COL 1", color: "#7fe3ff", nums: nums.filter((n) => n % 3 === 1),
          cap: "A <b>column</b> \u2014 1, 4, 7 \u2026 34 \u2014 pays <b>3x</b>." },
        { label: "COL 2", color: "#7fe3ff", nums: nums.filter((n) => n % 3 === 2),
          cap: "A <b>column</b> \u2014 2, 5, 8 \u2026 35 \u2014 pays <b>3x</b>." },
        { label: "COL 3", color: "#7fe3ff", nums: nums.filter((n) => n % 3 === 0),
          cap: "A <b>column</b> \u2014 3, 6, 9 \u2026 36 \u2014 pays <b>3x</b>." },
      ];
      const capEl = cap("Click a bet to see the pockets it covers, or <b>ALL</b> to clear.");
      function show(list, color) {
        for (const node of [zero, ...Object.values(numCells)]) {
          node.classList.remove("lit");
          node.style.removeProperty("--lc");
        }
        for (const n of list) {
          const node = n === 0 ? zero : numCells[n];
          if (!node) continue;
          node.classList.add("lit");
          if (color) node.style.setProperty("--lc", color);
        }
      }
      const lg = legend(FAMILIES.map((f, i) => ({ label: f.label, value: i, color: f.color })),
        (i) => {
          if (i == null || i < 0) { show([], null); capEl.innerHTML = "Click a bet to see the pockets it covers, or <b>ALL</b> to clear."; return; }
          show(FAMILIES[i].nums, FAMILIES[i].color);
          capEl.innerHTML = FAMILIES[i].cap;
        }, { label: "ALL", value: -1 }, -1);

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-scroll" }, map.node),
        capEl,
        lg.node
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How the felt works",
            ul([
              "Click <b>any number of spots</b> \u2014 straight numbers and outside bets. Every spot takes a chip of <b>your bet</b>, so the chips are always the same size.",
              "The total on the felt is your bet \u00D7 the spots you picked, and it can never pass the <b>table limit</b> \u2014 the last spot that would break it is simply refused.",
              "When the ball drops, every spot that covers it pays its own odds on its own chip; losing chips are gone.",
              "You can't back <b>red and black at once</b> \u2014 picking one clears the other.",
            ])
          ),
          sec("What each spot pays",
            ul([
              "A single pocket \u2014 a straight \u2014 pays <b>36x</b> your dollar on it.",
              "A dozen or a column pays <b>3x</b>.",
              "Red/black, odd/even and the low/high halves pay <b>2x</b>.",
            ])
          ),
          sec("The house edge",
            ul([
              "37 pockets, but a straight is paid as if there were 36 \u2014 that one extra pocket is the whole edge.",
              "Base return is <b>97.3%</b>, the best of any wheel here.",
            ])
          ),
          sec("Lucky Coin perks",
            ul([
              "If the ball would land outside all your spots, perks give it a small chance to land on a <b>covered</b> number instead.",
              "It can only rescue a losing ball \u2014 it never nudges a winning number off your felt.",
              "The chance is scaled to the price of your bet, so it adds the same sliver of return whether you backed a colour or a single number \u2014 the wheel stays under 100% either way.",
            ])
          )
        )
      );

      const pay = payChips([
        { glyph: "1", main: "36x", note: "straight" },
        { glyph: "12", main: "3x", note: "dozen / column" },
        { glyph: "18", main: "2x", note: "red / black / odd / even" },
      ]);

      openInfo("Roulette \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Pays per $1 on a spot", pay,
          note("Every spot you back gets the same chip and pays its own odds on it \u2014 a losing chip is the only thing you lose. Table limit <b>" + fmt(app.tableLimit()) + "</b> per spin."))
      ));
    }

    paint();
    return {
      root, play, destroy,
      actionLabel: "SPIN",
      /* one "unit" is one chip, so the controller stakes bet x spots and caps
         the bet at tableLimit / spots -- the felt can never pass the limit.
         Idle always plays a single colour chip, so it is always one unit. */
      getBetUnits: () => (state.idle.on ? 1 : Math.max(1, picks.size)),
      unitLabel: "spots",
      canPlay: () => {
        if (spinning) return false;
        if (state.idle.on) return true;
        if (picks.size < 1) return false;
        return Math.floor(app.bet || 0) * picks.size <= app.tableLimit();
      },
      onBetChange: () => paint(),
    };
  },
};
