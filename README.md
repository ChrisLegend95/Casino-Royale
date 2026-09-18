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

- 🎰 **Slots**
- 🎯 **Fortune Lines**
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
module. The machines that show a symbol to the player — **Slots, Fortune Lines and Treasure
Chests** — draw it with that artwork; the emoji they used to use is kept as the fallback for a
missing file. Sizes are set per container with the `--sp-base` custom property (see the "symbol
artwork" block in `styles.css`), never with `font-size`. The economics of every machine, the save/version rules, the harnesses used to measure them and the
machine-by-machine notes live in [`DEV-NOTES.md`](DEV-NOTES.md) — start there before retuning any
number. The one-line summary: every chance machine must return **under 100%** even with every perk and
luck bonus maxed, **luck alone can never push a table to 100%**, no single round may pay more than
`maxWinMult` (1000×) the stake, and **no machine
may have a farmable outcome** — an easy, repeatable result worth more than the stake. The two ladders
(Frogger and Neon Recall) are *fitted* to a measured reference player (see "Frogger balance & the god
harness" and the Neon Recall note) rather than guessed, so their low rungs are a push, not free money.
**Frogger is the one standing exception to the farmability rule**: it has no death clock any more, so
its grass is safe indefinitely and a patient player can beat the ladder on purpose (measured ×1.19 with
just 3s of patience, ×4.72 unbounded) — that was a deliberate trade made at the player's request, and
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
The money perks (Fat Stacks / Safety Net) are a separate, deliberately generous **power curve** the
player grinds toward, and the endless one — **Fortune**, +0.1% of the profit on a win per stack — is
the lever that eventually carries any table past 100%: that is the design, not an accident, so it is
the perk constant (`winBonusStack` / `rebateStack` / `profitStack`) that has to come down if the house
ever needs to be unbeatable again. See the power-curve note in `DEV-NOTES.md` before retuning them.
