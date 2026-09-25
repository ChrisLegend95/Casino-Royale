# link [https://chrislegend95.github.io/Casino-Royale/]

# 🎰 Gamble Casino

A collection of free-to-play casino-style and risk-based games made for fun, excitement, and a little bit of luck.

## 🎮 Why I Made This

I like gambling.

I like the excitement, the risk, the anticipation, and that feeling when you take a chance and see what happens.

But I also know that gambling can become a serious problem for people. Losing money, getting into debt, and watching something that was supposed to be fun turn into something harmful is not fun.

Many of us have friends or family members who have struggled with gambling or lost more than they could afford.

That got me thinking:

**Does the gambling itself really need to be real for it to be fun?**

For me, the answer is no.

You can have the excitement of taking a risk, watching a multiplier climb, hoping for a lucky spin, or deciding whether to push your luck without putting your real money on the line.

That's what this project is about.

### 🎲 Gamble without the consequences

This game is made for anyone who wants a bit of gambling-style excitement without the possibility of losing their money.

**No debt.  
No deposits.  
No withdrawals.  
No real-money gambling.  
Just games and fictional numbers.**

The goal is simple:

> **Keep the fun and excitement of gambling while leaving the real-world losses behind.**

---

## 🎰 Games

The project currently includes:

- 🎰 **Slots** — three reels, six paying symbols and a **wild that fills in for any of them** (three wilds pay the 200× top prize) — the machine carries **no jackpot and no pot of its own**, so it just advertises its own honest **95.7%** (96.7% at the 10× bet cap). It used to carry a seventh, dead symbol (a drawn "blank window" that killed any line it landed on); the player had it removed, so the ladder came down with it and every symbol on the drum now pays
- 🎯 **Fortune Lines** — five reels, nine paylines, free spins on 3+ scatters, and **a progressive pot of its own** (three of the signs *anywhere* on the fifteen cells, about 1 spin in 4,091)
- 💫 **Wheelhouse** — 25 paylines; **three or more** wheel scatters drop the bonus wheel for ×3–×25 of your *total* stake (wins about 1 spin in 143), plus **its own progressive pot** (about 1 spin in 4,522)
- 🎡 **Roulette**
- 🃏 **Blackjack**
- 🐎 **Horse Race**
- 🚀 **Rocket Crash**
- 👻 **Ghost Muncher**
- 🐸 **Frogger Gamble**
- 🧠 **Neon Recall**
- 💰 **Treasure Chest**
- 🔫 **Russian Roulette**
- ♠️ **Texas Hold'em**

More games may be added in the future.

---

## 💰 100% Free to Play

Gamble Casino is completely free to play.

There is **no real-money gambling** involved.

- ❌ No real-money deposits
- ❌ No real-money withdrawals
- ❌ No purchasing virtual currency
- ❌ No cash prizes
- ❌ No payment system
- ❌ No betting with real money
- ❌ No personal accounts required *(playing needs none; the optional cloud save below is the only
  thing that touches a login, and it is entirely skippable)*
- ❌ No intentional collection of personal data *by this project* — the optional cloud save talks
  directly to the player's own Google Drive and never to any server of ours (see Privacy)

All coins, rewards, bets, multipliers, and other values are fictional and have **no real-world monetary value**.

You cannot lose real money by playing this game.

---

## 🔒 Privacy

Privacy is an important part of this project.

The game does not require an account and does not intentionally collect or store personal information.

There is no payment system and no reason for the game to ask for financial information.

### Optional cloud save

There is one optional exception, and you can ignore it completely: a **"Sign in with Google"**
button in the top bar that mirrors your save into your own Google Drive, so a run survives a
reinstalled browser or moves to another computer.

If you use it:

- The page talks **directly to Google**. There is no game server and nothing is sent to the person
  who made this game.
- The game stores one small file (`casino-royale-save.json`) in its own hidden app folder in *your*
  Drive — the same place other apps keep their settings. It does not appear in your normal Drive
  list, and only this app's own client can read it.
- It asks for two permissions: access to that app folder, and your email address so the panel can
  show which account is signed in.
- You can sign out or delete the cloud copy from that panel at any time; your run on the computer
  stays where it was.

If you never sign in, nothing about the game changes — your progress is always stored locally on
your own device first, and there is a manual "download/load save file" option in the same panel for
keeping a backup without any account at all.

The full policy is written out on its own page, [`privacy.html`](privacy.html). It is linked from
the footer of the game on every screen and from the cloud-save panel itself, and it is the address
registered as this project's privacy-policy link with Google.

The goal is to let you play without needing to hand over your personal information just to spin a digital wheel.

---

## 🕹️ About the Project

Gamble Casino is an open-source project built around a simple idea:

**Gambling-style games can be exciting even when nothing real is at stake.**

The project focuses on creating fun, quick, and entertaining games where the player can take risks, chase fictional rewards, and experience the excitement of gambling without real-world financial consequences.

---

## ✨ Features

- 🎰 Multiple casino-style games
- 🎮 100% free to play
- 💰 Fictional in-game currency
- 🔒 No accounts required *(optional Google cloud save for backup)*
- 🛡️ No intentional personal data collection
- 💳 No payment system
- 🤑 No real-money gambling
- 🌐 Designed to be easy to access and play
- 📖 Open source

---

## 📜 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

See the [`LICENSE`](LICENSE) file for the full license.

---

## ⚠️ Disclaimer

Gamble Casino is a fictional, free-to-play game.

It does not provide real-money gambling, betting services, financial services, or cash prizes.

All currencies, rewards, bets, multipliers, and other gameplay values are fictional and have no real-world monetary value.

The purpose of this project is entertainment and experimentation.

---

## ❤️ The Idea

Gambling can be fun.

Losing your money isn't.

So why not keep the first part and get rid of the second?

**Take the risk.  
Feel the excitement.  
Keep your money.**

🎰 **Have fun. Gamble with pixels.**

---

## 🛠️ For developers

Symbol artwork lives in [`sprites/`](sprites/README.md) — 70 cut-out slot symbols (148 × 148 PNGs,
names and the cut recipe documented there), served through the tiny [`sprites.js`](sprites.js)
module. The machines that show a symbol to the player — **Slots, Fortune Lines, Wheelhouse and
Treasure Chests** — draw it with that artwork; the emoji they used to use is kept as the fallback for a
missing file. Sizes are set per container with the `--sp-base` custom property (see the "symbol
artwork" block in `styles.css`), never with `font-size`. The economics of every machine, the save/version rules, the harnesses used to measure them and the
machine-by-machine notes live in [`DEV-NOTES.md`](DEV-NOTES.md) — start there before retuning any
number. The one-line summary: every chance machine must return **under 100%** even with every perk and
luck bonus maxed, **luck alone can never push a table to 100%**, no single round may pay more than
`maxWinMult` (1000×) the stake, and **no machine
may have a farmable outcome** — an easy, repeatable result worth more than the stake. **The slot
jackpot is not a hole in any of that**: **each of the two 5-reel machines keeps its own bank**
(Fortune Lines and Wheelhouse never share a pot — a sign only ever empties the cabinet it lands on), and
every bank is funded entirely from the players' own money *at that machine* (5% of each **losing** spin's
**loss**, less a 50% house cut, so 2.5% of the loss is banked), so a bank only ever pays back money its
own machine already took. **Lucky Sevens has no jackpot at all** — no sign, no meter, no slice, no bank —
so its paytable *is* its return, **95.68% cold / 96.69% at the cap**, and every symbol on its drum pays
(it carried a drawn **blank window** as a dead stop until the player had it removed — see
[`sprites/README.md`](sprites/README.md)). The two banks' only effect on a player's return is the part
that reaches the pot — **2.5% of the loss**, worth 1.88 / 1.64 points of RTP on Fortune Lines /
Wheelhouse — which is why their advertised figures, **93.65% / 96.38% cold**, are *above* their own model
figures of 91.77% / 94.74%: they are the honest long-run return of a cabinet whose meters are always
eventually collected. (A player who never sees a pot realizes exactly the model figure; the house's
realized hold is its model edge minus the pot — 6.35 / 3.62 points, comfortably positive.) That invariance is
the fix for what this section used to report as a hole: the feed was once 30% of the *stake* with 80% to
the pot, which returned ~18 points of an 8.2-point edge and paid **over 110%** to anyone patient enough to
collect. The rule now is that **the pot's share must stay under the machine's own edge** — retune
`jackpotRate`/`jackpotHouseCut`, never the paytables, which are fitted. Splitting the old single pot
changed **no** cabinet's
cost, because each was always charged only on its own spins; what it changed is that one machine's losers
no longer fund another machine's winner — and that each meter now climbs only as fast as its own cabinet
is played.
A spin that **wins** pays no slice at all, and neither does a **push** — a round that hands the stake
straight back — so only a genuine loss is ever taxed. A pot is
deliberately paid **outside** `maxWinMult` — clamping it would let the house ceiling confiscate a pot
that had grown past it — and the admin always-win rig deliberately cannot forge it (the sign is removed
from every rigged pool). Feeding is proportional to what the spin actually lost, so it cannot be farmed
by bet size or timing. The trigger is **three JACKPOT signs anywhere on the drums** — no payline
involved, and a wild
never stands in for one. The exact rates come from a Poisson-binomial over the cells: about **1 in
4,091** on Fortune Lines and **1 in 4,522** on Wheelhouse (Lucky Sevens has no sign to land at all, and
no pot). Because the feed is charged on the loss while the
trigger is per spin, the two 5-reel cabinets take their pots from very different wallets — 9 lines
against 25 — see `DEV-NOTES.md` for that honest asymmetry and the levers if it ever needs flattening. The two ladders
(Frogger and Neon Recall) are *fitted* to a measured reference player (see "Frogger balance & the god
harness" and the Neon Recall note) rather than guessed, so their low rungs are a push, not free money.
**Frogger is the one standing exception to the farmability rule**: its grass is safe (there is no death
clock), and a perfect planner still beats the ladder on purpose — but the **hurry-up**
(`froggerPatienceSec` 1.0 / `froggerPatienceDecay` 0.95: grass is safe, not free, and loitering past a
second sags the banked multiplier for the rest of the run) caps it at **×1.14**, down from **×4.72** with
unlimited patience, and it no longer responds to patience at all (1.5s and 90s of it both land at
×1.11–1.17). What is left is the ladder's first rung, not a patience exploit. That trade was made at the
player's request, and
`DEV-NOTES.md` records both the measurement and the non-fatal fix if the ceiling is ever wanted back.
**Texas Hold'em is the second deliberate exception, and a cleaner one:** its house edge is a flat 3%
*seat charge* on every buy-in (`holdemFee`) rather than a paytable, so a seat that plays like the bots
returns exactly 97%, and a player who out-plays the table keeps the difference — that is what a poker
table *is*. Luck only discounts the player's **own** seat charge (never a rigged deal: 98.5% at the
luck cap), and the table opens at a $50 buy-in (`holdemMinBet`) because the whole-dollar payout
rounding is worth up to +0.94% of the stake below that. Measured worst case (a $200 buy-in with luck
maxed): 99.1%, still under 100%.
Keep `main.pjs` and the `cfg()` fallbacks in `src/state.js` in step by hand if you retune any of this.
The repo mirror on GitHub Pages is a **separate copy** of every file under `src/` — after changing
anything here, re-upload it (root `index.html` plus the `src/` files with the prefix stripped): see
[`DEPLOY.md`](DEPLOY.md).
The money perks (Fat Stacks / Safety Net, plus the comp **On the House**) are **bounded and shared**:
each is capped at 1.5% of the stake (ten stacks each) and all of them are clamped to the pit's shared
`perkBudget` (1.5% of the stake), a number deliberately under the thinnest edge in the building
(roulette's 2.7%), so no combination of rake-back perks can carry a table past 100% — the worst case
(all of them bought, betting red/black on roulette) is 99.8%. The one open-ended lever is the endless
**Fortune** perk, +0.1% of the profit on a win per stack, which is *meant* to be the long-run power
curve that eventually takes a dedicated regular past the house. If the house
ever needs to be unbeatable again, it is `perkBudget` / `winBonusStack` / `rebateStack` / `profitStack` /
`compStack` that have to come down. The three perks that move something *other* than a payout —
**Gambler** (the house table limit), **Pit Boss's Nephew** (the loan principal) and **Showboat** (the
celebration) — cannot carry a table past 100% at all: see "The pit's little favours" in
[`DEV-NOTES.md`](DEV-NOTES.md). See the power-curve note there before retuning any of the payout
constants. The **level reward** is a comp too (`levelReward` 5 × the level, 0.5% of the stake at level 1
and falling), and it is deliberately decoupled from the XP multipliers — Scholarship and IDLE buy levels
faster, never a bigger comp.
