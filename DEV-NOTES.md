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
  shell turns it into `payout = stake * multiplier` (clamped to `maxWinMult`, then `applyPerks()`
  adds the flat stake-bounded perk bonus — never a multiplier on the payout). Return `multiplier: 0`
  for a loss and `{ multiplier: 1, cancelled: true }` if `destroy()` interrupted the round.
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

## Save generations (wiping every player at once)

Saves live in the player's own browser (`localStorage["casino-royale.save.v1"]`, per origin), so a page
reload always brings the run back — there is no server-side profile to clear. The one lever that reaches
*every* player at once is the save generation: `saveVersion` in main.pjs (→ `CONFIG.saveVersion`). Every
save is stamped with `v: CONFIG.saveVersion` in `newRun()`, and `loadState()` checks `data.v` **before it
merges anything** — a mismatch (`!==`, so an older *or* newer build's save) deletes the stored save, sets
`loadFlags.wipedSave`, and returns false so boot starts a fresh run. `main.js` turns that flag into a gold
toast ("Updated! Your old save was reset…") so nobody is left wondering where their run went.

So the recipe for a global reset is: bump `saveVersion` in main.pjs (Perchance) and the matching
fallback literal in `CONFIG.saveVersion` in `src/state.js` (the GitHub Pages mirror, which has no
`window.root` so every `cfg()` falls back to its default — see DEPLOY.md), then push. Everyone starts
again at `startingMoney` on their next load, with no redeploy or server call. Keep the key name the same;
the mismatch check is what does the work, and reusing the key means the stale blob is overwritten rather
than piling up. Two caveats: it also wipes the **editor's own preview save** when it is next loaded (save
the dev a copy of their test save first, or re-stamp its `v`), and it is deliberately blunt —
`BYGAME_MIGRATION`/`migrateByGame()` is the mechanism for *keeping* old saves while reshaping them, while
`saveVersion` is for throwing them away. Players can still reset only themselves with BANKRUPT → "START
OVER", or `casino.clearSave(); location.reload()`.

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

## The balance book

The economics of the whole casino live in one block at the bottom of the tunables in `main.pjs`
(search `---- balance book ----`), read by JS through `CONFIG`. **Retune the economy there, not in
the game files** — every lever below is a `CONFIG` value and every machine reads it.

- **Luck** (`levelLuck` 0.0006/level, `luckCoin` 0.004/stack, `luckCap` 0.08) is a per-round odds
  nudge each machine applies to its *own* model, and it is **hard-capped** in `computeEffects()`.
  The cap is reached around level 135 even with five coins, and the admin winner rig overrides luck
  to 0.75 (which is why the rig still works). Every machine's luck coefficient is tuned so that at
  the cap that machine still returns **less than 100%** — luck is an edge, never a printer.
- **Perks** are small and **bounded by the stake**, never by the payout: `winBonusStack` 0.002
  (+1% of the stake on a win at five stacks), `rebateStack` 0.001 (+0.5% of the stake back on a
  loss), `limitStack` 0.05 (Fortune: +5% table limit per stack, forever). They apply **on top of**
  the game's own multiplier in `applyPerks()`, so a 200× jackpot can never ride them upward.
  Tables that opt out (`noPerks: true`, blackjack) skip them entirely.
- **Table limit.** `tableLimitBase` 400 × `level^tableLimitExp` 1.35 × the Fortune multiplier. It is
  the most you may stake on **one round of any machine** (`tableLimit()` in `main.js`; a machine may
  override it down with `maxBet()`, never up), and it caps the round's LOSS as much as its win. It is
  printed in the bet panel. Level 1 → $400, level 30 → ~$39k, level 60 → ~$100k.
- **House maximum.** `maxWinMult` 1000. `playRound()` clamps the multiplier to it *before* perks, so
  no round of any game pays more than ×1000 the stake, whatever the machine, its luck or its perks
  produce. It is a true upper bound for every machine, and for the two free-flown games — Rocket Crash
  (target input clamped to it) and Frogger (`ladderCap` == 1000) — it is the real cap. **It only
  actually bites on Rocket Crash.**
- **Per-machine maximum.** In practice every other machine caps itself *below* the house clamp, and
  says so: a machine may declare `maxWinMult` on its descriptor, the best multiplier one bet unit can
  pay, and `renderBetTotal()` prints `game.maxWinMult × the round stake` (falling back to the house
  value). Shipped: slots ×200 (the star triple), Roulette ×36 (a straight), Blackjack ×2.5 (a natural),
  Horse ×60 (the payout clamp), Ghost Muncher ×4.9 (`WIN_SHARE × POT_CAP`), Treasure Chests ×4
  (`chestHigh`), Russian Roulette `TOP_MULT` (the top rung), Neon Recall ×12 (its ladder cap). Each
  value is *derived from the machine's own constant*, so it cannot drift out of step with the game.
  The bet panel is therefore a truthful "this table cannot pay you more than" line for every table.
- **Neon Recall's table maximum.** A memory ladder cannot be balanced with odds alone, because a player
  who writes the pattern down beats any fixed chance, so the memory table is the one machine with a
  **limit of its own**: `maxBet(level)` = `memTableBase` (100) × (level + 1), capped at `memTableMax`
  (2000) — $300 at level 2, $2,000 at level 19 and forever after, and it grows with the level exactly
  like the house limit does. That limit is the hard ceiling on a run: the shipped summit is ×10.88 and
  the guard cap ×12, so the biggest run a perfect reader can ever cash is 10.88 × $2,000 = **$21,760**,
  and at level 2 it is 10.88 × $300 = $3,264. Compare that with the ×1,000 crash/slot tail on a
  $21,300 level-19 stake — the memory "guarantee" is four orders of magnitude smaller than the lottery
  tails, which is the right shape for it: bounded, and it needs both a real read and the level first.

**The returns, at base and at the luck cap** (`computeEffects()` maxed: level 200, all five capped
perks, five Lucky Coins → `luck = 0.08`). Slot/Fortune-Lines figures are exact (exhaustive 6³ table
and a 200k-spin Monte Carlo of the shipped reel model); the rest are their own closed forms:

| machine | return at base | at the luck cap | note |
| --- | --- | --- | --- |
| Slots | 95.69% | 96.81% | exhaustive 6³ weighted table |
| Fortune Lines | 92.37% (9 lines) | 92.95% | scatter pays × total bet; 95.6% on 1 line |
| Roulette | 97.30% | ≤97.31% | 36/37 on every sensible bet — every chip is the same size (the bet) and the round is `bet × spots`; red/black are mutually exclusive; luck nudge is `luck·0.05/max(2, bestPay)`, so a straight-up backer converts at most a sliver of losses |
| Horse Racing | 92.00% | ≤92.74% | `payout = 0.92/p` exactly (the 1.05 floor / 60 cap never bind: `p` ∈ [0.068, 0.353]); luck only inflates your runner's rating, and the relative boost is `(1+b)/(1+p·b) ≤ 1.008` |
| Rocket Crash | 97.00% | ≤97.48% | `P(crash ≥ m) = 0.97(1+0.06·luck)/m`, flat at every target |
| Treasure Chests | 93.75% | 93.75% | `(chestHigh+chestGem+chestMid+chestLow)/8`; **the four prizes must sum to < 8** or it prints money |
| Russian Roulette | 90.00% | 90.00% | best play is cash out on rung 1; the first spin already loads **2 live of 6**, so no run is a formality and CASH OUT stays locked until the first blank; `rrRake` ships at 0 so the advertised multiplier is exactly what you keep. Perks are not `noPerks`, but Safety Net's +0.5% of stake on a loss leaves the best rung at 90.5% |
| Blackjack | ~99.5% | ~99.5% | honest S17 3:2 game; **`noPerks: true`** — no luck, no perks, no rigged dealer. This is the one table whose edge is genuinely thin |
| Ghost Muncher | ≤98% (bot 83%) | — | skill; the exact return is `p · 0.35 · E[pot]`, which peaks at **98%** when `p = 1` — clearing every maze, the farmable outcome, is a 2% *loss*. See its section below |
| Frogger Gamble | ≤0.878 of stake (99% UB, *perfect* player) | — | skill; the ten-rung ladder is the ceiling, and it is *fitted* to a measured god reach — see "Frogger balance & the god harness" below. A bot that plays carelessly returns ~0.25 |
| Neon Recall | ≤95% (reference) | — | skill; a **fitted** ladder — every rung past the knee is a fair bet for the reference player, whose return is flat at 95%, and every rung up to it pays exactly ×1.00, so there is no free money. Summits ×5.01 / ×10.88; hard ceiling $21,760 a run via its own table limit |

**The invariant to preserve:** every chance machine returns **< 100%** at the luck cap, no single round
of any machine pays more than `maxWinMult` × the stake, and **no machine has a farmable outcome** — an
easy, human-repeatable result that pays more than the stake, which a player could compound round after
round. Blackjack is the only table close to even, and it is deliberately stripped of luck and perks for
exactly that reason. If a future change pushes any row above 100%, or gives any machine a repeatable
`payout > stake`, that is a money printer — fix the machine, not the table.

**No fast money (the farmability audit).** The average return is the *second* thing to check; the first
is whether any single rung can be farmed. The audit, machine by machine, looks for an outcome that is
(a) easy for a human and (b) worth more than the stake:

- **Neon Recall** used to fail both halves. Pass 1 was a three-colour pattern — trivial to see, and
  trivial to write down — paying a flat ×1.26, i.e. +26% a round with no risk at all, and the ladder
  compounded to ×294.81 / ×771.49 on top of it. It is now **fitted**: a rung pays `memLadderRtp`
  divided by the reference player's chance of reaching that rung, so the low rungs pay **exactly ×1.00**
  (a push — and zero XP, because XP is charged on profit, so there is no churn loop either) and the
  reference player's return is flat at 95% at every rung past the knee. The summit is ×5.01 / ×10.88
  and the machine's table limit caps the run at $21,760.
- **Ghost Muncher** used to be a printer: `0.35 · (5p + 0.25(1−p))` for a clear rate `p`, which is
  **1.75× for a perfect player** and crosses even at `p ≈ 0.549`. The pot is now `arcadePotBase` 2.8 /
  `arcadePotStep` 2.1 / `arcadePotCap` 14, and the exact return is `p · 0.35 · E[pot]` — 0.83 at the
  bot's `p = 0.456`, 0.98 at `p = 1`, and **never even**: the farmable outcome (clear every maze) is a
  2% loss. The machine's note below carries the closed form for `E[pot]`.
- **The chance machines have no farmable outcome by construction.** Slots, Fortune Lines, roulette,
  horse racing, crash, chests and the revolver all pay their *easy* outcomes under the stake; their rare
  outcomes are rare per round and cannot be forced. The only per-play decisions that pay more than the
  stake are the deliberate gambles (a chip on the felt, a crash target, a chest pick), and their return
  is the row in the table above — none above 98%.
- **Tails are bounded, not grindy.** `maxWinMult` 1000 is a *lottery*, not a grind: crash's ×1,000 tail
  is about 1 round in 1,000 at a 2.00 target (and the target input itself is clamped at the max), the
  slot five-of-a-kind is rarer still, and the memory summit is ladder-capped at ×10.88. Nothing on that
  list can be *worked toward*, which is the property that makes a top end safe.

**How the numbers were checked.** Slots and Fortune Lines were re-derived outside the page (the
weighted enumeration and a Monte Carlo of the reel model, both in `execute_js`), then spot-checked in
the live preview: mount a machine, set `.bet-input`, reset
`state.stats.byGame[id] = {plays:0, staked:0, returned:0, …}`, run
`for (let i=0;i<N;i++){ await casino.playRound(true, {idle:true}); if (i%20===19) await new Promise(r=>setTimeout(r,0)); }`
and read `returned/staked`. Two traps: (1) with a real bankroll use `state.infMoney = true` and
`state.money = 1e9` so `resolveStake()` doesn't shrink the bet out from under you; (2) **keep each
`page_eval` short** (a few hundred rounds) — `recordPlay`/`renderHistoryPanel` cost ~15 ms a round, so
a 20k-round loop blows the eval's time limit and, worse, **keeps running in the background after the
timeout**, contaminating the next measurement. Machines that need a decision to open (`roulette`)
want `state.idle.on = true` as well as `opts.idle`, because `inst.canPlay()` is checked before
`play()` and only sees the state, not the opts. `revolver` and `frogger`/`arcade` return
`{ multiplier: 1 }` under `opts.instant`, so instant mode cannot measure them at all — they are
verified from their closed forms (the revolver ladder's `RET` column, the frogger `multFor` table)
and by walking the real UI. Rocket Crash and Horse Racing are genuine per-round coin flips, so
single-run numbers on a few hundred rounds are noisy in both directions — trust the closed form and
use the sim to catch a broken formula, not to set the number.

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

  Net: the bot clears **45.6%** of mazes, a **0.83 return per play** (17% house edge). The bot cleared
  36% on the previous 15×11 / 430 ms tuning and ~15% before that, so this is a deliberately more
  forgiving machine *without* being a money printer — and the pot is the part that changed in the last
  balance pass. The jackpot pays `arcadeWinShare` (35%) of a pot that resets to `arcadePotBase` (2.8×)
  and grows by `arcadePotStep` (2.1×) per loss up to `arcadePotCap` (14×). The exact return per play is
  `R(p) = p · 0.35 · E[pot]` for a clear rate `p`, where `E[pot]` is the mean of the *capped* pot over
  the geometric run of losses that precedes the clear:
  `E[pot] = Σ_{L=0..L*} p(1−p)^L (2.8 + 2.1L) + (1−p)^(L*+1) · 14`, with `L* = ⌊(14−2.8)/2.1⌋ = 5`
  (the naive `0.35 · (2.8p + 2.1(1−p))` is wrong — it ignores the cap, which is most of the value at
  low `p`). That curve **never reaches even**: 0.38 at `p = 0.1`, 0.60 at `p = 0.2`, 0.83 at the
  bot's 0.456, 0.92 at `p = 0.75`, 0.98 at `p = 1`; its maximum over `p` is the 0.98 endpoint. The reset
  pot sits just under the `1 / 0.35 = 2.86×` break-even *on purpose*: clearing every maze is the one
  outcome a player can farm, and it is a small **loss**. The old pot (base 5, step 0.25) paid
  `0.35 · (5p + 0.25(1−p))`, i.e. **1.75× for a perfect player** and even at `p ≈ 0.549` — a printer for
  anyone with a little skill, one good tuning pass away from the bot's 45.6%. If a future retune wants
  more speed, more lives or more time, it has to buy them back in the pot (and the info card, the payout
  note and the marquee blurb all read `WIN_SHARE`/`POT_*`, which is why the 35% is no longer
  hard-coded anywhere).

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
  live rounds]`, shipped as ×1.35/2 · ×1.50/2 · ×1.80/2 · ×2.50/3 · ×3.50/3 · ×5.00/3 · ×7.50/4 ·
  ×10.00/4 · ×14.00/5 · ×20.00/5. Round *n* is the *n*th spin of the run (so the round on the table
  is `blanks + 1`), surviving it sets the bank to that row's multiplier, and the row's live count
  is what the NEXT spin — the one for round *n+1* — loads. The load therefore fills forward
  (2, 2, 2, 3, 3, 3, 4, 4, 5, 5 live of the six chambers) and the top rung leaves a single empty
  chamber. **Round 1 loading two live is the request**: a third of the drum is fatal on the very
  first pull, which is what stops a buy-in from being a coin-flip-free formality. `buildLadder()` in
  `revolver.js` reads `CONFIG.rrLadder` (via `cfgLadder()` in `state.js`, which calls
  `root.rrLadder()` once at import), drops malformed rows, rounds the multipliers to 2dp, clamps
  the live counts to `CH − 1`, sorts ascending by multiplier and falls back to the identical
  `DEFAULT_LADDER` if `main.pjs` says nothing usable — so the module still runs standalone in a
  test harness.

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
  k = 1…n, so a buy-in cashed on rung *n* returns `mult_n × that product` on average: **0.900,
  0.667, 0.533, 0.370, 0.259, 0.185, 0.0926, 0.0412, 0.0096, 0.0023** per unit staked. The best rung
  is the FIRST one (90.0%), every rung above it is worse, and the top rung pays ×20.00 on a
  0.011% chance. So the house edge at best play — spin once, cash out, always — is **10%**, and it
  sits with whoever walks away: one more spin is always the worse bet, however tempting the next
  rung looks. The info card prints this column straight off the live table (it computes `reach`
  and `ret` from `LADDER`, so retuning `main.pjs` retunes the card's own admission), marks the
  best row green and the top row red, and states the edge in the "On the table" note. To soften
  the game, flatten the early rungs or load fewer live rounds in the middle of the table; to
  harden it, the reverse, or put a cut back in `rrRake` (which comes off on top of the ladder's
  own edge).

  **Verifying the climb from `page_eval`.** Stub `Math.random` (it is the only thing that decides
  a shot — `rolledLoad()`/the spin path call it once per shot) and walk the ladder. With
  `Math.random = () => 0.99` every shot is a blank, so ten spins must land the bank on ×1.35,
  ×1.50, ×1.80, ×2.50, ×3.50, ×5.00, ×7.50, ×10.00, ×14.00, ×20.00 in order with the sub-lines
  reading "round *n* of 10 · 2,2,2,3,3,3,4,4,5,5 live"; at the top SPIN must be disabled while
  CASH OUT stays live. Then climb nine rungs at 0.99 and set `Math.random = () => 0.5` for the
  tenth: 0.5 is only fatal if the drum really holds 5 of 6, so a BANG on that shot (bank ×0.00,
  cash-out $0, message "BANG…") is the proof that the top rung loads five live. Both walks also
  prove the ladder is read from `main.pjs`: temporarily set row 1 to `[1.42, 2]`, `page_refresh`,
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

- **Roulette** (`games/roulette.js`) is the European wheel. The felt is a set of picks, and **every
  pick takes a chip of exactly the bet** — so a round is worth `bet × picks`, not the bet split
  across the picks. That makes the chips uniform by construction, and it plugs into the controller's
  multi-unit path (`getBetUnits: () => Math.max(1, picks.size)`, `unitLabel: "spots"`), so
  `lineBetCost()` stakes the whole felt and `betCap()` caps the bet at `tableLimit / picks` — the
  felt can never pass the table limit. `toggle()` also refuses a click that *would* break it, so the
  bet is never silently shrunk by adding a spot. **`getBetUnits` must return 1 while idle:** idle
  clears the felt and backs a single colour, and a leftover manual selection would otherwise make the
  controller charge `bet × picks` while the round only paid one chip — a money printer. Red and
  black are the two halves of the same spin, so picking one clears the other (the `toggle` swap) —
  backing both only donates a chip to the zero. Payout is `Σ(winning spots' pay) / picks`, so the RTP
  is unchanged by the chip model: 36/37 = 97.30% on any sensible combination.

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
  machine past 100%. Lucky Coin perks shift the weights toward the premium tiers (`tier 1` gets
  `1 + luck·0.2`, `tier 2` `1 + luck·0.4`) and are the only thing that moves the return at runtime —
  the paytable itself never changes, and even at the luck cap the machine returns **96.8%**.

- **Neon Recall** (`games/memory.js`) has no dice in it: the only randomness is which colours the
  pattern uses, so **the difficulty curve is the flash timing** — how long each colour stays lit and
  how long the gap between them is. Everything tunable lives in main.pjs (`mem*` → `CONFIG`).

  **The ladder is `memLevels` (19) LEVELS, one colour each** — a difficulty ladder, not a length-ceiling
  race. SEQUENCE opens at `memStartLen` (3 colours) and tops out at 3 + 18 = **21**; RANDOM opens at
  `memRandStartLen` (5), because a freshly re-rolled three-colour pattern is no test at all, and tops
  out at 5 + 18 = **23**. Because the two modes have *different* maxima, the single module-level
  `maxLen` is gone: `startFor(mode)` and `maxLenFor(mode)` are the only accessors. Both modes run
  exactly `levels` passes and the pip track shows `levels` pips in both, so nothing may assume the old
  per-mode pass counts. `setMode()` rebuilds the pip track (the mode is locked mid-run, so there is
  never a live run to invalidate), and the info card's ladder is keyed by **colour count, not pass** —
  with the 3-colour row printing a dash in the RANDOM column. A pass-keyed table would sit SEQUENCE's
  3-colour first pattern next to RANDOM's 5-colour one and quietly lie about the payouts; the ladder's
  bar is **square-root** scaled, because the bank only spans ×1.00 to ×10.88 and a linear bar squashed
  every rung under the summit into an invisible stub.

  **The ladder is FITTED, not compounded** — this is the balance-critical part. A rung does not pay
  "the previous rung plus a bit"; it pays `memLadderRtp` **divided by the chance the reference player
  has of reaching that rung**. The reference curve is: perfect to `memSkillKnee` (8) colours, then
  `memSkillDecay` (0.88) per extra colour in SEQUENCE / `memSkillDecayRand` (0.85) in RANDOM (a
  genuinely harder read, so it earns more per rung). Two consequences fall straight out of the formula:

  - **The low rungs pay exactly ×1.00.** Everything up to the knee is a fair bet for a player who never
    misses, so SEQUENCE's first six rungs (3–8 colours) and RANDOM's first four (5–8) pay
    `memLadderRtp / 1` — and ×1.00 is a bank, not a win: no free money, and no XP either, because XP
    is charged on profit, so a ×1.00 cash-out cannot be churned.
  - **The reference player's return is flat at 95% at every rung**, so pushing on is neither free money
    nor a trap. `multAt(mode, p)` computes the whole ladder from those knobs; there is no
    `stepOf`/`stepAt` and no step table to keep in sync. Shipped ladders — SEQUENCE, 3–21 colours:
    `1.00` ×6, then `1.08 1.23 1.39 1.58 1.80 2.05 2.32 2.64 3.00 3.41 3.88 4.40`, summit
    **×5.01**; RANDOM, 5–23 colours: `1.00` ×4, then
    `1.12 1.31 1.55 1.82 2.14 2.52 2.96 3.49 4.10 4.83 5.68 6.68 7.86 9.24`, summit **×10.88**.
    The old ladder compounded a ×1.26 first step and paid ×294.81 / ×771.49 at the top — a fortune in a
    handful of rounds for anyone who could read — which is why this is fitted now.
  - `memLadderCap` (8) / `memLadderCapRand` (12) are **inert guards** sitting a hair above the shipped
    summits (5.01 / 10.88): they exist so a future retune of the decay cannot silently blow past the
    machine's table maximum. They are not the ceiling — the table limit is (see the balance book).

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

## Frogger balance & the god harness

`games/frogger-math.js` is the entire road and it has no DOM; `games/frogger.js` is the playable game
on top of it. **This machine is the one table in the casino whose paytable is a *proof* rather than a
closed form**, because the road is deterministic and fully on screen: a script can read every lane's
convoy, so "the player" has to be modelled as an optimal planner. Read this before touching `TIERS`,
`restSec`, the pocket constants or `ladderRungs`.

**The two rules that carry the balance.**

- **`restSec` — the sweep clock (3.0s).** The verge and every grass median shelter the frog for
  `restSec`, then the road sweeps it away (`deathKind: "swept"`, the 🌊 SWEPT card, stake gone). Without
  a clock the traffic is fully visible, so a patient *or scripted* player could stand on a median
  until the whole road lined up and stroll to the summit for free — the clock is what turns a patience
  puzzle into a timed crossing. A block of nine hops plus settles is 2.88s (`hopSec` 0.2 × 9 + `settleSec`
  0.12 × 9), so 3.0s means the player must read the traffic at a glance and go. It is the biggest
  difficulty dial in the machine **and the dial the ladder is fitted against**: raise it and the god's
  reach rises with it, so the ladder has to come down.
- **Bank on grass only.** The verge and the ten medians, nowhere else. Paying per lane is a printer
  (the god's per-lane reach stays high forever), and "bank anywhere" is worse: the landing spot is a
  free choice, so "hop one lane, bank ×1.00" is a guaranteed even-money exit and "bank the deepest lane
  I can legally reach" cashes every intermediate rung. Ten bankable places turn each island into a real
  push-or-bank decision, and — crucially — make the ladder a *partition of the run's outcomes*, which
  is what makes it boundable at all.

**The doctrine (the reason the ladder looks the way it does).** A strategy is a rule that decides, at
each bankable island, whether to bank or push on, so the best any strategy can do is the best *banking
schedule*, and a schedule partitions the outcomes by the deepest island reached. With `P_j` = the
chance a perfect player reaches island j (and `P_11 = 0`):

```
EV(best strategy) = SUM_j (P_j - P_j+1) x rung_j   <=   rtp (0.90)
```

Rung 1 therefore sits near `rtp / P_1` and every deeper rung can only be paid out of the thin tail of
mass that dies before it. The old note in the source claimed `rung_i ~= rtp / P_i`, which is **not**
the bound — it is far too generous, because it lets every island return `rtp` simultaneously on the
same branch. If you change the ladder, check it against the SUM form, not per-rung.

**The measurement (30k seeds with the shipped tiers; this is the fit the ladder came from).** God
planner settings: `dt 1/200`, `waitVerge 3`, `waitMedian 3`, `horizon 110`, `sourceKill`, `slop 0`,
`maxDepth 100`, three 10k chunks (~515s each):

| island | point reach | 99% Wilson upper |
| --- | --- | --- |
| 10 | 66.653% | 67.2834% |
| 20 | 19.847% | 20.3877% |
| 30 | 3.513% | 3.7691% |
| 40 | 0.527% | 0.6332% |
| 50 | 0.047% | 0.0860% |
| 60 | 0.010% | 0.0352% |
| 70/80/90/100 | 0 hits | 0.0180% (the zero-hit Wilson bound, `z²/n`) |

`maxSeen` 69 (the best run reached lane 69). An earlier 4k run gave 66.7 / 19.3 / 3.4 / 0.375 / 0 — the
sampling noise is only in the deep tail, so the fit is not fragile there.

**The ladder.** `ladderRungs: [1.25, 1.35, 1.50, 1.75, 2.25, 3.50, 6.00, 12.00, 25.00, 50.00]`
(one rung per island; `ladderCap` 1000 must stay equal to `maxWinMult` in `main.pjs`). Against the
upper-bound weights that ladder gives **god EV ≤ 0.8779** (point estimate 0.860), i.e. it is fitted to
*just* under `rtp` 0.90. Rejected neighbours, so nobody re-derives them: `[1.30 … 60]` → 0.9157
(**over** the ceiling, do not ship) and `[1.20, 1.30, 1.45, 1.60, 2.00, 3.00, 5.00, 10.00, 22.00, 45.00]`
→ 0.8427, the safe alternative if you ever loosen the road (it costs the player 0.05 at the first
island and nothing else, and buys 0.035 of headroom). Note where the 0.878 comes from: 0.586 is rung 1
× P_10, 0.224 is rung 2 × P_20, 0.047 is rung 3 × P_30, and everything from island 40 up contributes
0.021 between them. **The ladder is a bet on the first island**, which is why the island-10 wall is
the thing to tune.

**How much the player actually gets.** A myopic bot (the harness's `simRun`: fixed margin, no
look-ahead, banks at the first legal place — `dt 1/180`, `margin .06`, `postMargin .06`, `panicK .35`,
`sourceKill`, `wait 3`, 6000 runs) reaches island 10 19.75% of the time, island 20 0.60%, island 30
0.017% (`maxSeen` 32) and returns **0.2475** of stake. That is a *floor*: a human who reads the road
better sits between the bot and the god, so the realistic table return is roughly 0.4–0.5, with the
hard ceiling of 0.878 reserved for a planner that does not exist. If you want the machine to *feel*
fairer, raise the road's generosity (a longer `restSec`, more pocket) and re-fit — do **not** raise the
rungs without re-measuring, and do not "compensate" by lowering rung 1 in isolation without re-running
the SUM.

**What invalidates the fit.** Any change to `TIERS` (speeds, `cw`, convoy sizes, `carW`, gaps), any
change to `restSec`, `blockHi`/`blockDecay`/`blockTierStep`/`blockMin`, or the collision box changes
`P_j` and voids the 0.878. The two root knobs are `main.pjs`'s `froggerBlockSec` (0.34) and
`froggerRestSec` (3 — write it as `3`, not `3.0`, or pjs keeps it as a string), which `create()`
copies into `FROG_CONST`. After any such change: re-run the god survey, rebuild the upper-bound
weights, and either re-fit or accept the new number only if it is still under 0.90.

**The harness (it does not ship — it lives in `scratch/`, which dies with the session).** Two files
are uploaded so a future session can pull them back:

- `https://user.uploads.dev/file/3f390f78e4c69016d22b6346d3862832.js` — `frog-par.js`, the parallel
  survey: `parSurvey({mode:"god"|"bot", runs, workers, dt, seedBase, stride, waitVerge, waitMedian,
  opts, tiers, block})`, plus `islandTable(res, z)`, `wilsonUpper`, `godEV`, `godEVUpper`, `ISLANDS`.
  It spawns workers that `import` a data-URL copy of `frog-sweep.js` and read the *current*
  `src/games/frogger-math.js` text, so it always measures the shipped file.
- `https://user.uploads.dev/file/209d32db3e4428f97cd63d518db3eb7a.js` — `frog-sweep.js`, the serial
  model harness: `applyCfg({tiers, block, dt})`, `simRun` (the myopic bot), `godReach(seed, opts)`
  (the god planner), `clone`.

```js
const parSrc = await fs.readTextFile("scratch/frog-par.js");
const P = await (new Function("fs","tools","return (async()=>{"+parSrc+"})()"))(fs, tools);
const RUNGS = [1.25, 1.35, 1.50, 1.75, 2.25, 3.50, 6.00, 12.00, 25.00, 50.00];
const r = await P.parSurvey({ mode:"god", runs:10000, workers:8, dt:1/200, waitVerge:3, waitMedian:3,
  opts:{ maxDepth:100, horizon:110, sourceKill:true, slop:0 } });
P.islandTable(r, 2.326);            // per-island point + 99% upper bounds
P.godEV(r, RUNGS); P.godEVUpper(r, RUNGS, 2.326);
```

Gotchas, all of them learned the hard way:

- **`godEV` used to read `res.reach[island]` — the per-lane bin — instead of the cumulative reach.**
  It is fixed, but keep it cumulative: the planner's depth histogram has literal **zero bins at the
  island lanes** (mass sits just past them), so a bin read always returns 0 and every ladder looks
  free. `islandTable` (cumulative sums) is the reliable path.
- **`waitMedian` defaults to 6.5** in `parSurvey` — always pass `waitMedian: 3` for a fit against the
  shipped clock, or you will measure a road that no longer exists.
- The god planner costs ~500s per 10k runs; the bot is ~1/1000 of that (`secs: 0.4` for 6000 runs), so
  sweep bot settings freely and reserve god runs for the final number.
- `dt` matters: the fit used `1/200`. The bot floor used `1/180`. Both are fine, but don't mix them
  inside one table.

**Driving the real game in the preview** (this is the only way to check the payout end-to-end, and
`opts.instant` cannot: `frogger` refuses instant mode and returns `{multiplier: 1}`). The controls
listen on **`pointerdown`, not `click`** — `el.click()` does nothing to them, dispatch a
`PointerEvent("pointerdown", {bubbles:true})`. Select them as **`button.fbtn.cross` / `button.fbtn.bank`**:
a `/BANK/` text search finds the topbar's 💥 `BANKRUPT` first. And **the whole game freezes while any
modal is open** — `paused()` returns true when `#modalLayer` is visible, so a round can sit in "GET
READY" forever with a frozen sweep clock and the next `playRound` will silently no-op on the `playing`
guard; hide the modal before you drive. A clean live check: patch `TIERS` to one tiny car per lane with
`cw = [500, 500]` (a sparse convoy makes the column almost always clear), shorten `hopSec` to 0.05, set
`frogHalfW = 0`, `mountGame("frogger")`, stake $10, then `pointerdown` the cross button until the HUD
reads `Lanes crossed 10`, bank, and check the money: **it paid $13 on a $10 stake at ×1.25** ("BANKED
×1.25 — 10 lanes crossed").

