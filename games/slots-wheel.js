import { el, clear, sleep, toast, fmt } from "../ui.js";
import { stageShell, round2, SPIN_EASE_CSS, spinBlur, BLUR_TICK,
  SETTLE_MS, settleOffset, setSettleVars, beginSettle, endSettle, clearSettle } from "./common.js";
import { infoBtn, openInfo, sec, ul, note, payChips, gridMap, legend, markCells, svgEl } from "./infocard.js";
import { sfx } from "../audio.js";
import {
  REELS, ROWS, LINES, MAX_LINES, BONUS, BONUS_ID, JACKPOT, JACKPOT_ID, PAYROW, SYMBOL_BY_ID,
  resolveSpin, spinWinUnits, wheelValues, BONUS_TRIGGER, reelWeights,
} from "./slots-wheel-math.js";
import { spriteEl, spriteHtml, preloadSprites } from "../sprites.js";
import { createLedBoard } from "./ledboard.js";
import { jackpotPot, jackpotBankView } from "../state.js";

const GAME_ID = "slots-wheel";

/* Wheelhouse is Fortune Lines' bigger sibling: the same five-drum, three-row
   cabinet (it borrows the `ml-` reel/cabinet CSS wholesale, so the two machines
   spin identically), but a twenty-five-line board and a single bonus -- land
   three or more wheel scatters anywhere and the bonus wheel drops over the
   cabinet, spins, and pays a flat multiple of the whole stake.

   The wheel's landing segment is drawn by the MATHS (see slots-wheel-math.js)
   before a single frame is animated, so the drum and the wheel are two faces of
   one result: the UI only ever has to draw where the pointer stopped. */

function symOf(id) {
  return SYMBOL_BY_ID[id] || { id, sprite: null, glyph: "?" };
}

/* one symbol's artwork, at a caller-chosen artwork size (and a plain glyph if
   a symbol somehow has no sprite assigned) */
function symIcon(s, base) {
  if (!s.sprite) return el("span", { class: "spr-fallback", text: s.glyph });
  return spriteEl(s.sprite, { fallback: s.glyph, base });
}

const NS = "http://www.w3.org/2000/svg";
const LINE_OPTIONS = [1, 5, 10, 15, 25];
const WHEEL_MS = 2600;
const WHEEL_EASE = "cubic-bezier(.13,.68,.05,1)";

/* twenty-five lines need twenty-five distinguishable strokes: stepping the hue
   by the golden angle spreads them evenly instead of leaving a cluster of
   near-identical blues next to each other the way i*360/25 would */
const LINE_COLORS = Array.from({ length: MAX_LINES }, (_, i) =>
  "hsl(" + Math.round((i * 137.508) % 360) + ",82%,63%)");
const ROW_NAMES = ["top", "middle", "bottom"];
const PG_CELL = 42, PG_GAP = 6;

function lineShape(li) {
  const names = LINES[li].map((r) => ROW_NAMES[r]);
  if (names.every((n) => n === names[0])) return "flat across the " + names[0] + " row";
  const parts = [];
  let i = 0;
  while (i < names.length) {
    let j = i;
    while (j + 1 < names.length && names[j + 1] === names[i]) j++;
    const n = j - i + 1;
    parts.push(names[i].charAt(0).toUpperCase() + names[i].slice(1) + (n > 1 ? " \u00D7" + n : ""));
    i = j + 1;
  }
  return parts.join(" \u2192 ");
}

export default {
  id: GAME_ID,
  name: "Wheelhouse",
  icon: "\u{1F4AB}",
  action: "SPIN",
  blurb: "Five drums, three rows, twenty-five paylines. Three WHEEL scatters drop the bonus wheel over the reels.",
  payoutNote: () =>
    "Land <b>3, 4 or 5</b> matching symbols from the left edge of any of your live paylines. " +
    spriteHtml("wild") + " is <b>wild on every drum</b>, so it also pays on its own line. " +
    "<b>Three or more</b> " + spriteHtml("wheel") + " anywhere on the grid drop the <b>bonus wheel</b> " +
    "over the reels for a flat <b>\u00D73 \u2013 \u00D725 of your total stake</b>. " +
    "All line pays are <b>per line bet</b>. Base return <b>~96%</b>; the wheel is the top prize.",
  minBet: 1,

  create(app) {
    let lines = MAX_LINES;
    let fastUntil = 0;

    /* The pit meter that hangs beside the cabinet. On a twenty-five-line board
       the side panel's "amount" is the money PER LINE, so the meter's TOTAL pod
       is the number that actually leaves the pocket: per-line bet x live lines.
       The JACKPOT pod is THIS CABINET'S progressive (see src/state.js) -- the
       Wheelhouse feeds its own bank on a losing spin, and only three jackpot
       signs here can take it. Lucky Sevens and Fortune Lines keep banks of
       their own. The meter is wired through onBetChange (below), so switching
       lines or changing the stake lands on the display immediately. */
    const board = createLedBoard([
      { label: "LINES", digits: 2, read: () => lines },
      { label: "TOTAL", digits: 6, read: () => Math.round(app.bet * lines), caption: "PER SPIN" },
      { label: "JACKPOT", digits: 7, read: () => jackpotPot(GAME_ID), jackpot: true, caption: "3 JACKPOTS ANYWHERE" },
    ]);

    const segValues = wheelValues();
    const SEG_COUNT = segValues.length;
    const SEG_ANGLE = 360 / SEG_COUNT;
    const SEG_COLS = ["#1b2b45", "#22556f", "#7c5a13", "#a25f10", "#9c1b34", "#3c2b6b"];

    const root = stageShell(
      "Wheelhouse",
      "Twenty-five paylines across five drums. Pays are per line bet \u2014 total cost is your bet \u00D7 lines.",
      { info: infoBtn(() => openPayTable(), "PAY TABLE") },
      el("div", { class: "mline-wrap" },
        el("div", { class: "cab-row" },
          el("div", { class: "slot-cabinet mline-cab" },
            el("div", { class: "slot-marquee" },
              el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i"))),
              el("span", { class: "marquee-title", text: "WHEELHOUSE" }),
              el("span", { class: "sub", id: "whSubEl", text: "25 PAYLINES" }),
              el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i")))
            ),
            el("div", { class: "ml-lines" },
              el("span", { class: "ml-lines-label", text: "PAYLINES" }),
              ...LINE_OPTIONS.map((n) =>
                el("button", { class: "segbtn ml-linebtn" + (n === MAX_LINES ? " on" : ""), type: "button",
                  "data-lines": n, text: String(n), onclick: () => setLines(n) })
              ),
              el("span", { class: "ml-free-badge", id: "whBadgeEl", hidden: true, text: "" })
            ),
            el("div", { class: "reels mlreels", id: "whReelsEl" },
              ...[0, 1, 2, 3, 4].map(() =>
                el("div", { class: "mlreel" }, el("div", { class: "reel-strip mlstrip" }))
              )
            ),
            el("div", { class: "slot-result ml-result", id: "whResultEl", text: "Place your bet and pull the lever" }),
            el("div", { class: "ml-detail", id: "whDetailEl", text: "" })
          ),
          board.node
        ),
        el("div", { class: "slot-paywrap" },
          el("div", { class: "wh-bonus" },
            symIcon(BONUS, 22),
            el("span", { class: "wh-bonus-t", html: "<b>3+ WHEELS</b> \u2192 spin the wheel" }),
            el("span", { class: "wh-bonus-n", html: "<b>\u00D73\u2013\u00D725</b> of your total stake" })
          ),
          el("div", { class: "ml-pay wh-pay" },
            ...[...PAYROW].reverse().map((s) =>
              el("div", { class: "mlchip" },
                symIcon(s),
                el("span", { class: "triple", text: s.pay[3] + " \u00B7 " + s.pay[4] + " \u00B7 " + s.pay[5] })
              )
            )
          ),
          /* the jackpot sign is a scatter -- it pays nothing on a line, so it is
             not a rung of the ladder: it gets a full-width strip of its own
             under the chips, showing what it actually does. */
          el("div", { class: "mlchip pot" },
            symIcon(JACKPOT),
            el("span", { class: "triple", text: "POT" }),
            el("span", { class: "note", text: "3 SIGNS ANYWHERE \u2014 PAYS NOTHING, TAKES THE POT" })
          )
        )
      )
    );

    const cabinet = root.querySelector(".mline-cab");
    const reelsEl = root.querySelector("#whReelsEl");
    const overlay = document.createElementNS(NS, "svg");
    overlay.setAttribute("class", "mloverlay");
    overlay.setAttribute("preserveAspectRatio", "none");
    reelsEl.appendChild(overlay);
    const resultEl = root.querySelector("#whResultEl");
    const detailEl = root.querySelector("#whDetailEl");
    const badgeEl = root.querySelector("#whBadgeEl");
    const subEl = root.querySelector("#whSubEl");
    const reels = Array.from(root.querySelectorAll(".mlreel"));
    const strips = reels.map((r) => r.querySelector(".mlstrip"));
    const lineBtns = Array.from(root.querySelectorAll(".ml-linebtn"));
    let lineFlash = null;
    let lineGuides = [];

    /* ---------------- the bonus wheel ----------------
       A five-segment disc under a fixed pointer at 12 o'clock, hidden until a
       spin brings four scatters in. Each segment's label is drawn rotated onto
       its own spoke (a real wheel's labels run tangential to the rim), which
       has the happy consequence that the label under the pointer is the one
       that reads upright when the disc stops on its mark. */
    const segs = segValues.map((v, i) => {
      const a = i * SEG_ANGLE + SEG_ANGLE / 2;
      return el("div", { class: "whwheel-seg", "data-seg": i, style: "--a:" + a.toFixed(2) + "deg" },
        el("span", { class: "whwheel-lab", text: "\u00D7" + v })
      );
    });
    const disc = el("div", { class: "whwheel-disc", id: "whDiscEl" },
      el("div", { class: "whwheel-spokes", style: "--segang:" + SEG_ANGLE.toFixed(2) + "deg" }),
      ...segs,
      el("div", { class: "whwheel-hub" }, symIcon(symOf(BONUS_ID), 34))
    );
    disc.style.background = "conic-gradient(from 0deg," + segValues.map((v, i) =>
      SEG_COLS[i % SEG_COLS.length] + " " + (i * SEG_ANGLE).toFixed(2) + "deg " + ((i + 1) * SEG_ANGLE).toFixed(2) + "deg"
    ).join(",") + ")";

    const wheelOutEl = el("div", { class: "whwheel-out", text: "" });
    const wheelEl = el("div", { class: "whwheel", id: "whWheelEl", hidden: true },
      el("div", { class: "whwheel-card" },
        el("div", { class: "whwheel-title", text: "WHEEL BONUS" }),
        el("div", { class: "whwheel-stage" },
          el("div", { class: "whwheel-pointer" }),
          disc
        ),
        wheelOutEl
      )
    );
    cabinet.appendChild(wheelEl);

    root.addEventListener("pointerdown", () => { fastUntil = Date.now() + 4000; });

    function wait(ms) {
      return sleep(Date.now() < fastUntil ? Math.min(ms, 70) : ms);
    }

    function cellH() {
      const c = strips[0].firstElementChild;
      if (!c) return 40;
      const h = parseFloat(getComputedStyle(c).height);
      return Number.isFinite(h) && h > 0 ? h : c.offsetHeight || 40;
    }

    /* a drum cell. A jackpot sign wears the red rim (.jcell in src/styles.css)
       wherever it appears -- blurred past in the spin, and where it stops --
       so the one symbol that can empty this machine's pot is recognisable on
       the drums. */
    function cell(sym) {
      return el("div", { class: "mlcell" + (sym.id === JACKPOT_ID ? " jcell" : "") }, symIcon(sym));
    }

    function setStrip(i, syms) {
      const strip = strips[i];
      clear(strip);
      clearSettle(strip);
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      strip.style.filter = "";
      for (const s of syms) strip.appendChild(cell(s));
    }

    function showGrid(grid) {
      for (let i = 0; i < REELS; i++) {
        setStrip(i, [grid[0][i], grid[1][i], grid[2][i]].map(symOf));
      }
    }

    let blurTimers = reels.map(() => 0);
    let settleTimers = reels.map(() => 0);
    const landYs = reels.map(() => 0);

    function driveBlur(i, dur) {
      stopBlur(i);
      const strip = strips[i];
      const maxBlur = Math.max(5, Math.min(13, cellH() * 0.34));
      const t0 = performance.now();
      strip.style.filter = "blur(" + maxBlur.toFixed(1) + "px)";
      blurTimers[i] = setInterval(() => {
        const t = (performance.now() - t0) / dur;
        strip.style.filter = "blur(" + spinBlur(t, maxBlur).toFixed(2) + "px)";
      }, BLUR_TICK);
    }

    function stopBlur(i) {
      if (blurTimers[i]) { clearInterval(blurTimers[i]); blurTimers[i] = 0; }
      strips[i].style.filter = "";
    }

    function burst(reel) {
      const fx = el("div", { class: "ml-landfx" });
      reel.appendChild(fx);
      setTimeout(() => { if (fx.parentNode) fx.parentNode.removeChild(fx); }, 460);
    }

    function startSettle(k) {
      const strip = strips[k];
      if (settleTimers[k]) { clearTimeout(settleTimers[k]); settleTimers[k] = 0; }
      beginSettle(strip);
      settleTimers[k] = setTimeout(() => {
        settleTimers[k] = 0;
        endSettle(strip, landYs[k]);
      }, SETTLE_MS);
    }

    function stopSettle(k) {
      if (settleTimers[k]) { clearTimeout(settleTimers[k]); settleTimers[k] = 0; }
      clearSettle(strips[k]);
    }

    function landReel(k, last) {
      stopBlur(k);
      const reel = reels[k];
      reel.classList.remove("spinning");
      reel.classList.add("landed");
      sfx.reelStop(0);
      burst(reel);
      startSettle(k);
      setTimeout(() => reel.classList.remove("landed"), 430);
      if (last) {
        cabinet.classList.remove("thump");
        void cabinet.offsetWidth;
        cabinet.classList.add("thump");
        setTimeout(() => cabinet.classList.remove("thump"), 330);
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* blocked */ } }
      }
    }

    function scrollReel(i, grid, dur, count, luck) {
      const strip = strips[i];
      clear(strip);
      clearSettle(strip);
      strip.style.filter = "";
      const filler = fillerPicker(i, luck);
      const total = Math.max(6, count);
      for (let k = 0; k < total - ROWS; k++) strip.appendChild(cell(symOf(filler())));
      for (const id of [grid[0][i], grid[1][i], grid[2][i]]) strip.appendChild(cell(symOf(id)));
      const h = cellH();
      const landY = -(total - ROWS) * h;
      const over = settleOffset(h);
      landYs[i] = landY;
      setSettleVars(strip, landY, over);
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      void strip.offsetWidth;
      strip.style.transition = "transform " + dur + "ms " + SPIN_EASE_CSS;
      strip.style.transform = "translateY(" + (landY - over) + "px)";
      driveBlur(i, dur);
      return new Promise((resolve) => {
        let done = false;
        let tm = 0;
        const finish = () => {
          if (done) return;
          done = true;
          strip.removeEventListener("transitionend", onEnd);
          clearTimeout(tm);
          resolve();
        };
        const onEnd = (e) => { if (e.target === strip && e.propertyName === "transform") finish(); };
        strip.addEventListener("transitionend", onEnd);
        tm = setTimeout(finish, dur + 140);
      });
    }

    function cellAt(col, row) {
      const kids = strips[col].children;
      return kids[kids.length - ROWS + row];
    }

    function clearFx() {
      lastEv = null;
      clearGuideLines();
      overlay.innerHTML = "";
      overlay.removeAttribute("viewBox");
      badgeEl.hidden = true;
      for (const r of reels) r.classList.remove("win");
      for (const s of strips) {
        for (const c of Array.from(s.children)) c.classList.remove("wcell", "wcell-scatter");
      }
      hideWheel(true);
    }

    function relPoint(node, svgRect) {
      const r = node.getBoundingClientRect();
      return [
        r.left - svgRect.left + r.width / 2,
        r.top - svgRect.top + r.height / 2,
      ];
    }

    let lastEv = null;
    let drawnW = 0, drawnH = 0;

    function renderWins(ev, instant) {
      lastEv = ev;
      overlay.innerHTML = "";
      const svgRect = overlay.getBoundingClientRect();
      const w = Math.max(1, svgRect.width);
      const h = Math.max(1, svgRect.height);
      drawnW = w;
      drawnH = h;
      overlay.setAttribute("viewBox", "0 0 " + w.toFixed(2) + " " + h.toFixed(2));

      let idx = 0;
      for (const win of ev.wins) {
        const pts = [];
        for (const [row, col] of win.cells) {
          const node = cellAt(col, row);
          if (!node) continue;
          node.classList.add("wcell");
          reels[col].classList.add("win");
          pts.push(relPoint(node, svgRect));
        }
        const pl = document.createElementNS(NS, "polyline");
        pl.setAttribute("points", pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
        pl.setAttribute("class", instant ? "mlwinline show" : "mlwinline anim");
        pl.style.stroke = LINE_COLORS[win.line] || "#f2c14e";
        if (!instant) pl.style.animationDelay = Math.min(idx, 8) * 190 + "ms";
        overlay.appendChild(pl);
        idx++;
      }

      for (const [row, col] of ev.bonusCells) {
        const node = cellAt(col, row);
        if (!node) continue;
        node.classList.add("wcell-scatter");
        const p = relPoint(node, svgRect);
        const nodeRect = node.getBoundingClientRect();
        const circle = document.createElementNS(NS, "circle");
        const rr = Math.max(6, Math.min(nodeRect.width, nodeRect.height) * 0.4);
        circle.setAttribute("cx", p[0].toFixed(1));
        circle.setAttribute("cy", p[1].toFixed(1));
        circle.setAttribute("r", rr.toFixed(1));
        circle.setAttribute("class", instant ? "mlring show" : "mlring anim");
        if (!instant) circle.style.animationDelay = Math.min(idx, 8) * 190 + "ms";
        overlay.appendChild(circle);
        idx++;
      }
    }

    function redrawOverlay() {
      if (!lastEv || !overlay.childNodes.length) return;
      const keep = lastEv;
      const hadWin = !!keep.wins.length || !!keep.bonusCells.length;
      if (!hadWin) return;
      for (const r of reels) r.classList.remove("win");
      for (const s of strips) {
        for (const c of Array.from(s.children)) c.classList.remove("wcell", "wcell-scatter");
      }
      renderWins(keep, true);
    }

    let raf = 0;
    function scheduleRedraw() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; redrawOverlay(); });
    }
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleRedraw());
      ro.observe(reelsEl);
    }
    window.addEventListener("resize", scheduleRedraw);
    const pollId = setInterval(() => {
      if (!lastEv) return;
      const r = overlay.getBoundingClientRect();
      if (Math.abs(r.width - drawnW) > 0.5 || Math.abs(r.height - drawnH) > 0.5) scheduleRedraw();
    }, 320);

    /* ---------------- the wheel round ---------------- */

    /* park the disc back at zero with no transition, so the next spin always
       leaves from a known angle however the last one ended */
    function resetWheel() {
      for (const s of segs) s.classList.remove("on");
      disc.style.transition = "none";
      disc.style.transform = "rotate(0deg)";
      wheelOutEl.innerHTML = "";
      wheelOutEl.className = "whwheel-out";
    }

    function hideWheel(immediate) {
      if (wheelEl.hidden) return;
      wheelEl.classList.remove("in");
      if (immediate) { wheelEl.hidden = true; resetWheel(); return; }
      setTimeout(() => { wheelEl.hidden = true; resetWheel(); }, 320);
    }

    /* the whole bonus round: drop the wheel over the cabinet, spin it to the
       segment the maths already chose, read the result out, pay, clear.
       Returns the moment the player is free to act again (the payout itself is
       applied by main.js from play()'s multiplier, as with every machine). */
    async function runWheel(spin, perLine, activeLines) {
      const w = spin.wheel;
      resetWheel();
      wheelEl.hidden = false;
      void wheelEl.offsetWidth;
      wheelEl.classList.add("in");
      const n = spin.ev.bonusCount;
      wheelOutEl.textContent = n + (n === 1 ? " WHEEL \u2014 SPINNING\u2026" : " WHEELS \u2014 SPINNING\u2026");
      sfx.spin(WHEEL_MS);
      toast(el("span", { class: "spr-row" },
        document.createTextNode(n + " WHEEL SCATTERS \u2014 "),
        symIcon(BONUS),
        document.createTextNode(" up to \u00D725 your stake")), "gold", 2600);
      await sleep(520);

      /* land segment `index` under the 12 o'clock pointer: the disc turns to
         -(its mid angle) plus a few whole turns so the spin has some travel */
      const turns = 4 + Math.floor(Math.random() * 2);
      const stop = turns * 360 - (w.index * SEG_ANGLE + SEG_ANGLE / 2);
      disc.style.transition = "transform " + WHEEL_MS + "ms " + WHEEL_EASE;
      disc.style.transform = "rotate(" + stop + "deg)";
      await sleep(WHEEL_MS + 90);

      const seg = segs[w.index];
      if (seg) seg.classList.add("on");
      wheelEl.classList.add("landed");
      sfx.cash(w.index >= 3 ? 4 : w.index >= 2 ? 3 : 2);
      app.confetti(w.index >= 3 ? 70 : 40);
      const money = round2(w.units * perLine);
      wheelOutEl.innerHTML = "&#10003; <b>\u00D7" + w.value + "</b> \u2014 " + fmt(money) + " on " + activeLines + (activeLines === 1 ? " line" : " lines");
      wheelOutEl.className = "whwheel-out win";
      if (navigator.vibrate) { try { navigator.vibrate([0, 30, 60, 30]); } catch (e) { /* blocked */ } }
      await sleep(1500);
      wheelEl.classList.remove("landed");
      hideWheel(false);
      await sleep(340);
    }

    function detailFor(ev) {
      clear(detailEl);
      const bits = [];
      for (const win of ev.wins.slice(0, 5)) {
        bits.push(el("span", { class: "mlbit" },
          document.createTextNode("L" + (win.line + 1) + " "),
          symIcon(symOf(win.symId)),
          el("span", { html: "\u00D7" + win.run + " <b>" + win.pay + "</b>" })
        ));
      }
      if (ev.wins.length > 5) bits.push(el("span", { text: "+" + (ev.wins.length - 5) + " more" }));
      if (ev.bonusCount >= BONUS_TRIGGER) {
        bits.push(el("span", { class: "mlbit" },
          symIcon(BONUS),
          el("span", { html: "\u00D7" + ev.bonusCount + " <b>WHEELS</b>" })
        ));
      }
      bits.forEach((b, i) => {
        if (i) detailEl.appendChild(document.createTextNode(" \u00B7 "));
        detailEl.appendChild(b);
      });
    }

    function resetLive() {
      resultEl.className = "slot-result ml-result";
      resultEl.textContent = "";
      detailEl.textContent = "";
      badgeEl.hidden = true;
    }

    function clearGuideLines() {
      if (lineFlash) { clearTimeout(lineFlash); lineFlash = null; }
      for (const g of lineGuides) if (g.parentNode === overlay) overlay.removeChild(g);
      lineGuides = [];
    }

    function guideLine(li) {
      const svgRect = overlay.getBoundingClientRect();
      if (svgRect.width < 2 || svgRect.height < 2) return null;
      overlay.setAttribute("viewBox", "0 0 " + svgRect.width.toFixed(2) + " " + svgRect.height.toFixed(2));
      const pts = [];
      for (let c = 0; c < REELS; c++) {
        const node = cellAt(c, LINES[li][c]);
        if (!node) return null;
        pts.push(relPoint(node, svgRect));
      }
      const pl = document.createElementNS(NS, "polyline");
      pl.setAttribute("points", pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
      pl.setAttribute("class", "mlwinline fadeline");
      pl.style.stroke = LINE_COLORS[li] || "#f2c14e";
      pl.style.animationDelay = li * 30 + "ms";
      overlay.appendChild(pl);
      return pl;
    }

    /* flash the selected lines as a quick trace whenever the count changes, so
       it is obvious that "1" really does mean the middle row only */
    function showGuideLines(n) {
      clearGuideLines();
      if (reels.some((r) => r.classList.contains("spinning"))) return;
      if (lastEv && (lastEv.wins.length || lastEv.bonusCells.length)) return;
      const guides = [];
      for (let li = 0; li < n; li++) {
        const pl = guideLine(li);
        if (pl) guides.push(pl);
      }
      if (!guides.length) return;
      lineGuides = guides;
      lineFlash = setTimeout(clearGuideLines, 1600);
    }

    function openPayTable() {
      const bank = jackpotBankView(GAME_ID);
      const gm = gridMap(REELS, ROWS, { cell: PG_CELL, gap: PG_GAP });
      const polys = LINES.map((path, li) => {
        const pl = svgEl("polyline", {
          points: path.map((r, c) => gm.px(c) + "," + gm.py(r)).join(" "),
          fill: "none", stroke: LINE_COLORS[li], class: "ic-line",
        });
        gm.svg.appendChild(pl);
        return pl;
      });
      const capEl = el("div", { class: "ic-cap" });

      function select(li) {
        polys.forEach((pl, i) => {
          pl.classList.toggle("dim", li !== -1 && li !== i);
          pl.classList.toggle("sel", li === i);
        });
        markCells(gm.cells, li < 0 ? [] : LINES[li].map((r, c) => [r, c]), li < 0 ? null : LINE_COLORS[li]);
        capEl.innerHTML = li < 0
          ? "All twenty-five paylines. Tap a number to trace one on its own \u2014 the lit cells are the drums it covers."
          : "Line <b>" + (li + 1) + "</b> of 25 \u2014 " + lineShape(li) + ".";
      }

      const lg = legend(
        LINES.map((_, li) => ({ label: String(li + 1), title: lineShape(li), value: li, color: LINE_COLORS[li] })),
        (li) => select(li),
        { label: "ALL 25", value: -1 },
        -1
      );

      const per = Math.max(0, Math.floor(Number(app.bet) || 0));
      const live = lines;

      const body = el("div", { class: "ic" },
        el("div", { class: "ic-top" },
          el("div", { class: "ic-map" }, gm.node, capEl, lg.node),
          el("div", { class: "ic-col" },
            sec("How a line wins",
              ul([
                "Match <b>3, 4 or 5</b> of the same symbol along a live payline, starting on the <b>leftmost drum</b>.",
                "The run stops at the first drum that doesn\u2019t match \u2014 5 in a row pays the 5 value, 3 in a row pays the 3 value.",
                spriteHtml("wild") + " <b>Wild</b> stands on <b>every drum</b> and substitutes for anything, so a line can start with one; five wilds pays the wild row.",
                "Every payline is paid separately, so one spin can win on many lines at once.",
              ])
            ),
            sec("Only your lines are live",
              ul([
                "Pick <b>1, 5, 10, 15 or 25</b> lines. They switch on in the numbered order shown on the map \u2014 line 1 is the middle row, then the flat top and bottom, then the V shapes, then the zig-zags.",
                "A payline you haven\u2019t switched on <b>cannot win</b>, even if its symbols match.",
                "Total cost per spin is <b>bet \u00D7 lines</b>. Line pays are <b>per line bet</b>; the wheel pays <b>\u00D7 total bet</b>.",
                "You currently have <b>" + live + "</b> " + (live === 1 ? "line" : "lines") + " live at <b>" + fmt(per) + "</b> per line, so a spin costs <b>" + fmt(per * live) + "</b>.",
              ])
            )
          )
        ),
        sec("The wheel",
          ul([
            "<b>Three or more</b> " + spriteHtml("wheel") + " anywhere on the grid \u2014 no payline needed \u2014 drop the bonus wheel over the cabinet.",
            "It is an honest wheel: five equal segments, so each of <b>\u00D73, \u00D75, \u00D710, \u00D715, \u00D725</b> is equally likely. It pays that multiple of your <b>total stake</b>.",
            "It comes up about <b>once every 143 spins</b>, and nothing you buy or level up makes it more or less likely \u2014 luck lifts the line pays, never the wheel.",
            "Because the wheel fires so often it pays on its own: there is <b>no separate scatter prize</b>. Three wheels is not a near miss \u2014 it is the bonus.",
          ])
        ),
        sec("The jackpot (this machine's own)",
          ul([
            "<b>Three " + spriteHtml("jackpot") + " anywhere on the grid</b> \u2014 no payline needed \u2014 takes <b>this machine's progressive jackpot</b>, on top of whatever the spin already paid. A " + spriteHtml("wild") + " wild does <b>not</b> stand in for one.",
            "The sign pays nothing on a payline: like the " + spriteHtml("wheel") + " it is a scatter, and a line that lands on one is dead from that drum on. It <b>is</b> a real symbol on every one of the fifteen cells, so you can watch it go past in the spin and see it land, ringed in red on the drum.",
            "<b>The Wheelhouse keeps its own bank.</b> Lucky Sevens, the first machine, has no jackpot at all. Fortune Lines has a pot of its own, and a sign only ever empties the cabinet it lands on \u2014 here the trigger is about one spin in <b>4,500</b>.",
            "This bank is fed by <b>5% of what a losing spin actually drops here</b> (the loss, never the whole stake), and only on spins that lose: one that pays you back at least your stake \u2014 a win, or a push \u2014 pays no jackpot slice at all, so neither winning nor breaking even is taxed. The house keeps half of what is fed and the other half (2.5% of the loss) climbs this cabinet's meter, so the pot hands back 1.6 points of the machine's long-run return and can never push it past 100%.",
            "It is worth <b>tens of times an average bet</b> when it goes and is <b>not</b> capped by the table maximum \u2014 it is the players' own money, paid on top of everything else." +
              (bank.hits > 0 || bank.best > 0
                ? " This bank has been emptied <b>" + bank.hits + "</b> time" + (bank.hits === 1 ? "" : "s") + " in this run" + (bank.best > 0 ? ", the biggest <b>" + fmt(bank.best) + "</b>" : "") + "."
                : ""),
          ])
        ),
        sec("Pays per line bet",
          payChips([
            ...PAYROW.slice().reverse().map((s) => ({ sprite: s.sprite, glyph: s.glyph, main: s.pay[3] + " \u00B7 " + s.pay[4] + " \u00B7 " + s.pay[5] })),
            { cls: "pot", sprite: JACKPOT.sprite, glyph: JACKPOT.glyph, main: "POT", note: "3 SIGNS ANYWHERE \u2014 NO LINE PAY" },
          ]),
          note(spriteHtml("wheel") + " <b>3 or more anywhere \u2192 spin the wheel</b> for \u00D73\u2013\u00D725 of your total stake. " +
            "The wheel is worth about <b>8%</b> of this machine\u2019s return and the wheels are the same odds however many lines you have live. " +
            "Three " + spriteHtml("jackpot") + " signs anywhere pay nothing on a line but empty <b>this machine's own</b> progressive pot \u2014 about one spin in <b>4,522</b>.")
        )
      );

      openInfo("Wheelhouse \u2014 Pay Table", body);
    }

    function setLines(n) {
      lines = Math.max(1, Math.min(MAX_LINES, n));
      for (const b of lineBtns) b.classList.toggle("on", Number(b.dataset.lines) === lines);
      subEl.textContent = lines + (lines === 1 ? " PAYLINE" : " PAYLINES");
      if (app.refreshBet) app.refreshBet();
      showGuideLines(lines);
    }

    showGrid([
      ["cherry", "lemon", "gem", "orange", "seven"],
      ["lemon", "wild", "cherry", "bell", "crown"],
      ["orange", "coin", "bell", "cherry", "gem"],
    ]);

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const luck = app.effects().luck;
      const activeLines = lines;
      const spin = resolveSpin(Math.random, luck, activeLines, { rig: app.cheat });
      const perLine = round2(stake);
      fastUntil = 0;

      clearFx();
      resetLive();
      if (!instant) resultEl.textContent = "Spinning\u2026";

      if (!instant) {
        const durs = reels.map((_, k) => 680 + k * 440);
        const counts = reels.map((_, k) => 14 + k * 4);
        for (const r of reels) { r.classList.add("spinning"); r.classList.remove("landed"); }
        sfx.spin(durs[durs.length - 1]);
        const proms = reels.map((reel, k) => scrollReel(k, spin.grid, durs[k], counts[k], luck));
        for (let k = 0; k < reels.length; k++) {
          await proms[k];
          landReel(k, k === reels.length - 1);
        }
        for (const r of reels) r.classList.remove("spinning");
      } else {
        showGrid(spin.grid);
      }

      renderWins(spin.ev, instant);

      const baseWin = round2(spinWinUnits(spin.ev) * perLine);
      const jackpotHit = !!spin.jackpot;
      if (spin.ev.wins.length || spin.ev.bonusCount >= BONUS_TRIGGER) {
        resultEl.className = "slot-result ml-result win";
        resultEl.textContent = "WIN " + fmt(baseWin) +
          (spin.ev.wins.length > 1 ? "  \u00B7  " + spin.ev.wins.length + " LINES" : "");
      } else if (!jackpotHit) {
        resultEl.className = "slot-result ml-result lose";
        resultEl.textContent = "No win on " + activeLines + (activeLines === 1 ? " line" : " lines");
      }
      detailFor(spin.ev);

      if (spin.wheel) {
        if (!instant) {
          await wait(420);
          await runWheel(spin, perLine, activeLines);
        }
        const total = round2(spin.totalUnits * perLine);
        resultEl.className = "slot-result ml-result win";
        resultEl.textContent = "WHEEL \u00D7" + spin.wheel.value + "  \u00B7  " + fmt(total);
        badgeEl.hidden = false;
        badgeEl.textContent = "WHEEL \u00D7" + spin.wheel.value;
        detailEl.innerHTML = spin.ev.bonusCount + " wheel scatters \u00B7 " + fmt(round2(spin.wheelUnits * perLine)) +
          " wheel + " + fmt(baseWin) + " on the reels";
      } else {
        badgeEl.hidden = true;
      }

      /* this machine's progressive: three jackpot signs anywhere on the grid take
         the pot. It is paid by main.js once play() resolves, so the figure is
         read here -- and it is tagged onto whatever the reels and the wheel
         already said. */
      if (jackpotHit) {
        if (!spin.wheel && !spin.ev.wins.length) clear(resultEl);
        resultEl.className = "slot-result ml-result win jackpot";
        resultEl.appendChild(el("span", { class: "jackpot-tag", text: "JACKPOT" }));
        resultEl.appendChild(el("span", { class: "jackpot-amt", text: fmt(jackpotPot(GAME_ID)) }));
        board.flash("JACKPOT");
        if (!instant) toast("JACKPOT! Three jackpots anywhere on the drums.", "gold", 3000);
      }

      return { multiplier: spin.multiplier, jackpot: jackpotHit };
    }

    /* the drums paint their artwork on the very first frame rather than
       flashing empty on the first spin */
    preloadSprites([...PAYROW.map((s) => s.sprite), BONUS.sprite, JACKPOT.sprite]);

    return {
      root,
      play,
      actionLabel: "SPIN",
      getBetUnits: () => lines,
      onBetChange: () => board.refresh(),
      onJackpot: () => board.flash("JACKPOT"),
      destroy() {
        board.dispose();
        if (ro) ro.disconnect();
        window.removeEventListener("resize", scheduleRedraw);
        clearInterval(pollId);
        if (raf) cancelAnimationFrame(raf);
        clearGuideLines();
        for (let i = 0; i < blurTimers.length; i++) {
          if (blurTimers[i]) { clearInterval(blurTimers[i]); blurTimers[i] = 0; }
        }
        for (let i = 0; i < settleTimers.length; i++) stopSettle(i);
        for (const r of reels) r.classList.remove("landed", "spinning");
        for (let i = 0; i < strips.length; i++) {
          clearSettle(strips[i]);
          strips[i].style.filter = "";
          strips[i].style.transform = "translateY(" + landYs[i] + "px)";
        }
        resetWheel();
      },
    };
  },
};

/* The symbols a drum blurs past while it is spinning are drawn from the SAME
   weighted table the drum itself draws its stop from (`reelWeights` in
   slots-wheel-math.js), so everything the machine really carries flashes past
   on the way: the wild, the wheel, and the jackpot sign itself, each at the
   rate its own drum gives it. It used to be a flat pick over the paying
   symbols only, which is exactly why the jackpot sign was never seen in a
   spin -- it lived in the paytable and on the meter, but never on a drum.

   The table is built ONCE per scroll and then sampled, so a strip of two
   dozen cells costs one pass over the drum, not two dozen. */
function fillerPicker(reel, luck) {
  const table = reelWeights(reel, luck);
  let total = 0;
  for (const it of table) total += it.w;
  return function pick() {
    let x = Math.random() * total;
    for (const it of table) { x -= it.w; if (x <= 0) return it.id; }
    return table[table.length - 1].id;
  };
}
