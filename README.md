# Casino Royale

A single-page casino gambling game for Perchance. Start with **$1,000**, wager across
nine machines, level up, buy stacking perks, toggle idle auto-play, and try to survive a
bankrupt-triggered loan with a 1-hour real-time clock. All money is displayed and stored
as **whole dollars** — cents are rounded to the nearest dollar everywhere (`fmt()` in
`ui.js`, `roundMoney()` in `state.js`).

## How to play

- **Nine machines**, switchable at any time from the left nav (top row on mobile):
  - **Slots** — 3 reels / 6 symbols, match 3 or land a premium pair. House edge ≈ 10%.
    The three reels start together but **stop one at a time** (reel 0 ≈ 0.9 s, reel 1
    ≈ 1.7 s, reel 2 ≈ 2.5 s) so the last reel is a real nail-biter. Each reel spins a
    **randomised strip** — filler glyphs are drawn uniformly but never repeat next to each
    other and never sit directly above the landing glyph, so no two spins scroll the same
    pattern — and each reel's travel distance and duration get a small random jitter every
    spin, so the motion never looks like a canned loop. Each drum is **motion-blurred in
    proportion to its own speed** (same bezier-sampled `spinBlur` as Fortune Lines), then
    locks with the **same cyan land FX as Fortune Lines** — a white sweep + cyan flash
    burst (`.reel-landfx`) over an `mlLand` frame glow — and the drum **bounces into the
    detent**: it overshoots the payline, rebounds, then drops hard and sticks. The final
    drum thumps the cabinet and buzzes on mobile.
  - **Fortune Lines** — 5 reels × 3 rows, **9 paylines**. Paylines are 1/3/5/9
    selectable, and you pay **bet × lines** per spin (pays are *per line bet*). Wild 🃏,
    scatter 💠 (pays × **total** bet and awards 10/15/20 free spins for 3/4/5, which
    retrigger up to a 40-spin cap). House edge ≈ 7%. The five drums start together and
    stop **one at a time** (~0.44 s apart) — each drum is **motion-blurred in proportion
    to its own speed**, so the symbols are unreadable while it races and sharpen into
    focus as it slows, then lock with a white sweep, a cyan flash, a **detent bounce**
    (overshoot → rebound → hard drop onto the mark) and a cabinet thump on the final drum.
  - **Roulette** — European wheel (single 0). Click **any number of spots** (37
    straight-ups + 12 outside bets); the *total* bet you type is split across them as
    evenly as whole dollars allow, with a **$1 minimum per spot** (you can't pick more
    spots than your bet, and the chips on the felt show the split). Every spot that wins
    pays its own odds, so covering RED + EVEN + 1st 12 on a 4 returns `(2+2+3)/stake`.
    **Table limit by level**: `rouletteMaxBetBase × level^rouletteMaxBetExp` (default
    `400 × L^1.35`), rounded down to $10 — $400 at L1, ≈$8.9k at L10, ≈$100k at L60. The
    bet clamps to `min(balance, limit)` and the limit is shown in the bet panel and on the
    felt. Effects: a JS-interval-driven ball (16 ms `easeOutQuart` spiral, radius
    1.07→0.88) that lands under the pointer, a white arc on the winning pocket, gold
    outlines on your covered pockets, a colour-matched hub pop + full-felt flash, a chip
    burst scaled by the multiplier (plus confetti at ≥4×), a red shake on a miss, and the
    felt buttons lock while the wheel spins. Edge 2.7%.
  - **Blackjack** — 6-deck shoe, hit/stand/double, blackjack pays 3:2. Edge ≈ 0.5%.
    Played on a felt table: radial-green felt with a gold inner border and gold arc text
    ("BLACKJACK PAYS 3 TO 2" + the dealer's rule line), a blue **card shoe** with a live
    card count that newly dealt cards fly out of, and score badges. Card elements are
    **node-diffed** (created once and reused) so only freshly dealt cards animate in, and
    the hole card **flips with a 3D `rotateY` keyframe** rather than being swapped for a
    new node. Wins glow green with a gold coin burst, a blackjack fires a big gold
    "BLACKJACK!" pop + confetti, a bust flashes red and shakes the table, a push pulses
    gold, and score badges pop when they change.
  - **Horse Racing** — 6 runners, odds posted up front, payout `clamp(0.92/p, 1.05, 60)`. Edge 8%.
  - **Rocket Crash** — multiplier climbs until it crashes; auto cash-out target. Edge 3%.
    Hand-timed cash-out, so `canIdle:false` (no idle mode).
  - **Ghost Muncher** — 👾 Pac-Man style arcade. One procedurally generated maze per play
    (3 lives, 90 s). Clear every pellet to beat it and collect **35% of the jackpot**. The
    jackpot is `pot × your bet`, where `pot` grows by **0.25×** every play it survives
    (base 5×, cap 14×) and resets to 5× on a win. Skill, not chance — so `canIdle:false`.
  - **Frogger Gamble** — 🐸 a tiny frog waits on the verge and you call **CROSS** or
    **BANK**. Each lane's cars move at their own speed and you can *see* every one coming,
    so the danger is read, not rolled. The free first step onto the road is **×1.00**, then
    the ladder climbs **×1.20, ×1.40, …** compounding to **×10 exactly at your tenth lane**
    and adding a flat ×1 per lane after that, so lane 20 is exactly **×20**. Landing in a
    gap **blocks that lane's traffic** for a short pocket (shorter the deeper you go), so an
    open gap stays open while you decide — but jump while a car is closing and you're
    splatted for a total loss. Skill/nerve, not RNG — so `canIdle:false`.
  - **Treasure Chests** — 🧰 nine chests, **four of them pay, four are traps, and one is
    a ⭐ Lucky Star**. The paying chests hold **×10, ×3, ×2 and ×1** on your bet, reshuffled
    into random chests each round, and the star grants a **free second pick** (the re-pick
    is worth exactly what a random chest is worth, so it pays again). Expected return is
    **(10+3+2+1)×(9/8)/9 = 200%**, so this one is heavily in the player's favour (flagged
    in its `payoutNote`); tune `chestHigh/Gem/Mid/Low` in `main.pjs`.
- **Bet anything** you can afford (min bet per table). Bet must be ≤ balance.
- **Idle toggle** (top bar) auto-plays the current table on a small bet you set in the
  idle bet field. Idle stops itself if the balance drops below the idle bet. Idle has a
  simple per-game brain so auto-play still looks human: **Roulette** picks RED or BLACK
  (random each spin, and it lights up that spot); **Blackjack** plays a basic-strategy
  table (stand/hit/double by total + dealer upcard, dealer stands on all 17s); **Horse
  Racing** picks a runner with odds-weighted randomness, so it backs longshots now and
  then. **Rocket Crash**, **Ghost Muncher** and **Frogger Gamble** are `canIdle:false` —
  they need a human hand (the IDLE button refuses and the nav lists "no idle").
- **Levels** are earned by *wagering*, not by luck: `XP = stake × xpRate × xpMult`
  (idle rounds earn `idleXpMult` times as much, since they animate at full speed). Each
  level grants a small permanent luck bonus and a cash reward (`levelReward × level`).
  **Progression has milestone walls**: every `xpTierSize` levels (10 by default) the XP
  needed for each following level is multiplied by `xpTierSpike` (2 by default), so the
  cost per level **doubles at levels 11, 21, 31, …** — a growing bankroll can no longer
  buy endless levels. The top bar shows a **★ TIER n ×m** tag while you're inside an
  inflated tier and a pulsing **⚠ NEXT TIER** warning on the last level before a wall,
  the XP bar turns orange inside a spiked tier, and the level-up toast announces the
  spike when you cross one.
- **Perk shop** (PERKS button) sells stacking perks. Most cap at 5 stacks. **Fortune**
  stacks forever, adding +1% winnings per stack, and its price grows every purchase.
- **Win popup**: any profitable round (except instant/idle micro-wins under $50) pops a
  big **"YOU WIN / $X / Nx"** banner at the top-centre of the screen that fades away after
  ~2 s — animated sliding/scaling in, then out. Idle wins over $50 pop too, labelled
  **"IDLE WIN"**. Implemented as `winPopup()` in `ui.js`, called from `playRound`.
- **Top-bar tools**: **LOAN** opens the loan window (offer / live status / repay) at any
  time; **HISTORY** (📜) opens the full **Play History** list; **BANKRUPT** opens the
  **Run Report** on demand — a win/loss breakdown by machine,
  streak and streak stats, biggest hit, and a batch of jokes about your technique.
- **Play history**: every hand is appended to `state.history` (`{g, s, p, m, t}` =
  game, stake, payout, multiplier, timestamp; last 150 kept). The bet panel shows a
  **History** list of the most recent hands live as you play, and the top-bar **HISTORY**
  button (or **VIEW ALL**) opens a modal with the full list — each row is a
  machine icon, game name, `bet $X · Nx`, a **WIN/LOSS/PUSH** tag and a signed colour-coded
  amount (green/red/grey left border), plus a summary line (hands / wins / losses / pushes
  / net). It shows individual hand results, **not** a running total.
- **Sound**: a small synthesized chiptune engine (`src/audio.js`) plays a click on every
  button, a lever-pull + reel ratchet while the slots spin, tiered win jingles (all
  games, tiered by profit/multiplier), a soft loss blip, the Ghost Muncher arcade set,
  a frogger set (hop blip, squish, maybe a horn), and horse-race hoofbeats/crowd. 🔊 in
  the top bar mutes it; the choice persists.
- **Bankruptcy** at $0 opens the same **Run Report** in "broke" mode: start over at
  $1,000, or take a loan.
- **Loan**: you receive a principal and must climb back to the repay amount within
  `loanMinutes` (default 60) of *real* time. Reaching the repay target clears the debt
  automatically (repay amount is deducted). Hitting $0 while a loan is live is an
  immediate default. Defaulting or running out of time wipes perks, level and stats.
- **Code window** (the 🗝️ key in the top bar): type a "fortune code" to add cash. Codes
  live in `CHEAT_CODES` in `src/main.js` (`winnerwinnerchikendinner` +$1,000,
  `losergottoeat` +$20,000, `isuckatthisgame` +$100,000). Typing **`admin`** opens the
  **Admin Console** — a jokey "cheater ranking" popup that lists every fortune code and
  rates how big a cheater you are, escalating through `CHEATER_TIERS` based on
  `stats.cheatWinnings`. Code use is tracked in `stats.cheats` / `stats.cheatWinnings`.

## Files

- `index.html` — DOM shell only (top bar, nav, stage, bet panel, toast/fx/modal layers).
  Loads `src/main.js` as a module.
- `main.pjs` — `$meta`, the tunable config values (read off `root` by `src/state.js`),
  flavour lists, and horse names. Edit tunables here.
- `src/main.js` — controller: top-bar render, nav, mount/route games, `playRound`,
  bet panel, idle loop, loan ticker, loan/bankruptcy modals, **Run Report** (`reportNode`,
  `reportJokes`, `openRunReport`), **code window + Admin Console** (`CHEAT_CODES`,
  `CHEATER_TIERS`, `openCheatAdmin`), perk shop, and the **play-history list**
  (`historyRows`, `renderHistoryPanel`, `openHistoryModal`) shown both inline in the bet
  panel and in the full HISTORY modal.
- `src/games/arcade.js` — Ghost Muncher: maze generator, tile-model movement + arcade ghost AI,
  canvas renderer (attract screen + in-game), keyboard/D-pad/swipe input, jackpot pot.
  Movement is grid-locked **tile stepping**: actors stop on a tile for the dwell portion
  of a step, then glide one tile. `PAC_STEP` / `GHOST_STEP` (ms per tile) and
  `GLIDE_FRAC` (moving fraction of a step, rest is the stopped pause) at the top of the
  file — steps are slow with a long pause so the player can read a junction and pick a
  turn. The ghost AI is deliberately **arcade-authentic and dumb**: four fixed personas by
  colour — blinky chases pac's tile, pinky aims 4 tiles ahead, inky uses the doubled vector
  from blinky, clyde turns shy inside 8 tiles — plus the classic `MODE_PLAN` scatter/chase
  cycle (each switch reverses every ghost at once) and `CHOICE_ORDER` tie-breaking
  (up, left, down, right). No pathfinding, no dodging, no crowd control, so they can be
  read and memorised. `removeDeadEnds` is load-bearing for this: the arcade mazes have no
  dead ends, and a greedy never-reversing ghost ping-pongs forever down one. Blinky also
  gets the arcade's **Cruise Elroy** speed-up as the maze empties. Retro sound is wired through `sfx`:
  `ready` jingle, a looping `siren` whose pace rises as the maze empties, `chomp` per
  pellet, `power` on a power pellet, `eatGhost`, and `death` when a life is lost. The
  siren stops whenever the game pauses (scene changes, modals, tab hidden by the loop).
- `src/state.js` — `CONFIG` + `state`, localStorage save/load, events, money, XP/levels,
  loan lifecycle, `recordPlay`, `resetRun`.
- `src/perks.js` — `PERKS` definitions, `perkCost`, `buyPerk`, `computeEffects`.
- `src/ui.js` — DOM helper `el`, formatting, toasts, modals, confetti, floating numbers,
  and the fading **win popup** (`winPopup({amount, mult, label})`).
- `src/audio.js` — WebAudio chiptune engine (no asset files). Lazy `AudioContext` created
  on the first user gesture, a persisted mute preference, a global button-click sound,
  and the `sfx` bank: `click`, `spin`/`reelStop`, `win(tier)`/`lose`/`levelUp`, the
  Pac-Man set (`chomp`, `power`, `eatGhost`, `death`, `ready`, `gameOver`, looping
  `sirenStart`/`sirenPace`/`sirenStop`), the frogger set (`blip`, `hop`, `squish`,
  `horn`, `bank`), and the racing set (`callToPost`, `hoof`, `crowd`).
  Muted state lives in `localStorage` under `casino-royale.sound.v1`. The 🔊 top-bar
  button toggles it.
- `src/games/*.js` — one module per table exporting `{ id, name, icon, action, blurb,
  payoutNote, minBet, create(app) }`. `create` returns `{ root, play(stake, {instant}),
  getBetUnits() }`. `getBetUnits()` (optional) is the **bet multiplier** the machine
  charges per spin — multi-line slots return the active line count, everything else
  returns 1; the controller uses it for the bet clamp, the total-cost line, and idle.
- `src/games/chest.js` — Treasure Chests: 9-chest grid, random reward layout (four pay
  tiers ×10/×3/×2/×1 plus one ⭐ Lucky Star that buys a second pick), pick/reveal flow,
  instant (idle) auto-pick (the star re-arms the grid once, excluding the spent star).
- `src/games/frogger.js` — Frogger Gamble UI: cabinet, HUD (bank/lanes/next lane/best),
  live danger bar (counts the safe pocket down, then the nearest threat), canvas renderer
  (grass verge + kerb, dashed lane dividers, each lane's distinct cars with
  head/taillights and shadows, the frog, lane chevrons, the destination column tinted
  open/closed, a green "safe pocket" band + closed ring around a resting frog), keyboard
  + **pointerdown** input (the CROSS/BANK buttons listen on `pointerdown`, not `click`),
  and the idle→ready→run→done state machine. Reads all physics/collision math from
  `frogger-math.js`. `CONFIG.froggerBlockSec` overrides `C.blockHi` at mount.
- `src/games/frogger-math.js` — **pure math, no DOM**: the traffic model (each lane is a
  rigid convoy of 2–5 cars with random widths/gaps/paints that loops forever;
  `mulberry32` seeded lane layout; `laneCars` for drawing; `laneHit` / `timeUntilHit` /
  `clearFor` for collision lookahead; `aimMargin` to drop the frog's column into a lane's
  widest gap with a chosen margin), `hopTiming` / `overlappedLanes` (the airborne hit
  test), `blockSecFor(depth)` (the safe-pocket length) and `multFor(depth)` (the payout
  ladder: ×1.00/×1.20/×1.40, then compounding to ×10 at lane 10, +1/lane after). Tune
  RTP/ramp here.
- `src/games/slots-multi.js` — Fortune Lines UI (cabinet, animated strips, SVG payline
  overlay, line selector, free-spin banner/badge). Reads its outcomes from the math module.
  The five drums spin together and **stop one at a time**: each `scrollReel` runs on its
  own transform duration and the controller awaits them in order, then `landReel` clears
  the reel's `.spinning`, fires `sfx.reelStop`, spawns a `.ml-landfx` burst (white sweep +
  cyan flash) and adds `.landed`; the final drum also thumps the cabinet and buzzes on
  mobile. Each drum then **bounces into the detent** via `beginSettle`/`endSettle`
  (shared with Slots): the smooth transform deliberately carries the strip
  `settleOffset(cellH)` px **past** the mark, and the `.reel-strip.settle` keyframes spring
  it back across the mark, dip, and hard-drop onto it, after which the inline transform is
  locked to the exact mark. **Motion blur** is shared with Slots:
  `driveBlur → spinBlur` (exported from `common.js`) samples the same
  cubic-bezier(.14,.72,.12,1) easing the transform uses and sets the strip's
  `filter: blur(Npx)` in proportion to its instantaneous speed (a 33 ms interval, so it
  still animates when CSS transitions are frozen, e.g. in the preview). Its `blurTimers`
  are cleared by `__cleanup`. The overlay's `viewBox` is set to its own measured size on every
  draw, and it is redrawn on ResizeObserver / window resize / a 320 ms size poll, so
  paylines stay glued to the cell centres when the layout changes (the preview harness does
  not always fire resize).
  The stage header carries an **`ⓘ PAY TABLE`** button (the shared `.infobtn`, which
  collapses to a bare `ⓘ` below 520px wide) which opens a 780px modal:
  - a **234×138 5×3 line map** — every payline drawn as an SVG polyline in its own colour
    through the cell centres, with a caption and an `ALL 9` + `1…9` legend; tapping a
    number dims the others and lights the 5 cells that line covers (`lineShape(li)`
    spells the run out, e.g. "Bottom → Middle → Top → Middle → Bottom");
  - **How a line wins** / **Only your lines are live** rule lists (the latter embeds a
    live line — "You currently have N lines live at $X per line, so a spin costs $Y");
  - **What counts as a win** — four worked 5-cell examples (3-from-the-left, wild
    substitution, a broken run, a scatter);
  - **Pays per line bet** — the same chip grid as the cabinet plus the free-spin ladder.

  Changing the line count also **flashes the newly-live paylines** on the reel overlay for
  1.5s in their line colours (`showGuideLines`/`guideLine`/`clearGuideLines`, tracked in
  `lineGuides` so re-clicks don't accumulate stale polylines). The flash is suppressed
  while spinning or when the last spin still has win lines on screen.
- `src/games/slots-multi-math.js` — **pure math, no DOM**: symbol table + reel weights,
  the 9 payline paths, `spinGrid`, `evaluateGrid` (left-anchored runs, wild substitution,
  scatter count), `freeSpinsFor`, `spinWinUnits` (scatter pays × active lines), and
  `resolveSpinSequence` (base spin + free-spin loop with retriggers). Tune RTP here.
- `src/games/index.js` — `GAMES` registry + `gameById`.
- `src/games/infocard.js` — **shared info-card primitives** (see below). Every game's
  ⓘ "How to win" card is built from these; nothing game-specific lives here.
- `src/games/common.js` — shared stage shell / helpers, plus the spin-motion helpers
  (`SPIN_EASE_CSS`, `cubicBezier`, `SPIN_EASE`, `SPIN_PEAK`, `BLUR_TICK`, `spinBlur`,
  `randInt`) and the detent-bounce helpers (`SETTLE_MS`, `settleOffset`, `setSettleVars`,
  `beginSettle`, `endSettle`, `clearSettle`) used by both slot machines.

## Architecture notes

- **Effects pipeline**: `computeEffects()` returns `{ luck, winMult, rebate, xpMult,
  idleSpeed }`, aggregated from level + owned perks. Each game's `play()` decides win/loss;
  `applyPerks()` in `main.js` then applies `winMult` (and `rebate` refunds part of a loss).
  `luck` is passed into each game to nudge odds (premium symbol weights, horse speed,
  blackjack bust mulligan, etc.).
- **Payout math** is defined per game so it is exact and auditable; the posted base
  return % is in each game's `payoutNote`. Perks push effective RTP above 100% at high
  luck — intentional, that's the progression reward.
- **Persistence** is `localStorage` key `casino-royale.save.v1` (see `state.js`).
  Renaming the generator changes the origin/subdomain and therefore loses the save.

### Fortune Lines math / calibration

- Pays are quoted **per line bet**. Line wins are left-anchored runs of 3/4/5 matching
  symbols (wilds substitute and can win on their own line). Scatters pay
  `pay × activeLines` (i.e. × total bet) and never appear on the win lines.
- `resolveSpinSequence` is deterministic given an `rng` function, which is what makes the
  machine testable: override `Math.random` before calling `playRound` to force grids.
- **Multi-line audit (1/3/5/9 lines).** Cost is `bet × lines` (verified live: 3×$51=$153,
  5×$51=$255, 9×$51=$459). Only *active* paylines are scored — `evaluateGrid` is called
  with `activeLines`, so a line you haven't switched on cannot win even when its symbols
  line up. Scatter pays `pay × activeLines` (i.e. × total bet), so an all-cherry grid
  pays exactly 1/3/5/9× the single-line amount and a scatter scales the same way. RTP is
  flat across the line settings (1/3/5/9 all ≈0.86–0.87 with no free spins in a
  quick headless sweep), which is what you want — more lines buys variance, not value.
  **Bug found + fixed:** `play()` used to read the live `lines` variable when scoring each
  spin, so tapping a line button mid-spin re-scored the in-flight spin (wrong scatter
  scaling / payout / result label). `play()` now snapshots `const activeLines = lines;`
  up front and uses `activeLines` everywhere downstream (`resolveSpinSequence`, every
  `spinWinUnits` call, the "No win on N lines" text). Guarded by a headless regression
  check: override `Math.random` with a seeded LCG, start a non-instant `play()`, click a
  different line button mid-spin, and assert the reported total equals the sum over
  `spinWinUnits(spin.ev, 9)` (not the mutated 1).
- RTP was calibrated with a 600k-spin Monte Carlo over `resolveSpinSequence`
  (9 lines, no perks): **≈0.927** total (line ≈0.881 + scatter/free ≈0.046), hit freq
  25.4%, ~1 free-spin feature per 162 spins. 1/3/5 lines all land ≈0.93; the luck curve
  runs 0→0.927, 0.15→0.962, 0.3→0.988, 0.75→1.187 (comparable slope to the other tables).
  Tunables live in `CFG` in `slots-multi-math.js` (wild reels, `freeBoost`, tier luck
  multipliers, `retriggerCap`) plus the per-symbol `w`/`pay` table.

### Frogger Gamble math / calibration

- All physics live in `frogger-math.js` (no DOM), so the model can be re-run headless
  (`import` the file from a Blob URL in `execute_js`, or from the console). The frog's
  column is fixed at `frogX` (road centre); each lane is a **rigid convoy** of 2–5 cars
  with random widths (0.85→1.80, growing with depth), random gaps, random paints and a
  random direction, looping forever. Difficulty ramps over lanes 1→14 (`ramp: 13`) then
  holds: the guaranteed daylight window `cw` runs **1.70s→0.78s** and speed 1.8→3.4.
  `cw` is what actually sets the difficulty; every gap in a lane is at least `cw` long.
- `multFor(depth)` is now a **climbing ladder**, not a flat compound. `depth` counts lanes
  crossed from the verge: the free step onto lane 1 is `startMult` **×1.00** (dead even),
  the first two *chosen* crossings are `step2Mult` **×1.20** and `step3Mult` **×1.40**,
  then the prize compounds geometrically to `midMult` **×10 exactly at `midLane` = lane
  10**, and past that it adds a flat ×1 per lane (`midMult + (depth − midLane)`), so lane
  20 is exactly **×20** and it keeps climbing. The rungs:
  `1.00, 1.20, 1.40, 1.85, 2.46, 3.25, 4.31, 5.70, 7.55, 10.0 (lane 10), 11.0, …, 20.0
  (lane 20), 21.0, …`
- **The requested standing rule (this is the important part).** A hop lasts `hopSec`
  (0.2s). While the frog is airborne it is tested against every lane its body spans
  (`overlappedLanes`) **except the lane it just left** — the road holds that one back and
  the frog is over the paint anyway — so what kills you is the lane you are jumping
  *into*. On landing, the lane you land in is **frozen for `blockSecFor(depth)` seconds**
  (`blockHi` 1.8s down to `blockMin` 0.9s over the first 15 lanes): traffic in it stops,
  the frog gets a genuine safe pocket to stand in, and the lane resumes flowing when the
  pocket lapses. `CONFIG.froggerBlockSec` (root tunable `froggerBlockSec`) is that
  starting value. A very large value = standing is permanently safe (trivially
  exploitable); 0.5–2.5s barely changes the maths, it only changes how long you may
  *think*. Nothing is hidden from the player: every car that can hit them is drawn on
  screen, so the outcome is execution, not a dice roll.
- **Measured with a patient bot** (2 000 rounds/config, dt 1/90, hopping the instant
  `clearFor(lane+1, frogX, halfW, hopSec)` says the destination lane is clear). `EV` is
  the mean returned multiplier:

  | bank at lane | multiplier | EV (patient) | death rate |
  | --- | --- | --- | --- |
  | 1 | ×1.00 | 1.000 | 0% |
  | 2 | ×1.20 | 1.200 | 0% |
  | 3 | ×1.40 | 1.391 | 0.7% |
  | 5 | ×2.46 | 2.431 | 1.0% |
  | 6 | ×3.25 | 3.209 | 1.3% |
  | 8 | ×5.70 | 5.585 | 2.1% |
  | 10 | ×10.0 | 9.610 | 3.9% |
  | 12 | ×12.0 | 11.508 | 4.1% |
  | 15 | ×15.0 | 14.040 | 6.4% |
  | 20 | ×20.0 | 18.150 | 9.3% |

- **The balance consequence, stated plainly: the ladder is still player-favourable at
  every rung.** EV is `multiplier × survival`, and the patient bot survives enough that
  **EV > 1.0 everywhere** — banking early is a money printer, and because EV keeps rising
  with depth, a patient player's best line is simply "keep going". Lane 10 returns ≈0.96 ×
  fair (×10 at a 3.9% death rate) and even lane 20 returns ≈0.91 × fair. The old
  `0.75 × 1.25^depth` curve was player-favourable too, so this change is a *re-shape*
  rather than a fix: the entry step is now a full **×1.00** (was ×0.75) and the first two
  crossings pay a flat **×1.20 / ×1.40** before the geometric curve takes over — which is
  exactly the "climb from 1.2, 1.4, … to ×10 by ten and ×20 by twenty" request. The death
  rate only bites when the player *can't* wait: the same bot jumping the instant a hop is
  legal is destroyed (the pocket shrinks and the gaps tighten with depth). If a genuine
  house edge is wanted back you must change the payout curve or the risk model, not the
  pocket: cut `midMult`/`startMult`/`step2Mult`/`step3Mult`, tighten `cwLo`/`cwHi` (less
  daylight per lane), or raise `speedLo`/`speedHi`. Ask before retuning — the
  ×10-at-10 / ×20-at-20 identity is the user's explicit request.
- Tunables: the payout ladder (`startMult`, `step2Mult`, `step3Mult`, `midLane`, `midMult`)
  in `FROG_CONST`; the difficulty curves (`ramp`, `cwLo`/`cwHi`, `speedLo`/`speedHi`,
  `carWLo`/`carWHi`, `carsLo`/`carsHi`, `gapVar`); the frog's mobility (`hopSec`,
  `settleSec`, `frogHalfW`/`frogHalfH`, `initLo`/`initHi`); and the pocket
  (`blockHi`/`blockDecay`/`blockMin` or the `froggerBlockSec` root tunable).

## Info cards (ⓘ How to win)

**Every** machine now has the same style of help card, opened by a `ⓘ` button that lives in
the stage header (top-right, next to the blurb). The button is the shared `infoBtn()`
(`.infobtn`) and it collapses to a bare `ⓘ` below 520px so it never wraps the header. The
card itself is a `780px` modal whose body is a `.ic` flex column holding:

- a **`.ic-top` two-column area** (`flex` + `wrap`) — a left `.ic-map` panel with the
  game's visual/diagram and an optional interactive legend, and a right `.ic-col` of
  `.ic-sec` rule boxes (`.ic-col` is `flex:1 1 300px`, `.ic-map` is `flex:0 1 auto` +
  `max-width:100%` so the pair sits side by side on desktop and **stacks cleanly on
  phones** — verified overflow-free at 320px, 390px and 1440px);
- then one or more full-width sections, usually a **pays** row built from `payChips()`
  (the same `.ml-pay`/`.mlchip` grid the Fortune Lines cabinet uses) plus a `note()`.

Everything is composed from the primitives exported by `src/games/infocard.js`:

| export | what it makes |
| --- | --- |
| `infoBtn(onclick, label?)` | the header `ⓘ` button (default label `HOW TO WIN`) |
| `openInfo(title, body, width?)` | the modal itself (`modal()` from `ui.js` + a `GOT IT` button) |
| `sec(title, ...kids)` / `ul(items)` / `note(html)` / `cap(html)` | a `.ic-sec` rule box, a bullet list (items are HTML strings → `<li>`), a `.ic-fs` footnote, a `.ic-cap` caption |
| `examples(...rows)` + `exampleRow(cells, noteHtml)` | the worked-example rows (`.ic-excell` chips) |
| `payChips([{glyph, main, note, cls}])` | the payout chip grid |
| `gridMap(cols, rows, {cell, gap})` | a `.ic-cell` CSS grid **plus** an overlay `<svg>` (`.ic-svg`) sized to it; returns `{node, cells, svg, px(c), py(r), …}` so a game can draw polylines/rings through cell centres |
| `legend(items, onPick, allItem?, initial?)` | a `.ic-lbtn` button row; `onPick(value)` fires immediately for the initial selection, so the card is always in a consistent state |
| `svgEl(tag, attrs, ...kids)` / `markCells(cells, coords, color)` | SVG-namespace element builder + a `.lit` highlighter for grid cells |

**Convention for each card:** lead with a *visual* that shows what a win looks like
(a grid/scenario viewer, a chart, a ladder, a key), wire the legend to highlight the
relevant cells/marks and swap a caption, then answer *how a round wins* in the right-hand
rule boxes, and finish with the payout schedule. Lucky-Coin interactions get their own
box where the machine has one.

Current cards (all verified rendering + opening through the real `stageShell`, on a
**detached** instance so no money moved):

- **Slots** — 3×1 scenario viewer (3 MATCH ⭐⭐⭐ 200× / PAIR 🔔🔔🍒 2× / NO WIN) with a gold
  payline; sections *How a spin wins* / *Premium pairs* / *Lucky Coin perks*; a
  *Pays per credit* chip row over `SYMBOLS`.
- **Fortune Lines** — the original 5×3 / 9-payline map with the `ALL 9` + `1…9` legend
  (this card is the design the rest were modelled on).
- **Roulette** — a real 3×12 felt (numbers coloured red/black) under a full-width green
  `0`, with a 13-bet `.ic-legend` (STRAIGHT / RED / BLACK / EVEN / ODD / 1–18 / 19–36 /
  3 dozens / 3 columns) that rings the pockets each bet covers; sections *How the felt
  works* / *What each spot pays* / *The house edge* / *Lucky Coin perks*; a *Pays per $1
  on a spot* chip row.
- **Blackjack** — a four-row example viewer (`FOUR WAYS A HAND ENDS`: 20 beats 15 /
  blackjack / push / bust) with card chips; sections *How a hand plays out* / *Your three
  moves* / *The dealer's rule* / *Lucky Coin perks*; a payout chip row (2x / 2.5x / 1x / 0).
- **Horse Racing** — an SVG payout curve `clamp(0.92/p, 1.05, 60)` with 4 dots
  (50%→1.84×, 25%→3.68×, 10%→9.20×, 5%→18.4×) and a 4-button legend that enlarges the
  dot and rewrites the caption; sections incl. *The payout curve*.
- **Rocket Crash** — an `.ic-ladder` bar chart of the reach odds (1.5× 64.7%, 2× 48.5%,
  3× 32.3%, 5× 19.4%, 10× 9.7%); sections *How a round wins* / *Auto cash-out* /
  *The crash point* `P(crash≥m)=0.97/m` / *Lucky Coin perks*.
- **Treasure Chests** — a 3×3 chest grid with an `ALL`/`PAYS`/`TRAPS`/`STAR` legend that
  lights the four pay tiers, the four traps and the ⭐; sections *The setup* / *The Lucky
  Star* / *Expected return* (the 200% math) plus a *Pays on your bet* chip row.
- **Ghost Muncher** — a "what's on the board" key (pellet / power pellet / muncher + the
  four ghosts with their behaviours, drawn as coloured `.ic-ghost` shapes) and a live
  `.ic-kv` readout of the jackpot pot; sections *The goal* / *Lives and time* /
  *Power pellets* / *The jackpot*.
- **Frogger Gamble** — the `.ic-ladder` payout ladder (13 rungs, bars scaled to
  `multFor(lane)`, the ×10+ rungs tinted hot) plus a `.ic-kv` of the safe-pocket timings;
  sections *How you play* / *The ladder* / *Safe pockets* / *Getting flattened*.

Adding one to a new game: import the primitives, pass `{ info: infoBtn(() => openInfoCard()) }`
as the third argument to `stageShell` (everything after it is the usual stage content), and
define `openInfoCard()` inside `create()` — function declarations hoist, so it can be
defined below the `stageShell` call. `stageShell(title, blurb, opts, ...kids)` renders the
`ⓘ` header only when `opts.info` exists, so games that pass no options are unaffected.

## Config tunables (in `main.pjs`)

| key | default | meaning |
| --- | --- | --- |
| `startingMoney` | 1000 | starting balance |
| `loanMinutes` | 60 | real-time loan window |
| `loanInterest` | 0.25 | repay = principal × (1 + interest) |
| `loanBase` | 1200 | base loan principal |
| `loanPerLevel` | 250 | extra principal per level |
| `idleDefaultBet` | 10 | initial idle bet |
| `xpBase` | 100 | level 1 XP requirement (`xpBase × level^xpExp`) |
| `xpExp` | 1.3 | XP requirement exponent: `need(L) = xpBase × L^xpExp × xpTierSpike^tier` |
| `xpTierSize` | 10 | levels per milestone tier (walls at 11, 21, 31, …) |
| `xpTierSpike` | 2 | XP-cost multiplier added per completed tier (2 ⇒ the cost doubles at each wall) |
| `xpRate` | 0.1 | XP per dollar wagered |
| `idleXpMult` | 3 | idle rounds animate at full speed, so they earn this much XP per stake to keep idle XP/min comparable to active play |
| `levelLuck` | 0.002 | +luck per level |
| `levelReward` | 50 | cash reward = `levelReward × newLevel` |
| `chestHigh` | 10 | top treasure-chest payout multiplier |
| `chestGem` | 3 | second chest multiplier |
| `chestMid` | 2 | third chest multiplier |
| `chestLow` | 1 | low chest multiplier (four of the nine chests pay; the ⭐ star's re-pick is worth the average chest, so RTP = `(high+gem+mid+low)×(9/8)/9` = 200%) |
| `rouletteMaxBetBase` | 400 | Roulette table limit = `base × level^exp`, rounded **down** to the nearest $10 (floor $10). Bet clamps to `min(balance, limit)` |
| `rouletteMaxBetExp` | 1.35 | Exponent for the roulette table limit: `400 × L^1.35` → L1 $400 · L10 ≈$8.9k · L30 ≈$39k · L60 ≈$100k |
| `froggerBlockSec` | 1.8 | Frogger: seconds the road blocks the lane you just landed in (the safe pocket). Non-zero only; a huge value makes standing permanently safe |

## Ghost Muncher notes

- `genMaze()` is a recursive-backtracker carve plus ~42% extra loop punches and a cleared
  central den, so every play gets a fresh, connected, loopy maze.
- Entities move on integer tiles with a `prog` (0→1) fraction, so there is no floating-point
  drift; ghosts pick a direction at each tile via `ghostChoose` (chase / ambush / wander /
  patrol modes with a periodically refreshed bias). Power pellets frighten ghosts and let
  you eat them for a scatter respawn.
- The rAF loop only runs when actively playing (and for the idle attract screen); it stops
  on `done` and is re-armed by `startLevel()`. `destroy()` refunds an in-progress round
  (`multiplier: 1`) so switching machines mid-game is not a loss.

## Debug API

`window.casino` exposes `{ state, app, playRound, game, computeEffects, perkCost,
buyPerk, takeLoan, repayLoan, resetRun, clearSave, mountGame, setIdle, renderTop,
doReset, openHistoryModal, renderHistoryPanel }` for console/browser testing. Note
`resetRun()` resets state but does **not** re-render; use `doReset()` for a full UI reset.

## Rebuild / test notes

- The app is plain ES modules under `src/`; no build step. Edit and reload.
- Visual game assets are drawn with canvas (roulette wheel, horse track, crash graph) or
  emoji glyphs (slots), so there are no binary assets to rebuild.
- To sanity-check a table: `casino.mountGame("roulette")` then `casino.playRound(true)`.
- Treasure Chests: `casino.mountGame("chest"); casino.playRound(true)` reveals all nine
  chests instantly and should always show exactly **4 paying (×10/×3/×2/×1) + 1 ⭐ Lucky
  Star + 4 trap** chests. A 6 000-play headless sweep gave traps 49.7%, each pay tier
  ~12.5%, mean multiplier **2.0165** (exact RTP 2.00), and a spent star 10.6% of the time
  (≈1/9). The star's re-pick is verified interactively by forcing the star into a known
  chest (`Math.random = () => 0.9999`), clicking it, and checking the grid re-arms with
  that chest excluded (`.star-spent`) and the second pick resolves normally.
- Ghost Muncher: `casino.mountGame("arcade")` shows the attract screen; click PLAY then
  drive with arrow keys (or `window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft"}))`).
  It is `canIdle:false`, so idle no-ops there.
- Whole-dollar check: `casino.state.money = 900.13; casino.renderTop()` must render `$900`
  (and `900.86` → `$901`).
- Frogger: `casino.mountGame("frogger")` shows the cabinet; press PLAY then CROSS/BANK (or
  arrow keys). Each game is `canIdle:false`. The traffic is a deterministic stream seeded
  per run, so the model in `frogger-math.js` can be re-simulated headlessly; the README
  table above is the reference calibration. **CROSS/BANK listen on `pointerdown`, not
  `click`** — `document.querySelector(".fbtn.cross").click()` does nothing; dispatch
  `new PointerEvent("pointerdown",{bubbles:true,cancelable:true})` or send arrow keys.
- Slots: the reel metrics are read from the DOM (`metrics(reel)` = cell height + how far
  the strip must sit up so the cell centre lands on the payline centre), and `create()`
  re-centres the resting symbols on the next frame + on every `.reels` resize, because the
  stage is often still hidden when the machine mounts (so the first measurement reads
  zero-height boxes and would leave the row a hair low). Verified: the winning cell centre
  == payline centre exactly at 390×844 and 1920×1080, before and after a spin.
- Slots stagger: `startSpin` starts all three reels, then the controller awaits each
  reel's duration in turn and removes `.spinning` / adds `.landed` for that reel only.
  Verified by polling the reel classes every 100 ms: `SSS…` → `LSS` (~0.9 s) → `_SS` →
  `_LS` (~1.7 s) → `__S` → `__L` (~2.5 s) → `___` — strictly one at a time.
- Slots random spin + blur + land FX (verified): each animated spin gives every reel a
  jittered count (`[18,34,50] + rand(0..9)`) and duration (`[900,1700,2500] + rand(0..110)` ms);
  the filler strips came back 23–25 cells with all 6 glyphs present and **max run length 1**
  (no adjacent repeats), and five consecutive spins landed different triples. The inline
  blur went 15.4 → 0 px on reel 0 (desktop cells 140 px → `maxBlur = clamp(140×0.11, 6, 17)`)
  and 11.2 → 0 px at 390×844 (cell 102 px), **one `.reel-landfx` burst at a time**, and all
  strip filters were empty after the round. `.slot-cabinet.thump` fires on the final drum.
  CSS animations are frozen in the preview, so the burst was proven by pausing it
  (`animation-play-state:paused; animation-delay:-0.18s`): the sweep read
  `translateY(66.8px)` opacity 0.62 and the pop `scale(0.81)` opacity 0.81 — i.e. mid-flight.
- Slots detent bounce + unified stop FX (verified): the Slots reel-stop glow was re-skinned
  to match Fortune Lines — `.reel.landed` now runs the same `mlLand` cyan frame animation
  (the old gold `reelLand` keyframes were deleted) and `.reel-landfx`'s sweep/flash use the
  same `rgba(233,251,255,…)` / `rgba(127,227,255,…)` colours as `.ml-landfx`. Both slot
  machines now finish every reel through the shared settle: the smooth transform
  deliberately overshoots the mark by `settleOffset(cellH)` px (`clamp(cellH×0.12, 4, 16)`),
  then `reelSettle` runs for `SETTLE_MS` (470 ms) — springs back across the mark, dips, and
  ends on a final accelerating segment that stops dead on the mark — and `endSettle` locks
  the inline transform to the exact `translateY(landY)` with `transition:none`. CSS animations freeze in the preview, so the
  bounce was proven by pausing `reelSettle` (`animation-play-state:paused` +
  `animation-delay:-0.XXs`) and reading `getComputedStyle().transform`: 10 % → `-98.8px`
  (pre-settle), 34 % → `-92.3px` = `--sy2` (rebound apex), 98 % → `-100.2px` ≈ `--sy`
  (`-100px`, hard-stuck mark). `mountGame("slots")` → `mountGame("slots-multi")` produced no
  console errors (the `destroy()` bug — `landYs[i]` outside the `forEach((r, i))` callback
  — is fixed).
- Roulette multi-spot + level limit (verified with a **detached** instance, so no money
  moves): `const mod = await import("./src/games/roulette.js"); const g = mod.default.create({ effects:()=>({luck:0}), get bet(){return 40;}, refreshBet(){}, confetti(){}, toast(){} })`.
  Clicking spots only mutates an internal `picks` Map — `paint()` (which writes the chip
  labels + `.on` classes) runs when the controller calls `onBetChange()`, so a detached
  test must call `g.onBetChange()` after each click. Forcing the outcome with a temporary
  `Math.random = () => ORDER.indexOf(n)/37` gave exactly **36×** on one straight number,
  **18×** on two numbers when one wins, and `(2+2+3)/3` on RED+EVEN+1st-12 at n=4 (n=4 is
  black, so that spot correctly loses). `maxBet` returns 400 / 8950 / 39460 / 100590 at
  L1/10/30/60. Clicking more spots than the bet allows is refused (toast), and `canPlay()`
  is false while `bet < picks.size`. The ball is driven by a 16 ms `setInterval`, so it
  **does** animate in the frozen preview — 11 distinct transforms sampled during one spin,
  landing at the pointer (`translate(56px, 5.84px)`).
- Blackjack (verified with a detached instance): 120 headless rounds
  (`g.play(100,{instant:true,auto:true})`) produced **no errors** and all five branches —
  win 43 / lose 45 / bust 20 / push 9 / blackjack 3 — with multipliers `{0,1,2,2.5}` and
  the matching tag each time. The diffed render is confirmed by the hole card keeping the
  *same* node across `hidden`→revealed (dealer index 1 gains `.reveal`, never re-created)
  and by the hand node count matching the dealt cards when the hand grows/shrinks. The
  hidden hole card computes to `rotateY(180)` with `backface-visibility:hidden`; pausing
  `cardFlip` at `-0.27s` gives `rotateY(≈92°)` mid-flip; after `forwards` completes it is
  the identity matrix (front up). The felt/arc/shoe/rules-line/cards were screenshot-checked
  (see the capture note below) — arc text sits in its own flow band above the dealer row
  and no longer collides with it.
- Save-safety caveat when testing: do **not** drive real rounds through the live page
  (`casino.playRound(...)` or clicking `.playbtn`) while the user has an in-progress save —
  a test round really does move their balance and the async round tail can re-write state
  after you restore it. Write corrected bytes straight to
  `localStorage["casino-royale.save.v1"]`, `page_refresh` (the reload discards any pending
  async writer), then re-verify a few seconds later. To prove a CSS/DOM effect without
  spending money, pause the animation or use a detached temp element rather than playing a
  round.
- Fortune Lines stagger + blur: `casino.mountGame("slots-multi")` then
  `casino.playRound(false)` and poll the 5 `.mlreel` classes every ~110 ms. Verified
  series: `SSSSS` → `LSSSS` (~0.96 s) → `_LSSS` (~1.31 s) → `__LSS` (~1.77 s) →
  `___LS` (~2.24 s) → `____L` (~2.71 s) → `_____`, i.e. exactly one drum locks at a
  time with a single `.ml-landfx` burst each. The strips' inline `filter: blur(Npx)`
  fell smoothly from 8.5→0 px (reel 0, 680 ms) and 13→0 px (reel 4, 2.44 s) over the
  spin, and every strip's filter was cleared at land (checks `strips.filter(s=>s.style.filter).length === 0`
  and `.ml-landfx`/`.landed` counts back to 0 after the round). The blur is driven by a
  33 ms interval, so unlike CSS transitions it *does* animate in the preview.
- XP milestone walls: `casino.state.level = L; casino.state.xp = 0; casino.renderTop()`
  then read `#xpTextEl` / `#tierEl`. Verified need = 100 × L^1.3 × 2^floor((L-1)/10)
  (L10 → 1,995 · L11 → 4,517 · L20 → 9,826 · L21 → 20,938 · L31 → 69,480 · L41 → 199,866),
  with the tag hidden for L1–10, `★ TIER n ×m` inside a spiked tier, and `⚠ NEXT TIER`
  at L10/20/30/… . Restore the save afterwards.
- Win popup: force a win and check the banner, e.g.
  `casino.mountGame("roulette")`, place a straight-up bet, `Math.random = () => 0`, then
  `casino.playRound(true)` — a `YOU WIN / $X / 36x` popup appears in `#fxLayer`, then is
  gone after its ~2.5 s fade. It is suppressed for instant/idle micro-wins (< $50).
- History: rows render as a 4-column grid (icon / meta / result / amount) with an 8 px
  gap and no overlap; wins get a green 3 px left border (verify with
  `getBoundingClientRect` + `getComputedStyle`). `renderHistoryPanel()` is called after
  every `recordPlay`, on `buildBetPanel`, and on `doReset`, and the modal (top-bar
  HISTORY button or **VIEW ALL**) lists all ≤150 stored hands with a summary line.
  No horizontal overflow at 390×844 or 1440×900.
- Screenshot gotcha: the `ai-agent.perchance.org/files/snapshot.js` helper currently
  **hangs**, and `vision`'s `selector` only accepts a bare `<canvas>`/`<img>`. For DOM
  captures, `html2canvas@1.4.1` is the fallback but it does **not** render
  `display:grid`, gradients/borders reliably, and it **cannot render absolutely-positioned
  card faces** (the blackjack `.card-face.front/.back` collapse into a strip of text) —
  so prefer **`modern-screenshot@4.4.39`**: `const { domToCanvas } = await import("https://esm.sh/modern-screenshot@4.4.39"); const c = await domToCanvas(el,{scale:2,backgroundColor:"#0b0f16"});`
  then append the returned canvas and `vision` its selector. It renders CSS gradients,
  flex layout, SVG + `<textPath>` and shadows faithfully. Two caveats: (1) it can't handle
  3D (`transform-style:preserve-3d` / `backface-visibility`) — inject a temporary
  stylesheet that flattens `.card-inner{transform:none!important}` and shows only the
  desired face before capturing the blackjack cards; and (2) **both** libs render with
  **fallback fonts** (the Google Fonts stylesheet is cross-origin, so its `cssRules` can't
  be read/inlined), so never judge text widths or line-wrapping from a capture. Also,
  `.card{animation:dealIn}` is frozen at **t=0** in the preview (leaving cards at
  `opacity:0`), so set `style.animation="none"` on the cards before capturing.
- Idle: `playRound(false, { idle: true })` plays a *full animated* round at normal speed
  and multiplies XP by `idleXpMult`. Verified on Slots: rounds spin continuously and XP
  rises ~3× per stake. Blackjack's `play(stake, {auto})` auto-acts so animated idle can't
  stall on `waitAction()`.
- Idle brains (verified with `casino.playRound(true, {idle:true})`): Roulette lights RED or
  BLACK at random (8 spins alternated); Horse varies its pick across the field over 12
  races; Blackjack auto-strategy over 80 hands gave 31 win / 40 loss / 9 push with doubles
  fired and no errors; `setIdle(true)` on crash/arcade/frogger leaves `state.idle.on` false.
- Caveat when testing in the Perchance preview: the preview page is `document.hidden`, so
  CSS transitions/animations do **not** progress and rAF fires ~once. Slot reels therefore
  appear frozen mid-spin, and Frogger's canvas only advances if you shim
  `requestAnimationFrame` with a `setTimeout`-driven virtual clock. Compare
  `getBoundingClientRect` after forcing `transition = "none"`, and drive frogger with the
  shim, or the numbers you measure will be wrong.
- **Canvas sizing gotcha (important for future work):** `ResizeObserver` callbacks do
  **not** reliably fire in the Perchance preview harness, and a lone `window` `resize`
  listener can read a stale layout before responsive CSS settles — so a canvas sized only
  at mount + on `ResizeObserver` can end up stuck at its desktop width and overflow a
  phone screen. Every canvas game therefore self-heals:
  - `frogger.js` / `arcade.js` re-run their `resize()` every 10th rAF frame (guarded by a
    size check, so it's a no-op when nothing changed).
  - `crash.js` / `horse.js` / `roulette.js` run a 320ms `setInterval` that re-draws only
    when the container width changed (and clears itself once the node is detached).
  - `slots-multi.js` already polled its overlay size at 320ms.
  Any **new** canvas game must include one of these, or it will overflow on narrow
  screens. Verified at 390×844: no horizontal overflow on any machine.
- To sanity-check Fortune Lines: `casino.mountGame("slots-multi")`, set the line button
  (`document.querySelector('.ml-linebtn[data-lines="9"]').click()`), then
  `casino.playRound(true)` — the balance should drop by `bet × lines`. Force a grid by
  temporarily replacing `Math.random` (e.g. `() => 0` → all cherries, 9 winning lines).
