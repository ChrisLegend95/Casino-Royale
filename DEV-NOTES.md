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

## Testing

The live preview is the real engine, so `page_eval` is the fastest loop. Two tricks that make
machine testing deterministic:

- **Seeded drum/roll:** machines (and therefore `selectOne`) use `Math.random` — stub it before
  clicking PLAY/SPIN to force a specific outcome, then restore it. Russian Roulette shuffles its
  hidden load with `CH-1` calls and only THEN draws the landing chamber as
  `floor(Math.random() * CH)`, so one constant can't pin both. `Math.random = () => 0.99` keeps a
  one-live drum at chamber 0 and lands chamber 5 — a reliable blank (survive → the bank doubles).
  To force the round, walk a sequence: `let q=[.99,.99,.99,.99,.99,.05], i=0; Math.random = () =>
  q[i++];` — the shuffle is a no-op and the hammer lands chamber 0, where the live round sits.
  See `rolledLoad` / `liveFor` / `spin`.
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

- **Russian Roulette** (`games/revolver.js`) is the only machine whose "payout" is a bank of
  compounded multipliers rather than a per-spin multiple, so it returns the bank directly. One
  buy-in opens the bank at ×1.00 and there is nothing to top up: a SPIN re-loads and spins the
  drum fresh, then the hammer falls — a blank doubles the bank (`rrDouble`) and a live round ends
  the run and takes the whole bank. The player may spin as long as they like and must CASH OUT
  themselves, at whatever the bank stands at. There are no lives, no counters and no tells.

  **The drum gets heavier.** The load for the next spin is `liveFor(blanks) = clamp(blanks,
  rrLiveStart, rrLiveMax)` — one live round to open, one more each time the bank doubles, capping
  at `rrLiveMax`. With the defaults that is 1, 1, 2, 3, 4, 5 live of six: the opening two spins are
  a 1-in-6 shot and the top of the run is a single empty chamber. It is NEVER shown to the player —
  the HUD has 3 cells (Bank / Cash out / Best ever) and no danger meter, and no in-play text hints
  at the load; only the info card's ladder says it. `rrRake` is a cage cut that ships at **0**, so
  the multiplier the bank shows is exactly what the player keeps (this replaced an earlier 2% cut
  that made "×4 bank" pay ×3.92 — the mismatch players rightly called a bug).

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

  **Return.** The payout is a flat ×2 per blank while the danger climbs, so the run is generous to
  whoever stops early: expected cash-out value per unit staked after `b` blanks is
  `2^b × ∏(1 − liveFor(k)/CH)`, which peaks near ×3.7 (cashing at ×8–×16) and still beats ×1 up to
  ×32. An expert player has a real edge and the only decision is when to walk. To make the house
  win instead, raise `rrLiveMax` (more danger), lower it (less), or put a cut back in `rrRake`.
