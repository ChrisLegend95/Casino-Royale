import { el, clear, fmt } from "../ui.js";
import { stageShell, clamp } from "./common.js";
import { infoBtn, openInfo, sec, ul, note } from "./infocard.js";
import { state, saveState } from "../state.js";
import { sfx } from "../audio.js";

/* =========================================================
   Ghost Muncher — one procedurally generated maze per play.
   Clear every pellet to beat the level and collect 35% of
   the jackpot (the jackpot is a bet multiplier that grows
   by a quarter-multiple every play it survives).
   ========================================================= */

const COLS = 15;
const ROWS = 11;
const WIN_SHARE = 0.35;
const POT_BASE = 5;
const POT_STEP = 0.25;
const POT_CAP = 14;
const LIVES = 3;
const TIME_LIMIT = 90;
const PAC_STEP = 380;
const GHOST_STEP = 430;
const GLIDE_FRAC = 0.5;
const FRIGHT_TIME = 6.5;

const UP = [0, -1], DOWN = [0, 1], LEFT = [-1, 0], RIGHT = [1, 0];
const DIR_LIST = [UP, DOWN, LEFT, RIGHT];
// Arcade ghosts break ties in this order (up, left, down, right) - it's what makes them loop predictably.
const CHOICE_ORDER = [UP, LEFT, DOWN, RIGHT];
// The classic scatter/chase rhythm. Ghosts peel off to their home corner, then hunt again.
const MODE_PLAN = [
  ["scatter", 6], ["chase", 14],
  ["scatter", 6], ["chase", 14],
  ["scatter", 5], ["chase", Infinity],
];
const PERSONAS = ["blinky", "pinky", "inky", "clyde"];
// straight speed multipliers (bigger = covers a tile in less time); Blinky leads, Clyde dawdles
const PERSONA_SPEED = { blinky: 1.06, pinky: 1.0, inky: 1.0, clyde: 0.92 };
// Blinky only speeds up "Cruise Elroy" style once most of the maze is eaten
const ELROY_AT = 0.45, ELROY_HARD_AT = 0.2;

const KEYMAP = {
  ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
  w: UP, s: DOWN, a: LEFT, d: RIGHT,
  W: UP, S: DOWN, A: LEFT, D: RIGHT,
};

function wallAt(maze, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  return maze[ty][tx] === 1;
}
function canWalk(maze, tx, ty, d) {
  return !wallAt(maze, tx + d[0], ty + d[1]);
}
function rndInt(n) { return Math.floor(Math.random() * n); }

function openNeighbours(grid, x, y) {
  let n = 0;
  for (const d of DIR_LIST) {
    const nx = x + d[0], ny = y + d[1];
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && grid[ny][nx] === 0) n++;
  }
  return n;
}

// Real arcade mazes have no dead ends: every corridor is part of a loop. That matters here
// because the ghosts are deliberately dumb (greedy, and they can never reverse) - a dead
// end is exactly what makes one ping-pong in place forever instead of hunting you.
function removeDeadEnds(grid) {
  for (let pass = 0; pass < 80; pass++) {
    let changed = false;
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (grid[y][x] !== 0 || openNeighbours(grid, x, y) > 1) continue;
        const through = [], plain = [];
        for (const d of DIR_LIST) {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 1 || ny < 1 || nx > COLS - 2 || ny > ROWS - 2 || grid[ny][nx] !== 1) continue;
          const bx = nx + d[0], by = ny + d[1];
          const beyond = bx >= 0 && by >= 0 && bx < COLS && by < ROWS && grid[by][bx] === 0;
          (beyond ? through : plain).push([nx, ny]);
        }
        const list = through.length ? through : plain;
        if (!list.length) continue;
        const pick = list[rndInt(list.length)];
        grid[pick[1]][pick[0]] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function genMaze() {
  const grid = [];
  for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(1));

  const stack = [[1, 1]];
  grid[1][1] = 0;
  const jumps = [[0, -2], [0, 2], [-2, 0], [2, 0]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [];
    for (const [dx, dy] of jumps) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1 && grid[ny][nx] === 1) opts.push([nx, ny, dx, dy]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = opts[rndInt(opts.length)];
    grid[y + dy / 2][x + dx / 2] = 0;
    grid[ny][nx] = 0;
    stack.push([nx, ny]);
  }

  // punch loops so the maze has escape routes
  const candidates = [];
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] !== 1) continue;
      const h = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
      const v = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
      if (h || v) candidates.push([x, y]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
  }
  const open = Math.round(candidates.length * 0.42);
  for (let i = 0; i < open; i++) grid[candidates[i][1]][candidates[i][0]] = 0;

  removeDeadEnds(grid);

  // carve a small central den and clear the outer rim
  const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1) grid[y][x] = 0;
    }
  }
  return grid;
}

function tileDistance(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

export default {
  id: "arcade",
  name: "Ghost Muncher",
  icon: "\u{1F47E}",
  action: "INSERT COIN",
  canIdle: false,
  minBet: 1,
  blurb: "One arcade maze, generated fresh every play. Clear every dot to beat it.",
  payoutNote: () =>
    "Beat the maze and you collect <b>35% of the jackpot</b>. The jackpot is worth whatever your bet is \u00D7 the pot, " +
    "and the pot grows by <b>0.25\u00D7</b> every play it survives (capped at <b>" + POT_CAP + "\u00D7</b>). " +
    "You have <b>" + LIVES + " lives</b> and <b>" + TIME_LIMIT + " seconds</b>. Skill actually matters here.",

  create(app) {
    const NS = "http://www.w3.org/2000/svg";

    if (!state.arcade || !Number.isFinite(state.arcade.pot)) state.arcade = { pot: POT_BASE };

    const canvas = el("canvas", { class: "arcade-canvas" });
    const statusEl = el("div", { class: "arcade-status", text: "INSERT A COIN TO PLAY" });
    const hudJackpot = el("b", { text: "0" });
    const hudShare = el("b", { text: "0" });
    const hudLives = el("span", { text: "" });
    const hudDots = el("b", { text: "0" });
    const hudTime = el("b", { text: "0:00" });
    const dpad = el("div", { class: "arcade-dpad" },
      el("button", { class: "dbtn up", type: "button", "aria-label": "Up", text: "\u25B2" }),
      el("button", { class: "dbtn left", type: "button", "aria-label": "Left", text: "\u25C0" }),
      el("button", { class: "dbtn right", type: "button", "aria-label": "Right", text: "\u25B6" }),
      el("button", { class: "dbtn down", type: "button", "aria-label": "Down", text: "\u25BC" })
    );
    const dpadBtns = {
      up: dpad.querySelector(".up"),
      down: dpad.querySelector(".down"),
      left: dpad.querySelector(".left"),
      right: dpad.querySelector(".right"),
    };

    const root = stageShell(
      "Ghost Muncher",
      "A random maze every play. Eat every dot, dodge the ghosts, collect 35% of the jackpot.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "arcade-wrap" },
        el("div", { class: "slot-cabinet arcade-cab" },
          el("div", { class: "slot-marquee" },
            el("span", { class: "lights" }, el("i"), el("i"), el("i")),
            el("span", { class: "marquee-title", text: "GHOST MUNCHER" }),
            el("span", { class: "sub", text: "1 PLAYER" }),
            el("span", { class: "lights" }, el("i"), el("i"), el("i"))
          ),
          el("div", { class: "arcade-hud" },
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Jackpot" }), el("span", { class: "v", text: "$" }, hudJackpot)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "You collect" }), el("span", { class: "v gold", text: "$" }, hudShare)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Lives" }), el("span", { class: "v", text: "" }, hudLives)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Dots" }), el("span", { class: "v", text: "" }, hudDots)),
            el("div", { class: "ahud" }, el("span", { class: "k", text: "Time" }), el("span", { class: "v", text: "" }, hudTime))
          ),
          el("div", { class: "arcade-screen" }, canvas),
          statusEl,
          dpad
        )
      )
    );

    const ctx = canvas.getContext("2d");
    let tile = 24;
    let dpr = 1;

    /* ---------- game state ---------- */
    let maze = null;
    let pellets = 0;
    let totalPellets = 0;
    let powerCells = new Set();
    let pac = null;
    let ghosts = [];
    let lives = LIVES;
    let timeLeft = TIME_LIMIT;
    let fright = 0;
    let phase = "idle"; // idle | ready | play | done
    let readyMs = 0;
    let rafId = 0;
    let lastT = 0;
    let sizeTick = 0;
    let resolveRun = null;
    let destroyed = false;
    let outcome = null; // { won, multiplier }
    let touchStart = null;
    let lastChomp = 0;
    let sirenOn = false;

    function potInfo(stake) {
      const pot = clamp(state.arcade.pot, POT_BASE, POT_CAP);
      return { pot, jackpot: roundMoney(pot * stake), share: roundMoney(pot * stake * WIN_SHARE) };
    }
    function roundMoney(n) { return Math.round(Number(n) || 0); }

    function refreshJackpotHud() {
      const unit = Math.max(1, Math.floor(Number(app.bet) || 1));
      const info = potInfo(unit);
      hudJackpot.textContent = fmt(info.jackpot).slice(1);
      hudShare.textContent = fmt(info.share).slice(1);
    }

    function refreshHud() {
      hudLives.textContent = lives > 0 ? "\u2764\uFE0F".repeat(Math.min(lives, 5)) : "\u2014";
      hudDots.textContent = String(pellets);
      const mm = Math.floor(Math.max(0, timeLeft) / 60);
      const ss = Math.floor(Math.max(0, timeLeft) % 60);
      hudTime.textContent = mm + ":" + String(ss).padStart(2, "0");
    }

    /* ---------- maze / entities ---------- */
    function makePac(tx, ty) {
      return { tx, ty, px: tx, py: ty, dir: [0, 0], want: null, wantT: 0, prog: 0, gliding: false, stepT: 0, glideMs: 0, dwellMs: 0 };
    }
    function makeGhost(tx, ty, i) {
      const persona = PERSONAS[i % PERSONAS.length];
      return {
        tx, ty, px: tx, py: ty, dir: DIR_LIST[rndInt(4)], want: null, prog: 0, gliding: false, stepT: 0, glideMs: 0, dwellMs: 0,
        speedMul: PERSONA_SPEED[persona],
        persona,
        corner: [tx, ty],
        spot: i,
      };
    }
    function entityPos(e) {
      if (!e.gliding) return [e.tx + 0.5, e.ty + 0.5];
      return [e.px + 0.5 + (e.tx - e.px) * e.prog, e.py + 0.5 + (e.ty - e.py) * e.prog];
    }
    function placeAt(e, tx, ty) {
      e.tx = tx; e.ty = ty; e.px = tx; e.py = ty;
      e.prog = 0; e.gliding = false; e.stepT = 0;
    }

    // Grid-locked stepping: the entity sits on a tile for the dwell portion of the
    // step, then slides to the next tile. Long stopped pauses are what give the
    // player time to read a junction and pick a turn.
    function stepEntity(e, choose, stepMs, dtSec) {
      if (e.gliding) {
        e.prog += (dtSec * 1000) / e.glideMs;
        if (e.prog >= 1) { e.prog = 0; e.gliding = false; e.stepT = e.dwellMs; }
        return;
      }
      e.stepT -= dtSec * 1000;
      if (e.stepT > 0) return;
      if (choose) choose(e);
      if (!e.dir[0] && !e.dir[1]) { e.stepT = 120; return; }
      if (!canWalk(maze, e.tx, e.ty, e.dir)) { e.stepT = 120; return; }
      e.px = e.tx; e.py = e.ty;
      e.tx += e.dir[0]; e.ty += e.dir[1];
      e.glideMs = stepMs * GLIDE_FRAC;
      e.dwellMs = stepMs * (1 - GLIDE_FRAC);
      e.gliding = true;
      e.prog = 0;
    }

    function setWant(d) {
      if (!pac || phase === "done") return;
      pac.want = d;
      pac.wantT = performance.now();
      // pac is stopped on a tile during its dwell: let it turn (or reverse) right away
      // for instant feedback, instead of waiting for the next step decision.
      if (!pac.gliding && canWalk(maze, pac.tx, pac.ty, d)) {
        pac.dir = d;
        pac.want = null;
      }
    }

    function pacChoose(p) {
      if (p.want && performance.now() - p.wantT > 950) p.want = null;
      if (p.want && canWalk(maze, p.tx, p.ty, p.want)) {
        p.dir = p.want;
        p.want = null;
      }
    }

    /* -- arcade-style ghost brains: each ghost only ever heads for one fixed target tile.
          No pathfinding, no dodging, no predicting beyond its own personality - so the
          player can read and memorise them, exactly like the original cabinet. -- */
    let modeIdx = 0, modeT = 0;
    function modeNow() { return MODE_PLAN[Math.min(modeIdx, MODE_PLAN.length - 1)][0]; }
    function resetModes() { modeIdx = 0; modeT = 0; }
    function reverseGhost(g) {
      if (g.gliding) {
        const ox = g.px, oy = g.py;
        g.px = g.tx; g.py = g.ty;
        g.tx = ox; g.ty = oy;
        g.prog = 1 - g.prog;
      }
      g.dir = [-g.dir[0], -g.dir[1]];
    }
    function tickModes(dt) {
      const dur = MODE_PLAN[Math.min(modeIdx, MODE_PLAN.length - 1)][1];
      if (!isFinite(dur)) return;
      modeT += dt;
      if (modeT < dur) return;
      modeT = 0;
      modeIdx++;
      for (const g of ghosts) reverseGhost(g);
    }
    function pacTile() {
      // the tile pac actually occupies right now (not the one it's still sliding into)
      if (pac.gliding && pac.prog < 0.5) return [pac.px, pac.py];
      return [pac.tx, pac.ty];
    }
    function ghostTarget(g) {
      if (modeNow() === "scatter") return g.corner;
      const pt = pacTile(), pd = pac.dir;
      if (g.persona === "pinky") return [pt[0] + pd[0] * 4, pt[1] + pd[1] * 4];
      if (g.persona === "inky") {
        const lead = [pt[0] + pd[0] * 2, pt[1] + pd[1] * 2];
        const b = ghosts[0] || g;
        return [lead[0] * 2 - b.tx, lead[1] * 2 - b.ty];
      }
      if (g.persona === "clyde") {
        const d = Math.hypot(g.tx - pt[0], g.ty - pt[1]);
        return d > 8 ? pt : g.corner;
      }
      return pt; // blinky just walks at you
    }

    function ghostChoose(g) {
      const rev = [-g.dir[0], -g.dir[1]];
      const opts = CHOICE_ORDER.filter((d) => !(d[0] === rev[0] && d[1] === rev[1]) && canWalk(maze, g.tx, g.ty, d));
      if (!opts.length) { g.dir = rev; return; }
      if (fright > 0) { g.dir = opts[rndInt(opts.length)]; return; }
      const tgt = ghostTarget(g);
      let best = opts[0], bestD = Infinity;
      for (const d of opts) {
        const nx = g.tx + d[0], ny = g.ty + d[1];
        const dd = (nx - tgt[0]) * (nx - tgt[0]) + (ny - tgt[1]) * (ny - tgt[1]);
        if (dd < bestD) { bestD = dd; best = d; }
      }
      g.dir = best;
    }

    function scatterPositions(origin) {
      const openTiles = [];
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) if (maze[y][x] === 0) openTiles.push([x, y]);
      }
      const start = openTiles[0];
      const from = origin || start;
      const far = openTiles.slice().sort((a, b) => tileDistance(b, from) - tileDistance(a, from));
      const ghostSpots = far.slice(0, 4).map((t) => t.slice());
      return { start, ghostSpots, openTiles };
    }

    // the open tile closest to each ideal corner - ghosts' home bases during scatter
    function cornerTiles(openTiles) {
      const ideals = [[COLS - 2, 1], [1, 1], [COLS - 2, ROWS - 2], [1, ROWS - 2]];
      return ideals.map((c) => {
        let best = openTiles[0], bd = Infinity;
        for (const t of openTiles) {
          const d = (t[0] - c[0]) * (t[0] - c[0]) + (t[1] - c[1]) * (t[1] - c[1]);
          if (d < bd) { bd = d; best = t; }
        }
        return best.slice();
      });
    }

    function buildLevel() {
      maze = genMaze();
      const { start, ghostSpots, openTiles } = scatterPositions();
      pac = makePac(start[0], start[1]);
      ghosts = [];
      const corners = cornerTiles(openTiles);
      const n = 3 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const spot = ghostSpots[i % ghostSpots.length];
        const g = makeGhost(spot[0], spot[1], i);
        g.corner = corners[i % corners.length];
        ghosts.push(g);
      }
      resetModes();
      powerCells = new Set();
      const powerSpots = openTiles
        .filter((t) => tileDistance(t, start) > 4)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      for (const [x, y] of powerSpots) powerCells.add(x + "," + y);
      pellets = 0;
      for (const [x, y] of openTiles) {
        if (x === start[0] && y === start[1]) continue;
        if (powerCells.has(x + "," + y)) continue;
        pellets++;
      }
      totalPellets = Math.max(1, pellets + powerCells.size);
      lives = LIVES;
      timeLeft = TIME_LIMIT;
      fright = 0;
    }

    function resetActors() {
      const { start, ghostSpots } = scatterPositions();
      pac = makePac(start[0], start[1]);
      pac.want = null;
      for (let i = 0; i < ghosts.length; i++) {
        const spot = ghostSpots[i % ghostSpots.length];
        const g = ghosts[i];
        placeAt(g, spot[0], spot[1]);
        g.dir = DIR_LIST[rndInt(4)];
        g.speedMul = PERSONA_SPEED[g.persona];
      }
      resetModes();
    }

    /* ---------- update ---------- */
    // pellets live in a separate grid so walls stay walls
    let pelletGrid = null;
    function update(dt) {
      stepEntity(pac, pacChoose, PAC_STEP, dt);
      const [px, py] = entityPos(pac);
      const ctx2 = Math.floor(px), cty = Math.floor(py);
      if (pelletGrid[cty] && pelletGrid[cty][ctx2] === 1) {
        pelletGrid[cty][ctx2] = 0;
        pellets--;
        const now = performance.now();
        if (now - lastChomp > 85) { sfx.chomp(); lastChomp = now; }
      }
      if (pelletGrid[cty] && pelletGrid[cty][ctx2] === 2) {
        pelletGrid[cty][ctx2] = 0;
        pellets--;
        fright = FRIGHT_TIME;
        for (const g of ghosts) reverseGhost(g);
        sfx.power();
        app.toast("\u26A1 POWER PELLET \u2014 ghosts are edible!", "info", 1500);
      }

      tickModes(dt);
      const eaten = 1 - pellets / Math.max(1, totalPellets);
      let elroy = 1;
      if (eaten >= ELROY_HARD_AT) elroy = 1.22;
      else if (eaten >= ELROY_AT) elroy = 1.1;
      for (const g of ghosts) {
        const spd = g.speedMul * (g.persona === "blinky" ? elroy : 1) * (fright > 0 ? 0.62 : 1);
        stepEntity(g, ghostChoose, GHOST_STEP / spd, dt);
      }

      if (fright > 0) fright = Math.max(0, fright - dt);
      timeLeft -= dt;

      // collisions
      for (const g of ghosts) {
        const [gx, gy] = entityPos(g);
        const d2 = (gx - px) * (gx - px) + (gy - py) * (gy - py);
        if (d2 < 0.55) {
          if (fright > 0) {
            const { ghostSpots } = scatterPositions([pac.tx, pac.ty]);
            const spot = ghostSpots[g.spot % ghostSpots.length];
            placeAt(g, spot[0], spot[1]);
            g.dir = DIR_LIST[rndInt(4)];
            sfx.eatGhost();
            app.toast("GHOST EATEN", "gold", 1200);
          } else {
            lives--;
            sfx.death();
            if (lives <= 0) { finish(false); return; }
            phase = "ready";
            readyMs = 1100;
            resetActors();
            return;
          }
        }
      }

      if (pellets <= 0) { finish(true); return; }
      if (timeLeft <= 0) { finish(false); }
    }

    /* ---------- draw ---------- */
    function draw() {
      const w = COLS * tile, h = ROWS * tile;
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0a1020");
      bg.addColorStop(1, "#05070d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (!maze) { drawAttract(w, h); return; }

      // walls
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (maze[y][x] !== 1) continue;
          const px = x * tile, py = y * tile;
          ctx.fillStyle = "#101a33";
          roundRect(px + 1, py + 1, tile - 2, tile - 2, tile * 0.22);
          ctx.fill();
          ctx.strokeStyle = "rgba(90,150,255,.55)";
          ctx.lineWidth = Math.max(1, tile * 0.055);
          ctx.stroke();
        }
      }

      if (pelletGrid) {
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            const v = pelletGrid[y][x];
            if (!v) continue;
            if (v === 2) {
              const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
              ctx.fillStyle = "#ffe08a";
              ctx.beginPath();
              ctx.arc((x + 0.5) * tile, (y + 0.5) * tile, tile * (0.2 + 0.05 * pulse), 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = "#f2c14e";
              ctx.beginPath();
              ctx.arc((x + 0.5) * tile, (y + 0.5) * tile, Math.max(1.4, tile * 0.085), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // ghosts
      for (const g of ghosts) {
        const [gx, gy] = entityPos(g);
        drawGhost(gx * tile, gy * tile, g.spot, g.dir, fright > 0);
      }

      // pac
      if (pac) {
        const [px, py] = entityPos(pac);
        const chomp = pac.gliding ? Math.sin(pac.prog * Math.PI) : 0.12;
        drawPac(px * tile, py * tile, pac.dir, chomp);
      }

      if (phase === "ready") {
        ctx.fillStyle = "rgba(0,0,0,.45)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ffe08a";
        ctx.font = "700 " + Math.round(tile * 0.7) + "px 'Bebas Neue', Impact, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("READY", w / 2, h / 2);
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawAttract(w, h) {
      ctx.strokeStyle = "rgba(90,150,255,.3)";
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, w - 12, h - 12);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#f2c14e";
      ctx.font = "700 " + Math.round(tile * 1.15) + "px 'Bebas Neue', Impact, sans-serif";
      ctx.fillText("GHOST MUNCHER", w / 2, h * 0.33);
      const blink = 0.6 + 0.4 * Math.sin(performance.now() / 320);
      ctx.globalAlpha = blink;
      ctx.fillStyle = "#cdd8ee";
      ctx.font = "600 " + Math.round(tile * 0.52) + "px 'Bebas Neue', Impact, sans-serif";
      ctx.fillText("INSERT A COIN TO PLAY", w / 2, h * 0.47);
      ctx.globalAlpha = 1;

      const cy = h * 0.7;
      const bob = Math.sin(performance.now() / 420) * tile * 0.12;
      drawPac(w / 2 - tile * 2.4, cy, [1, 0]);
      drawGhost(w / 2 - tile * 0.9, cy + bob, 0, [-1, 0], false);
      drawGhost(w / 2 + tile * 0.2, cy - bob, 2, [-1, 0], false);
      drawGhost(w / 2 + tile * 1.3, cy + bob, 1, [-1, 0], false);
      drawGhost(w / 2 + tile * 2.4, cy - bob, 3, [-1, 0], false);
    }

    function drawPac(cx, cy, dir, chomp) {
      const r = tile * 0.42;
      const c = chomp == null ? 0.5 + 0.5 * Math.sin(performance.now() / 135) : chomp;
      const open = 0.08 + 0.22 * c;
      const d = dir || [1, 0];
      let ang = 0;
      if (d[0] === 1) ang = 0;
      else if (d[0] === -1) ang = Math.PI;
      else if (d[1] === -1) ang = -Math.PI / 2;
      else if (d[1] === 1) ang = Math.PI / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, open * Math.PI, (2 - open) * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#2b1d00";
      ctx.beginPath();
      ctx.arc(r * 0.15, -r * 0.45, Math.max(1.2, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawGhost(cx, cy, spot, dir, afraid) {
      const r = tile * 0.4;
      const body = afraid ? (fright < 2 && Math.floor(fright * 6) % 2 ? "#ffffff" : "#3b6bff") : ["#ff4d6d", "#ffb8ff", "#4dc9ff", "#ff9f43"][spot % 4];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r, Math.PI, 0);
      ctx.lineTo(r, r * 0.62);
      const feet = 3;
      for (let i = 0; i < feet; i++) {
        const w = (r * 2) / feet;
        ctx.lineTo(r - w * i - w / 2, r * 0.34);
        ctx.lineTo(r - w * (i + 1), r * 0.62);
      }
      ctx.closePath();
      ctx.fill();
      // eyes
      const ex = (dir ? dir[0] : 0) * r * 0.22, ey = (dir ? dir[1] : 0) * r * 0.22;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx * r * 0.36 + ex * 0.5, -r * 0.15 + ey * 0.5, r * 0.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = afraid ? "#3b6bff" : "#101828";
        ctx.beginPath();
        ctx.arc(sx * r * 0.36 + ex, -r * 0.15 + ey, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
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
      const pause = paused();
      if (!pause) {
        if (phase === "ready") {
          readyMs -= dt * 1000;
          if (readyMs <= 0) phase = "play";
        } else if (phase === "play") {
          update(dt);
          refreshHud();
        }
        if (phase === "play" || phase === "ready" || phase === "done" || phase === "idle") draw();
      }
      const wantSiren = !pause && phase === "play";
      if (wantSiren && !sirenOn) { sfx.sirenStart(); sirenOn = true; }
      else if (!wantSiren && sirenOn) { sfx.sirenStop(); sirenOn = false; }
      if (sirenOn) sfx.sirenPace((1 - pellets / Math.max(1, totalPellets)) * 8);
      if (phase === "done") { rafId = 0; return; }
      rafId = requestAnimationFrame(loop);
    }

    function finish(won) {
      phase = "done";
      const unit = Math.max(1, Math.floor(Number(app.bet) || 1));
      const info = potInfo(unit);
      if (won) {
        state.arcade.pot = POT_BASE;
        outcome = { won: true, multiplier: info.pot * WIN_SHARE, jackpot: info.jackpot, share: info.share };
        statusEl.className = "arcade-status won";
        statusEl.textContent = "MAZE CLEARED \u2014 you collected 35% of the " + fmt(info.jackpot) + " jackpot";
        app.confetti(70);
      } else {
        state.arcade.pot = clamp(state.arcade.pot + POT_STEP, POT_BASE, POT_CAP);
        outcome = { won: false, multiplier: 0, jackpot: info.jackpot, share: info.share };
        statusEl.className = "arcade-status lost";
        statusEl.textContent = lives > 0
          ? "TIME UP \u2014 the jackpot grows to " + state.arcade.pot.toFixed(2) + "\u00D7"
          : "GAME OVER \u2014 the jackpot grows to " + state.arcade.pot.toFixed(2) + "\u00D7";
      }
      saveState();
      refreshJackpotHud();
      const r = resolveRun;
      resolveRun = null;
      if (r) r(outcome);
    }

    /* ---------- sizing ---------- */
    let lastW = 0, lastH = 0;
    function resize() {
      const box = canvas.parentElement;
      const cssW = Math.max(200, Math.min(box.clientWidth || 420, 560));
      const cssH = Math.round(cssW * (ROWS / COLS));
      if (cssW === lastW && cssH === lastH) return;
      lastW = cssW;
      lastH = cssH;
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tile = cssW / COLS;
      draw();
    }

    let roRaf = 0;
    function scheduleResize() {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => { roRaf = 0; if (!destroyed) resize(); });
    }
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleResize());
      ro.observe(canvas.parentElement);
    }
    window.addEventListener("resize", scheduleResize);

    /* ---------- input ---------- */
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const d = KEYMAP[e.key];
      if (!d) return;
      if (phase !== "play" && phase !== "ready") return;
      e.preventDefault();
      setWant(d);
    }
    window.addEventListener("keydown", onKey);

    function bindDir(btn, d) {
      const set = (e) => { e.preventDefault(); setWant(d); };
      btn.addEventListener("pointerdown", set);
    }
    bindDir(dpadBtns.up, UP);
    bindDir(dpadBtns.down, DOWN);
    bindDir(dpadBtns.left, LEFT);
    bindDir(dpadBtns.right, RIGHT);

    canvas.addEventListener("pointerdown", (e) => {
      touchStart = [e.clientX, e.clientY];
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!touchStart || !pac) return;
      const dx = e.clientX - touchStart[0];
      const dy = e.clientY - touchStart[1];
      if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
      setWant(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
      touchStart = [e.clientX, e.clientY];
    });
    canvas.addEventListener("pointerup", () => { touchStart = null; });
    canvas.addEventListener("pointercancel", () => { touchStart = null; });

    /* ---------- lifecycle ---------- */
    function startLevel() {
      buildLevel();
      pelletGrid = null;
      pellets = 0;
      pelletGrid = [];
      let dots = 0;
      for (let y = 0; y < ROWS; y++) {
        pelletGrid.push(new Array(COLS).fill(0));
        for (let x = 0; x < COLS; x++) {
          if (maze[y][x] !== 0) continue;
          if (x === pac.tx && y === pac.ty) continue;
          if (powerCells.has(x + "," + y)) { pelletGrid[y][x] = 2; dots++; }
          else { pelletGrid[y][x] = 1; dots++; }
        }
      }
      pellets = dots;
      totalPellets = dots;
      refreshHud();
      refreshJackpotHud();
      phase = "ready";
      readyMs = 1200;
      lastT = performance.now();
      sfx.ready();
      statusEl.className = "arcade-status";
      statusEl.textContent = "EAT EVERY DOT \u2014 the ghosts are faster than they look";
      if (!rafId) rafId = requestAnimationFrame(loop);
      resize();
    }

    async function play(stake, opts) {
      if (opts && opts.instant) return { multiplier: 1 };
      destroyed = false;
      outcome = null;
      refreshJackpotHud();
      statusEl.className = "arcade-status";
      statusEl.textContent = "GET READY\u2026";
      startLevel();
      const result = await new Promise((resolve) => { resolveRun = resolve; });
      return { multiplier: result ? result.multiplier : 0 };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      sfx.sirenStop();
      sirenOn = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (roRaf) { cancelAnimationFrame(roRaf); roRaf = 0; }
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", scheduleResize);
      if (ro) ro.disconnect();
      phase = "done";
      const r = resolveRun;
      resolveRun = null;
      if (r) r({ won: false, multiplier: 1, cancelled: true });
    }

    function openInfoCard() {
      const pip = (size, color, glow) => el("span", { class: "ic-pip", style: { width: size + "px", height: size + "px", background: color, boxShadow: glow ? "0 0 8px " + glow : "none" } });
      const ghost = (color) => el("span", { class: "ic-ghost", style: { background: color } });
      const key = (mark, name, desc) => el("div", { class: "ic-keyrow" }, mark,
        el("div", { class: "ic-keytxt" }, el("b", { text: name }), el("span", { html: desc })));

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-hint", text: "WHAT'S ON THE BOARD" }),
        el("div", { class: "ic-key" },
          key(pip(11, "#e8eefc"), "Pellet", "Eat every one on the board \u2014 that clears the maze."),
          key(pip(15, "#ffe9a8", "rgba(255,225,140,.75)"), "Power pellet", "Four per maze. Makes the ghosts edible for <b>6.5s</b>."),
          key(pip(20, "#f2c14e"), "Muncher", "You. Never slows; the ghosts get faster as the maze empties."),
          key(ghost("#ff4d5e"), "Blinky", "Hunts you directly \u2014 the quickest of the four."),
          key(ghost("#ff8fd0"), "Pinky", "Aims ahead of you to cut off your path."),
          key(ghost("#59e0ff"), "Inky", "Comes at odd angles \u2014 the least predictable."),
          key(ghost("#ff9f43"), "Clyde", "Wanders and lags behind \u2014 the slowest.")
        )
      );

      const pot = clamp(state.arcade.pot, POT_BASE, POT_CAP);
      const kvRow = (k, v) => el("div", { class: "row" }, el("span", { text: k }), el("span", { class: "v", text: v }));
      const kv = el("div", { class: "ic-kv" },
        kvRow("Pot right now", pot.toFixed(2) + "\u00D7"),
        kvRow("Pot when it resets", POT_BASE + "\u00D7"),
        kvRow("Grows each loss", "+" + POT_STEP + "\u00D7"),
        kvRow("Pot cap", POT_CAP + "\u00D7"),
        kvRow("Your cut on a clear", Math.round(WIN_SHARE * 100) + "%")
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("The goal",
            ul([
              "One arcade maze, generated <b>fresh every play</b> \u2014 no two boards are ever the same.",
              "Eat <b>every pellet</b> to clear it. Clear the maze and you collect <b>35% of the jackpot</b>.",
              "The ghosts hunt the whole time. Touch one and you lose a life.",
            ])
          ),
          sec("Lives and time",
            ul([
              "You get <b>" + LIVES + " lives</b> and <b>" + TIME_LIMIT + " seconds</b> per play \u2014 run out of either and the run ends.",
              "A lost life just resets your position for a moment; pellets you have already eaten stay eaten.",
            ])
          ),
          sec("Power pellets",
            ul([
              "Eat a glowing power pellet and the ghosts turn <b>blue and edible for " + FRIGHT_TIME + "s</b>.",
              "Munched ghosts are sent back home \u2014 handy, but they pay nothing.",
              "Eat every pellet without clearing the board in time and the pot still grows: the jackpot rewards survival.",
            ])
          )
        )
      );

      openInfo("Ghost Muncher \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("The jackpot", kv,
          note("The jackpot is <b>pot \u00D7 your bet</b>, and you collect <b>" + Math.round(WIN_SHARE * 100) + "%</b> of it on a clear. Clear it and the pot drops back to " + POT_BASE + "\u00D7; fail and it climbs \u2014 so it is always worth watching."))
      ));
    }

    refreshJackpotHud();
    resize();
    draw();
    lastT = performance.now();
    if (!rafId) rafId = requestAnimationFrame(loop);

    app.onBetChange = refreshJackpotHud;

    return { root, play, actionLabel: "INSERT COIN", destroy };
  },
};
