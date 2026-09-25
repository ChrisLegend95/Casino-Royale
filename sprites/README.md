# `src/sprites/` — slot symbol artwork

70 cut-out game sprites (one PNG each), extracted from the artwork sheet the project owner supplied
(`source-sheet.png` in this folder is a byte-exact copy of that sheet).

## Where they are used

The machines that show the player a **symbol** draw it with this artwork instead of emoji, through
the `src/sprites.js` module (the only file that knows these paths and sizes):

| machine | symbols | file(s) |
|---|---|---|
| Slots (`src/games/slots.js`) | cherry, lemon, bell, diamond (the `gem` symbol), seven, wild | those six |
| Fortune Lines (`src/games/slots-multi.js`) | cherry, lemon, watermelon, grapes, bell, diamond, seven, star, wild, bonus (scatter), jackpot | those eleven |
| Wheelhouse (`src/games/slots-wheel.js`) | cherry, lemon, orange, plum, bell, coin, diamond (the `gem` symbol), seven, crown, wild, wheel (scatter), jackpot | those twelve |
| Treasure Chests (`src/games/chest.js`) | closed chest `treasure`, trap `skull`, prizes `trophy`, `diamond`, `mystery` (cash), `coin` | those six |

The `jackpot` sign (row 6, column 3 — the red/gold marquee with the crown and flames) is the
**progressive symbol** on the **two 5-reel machines**: three of them anywhere on a machine's drums
empty **that machine's own pot** — each cabinet keeps a separate bank, so a sign never empties another
machine's (see `DEV-NOTES.md` → "The jackpots"). The sign pays no line multiplier on either machine —
it is a scatter (see `DEV-NOTES.md` → "The wild's weight"). Wherever the sign is drawn on a drum it is
ringed in the meter pod's red (`.jcell`), so it is recognisable in a spin as well as on the card.

**Lucky Sevens (the first machine) carries no jackpot and draws no sign** — and, since the player had
the machine's dead stop removed, **no blank window either**. Its drum carried a seventh symbol that was
never artwork: a drawn "blank window" that paid nothing and killed any line it landed on, five units of
dead reel weight that held its old, richer ladder (4/7/14/34/60) at 95.68%. That plate read as debris
left over from the jackpot sign, and off the player's request it came off the drum; the ladder came down
with it (3/5/10/25/50 on the triples, the pair pays untouched) so the return is exactly what it was.
Every symbol on that cabinet is now a sprite from this folder, so it has **no row of its own** and
nothing to mirror — the six rows above that mention cherry, lemon and bell serve it like any other
machine.

The emoji each one replaced is kept in the game source as the **fallback** — `src/sprites.js` swaps
the `<img>` for the emoji if its file cannot be loaded, so a partial mirror upload degrades to the
old look instead of showing broken images. Everything else in the folder is still unused (available
for future machines, backgrounds and effects); the machine *nav* icons are deliberately still emoji,
because they are also embedded in plain prose all over `src/main.js`.

## File format

Every file is a **148 × 148 PNG with a real alpha channel**:

- the sprite is tight-cropped to its own alpha bounding box and **centred without scaling**, so a
  file's visible content is the artwork at its native sheet resolution (approx. 55–131 px wide,
  67–122 px tall) with transparent padding around it;
- padding is therefore *not* uniform between files — to get uniform optical size, scale each sprite
  by its own alpha bbox. That is exactly what `src/sprites.js` does: its `BOX` table holds every
  sprite's measured art size and each `<img>` gets a `--sp-k` of `148 / the art's longest side`, so a
  container that sets `--sp-base` shows every symbol at that artwork size regardless of its padding
  (the image box itself stays square at `--sp-base` and the scale is a transform, which keeps every
  sprite dead centre in its cell);
- alpha is cleaned: `alpha < 4 → 0`, and the source sheet's title text, per-sprite caption labels,
  separator rules and the bottom-left/bottom-right headings were excluded (only the 70 sprites were
  taken; the sheet's typography is not in this folder).

## Filenames (row-major, as they appear on the sheet)

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| **1** | `crown` | `seven` | `cherry` | `bell` | `watermelon` | `grapes` | `lemon` | `orange` | `plum` | `diamond` |
| **2** | `joker` | `skull` | `coin` | `cash` | `gold-bar` | `dice` | `horseshoe` | `clover` | `star` | `hot-seven` |
| **3** | `shark` | `duck` | `cat` | `pig` | `panda` | `wolf` | `tiger` | `eagle` | `bear` | `lion` |
| **4** | `rocket` | `ufo` | `bomb` | `lightning` | `magnet` | `portal` | `tornado` | `meteor` | `treasure` | `boss` |
| **5** | `wheel` | `slot-machine` | `key` | `map` | `scroll` | `mystery` | `orb` | `trophy` | `gift` | `heart` |
| **6** | `wild` | `bonus` | `jackpot` | `x2` | `x3` | `x5` | `free-spins` | `chaos` | `reset` | `unknown` |
| **7** | `casino` | `cloud` | `explosion` | `coins` | `gems` | `water` | `fire` | `smoke` | `vortex` | `skull-crown` |

Rows 1–2 are the classic reel symbols, rows 3–4 the character/feature symbols, row 5 the bonus
objects, row 6 the on-screen FX / multiplier labels (they carry their own text — that text is part
of the artwork), and row 7 the optional background/effect elements.

## Rebuilding from the sheet

`source-sheet.png` (1312 × 1199, RGBA) already has its background removed — the supplied sheet is a
Photoroom cut-out, so the matte is trustworthy and no per-pixel background subtraction is needed.
The cut recipe (a Worker script using `OffscreenCanvas`, run against `source-sheet.png`):

1. binarise `alpha > 40` and label 4-connected components;
2. keep components with **area > 1200** — that keeps exactly the 70 sprites and drops every caption,
   heading, rule and the "SPIN FIGHT WIN" graffiti (all ≤ 1192 px);
3. group them into rows by centroid `y` (within 60 px), sort each row by centroid `x`; this yields
   rows of exactly 10 — row 1 is the header logo block and is discarded;
4. tight-trim each component to its own `alpha ≥ 8` bbox (this is what keeps the captions out even if
   one ever touched a sprite);
5. floor `alpha < 4` to 0, paste centred (no scaling) into a 148 × 148 transparent canvas, write PNG.

Verified afterwards with two contact sheets (white and near-black backgrounds) — no halos, no
leftover background patches, no clipping, all 70 present.
