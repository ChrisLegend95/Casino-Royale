import { el, clear, sleep, toast, flavor } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, svgEl, legend, sec, ul, note, cap } from "./infocard.js";
import { sfx } from "../audio.js";

const COLORS = ["#ef4d5a", "#4d9fff", "#f2c14e", "#37d67a", "#a06bff", "#ff8f3f"];
const FALLBACK_NAMES = ["Thunderbolt", "Midnight", "Lucky Star", "Iron Hoof", "Velvet", "Dust Devil"];
const LANE_H = 38;
const N = 6;
/* the payout curve's clamp -- see openInfoCard and the picks list */
const MAX_PAY = 60;

function pickNames() {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < 150 && out.length < N; i++) {
    const n = String(flavor("horseNames") || "").trim();
    if (!n || n.length > 13 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  let k = 0;
  while (out.length < N) out.push(FALLBACK_NAMES[k++ % FALLBACK_NAMES.length]);
  return out;
}

export default {
  id: "horse",
  name: "Horse Racing",
  icon: "\u{1F40E}",
  action: "RACE",
  blurb: "Six runners, real simulated race. Back one and hope it finds the line.",
  payoutNote: () =>
    'Odds are posted before the race \u2014 longshots pay big. Base return <span class="k">92%</span>. ' +
    "Lucky Coin perks make your pick run faster than its odds suggest.",
  minBet: 1,
  /* the payout curve is clamped at MAX_PAY, so a longshot is the ceiling */
  maxWinMult: MAX_PAY,

  create(app) {
    const names = pickNames();
    const horses = names.map((name, i) => ({ name, color: COLORS[i % COLORS.length], num: i + 1 }));

    const canvas = el("canvas", { id: "horseCanvas" });
    const trackBox = el("div", { class: "track-box" }, canvas);
    const picksEl = el("div", { class: "horse-picks" });
    const msgEl = el("div", { class: "horse-msg", text: "Pick a runner." });

    const root = stageShell(
      "Horse Racing",
      "The field is set. Odds posted below. Post time whenever you are ready.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "horse-wrap" }, msgEl, trackBox, picksEl)
    );

    let selected = 0;
    let busy = false;
    let race = null;

    function idlePick() {
      const weights = horses.map((_, i) => {
        const base = race ? race.p[i] : 1 / N;
        return Math.pow(base, 0.6) * (0.5 + Math.random());
      });
      let sum = 0;
      for (const w of weights) sum += w;
      let r = Math.random() * sum;
      for (let i = 0; i < N; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return N - 1;
    }

    function newRace() {
      const ratings = [];
      for (let i = 0; i < N; i++) ratings.push(0.55 + Math.random() * 0.95);
      const sum = ratings.reduce((a, b) => a + b, 0);
      const p = ratings.map((r) => r / sum);
      const payouts = p.map((pi) => clamp(0.92 / pi, 1.05, MAX_PAY));
      race = { ratings, p, payouts };
      renderPicks();
    }

    function renderPicks() {
      clear(picksEl);
      horses.forEach((h, i) => {
        const pay = race ? race.payouts[i] : 1;
        const prob = race ? race.p[i] : 0;
        picksEl.appendChild(el("button", {
          class: "hpick" + (selected === i ? " on" : ""),
          type: "button",
          "data-i": i,
          onclick: () => { if (!busy) { selected = i; renderPicks(); } },
        },
          el("span", { class: "swatch", style: { background: h.color } }),
          el("span", { class: "hmeta" },
            el("span", { class: "hname", text: h.num + ". " + h.name }),
            el("span", { class: "hodd", text: pay.toFixed(2) + "x  \u00B7  " + (prob * 100).toFixed(0) + "%" })
          )
        ));
      });
    }

    /* ---------- canvas ---------- */
    let prevFrameProg = null;
    function draw(progress, finished, winnerIdx) {
      const box = trackBox;
      const wCss = Math.max(240, box.clientWidth);
      const hCss = N * LANE_H + 18;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(wCss * dpr)) {
        canvas.width = Math.round(wCss * dpr);
        canvas.height = Math.round(hCss * dpr);
      }
      canvas.style.width = wCss + "px";
      canvas.style.height = hCss + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = wCss, h = hCss;
      ctx.clearRect(0, 0, w, h);

      const startX = 30, finishX = w - 52;
      for (let i = 0; i < N; i++) {
        const y = 9 + i * LANE_H;
        ctx.fillStyle = i % 2 ? "#123f24" : "#0f3620";
        ctx.fillRect(0, y, w, LANE_H - 2);
      }
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 0, w, 8);
      ctx.fillRect(0, h - 9, w, 9);

      // finish line (checker)
      for (let i = 0; i < N * 2; i++) {
        for (let j = 0; j < 4; j++) {
          ctx.fillStyle = (i + j) % 2 ? "#f2f4f8" : "#151a24";
          ctx.fillRect(finishX + j * 6, 9 + i * (LANE_H / 2), 6, LANE_H / 2);
        }
      }
      ctx.fillStyle = "#8b98b4";
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("FINISH", finishX + 12, h - 1);

      const speeds = prevFrameProg
        ? progress.map((p, i) => Math.max(0, p - prevFrameProg[i]))
        : new Array(N).fill(0);
      prevFrameProg = progress.slice();

      horses.forEach((h, i) => {
        const y = 9 + i * LANE_H + LANE_H / 2 + (finished ? 0 : Math.sin(performance.now() / 105 + i * 1.7) * 1.4);
        const pr = progress[i];
        const x = startX + clamp(pr, 0, 1.02) * (finishX - startX);
        const isWin = finished && winnerIdx === i;

        // dust kicked up behind a hard-running horse
        if (!finished) {
          const pxSpeed = (speeds[i] || 0) * (finishX - startX);
          const base = clamp(pxSpeed / 5.5, 0, 1);
          for (let d = 0; d < 4; d++) {
            const a = base * (0.3 - d * 0.062);
            if (a <= 0.015) break;
            ctx.fillStyle = "rgba(214,201,166," + a.toFixed(3) + ")";
            ctx.beginPath();
            ctx.arc(x - 12 - d * 11, y + 4 + Math.sin(performance.now() / 90 + d + i) * 2.4, 3 + d * 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.save();
        ctx.globalAlpha = finished && !isWin ? 0.72 : 1;
        // silk
        ctx.beginPath();
        ctx.arc(x, y - 9, 8, 0, Math.PI * 2);
        ctx.fillStyle = h.color;
        ctx.fill();
        ctx.strokeStyle = isWin ? "#ffe08a" : "rgba(0,0,0,.5)";
        ctx.lineWidth = isWin ? 2 : 1;
        ctx.stroke();
        ctx.fillStyle = "#0b0f18";
        ctx.font = "800 9px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(h.num), x, y - 9);
        // horse
        ctx.font = "22px serif";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("\u{1F40E}", x, y + 12);
        if (isWin) {
          ctx.font = "16px serif";
          ctx.fillText("\u{1F3C6}", x, y - 20);
        }
        ctx.restore();
      });

      // start line
      ctx.fillStyle = "rgba(255,255,255,.16)";
      ctx.fillRect(startX - 8, 9, 2, N * LANE_H);
    }

    let frameProgress = new Array(N).fill(0);
    draw(frameProgress, false, -1, null);

    function waitMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

    function runRace(finishPos, winnerIdx) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const dur = 6000;
        const phases = horses.map(() => Math.random() * 6.28);
        const freqs = horses.map(() => 1.4 + Math.random() * 2.4);
        const amps = horses.map((_, i) => (i === winnerIdx ? 0.05 : 0.09) * (0.55 + Math.random() * 0.9));
        let lastHoof = 0;
        let lastLead = -1;
        const step = () => {
          const now = performance.now();
          const x = Math.min(1, (now - t0) / dur);
          const ease = Math.pow(x, 1.35);
          const cap = Math.min(1, ease * 1.03);
          const prog = finishPos.map((fp, i) => {
            const surge = amps[i] * Math.sin(Math.PI * x) * Math.sin(2 * Math.PI * x * freqs[i] + phases[i]);
            return clamp(ease * fp + surge, 0, cap);
          });
          draw(prog, false, -1, null);

          if (now - lastHoof > 118) { sfx.hoof(); lastHoof = now; }

          if (x >= 0.9) {
            msgEl.textContent = "\u{1F3C1} Photo finish\u2026";
          } else if (x > 0.12) {
            let lead = 0;
            for (let i = 1; i < N; i++) if (prog[i] > prog[lead]) lead = i;
            if (lead !== lastLead) {
              lastLead = lead;
              msgEl.textContent = "\u{1F40E} " + horses[lead].name + " takes the lead!";
            }
          }
          if (x < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const luck = app.effects().luck;
      if (opts && opts.idle) selected = idlePick();
      busy = true;
      msgEl.className = "horse-msg";
      msgEl.textContent = instant ? "" : "\u{1F3C1} Runners are at the gate\u2026";
      renderPicks();

      // luck boost: your runner's rating improves (odds were already posted)
      const ratings = race.ratings.slice();
      ratings[selected] *= 1 + luck * 0.10;
      const sum = ratings.reduce((a, b) => a + b, 0);
      const p = ratings.map((r) => r / sum);

      // exponential race: P(i wins) === p[i] exactly
      const times = p.map((pi) => -Math.log(Math.max(1e-9, Math.random())) / pi);
      const minT = Math.min(...times);
      const norm = times.map((t) => clamp(t / minT, 1, 1.85));
      let winnerIdx = 0;
      for (let i = 1; i < N; i++) if (times[i] < times[winnerIdx]) winnerIdx = i;

      const sorted = norm.slice().sort((a, b) => a - b);
      const rank = norm.map((t) => sorted.indexOf(t));
      let finishPos = norm.map((t) => 1 / t);
      if (app.cheat) {
        /* reward rig: the backed runner reaches the line first and the field
           \\u2014 the fair winner dropped to the back \\u2014 falls away behind it */
        const fairWinner = winnerIdx;
        const others = [];
        for (let i = 0; i < N; i++) if (i !== selected) others.push(i);
        others.sort((a, b) => times[a] - times[b]);
        const tail = others.filter((i) => i !== fairWinner);
        tail.push(fairWinner);
        const order = [selected].concat(tail);
        finishPos = new Array(N).fill(0);
        for (let k = 0; k < order.length; k++) finishPos[order[k]] = 1 - k * 0.052;
        winnerIdx = selected;
      }
      frameProgress = finishPos;

      if (instant) {
        draw(finishPos, true, winnerIdx);
      } else {
        sfx.callToPost();
        await waitMs(1000);
        msgEl.textContent = "\u{1F40E} And they're off!";
        sfx.crowd(0.08);
        await runRace(finishPos, winnerIdx);
        draw(finishPos, true, winnerIdx);
        sfx.crowd(0.16);
      }

      const won = winnerIdx === selected;
      const pay = won ? race.payouts[selected] : 0;
      const wname = horses[winnerIdx].name;
      msgEl.className = "horse-msg " + (won ? "win" : "lose");
      msgEl.textContent = won
        ? "\u{1F3C6} " + wname + " wins! Paid " + race.payouts[selected].toFixed(2) + "x"
        : "\u{1F40E} " + wname + " wins. Your " + horses[selected].name + " came in " + ordinal(rank[selected] + 1) + ".";
      if (won && !instant) toast("Your horse wins at " + race.payouts[selected].toFixed(2) + "x!", "win", 1900);

      busy = false;
      newRace();
      msgEl.textContent += "  \u00B7  Next race posted.";
      return { multiplier: pay };
    }

    function ordinal(n) {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    newRace();
    if (window.ResizeObserver) {
      new ResizeObserver(() => draw(frameProgress, false, -1, null)).observe(trackBox);
    }
    let lastTrackW = trackBox.clientWidth;
    const sizePoll = setInterval(() => {
      if (!trackBox.isConnected) { clearInterval(sizePoll); return; }
      if (Math.abs(trackBox.clientWidth - lastTrackW) > 6) {
        lastTrackW = trackBox.clientWidth;
        draw(frameProgress, false, -1, null);
      }
    }, 320);
    function openInfoCard() {
      const pay = (p) => clamp(0.92 / p, 1.05, MAX_PAY);
      const W = 340, H = 178, L = 44, R = 16, T = 16, B = 30;
      const PMAX = 0.6, YMAX = 20;
      const px = (p) => L + (Math.min(p, PMAX) / PMAX) * (W - L - R);
      const py = (m) => H - B - (Math.min(m, YMAX) / YMAX) * (H - T - B);
      const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "ic-chart" });
      for (const m of [0, 5, 10, 15, 20]) {
        const y = py(m);
        svg.appendChild(svgEl("line", { x1: L, y1: y, x2: W - R, y2: y, stroke: "rgba(140,160,200,.13)" }));
        svg.appendChild(svgEl("text", { x: L - 7, y: y + 3, class: "ic-axis", "text-anchor": "end" }, m + "x"));
      }
      for (const p of [0, 0.2, 0.4, 0.6]) {
        svg.appendChild(svgEl("text", { x: px(p), y: H - 12, class: "ic-axis", "text-anchor": "middle" }, Math.round(p * 100) + "%"));
      }
      svg.appendChild(svgEl("text", { x: (L + W - R) / 2, y: H - 1, class: "ic-axis", "text-anchor": "middle" }, "posted win chance"));
      const pts = [];
      for (let p = 0.92 / YMAX; p <= PMAX + 1e-6; p += 0.0025) pts.push(px(p).toFixed(1) + "," + py(pay(p)).toFixed(1));
      svg.appendChild(svgEl("polyline", { class: "ic-curve", stroke: "#f2c14e", points: pts.join(" ") }));

      const SPOTS = [[0.5, "1.84x"], [0.25, "3.68x"], [0.10, "9.20x"], [0.05, "18.4x"]];
      const dots = SPOTS.map(([p]) => svgEl("circle", { cx: px(p), cy: py(pay(p)), r: 4.5, fill: "#f2c14e" }));
      const labels = SPOTS.map(([p, lab]) => svgEl("text", { x: px(p), y: py(pay(p)) - 10, class: "ic-axis", "text-anchor": "middle" }, lab));
      dots.forEach((d) => svg.appendChild(d));
      labels.forEach((l) => svg.appendChild(l));

      const capEl = cap("");
      const NOTES = [
        "A <b>50%</b> favourite pays <b>1.84x</b> \u2014 the 92% return shows up as the missing 8 cents.",
        "A <b>25%</b> runner (4-to-1) pays <b>3.68x</b>.",
        "A <b>10%</b> outsider pays <b>9.20x</b> \u2014 ten times a level stake would be fair; you get 9.20.",
        "A <b>5%</b> longshot pays <b>18.4x</b>. Anything under a <b>1.53%</b> chance hits the <b>60x cap</b>.",
      ];
      const lg = legend(SPOTS.map(([p], i) => ({ label: Math.round(p * 100) + "%", value: i, color: "#f2c14e" })),
        (i) => {
          const k = i == null ? 0 : i;
          dots.forEach((d, j) => { d.setAttribute("r", j === k ? 7 : 4.5); d.setAttribute("fill", j === k ? "#ffe08a" : "#f2c14e"); });
          labels.forEach((l, j) => l.setAttribute("class", "ic-axis" + (j === k ? " hi" : "")));
          capEl.innerHTML = NOTES[k];
        }, null, 0);

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-scroll", style: { width: "100%", display: "flex", justifyContent: "center" } }, svg),
        lg.node,
        capEl
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How the race works",
            ul([
              "Six runners are given a hidden rating each race; the simulated race makes <b>P(i wins) = its posted probability</b> exactly.",
              "You back one runner before the gate \u2014 the posted board shows each runner's <b>payout \u00B7 win chance</b>.",
              "The finishing order is a real simulation, so upsets and photo finishes happen at the advertised rate.",
            ])
          ),
          sec("What your pick pays",
            ul([
              "Win and you bank <b>clamp(0.92 / p, 1.05, 60)</b> on your stake, where <b>p</b> is the posted win chance.",
              "Favourites are floored at <b>1.05x</b>; longshots are capped at <b>60x</b>.",
              "Base return is <b>92%</b> \u2014 the table keeps 8 cents on the dollar.",
            ])
          ),
          sec("Reading the board",
            ul([
              "The number beside each name is the payout, followed by the implied win chance.",
              "Longshots pay more because they land less \u2014 there's no hidden overlay either way.",
            ])
          ),
          sec("Lucky Coin perks",
            ul([
              "Perk stacks improve <b>your</b> runner's rating, so it genuinely outruns its posted odds.",
              "You're still paid the posted price \u2014 so the extra speed is pure edge.",
            ])
          )
        )
      );

      openInfo("Horse Racing \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("The payout curve", note("Payout is <b>0.92 / p</b>: a fair 1/p would return your stake exactly, so the 0.92 is where the 8% goes."))
      ));
    }

    return { root, play, actionLabel: "RACE" };
  },
};
