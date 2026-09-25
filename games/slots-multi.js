import { el, clear, sleep, toast, fmt } from "../ui.js";
import { stageShell, round2, SPIN_EASE_CSS, spinBlur, BLUR_TICK,
  SETTLE_MS, settleOffset, setSettleVars, beginSettle, endSettle, clearSettle } from "./common.js";
import { infoBtn, openInfo } from "./infocard.js";
import { sfx } from "../audio.js";
import {
  REELS, ROWS, LINES, MAX_LINES, SCATTER, JACKPOT, JACKPOT_ID, PAYROW, SYMBOL_BY_ID,
  resolveSpinSequence, spinWinUnits, freeSpinsFor, reelWeights,
} from "./slots-multi-math.js";
import { spriteEl, spriteHtml, preloadSprites } from "../sprites.js";
import { createLedBoard } from "./ledboard.js";
import { jackpotPot, jackpotBankView } from "../state.js";

const GAME_ID = "slots-multi";

/* Every symbol carries artwork in src/sprites/ (sprites/README.md) alongside the
   emoji `glyph` it used to be drawn with. The glyph is now the FALLBACK: if an
   image fails to load the <img> swaps itself for the emoji (src/sprites.js), so
   a partly-uploaded sprite folder degrades to the old look, not blank reels. */
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
const LINE_OPTIONS = [1, 3, 5, 9];

const LINE_COLORS = [
  "#f2c14e", "#7fe3ff", "#8bf07a", "#ff7ab8", "#b48cff",
  "#ffa24d", "#4de1c1", "#ffe94d", "#ff6b6b",
];
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
  name: "Fortune Lines",
  icon: "\u{1F340}",
  action: "SPIN",
  blurb: "Five drums, three rows, nine paylines. Pays are per line bet.",
  payoutNote: () =>
    "Land <b>3, 4 or 5</b> matching symbols from the left edge of any of your paylines. " +
    spriteHtml("wild") + " is <b>wild</b>, and pays on its own line too. " +
    spriteHtml("bonus") + " pays <b>\u00D7 total bet</b> anywhere, and <b>3 or more</b> launch up to <b>20 free spins</b>. " +
    "All pays above are <b>per line bet</b>. Base return <b>~94%</b>; the biggest line pays <b>1000\u00D7</b>.",
  minBet: 1,

  create(app) {
    let lines = MAX_LINES;
    let fastUntil = 0;

    /* The pit meter -- see src/games/ledboard.js. On this board the side
       panel's amount is per line, so the TOTAL pod is the real cost of a spin:
       per-line bet x live lines. The JACKPOT pod is THIS CABINET'S progressive
       (see src/state.js): Fortune Lines feeds its own bank on a losing spin,
       and only three jackpot signs on these fifteen cells can take it. Lucky
       Sevens and Wheelhouse keep banks of their own. */
    const board = createLedBoard([
      { label: "LINES", digits: 2, read: () => lines },
      { label: "TOTAL", digits: 6, read: () => Math.round(app.bet * lines), caption: "PER SPIN" },
      { label: "JACKPOT", digits: 7, read: () => jackpotPot(GAME_ID), jackpot: true, caption: "3 JACKPOTS ANYWHERE" },
    ]);

    const root = stageShell(
      "Fortune Lines",
      "Nine paylines across five drums. Pays are per line bet \u2014 total cost is your bet \u00D7 lines.",
      { info: infoBtn(() => openPayTable(), "PAY TABLE") },
      el("div", { class: "mline-wrap" },
        el("div", { class: "cab-row" },
          el("div", { class: "slot-cabinet mline-cab" },
            el("div", { class: "slot-marquee" },
              el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i"))),
              el("span", { class: "marquee-title", text: "FORTUNE LINES" }),
              el("span", { class: "sub", id: "mlSubEl", text: "9 PAYLINES" }),
              el("span", { class: "lights" }, ...[0, 1, 2].map(() => el("i")))
            ),
            el("div", { class: "ml-lines" },
              el("span", { class: "ml-lines-label", text: "PAYLINES" }),
              ...LINE_OPTIONS.map((n) =>
                el("button", { class: "segbtn ml-linebtn" + (n === MAX_LINES ? " on" : ""), type: "button",
                  "data-lines": n, text: String(n), onclick: () => setLines(n) })
              ),
              el("span", { class: "ml-free-badge", id: "mlBadgeEl", hidden: true, text: "" })
            ),
            el("div", { class: "reels mlreels", id: "mlReelsEl" },
              ...[0, 1, 2, 3, 4].map(() =>
                el("div", { class: "mlreel" }, el("div", { class: "reel-strip mlstrip" }))
              ),
              el("div", { class: "ml-free", id: "mlFreeEl", hidden: true, text: "" })
            ),
            el("div", { class: "slot-result ml-result", id: "mlResultEl", text: "Place your bet and pull the lever" }),
            el("div", { class: "ml-detail", id: "mlDetailEl", text: "" })
          ),
          board.node
        ),
        el("div", { class: "slot-paywrap" },
          el("div", { class: "pay-head", text: "Match 3 \u00B7 4 \u00B7 5 from the left \u2014 pays per line bet" }),
          el("div", { class: "ml-pay" },
            ...[...PAYROW].reverse().map((s) =>
              el("div", { class: "mlchip" },
                symIcon(s),
                el("span", { class: "triple", text: s.pay[3] + " \u00B7 " + s.pay[4] + " \u00B7 " + s.pay[5] })
              )
            ),
            el("div", { class: "mlchip scat" },
              symIcon(SCATTER),
              el("span", { class: "triple", text: SCATTER.pay[3] + " \u00B7 " + SCATTER.pay[4] + " \u00B7 " + SCATTER.pay[5] }),
              el("span", { class: "note", text: "\u00D7 total bet" })
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

    const reelsEl = root.querySelector("#mlReelsEl");
    const overlay = document.createElementNS(NS, "svg");
    overlay.setAttribute("class", "mloverlay");
    overlay.setAttribute("preserveAspectRatio", "none");
    reelsEl.appendChild(overlay);
    const resultEl = root.querySelector("#mlResultEl");
    const detailEl = root.querySelector("#mlDetailEl");
    const badgeEl = root.querySelector("#mlBadgeEl");
    const freeEl = root.querySelector("#mlFreeEl");
    const subEl = root.querySelector("#mlSubEl");
    const reels = Array.from(root.querySelectorAll(".mlreel"));
    const strips = reels.map((r) => r.querySelector(".mlstrip"));
    const lineBtns = Array.from(root.querySelectorAll(".ml-linebtn"));
    let lineFlash = null;
    let lineGuides = [];

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
        const cab = root.querySelector(".mline-cab");
        if (cab) {
          cab.classList.remove("thump");
          void cab.offsetWidth;
          cab.classList.add("thump");
          setTimeout(() => cab.classList.remove("thump"), 330);
        }
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
          node.classList.add("wcell");
          reels[col].classList.add("win");
          pts.push(relPoint(node, svgRect));
        }
        const pl = document.createElementNS(NS, "polyline");
        pl.setAttribute("points", pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
        pl.setAttribute("class", instant ? "mlwinline show" : "mlwinline anim");
        if (!instant) pl.style.animationDelay = idx * 250 + "ms";
        overlay.appendChild(pl);
        idx++;
      }

      for (const [row, col] of ev.scatterCells) {
        const node = cellAt(col, row);
        node.classList.add("wcell-scatter");
        const p = relPoint(node, svgRect);
        const nodeRect = node.getBoundingClientRect();
        const circle = document.createElementNS(NS, "circle");
        const rr = Math.max(6, Math.min(nodeRect.width, nodeRect.height) * 0.4);
        circle.setAttribute("cx", p[0].toFixed(1));
        circle.setAttribute("cy", p[1].toFixed(1));
        circle.setAttribute("r", rr.toFixed(1));
        circle.setAttribute("class", instant ? "mlring show" : "mlring anim");
        if (!instant) circle.style.animationDelay = idx * 250 + "ms";
        overlay.appendChild(circle);
        idx++;
      }
    }

    function redrawOverlay() {
      if (!lastEv || !overlay.childNodes.length) return;
      const keep = lastEv;
      const hadWin = !!keep.wins.length || !!keep.scatterCells.length;
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
    root.__cleanup = () => {
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
    };

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
      if (ev.scatterCount >= 3) {
        bits.push(el("span", { class: "mlbit" },
          symIcon(SCATTER),
          el("span", { html: "\u00D7" + ev.scatterCount + " <b>" + ev.scatterPay + "\u00D7 total</b>" })
        ));
      }
      if (ev.wins.length > 5) bits.push(el("span", { text: "+" + (ev.wins.length - 5) + " more" }));
      bits.forEach((b, i) => {
        if (i) detailEl.appendChild(document.createTextNode(" \u00B7 "));
        detailEl.appendChild(b);
      });
    }

    function resetLive() {
      resultEl.className = "slot-result ml-result";
      resultEl.textContent = "";
      detailEl.textContent = "";
      freeEl.hidden = true;
      badgeEl.hidden = true;
    }

    function showBanner(text) {
      freeEl.hidden = false;
      freeEl.textContent = text;
      void freeEl.offsetWidth;
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
      pl.style.animationDelay = li * 45 + "ms";
      overlay.appendChild(pl);
      return pl;
    }

    function showGuideLines(n) {
      clearGuideLines();
      if (reels.some((r) => r.classList.contains("spinning"))) return;
      if (lastEv && (lastEv.wins.length || lastEv.scatterCells.length)) return;
      const guides = [];
      for (let li = 0; li < n; li++) {
        const pl = guideLine(li);
        if (pl) guides.push(pl);
      }
      if (!guides.length) return;
      lineGuides = guides;
      lineFlash = setTimeout(clearGuideLines, 1500);
    }

    function openPayTable() {
      const bank = jackpotBankView(GAME_ID);
      const vw = REELS * PG_CELL + (REELS - 1) * PG_GAP;
      const vh = ROWS * PG_CELL + (ROWS - 1) * PG_GAP;
      const px = (c) => c * (PG_CELL + PG_GAP) + PG_CELL / 2;
      const py = (r) => r * (PG_CELL + PG_GAP) + PG_CELL / 2;

      const mapEl = el("div", { class: "ic-grid" });
      const cellEls = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < REELS; c++) {
          const cell = el("div", { class: "ic-cell" });
          row.push(cell);
          mapEl.appendChild(cell);
        }
        cellEls.push(row);
      }

      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "ic-svg");
      svg.setAttribute("viewBox", "0 0 " + vw + " " + vh);
      const polys = LINES.map((path, li) => {
        const pl = document.createElementNS(NS, "polyline");
        pl.setAttribute("points", path.map((r, c) => px(c) + "," + py(r)).join(" "));
        pl.setAttribute("fill", "none");
        pl.setAttribute("stroke", LINE_COLORS[li]);
        pl.setAttribute("class", "ic-line");
        svg.appendChild(pl);
        return pl;
      });
      mapEl.appendChild(svg);

      const capEl = el("div", { class: "ic-cap" });
      const allBtn = el("button", { class: "ic-lbtn all", type: "button", text: "ALL 9", onclick: () => select(-1) });
      const legend = el("div", { class: "ic-legend" }, allBtn);
      const lbtns = LINES.map((_, li) =>
        el("button", { class: "ic-lbtn", type: "button", text: String(li + 1), title: lineShape(li),
          style: "--lc:" + LINE_COLORS[li], onclick: () => select(li) })
      );
      for (const b of lbtns) legend.appendChild(b);

      let sel = -1;
      function select(li) {
        sel = li;
        polys.forEach((pl, i) => {
          pl.classList.toggle("dim", sel !== -1 && sel !== i);
          pl.classList.toggle("sel", sel === i);
        });
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < REELS; c++) {
            cellEls[r][c].classList.remove("lit");
            cellEls[r][c].style.removeProperty("--lc");
          }
        }
        if (sel >= 0) {
          LINES[sel].forEach((r, c) => {
            cellEls[r][c].classList.add("lit");
            cellEls[r][c].style.setProperty("--lc", LINE_COLORS[sel]);
          });
        }
        capEl.style.color = sel === -1 ? "" : LINE_COLORS[sel];
        capEl.innerHTML = sel === -1
          ? "All nine paylines. Tap a number to trace one on its own \u2014 the lit cells are the drums it covers."
          : "Line <b>" + (sel + 1) + "</b> of 9 \u2014 " + lineShape(sel) + ".";
        lbtns.forEach((b, i) => b.classList.toggle("on", i === sel));
        allBtn.classList.toggle("on", sel === -1);
      }
      select(-1);

      const per = Math.max(0, Math.floor(Number(app.bet) || 0));
      const live = lines;
      const nowLi = el("li", { html:
        "You currently have <b>" + live + "</b> " + (live === 1 ? "line" : "lines") + " live at <b>" + fmt(per) +
        "</b> per line, so a spin costs <b>" + fmt(per * live) + "</b>." });

      const example = (cells, note) => el("div", { class: "ic-ex" },
        el("div", { class: "ic-excells" }, ...cells.map((id) =>
          id === ""
            ? el("div", { class: "ic-excell blank" })
            : el("div", { class: "ic-excell win" }, symIcon(symOf(id)))
        )),
        el("div", { class: "ic-exnote", html: note })
      );

      const payChips = el("div", { class: "ml-pay" },
        ...[...PAYROW].reverse().map((s) =>
          el("div", { class: "mlchip" },
            symIcon(s),
            el("span", { class: "triple", text: s.pay[3] + " \u00B7 " + s.pay[4] + " \u00B7 " + s.pay[5] })
          )
        ),
        el("div", { class: "mlchip scat" },
          symIcon(SCATTER),
          el("span", { class: "triple", text: SCATTER.pay[3] + " \u00B7 " + SCATTER.pay[4] + " \u00B7 " + SCATTER.pay[5] }),
          el("span", { class: "note", text: "\u00D7 total bet" })
        ),
        el("div", { class: "mlchip pot" },
          symIcon(JACKPOT),
          el("span", { class: "triple", text: "POT" }),
          el("span", { class: "note", text: "3 SIGNS ANYWHERE \u2014 NO LINE PAY" })
        )
      );

      const body = el("div", { class: "ic" },
        el("div", { class: "ic-top" },
          el("div", { class: "ic-map" }, mapEl, capEl, legend),
          el("div", { class: "ic-col" },
            el("div", { class: "ic-sec" },
              el("h3", { text: "How a line wins" }),
              el("ul", {},
                el("li", { html: "Match <b>3, 4 or 5</b> of the same symbol along a live payline, starting on the <b>leftmost drum</b>." }),
                el("li", { html: "The run stops at the first drum that doesn\u2019t match \u2014 5 in a row pays the 5 value, 3 in a row pays the 3 value." }),
                el("li", { html: spriteHtml("wild") + " <b>Wild</b> substitutes for any symbol, so a line can start with one; a line of nothing but wilds pays the wild row." }),
                el("li", { html: "Each payline is paid separately, so a single spin can win on several lines at once." }),
                el("li", { html: spriteHtml("bonus") + " <b>Scatter</b> ignores the paylines \u2014 3 or more anywhere on the drums pay <b>\u00D7 total bet</b> and launch free spins." })
              )
            ),
            el("div", { class: "ic-sec" },
              el("h3", { text: "Only your lines are live" }),
              el("ul", {},
                el("li", { html: "Pick <b>1, 3, 5 or 9</b> lines. Lines switch on in order: <b>1</b> middle row, <b>2</b> top row, <b>3</b> bottom row, <b>4\u20135</b> the two Vs, <b>6\u20139</b> the four zig-zags." }),
                el("li", { html: "A payline you haven\u2019t switched on <b>cannot win</b>, even if its symbols match." }),
                el("li", { html: "Total cost per spin is <b>bet \u00D7 lines</b>. Line pays are <b>per line bet</b>; the scatter pays <b>\u00D7 total bet</b>." }),
                nowLi
              )
            )
          )
        ),
        el("div", { class: "ic-sec" },
          el("h3", { text: "What counts as a win" }),
          el("div", { class: "ic-examples" },
            example(["cherry", "cherry", "cherry", "lemon", "lemon"],
              "3 cherries from the left = <b>8</b> per line bet. The lemon on drum 4 breaks the run, so it can\u2019t extend it."),
            example(["wild", "cherry", "cherry", "cherry", "lemon"],
              "The wild fills in \u2014 this line reads as <b>4 cherries</b> = <b>25</b> per line bet."),
            example(["cherry", "cherry", "lemon", "cherry", "cherry"],
              "No win. The match has to start on drum 1, and the lemon on drum 3 stops it at 2."),
            example(["scatter", "", "", "scatter", "scatter"],
              "3 or more " + spriteHtml("bonus") + " anywhere at all pay <b>\u00D7 total bet</b> \u2014 no payline needed \u2014 and award free spins.")
          )
        ),
        el("div", { class: "ic-sec" },
          el("h3", { text: "The jackpot (this machine's own)" }),
          el("ul", {},
            el("li", { html: "<b>Three " + spriteHtml("jackpot") + " anywhere on the grid</b> \u2014 no payline needed \u2014 takes <b>this machine's progressive jackpot</b>, on top of whatever the spin already paid. A " + spriteHtml("wild") + " wild does <b>not</b> stand in for one." }),
            el("li", { html: "The sign pays nothing on a payline: like the " + spriteHtml("bonus") + " scatter it just breaks the line it lands on \u2014 the pot is its whole job. It <b>is</b> a real symbol on every one of the fifteen cells, so you can watch it go past in the spin and see it land, ringed in red on the drum." }),
            el("li", { html: "<b>Fortune Lines keeps its own bank.</b> Lucky Sevens, the first machine, has no jackpot at all. The Wheelhouse has a pot of its own, and a sign only ever empties the cabinet it lands on \u2014 here the trigger is about one spin in <b>4,100</b>." }),
            el("li", { html: "This bank is fed by <b>5% of what a losing spin actually drops here</b> (the loss, never the whole stake), and only on spins that lose: one that pays you back at least your stake \u2014 a win, or a push \u2014 pays no jackpot slice at all, so neither winning nor breaking even is taxed. The house keeps half of what is fed and the other half (2.5% of the loss) climbs this cabinet's meter, so the pot hands back 1.9 points of the machine's long-run return and can never push it past 100%. A separate bank only grows as fast as its own machine is played, so a pot you spread your time across climbs more slowly than the old shared meter." }),
            el("li", { html: "It is worth <b>tens of times an average bet</b> when it goes and is <b>not</b> capped by the table maximum \u2014 it is the players' own money, paid on top of everything else." +
              (bank.hits > 0 || bank.best > 0
                ? " This bank has been emptied <b>" + bank.hits + "</b> time" + (bank.hits === 1 ? "" : "s") + " in this run" + (bank.best > 0 ? ", the biggest <b>" + fmt(bank.best) + "</b>" : "") + "."
                : "") })
          )
        ),
        el("div", { class: "ic-sec" },
          el("h3", { text: "Pays per line bet" }),
          payChips,
          el("div", { class: "ic-fs", html:
            spriteHtml("bonus") + " <b>3</b> scatters \u2192 <b>10</b> free spins \u00B7 <b>4</b> \u2192 <b>15</b> \u00B7 <b>5</b> \u2192 <b>20</b>. " +
            "Free spins run on the same paylines and can retrigger. Three " + spriteHtml("jackpot") + " signs anywhere pay nothing on a line but empty <b>this machine's own</b> progressive pot \u2014 about one spin in <b>4,091</b>." })
        )
      );

      openInfo("Fortune Lines \u2014 Pay Table", body);
    }

    function setLines(n) {
      lines = Math.max(1, Math.min(MAX_LINES, n));
      for (const b of lineBtns) b.classList.toggle("on", Number(b.dataset.lines) === lines);
      subEl.textContent = lines + (lines === 1 ? " PAYLINE" : " PAYLINES");
      if (app.refreshBet) app.refreshBet();
      showGuideLines(lines);
    }

    showGrid([
      ["cherry", "grape", "gem", "lemon", "star"],
      ["lemon", "bell", "cherry", "watermelon", "gem"],
      ["grape", "seven", "watermelon", "cherry", "bell"],
    ]);

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const luck = app.effects().luck;
      const activeLines = lines;
      const seq = resolveSpinSequence(Math.random, luck, activeLines, { rig: app.cheat });
      const spins = seq.spins;
      const perLine = round2(stake);
      const totalSpins = spins.length - 1;
      let units = 0;
      let winLines = 0;
      fastUntil = 0;

      clearFx();
      resetLive();
      if (!instant) resultEl.textContent = "Spinning\u2026";

      for (let i = 0; i < spins.length; i++) {
        const spin = spins[i];
        const isBase = i === 0;
        const dur = isBase ? 680 : 380;
        const gap = isBase ? 440 : 240;
        const cnt = isBase ? 14 : 9;

        if (!instant) {
          const durs = reels.map((_, k) => dur + k * gap);
          const counts = reels.map((_, k) => Math.round(cnt + k * 4));
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

        units += spinWinUnits(spin.ev, activeLines);
        winLines += spin.ev.wins.length;
        renderWins(spin.ev, instant);

        const credits = round2(units * perLine);
        const more = i > 0 ? freeSpinsFor(spin.ev.scatterCount) : 0;

        if (isBase) {
          if (spin.ev.wins.length || spin.ev.scatterCount >= 3) {
            resultEl.className = "slot-result ml-result win";
            resultEl.textContent = "WIN " + fmt(round2(spinWinUnits(spin.ev, activeLines) * perLine)) +
              (spin.ev.wins.length > 1 ? "  \u00B7  " + spin.ev.wins.length + " LINES" : "");
          } else {
            resultEl.className = "slot-result ml-result lose";
            resultEl.textContent = "No win on " + activeLines + (activeLines === 1 ? " line" : " lines");
          }
          detailFor(spin.ev);
        } else {
          badgeEl.hidden = false;
          badgeEl.textContent = "FREE SPIN " + i + " / " + totalSpins;
          resultEl.className = "slot-result ml-result " + (spinWinUnits(spin.ev, activeLines) > 0 ? "win" : "lose");
          resultEl.textContent = "FREE SPIN " + i + " / " + totalSpins + "  \u00B7  " + fmt(credits) + " total";
          detailFor(spin.ev);
        }

        if (seq.freeAwarded > 0 && isBase && !instant) {
          showBanner(seq.freeAwarded + " FREE SPINS");
          toast(el("span", { class: "spr-row" },
            document.createTextNode(seq.freeAwarded + " FREE SPINS \u2014 "),
            symIcon(SCATTER),
            document.createTextNode(" pays \u00D7 total bet")), "gold", 3200);
          await wait(1250);
          freeEl.hidden = true;
        } else if (more && !instant) {
          showBanner("+" + more + " MORE");
          await wait(900);
          freeEl.hidden = true;
        }

        if (!instant) await wait(isBase ? 620 : 280);
      }

      if (totalSpins > 0) {
        const total = round2(units * perLine);
        resultEl.className = "slot-result ml-result " + (total > 0 ? "win" : "lose");
        resultEl.textContent = total > 0
          ? "TOTAL WIN " + fmt(total) + "  \u00B7  " + totalSpins + (totalSpins === 1 ? " FREE SPIN" : " FREE SPINS")
          : "Free spins paid nothing";
        detailEl.innerHTML = totalSpins + (totalSpins === 1 ? " free spin" : " free spins") + " \u00B7 " + winLines + " line wins";
        badgeEl.hidden = true;
      } else if (instant) {
        const total = round2(units * perLine);
        if (units > 0) {
          resultEl.className = "slot-result ml-result win";
          resultEl.textContent = "WIN " + fmt(total);
        }
      }

      const jackpotHit = !!seq.jackpot;
      if (jackpotHit) {
        if (!units) clear(resultEl);
        resultEl.className = "slot-result ml-result win jackpot";
        resultEl.appendChild(el("span", { class: "jackpot-tag", text: "JACKPOT" }));
        /* main.js takes the pot once play() resolves, so read it here */
        resultEl.appendChild(el("span", { class: "jackpot-amt", text: fmt(jackpotPot(GAME_ID)) }));
        board.flash("JACKPOT");
        if (!instant) toast("JACKPOT! Three jackpots anywhere on the drums.", "gold", 3000);
      }

      return { multiplier: seq.multiplier, jackpot: jackpotHit };
    }

    /* the drums paint their artwork on the very first frame rather than
       flashing empty on the first spin */
    preloadSprites(PAYROW.map((s) => s.sprite).concat([SCATTER.sprite, JACKPOT.sprite]));

    return {
      root,
      play,
      actionLabel: "SPIN",
      getBetUnits: () => lines,
      onBetChange: () => board.refresh(),
      onJackpot: () => board.flash("JACKPOT"),
      destroy() {
        board.dispose();
        if (root.__cleanup) root.__cleanup();
      },
    };
  },
};

/* The symbols a drum blurs past while it is spinning are drawn from the SAME
   weighted table the drum itself draws its stop from (`reelWeights` in
   slots-multi-math.js), so everything the machine really carries flashes past
   on the way: the wild, the scatter, and the jackpot sign itself, each at the
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
