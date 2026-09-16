# Dev notes (for whoever works on this next)

Player-facing docs live in `README.md`. GitHub Pages deploy steps live in `DEPLOY.md`.
This file is the architecture map.

## How the page loads

- The Perchance generator's real page is the **repo-root** `index.html` (it loads `src/styles.css`
  and `src/main.js` by relative path).
- `src/index.html` is a **separate copy** kept only as the GitHub Pages entry point (it loads
  `styles.css` / `main.js` with the `src/` prefix stripped). Change both when you change the shell,
  or at least keep their `<meta>`/`<title>` in sync.
- `main.pjs` holds `$meta` plus every tunable. It is the config file — game logic reads its values
  off `root` through `CONFIG` in `src/state.js`. **Retune the games there, not in the game files.**

## Modules

| file | role |
| --- | --- |
| `src/main.js` | shell: topbar, machine nav, bet panel, round lifecycle, perks/loan/history/bankrupt modals |
| `src/state.js` | `CONFIG` (reads `main.pjs`), save/load (IndexedDB via kv-plugin), money, XP/levels, loans, history |
| `src/perks.js` | perk definitions, costs, stacking, `computeEffects()` / `applyPerks()` |
| `src/ui.js` | `el()`, `fmt()`, toasts, modals, confetti, win popup, floating text |
| `src/audio.js` | `sfx.*` sound bank — synthesized, except Russian Roulette's `cylinder()`, which plays the recorded take in `src/audio/` and drives the drum from its clack times + the global click/win sounds |
| `src/music.js` | background music |
| `src/games/index.js` | `GAMES` array — the nav order comes straight from this |
| `src/games/common.js` | `stageShell()` (the shared machine chrome), `clamp`, `round2` |
| `src/games/infocard.js` | "HOW TO WIN" card helpers: `svgEl`, `openInfo`, `sec`, `ul`, `note`, `cap`, `payChips` |
| `src/games/*.js` | one machine each |
| `src/styles.css` | one section per machine (see the `============ NAME ============` banners) |
| `src/*-math.js` | pure RTP/EV helpers kept out of the DOM code |

## The machine contract

Each machine default-exports an object and is mounted by `src/main.js`:

```js
export default {
  id, name, icon, action,          // action = the bet panel's PLAY button label
  canIdle: false,                  // false disables the IDLE auto-play toggle for this machine
  minBet: 1,
  blurb, payoutNote(),             // payoutNote() returns an HTML string shown in the bet panel
  create(app) {                    // app.confetti(n) / app.sound etc.
    return { root, play, actionLabel, destroy };
  },
}
```

- `play(stake, opts)` must resolve to `{ multiplier }`. `multiplier` is on the **stake**, so the
  shell turns it into `payout = stake * multiplier * perks`. Return `multiplier: 0` for a loss and
  `{ multiplier: 1, cancelled: true }` if `destroy()` interrupted the round.
- `play` must also handle `opts.instant` / `opts.auto` / `opts.idle` synchronously and without the
  UI (machines with `canIdle: false` can no-op this path).
- `destroy()` must remove any `window` listeners and resolve any pending promise.
- Betting is always `stake × lines`; the shell charges the stake before calling `play`.

## Where the PLAY button lives

The shell owns exactly **one** `.playbtn` (built in `buildBetPanel()`), and `placePlayButton()` in
`src/main.js` decides which container holds it:

- **≥901px:** reparented into `.playbar` — a bar that is the last flex child of `#stage`, so it
  pins along the bottom of the game area, spanning it, with the button centred (`max-width:460px`).
  It therefore reads as the game's own last row, directly under the machine's buttons (SPIN/CASH
  OUT, mode switches, etc.) instead of sitting off in the right-hand column. `#stage` is a flex
  column and `.stage-inner` above it keeps `overflow:auto`, so a machine that needs the height
  scrolls rather than being squashed.
- **≤900px:** back inside `#betPanel`, inserted between the chips and the payout note (where the
  stake controls are). `.playbar` is hidden there by the responsive block — the media-query
  `change` listener reparents the real element, it does not duplicate it.

It is always the same element, so every `playBtn.disabled = ...` / `playBtn.textContent = ...`
written by a machine (and by the round lifecycle) keeps working across a resize. `mountGame()`
re-appends `playBar` after `clear(topbar.stage)`, since clearing the stage detaches it.

## History & per-table statistics

`state.history` is the rolling hand log (capped at `HISTORY_MAX` = 150) and drives the *recent hands*
list only. The **lifetime, per-table** numbers come from `state.stats.byGame[id]` — one bucket per
machine, written by `recordPlay()` in `src/state.js`:

| field | meaning |
| --- | --- |
| `plays` | hands played on that table |
| `staked` / `returned` | gross money in / out, so `returned - staked` is the net |
| `wins` / `losses` | hands that paid more / less than the stake; pushes are neither |
| `won` / `lost` | gross profit (sum of the positive `payout - stake`) and gross losses (sum of the rest) |
| `best` | biggest single payout |

`won - lost === returned - staked` always — `recordPlay()` adds a hand to one side or the other, never
both — and `wins + losses <= plays`, the difference being pushes (hands that returned exactly the stake:
blackjack stand-offs, a roulette bet on an untouched pocket, etc.). The win rate the UI shows is
`wins / plays`, **not** `wins / (wins + losses)`, so pushes pull it down; the note line under the sheet
says so, and each rate cell carries a `title` tooltip spelling out "N hands, N wins, N losses, N pushes"
(`recordText()`).

UI: `tableBreakdown()` in `src/main.js` builds a row per machine (played tables first, most hands first,
then the untouched ones in `GAMES` order) and feeds two views — `tableSummaryMini()` in the bet panel
(icon / table / net / win %, top 6, then "+N more · VIEW ALL") and `tableBreakdownTable()` in the history
modal (Table | Hands | Won | Lost | Net | Win rate, an "All tables" totals row, then a "Not played yet"
divider with dimmed zero rows). Won/Lost/Net cells print an em-dash instead of `$0`. The modal's headline
summary strip is built from `state.stats` (lifetime), **not** from the retained log, so it always agrees
with the "All tables" row.

Per-table data is per run — `resetRun()` clears it with the rest of the stats. Old saves predate the
`byGame` buckets, so `loadState()` reads `stats.byGameV` out of the **raw save** and calls
`migrateByGame(true)` whenever it differs from `BYGAME_MIGRATION` (3). Two rules when touching this:
bump `BYGAME_MIGRATION` (and the same constant inside `newRun()`) whenever the bucket semantics change,
and keep the check reading `data.stats` — testing `state.stats` after `Object.assign` sees `newRun()`'s
default and the migration silently never runs. The three branches keep `won - lost = net`: exact
(the retained log covers that table's whole life, so it is replayed), priced estimate (sample the log's
win/loss ratio, scale it to `plays`, `lost = losses × average stake`, `won = lost + net`), and a one-way
fallback when the table has no sample at all.

Responsive: the sheet is a 6-column `grid` above 640px; at ≤640px the `@media` rules make each row two
lines (the name spans the row, the five numbers sit below it in 5 columns, the `Table` header and the
`+` signs are hidden). Keep that media block **after** the base `.hist-*` rules in `src/styles.css` or
the cascade drops it.

## Admin console & password

The 🔑 window in the bottom-right corner takes cheat codes (`CHEAT_CODES` in `src/main.js` — the
keys are lowercase, matching is case-insensitive, and the console's FORTUNE CODES list is built
straight from this map, so a new code appears there automatically). Current codes:
`winnerwinnerchikendinner` +$1,000, `losergottoeat` +$20,000, `isuckatthisgame` +$100,000,
`whosyourdaddy` +$100 (the tiny Easter egg). The
`admin` is the keyword for the admin console. That keyword does **not** open it by itself any more:
it switches the window into password mode (masked input + a "RESTRICTED" hint), and the console
opens only after a correct password. Typing the password straight into the code window also works
(both routes go through `tryAdminPass`).

- `ADMIN_PASS_HASH` holds only the **SHA-256** of the password (`sha256Hex` → `crypto.subtle`,
  compared in `isAdminPass`), so the plaintext is not in the source. Say this plainly to anyone who
  asks: it is a lock on the door, not a vault — the game and its save both live in the player's own
  browser, so a determined cheater edits the save directly. Hashing just keeps the password from
  being readable at a glance.
- To change the password: SHA-256 the new one and replace the hex constant.
- Wrong guesses are rate-limited: `ADMIN_MAX_TRIES` (3) then `ADMIN_LOCKOUT_MS` (30 s) of lockout;
  the panel shakes and the toast counts down the remaining attempts. The lockout is in-memory, so a
  reload clears it — deliberate, this is not a real security boundary.
- The unlock is **session-only** (`adminUnlocked`), which is what a cheat menu wants: type it once,
  play, and a reload puts the lock back.

## Testing

The live preview is the real engine, so `page_eval` is the fastest loop. Two tricks that make
machine testing deterministic:

- **Seeded drum/roll:** machines (and therefore `selectOne`) use `Math.random` — stub it before
  clicking PLAY/SPIN to force a specific outcome, then restore it. Russian Roulette shuffles its
  hidden load with `CH-1` calls and only THEN draws the landing chamber as
  `floor(Math.random() * CH)`, so one constant can't pin both. `Math.random = () => 0.99` keeps a
  one-live drum at chamber 0 and lands chamber 5 — a reliable blank on any rung (survive → the
  bank climbs a rung; repeat it ten times and you have walked the whole ladder).
  To force the round, walk a sequence: `let q=[.99,.99,.99,.99,.99,.05], i=0; Math.random = () =>
  q[i++];` — the shuffle is a no-op and the hammer lands chamber 0, where the live round sits.
  See `rolledLoad` / `rungFor` / `spin`.
- **Rendering SVG to look at it:** `vision` only reads `<canvas>`/`<img>`, and the full-page
  snapshot helper stalls while the preview iframe is `document.hidden`. To eyeball a machine's
  SVG, serialize the live node, inline `src/styles.css` inside it, rasterize through an
  `<img>` data URL onto a `<canvas>`, and save via `page_eval`'s `resultPath`. Give the clone
  explicit `width`/`height` attributes — `height:auto` inside a `foreignObject` collapses to zero.
  (Nested `<svg>` does not rasterize this way — a machine's drum comes out blank — so verify
  SVG-only pieces numerically via `getBBox`/`getBoundingClientRect` instead.)
- **Driving animations while the preview is hidden:** `document.hidden` also throttles `setTimeout`
  to ~1/s and pauses `requestAnimationFrame`, so an animated machine (Russian Roulette's ~1.8 s
  whirl) appears to hang for minutes and clicks silently no-op. Fast-forward it instead of waiting:
  `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now() + 1e5), 5)` — the
  frame timestamp jumps past the tween's end so `animateSpin` resolves in one step (spins then take
  ~1s, bounded by the `setTimeout` steps in `fire()`). Keep the originals (`window.__origRAF`) and
  restore both `requestAnimationFrame` and `Math.random` when the test finishes. Useful timing
  facts to check against: a whole spin is `SPIN_MS` (±5%, ~1.7–1.9 s) from the first frame to the
  drum's rest, plus ~170 ms of beat before the hammer falls.
- **A machine that hangs mid-animation used to wedge the whole app.** `main.js`'s `playRound` awaits
  `inst.play()` and holds `playing = true` until it returns, so a machine that never resolves makes
  every later PLAY click a silent no-op (and the PLAY button stays disabled). Russian Roulette's
  `animateSpin` promise is only resolved by its own rAF callback, so a whirl cut short by
  `destroy()` — e.g. switching machines mid-spin — hung forever; `destroy()` now resolves the
  pending tween via `tweenResolve`. If PLAY goes dead during a test, that is the failure mode:
  `page_refresh` clears it.
- **The SPIN button is live before the round is listening.** `play()` sets the phase to `ready` and
  paints immediately, then sleeps ~520 ms of intro; a press in that window used to be dropped on
  the floor because `waitAction()` had not armed yet. `act()` now holds a `queued` action and
  `waitAction()` fires it the moment the round starts listening — so scripted tests can just click
  SPIN straight after PLAY, and a fast player is not ignored.

## Machine notes

- **Ghost Muncher** (`games/arcade.js`) is a real arcade maze — one random maze per play,
  `LIVES` lives and `TIME_LIMIT` seconds to eat every pellet and collect `WIN_SHARE` of the jackpot.
  Its difficulty constants come from main.pjs (`arcade*` → `CONFIG`), because the numbers matter
  more than they look. The current tuning is **small and slow**: a 13×9 board with ghosts that take
  600 ms per tile against the player's 380, which is a *readable* maze — you can see the whole thing
  at once and the ghosts telegraph everything they do.

  Three player-facing rules, all of which were tuned with the harness below:

  **1. The ghosts cannot walk through each other.** An exit held by another ghost is closed to them
  (`ghostOn`, and a mid-slide ghost still holds the tile it is *leaving* — miss that clause and the
  ghost behind slides in underneath it). A ghost with nowhere to go holds for `arcadeGhostBackoff`
  decision ticks — it re-decides every 90 ms while boxed in, so the shipped `6` is a ~half-second
  beat, and the live game's longest observed freeze is **8 ticks (~0.7 s)** — then backs out the way it
  came, which unsnarls a corridor queue instead of freezing it.
  `reverseGhost` has the same guard (a mode flip or power pellet would otherwise re-commit a ghost
  to the tile a friend is resting on — that, not the old "step through after 14 ticks" escape hatch,
  is what leaked overlaps). The rule is worth **−6 pts** to the bot on its own: queued ghosts are
  not hunting.

  **2. They are somewhat smarter, quietly.** `arcadeGhostRouting` makes ghosts break crow-flies ties
  with *corridor* distance (a cached BFS flood per target tile, `routeField`): an exit within 2 tiles
  of the best straight-line option is ranked by how far it actually is through the maze. It only ever
  breaks ties, so the ghosts still read as memorisable — they just stop walking into the wall between
  them and you. Worth ±2 pts, i.e. free. **`arcadeGhostRouting = 1` is a trap**: using corridor
  distance for the whole decision makes them *much* easier to dodge (bot 0.96 vs 0.90) because
  shortest-path routing makes them follow your tail instead of pressing through the maze to cut you
  off. Blue ghosts also flee properly `arcadeFrightFlee` of the time (+1 pt) and scramble randomly
  the rest, so a power pellet is not a free pass.

  **3. Blinky gets faster only when the board is nearly empty.** The old code's `if (eaten >= 0.2)
  1.22 else if (eaten >= 0.45) 1.1` meant the first branch always won, so Blinky ran at 1.22 from a
  fifth of the way in. Elroy is now a real three-gear ramp (`arcadeElroyPace`/`Hard`/`Rush` at 55% /
  75% / 90% of the board eaten) — it builds instead of lurching, and even the top gear is slower than
  the ghosts used to be. Worth −3 pts.

  | knob | old | now | worth (bot clear rate) |
  | --- | --- | --- | --- |
  | `arcadeCols` / `arcadeRows` | 15 / 11 (91 dots) | 13 / 9 (62 dots) | the request: a board you can read |
  | `arcadeGhostStepMs` (pac 380) | 430 | **600** | **the big one** — alone it lifts the bot from 0.38 to ~0.85 |
  | `arcadeLives` | 4 | 3 | −13 pts |
  | `arcadeFrightSec` | 7.5 | 4 | −5 pts |
  | `arcadePowerCells` | 3 (hardcoded) | 2 | −5 pts |
  | `arcadeTimeLimit` | 105 | 70 | −4 pts |
  | `arcadeGhost4Chance` | 0.35 | 1 | ~0 alone (0.90 vs 0.89); kept at 1 so the queueing rule and the four personas are always on show |
  | `arcadeGhostRouting` | 0 | 2 | ±2 pts — take the smarter-looking one |
  | `arcadeFrightFlee` | — | 0.7 | +1 pt |
  | Elroy | 1.22 from 20% eaten | 1.1/1.22/1.35 ramp | −3 pts |
  | no-overlap + back-off | ghosts passed through | never overlap | −12 pts |

  Net: the bot clears **45.6%** of mazes, a **0.85 return per play** (15% house edge). The bot cleared
  36% on the previous 15×11 / 430 ms tuning and ~15% before that, so this is a deliberately more
  forgiving machine without being a money printer. The jackpot pays `WIN_SHARE` (35%) of a pot that is
  `POT_BASE` (5×) and grows by `POT_STEP` (0.25×) per loss up to `POT_CAP` (14×), so the steady-state
  return per play is `0.35 · (0.25 + 4.75p)` for a clear rate `p`: it crosses even at `p ≈ 0.55`.
  Anything that pushes the bot past ~0.50 makes the machine a money printer for anyone with a little
  skill, which would break the perk/loan/bankrupt loop — so if a future retune wants more speed, more
  lives or more time, it has to buy them back somewhere (or lower `WIN_SHARE` and update the info card,
  the marquee copy and the nav's "take 35%" line together).

  How the numbers were measured (the harness is rebuilt in `scratch/`, which does not survive a
  session — this is the recipe): a headless port of `genMaze` / `ghostChoose` / `stepEntity` plus a bot
  player. The bot floods a multi-source BFS distance-to-nearest-pellet field and a danger field seeded
  from every non-frightened ghost, then scores each exit as `pelletDist`, `+ fear·(dangerR − ghostDist
  + 1)` when the ghost distance is inside `dangerR`, `+1.5` when the bot is itself inside `dangerR` and
  the candidate is closer to a ghost, `+1.5` for reversing and `−0.35` for carrying straight on; bot
  parameters `{danger: 2, fear: 6, revPenalty: 1.5}`. Each maze is `mulberry32(seed + i·7919)` so every
  variant runs the *same* mazes and the comparison is paired; 500–1000 mazes per setting across two
  seed sets. The sim's config keys are `COLS ROWS LIVES TIME_LIMIT PAC_STEP GHOST_STEP FRIGHT_TIME
  GHOST4_P POWER_CELLS ROUTING TOL FRIGHT_SMART NO_CLIP BLOCK_BACKOFF REV_GUARD ELROY_TIERS SPAWN
  DEN_HW DEN_HH LOOP_P`, with `CHECK` on to flag any frame where two ghosts' tiles (or the tile one is
  sliding off) coincide, and a `stuckTicks` counter for ghosts that hold for >400 steps — the shipped
  tuning reports **0 clip violations and 0 stuck ticks over 1,000 games**, so the no-overlap invariant
  is not merely usually true. `decideDivergence` (how often the corridor tie-break changes the pick)
  is ~5%, which is the "smarter but not obvious" target. In the live game the invariant is checked by
  reading the game's own ghost state: a temporary `window.__gm()` hook (**removed again** — it is not in
  the shipped file) exported `[tx,ty,px,py,prog,gliding,blockTicks]` per ghost, from which the *sprite*
  positions come straight out of `entityPos`. Over **2,369 live frames (39.5 s, 4 deaths)**: minimum
  sprite distance **exactly 1.000 tile**, **0** frames with two ghosts on one tile, **0** frames where
  both were gliding into the same tile. That 1.000 is the proof, not a coincidence — two grid-locked
  ghosts can only close to a tile apart, and the distance falling to *exactly* 1.0 means nothing ever
  got closer. A second pass over 44.5 s of play found 93 queue entry events, a longest hold of 8
  decision ticks, and **19 stationary runs, every one of them ≤ 484 ms** — so the queueing reads as a
  ghost stopping to think, not as a freeze. Do *not* re-verify this by classifying canvas pixels: the
  sprite is 0.8 tiles wide, so neighbouring ghosts come within a few px of touching at 1.0 tile apart,
  and dot/eye pixels leak into the colour buckets, which produces phantom "overlaps" at ~0.7 tiles
  (the eye white is closer to Pinky's colour than anything else is, and a 75%-coverage dot edge reads
  as Clyde). Trust the state hook; if it is gone, rebuild it for one session rather than trusting
  pixels.


- **Russian Roulette** (`games/revolver.js`) is the only machine whose "payout" is a bank of
  compounded multipliers rather than a per-spin multiple, so it returns the bank directly. One
  buy-in opens the bank at ×1.00 and there is nothing to top up: a SPIN re-loads and spins the
  drum fresh, then the hammer falls — a blank climbs the bank to the next rung of the **ladder**,
  and a live round ends the run and takes the whole bank. The player keeps spinning and must
  CASH OUT themselves, at whatever the bank stands at. There are no lives and no re-buys, and
  nothing on the drum itself is a tell.

  **The ladder.** `main.pjs`'s `rrLadder()` is the whole machine: ten rows of `[bank multiplier,
  live rounds]`, shipped as ×1.10/1 · ×1.20/1 · ×1.37/1 · ×1.50/2 · ×2.00/2 · ×2.75/2 · ×3.50/3 ·
  ×5.00/3 · ×7.50/4 · ×15.00/5. Round *n* is the *n*th spin of the run (so the round on the table
  is `blanks + 1`), surviving it sets the bank to that row's multiplier, and the row's live count
  is what the NEXT spin — the one for round *n+1* — loads. The load therefore fills forward
  (1, 1, 1, 2, 2, 2, 3, 3, 4, 5 live of the six chambers) and the top rung leaves a single empty
  chamber. `buildLadder()` in `revolver.js` reads `CONFIG.rrLadder` (via `cfgLadder()` in
  `state.js`, which calls `root.rrLadder()` once at import), drops malformed rows, rounds the
  multipliers to 2dp, clamps the live counts to `CH − 1`, sorts ascending by multiplier and falls
  back to the identical `DEFAULT_LADDER` if `main.pjs` says nothing usable — so the module still
  runs standalone in a test harness.

  **This replaced a flat ×2-per-blank bank with `rrDouble`/`liveFor()`/`rrLiveStart`/`rrLiveMax`**
  (that design doubled the bank every blank and added one live round each time the bank doubled,
  which gave the *player* an edge — see **Return** below). Surviving the top rung now takes SPIN
  away entirely: the drum cannot get heavier and there is nothing left to climb for, so the button
  disables and the only move is CASH OUT. `rrRake` is a cage cut that ships at **0**, so the
  multiplier the bank shows is exactly what the player keeps (an earlier 2% cut made "×4 bank" pay
  ×3.92 — the mismatch players rightly called a bug).

  **What the player is told.** The drum is still featureless, but the *round* is not a secret any
  more — the load is a pure function of the round and the ladder is on the info card, so the HUD
  has 4 cells (Round `n/10` / Bank / Cash out / Best ever) and the spin button's sub-line reads
  "round *n* of 10 · *k* live", naming the load that spin is facing. After a blank the message
  names the next round's load too ("…and round 4 loads 2 live."). What remains unknowable is
  *where* the live round is sitting, which is the only thing the drum's position could ever have
  leaked.

  **No gold on the drum.** There is no yellow accent anywhere on the cylinder: the pulsing
  `rr-armed` ring that used to sit over the strike chamber is gone (element + CSS), and the gold
  `.rr-ch.now .rr-hole` fill is gone too. `paint()` still toggles `now` on the landed chamber, but
  it is now only a hook for the two outcome colours — `.rr-svg.safe .rr-ch.now .rr-hole` (green)
  and `.rr-svg.bang .rr-ch.now .rr-hole` (red) — and only while phase is `ready`/`spinning`, so the
  idle and cashed-out drums are perfectly featureless. Players read the gold ring as "a round is in
  that one", which is exactly the tell this game must not have.

  **Sound.** `sfx.cylinder(SPIN_MS, turns, CH)` replaces the slot machines' `sfx.spin()`. The spin
  is a **real recording** of a cylinder being turned, shipped as `src/audio/revolver-spin.mp3`
  (66 KB; supplied by the user). It is fetched and decoded once, off the first user gesture —
  `preloadSpin()` fires from the machine's `create()`, and `cylinder()` retries lazily if a spin
  somehow beats the decode. `SPIN_GAIN` is its level on the bank's scale.

  The take **drives the animation** rather than the other way round. `SPIN_CLICKS_MS` in `audio.js`
  is the measured time of every chamber clack in the file (184 ms … 2302 ms, 33 of them — an
  energy-envelope onset detector over the decoded take), and `sampleSpin()` fits the whole take to
  `SPIN_MS` (rate = 2282 ms span / SPIN_MS, with a ±5% jitter so no two spins are the same length).
  The 33 clacks therefore become exactly the 33 chamber passes of the whirl, and the take's last
  clack *is* the lock. `spinProgress(keys, k)` in `revolver.js` is that mapping: piecewise-linear
  between clack times, one chamber per clack, then a velocity-continuous rock-out on the latch
  (overshoot ≈ 4.8° that returns to rest exactly, so there is no end-snap). The motion blur is
  derived from the frame-to-frame angular speed (`10 · min(1, v/3000)^1.3`, smoothed) rather than a
  fixed decay, so the smear follows the drum's real deceleration — the take spends its last ~430 ms
  creeping the final chamber home. `cylinder()` returns the plan to the caller so `plan.delayMs` can
  hold the picture back by the audio output latency: a chamber lands with the clack the player is
  *hearing*, not the one being emitted. `SPIN_MS` (1800) is the one knob for how long the whirl
  lasts; the plan's `steps` (33 for a six-chamber drum = 5.5 turns) sets the picture's rotation, so
  the recording's own number of clacks decides the turns, not `SPINS_MIN`/`SPINS_MAX`.

  **Fallback.** If the asset can't be fetched or decoded, `cylinder()` uses the synthesized
  `synthCylinder()` (metal flick, band-passed whirr sweeping 1750→320 Hz, one ratchet click per
  chamber placed by inverting the quart-out curve the fallback whirl uses) and returns
  `keys: null` — which sends `animateSpin` back to its old quart-out glide over `turns` whole
  revolutions. Same call site either way; `SPINS_MIN`/`SPINS_MAX` only matter on this path.

  **Verifying the sync without ears.** Two checks, both doable from `page_eval`. (1) Offline: get a
  plan from `sfx.cylinder()`, `scheduleSpin()` it into an `OfflineAudioContext`, then run the same
  onset detector over the render and confirm the clacks land at `keys[i] · ms` — with the shipped
  asset the mean error is 0.9 ms and the render is silent after the spin. (2) Live: sample a
  chamber's angle from its `translate(...)` every frame, anchor the known `±steps·60°` jump at the
  tween's start (it is exactly 180° mod 360, so a naive unwrap aliases), then fit the times at which
  the drum passes each 60° boundary against `keys`. The fitted slope must equal the tween's own
  duration (measured 1880 vs 1884 ms) with residuals at frame-quantisation level (RMS 0.8 ms, max
  2.2 ms) — i.e. the drum passes chamber *i* within ~1 ms of clack *i*.

  **Return.** The ladder is deliberately unkind, and this is the part to check first if a balance
  complaint comes in. The chance of surviving to the end of round *n* is `∏(1 − live_k/CH)` for
  k = 1…n, so a buy-in cashed on rung *n* returns `mult_n × that product` on average: **0.917,
  0.833, 0.793, 0.579, 0.514, 0.472, 0.300, 0.214, 0.107, 0.036** per unit staked. The best rung
  is the FIRST one (91.7%), every rung above it is worse, and the top rung pays ×15.00 on a
  3.6% chance. So the house edge at best play — spin once, cash out, always — is **8.3%**, and it
  sits with whoever walks away: one more spin is always the worse bet, however tempting the next
  rung looks. The info card prints this column straight off the live table (it computes `reach`
  and `ret` from `LADDER`, so retuning `main.pjs` retunes the card's own admission), marks the
  best row green and the top row red, and states the edge in the "On the table" note. To soften
  the game, flatten the early rungs or load fewer live rounds in the middle of the table; to
  harden it, the reverse, or put a cut back in `rrRake` (which comes off on top of the ladder's
  own edge).

  **Verifying the climb from `page_eval`.** Stub `Math.random` (it is the only thing that decides
  a shot — `rolledLoad()`/the spin path call it once per shot) and walk the ladder. With
  `Math.random = () => 0.99` every shot is a blank, so ten spins must land the bank on ×1.10,
  ×1.20, ×1.37, ×1.50, ×2.00, ×2.75, ×3.50, ×5.00, ×7.50, ×15.00 in order with the sub-lines
  reading "round *n* of 10 · 1,1,1,2,2,2,3,3,4,5 live"; at the top SPIN must be disabled while
  CASH OUT stays live. Then climb nine rungs at 0.99 and set `Math.random = () => 0.5` for the
  tenth: 0.5 is only fatal if the drum really holds 5 of 6, so a BANG on that shot (bank ×0.00,
  cash-out $0, message "BANG…") is the proof that the top rung loads five live. Both walks also
  prove the ladder is read from `main.pjs`: temporarily set row 1 to `[1.13, 2]`, `page_refresh`,
  and the boot message and `CONFIG.rrLadder` both report it.

- **Rocket Crash** (`games/crash.js`) is the multiplier machine: the rocket climbs from ×1.00 and the
  player banks `bet × multiplier` by cashing out before it blows up. The crash point is drawn BEFORE
  launch — `(1 − 0.03) / (1 − u)` rounded down to a cent, so `P(crash ≥ m) = 0.97 / m`, a flat 3% at
  every target — and it is the only thing that touches the odds. The climb and the crash point are
  independent, which is the fact that matters most here: **retuning the pace cannot move the edge, and
  a pace change is never the fix for an edge that looks wrong.** (A 200k-round Monte Carlo of the
  crash point returns 0.967 / 0.967 / 0.974 per unit staked at ×2 / ×5 / ×10 — the little that is
  missing from 0.97 is the cent rounding-down, and it was there before this change too.)

  **The climb is a curve, not a ramp.** In log space, `ln(mult) = crashStart·t + crashAccel·t²` for
  `t` = seconds in flight, so the climb RATE starts at `crashStart` per second and grows by
  `2·crashAccel` every second. It used to be a flat exponential (`0.55·t`). The chart's x-axis is real
  flight time and its y-axis is log-multiplier, so this curve is literally what gets drawn: the old
  one was a straight diagonal, the new one leaves the pad nearly flat and bends upward — that bend,
  plus the number's own accelerating spin, is the whole visual point of the change.

  | multiplier | 1.1x | 1.5x | 2x | 3x | 5x | 10x | 50x | 100x | 1000x |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | old flat 0.55/s | 0.17s | 0.74s | 1.26s | 2.00s | 2.93s | 4.19s | 7.11s | 8.37s | 12.56s |
  | shipped | 0.57s | 1.60s | 2.25s | 2.97s | 3.72s | 4.57s | 6.15s | 6.72s | 8.38s |

  Shipped values are `crashStart = 0.12` and `crashAccel = 0.084`, both read from main.pjs → `CONFIG`
  so the pace is retunable without touching JS (`crashAccel = 0` + `crashStart = 0.55` reproduces the
  old ramp exactly). The low end is genuinely lazier — a median round (crash ≈ 1.94x) now runs 2.18s
  instead of 1.20s, and the multiplier is only ×1.23 after the first second — while the top end
  arrives sooner, because the acceleration compounds; the two curves cross at about ×10. The mult is
  *printed* at 1.00x for well under 0.2s (1.01x at 0.09s, 1.03x at 0.20s), so nothing looks frozen —
  but if a future `crashStart` is ever dropped much lower, the launch will read as stalled before it
  reads as slow.

  `tOf` (the inverse of the curve: `(√(crashStart² + 4·crashAccel·ln m) − crashStart) / (2·crashAccel)`)
  is what places the cash-out point and the ghost-crash point on the chart, and what measures the
  remaining flight for the post-cash-out time compression — so it must stay an exact inverse of `mOf`.
  That is the reason the curve is a quadratic in `t` and not anything more exotic: a closed form keeps
  the spectate tail (`warp`, capped at 3s) exact with no iteration. There is no intercept term, so
  `mOf(0)` is exactly ×1.00.

  **Verified live**, not just in the arithmetic. Two checks, both from `page_eval`:

  1. **Pace.** Stub `Math.random` to a near-1 value before LAUNCH so the crash point lands around
  ×32k and the rocket flies ~10s uninterrupted, then sample `.crash-mult` every animation frame and
  least-squares fit `ln(m) = a + b·t + c·t²` to the *displayed* multipliers: 571 frames over 9.5s
  give `a = −0.0005, b = 0.1197, c = 0.0840` against the shipped `0, 0.12, 0.084`, and the readings at
  whole seconds are 1.22x / 1.78x / 3.03x / 6.15x / 14.92x / 41.52x / 141.5x / 558.9x / 2616x — the
  fitted curve IS the drawn number, off only by the 2-decimal display rounding. Remember to restore
  `Math.random` and to cash out; a stubbed flight pays `bet × 6173x`, which will inflate whatever
  bankroll the preview is carrying.
  2. **Shape.** Let a real round crash somewhere in the ×2.5–7 window (t ≈ 3–4s, so the whole flight
  still fits inside the 3.2s chart window) and `vision` the frozen `#crashCanvas`: it should read as a
  line that is "nearly flat near the left edge and noticeably steeper on the right". Over the first
  3.2s of a round the bend is obvious; over a 3.2s slice taken deep into a long flight it is nearly
  straight again, because the chart's x-window is fixed in *time*, not in multiplier — so judge the
  curvature from an early round, not a late one. Two things to know when reading such a capture: the
  post-cash-out ghost tail is drawn SOLID red once it has blown (dashed yellow only while it is still
  flying), and the translucent area fills under the curve can read as "blocky rectangles" to the eye.

- **Slots** (`games/slots.js`) is the plain three-reel machine: one payline, six symbols, best single
  result pays. Everything a spin can win lives in the `SYMBOLS` table (`three` = triple pay, `two` =
  pair pay, `w` = base reel weight) and `evaluate(ids)` walks that table to find the highest-paying
  reading of the three landed symbols — so a triple always outranks a pair (🍒🍒🍒 pays 4×, not 1×) and
  one spin never collects two prizes.

  **The cherry pair is left-anchored.** `{ id: "cherry", three: 4, two: 1, leftPair: true }` — two
  cherries on the payline return your credit (1×, which `recordPlay` books as a *push*: payout ===
  stake is neither a win nor a loss) — but only when they sit on the **first two reels**. That is what
  `leftPair` means in `evaluate()`: skip the pair unless `ids[0] === ids[1] === s.id`. The same pair on
  the last two reels pays nothing, and `play()` says so in the result line ("🍒🍒 only pays on the
  first two reels") rather than a bare "no match", because a right-hand cherry pair otherwise reads as
  a mis-scored win. `pairLabel()` is the single source for that chip's copy, used by both the cabinet
  paytable and the pay-table card ("1st two 1x").

  **RTP.** With base weights (no Lucky Coin stacks) the paytable returns **89.4%** of the stake; the
  left-anchored cherry pair at 1× lifts that to **95.7%**. Both numbers come from the exhaustive 6³
  weighted table — replicate `SYMBOLS` + `evaluate()` in a script and sum `p · pay` over all 216
  outcomes. Note how much the anchoring matters: the cherry pair fires on **6.3%** of spins
  (`p_cherry² · (1 − p_cherry)`), where an unanchored cherry pair would fire on 18.9% and push the
  machine past 100%. Lucky Coin perks shift the weights toward the premium tiers and are the only
  thing that moves the return at runtime — the paytable itself never changes.

- **Neon Recall** (`games/memory.js`) has no dice in it: the only randomness is which colours the
  pattern uses, so **the difficulty curve is the flash timing** — how long each colour stays lit and
  how long the gap between them is. Everything tunable lives in main.pjs (`mem*` → `CONFIG`).

  **The ladder is `memLevels` (27) LEVELS, one colour each** — a difficulty ladder, not a
  length-ceiling race. SEQUENCE opens at `memStartLen` (3 colours) and tops out at 3 + 26 = **29**;
  RANDOM opens at `memRandStartLen` (5), because a freshly re-rolled three-colour pattern is no test
  at all, and tops out at 5 + 26 = **31**. Because the two modes now have *different* maxima, the
  single module-level `maxLen` is gone: `startFor(mode)` and `maxLenFor(mode)` are the only
  accessors. Both modes run exactly `levels` passes and the pip track shows `levels` pips in both,
  so nothing may assume the old per-mode pass counts. `setMode()` rebuilds the pip track (the mode is
  locked mid-run, so there is never a live run to invalidate), and the info card's ladder is keyed by
  **colour count, not pass** — with the 3-colour row printing a dash in the RANDOM column. A
  pass-keyed table would sit SEQUENCE's 3-colour first pattern next to RANDOM's 5-colour one and
  quietly lie about the payouts; the ladder's bar is log-scaled, because the bank spans x6,965
  (SEQUENCE) / x26,351 (RANDOM) and a linear bar left every early rung as a stub.

  **Every level pays a bit more than the level before.** Pass 1 banks x1.26 (SEQUENCE) / x1.33
  (RANDOM) — the old flat step — but the step then **grows by `memStepGrow` (0.01) per level**, so
  level 27 pays x1.52 / x1.59. The bank is the **product** of the steps, not the sum, so it
  accelerates rather than creeping: SEQUENCE x5.94 by level 7 and **x6,965.27 at the summit**, RANDOM
  x8.60 by level 7 and **x26,351.05**. `stepOf`/`stepAt`/`multOf` build and memoise the product
  ladder; never re-derive the bank by adding steps. Want a gentler widening? `memStepGrow` is the
  dial (0 makes it the old flat 1.26-per-pass ladder again).

  **Faster as it grows, up to a point.** `flashFor(n)`/`gapFor(n)` = base × decay^(n − the mode's
  opening length), floored at `memMinFlashMs`/`memMinGapMs`, and the ramp is **frozen at
  `memMaxLen` (20) colours**. That 20 is now purely a *speed* cap: both floors (110 ms flash / 55 ms
  gap) are already reached around 17 colours, so nothing flashes faster past 20 — the pattern just
  keeps getting longer. Shipped: flash 330 ms × `memFlashDecay` 0.92 per colour, gap 130 ms ×
  `memGapDecay` 0.94. Measured live by timing the pads: RANDOM pass 1 (5 colours) cycles every 483
  ms and is down to 327 ms by pass 6 (10 colours); SEQUENCE pass 1 (3 colours) cycles 485 ms, pass 2
  (4) 439 ms. Raising the decay toward 1 is what makes long patterns unlearnable rather than merely
  hard, so retune the floors before the decay.

  **Degenerate-RNG guard in `randomSeq()`.** RANDOM refuses to emit the same pad three times running,
  which it enforces by re-rolling; a stub `Math.random` that never varies (e.g. `() => 0` in a test)
  used to spin that loop forever and freeze the whole preview. It now gives up after 64 refusals and
  accepts the repeat, so a pathological `Math.random` costs a few ms instead of hanging the page.

  **Verifying it without ears or eyes.** A `MutationObserver` on `.mem-pad` class changes gives the
  exact lit order *and* the dwell times; replay that order with `KeyboardEvent("keydown", {key:"1"…
  "4"})` on `window` to walk pass after pass, and the "WATCH — n colours · Xms each" line prints the
  flash time the machine just used. `document.hidden` is true in the editor preview, but the memory
  machine's timings measure true anyway (measured 483 ms for a 460 ms cycle), so the pass walk above
  is a real timing check, not a guess.
