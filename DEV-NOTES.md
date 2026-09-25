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
| `src/games/ledboard.js` | the "pit meter" the two 5-reel slot cabinets wear — real stake, payline count and the jackpot pot, one navy window per number (see "The pit meter" below) |
| `src/games/infocard.js` | "HOW TO WIN" card helpers: `svgEl`, `openInfo`, `sec`, `ul`, `note`, `cap`, `payChips` |
| `src/games/*.js` | one machine each |
| `src/sprites.js` | the symbol-artwork module: turns a sprite *name* into `<img>` markup of a consistent visual size (see "Symbol artwork" below) |
| `src/styles.css` | one section per machine (see the `============ NAME ============` banners) |
| `src/*-math.js` | pure RTP/EV helpers kept out of the DOM code |

## Symbol artwork (`src/sprites/`)

`src/sprites/` holds 70 cut-out symbol PNGs (names + cut recipe in
[`sprites/README.md`](sprites/README.md)). `src/sprites.js` is the only file that knows where they
live and how big each one's art is:

- `spriteEl(name, { base, fallback, cls, alt })` → an `<img class="spr">`. `fallback` is the emoji to
  swap in on a load error, so a partial mirror upload degrades to the old look instead of broken
  images. `spriteRow(items)` is a row of them, `spriteHtml(name)` is the same thing as inline markup
  for the html-string info cards and `payoutNote()`s, and `preloadSprites(names)` warms the cache in
  `create()` so the first spin/frame does not flash empty.
- **Sizing**: every file is 148 × 148 with the art tight-cropped, so the files are not visually
  interchangeable. `BOX` in `src/sprites.js` records each sprite's real art size, every `<img>` gets
  `--sp-k = 148 / the art's longest side`, and `.spr` in `styles.css` keeps the image box square at
  `--sp-base` and scales the image by `--sp-k`. A container therefore sets `--sp-base` = how big the
  *artwork* should look (there is a list of per-container defaults in the `symbol artwork` block of
  `styles.css`); never set `font-size` for these. The box deliberately stays `--sp-base` rather than
  growing with the crop: an `<img>` wider than its cell is pushed to one edge by grid/flex centring
  instead of being centred, which is what made the wide symbols sit off-centre before.
- **Paths** are resolved relative to the module (`new URL("sprites/", import.meta.url)`), which is
  what makes the same code work on Perchance (`/src/sprites.js` → `/src/sprites/*.png`) *and* on the
  GitHub Pages mirror, where the `src/` prefix is stripped (`/sprites.js` → `/sprites/*.png`).
  The mirror therefore needs the `sprites/` folder and `sprites.js` re-uploaded when either changes.
- **Who uses it**: Slots, Fortune Lines, Wheelhouse and Treasure Chests — the machines whose *content*
  is symbols. **The two 5-reel slot machines also draw the `jackpot` marquee sign** (each one's own
  progressive's symbol — see "The jackpots"). Lucky Sevens no longer uses it at all: that machine has no
  pot, and it has no drawn face either now — every symbol on its drum is artwork from this folder (the
  dead stop it inherited from the sign came off the drum at the player's request, see "Lucky Sevens"). The
  machine nav icons are deliberately still emoji (they
  are also interpolated into prose all over `src/main.js`). Everything else in the folder is unused and
  available: `rocket`/`explosion` would suit Crash's canvas-drawn rocket, and `dice`, `cash`, `orb`,
  `clover` etc. are still unused.
- Balance is untouched by any of this: sprite names are *per-machine* fields next to the existing
  `glyph`, and the only id that changed was Fortune Lines' `banana` symbol, renamed **`watermelon`**
  in `src/games/slots-multi-math.js` (id, glyph and sprite together — pay values and reel weights were
  not touched). The later history of Slots' `star` slot is worth keeping: the `star` became the
  `jackpot` sign *including* its live behaviour, then handed the star's 200×/10× pays to a new `wild`
  symbol so that no sign anywhere in the pit pays a line multiplier, then the sign itself came off the
  drum when the player had the 3-reel machine's pot removed — leaving the same five weight of dead drum
  behind as a **drawn blank window** — and finally that window came off too, at the player's request, and
  the ladder was re-priced around its absence. All of that is documented under "Lucky Sevens" and
  "The wild's weight".

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

- **≥1041px:** reparented into `.playbar` — a bar that is the last flex child of `#stage`, so it
  pins along the bottom of the game area, spanning it, with the button centred (`max-width:460px`).
  It therefore reads as the game's own last row, directly under the machine's buttons (SPIN/CASH
  OUT, mode switches, etc.) instead of sitting off in the right-hand column. `#stage` is a flex
  column and `.stage-inner` above it keeps `overflow:auto`, so a machine that needs the height
  scrolls rather than being squashed.
- **≤1040px:** back inside `#betPanel`, inserted between the chips and the payout note (where the
  stake controls are). `.playbar` is hidden there by the responsive block — the media-query
  `change` listener reparents the real element, it does not duplicate it.

**The 1041 threshold is the layout breakpoint, not a number of its own** — it must stay in step with
`@media (max-width:1040px)` in `src/styles.css`, which is where the single-column layout starts (see
"Fitting the machines on screen"). If they drift, a window in between gets the button inside a bar the
CSS has hidden, i.e. no PLAY button at all. `placePlayButton()` is hung off *both* the media query's
`change` event and a plain `window` `resize` (it is idempotent) so a resize can never leave it
stranded. NB the preview iframe is a hidden document, so neither event actually fires in the editor —
to check this in the preview you have to *reload at* the width you care about (init runs
`placePlayButton()` once, before any resize).

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
- To change the password: SHA-256 the new one and replace the hex constant. The plaintext is
  deliberately written **nowhere** in this repo, not even here — if the owner loses it, the only way
  back in is to rotate the hash again and hand them the new plaintext.
- Rotated 2026-09-17 (the previous password was lost, not broken — the gate itself was verified
  working: `admin` switches the window to password mode, a wrong guess toasts the remaining
  attempts, and `crypto.subtle` is available in the preview and on the Pages mirror). Rotated again
  the same day, for the same reason: the owner asked for the password and the plaintext had not been
  kept anywhere, so the only answer that gets them back in is a fresh hash.
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

- **Luck** (`levelLuck` 0.0006/level, `luckCoin` 0.005/stack, `luckCap` 0.08) is a per-round odds
  nudge each machine applies to its *own* model, and it is **hard-capped** in `computeEffects()`.
  Lucky Coin caps at twelve stacks (6% luck), so the cap is reached around level 35, and the admin
  winner rig overrides luck to 0.75 (which is why the rig still works). Every machine's luck
  coefficient is tuned so that at the cap that machine still returns **less than 100%** — luck is an
  edge, never a printer.
- **Perks** — the money perks are **bounded by the stake**, never by the payout, and then clamped to a
  **shared budget**: `winBonusStack` 0.005 (Fat Stacks, **10 stacks = +1.5% of the stake on a win**),
  `rebateStack` 0.005 (Safety Net, **10 stacks = +1.5% of the stake back on a loss**), and `compStack`
  0.002 (On the House, 5 stacks = a **1% chance a losing round is comped in full** — see below). On top
  of the perk's own cap and the round's own profit/loss, every stake-bounded perk is clamped to
  `perkBudget` (**0.015**, the pit's rake-back ceiling for one round) and they **share** it, so the most
  the rake-back clubs can hand back on a single round is 1.5% of the stake however many stacks you own.
  The perk caps and the budget are the same number on purpose: a perk can never advertise a payout the
  pit is not willing to make. The endless one is `profitStack` 0.001 (**Fortune: +0.1% of the *profit* on
  a winning round per stack, forever**), which is a flat percentage of the win and therefore *does* ride a
  big multiplier — deliberately, see the power-curve note below — and is paid **outside** the budget. It
  can never invent money on a round that did not win (a loss and a push are untouched), and it never
  touches the odds. Stack caps live in `src/perks.js` and levels are read through a clamp, so a save
  holding an over-cap level from an older build (or from the MAX ALL PERKS button that used to sit in the
  shop) is inert rather than a hole. Tables that opt out (`noPerks: true`, blackjack) skip them entirely —
  and that includes the comp, which is rolled in `playRound()` beside the other perk maths precisely so
  the House's blackjack cannot be comped either.
- **The pit's little favours** — three perks move something other than the payout and are documented
  here so nobody has to guess what they cost the balance sheet:
  - **Gambler** (`gamblerStack` 0.5) lifts the **house table limit** only, by half a stack (five
    stacks = ×3.5). It is a *limit*, so no return, no advertised top and no payout moves with it, and
    a machine with a `maxBet()` of its own still overrides it. Its only balance effect is that a
    round's **loss** can be bigger, which is a risk to the player, not an edge for them.
  - **On the House** (`compStack`) is the comp described above: expected value is `0.002n · P(loss)`
    of the stake, i.e. **1 point of RTP at five stacks**. It is a full refund rather than a slice, so it
    is deliberately *not* clamped to `perkBudget` (capping it would make it a worse Safety Net); it is
    kept small instead — 1% plus the 1.5% budget is 2.5 points, still under roulette's 2.7 edge — and it
    is rolled only on a genuine loss, before any pot is added, so it cannot ride a win or a pot.
  - **Showboat** and **Pit Boss's Nephew** are **RTP-neutral by construction**: Showboat changes the
    *celebration* only (confetti and the popup label), and the Nephew stretches the loan **principal**
    while the interest, the clock and the default rule stay exactly as they were — a bigger loan is a
    bigger debt, never free money.
- **Level rewards are a comp, and they are decoupled from the XP multipliers.** XP is paid per dollar
  *wagered* (`xpRate` 0.1 per unit staked) and a level-up pays `levelReward` (5) × the level, so the cash
  a player gets back per dollar staked from levelling is `xpRate · levelReward · L / (xpBase · L^xpExp)`
  = **0.005 · L^-0.3** — 0.5% at level 1, 0.25% by level 10, ~0.17% by level 34. That is a comp like any
  other and it has to sit under the thinnest edge in the building: blackjack (`noXp`) and a round that
  returned exactly the stake both earn **nothing** at all, so "start a round, bank at ×1.00, repeat" is
  not a level-and-money printer. The **Scholarship** and **IDLE** multipliers are applied to the **XP
  only** — `grantXp(amount, rewardScale)` scales the cash back down by the reciprocal — so they buy
  levels faster, which is what they advertise, without inflating the comp: the level reward is a flat
  `levelReward × level` however full the bar was when it popped. (Before, the reward was scaled by the
  same multiplier that filled the bar, so a ×2.25 Scholarship on top of a ×3 idle multiplied the comp by
  6.75 and turned levelling into a wage.)
- **Table limit.** `tableLimitBase` 400 × `level^tableLimitExp` 1.35, × the **Gambler's** multiplier
  (1 + `gamblerStack` per stack; ×1 with no stacks, so the level is still the only thing that moves it
  by default — the perk that used to stretch it was retired years ago and has now come back as an
  explicit, priced one). It is
  the most you may stake on **one round of any machine** (`tableLimit()` in `main.js`; a machine may
  override it down with `maxBet()`, never up — and that override wins over the Gambler too, because a
  machine's own ceiling is fitted to its balance), and it caps the round's LOSS as much as its win. It is
  printed in the bet panel. Level 1 → $400, level 30 → ~$39k, level 60 → ~$100k.
- **House maximum.** `maxWinMult` 1000. `playRound()` clamps the multiplier to it *before* perks, so
  no round of any game pays more than ×1000 the stake, whatever the machine, its luck or its perks
  produce. It is a true upper bound for every machine, and for the two free-flown games — Rocket Crash
  (target input clamped to it) and Frogger (`ladderCap` == 1000) — it is the real cap. **It only
  actually bites on Rocket Crash.**
- **Per-machine maximum.** In practice every other machine caps itself *below* the house clamp, and
  says so: a machine may declare `maxWinMult` on its descriptor, the best multiplier one bet unit can
  pay, and `renderBetTotal()` prints `game.maxWinMult × the round stake` (falling back to the house
  value). Shipped: slots ×200 (three wilds), Roulette ×36 (a straight), Blackjack ×2.5 (a natural),
  Horse ×60 (the payout clamp), Ghost Muncher ×4.9 (`WIN_SHARE × POT_CAP`), Treasure Chests ×10
  (`chestHigh`), Russian Roulette `TOP_MULT` (the top rung), Neon Recall ×8 (its ladder cap). Each
  value is *derived from the machine's own constant*, so it cannot drift out of step with the game.
  The bet panel is therefore a truthful "this table cannot pay you more than" line for every table.
  **The two progressive pots are the one payout that sits outside it** — see the next bullet.
- **Progressive jackpots** (`jackpotRate` 0.05, `jackpotHouseCut` 0.5, **one bank per 5-reel
  machine**). Every **losing** spin on Fortune Lines or Wheelhouse sets 5% of what it **lost**
  (`stake − payout`, never the whole stake) aside, the house keeps half of that slice and the other half
  climbs **that cabinet's own pot** (so 2.5% of the loss is banked). A spin that pays the player back
  **at least** their stake pays **no slice at all** — winning is never taxed, and neither is a **push**
  (a round that hands the stake straight back). The banks are funded entirely by players,
  so a pot is paid **outside `maxWinMult` and outside `applyPerks`** (`playRound` takes it after both,
  from the machine that earned it): clamping it would let the ×1000 ceiling confiscate a pot that had
  grown past it, and perks must not ride money that was never a bet.
  **The feed is a transfer, not a charge**: the payout is untouched and the slice comes out of money the
  house already holds, so the only term that moves a player's long-run return is the part that reaches
  the pot — 2.5% of the loss. Measured over each machine's own spin distribution (400k-spin draws
  against `resolveSpin` / `resolveSpinSequence`, pinned by the exact enumerators: P(lose) 0.7906 /
  0.7612, model returns 91.77% / 94.74%), the average loss is 75.1 / 65.8 points of the stake, so the
  pot hands back **1.88 / 1.64 points**. That is what the two machines now advertise: **93.65% / 96.38%
  cold**, i.e. their own model figure *plus* the pot — the honest long-run return of a cabinet whose
  meters are always eventually collected. (A player who never sees a pot realizes exactly the model
  figure; either way nothing is conjured, since a bank cannot pay out more than was put into it.) The
  house's realized hold is correspondingly its model edge **minus** the pot — 6.35 points on Fortune
  Lines, 3.62 on Wheelhouse.
  Keeping one bank per cabinet changed no cabinet's cost (each was always charged only on its own
  spins); it changed *who* a pot belongs to, and each meter therefore climbs only as fast as its own
  cabinet is played. No seed, no cap, resets to zero when won, persists in the save. **Lucky Sevens has
  no jackpot at all** (the player's decision): no sign, no meter, no slice, no bank — its advertised
  return is simply its own paytable, **95.68% cold / 96.69% at the cap**, and every symbol on its drum
  pays (the dead stop that used to sit on it was removed at the player's request, and the ladder came
  down with it).
  **This bullet used to carry a warning instead of a design.** The feed was once charged as 30% of the
  *stake* with 80% of it to the pot, which handed the pot ~18 points of a machine whose edge is 8.2 — so
  both cabinets advertised under 100% while actually paying **over 110%** to anyone patient enough to
  collect. The fix is in the two knobs above and in `jackpotFeed` now being handed the **loss**: the
  pot's share must stay under the thinner of the two edges (8.23 / 5.26 points), and 2.5% of the loss is
  1.88 / 1.64 points. Tune the pot's share, not the paytables.
- **Neon Recall's table maximum.** A memory ladder cannot be balanced with odds alone, because a player
  who writes the pattern down beats any fixed chance, so the memory table is the one machine with a
  **limit of its own**: `maxBet(level)` = `memTableBase` (100) × (level + 1), capped at `memTableMax`
  (2000) — $300 at level 2, $2,000 at level 19 and forever after, and it grows with the level exactly
  like the house limit does. That limit is the hard ceiling on a run: the shipped summit is ×3.03
  (`memSkillDecay` 0.93) and the guard cap ×8, so the biggest run a perfect reader can ever cash is
  3.03 × $2,000 = **$6,060**, and at level 2 it is 3.03 × $300 = $909. Compare that with the ×1,000
  crash/slot tail on a $21,300 level-19 stake — the memory "guarantee" is three orders of magnitude
  smaller than the lottery tails, which is the right shape for it: bounded, and it needs both a real read
  and the level first.

**The returns, at base and at the luck cap** (`computeEffects()`: level 200, every Lucky Coin →
`luck = 0.08`). The second column isolates **luck** — the one nudge that is hard-capped, so it is the
column that proves no machine is pushed to 100% by an *odds* bonus. All three slot figures are
**exact** now, from the same enumerator (an exhaustive 6³ table for Lucky Sevens; for the two five-reel
machines a DP over `(base symbol, run)` states per line, a Poisson-binomial for the scatters and — on
Fortune Lines — a branching process for the free spins; see "The jackpots" below for the recipe and its
cross-checks); the rest are their
own closed forms. The perk **payout** bonuses (Fat Stacks / Safety Net) are deliberately *not* folded
into that column — they are a player power curve, not a house-edge term; see the note below.

| machine | return at base | at the luck cap | note |
| --- | --- | --- | --- |
| Slots | 95.68% | 96.69% | exhaustive 6³ weighted table over the **six paying symbols**, and nothing else: this machine has **no jackpot**, so no slice is taken off any spin and the paytable's return *is* the machine's return. Every symbol on the drum pays — there is no blank window left to kill a line (it came off at the player's request; see "Lucky Sevens" and "The wild's weight" below, which also explain how the ladder was re-priced around the weight it took with it) |
| Fortune Lines | 93.65% (9 lines) | 94.93% | exact, three terms: line 81.56 + scatter 4.37 + free spins 5.84 = **91.77% cold** (93.04% at the cap) **plus the pot** (`jackpotRate` 0.05 × `jackpotHouseCut` 0.5 = 2.5% of every *losing* spin's loss, worth 1.88 points cold / 1.89 at the cap — see "The jackpots" below). Scatter pays × total bet, and the model does **not** change with the line count (every line is statistically identical, so the multiplier — and the RTP — is line-count independent) |
| Wheelhouse | 96.38% (25 lines) | 97.64% | 25 paylines **plus** a five-segment wheel: **three or more** `wheel` scatters *anywhere* drop it, and it pays 3/5/10/15/25 **× the total stake** (mean 11.6×), so the bonus is worth the same on 1 line or 25. 86.61 line / 8.13 wheel = **94.74% cold, 95.99% at the cap**, no scatter cash, **plus the pot** (2.5% of the loss = 1.64 points cold / 1.65 at the cap — see "The jackpots" below). Exact enumeration (see its section below), not a sim |
| Roulette | 97.30% | ≤97.31% | 36/37 on every sensible bet — every chip is the same size (the bet) and the round is `bet × spots`; red/black are mutually exclusive; luck nudge is `luck·0.05/max(2, bestPay)`, so a straight-up backer converts at most a sliver of losses |
| Horse Racing | 92.00% | ≤92.74% | `payout = 0.92/p` exactly (the 1.05 floor / 60 cap never bind: `p` ∈ [0.068, 0.353]); luck only inflates your runner's rating, and the relative boost is `(1+b)/(1+p·b) ≤ 1.008` |
| Rocket Crash | 97.00% | ≤97.48% | `P(crash ≥ m) = 0.97(1+0.06·luck)/m`, flat at every target |
| Treasure Chests | 93.75% | 93.75% | `(chestHigh+chestGem+chestMid+chestLow)/8` — four paying chests (one of each) plus one re-pick Lucky Star in a nine-chest grid, so **the four prizes must sum to < 8** (the non-star chests; the `COUNT` in `src/games/chest.js`) or it prints money |
| Russian Roulette | 90.00% | 90.00% | best play is cash out on rung 1; the first spin already loads **2 live of 6**, so no run is a formality and CASH OUT stays locked until the first blank; `rrRake` ships at 0 so the advertised multiplier is exactly what you keep. Perks are not `noPerks`: Safety Net fires on the third of first spins that end in the live round, so it adds `rebate/3` to the best rung (+0.5 points at the 10-stack rake-back cap: 0.900 → ~0.905) |
| Blackjack | ~99.5% | ~99.5% | honest S17 3:2 game; **`noPerks: true`** — no luck, no perks, no rigged dealer. This is the one table whose edge is genuinely thin |
| Texas Hold'em | ~97% (reference) | ≤99.1% | skill; a **fitted** table — every seat pays a flat `holdemFee` 3% of its own buy-in as a **seat charge** and there is **no pot rake** (a rake is a hopeless edge at this depth: you take about a third of the pots and an average pot is about a quarter of a buy-in, so even a 10% rake costs under 1% of the stake). Equal seats paying the same charge are an even game between themselves, so a seat that plays like the others returns exactly `1 − holdemFee` = **97%**, and *out-playing the bots keeps the difference*. Luck buys a **discount on your own seat charge** (`holdemLuckFee` 0.5), never a rigged deal → **98.5%** at the luck cap. The cage's whole-dollar rounding on top is worth up to +0.94% of the stake at a $25 buy-in, which is why the table opens at `holdemMinBet` $50 (from there it is within ±0.21%); the measured return stays under 100% at every stake (worst **0.9911**, a $200 buy-in at the luck cap). See its section below |
| Ghost Muncher | ≤98% (bot 83%) | — | skill; the exact return is `p · 0.35 · E[pot]`, which peaks at **98%** when `p = 1` — clearing every maze, the farmable outcome, is a 2% *loss*. See its section below |
| Frogger Gamble | ~0.24 (myopic bot); **~1.11–1.17** for a perfect planner | — | skill; **cars are the only thing that can kill you**, and since the sweep clock came off the grass the god planner's return had climbed without bound — **×4.72** with unlimited grass patience. The **hurry-up** (`froggerPatienceSec` 1.0 / `froggerPatienceDecay` 0.95: grass is safe but not free, and loitering past the grace sags the banked multiplier for the rest of the run) caps it: the same planner now measures **×1.14 at the shipped settings and stays flat at ~×1.11–1.17 whether it is allowed 1.5s or 90s of patience**, because patience stops paying. A careless bot still returns ~0.24. See "Frogger balance & the god harness" below |
| Neon Recall | ≤95% (reference) | — | skill; a **fitted** ladder — every rung past the knee is a fair bet for the reference player, whose return is flat at 95%, and every rung up to it pays exactly ×1.00, so there is no free money. The ladder starts to pay at 6 colours (the 5-colour knee: ×1.02 at 6) and its summit is ×3.03 (`memSkillDecay` 0.93 — the decay is the assumed per-colour memory beyond the knee, and the summit moves as its *power*, so 0.88 was ×7.35); hard ceiling **$6,060** a run via its own table limit |

**The invariants to preserve:** no single round of any machine pays more than `maxWinMult` × the stake,
**luck alone never pushes a table to 100%** (every row above is under 100% with `luck` at its cap), and
**no combination of perks pushes a table past 100% either** — the rake-back clubs are clamped to
`perkBudget` (1.5% of the stake), a number deliberately under the thinnest edge in the building
(roulette's 2.7%), and the comp (1% at five stacks) is the only other payout term, so the worst case —
every rake-back stack bought, betting red/black on roulette — is 97.30 + 2.5 = **99.8%**, still the
house's. The first version of this document said the opposite (perks were a power curve that carried
roulette to ~114.6% at twelve Fat Stacks, and the machine was a printer by design); that is fixed, and
only **Fortune** is still deliberately endless — a profit-share on wins rather than a stake bonus.
And **no machine has a farmable outcome** — an easy, human-repeatable result that pays more than the
stake, which a player could compound round after round. Blackjack is the only table close to even, and
it is deliberately stripped of luck and perks for exactly that reason. **Frogger is the one documented
exception, and the hurry-up has shrunk it**: its grass is safe (the player asked for cars-only deaths)
and a perfect planner still profits, but only by ~15% a run and *not by waiting* — the hurry-up means a
1.5s-patience script and a 90s-patience script both land around ×1.11–1.17. What is left is the ladder's
first rung (×1.25 at island 10) being reachable by a fast crossing rather than a patience exploit, and
the free ×1.00 verge bank means the god's EV can never fall below 1.0 at all: "the god returns slightly
over 100%" is a property of this machine's shape, not a knob left untuned. Do not claim the farmability
audit *fully* covers all thirteen machines until those first rungs are re-fitted.

**Power-curve note (what the perk retune did, and what the shared budget undid).** The perk *payout*
bonuses are not EV-neutral: a win bonus `w` adds `w · P(win)` to a round's return, a rebate `r` adds
`r · P(loss)`, and the comp adds `compChance · P(loss)` on top. The first version of this note recorded
the consequence honestly — "any table winning more than ~11% of its rounds crosses 100% once Fat Stacks
is deep enough", with roulette's red/black passing 100% at twelve stacks and reaching **~114.6%** with
both money perks maxed — and that is precisely the printer the shared `perkBudget` closes. The rake-back
clubs are now clamped to 1.5% of the stake *and* share that budget, and each caps at ten stacks, so the
most any machine can hand back is 1.5 points plus the comp's expected 1 point. Every perk-eligible
table's edge is fatter than 2.5 points, so maxed perks leave the house ahead everywhere. Fortune is the
one open-ended lever (below); if the house must ever be unbeatable again, lower `perkBudget`,
`winBonusStack` / `rebateStack` / `compStack` (or `profitStack`) in `main.pjs` (with their `cfg()`
fallbacks in `state.js`) — never a machine's own odds, ladder or paytable, all of which are fitted to its
**base** return.

**Fortune is the fourth term, and it is the one that scales with the win.** A profit bonus `p` adds
`p · E[profit | win] · P(win)` to a round's return, so unlike the stake-bounded perks it is worth most
on the *big-multiplier* tables (crash's and slots' tails), not the high-frequency ones, and it is
faithful to the reward the player actually sees ("+0.1% of the profit"). It is also endless, which is
the point — the price of a stack grows 1.35× each time while the reward grows linearly, so it is a
long-run commitment rather than a fast lever — but it means **no table has a hard 100% ceiling any
more**: enough Fortune stacks will carry any of them over, and that is the designed outcome of the
power curve above, not a bug. What Fortune cannot do is manufacture a win out of a loss or a push
(`applyPerks` only pays it on `profit > 0`), and it cannot beat the house maximum: `maxWinMult` is
applied *before* perks, so a ×1000 hit pays ×1000 plus the profit bonus, never more than the stake
times ×1000 × (1 + a little).

**No fast money (the farmability audit).** The average return is the *second* thing to check; the first
is whether any single rung can be farmed. The audit, machine by machine, looks for an outcome that is
(a) easy for a human and (b) worth more than the stake:

- **Neon Recall** used to fail both halves. Pass 1 was a three-colour pattern — trivial to see, and
  trivial to write down — paying a flat ×1.26, i.e. +26% a round with no risk at all, and the ladder
  compounded to ×294.81 / ×771.49 on top of it. It is now **fitted**: a rung pays `memLadderRtp`
  divided by the reference player's chance of reaching that rung, so the low rungs pay **exactly ×1.00**
  (a push — and zero XP, because XP is charged on profit, so there is no churn loop either) and the
  reference player's return is flat at 95% at every rung past the knee. The summit is ×3.03
  (`memSkillDecay` 0.93 — the ladder is the *ratio* of the reference odds, so the decay is a power and
  the summit moved from ×7.35 when it was 0.88) and the machine's table limit caps the run at $6,060.
- **Ghost Muncher** used to be a printer: `0.35 · (5p + 0.25(1−p))` for a clear rate `p`, which is
  **1.75× for a perfect player** and crosses even at `p ≈ 0.549`. The pot is now `arcadePotBase` 2.8 /
  `arcadePotStep` 2.1 / `arcadePotCap` 14, and the exact return is `p · 0.35 · E[pot]` — 0.83 at the
  bot's `p = 0.456`, 0.98 at `p = 1`, and **never even**: the farmable outcome (clear every maze) is a
  2% loss. The machine's note below carries the closed form for `E[pot]`.
- **The chance machines have no farmable outcome by construction.** Slots, Fortune Lines, Wheelhouse,
  roulette, horse racing, crash, chests and the revolver all pay their *easy* outcomes under the stake; their rare
  outcomes are rare per round and cannot be forced. The only per-play decisions that pay more than the
  stake are the deliberate gambles (a chip on the felt, a crash target, a chest pick), and their return
  is the row in the table above — none above 98%. **The slot jackpots are the newest thing to check
  here, and the honest answer changed when Lucky Sevens' pot was removed.** On the two 5-reel machines a
  pot is funded only from players' *losing* money (5% of each loss, house keeps half) and only its own
  signs can take it, so nothing is conjured and the pot's expected payout is small by construction
  (1.88 / 1.64 points, against edges of 8.23 / 5.26). Two honest notes remain. (1) The feed is
  proportional to the **loss** while the trigger is per **spin**, so at 25 lines a player feeds the pot
  much faster than a 1-line player for the same chance per spin — a transfer between players, not an
  edge, since the house's share is identical either way (see the jackpot section; a per-machine trigger
  weight is the documented lever if that transfer ever needs flattening). (2) The advertised figures for
  those two machines **include** the pot (93.65% / 96.38%), which is the honest long-run return of a
  cabinet whose meters are always eventually collected — but a player who never sees a pot realizes
  exactly the model figure, 91.77% / 94.74%. Turning the feed down (as this pass did) is what makes the
  advertised figure true rather than a hole; it was over 110% before.
- **Frogger is the last machine that fails this audit, and the hurry-up has taken most of it back.** With
  the sweep clock gone there was no cost to idling on the verge, so the "easy outcome that pays more than
  the stake" was simply *waiting*: a patient player reads each convoy, crosses when it is clean, and
  banks for more than ×1 — the god table below measured **×4.72** with unlimited grass patience. The
  **hurry-up** (`froggerPatienceSec` 1.0 / `froggerPatienceDecay` 0.95) makes grass safe but not free:
  the first second of any stand is on the house, and every second after it sags the banked multiplier
  for the rest of the run. The god's return is now **×1.14** at the shipped settings and — the point of
  the change — it **stops responding to patience**: 1.5s and 90s of it both land at ×1.11–1.17. What is
  left (~+15%) is not patience at all, it is the first rung: island 10 pays ×1.25 and a fast crossing is
  nearly always available to a planner. Closing that is a **ladder** decision (lower the first rungs),
  not another patience knob; and the god's EV can never fall below ×1.00 anyway, because banking on the
  verge is a free push.
- **Tails are bounded, not grindy.** `maxWinMult` 1000 is a *lottery*, not a grind: crash's ×1,000 tail
  is about 1 round in 1,000 at a 2.00 target (and the target input itself is clamped at the max), the
  slot five-of-a-kind is rarer still, and the memory summit is ladder-capped at ×3.03. Nothing on that
  list can be *worked toward*, which is the property that makes a top end safe.

**How the numbers were checked.** Slots and Fortune Lines were re-derived outside the page (the
weighted enumeration and a Monte Carlo of the reel model, both in `execute_js`), then spot-checked in
the live preview — and since the jackpot pass, **all three slot machines are enumerated exactly**
(the tuner in "The jackpots" below; its cross-checks are that Wheelhouse comes out at 95.693% and
96.26%-at-the-cap against the long-documented 87.6 + 8.1 = 95.70, and that Lucky Sevens re-run on its
pre-wild configuration — the `star` sitting in the `jackpot` slot and paying 200×/10× — reproduces the
long-documented **95.690% cold / 96.808% at the cap**, and the shipped six-symbol drum comes out at
**95.679% / 96.687%**; see "The wild's weight" below). In the live preview: mount a machine, set `.bet-input`, reset
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

## The loan: three ways it ends

`takeLoan()` (`src/state.js`) hands over `loanPrincipal()` = `loanBase + loanPerLevel · (level − 1)`,
and the player owes `principal × (1 + loanInterest)` within `loanMinutes` of **real** time. The loan
bar under the topbar is the whole live UI: the tag, a sentence, the clock, a fill that is the balance
measured against the debt, and a **PAY BACK** button.

**PAY BACK** is the point of the feature: it sits on screen the entire time a loan is live, so the debt
can be settled at any moment the balance covers it. It goes gold and prints the amount as soon as that
is true; while it is not, it is dimmed and clicking it says how much is still missing. It asks for one
confirmation first — it is the player's own money going out, and doing nothing is a perfectly good
answer — then calls `repayLoan()`.

Reaching the repay target does **not** pay the loan off by itself any more. It raises a one-time offer
(`showLoanReadyOffer`) — pay back now, or let the clock do it — and then leaves the money alone. The
offer is tracked per loan by `repayOfferFor` (the loan's `takenAt`), so a new loan gets its own offer
and the same loan is never nagged twice; it also waits for `#modalLayer` to be empty so it never lands
on top of a window the player is already reading. That gives three ways a loan can end:

1. **The player presses a button** — the bar's PAY BACK, or the one in the Loan Status window
   (`payLoanNow` → `repayLoan`). `repayLoan` re-checks affordability itself, so an offer left sitting
   on screen while the balance dipped is reported rather than silently ignored.
2. **The clock runs out with the balance able to cover it** — `settleLoanAtDeadline` pays it out of the
   balance and toasts that it did. This is the "let it do it by itself" half of the offer, and the same
   test runs at boot for a loan that expired while the tab was closed (which used to fail the loan on
   sight, contradicting the promise the offer now makes).
3. **A default** — the clock runs out with the balance **under** the debt, or the balance hits zero
   with a loan live (`playRound`'s `state.money <= 0.004 && state.loan.active` branch). Perks, level
   and stats are gone and the run ends.

The risk the middle option creates is deliberate and is stated plainly in the offer: while the loan
stands, the money above the target is still the player's to bet, and it can be lost before the clock
saves them. Nothing else moved — `repayLoan`, `failLoan`, the interest and the deadline are unchanged,
and `state.loan` still carries `{ active, principal, repay, takenAt, deadline }`, so the save format is
untouched and older saves hydrate as before.

## Wheelhouse: how the 25-line wheel machine is balanced

`src/games/slots-wheel-math.js` is the whole model; `src/games/slots-wheel.js` only draws it. Five
drums × three rows, **25 paylines** (a fixed list, verified distinct), a line selector of
1/5/10/15/25, and **one bonus**: **three or more** `wheel` scatters *anywhere* on the grid drop a
five-segment wheel over the cabinet that pays **3/5/10/15/25 × the TOTAL stake** (`bet × lines`,
not the line bet). Those five values are `wheelMult1..5` in `main.pjs`, so the owner can retune them —
and since the five segments are equal, a wheel is worth their **mean** per trigger (11.6× shipped).

The trigger is deliberately generous — **three anywhere, about one spin in 143** — which is roughly
three times as often as the old four-or-more rule, so the wheel had to be rebalanced *down* to pay for
it: the segment values came down from 10/20/30/40/50, and the scatter's own cash prize was removed
entirely. Three wheels is no longer a near miss with a consolation pay — it **is** the bonus.

Two terms, all **exact** — nothing here is set by simulation:

| term | cold | how |
| --- | --- | --- |
| the 25 paylines | 86.61% | a DP over `(base symbol, run)` states, averaged over the 25 line paths |
| the wheel | 8.13% | P(3+ scatters) × mean segment = 0.007008 × 11.6 |
| **total** | **94.74%** | **95.99%** at the luck cap (`luck = 0.08`) |

(These are the figures **with** the jackpot sign on the drums, i.e. the shipped ones. Before the sign
existed — `crown` at 2.2 and no `jackpot` symbol — the same tuner gives 87.56 + 8.13 = **95.69%
cold / 96.26% at the cap**, which is the 87.6 / 8.1 / 95.7 breakdown this table carried for years: that
agreement is what says the enumerator is right.)

Those are the machine's **own** model figures. Like Fortune Lines it also carries a progressive pot, and
that pot **adds** to its return rather than being a rake: the feed is charged on the loss and 2.5% of it
climbs this cabinet's meter, worth **1.64 points** cold, so what the machine advertises is **96.38% cold,
97.64% at the cap** (see "The jackpots" below). (Lucky Sevens has no pot at all.)

- **P(3+) 0.7008%** (1 in 143) at `BONUS.w = 3.35`, against a per-drum total of 124.15. The count is a
  Poisson-binomial over the five drums, which draw their three cells independently. There is **no
  separate scatter cash pay** any more: at a 1-in-143 trigger the wheel is the whole event, and a
  consolation pay on top of it would have to come out of the wheel's own 8% slice.
- **Luck never touches the wheel — nor the jackpot sign.** `luck` lifts the tier-1 and tier-2 line
  symbols on every drum (exactly the way Fortune Lines does it) plus a flat `luckBonus` 0.4 lift on
  every line pay. Both scatters (the wheel and the `jackpot` sign) are pushed onto the drum with a
  **fixed** weight, because the wheel pays a straight multiple of the stake and is the one term that
  could carry the machine past 100%, and because the pot is other players' money. Luck does still shave
  the bonus probability a hair (it inflates the denominator a fixed weight is divided by), which is why
  the line-side lift is set high enough to pay that back *and then some*: the return **rises** with
  luck, 94.74% → 95.99%, and never crosses 100%.
- **Wilds sit on all five drums.** Fortune Lines nails its wild to the middle three, which makes the
  head of its paytable unreachable (a run has to start on drum 1, so five wilds can never be paid
  there). Here five wilds is a real ~1-in-3-billion jackpot, and a wild leading a line is the sight
  the machine is built around.
- **The line table is squeezed flat at the top** — crown and wild both top out at 1000 per line bet,
  the house ceiling — because a 24-weight cherry runs three deep some two thousand times more often
  than a crown runs four, so the cheap symbols carry roughly 75% of the line return. The best grid
  possible (every cell one symbol) is exactly 1000× the stake on 25 lines, so the house clamp never
  really bites here.
- **The meter.** The cabinet carries a pit meter (`games/ledboard.js`) whose
  `TOTAL` row is `per-line bet × live lines` — the number a spin actually costs, which the side
  panel's per-line "amount" never showed on a 25-line board. It follows the line buttons and the bet
  through the machine's `onBetChange` hook (see "The pit meter" below).

**The tuner.** The two numbers above come from an exact enumerator in `execute_js`, not a sim:

1. read `slots-wheel-math.js` as text and swap its `import … from "../state.js"` line for a literal
   `CONFIG` stub, then import the resulting object URL (the same trick the other harnesses use);
2. compute each symbol's line EV with a DP over `(base symbol, run)` states — a wild is folded in as
   "best paying symbol this run could still become" — and average over the 25 distinct line paths;
3. get P(k scatters) from the Poisson-binomial over five independent three-cell draws;
4. add `P(3+) · mean(wheelValues())` (a share of the TOTAL stake) — and nothing else, since there is
   no scatter pay to add;
5. repeat at `luck = 0` and `luck = 0.08`.

Measured alternatives, if a re-tune is ever wanted (all at 25 lines, with the jackpot sign on the drums
as shipped, cold / cap, trigger — note that changing `BONUS.w` also moves the *line* term, because it
changes each drum's total weight):

| wheel values | `BONUS.w` | line | cold | cap | trigger |
| --- | --- | --- | --- | --- | --- |
| **3/5/10/15/25 (shipped)** | **3.35** | **86.61%** | **94.74%** | **95.99%** | **1 in 143** |
| 3/5/10/20/25 | 3.25 | 86.85% | 94.99% | 96.25% | 1 in 155 |
| 3/5/10/15/25 | 3.45 | 86.37% | 95.16% | 96.39% | 1 in 132 |

A Monte Carlo of the shipped model agrees to within its standard error. Any change to the pays, the
weights or `wheelMult1..5` invalidates the table above **and** the Wheelhouse block in the `main.pjs`
balance book (which carries the same 86.6 / 8.1 = 94.7 breakdown) — re-run the enumerator; do not
assume.

## The jackpots (one bank per 5-reel machine)

**Lucky Sevens has no jackpot at all.** The player asked for the 3-reel machine to stay the plain one, so
it has no sign on the drum, no meter, no pot, no slice taken off any spin and no bank in the save:
its return is simply its paytable (95.68% cold / 96.69% at the cap — see "Lucky Sevens" below), and it
has no dead weight on the drum either: every one of its six symbols pays (the drawn **blank window** the
sign left behind came off at the player's request). `JACKPOT_GAMES` / `isJackpotGame` in `src/state.js` name only
the two machines that still carry a bank, which is what keeps `playRound` from feeding one for it, and a
save that was still holding a Lucky Sevens pot has it **paid into the player's balance on load**
(`hydrateState`, with a toast from `src/main.js` so the windfall is explained).

The **two 5-reel machines — Fortune Lines (`slots-multi.js`) and Wheelhouse (`slots-wheel.js`) — each keep
their own progressive bank**, and neither shares a pot with the other. They are the only machines in the
pit with a bank at all, so a single `state.jackpots` map keyed by machine id holds `{ amount, fed, best,
hits }` per cabinet. `jackpotRate` (default **0.05**) of every **losing spin's LOSS** (`stake − payout`)
is set aside *for the cabinet it was spun on*; the house keeps `jackpotHouseCut` (**0.5**) of that slice,
and the other half — **2.5% of the loss** — climbs that cabinet's pot. A spin
that pays the player back **at least their stake pays no slice at all** — that is the rule the player asked
for, and it is *stricter* than `recordPlay`'s `stats.wins` test: a **push** (a round that hands the stake
straight back) is recorded as a loss for the stats but pays no jackpot slice either, because the player did
not actually lose anything. Both knobs live in `main.pjs` with `cfg()` fallbacks in `src/state.js`, and each
machine's pod reads **its own** bank live through the state bus's `jackpot` event (which carries
`{ game, amount }`), so a spin on Wheelhouse fills the Wheelhouse meter and leaves Fortune Lines' meter
exactly where it was.

(The feed is applied in `src/main.js` *after* the round resolves — `const roundLost = payout < roundStake;
if (roundLost && isJackpotGame(gameId)) jackpotFeed(roundStake - payout, gameId);` — so it is necessarily
the post-perk, post-clamp payout that decides it, the slice is charged on what the spin actually **lost**
rather than on the whole stake, and the bank it lands in is the bank of the machine that took the spin. A
win and a push both fail that test; loosening it to `<=` would tax every push again, and moving the call
above the spin would silently reintroduce the old always-charged rake.)

- **Each bank is the players' money and nothing else.** It starts at zero, it resets to zero when it is
  won, and the house never seeds it. That is what makes it safe to leave uncapped and free of any
  "seeding" RTP term: a bank cannot pay out more than was put into *it*. It banks **2.5% of every loss**
  (≈1.9% of the stake on a losing spin), so a meter gains a stake's worth every ~53 losing spins on that
  cabinet and typically stands at several tens of times the stake by the time it goes.
- **What each pot costs its machine — and how it is kept under 100%.** The feed is a **transfer**, not a
  charge: the payout is untouched and the slice comes out of money the house already holds, so the only
  term that moves the player's long-run return is the part that reaches the **pot** — 2.5% of the loss.
  Measured over each machine's own spin distribution (400k-spin draws against `resolveSpin` /
  `resolveSpinSequence`, pinned by the exact enumerators: P(lose) 0.7906 / 0.7612, model returns 91.77% /
  94.74%), the average loss is **75.1 / 65.8 points of the stake**, so the pot hands back **1.88 / 1.64
  points**. That is what the two machines now advertise — **93.65% / 96.38% cold** against model figures
  of 91.77% / 94.74% — i.e. the model *plus* the pot, which is the honest long-run return of a cabinet
  whose meters are always eventually collected. (A player who never sees a pot realizes exactly the model
  figure; and since a pot is funded only from losses, it can never pay out more than was put into it.) The
  house's realized hold is correspondingly its model edge **minus** the pot — 6.35 points on Fortune
  Lines, 3.62 on Wheelhouse — so the machine stays comfortably the house's, at every stake and every
  luck level.
  **This bullet used to be a caution instead of a design.** The feed was once charged as a flat 30% of
  the *stake* (not the loss) with 80% of it to the pot, which handed the pot ~18 points of a machine whose
  edge is 8.2: both cabinets advertised under 100% while actually paying **over 110%** to anyone patient
  enough to collect. The fix is the two knobs above (`jackpotRate` 0.05, `jackpotHouseCut` 0.5) plus
  `jackpotFeed` being handed the loss; the invariant to keep is that **the pot's share must stay under the
  thinner of the two edges** (5.26 points), because the pot's share is the only number the player's return
  actually sees. Never retune the paytables to compensate — they are fitted.
- **The banks are separate, and that is the only thing the split changed.** A cabinet was always charged
  only on its own spins, so no cabinet's rake — and therefore no advertised return — moved when the old
  single pot was divided. What changed is the destination: a Wheelhouse loser no longer funds a Fortune
  Lines winner. Two consequences worth knowing. (1) Each meter now climbs *only* as fast as its own cabinet
  is played, so a regular who spreads play across both watches each pot grow roughly half as fast as the
  old shared meter did; a pot you never sit at never grows at all. (2) Two older save shapes are migrated
  rather than discarded: an old **single shared bank** is handed whole to the cabinet the player was
  standing at (`data.machine` if it is one of the two pot machines, otherwise **paid to the player**, since
  the machine it came from no longer carries a pot), and a **Lucky Sevens bank** is paid out the same way.
  Nothing is conjured by either change and nothing is lost.
- **It is armed by three JACKPOT signs anywhere on that machine's drums.** The sign is the artwork
  sheet's own `jackpot` marquee (`src/sprites/jackpot.png`, drawn through `src/sprites.js` like every
  other symbol, with the 🎰 emoji as its load-error fallback). It is a **scatter** in the same sense as
  the wheel: it pays nothing on a payline and *breaks* the line it lands on, and **three or more of them
  anywhere on the fifteen cells** take the pot. A **wild never stands in** for one (both `evaluateGrid`s
  compare the raw cell id against `JACKPOT_ID`, and both stop a payline run at it). The sign is a real
  symbol on every drum of both machines, and the UI rings each one it draws in the meter pod's own red
  (`.mlcell.jcell` in `styles.css`, set in each machine's cell builder), so it is visible both as it blurs
  past in a spin and where it stops — the player can see the thing that empties the pot, not just read
  about it.

  | machine | drums / total weight | per-cell `P(jackpot)` | armed by | trigger | its own bank |
  | --- | --- | --- | --- | --- | --- |
  | **Fortune Lines** (5 × 3 = 15 cells) | 121.6 mid, 117.6 outer | 1 / 121.6 = 0.008224 (mid), 1 / 117.6 = 0.008503 (outer) | 3 of 15 cells | **1 in 4,091** | `state.jackpots["slots-multi"]` |
  | **Wheelhouse** (5 × 3 = 15 cells) | 124.15 on every drum | 1 / 124.15 = 0.008055 | 3 of 15 cells | **1 in 4,522** | `state.jackpots["slots-wheel"]` |

  Both figures are exact and come from a **Poisson-binomial over the fifteen independent cells** (each drum
  draws its three cells independently — that is what `spinGrid` does). Fortune Lines carries two per-cell
  probabilities because its wild is nailed to the middle three drums, so its two outer drums have a smaller
  total weight and therefore a *heavier* chance of a sign.
- **The two machines are not equal, and the honest number is per dollar staked.** The feed is charged on
  the **loss** while the trigger is per **spin**, so Wheelhouse (25 lines) takes its pot from a much
  fatter wallet than Fortune Lines (9 lines) does. Per dollar staked on **one line**: one Fortune Lines
  line arms its pot 1 in 1.8 million, one Wheelhouse line 1 in 1.9 million; a 25-line Wheelhouse player
  closes most of the gap — 25 attempts per spin puts him at roughly 1 in 181 *dollars* — but he is buying
  25× the pot chance with 25× the stake, which is the transfer, not an edge. **This asymmetry is real and
  it is documented rather than buried**: each pot is a player-to-player bank, and the pot's expected
  payout is a flat 2.5% of the loss either way. If it ever needs flattening, the levers are a per-machine
  trigger weight or a feed charged per *spin* instead of per loss — never the paytables, which are fitted.
- **It cannot be farmed by manipulating a spin.** Feeding is charged on the loss, so a hundred-dollar
  *losing* spin feeds in proportion to what it actually dropped — and the pot it can take is the same
  player-funded bank everyone else is feeding. Winning spins feed nothing, and neither do pushes, so a
  "grind the high-frequency tables" plan feeds *less* than the old always-charged rake did, not more.
  There is no bet size, timing, line count or idle-vs-manual choice that changes the pot's expected
  payout. Idle auto-play feeds exactly like manual play, and re-sitting on a different machine moves no
  value between banks: each pot belongs to its own cabinet and only its own signs can take it, so hopping
  machines is strictly worse for the pot than parking on one (the pot you abandoned keeps its money, but
  it is not paying you).
- **The admin rig deliberately cannot forge a pot.** Both 5-reel machines run every random grid through
  `stripJackpots(grid, rng, luck)`, which replaces each `jackpot` cell the random draw produced with a fresh
  draw from the same drum. A pot is other players' stake set aside, so a cheat spin may win money but never
  a pot. Luck cannot lift the sign on either machine, where `JACKPOT.w` is a fixed weight, so the trigger
  rate is the same at every luck level.
- **The payout sits outside the books.** In `playRound` the pot is taken *after* `applyPerks()` and
  *outside* the `maxWinMult` clamp (see the comment there): a pot is not a bet the house is funding, so it
  must not be scaled by luck/perks, and clamping it as if it were a ×1000 round would let the house maximum
  quietly confiscate a pot that had grown past it. Only the spinning machine's own bank is emptied —
  `jackpotTake(gameId)`, and `playRound` also tests `isJackpotGame(gameId)` first so a stray flag on a
  pot-less table can never reach another cabinet's bank — and the other bank is left untouched. The **feed**
  is still charged on a genuine loss whether the pot is taken or not (and a win or a push pays no charge at
  all). The pot is added to both `payout` and `profit` before `recordPlay`, so it lands in `stats.won`,
  `biggestWin` and the history row exactly like an ordinary win — with its own louder popup, confetti
  burst, a `JACKPOT` flash on the cabinet's pods, and a toast that names the machine. Note that this makes
  a jackpot spin's *payout* larger than its line pay, so a pot win can turn a spin that would have been
  recorded as a loss into a win for `stats.wins` — correct, and the reason the feed test uses the final
  `payout`.
- **It persists in the save** (`state.jackpots`, hydrated for older saves as described above), so each
  of a regular's pots keeps climbing between sessions. There is no cap, and the number on a pod is that
  cabinet's whole bank — the value at typical play is worth **several tens of times the stake**, because
  2.5% of every loss on that machine has been skimmed into it.
- **Both surviving machines' info cards say so.** Fortune Lines and Wheelhouse each document it in their
  PAY TABLE card in a section titled "The jackpot (this machine's own)" — stating the three-signs-anywhere
  trigger, that the wild does not substitute, that the sign pays nothing on a line, that **the bank is that
  cabinet's alone**, that only a genuine loss feeds it (never a win, and never a push), the 5%-of-the-loss
  feed rate (the house keeps half, the meter gets the other 2.5%),
  and the machine's own exact trigger rate. Both cards also state that the sign is visible on the drums
  (ringed in red) and, once a bank has been hit, how many times and for how much — read live from
  `jackpotBankView(gameId)`. If the feed, the trigger, the trigger odds or the bank layout ever move, those
  copy blocks move with them. **Lucky Sevens' card has no jackpot section at all**; it explains the
  paytable and the wild instead.

### The exact tuner (all three slot machines)

Every figure above comes from one deterministic enumerator in `execute_js` — no simulation is used to
*set* a number (a Monte Carlo only ever confirms one):

1. read the math module as text, swap its `import { CONFIG } from "../state.js"` line for a literal
   `CONFIG` stub, and `import()` the resulting blob URL — the same trick every harness in this file uses;
2. **Lucky Sevens** is small enough to enumerate outright: 6³ weighted triples through the same
   `evaluate` the game uses (the wild filling in, three-of-a-kind, premium pairs and the left-anchored
   cherry pair — every symbol on the drum pays, so nothing kills a line), which
   gives 95.679% cold, 96.687% at the luck cap (`luck = 0.08`), `P(win) = 0.3125`,
   `P(lose) = 0.6875` cold / 0.6864 at the cap;
3. **the 5-reel line term** is a DP over `(base symbol, run)` states, one drum at a time — a wild
   extends the run for whichever base it is currently building, any other symbol either joins the base
   or finalises the run and kills the line. Because every payline covers each drum exactly once, the
   per-line EV is identical for all 9 (or 25) of them, which is why the multiplier — and the RTP — does
   not depend on how many lines are live;
4. **the scatters** (and the jackpot trigger) are a Poisson-binomial over the fifteen cells' individual
   probabilities, which is exact because each drum draws its three cells independently;
5. **Wheelhouse** = line + `P(3+ wheel) × mean(wheelValues())`. Nothing else — it has no scatter pay;
6. **Fortune Lines** = line + `Σ_{k≥3} P(k scatters) · SCATTER.pay[k]` + the **free spins**, which are
   a branching process: with `R` the expected reward of one free spin and `O` the expected number of
   spins that free spin awards (`freeSpinsFor` at `luck + freeBoost`), and `F0` the expected award of
   the base spin, the free term is `F0 · R / (1 − O)`. Shipped: line 81.563 + scatter 4.370 + free
   5.836 = **91.768% cold**, 93.037% at the luck cap.

**Cross-checks that say the enumerator is right.** Wheelhouse, run on its *pre-jackpot* configuration
(`crown` 2.2, no sign), gives 87.56 + 8.13 = **95.69% cold / 96.26% at the cap** — exactly the
87.6 + 8.1 / 95.70 / 96.29 breakdown this file has carried for years. Lucky Sevens re-run with the
`star` back in the `jackpot` slot pays 95.690% cold / 96.808% at the cap, matching the 96.21 + 0.6 =
96.81 this file carried for years; the later sign-on-the-drum configuration (that same slot holding a
dead sign at tier 2) is 95.679% / 96.226%, and the shipped six-symbol drum — the same slot with its five
units of dead weight taken off the drum altogether and the ladder re-priced 4/7/14/34/60 → 3/5/10/25/50
to make up for it — is **95.679% / 96.687%**. The 0.011-point cold drift from the `star` figures is the
wild swap (see "The wild's weight").
And a 20-million-spin Monte Carlo *of the shipped
`resolveSpinSequence`* returns **91.702% ± 0.075** for Fortune Lines, within 1σ of the 91.768 above.
The price of the feature is then just the difference between the two configurations: **0.841 points**
on Fortune Lines (`star` 2.5 → 1.5 with the sign in at 1.0) and **0.954 points** on Wheelhouse
(`crown` 2.2 → 1.2) — while Lucky Sevens is unchanged to a hundredth of a point (95.690% → 95.679%),
because the sign's old 200×/10× pays were handed to a new `wild` carrying about 1 of the drum, which is
worth the same amount (see "The wild's weight" below).

**The feed's probability — and its size.** The house's share of the feed is
`jackpotRate × jackpotHouseCut × E[loss]` and the pot's share is `jackpotRate × (1 − jackpotHouseCut) ×
E[loss]`, so there are two things the enumerator does not hand over: how often a machine *loses*, and how
much it loses when it does. On Lucky
Sevens the first is exhaustive from the same 6³ table: **P(lose) = 0.6875 cold / 0.6864 at the cap**, of which
**0.0690 is a *push*** — the cherry pair paying exactly 1× — which under this rule feeds
nothing. Lucky Sevens has no rake to weigh any more (its pot is gone), but the figure is still that
machine's own loss rate and the rule is unchanged on the two machines that do charge. The two 5-reel machines have no such enumeration, because a loss is a property of the whole
grid (all 9 or all 25 lines have to fail together), so they are **measured** by running the shipped
`resolveSpinSequence` (Fortune Lines) and `resolveSpin` (Wheelhouse) under a seeded `mulberry32` — two
independent seeds × 8,000,000 spins each, agreeing to within 0.0004: **Fortune Lines P(lose) = 0.7909
cold / 0.7949 at the cap**, **Wheelhouse P(lose) = 0.7613 cold / 0.7651 at the cap** (a push —
`totalUnits` landing exactly on the line count — is about 1 spin in 740 on Wheelhouse, and has not been
seen at all on Fortune Lines). The same runs give the **average loss**: **75.1 / 65.8 points of the
stake** cold and 75.6 / 66.1 at the cap, which is the number the pot is actually charged against — hence
the RTP column above adding `0.025 × E[loss]` (1.88 / 1.64 points) rather than anything involving
`P(lose)`.
(The same runs also produce a mean multiplier, but that is far too noisy to set a return figure —
Fortune Lines' free-spin tail spreads its mean by ~0.1 points even over 8M spins — which is exactly why
the returns come from the enumerator and only the *loss* statistics are taken from the sim.)

## The pit meter

`src/games/ledboard.js` is a small pit meter the two 5-reel cabinets wear. It is **one window
per number, on a line of its own** — each window has its own plate, its own label above and caption
below, and there is no panel around the group at all —
`slots-multi.js` and `slots-wheel.js` wear `TOTAL` + `LINES` + `JACKPOT`. **Lucky Sevens wears no
meter at all** (the player's call — it has no pot to window and no number the rest of the cabinet does
not already state), so its stage is just the lone three-reel cabinet. The layout is the point:
the first version was one long strip and its successor was one framed slab holding every pod, and in
both a player read a two-digit `LINES` sitting over a seven-digit `TOTAL` as the two halves of a single
clock face with several faces glued together. Separate windows cannot be read that way — there is
nothing around them to suggest they belong to one display.

**The window is the casino's own panel, not a readout flown in from somewhere else.** Each one is the
navy plate the reel window and the pay chips are cut from (`linear-gradient(180deg,#1d2740,#121a2a)`,
`1px solid #3a4867`), with a gold hairline glowing across its top edge — the same gold rule the top
bar, the payline and the marquee use — the label in the muted caption type every other label on the
page is set in, and the numbers in the same **gold** as the money in the top bar, with the same glow.
Where a machine carries a pot, that window is the **same navy plate with a RED rim lit like a neon tube**
(`1px solid #ef4d5a`,
outer `0 0 15px rgba(239,77,90,.45)` plus an inner red wash), a red hairline across its top edge and a
red label, and its figure is **cut like the gem on the drums**: the digits are filled with a vertical
diamond-facet gradient (`linear-gradient(180deg,#fff 0%,#dcf5ff 20%,#83d6ff 44%,#2f9ae8 70%,#c6ecff 100%)`
clipped to the glyphs, so the table facet is near-white at the top and the pavilion runs azure to deep
blue), glowing with an icy `drop-shadow` filter. It is the one figure on the meter that is not a fact
about your own bet, so it gets the one frame on the meter that is not navy and gold and the one figure
that is not flat gold. **Only the two 5-reel cabinets wear a meter at all** — Lucky Sevens has no pot,
and (the player's call) no meter either, so there is nothing on it watching anybody's money. The sign
itself is **not** on the meter — it belongs on the drums, and the meter
window is just the readout of **that cabinet's own** pot (see "The jackpot sign in the spins" below).
(Two skins came
before: a slab of dark green glass with scanlines and a phosphor
glow — a CRT clock face, which is a look this casino has nowhere else — and then the marquee's bronze,
which read heavier than the plate beside it.) The only thing still naming the group is the small
`PIT METER` caption under the last window. `.ledboard` itself draws nothing — no background, border,
padding or shadow — it is only the flex column that stacks the windows, and the windows stay **one per
line at every width** (the phone blocks shrink the padding and the type, never the layout), so the
meter grows taller on a narrow screen rather than wider.

Numbers are **ordinary text** in the game's display face (Bebas Neue), `tabular-nums` and right-aligned,
so a climbing figure never shuffles sideways; each pod keeps a min-width of its full digit count so the
plate does not twitch, and a figure too long for the field flips to a compact suffix (`1.2M`). (The board
used to DRAW them — seven `clip-path` bars per character, `.led-seg` in `src/styles.css` — which read as a
digital clock rather than a number, so the bars are gone and only the panels, labels, captions and the
gold/diamond split remain.) Rows read live state through a `read()` callback rather than being pushed, and refresh
on the state bus's `jackpot` event plus each machine's own `onBetChange` hook. The stack hangs inside
`.cab-row`, which is `align-items:stretch`, so the column is pulled down to the cabinet's full height
and the windows centre on it rather than dangling at the top of a tall empty gap; on a narrow screen
`.cab-row` wraps and drops the stack under the cabinet rather than squashing it (verified at 390×844
and 1920×1080 for the two 5-reel machines).

**The jackpot sign in the spins.** The strip a drum blurs past while it is spinning is drawn from the
**same weighted table the drum itself stops from** (`reelWeights` in both `slots-*-math.js`), via a
`fillerPicker(reel, luck)` built once per scroll and then sampled for the strip's two dozen cells. That
matters because of a bug the meter made obvious: Fortune Lines and Wheelhouse used to fill their strips
with a flat pick over `PAYROW` — the paying symbols plus the wild — and `PAYROW` does not contain the
jackpot sign, so the sign **never appeared in a spin** on either 5-reel machine even though it is on
every drum. (Lucky Sevens has always drawn its filler from `SYMBOLS`, so the wild and every symbol it
stops on flash past there like the rest.) Now the
wild, the scatter and the sign all flash past at the rate their own drum really carries them — the sign
at ~0.8% of cells, the wheel at ~2.7%, an honest picture of the drum instead of a flat one. Nothing
about the maths moved: the strip is decoration, and the grid a spin actually stops on is still the one
`resolveSpin` / `resolveSpinSequence` produced.

**And the sign is ringed where it shows.** Every drum cell whose symbol is the jackpot sign is built
with a `jcell` class (`cell()` in `slots-multi.js` / `slots-wheel.js`), and
`.mlcell.jcell::after` in `styles.css` paints the meter pod's own red rim
over it — a 2px inset ring, a soft outer glow and a slow 2.6s opacity pulse. So the one symbol that can
empty a pot is recognisable both as it blurs past in the spin and where it stops, which is the whole
point of the sign being on the reels: the player can *see* what they are rolling for. It is a drawn ring
rather than a cell background so it cannot be confused with the gold wild cell (`.wcell`) or the blue
scatter cell (`.wcell-scatter`), and at ~0.8% of 5-reel cells there are only ever
one or two of them lit at a time. (The shared rule still names `.reel-cell.jcell` for the 3-reel cabinet,
but nothing sets that class any more: Lucky Sevens has no sign to ring, and no dead stop to draw either —
every face on its drum is a sprite from `sprites/`.)

**Why the `TOTAL` row exists:** on a multi-line machine the side panel's "amount" is the money *per
line*, and the money actually leaving the pocket is that times the live lines — a 25-line board at $10
is a $250 spin, which the old UI never said plainly. The meter's `TOTAL` pod is that number, and it is
the reason the machine's belly paytable now lays out as **one row of chips** (`.mline-wrap .ml-pay` is
`grid-auto-flow:column`) instead of a wrapped grid: with the total stated plainly next door, the chips
only have to list the pays, and one even row is what fits a 640-pixel stage.

The same decluttering logic applies to the paytables themselves: Wheelhouse's belly shows 10 pays
(nine symbols plus the wild) above its `3+ WHEELS` banner, Fortune Lines shows 10 (eight symbols, the
wild and the scatter), and the 3-reel machine's 6 pays live in a three-column `.slot-pay` grid inside
the cabinet. **The two 5-reel cabinets carry a full-width strip under that ladder for the one symbol
that is not a rung of it.** That strip is the **POT** row, because the jackpot sign is a scatter: it is
shown as its own row — the sign, the word `POT`, and `3 SIGNS ANYWHERE — PAYS NOTHING, TAKES THE POT` —
instead of as a chip advertising a multiplier beside the pays that really exist (`.mlchip.pot` on the
two multi-line bellies and in both their info cards' `Pays per …` chip rows). **Lucky Sevens has no such
strip** (the player's call — that machine's belly is the six pays and nothing else, and every one of them
is a symbol that pays). The strip's note is the
one piece of chip text in the game allowed to **wrap**: the sentence is wider than a phone-width strip, and
a clipped "TAKES THE PO…" is worse than a second centred line.

## Fitting the machines on screen

Slot cabinets (and the tables around them) are dense, and the preview pane is often narrower than the
machine wants, so fitting is handled by **container queries on the stage**, not by viewport media
queries. `#stage` carries `container-type:inline-size`, and three `@container` steps then shrink the
machines as the stage gets narrow:

| step | what it does |
| --- | --- |
| `(max-width:900px)` | reels 118×136; the first gentle squeeze |
| `(max-width:700px)` | reels 104×118, the meter's `--led-h` drops to `clamp(15px,3.2vw,23px)`, tighter pods/labels/foot text, and the belly chips compact to `padding:3px 4px` with an 18px glyph |
| `(max-width:560px)` | `.cab-row` stops sitting beside the cabinet and the window stack lies under it (still one window per line) |

Container queries rather than `@media` because the stage's width is **not monotonic** in the viewport
width: `#layout` is a three-column grid above 1300px (nav / stage / bet panel), and the stage actually
gets *wider* relative to the page as the viewport shrinks toward that breakpoint. A viewport query
would fire at the wrong widths; a container query measures the box the machines actually live in.

The layout breakpoints themselves were moved out to `max-width:1300px` (three-column with a 236px bet
panel) and `max-width:1040px` (single column, nav on top, bet panel below, page scrolls), so the stage
is never starved of width while the bet panel keeps its own space. `src/main.js` moves the floating
PLAY button between the two arrangements with `matchMedia("(min-width:1041px)")` — **that 1041 must
stay in step with the CSS's 1040** — plus a `resize` fallback listener.

Short windows are handled separately by `@media (max-height:830px)` blocks that compact roulette, the
hold'em table, and the slot cabinets. **Cascade rule: each of those blocks must sit AFTER the base
rules it overrides.** An equal-specificity rule earlier in the file loses to a later one, so a
compaction block placed too high simply does nothing — the hold'em block had to move down past the
hold'em rules and the top-align block must be the very last thing in `styles.css`, after `.mem-wrap`
and `.rr-wrap`.

**Top-aligning matters.** The layout's flex containers centre their children, which means a machine
taller than its stage overflows *visibly in both directions* and its top is unreachable. The
top-align block sets `justify-content:flex-start` so overflow spills downward only, where the page can
scroll to it. The canvas arcade machines (Ghost Muncher, Frogger, Neon Recall, Treasure Chests,
Russian Roulette) still overflow their stage at the default pane and are **deliberately not fitted** —
shrinking their canvas would hurt playability, and the top-align rule is what makes their overflow
harmless.

### The perk shop's hover window

A perk's blurb is a paragraph — the Fat Stacks write-up alone is longer than the card it used to sit in,
which is why the card clipped it. The prose now lives in a single floating window (`openPerkShop` in
`src/main.js`, `.perk-pop` in `styles.css`) that opens while the pointer is over a card's header — the
icon, the name, or the little **i** badge — and follows its card if the shelf scrolls. Three details
matter: the window is `pointer-events:none`, so it can never sit between the player and a BUY button;
`placePop()` keeps it inside the viewport (above the card by default, under it near the top edge,
clamped on all four sides — a card half-scrolled out of the shelf still gets a readable window); and
the badge **pins** it open on click, which is the only path that exists on touch, and the keyboard path
too (it is a real `<button>`, so focus opens it — note `focus` only fires when the tab really has
focus, so a backgrounded preview looks like it does nothing). A pinned window survives the re-render a
purchase triggers, and the shop's `onClose` removes the node and its four listeners. The card keeps one
line of its own — `Now: …`, or `Next: …` at zero stacks — which is the same `stacks()` text the window
and the toasts use, so a card never quotes a number the rest of the game disagrees with. The `popIn`
keyframes animate **transform only**: a backgrounded tab throttles its animation clock, and an opacity
keyframe would leave the window invisible in that state rather than merely a few pixels off. The badge's
glyph is a `<span>` for a reason worth remembering: on this page a stylesheet **cannot** colour a
`<button>` itself (the platform's own button styling beats an author `color`, while `border` and
`background` from the same rule apply normally — and an inline `color` does work), but a rule colours
anything *inside* one, so the gold "i" and its hover tint are set on `.perk-i-glyph`, not on the button.

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

- **Slots** (`games/slots.js`) is the plain three-reel machine, and — by the player's decision — the one
  cabinet in the pit with **no jackpot at all**: no sign, no meter, no pot, no slice taken off any
  spin, and no bank in the save. One payline, **six symbols on every drum and every one of them pays**,
  best single result pays. Everything a spin can win lives in the `SYMBOLS` table (`three` =
  triple pay, `two` = pair pay, `w` = base reel weight, `tier` = how luck scales that weight) and
  `evaluate(ids)` walks that table to find the highest-paying reading of the three landed symbols — so a
  triple always outranks a pair (🍒🍒🍒 pays 3×, not 1×) and one spin never collects two prizes. The
  ladder, in `PAYING`, is the drum itself: **3× 🍒 / 5× 🍋 / 10× 🔔 / 25× 💎 / 50× 7️⃣ / 200× 🃏** on
  three of a kind, and **1× / 2× / 3× / 4× / 10×** on the pairs (cherry, bell, diamond, seven, wild).
  There is no dead symbol on the drum: the machine used to carry a seventh, a drawn **blank window** that
  paid nothing and killed any line it landed on, and it is gone at the player's request — the next
  paragraph is what came off the ladder with it.

  **The dead stop came off the drum, and the ladder came down with it.** That blank window was
  **load-bearing, not decoration**: it carried **5 of the drum's 100 weight** — the same slot, the same
  weight and the same 14% of dead stops the old jackpot sign had — and that dead fifth was the only
  reason a ladder this rich could sit at 95.679%. A player reading the reels sees an empty plate, and
  reads it as debris (which, having replaced the sign in that very slot, it did rather resemble), so it
  was removed. The weight went back onto the paying symbols, whose shares of each reel then rise by
  exactly `100/95`, and **the same pays return 111.6%**: a machine that prints money. So the triples were
  re-priced down, from 4/7/14/34/60 to **3/5/10/25/50**, which lands the return back on 95.679% cold —
  with the *same* six symbols carrying the *same* shares of every reel, the pairs untouched at 1/2/3/4/10,
  and the wild still paying 200×/10×. Nothing else about the cabinet moved, so the marquee's **MAX 200×**
  is still the truth. (The dead fifth was worth about **3.2 points** of return, which is why the ladder
  had to give up roughly an eighth of each triple rather than a token point.) Its luck-proofing went with
  it: the stop was tier 0, so no Lucky Coin load could ever tip extra blanks onto the reels — and there
  are no blanks left to tip. That is the whole of this machine's pot story — the player asked for the
  3-reel cabinet to stay the plain one, so `JACKPOT_GAMES` in `src/state.js` names only the two 5-reel
  machines, `playRound` never feeds a bank for this one, a bank a save was still holding for it is **paid
  into the player's balance on load** (`hydrateState` + a `loadFlags.paidSlotsPot` toast in `main.js`),
  and the machine wears **no pit meter at all** (the player's call): with no pot to window and the stake
  already stated on the side panel and the marquee, there was nothing left for that glass to say.

  **The cherry pair is left-anchored.** `{ id: "cherry", three: 3, two: 1, leftPair: true }` — two
  cherries on the payline return your credit (1×, which `recordPlay` books as a *push*: payout ===
  stake is neither a win nor a loss) — but only when they sit on the **first two reels**. That is what
  `leftPair` means in `evaluate()`: skip the pair unless `ids[0]` and `ids[1]` are both cherries (or a
  wild standing in for one). The same pair on
  the last two reels pays nothing, and `play()` says so in the result line ("🍒🍒 only pays on the
  first two reels") rather than a bare "no match", because a right-hand cherry pair otherwise reads as
  a mis-scored win.
  `pairLabel()` is the single source for that chip's copy, used by both the cabinet
  paytable and the pay-table card ("1st two 1x").

  **The wild.** `{ id: "wild", sprite: "wild", glyph: "🃏", w: 1.0394, three: 200, two: 10, tier: 0 }` is
  the machine's top symbol and fills in for **any** paying symbol, the way both 5-reel wilds do:
  `evaluate()` counts the wilds and gives each symbol an *effective* run of `own + wilds`. It is read
  the way that **pays the player most** — 🃏77 pays as three sevens (50×) rather than a wild pair
  (10×), while 🃏🃏🍒 pays as a pair of wilds (10×) rather than three cherries (3×). A wild beside a
  cherry counts for the cherry pair's left-anchor rule like any cherry. Its `w` is the drum's **tuner**
  (see "The wild's weight" below), and its tier is
  0, so it is **luck-proof**
  exactly like the two 5-reel wilds: no Lucky Coin load tilts a wild onto a drum.

  **RTP.** With base weights (no Lucky Coin stacks) the paytable returns **95.679%** of the stake, and
  the left-anchored cherry pair is the single biggest reason the cheap symbols are not pure loss: on
  its own its 1× push is worth **6.902 points** of that total, and deleting the pair outright drops
  the machine to **88.776%**. Every figure here comes from the exhaustive **6³** weighted table —
  replicate `SYMBOLS` + `evaluate()` in a script and sum `p · pay` over all 216 outcomes. Note how
  much the anchoring matters: the cherry pair fires on **6.902%** of spins, where an unanchored cherry
  pair would fire on roughly three times as many and push the machine past 100%. The **pairs are where
  the return lives** on this cabinet — bell 18.680 + diamond 16.445 + seven 11.887 + cherry 6.902 +
  wild 0.204 = **54.1 points of the 95.7**, with only **41.6** coming from the six triples — which is
  exactly why a wild that can complete a pair is priced as steeply as "The wild's weight" describes.
  Lucky Coin perks
  shift the weights toward the premium tiers (`tier 1` gets `1 + luck·0.2`, `tier 2` `1 + luck·0.4`)
  and are the only thing that moves the return at runtime — the paytable itself never changes and every
  symbol's tier is fixed — and even at the luck cap the machine returns **96.687%**.
  **There is no rake term any more**: with no pot to fund, the ladder's return *is* the machine's return,
  so what it advertises (and what the nav edge prints) is **95.68% cold / 96.69% at the cap** — the same
  figure the old "95.68% own model" line carried, now with nothing withheld from it. P(win) = **0.3125**,
  P(lose) = **0.6875** cold / 0.6864 at the cap, and the push — the cherry pair — is **6.902%** of
  cold spins. (Taking the dead stop off the drum is most of that win rate: a seventh of the old drum's
  stops were blanks that had already lost the spin before a symbol was read.)

### The wild's weight

`WILD.w` is **1.0394** of the drum — a number that looks like a typo until you price the wild.
Because this is the one machine where a **pair pays wherever it sits**, a wild completes pairs as
readily as triples, so a wild on the premium symbols is worth an extraordinary amount of return per
unit of weight: the wild is worth **10.955 points** of the machine's 95.679 — an eighth of the whole
ladder — and it earns them from about 1% of every drum stop. The decomposition, all from the enumerator:

| configuration | cold return | note |
| --- | --- | --- |
| shipped (wild 1.0394, tier 0) | **95.679%** | only **0.133** of it is the wild's *own* 200×/10×; the other ~10.8 is its filling in |
| wild deleted, its 1.0394 handed to the lemon | 84.724% | the wild is worth **10.955 points** here |
| wild deleted outright | 85.780% | — |
| wild's pays zeroed (it still fills in, weight kept) | 95.545% | its own three/pair are worth only 0.133 |
| wild at **2** (lemon 22.87) | **106.694%** | the machine **prints money** |

That last row is why `WILD.w` is a tuned value rather than a round one. The wild **is** an eighth of
this ladder, and taking it off a drum that keeps dropping the same symbols leaves the rest of them more
room, so the weight cannot be deleted — hand it to the lemon and the machine prints money at 106.7%.
Sweep it instead and the return moves at roughly **10.5 points per unit of weight**, which is what makes
1.0394 enough to pin the ladder: the wild is worth about ten times its own share of the drum.

**How the drum got here.** The sign's old pays were worth **9.625 points** on the old drum (10× pairs on
0.7125% of spins = 7.125, 200× triples on 0.0125% = 2.500). Handing them to a new `wild` carrying 1.17
of the drum put the machine at **95.690% cold / 96.808% at the cap** with the `star` off the paytable and
a dead stop in the slot it left — that pair of figures is what this file carried for years, and the
enumerator reproduces it exactly. The 0.011-point cold drift from the `star` era is the wild swap: the
wild and the dead stop were both tier 0 and luck-proof where the `star` was tier 2, so a Lucky Coin load
no longer buys any part of the top of the ladder.

**And then the dead stop came off.** The blank window held that drum's dead fifth until the player had it
removed (see "Lucky Sevens" above). Its five units of weight are simply gone, which is why the drum now
sums to **94.869** rather than 100 — nothing reads the total (`weightedPickIndex` normalizes these into
proportions), and every symbol's share of a reel is exactly what it was while the blank was on the drum.
What the removal *did* change is who carries the dead fifth's job: with the dead weight gone, the same
pays returned **111.6%**, so the ladder came down (4/7/14/34/60 → 3/5/10/25/50) and the wild's weight was
re-swept to **1.0394**. The cold return is unchanged to a thousandth (**95.679%**); the cap figure moves a
hair (**96.685% → 96.687%**) because there is no dead stop left to dilute the premium tiers when luck
loads them.

**What sits in that slot now: nothing.** The jackpot sign kept its `w: 5` through two changes and then
came off the drum altogether when the player had this machine's pot removed; the dead stop that replaced
it (the drawn blank window, which paid nothing, carried no pot and was not in `PAYING`) has now come off
too, at the player's request. So the machine's whole edge is its paytable, there is no symbol on this
drum the player cannot be paid for, and nothing on the cabinet is drawn rather than fetched: every face
on it is a sprite from `sprites/`.

- **Neon Recall** (`games/memory.js`) has no dice in it: the only randomness is which colours the
  pattern uses, so **the difficulty curve is the flash timing** — how long each colour stays lit and
  how long the gap between them is. Everything tunable lives in main.pjs (`mem*` → `CONFIG`).

  **The ladder is `memLevels` (19) LEVELS, one colour each** — a difficulty ladder, not a length-ceiling
  race. It opens at `memStartLen` (3 colours) and tops out at 3 + 18 = **21**. There is a single mode
  now: the pattern keeps its order and appends one colour a pass, so nothing is ever re-rolled and
  there is nothing to choose before a run starts. (There used to be a second, harder RANDOM mode that
  re-rolled the whole pattern at the new length every pass, opened at 5 colours and ran to 23 for a
  ×10.88 summit; it was removed at the player's request — one ladder, one opening length, one summit,
  no toggle and no `setMode()`.) One module-level `startLen`/`maxLen` pair replaces the old
  `startFor(mode)`/`maxLenFor(mode)` accessors, the pip track is built once instead of rebuilt per mode
  change, and the info card's ladder is keyed by **colour count** with a single ×column (it used to
  print a dash for lengths a mode could not reach). The ladder's bar is **square-root** scaled, because
  the bank only spans ×1.00 to ×3.03 and a linear bar squashed every rung under the summit into an
  invisible stub.

  **The ladder is FITTED, not compounded** — this is the balance-critical part. A rung does not pay
  "the previous rung plus a bit"; it pays `memLadderRtp` **divided by the chance the reference player
  has of reaching that rung**. The reference curve is: perfect to `memSkillKnee` colours, then
  `memSkillDecay` per extra colour. Two consequences fall straight out of the formula:

  - **The low rungs pay exactly ×1.00.** Everything up to the knee is a fair bet for a player who never
    misses, so the first `memSkillKnee` rungs pay `memLadderRtp / 1` — and ×1.00 is a bank, not a win:
    no free money, and no XP either, because XP is charged on profit, so a ×1.00 cash-out cannot be
    churned.
  - **The reference player's return is flat at 95% at every rung**, so pushing on is neither free money
    nor a trap. `multAt(p)` computes the whole ladder from those knobs; there is no `stepOf`/`stepAt`
    and no step table to keep in sync. Shipped ladder, 3–21 colours, with the shipped `memSkillKnee`
    **5** and `memSkillDecay` **0.93**: `1.00` at 3/4/5, then `1.02 1.10 1.18 1.27 1.37 1.47 1.58 1.70
    1.83 1.96 2.11 2.27 2.44 2.62 2.82 3.03`, summit **×3.03** at 21 colours. Both knobs move every
    rung: the knee sets where the ladder starts to pay, and the decay sets how steeply it climbs after
    that — and because the ladder is the *ratio* of the reference odds, the decay enters as a **power**.
    Taking `memSkillDecay` from 0.88 to 0.93 flattened the shipped summit from **×7.35 to ×3.03** with no
    other change: 0.88 says a player remembers 88% of the tail, 0.93 says 93%, and the top rung is the
    reciprocal of that compounded over sixteen extra colours. The player asked for the first paid rung
    to sit at **6 colours**, so the knee came down from 8 to 5; with the shipped decay that lifts the
    summit from ×2.44 to ×3.03. The old pre-fitting ladder compounded a ×1.26 first step and paid
    ×294.81 at the top — a fortune in a handful of rounds for anyone who could read — which is why this
    is fitted now.
  - `memLadderCap` (8) is an **inert guard** sitting above the shipped summit (3.03): it exists
    so a future retune of the decay cannot silently blow past the machine's table maximum. It is not
    the ceiling — the table limit is (see the balance book).

  **Faster as it grows, up to a point.** `flashFor(n)`/`gapFor(n)` = base × decay^(n − `memStartLen`),
  floored at `memMinFlashMs`/`memMinGapMs`, and the ramp is **frozen at `memMaxLen` (20) colours**.
  That 20 is purely a *speed* cap: both floors (110 ms flash / 55 ms gap) are already reached around
  17 colours, so nothing flashes faster past 20 — the pattern just keeps getting longer. Shipped: flash
  330 ms × `memFlashDecay` 0.92 per colour, gap 130 ms × `memGapDecay` 0.94. Measured live by timing
  the pads: pass 1 (3 colours) cycles every 485 ms, pass 2 (4) 439 ms. Raising the decay toward 1 is
  what makes long patterns unlearnable rather than merely hard, so retune the floors before the decay.

  **Degenerate-RNG guard in `randomSeq()`.** The machine refuses to emit the same pad three times
  running, which it enforces by re-rolling; a stub `Math.random` that never varies (e.g. `() => 0` in a
  test) used to spin that loop forever and freeze the whole preview. It now gives up after 64 refusals
  and accepts the repeat, so a pathological `Math.random` costs a few ms instead of hanging the page.

  **The pads are bound to the compass, not the number row.** Each pad carries two
  codes (see `PADS` in `games/memory.js`): `W`/`↑` for green, `D`/`→` for red, `S`/`↓` for gold and
  `A`/`←` for blue. `midAngle` lays the four pads out green-top, red-right, gold-bottom, blue-left, so
  an arrow points at the pad the player is already looking at — which is the thing the old `1..4` row
  could not do, since it named the pads in reading order and said nothing about where they are. The
  player asked for the swap. `e.key` is lower-cased whole before the lookup, because the arrows arrive
  as `"ArrowUp"` & co. and a shifted `W` arrives as `"W"`. The arrows are `preventDefault`ed for as
  long as this cabinet is mounted (a flashing pattern must not be scrolled out from under the player),
  but a pad only *plays* during the input phase; the number row is deliberately dead, and `c` still
  cashes out. The info card's legend and each pad's tooltip print the new labels.

  **Verifying it without ears or eyes.** A `MutationObserver` on `.mem-pad` class changes gives the
  exact lit order *and* the dwell times; replay that order with `KeyboardEvent("keydown", {key:"w" |
  "d" | "s" | "a"})` (or the arrow names) on `window` to walk pass after pass, and the "WATCH — n
  colours · Xms each" line prints the
  flash time the machine just used. `document.hidden` is true in the editor preview, but the memory
  machine's timings measure true anyway (measured 483 ms for a 460 ms cycle), so the pass walk above
  is a real timing check, not a guess. The same walk is how the payout rungs get checked end to end:
  clear four passes and cash out on the 6-colour rung with `state.bet` at 25 and the money moves by
  exactly `round(25 × 1.02) − 25 = $1` (verified live, along with the pip titles — pass 19 reads
  "Pass 19 · 21 colours · ×3.03").

## Treasure Chests: why the board is nine

`games/chest.js` pays the four prizes `chestHigh` 4 / `chestGem` 2 / `chestMid` 1 / `chestLow` 0.5, **one
chest each**, out of **nine** chests; one of the nine is a "Lucky Star" that pays nothing and hands you a
free second pick, and the other four are traps.

The star's re-pick is worth exactly the average non-star chest, so a round returns the sum of the four
prizes over the **eight** non-star chests — `7.5 / 8 = **93.75%**`, the row in the returns table above —
and `maxWinMult` is `chestHigh` ×4 (the bet panel prints ×4 × stake). The two numbers that must hold:
**the four prizes always sum to under eight**, and the board is nine cells, so the hit rate is four in
nine (44%) plus the star's second chance, exactly **50%**.

It was briefly grown to twenty chests with round-number prizes (×10/×5/×2/×1, 18/20 = 90%): same edge,
but four paying chests out of twenty is a **20%** win rate, which reads as a stingy machine, so the board
came back to nine with the old paytable and the star. `COUNT` in the module, the `repeat(3, …)` columns
in `styles.css` and the info card's `gridMap(3, 3, …)` are the layout side of that number — three by
three — so changing `COUNT` without changing those three leaves the board ragged (or the map the wrong
size). The star's CSS is `.chest.star` (gold, "PICK AGAIN") and `.chest.star-spent` (grey, "used"), with
`.chest-msg.star` for the re-pick prompt; `TIER_SPRITE` labels the four paying chests trophy ×4 /
diamond ×2 / mystery ×1 / coin ×0.5, one chest each, and the other four read "trap" (💀).

## Frogger balance & the god harness

`games/frogger-math.js` is the entire road and it has no DOM; `games/frogger.js` is the playable game
on top of it. **This machine's paytable was designed as a *proof* rather than a closed form**, because
the road is deterministic and fully on screen: a script can read every lane's convoy, so "the player"
has to be modelled as an optimal planner. That proof is now **retired** — read the first bullet before
believing any ceiling number in here. Touch `TIERS`, the pocket constants or `ladderRungs` only with the
god table below in front of you.

**The rules that carry the balance.**

- **Cars are the only thing that can kill you.** The verge and every grass median are safe ground: no
  traffic and no collision. They used to be swept away after `restSec` (3.0s), and that sweep clock was
  the single biggest difficulty dial in the machine — remove it and a patient player just waits for the
  road to line up. It was removed at the player's request (dying to a timer on a piece of grass does not
  read as a road), and the honest consequence is recorded below: **the ladder's old no-win ceiling died
  with it.**
- **Grass is safe, but it is not free (the hurry-up).** The clock that replaced it is
  `froggerPatienceSec` 1.0 / `froggerPatienceDecay` 0.95 in `main.pjs`: the first `1.0s` of any stand on
  grass is on the house, and every second after that multiplies the multiplier the frog is holding by
  `0.95`, **cumulatively for the run**. Nothing about this can kill the run (it only ever costs money),
  which is what makes it a hurry-up rather than a return of the death clock; `currentMult()` in
  `games/frogger.js` is `multFor(depth) x patienceFactor()`, the HUD prints **HURRY** while it is biting,
  and the info card documents it. Its whole job is to make patience *stop paying*: see the table below,
  where a 1.5s-patience planner and a 90s-patience planner return the same ×1.11–1.17.
- **Bank on grass only.** The verge and the ten medians, nowhere else. Paying per lane is a printer (the
  god's per-lane reach stays high forever), and "bank anywhere" is worse: the landing spot is a free
  choice, so "hop one lane, bank ×1.00" is a guaranteed even-money exit and "bank the deepest lane I can
  legally reach" cashes every intermediate rung. Ten bankable places turn each island into a real
  push-or-bank decision.

**The old doctrine — history, kept for the reasoning, not as a live bound.** A strategy is a rule that
decides, at each bankable island, whether to bank or push on, so the best any strategy can do is the
best *banking schedule*, and a schedule partitions the outcomes by the deepest island reached. With
`P_j` = the chance a perfect player reaches island j (and `P_11 = 0`):

```
EV(best strategy) = SUM_j (P_j - P_j+1) x rung_j   <=   rtp (0.90)
```

Rung 1 sat near `rtp / P_1` and every deeper rung was paid out of the thin tail of mass that dies before
it. That SUM bound held **only because `restSec` bounded the god's patience, which bounded the reach
curve, which bounded the sum**. With the clock gone the god can stand on the verge until the road opens
and `P_j` goes to ~1, so the SUM no longer bounds anything: the ladder is now a *description of what the
road pays*, not a proof that the house wins. The `rtp: 0.90` constant survives as documentation of what
the ladder was tuned against (and the earlier note's 0.86/0.878 figures do not reproduce from this
harness — treat them as superseded, not as a baseline). If you ever re-add a clock, check the ladder
against the SUM form again, not per-rung.

**The measurement (new model, no clock; the baseline the ladder is now judged against).** `godCurve`
runs an exact forward DP over lane × landing-time and reports the cumulative reach at each island plus
the EV of banking at the deepest island the planner can legally reach (`sumMult/runs` over
`multFor(depth)`). Settings: `dt 1/100`, `slop 0`, `sourceKill`, `horizon = patience + 30`, 800 seeds
from `777 + i*7919`, `maxDepth 100`. Reach is `P(depth >= island)`:

| grass patience | island 10 | island 20 | island 30 | island 40 | island 50 | island 60 | god EV | maxSeen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3s | 66.9% | 16.9% | 2.9% | 0.6% | 0 | 0 | **1.19** | 46 |
| 6s | 86.0% | 37.2% | 11.9% | 2.6% | 0.1% | 0 | 1.28 | 53 |
| 10s | 94.1% | 61.4% | 27.5% | 5.5% | 0.5% | 0 | 1.35 | 54 |
| 20s | 99.8% | 88.0% | 50.7% | 15.0% | 1.6% | 0.1% | 1.46 | 63 |
| 40s | 100% | 97.1% | 74.3% | 36.7% | 10.0% | 0.9% | 1.61 | 66 |
| 90s | 100% | 99.9% | 94.9% | 78.1% | 41.2% | 12.1% | 2.10 | 83 |
| unlimited | 100% | 100% | 100% | 98.8% | 93.4% | 73.0% | **4.72** | 97 |

The unlimited row is `wait 1e6`, `dt 1/50`, `horizon 300`, 500 seeds through the same DP (island 70
34.0%, island 80 10.6%, island 90 0.8%). The table is `dt`-stable: re-running the 3s and 20s rows at
`dt 1/200` gives 68.0/18.2/3.5 (EV 1.20) and 99.8/89.5/53.1 (EV 1.47) with the *same* `maxSeen` (46,
63), and every witness schedule replays clean through the shipped model — **0 mismatches** in every row
— so these are real crossings, not DP artefacts.

Read the table as the size of the hole the clock was plugging: with only 3s of grass patience the god's
EV is already **1.19** — above the 0.90 the ladder was historically fitted to — and patience takes it to
**4.72**. The ladder is deliberately unchanged (`[1.25, 1.35, 1.50, 1.75, 2.25, 3.50, 6.00, 12.00,
25.00, 50.00]`; `ladderCap` 1000 must stay == `maxWinMult` in `main.pjs`): the road rewards patience, and
that was the trade the player asked for. **This table is the no-decay baseline** — it is what the road
pays when grass is free — and it is what the hurry-up is measured against.

**The hurry-up (shipped), and how it was measured.** `frog-par.js`/`frog-sweep.js` predate the hurry-up,
so a second planner was written for it: the same forward DP over (depth, landing time), plus a third
state variable — **loiter**, the seconds spent resting on grass past `froggerPatienceSec` — with the
objective changed from "reach the deepest lane" to **maximise `multFor(depth) x decay^loiter`** (the
banked value the player actually gets). It reproduces the documented no-decay column to within 2% (3s of
patience: ×1.17 against the table's ×1.19), which is what licenses the comparison. Frontier thinning
keeps the lowest-loiter state per landing-time bucket and then an even spread of buckets, exactly like
the old planner; `decay 1` reduces it to the old objective.

| patience budget per stand | god EV, decay off | god EV, hurry-up (grace 1.0s, decay 0.95/s) |
| --- | --- | --- |
| 1.5s | — | **1.11** |
| 3s | 1.17 | **1.15** |
| 6s | — | 1.17 |
| 10s | — | 1.17 |
| 20s | — | 1.16 |
| 40s | 1.99 | **1.15** |
| 90s | 2.28 | **1.11** |
| unlimited (the table above) | **4.72** | — |

The number that matters is the *shape*, not the decimal: with the decay off, patience is money — the
god's return climbs with every extra second of it. With the hurry-up in force, patience is **worth
nothing**: 1.5s and 90s of it both land at ×1.11–1.17, and pushing patience higher actually *lowers*
the figure, because the god increasingly pays for the alignment it buys. The residual ~+15% is not a
patience exploit at all; it is the ladder's first rung. Island 10 pays **×1.25** and a fast crossing of
the first block is nearly always available to a planner (the documented 3s reach is 66.9%, and with a
free second of verge time and free rests on live lanes it is higher), so a script's floor is roughly
`1.25 x P(reach island 10 with no loiter)` plus the deeper tails. Two consequences to record honestly:
(1) **the god's EV can never fall below ×1.00**, because banking on the verge is a free push — so
"slightly over 100% for a perfect planner" is a property of this machine's shape, and a patience knob
cannot fix it; (2) closing the last ~15% means touching **`ladderRungs`** — lowering ×1.25 (and
probably ×1.35) at the cost of every real player's first-island payout. That is a deliberate re-fit, and
it has not been made.

**How much a real player gets.** The myopic bot (the harness's `simRun`: fixed margin, no look-ahead,
hops when the next lane looks safe, banks at the first legal island — `dt 1/180`, `margin .06`,
`postMargin .06`, `panicK .35`, `sourceKill`, 12000 runs) reaches island 10 **19.4%**, island 20 0.7%,
island 30 never, and returns **0.243** of stake banking at island 10 (0.009 banking at 20). **Removing
the clock did not move the bot at all** — measured identical reach and payout with `restSec: 3` and
`restSec: Infinity`, because a reacting player never stands still long enough for the clock to matter.
**Nor does the hurry-up move it**, for the same reason: the bot never lingers past the one-second grace
(it hops as soon as a gap appears), so its 0.243 is untouched. That is the design target of the decay —
it taxes *thinking*, and a player who is reading the road rather than hoarding it pays only the seconds
they actually hesitate. So the realistic return is unchanged by either change: a floor around 0.24, with
a human who reads the road better sitting between the bot and the god. (The old "0.86 fit" was the SUM
*margin* — `rung × reach` — not the god's EV; do not quote it as a return.)

**The "more random" pass (variant R2, shipped).** The player also asked for less predictable traffic, so
`TIERS` was widened: `speedJ` ×1.3, `gapVar` ×1.25, `cars` widened by ±2 (2-11 vehicles deep in the
ladder), `cw` ×0.93 compensated by `carW` so the base car length is untouched — and in `makeLane` each
vehicle's drawn width became multiplicative, `carW * (0.62 + r()*0.76)` (mean `carW`, so the guaranteed
window is still set by `minGap` alone), from which five body kinds fall out: **bike** (<0.95), **car**,
**wagon** (<1.60), **truck** (<2.00), **bus** (>=2.00, up to ~2.9 car-lengths). Every block now mixes
three or four kinds, where before each tier drew one kind. The cost is a touch of real difficulty: the
bot went 20.3-20.4% (shipped pre-R2, same 12k-seed setup) → **19.4%** reach at island 10 and 0.255 →
**0.243** of stake at the first island — wider vehicles occasionally close a gap the old uniform width
did not. The god table above is the post-R2 baseline. `minGap` and `blockSecFor` are untouched, so the
timing puzzle itself is unchanged, which is why the shift is ~1 point and not more.

**What invalidates the numbers.** Any change to `TIERS` (speeds, `cw`, convoy sizes, `carW`, gaps),
`blockHi`/`blockDecay`/`blockTierStep`/`blockMin`, the collision box, **or
`froggerPatienceSec`/`froggerPatienceDecay`** moves the reach curve and voids the tables. The root knobs
are `main.pjs`'s `froggerBlockSec` (0.34) and the patience pair (1.0 / 0.95), which `create()` copies
into `FROG_CONST` / reads from `CONFIG`. `froggerRestSec` is **gone** (see the NOTE in `main.pjs`);
nothing should add a *fatal* clock back, and a patience knob can only be loosened with the hurry-up
table re-run. Note what the hurry-up does and does not change: it moves the god's EV, and it moves
nothing else — the bot, the reach curve and every rung of the ladder are exactly as measured above,
because none of them waits long enough to be taxed. After any change to the road or the patience knobs:
re-run the god table (both columns), the hurry-up table and the bot floor. The soft ceiling the machine
now has is ~×1.15, and it comes from the ladder's first rung rather than from the patience rule.

**The harness (it does not ship — it lives in `scratch/`, which dies with the session).** Two files are
uploaded so a future session can pull them back:

- `https://user.uploads.dev/file/3f390f78e4c69016d22b6346d3862832.js` — `frog-par.js`, the parallel
  survey: `parSurvey({mode:"god"|"bot", runs, workers, dt, seedBase, stride, waitVerge, waitMedian, opts,
  tiers, block})`, plus `islandTable(res, z)` (rows `{island, hits, p, up, g}`; use the cumulative
  `p`/`up`), `wilsonUpper`, `godEV`, `godEVUpper`, `ISLANDS`. It spawns workers that `import` a data-URL
  copy of `frog-sweep.js` and read the *current* `src/games/frogger-math.js` text, so it always measures
  the shipped file.
- `https://user.uploads.dev/file/f66917b6429157191ec3cdf34bcde9d0.js` — `frog-sweep.js`, the serial model
  harness: `applyCfg({tiers, block, dt})`, `simRun` (the myopic bot), `godReach(seed, opts)` (the god
  planner, exact forward DP), `replay(seed, path, ...)` (replays a witness schedule through the shipped
  model), `godCurve` (the reach table + bank-at-deepest EV used above), `godLadderEV`, `ladderEV`,
  `rungMargins`, `clone`.
- `https://user.uploads.dev/file/f0efff0dced68498d4584dd844f03af0.js` — `frog-hurry.js`, the planner
  that measures the **hurry-up** (written after the two above, which do not know about the decay). It
  loads `src/games/frogger-math.js` the same way, then runs `plan(seed, opts)` / `batch(n, seedBase,
  opts)` / `run(opts)` with `opts = { maxDepth, waitCap, grace, decay, samples, cap, taxAll }`, where
  `grace` = `froggerPatienceSec`, `decay` = `froggerPatienceDecay`, `waitCap` is the patience budget per
  stand, and `taxAll` switches the loiter tax from grass-only (shipped) to every rest. The state is
  (depth, landing time, **loiter**); the objective is `multFor(depth) * decay^loiter`; `decay: 1`
  reduces it to the old deepest-reach objective, and it reproduces the documented 3s row (×1.17 vs
  ×1.19) as its calibration.

```js
const hurSrc = await fs.readTextFile("scratch/frog-hurry.js");
const H = await (new Function("fs","tools","return (async()=>{"+hurSrc+"})()"))(fs, tools);
// shipped hurry-up: grace 1.0s, decay 0.95/s; sweep the patience budget
for (const w of [1.5, 3, 10, 40, 90])
  console.log(w, H.run({ n: 80, maxDepth: 60, waitCap: w, grace: 1.0, decay: 0.95, samples: 400, cap: 200 }));
// the no-decay contrast (decay 1) is the same call with `decay: 1`
```

```js
const parSrc = await fs.readTextFile("scratch/frog-par.js");
const P = await (new Function("fs","tools","return (async()=>{"+parSrc+"})()"))(fs, tools);
const RUNGS = [1.25, 1.35, 1.50, 1.75, 2.25, 3.50, 6.00, 12.00, 25.00, 50.00];
const r = await P.parSurvey({ mode:"god", runs:8000, workers:8, dt:1/100,
  opts:{ maxDepth:100, horizon:33, sourceKill:true, slop:0 }, waitVerge:3, waitMedian:3 });
P.islandTable(r, 2.326);            // per-island point + 99% upper bounds
P.godEV(r, RUNGS);                  // exact EV of the ladder from the exit distribution
```

And the serial path used for the table above (it also gives the bank-at-deepest EV and the replay check):

```js
const src = await fs.readTextFile("scratch/frog-sweep.js");
const S = await (new Function("fs","tools","return (async()=>{"+src+"})()"))(fs, tools);
S.applyCfg({ dt: 1/100 });
S.godCurve(800, { maxDepth:100, horizon:33, wait:3, sourceKill:true, slop:0 }, 777,
           [10,20,30,40,50,60,70,80,90,100]);
```

Gotchas, all of them learned the hard way:

- **Reach must be read cumulatively.** The planner's depth histogram has literal **zero bins at the
  island lanes** (mass sits just past them), so a raw bin read always returns 0 and every ladder looks
  free. `islandTable` and `godCurve` accumulate; keep it that way.
- **`wait` is the planner's grass patience in seconds per safe lane** — it is no longer "the shipped
  clock". `parSurvey` defaults `waitMedian` to 6.5 (i.e. a road the player never had); always pass the
  patience you actually mean.
- The god planner costs roughly 0.1-0.35s per run at `dt 1/100-1/200`; the bot is ~1/1000 of that, so
  sweep the bot freely and reserve the DP for numbers you are going to write down.
- `dt` matters a little: `1/100` and `1/200` agree to ~1-2 points of reach and exactly on `maxSeen`, but
  don't mix `dt` inside one table.

**Driving the real game in the preview** (the only way to check the payout end-to-end; `opts.instant`
cannot: `frogger` refuses instant mode and returns `{multiplier: 1}`). The controls listen on
**`pointerdown`, not `click`** — `el.click()` does nothing to them, dispatch a
`PointerEvent("pointerdown", {bubbles:true})`. Select them as **`button.fbtn.cross` / `button.fbtn.bank`**:
a `/BANK/` text search finds the topbar's 💥 `BANKRUPT` first. And **the whole game freezes while any modal
is open** — `paused()` returns true when `#modalLayer` is visible, so a round can sit in "GET READY"
forever and the next `playRound` will silently no-op on the `playing` guard; hide the modal before you
drive. A clean live check: patch `TIERS` to one tiny car per lane with `cw = [500, 500]` (a sparse convoy
makes every column almost always clear), shorten `hopSec` to 0.05, set `frogHalfW = 0`, `mountGame("frogger")`,
stake $10, then `pointerdown` the cross button until the HUD reads `Lanes crossed 10`, bank, and check the
money: **it paid $13 on a $10 stake at ×1.25** ("BANKED ×1.25 — 10 lanes crossed"). With the clock gone the
other two things worth checking live are exactly the player's complaint: **stand on the verge and then on
island 10 for >10s and confirm nothing kills the frog**, then step into a live lane and confirm the SPLAT.
---

## Texas Hold'em: a fitted table, not a fixed one

`games/holdem-math.js` is the whole game and it has no DOM — deck and shuffle, the eight hand
categories and `evalScore`, the Monte-Carlo `equity()` (with a precomputed preflop table), betting
rounds and legality, side pots, showdown and the bot policy. `games/holdem.js` is the felt on top of
it: plates, the action bar, the bet slider and the header's seat-charge line. **2 to 4 seats**: one
human plus **1-3 bots**, chosen with the machine's own 1/2/3 picker (`holdemBots` is only the default
it opens with; `main.pjs`'s comment says "engine takes 2 to 4 seats").

**The stake is the buy-in, and the seat charge is the edge.** `main.js` charges the stake up front as
usual; the machine then hands every seat a stack of `stake × (1 − holdemFee)` to play the hand with,
i.e. every seat pays the House a flat **3% of its own buy-in**. There is **no rake on the pots**, and
that is the whole design rather than an oversight: at this depth a rake is a hopeless house edge,
because the player takes on the order of a third of the pots and an average pot is on the order of a
quarter of a buy-in, so even a **10% rake would cost under 1% of the stake** — while a 10% *seat
charge* costs exactly 10%. Two consequences make the flat charge the right lever:

- **It is exactly symmetric.** Equal seats that pay the same charge are an even game between
  themselves; the fee is the only asymmetry between the House and you. So the reference player —
  the one who plays exactly like the bots do — has an expected final stack equal to their post-fee
  stack, i.e. a return of `1 − holdemFee` = **97%**, at any stake, any depth and any number of bots.
- **It is beatable on purpose.** Out-play the table and you keep every chip on it, so this is
  genuinely a poker table, not a slot machine with cards: **a good player can beat this game**, and
  that is the intended, documented intent of the machine. It is also why the machine is a *fitted*
  design like Neon Recall rather than a fixed-odds one — but unlike Neon Recall there is no ladder
  constant that can be fitted, because the edge is not produced by a paytable at all. If the house
  must be unbeatable, the lever is `holdemFee` (or a real rake), never the bots.

**Depth.** `holdemDepth` = **25 big blinds** per starting stack, and the bet unit is drawn from the
*post-fee* stack (`holdem.js` line ~290), so the game is the same shape at every table limit and the
stake only scales it. 25 is deliberately short and action-heavy — roughly double the pot-win rate of
a 50-deep game — and the reference return is 97% at either depth.

**Luck is a discount on your own seat charge.** Every other machine's luck nudges its own odds; a
poker table must not, because a rigged deal is the one thing that would poison the game. So
`holdemLuckFee` (0.5) buys the player up to **half off their own seat charge**, nothing else: at the
luck cap the return is `1 − holdemFee × (1 − 0.5)` = **98.5%**. Zero-sum and provable, since the
discount is a plain transfer that cannot change the relative strengths of the hands.

**The whole-dollar cage and the $50 minimum.** The felt runs on cents (blinds, side pots, split pots)
and the machine reports the **exact stack ratio**, not a cent-rounded one — rounding the ratio first
added a second, larger error term. The cage then pays `round(final stack)`, and *that* rounding is a
real bias rather than noise: a hand that ends in a fold lands on the same cent values nearly every
time, so it rounds the same way nearly every time. Measured, it is worth up to **+0.94% of the stake
at a $25 buy-in**, and only ±0.21% from ~$50 up. That is why the table opens at `holdemMinBet` **$50**:
below it the rounding could out-earn the 3% seat charge. The table limit caps the top end, so early
on this is a $50-$400 table.

**Chip conservation, and the odd chip.** `settle()` builds the pots level by level (unmatched chips
come back to their owner uncalled) and, for a split pot, floors each share to the cent and hands the
leftover cents out one at a time — the dealer's odd-chip rule — instead of rounding each share
independently, which would mint or burn a cent on every split and quietly bias the table. Total chips
in the hand are invariant: the only leak in the whole machine is the seat charge.

**How it was measured, and what the number is.** The return is a *proof*, not a sample: any seat
drawing from the `HOUSE` style distribution (`tightness` 0.42 / `aggression` 0.62 / `bluff` 0.07,
jittered per seat by `makeStyle`) is an even game, so 97% is exact for the reference player and the
simulation's job is only to catch a broken formula. Poker hands have enormous variance, so the Monte
Carlo is noisy: the measured reference return landed in **0.967-0.974** across stakes (the spread is
the cage rounding, not the poker), the luck-capped effective return measured **0.982-0.987**, and the
worst single figure ever observed was **0.9911** — a $200 buy-in at the luck cap, still under 100%.
`opts.instant` measures it fine (unlike frogger/revolver): `state.infMoney = true`, a fixed stake, and
a few thousand rounds of `casino.playRound(true, {idle:true})` reads `state.stats.byGame.holdem`.

**Driving it live.** `.machine-btn[data-id="holdem"]` mounts it, `.playbtn` is DEAL, `.ht-segbtn` is
the 1/2/3 bot picker (disabled while the hand is `busy`), `.ht-helpbtn` is the HELP switch (OFF by
default — click it before testing anything about the chip), `.ht-actions .btn.red/.green/.gold` are
FOLD / CHECK-CALL / RAISE, `.ht-raisrow.off` means it is not your turn, and `/returned ×/` in
`.ht-msg` marks the end of a hand. The whole table freezes on modals like every machine.

**The hand helper ("what do I actually have?").** It ships **off** — a coaching aid is not part of the
game, and the player asked for it that way: the head carries a `HELP` switch (`ON`/`OFF`, gold when on,
never disabled while the table is busy, since switching it mid-hand is the point) whose state lives in
`state.holdem.helper` and is saved, so it stays where it was left. Off hides the chip *and* the cyan
rings — there is no half-on state where the rings alone give the hand away. Under your cards, when it is
on, is a chip (`.ht-helper`, painted by `paintHelper()` in `holdem.js`) that reads the hand back in
English. It exists in its present form
because of a player complaint about the first version: that one named the best five ("PAIR OF SIXES")
and said whether both, one or neither of the hero's cards were **in** it, which on a 6-6-Q-3-2 board
produced *"BOTH CARDS PLAY — PAIR OF SIXES"* — true (the king and seven were kickers in the five) but
read as "you have a pair of sixes", when the sixes were the table's and the player's cards had done
nothing. So the chip now attributes the hand instead of counting membership. `M.readout(hole, board,
folded)` returns one sentence naming the hand and then whose it is, in five colours:

- **yours** — your cards make it: `PAIR OF SIXES — YOUR 6♥ 6♦ MAKE IT.`, `YOU START WITH A PAIR OF
  ACES.`
- **part** — you share it with the board (`PAIR OF KINGS — YOUR K♥ MAKES IT WITH THE BOARD.`, `ACE-HIGH
  FLUSH — YOUR A♥ 9♥ ARE IN IT.`) or you are live drawing to it.
- **board** — it is the table's: `THE BOARD'S PAIR OF SIXES — YOUR CARDS ARE ONLY KICKERS.`, and when
  the five on the table are literally the whole hand, `THE BOARD PLAYS ITSELF — NEITHER OF YOUR CARDS
  IS IN THE FIVE.`
- **wait** — no verdict to give: preflop (`JACK-HIGH — NO PAIR YET.`, plus `, BOTH HEARTS` when suited)
  or nothing made (`NO PAIR YET — YOUR J♠ IS THE HIGH CARD.` / `— THE BOARD'S ACE IS HIGH.`, the "yet"
  dropped on the river).
- **fold** — your cards are out of it.

Alongside the sentence the two hole cards are echoed as glyphs (red suits stay red, cyan when they are
what makes the hand), and on the flop and turn a second, quieter line names the draw: `FOUR HEARTS —
ONE MORE MAKES A FLUSH.`, `FOUR TO A STRAIGHT — A FOUR OR A NINE MAKES IT.` Naming the completing
ranks is what makes an open-ender and a gutshot read differently. A live draw off a hand that is
otherwise the board's lifts the chip from red to amber, because it is something of yours after all.

The classification is `M.readHole`, which counts what **defines** the hand separately from what merely
**sits in** the five: `works` = hole cards in the best five (kickers included), `key` = hole cards
supplying the defining rank(s) or suit, `boardKey` = board cards doing the same. So key 2/1/0 reads
"mine / shared / the table's", and it stays honest exactly where membership did not: a king kickering
behind the board's pair of sixes is in the five, contributes nothing, and is neither ringed nor
credited with the pair. The cyan ring (`.card.works`) therefore marks the cards that **make** the
hand, not every card in the five — the old ring-the-members rule was the same lie in another medium.
Draws come from `M.draws`: four of a suit (kept only when at least one of them is the hero's, since a
four-flush the board dealt itself is not something you did) and the five-rank windows that are one
distinct rank short, the wheel included. `readHole`, `draws` and `readout` are pure and were exercised
card by card through the module — the screenshot's own hand reads `PAIR OF SIXES` / works [0,1] / key
[] / boardKey 2, i.e. the board's pair with two kickers — before any of it touched the table. The
engine agreement is unchanged underneath: `M.evaluate(hole.concat(board)).best` hands back the very
card objects that went in, so the reference tests against them cannot drift from the code that pays
the pot. At the showdown the rings clear and the gold crowns take over, marking the five that actually
won the pot.

**Layout invariant (learned the hard way).** The felt is a CSS grid whose **three rows must all be
`auto`**. A `minmax(0, 1fr)` middle row collapses to zero in an auto-height grid, and the centre
(street label, board, pot) then overflows its cell and paints **over** the top seat's plate and the
hero's plate — which reads as "PREFLOP · 4 SEATS printed across the opponent's name". Keep it `auto`
and keep the felt's content budget in mind: the machine panel gives the felt about **546px** at a
900px viewport, so the seats, board, hero plate, message and action bar have to fit in that. Also
note the shared effects layer (`bj-flash` / `bj-burst` / `bj-tag`) lives *inside* `.ht-table` as
absolutely-positioned invisible nodes — they are expected, not a leak.

---

## Cloud saves (optional Google sign-in)

`src/cloudsave.js` is self-contained: it owns the button (`#cloudBtn`, hidden unless the feature is
on), the panel, and every network call. `src/main.js` only wires it up with three things
(`initCloud({enabled, onApplied, canApply})`) and re-exports it as `window.casino.cloud`. It is
feature-detected off in `main.pjs` (`cloudSaves = 0`) and on in the GitHub build (no `main.pjs`,
so `state.js`'s `cfg("cloudSaves", 1)` fallback wins).

**The contract with the rest of the game:** the local save is the truth. The cloud copy is a mirror
of `saveSnapshot()`; nothing else in the game ever reads or writes Drive, and losing the cloud copy
costs the player nothing. Three rules keep that true:

- **The client ID is baked in** (`CLIENT_ID` at the top of `cloudsave.js`; `window.CASINO_GOOGLE_CLIENT_ID`
  overrides it). A client ID is public by design. The Perchance build still has the feature off
  (`cloudSaves = 0`) because the iframe's origin — `https://<generatorPublicId>.perchance.org` — is not
  on the OAuth client's authorized-JS-origins list, so GIS would answer `origin_mismatch`; add that
  origin in the Cloud console and flip `cloudSaves` to 1 if it is ever wanted there.
- **Staying signed in** (`SESSION_KEY`, `loadSession`/`saveSession`/`clearSession`). Google's access
  tokens are memory-only, so a reload used to *look* exactly like being signed out: the player signed
  in, synced, and the next load showed "SIGN IN" again — because the silent re-auth that was supposed
  to bring the session back (`prompt: "none"`) is refused whenever the browser blocks the hidden-iframe
  round trip (third-party cookies; the default in current Chrome, and it fails the same way in the
  editor preview, logging `[GSI_LOGGER]: Failed to open popup window`). The token + account are
  therefore mirrored into localStorage for as long as the token lasts (an hour), and the **account
  alone** is kept after that: boot fills `S.account` from `SESSION_KEY`, so the player is greeted by
  name and the button reads **RECONNECT** (status `expired`) instead of resetting to "SIGN IN". A valid
  token means the boot `silentSignIn()` just works — userinfo + Drive, no prompt, straight to
  "SYNCED". Expiry is enforced locally (`exp` is never extended) and SIGN OUT clears the key.
  `fail()` maps *any* failure with a remembered account and no usable token onto `expired`, so a dead
  token never shows a red "CLOUD !" — but a bad client ID or an over-size save keeps its own error.
  `cloud.debug.session` exposes save/load/clear/read for testing this without a Google account.
- **Conflicts always ask, never auto-resolve.** A fresh local run (see `isFreshSnapshot`) can never
  bury a real cloud save; the dialog pre-selects whichever side is *probably* right and a dismissed
  dialog writes a `deferred` marker to localStorage so the same cloud revision is not re-asked (and
  never silently overwritten) on the next load.
- **Applying a save goes through `applySaveObject`** in `state.js`, which refuses mismatched save
  generations, then `main.js`'s `reloadAfterCloudSave()` rebuilds the stage/nav/topbar rather than
  patching them. `canApply` blocks the whole thing mid-round.

**Fingerprints ignore `savedAt`** (`hashSave`, not `hashText(JSON.stringify(save))`). This took a
while to get right and is worth preserving: loads, re-renders and `mountGame` all re-stamp
`savedAt`, so hashing the whole object made two copies of an identical run look different — which
popped pointless conflict dialogs and re-uploaded identical bytes every few minutes. `pushBlob`
therefore skips an upload when the content hash already matches what we last synced, and
`schedulePush` shows "synced" instead of "SYNC" in the same case. The matching cost is a
`saveSnapshot() + JSON.stringify` per save event, which is microseconds on a ~3 KB save.

**Force the upload when the player asked for it.** The identical-content shortcut must NOT apply to a
decision the player just made (overwrite a corrupt/foreign file, keep this computer, load a save
file, the panel's upload button): those call `pushBlob(announce, true)`. Getting this wrong is subtle
— the corrupt cloud file stays corrupt while the UI says "synced".

**`applying` mutes the `saved` hook** while a cloud save is being written into localStorage, so a
load doesn't immediately look like a local edit and schedule a push. `loadCloud` also settles
`S.status` on "synced" at the end — leaving it on "syncing" (which `reconcile` set on the way in) is
easy to miss because the panel is usually closing at that moment.

**Testing without Google** (the whole reason the debug bag exists): `cloud.debug.setFetch(fn)` swaps
the network layer and `setTokenProvider(fn)` stands in for GIS, so a stub Drive can be driven from
`page_eval`. Notes from doing it: check the multipart/PATCH branches **before** the
`?spaces=appDataFolder` list branch in the stub, or creation returns `{files:[]}` and you get a
misleading "Drive did not return a file id". `page_eval` needs the preamble
`window.CASINO_CLOUD_FORCE = true` (or `?cloud`) to show the button on Perchance. And the push
debounce is 15 s (`AUTO_PUSH_MS`) — a test that asserts the auto-upload has to wait it out.

**Manual backup is deliberately first-class.** Download/load a `.json` save works signed out, which
covers the actual reported problem (a PC that wipes browser storage) without needing a Google
account at all.

### The privacy policy (`privacy.html`)

The optional cloud save is the reason this project needs a privacy policy at all — Google asks for
an "Application privacy policy link" on the OAuth consent screen — so the page is written around it,
and it is honest about the rest: everything else is local-only.

`privacy.html` is fully self-contained (its own `<style>`, no `styles.css`, no images, no scripts)
on purpose. It has to keep working when it is the only file a visitor lands on, and it must not
depend on the game's stylesheet path, which differs between the two builds (the mirror resolves
`styles.css` at the repo root; the Perchance page uses `src/styles.css`). It sits beside
`src/index.html`, i.e. at the **repo root of the GitHub Pages mirror**.

It is linked from two places in the game, and both take their `href` from `privacyUrl()` in
`src/ui.js` because the correct address differs per build:

- the footer strip (`#siteFoot` / `#privacyLink`) that is on every screen — this also satisfies the
  "link must be reachable from the app's home page" half of the Google requirement;
- a `PRIVACY POLICY ↗` button at the bottom of the cloud panel (`panelBody()` in `cloudsave.js`).

`privacyUrl()` returns a relative `privacy.html` unless the page is being served from
`perchance.org`, where no such file exists next to it and it falls back to `MIRROR_PRIVACY_URL` (the
published GitHub Pages copy). The relative form is deliberate on the mirror: it survives a repo
rename, a custom domain, or a fork. The static `href` attributes differ for the same reason
(relative in `src/index.html`, absolute in the Perchance `index.html`) so the link still works if
the script never runs.

Keep it in step with reality if the game's storage ever changes. The part that has to stay accurate
is section 2's table of `localStorage` keys — `casino-royale.save.v1`, `.sound.v1`, `.music.v1`,
`.device.v1`, `.cloud.session.v1`, `.cloud.deferred.v1` — which is the complete list of what the
game writes, plus section 4 on the two Google scopes (`drive.appdata`, `userinfo.email`) and where a
signed-in player can delete the cloud file or revoke access.
