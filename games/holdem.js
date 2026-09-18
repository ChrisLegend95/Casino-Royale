import { el, clear, sleep, confetti, shake } from "../ui.js";
import { stageShell } from "./common.js";
import { infoBtn, openInfo, sec, ul, note, payChips, examples, exampleRow } from "./infocard.js";
import { sfx } from "../audio.js";
import { CONFIG, state, saveState } from "../state.js";
import * as M from "./holdem-math.js";

/* =========================================================
   Texas Hold'em — one human seat against one, two or three bots.

   Everything that decides anything lives in holdem-math.js (the cards,
   the evaluator, the betting engine, the bot policy); this file is the
   table: the felt, the buttons, and the loop that walks the engine's
   `nextStep()` and waits for a click when the turn is yours. There is
   deliberately no second copy of the rules here, so the numbers in
   DEV-NOTES.md (measured through that same engine) describe exactly
   what this table deals.

   ----- the money -----
   Your stake IS your buy-in for one hand: main.js charges it up front
   and pays back `stake x heroFinalStack / stake`, so the most a hand can
   lose is the stake and the most it can win is every other stack at the
   table (~x3.9 at a full table). Each seat pays the House `holdemFee`
   (3%) of its buy-in as a seat charge and then plays with the rest;
   there is no rake on the pots. That choice makes the game exactly
   symmetric between equal seats, which is why the reference return is
   `1 - holdemFee` = 97% and why the only way to beat this table is to
   out-play the other seats -- which is the point of a poker table.

   Luck buys you a discount on YOUR OWN seat charge (up to
   `holdemLuckFee` off it at the luck cap) and nothing else: the deal is
   never touched. The House does not rig a poker table.

   ----- the cage pays whole dollars -----
   The felt moves in cents but `state.money` is whole dollars, so a hand
   is paid `round(finalStack)`. That rounding is not free: at a small
   buy-in it is a big fraction of the stake, and worse, it is not neutral
   -- a hand that ends on a fold tends to land on the same few cent values
   at a given stake, so the cents round the same way nearly every time.
   Measured (see DEV-NOTES.md) it is up to +0.9% of the stake at a $25
   buy-in and inside +/-0.2% from ~$50 up, which is why `minBet` is not
   $1: below the table minimum the rounding can out-earn the seat charge
   and the table stops being a house game. Two things keep it honest --
   a $50 minimum, and returning the EXACT ratio to main.js (rather than a
   cent-rounded multiplier, whose own quantization added a second, larger
   error term at small stakes).

   The bots' styles are drawn once, when you sit down, and shown on their
   plates -- so a patient player can actually read the table.
   ========================================================= */

const R2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* Poker moves in cents, not dollars: the bet panel's fmt() rounds to whole
   dollars, so chip amounts get their own formatter. */
function chips(v) {
  const n = R2(v);
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-$" : "$") + s;
}

/* Seat order is clockwise around the felt starting at your left shoulder,
   so seat index (which is also the engine's action order) always runs the
   same way round the picture as it does in the rules. */
const POS = {
  2: ["top", "hero"],
  3: ["left", "right", "hero"],
  4: ["left", "top", "right", "hero"],
};

const BOT_NAMES = ["Rosa", "Duke", "Mika", "Sol", "Nadia", "Buzz"];

const clampBots = (n) => Math.max(1, Math.min(3, Math.floor(Number(n) || 1)));

const HEX = ["\u2660", "\u2665", "\u2666", "\u2663"];

function makeCard(c, hole) {
  const red = M.SUIT_RED[c.s];
  const front = el("div", { class: "card-face front" + (red ? " red" : "") },
    el("div", { class: "corner top", text: c.r }),
    el("div", { class: "pip", text: HEX[c.s] }),
    el("div", { class: "corner bottom", text: c.r })
  );
  const back = el("div", { class: "card-face back" },
    el("div", { class: "card-back-pattern" }),
    el("div", { class: "card-emblem", text: "\u2660" })
  );
  const inner = el("div", { class: "card-inner" }, back, front);
  return el("div", { class: "card" + (hole ? " hole" : "") }, inner);
}

/* the chip discs in front of a seat: a handful of coins whose colour steps up
   with how much is out there, so a big bet reads as a big bet at a glance */
function chipStack(amount, unit) {
  const wrap = el("div", { class: "ht-chips" });
  if (amount <= 0) return wrap;
  const units = Math.max(1, Math.ceil(amount / Math.max(0.01, unit) / 2));
  const n = Math.min(6, units);
  const denom = amount / Math.max(1, n) > unit * 6 ? 3 : amount / Math.max(1, n) > unit * 2 ? 2 : 1;
  for (let i = 0; i < n; i++) wrap.appendChild(el("i", { class: "ht-chip d" + denom }));
  return wrap;
}

export default {
  id: "holdem",
  name: "Texas Hold'em",
  icon: "\u2660",
  action: "DEAL",
  blurb: "A real table: you against one, two or three bots. The House sells you a seat \u2014 the cards are honest.",
  minBet: Math.max(1, Math.round(CONFIG.holdemMinBet)),
  /* the ceiling is the whole table: every other stack plus your own (a full
     table of four loses 3 seat charges and your own discount on the fourth) */
  maxWinMult: Math.round((4 - CONFIG.holdemFee * (3 + (1 - CONFIG.holdemLuckFee))) * 100) / 100,
  payoutNote: () =>
    "You are dealt a <b>buy-in</b> for one hand and sit down against <b>up to 3 bots</b>. The House takes a " +
    "<b>" + Math.round(CONFIG.holdemFee * 100) + "% seat charge</b> off every buy-in \u2014 <b>no rake</b>, and the deal is " +
    "never rigged, so a seat that plays like the others returns <b>" + Math.round((1 - CONFIG.holdemFee) * 100) + "%</b>. " +
    "Beat the table and you keep every chip on it. Luck is a discount on <b>your own</b> seat charge. " +
    "The table opens at a <b>$" + Math.max(1, Math.round(CONFIG.holdemMinBet)) + " buy-in</b> \u2014 below that the whole-dollar payout rounding would swamp the charge.",

  create(app) {
    /* ---------- table state ---------- */
    let nBots = clampBots(state.holdem.bots);
    let botStyles = [];
    let hand = null;
    let busy = false;
    let dead = false;
    let humanResolver = null;
    let humanLegal = null;
    let lastStake = 1;
    let sb = 0.01;
    let bb = 0.02;
    let heroFee = 0;
    let botFee = 0;
    let heroSeat = 0;
    let lastPot = 0;
    let nextHandArmed = false;
    const views = [];

    /* the bot personalities are drawn when you sit down and then stay put, so
       the labels on their plates are a real read, not a per-hand mood. Draw
       them DISTINCT (a re-roll when a label collides) so two bots never show
       the same plate and the table reads as three different opponents. */
    function drawStyles() {
      botStyles = [];
      for (let i = 0; i < 3; i++) {
        let st = M.makeStyle(Math.random);
        for (let tries = 0; tries < 24 && botStyles.some((o) => o.label === st.label); tries++) {
          st = M.makeStyle(Math.random);
        }
        botStyles.push(st);
      }
    }
    drawStyles();

    /* ---------- the felt ---------- */
    const streetEl = el("div", { class: "ht-street", text: "\u2014" });
    const boardEl = el("div", { class: "ht-board" });
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const s = el("div", { class: "ht-slot" });
      slots.push(s);
      boardEl.appendChild(s);
    }
    const potVEl = el("span", { class: "v", text: chips(0) });
    const potChipsEl = el("span", { class: "ht-potchips" });
    const potEl = el("div", { class: "ht-pot" },
      el("span", { class: "k", text: "POT" }), potVEl, potChipsEl);
    const centerEl = el("div", { class: "ht-center" }, streetEl, boardEl, potEl);
    const flashEl = el("div", { class: "bj-flash" });
    const burstEl = el("div", { class: "bj-burst" });
    const tagEl = el("div", { class: "bj-tag" });
    const tableEl = el("div", { class: "ht-table" },
      el("div", { class: "ht-felt-glow" }),
      centerEl, flashEl, burstEl, tagEl);

    /* ---------- the controls ---------- */
    const headEl = el("div", { class: "ht-head" });
    const segEl = el("div", { class: "ht-seg" });
    const msgEl = el("div", { class: "ht-msg", text: "" });

    const foldBtn = el("button", { class: "btn red", type: "button", text: "FOLD", disabled: true, onclick: () => submit({ type: "fold" }) });
    const callBtn = el("button", { class: "btn green", type: "button", text: "CHECK", disabled: true, onclick: () => submit(submitCheck ? { type: "check" } : { type: "call" }) });
    const raiseBtn = el("button", { class: "btn gold", type: "button", text: "RAISE", disabled: true, onclick: () => submit({ type: "raise", to: sliderValue() }) });
    const nextBtn = el("button", { class: "btn gold", type: "button", text: "NEXT HAND", hidden: true, onclick: () => nextHand() });

    const raiseAmtEl = el("span", { class: "ht-ramt", text: "" });
    const sliderEl = el("input", { class: "ht-slider", type: "range", min: "0", max: "1", step: "0.01", value: "0", disabled: true });
    sliderEl.addEventListener("input", () => paintRaise());
    const quickEl = el("div", { class: "ht-quick" });
    const raiseRow = el("div", { class: "ht-raisrow" },
      el("span", { class: "ht-rlabel", text: "RAISE" }), sliderEl, raiseAmtEl);
    const quickRow = el("div", { class: "ht-quickrow" }, quickEl);

    const root = stageShell(
      "The House \u2014 Texas Hold'em",
      "Fold, call or raise. Beat the bots to the pot.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "ht-wrap" },
        headEl,
        tableEl,
        msgEl,
        el("div", { class: "ht-actions" }, foldBtn, callBtn, raiseBtn, nextBtn, raiseRow, quickRow)
      )
    );

    /* ---------- seats ---------- */
    function buildSeats() {
      for (const v of views) v.el.remove();
      views.length = 0;
      const pos = POS[nBots + 1] || POS[4];
      for (let i = 0; i <= nBots; i++) {
        const hero = i === nBots;
        const name = hero ? "You" : BOT_NAMES[i % BOT_NAMES.length];
        const cardsEl = el("div", { class: "ht-cards" });
        const nameEl = el("span", { class: "ht-name", text: name });
        const styleEl = el("span", { class: "ht-style", text: hero ? "" : botStyles[i].label });
        const dbtnEl = el("span", { class: "ht-dbtn", text: "D", hidden: true });
        const stackEl = el("span", { class: "ht-stack", text: chips(0) });
        const badgeEl = el("span", { class: "ht-badge", text: "" });
        const plateEl = el("div", { class: "ht-plate" },
          el("span", { class: "ht-id" }, nameEl, stackEl, dbtnEl),
          styleEl,
          badgeEl
        );
        const chipsEl = el("div", { class: "ht-bet" });
        const seatEl = el("div", { class: "ht-seat ht-" + pos[i] + (hero ? " human" : "") },
          cardsEl, plateEl, chipsEl);
        /* `shown` is how many of the seat's two cards the animation has dealt
           out yet: the engine hands both over at once, so the picture is paced
           by this counter rather than by the model */
        views.push({ i, el: seatEl, cardsEl, cardNodes: [], shown: 0, stackEl, styleEl, badgeEl, chipsEl, plateEl, dbtnEl, revealed: false });
        tableEl.appendChild(seatEl);
      }
      paintHead();
    }

    function paintHead() {
      clear(headEl);
      const stake = shownStake();
      const eff = app.effects();
      const d = Math.min(1, (eff.luck || 0) / Math.max(1e-9, CONFIG.luckCap)) * CONFIG.holdemLuckFee;
      const charge = R2(stake * CONFIG.holdemFee);
      const mine = R2(charge * (1 - d));
      headEl.appendChild(el("div", { class: "ht-facts" },
        el("span", { html: "buy-in <b>" + chips(stake) + "</b>" }),
        el("span", { html: "seat charge <b>" + chips(charge) + "</b>" + (d >= 0.05 ? " <i>(yours " + chips(mine) + " \u2014 luck)</i>" : "") }),
        el("span", { html: "blinds <b>" + chips(sbFor(stake) / 2) + "/" + chips(sbFor(stake)) + "</b>" }),
        el("span", { html: "best <b>\u00D7" + (state.holdem.bestMult || 1).toFixed(2) + "</b>" })
      ));
      clear(segEl);
      for (let n = 1; n <= 3; n++) {
        segEl.appendChild(el("button", {
          class: "ht-segbtn" + (n === nBots ? " on" : ""), type: "button",
          text: n === 1 ? "1 BOT" : n + " BOTS", disabled: busy,
          onclick: () => setBots(n),
        }));
      }
      headEl.appendChild(el("div", { class: "ht-segwrap" },
        el("span", { class: "ht-seglabel", text: "OPPONENTS" }), segEl));
    }

    function setBots(n) {
      n = clampBots(n);
      if (n === nBots || busy) return;
      nBots = n;
      state.holdem.bots = n;
      saveState();
      nextHandArmed = false;
      nextBtn.hidden = true;
      buildSeats();
      resetTable();
      msgEl.className = "ht-msg";
      msgEl.textContent = n === 1
        ? "Heads-up: one bot, and the button plays the small blind."
        : "Sit down with " + n + " bots \u2014 press DEAL when you're ready.";
      sfx.blip();
    }

    function shownStake() {
      const MIN = Math.max(1, Math.round(CONFIG.holdemMinBet));
      let v = Math.floor(app.bet || 0);
      const lim = app.tableLimit();
      const afford = state.infMoney ? lim : Math.min(state.money, lim);
      if (!Number.isFinite(v) || v < MIN) v = MIN;
      if (Number.isFinite(afford) && v > afford) v = Math.max(MIN, Math.floor(afford));
      return Math.max(MIN, v);
    }
    function sbFor(stake) {
      const unit = Math.max(0.01, R2((stake * (1 - CONFIG.holdemFee)) / Math.max(1, CONFIG.holdemDepth)));
      return unit;
    }

    /* ---------- painting ---------- */
    function paint() {
      if (!hand) return;
      streetEl.textContent = hand.done ? "SHOWDOWN"
        : hand.street.toUpperCase() + (hand.street === "preflop" ? " \u00B7 " + hand.seats.length + " SEATS" : "");
      /* the pot, and the coins in front of each seat. Once the hand is over the
         engine has already paid the pot out, so freeze the last live figure. */
      const pot = hand.done ? lastPot : M.potSize(hand);
      if (potVEl.textContent !== chips(pot)) {
        potVEl.textContent = chips(pot);
        clear(potChipsEl);
        potChipsEl.appendChild(chipStack(pot, bb));
        potVEl.classList.remove("pop");
        void potVEl.offsetWidth;
        potVEl.classList.add("pop");
      }
      const turn = M.nextToAct(hand);
      for (const v of views) {
        const s = hand.seats[v.i];
        if (!s) continue;
        v.stackEl.textContent = chips(s.stack);
        v.styleEl.hidden = !(v.i !== heroSeat && botStyles[v.i]);
        v.dbtnEl.hidden = hand.button !== v.i;
        v.el.classList.toggle("turn", turn === v.i && !v.revealed);
        v.el.classList.toggle("folded", !!s.folded);
        v.el.classList.toggle("allin", !!s.allIn);
        clear(v.chipsEl);
        v.chipsEl.classList.toggle("on", s.bet > 0 || s.potted > 0);
        if (s.bet > 0 || s.potted > 0) {
          v.chipsEl.appendChild(chipStack(s.bet + s.potted, bb));
          v.chipsEl.appendChild(el("span", { class: "ht-betamt", text: chips(s.bet + s.potted) }));
        }
        /* the hole cards: yours are face up, theirs turn over at showdown */
        const faceUp = v.i === heroSeat || v.revealed;
        const shown = Math.min(v.shown, s.hole.length);
        while (v.cardNodes.length > shown) v.cardNodes.pop().remove();
        for (let k = v.cardNodes.length; k < shown; k++) {
          v.cardNodes.push(makeCard(s.hole[k], !faceUp));
          v.cardsEl.appendChild(v.cardNodes[k]);
        }
      }
      for (let k = 0; k < 5; k++) {
        const c = hand.board[k];
        if (c && !slots[k].firstChild) slots[k].appendChild(makeCard(c, false));
      }
      paintRaise();
    }

    function resetTable() {
      hand = null;
      for (const v of views) {
        clear(v.cardsEl);
        v.cardNodes = [];
        v.shown = 0;
        v.revealed = false;
        clear(v.chipsEl);
        v.chipsEl.classList.remove("on");
        v.badgeEl.className = "ht-badge";
        v.badgeEl.textContent = "";
        v.stackEl.textContent = chips(0);
        v.el.classList.remove("turn", "folded", "allin", "win", "lose", "showdown");
      }
      for (const s of slots) clear(s);
      potVEl.textContent = chips(0);
      clear(potChipsEl);
      streetEl.textContent = "\u2014";
      paintRaise();
    }

    function setBadge(v, text, kind) {
      v.badgeEl.className = "ht-badge on" + (kind ? " " + kind : "");
      v.badgeEl.textContent = text;
    }

    function flash(kind) {
      flashEl.className = "bj-flash";
      void flashEl.offsetWidth;
      flashEl.className = "bj-flash on " + kind;
    }
    function showTag(text, kind) {
      tagEl.className = "bj-tag";
      void tagEl.offsetWidth;
      tagEl.textContent = text;
      tagEl.className = "bj-tag on " + (kind || "win");
    }
    function coinBurst(count) {
      const n = Math.min(70, Math.max(8, count));
      for (let i = 0; i < n; i++) {
        const c = el("div", { class: "bj-coin gold" });
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 150;
        c.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
        c.style.setProperty("--dy", Math.round(Math.sin(ang) * dist - 40) + "px");
        c.style.animationDelay = (Math.random() * 0.18).toFixed(2) + "s";
        burstEl.appendChild(c);
        setTimeout(() => c.remove(), 1800);
      }
    }

    /* ---------- your turn ---------- */
    let submitCheck = false;
    function sliderValue() {
      if (!humanLegal) return 0;
      const v = R2(sliderEl.value);
      return Math.max(humanLegal.minRaiseTo, Math.min(humanLegal.maxRaiseTo, v));
    }
    function paintRaise() {
      const la = humanLegal;
      const on = !!la;
      raiseRow.classList.toggle("off", !on);
      quickRow.classList.toggle("off", !on);
      if (!on) return;
      const only = la.minRaiseTo >= la.maxRaiseTo - 1e-9;
      sliderEl.disabled = only || la.maxRaiseTo <= la.minRaiseTo;
      const to = sliderValue();
      const shove = only || to >= la.maxRaiseTo - 1e-9;
      raiseBtn.textContent = shove ? "ALL IN " + chips(la.maxRaiseTo)
        : (hand && hand.currentBet > 0 ? "RAISE TO " : "BET ") + chips(to);
      raiseAmtEl.textContent = chips(shove ? la.maxRaiseTo : to);
    }

    function enableActions(on, la) {
      humanLegal = on ? la : null;
      foldBtn.disabled = !on;
      callBtn.disabled = !on;
      raiseBtn.disabled = !on || !la || !la.canRaise;
      if (on && la) {
        submitCheck = la.canCheck;
        callBtn.textContent = la.canCheck ? "CHECK" : "CALL " + chips(la.toCall);
        const only = la.minRaiseTo >= la.maxRaiseTo - 1e-9;
        const stepSpan = Math.max(0.01, R2((la.maxRaiseTo - la.minRaiseTo) / 60));
        sliderEl.min = String(la.minRaiseTo);
        sliderEl.max = String(la.maxRaiseTo);
        sliderEl.step = String(stepSpan);
        const half = R2((la.minRaiseTo + la.maxRaiseTo) / 2);
        sliderEl.value = String(only ? la.maxRaiseTo : Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, half)));
        buildQuick(la);
        paintRaise();
      } else {
        paintRaise();
      }
    }

    function buildQuick(la) {
      clear(quickEl);
      if (!la.canRaise) return;
      const potAfter = la.pot + la.toCall;
      const target = (frac) => R2(hand.currentBet + Math.max(bb, potAfter * frac));
      const opts = [
        ["MIN", la.minRaiseTo],
        ["\u00BD POT", hand.currentBet <= 0 ? target(0.5) : R2(hand.currentBet + potAfter * 0.5)],
        ["\u00BE POT", hand.currentBet <= 0 ? target(0.75) : R2(hand.currentBet + potAfter * 0.75)],
        ["POT", hand.currentBet <= 0 ? target(1) : R2(hand.currentBet + potAfter)],
        ["ALL IN", la.maxRaiseTo],
      ];
      for (const [label, value] of opts) {
        const v = Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, R2(value)));
        quickEl.appendChild(el("button", {
          class: "ht-qbtn" + (label === "ALL IN" ? " allin" : ""), type: "button", text: label,
          disabled: la.maxRaiseTo <= la.minRaiseTo && label !== "ALL IN",
          onclick: () => { sliderEl.value = String(v); paintRaise(); sfx.click(); },
        }));
      }
    }

    function askHuman(la) {
      return new Promise((resolve) => {
        humanResolver = resolve;
        enableActions(true, la);
      });
    }
    function submit(action) {
      if (!humanResolver || dead) return;
      const r = humanResolver;
      humanResolver = null;
      enableActions(false);
      r(action);
    }
    function abandon() {
      const r = humanResolver;
      humanResolver = null;
      enableActions(false);
      if (r) r({ type: "fold" });
    }

    /* ---------- one hand ---------- */
    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const auto = !!(opts && (opts.instant || opts.idle || opts.auto));
      const wait = (ms) => (instant ? Promise.resolve() : sleep(ms));
      busy = true;
      dead = false;
      nextHandArmed = false;
      nextBtn.hidden = true;
      lastStake = stake;
      resetTable();
      clear(headEl);
      paintHead();
      msgEl.className = "ht-msg";
      msgEl.textContent = "Shuffling up\u2026";

      /* ---- seat the table ---- */
      const n = nBots + 1;
      heroSeat = n - 1;
      const eff = app.effects();
      const fee = CONFIG.holdemFee;
      const luckShare = Math.min(1, (eff.luck || 0) / Math.max(1e-9, CONFIG.luckCap));
      heroFee = R2(stake * fee * (1 - luckShare * CONFIG.holdemLuckFee));
      botFee = R2(stake * fee);
      bb = sbFor(stake);
      sb = R2(bb / 2);
      const fees = [];
      for (let i = 0; i < n; i++) fees.push(i === heroSeat ? heroFee : botFee);
      /* The bots play the personality on their plate. Your seat plays the
         neutral house line whenever the table is playing it for you (instant,
         auto, idle), which is exactly the seat the 97% reference describes. */
      const styles = [];
      for (let i = 0; i < n; i++) styles.push(i === heroSeat ? M.HOUSE : (botStyles[i] || M.HOUSE));
      hand = M.createHand({
        stacks: new Array(n).fill(stake),
        fees,
        names: views.map((v, i) => (i === heroSeat ? "You" : BOT_NAMES[i % BOT_NAMES.length])),
        styles,
        button: Math.floor(Math.random() * n),
        sb, bb,
      });
      sfx.bank();
      for (const v of views) v.badgeEl.className = "ht-badge";

      /* ---- deal (two cards each, one at a time round the table) ---- */
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < n; i++) {
          views[i].shown = Math.min(2, views[i].shown + 1);
          if (!instant) sfx.deal();
          paint();
          await wait(round === 0 ? 95 : 130);
        }
      }
      msgEl.textContent = "Blinds " + chips(sb) + " / " + chips(bb) + " \u2014 seat charge " + chips(heroFee) + " on your buy-in.";

      /* ---- the hand ---- */
      let guard = 0;
      while (!hand.done && guard++ < 500) {
        const step = M.nextStep(hand);
        if (step.type === "turn") {
          const seat = hand.seats[step.seat];
          const la = step.legal;
          if (step.seat === heroSeat && !auto) {
            paint();
            msgEl.textContent = la.canCheck
              ? "Your move \u2014 check or bet."
              : "Your move \u2014 " + chips(la.toCall) + " to call.";
            const action = await askHuman(la);
            if (dead) break;
            sfx.click();
            applyAction(step.seat, action, instant);
          } else {
            /* a bot (or your seat in auto/idle): think, then act */
            paint();
            v_turn(step.seat);
            await wait(instant ? 0 : 330 + Math.random() * 260);
            if (dead) break;
            const style = seat.style || M.HOUSE;
            const action = M.decide(hand, step.seat, style, { eqIters: instant ? 140 : 220 });
            applyAction(step.seat, action, instant);
            await wait(instant ? 0 : 210 + Math.random() * 180);
          }
        } else if (step.type === "street") {
          const v = views[heroSeat];
          if (v) v.el.classList.remove("turn");
          const msg = { flop: "The flop.", turn: "The turn.", river: "The river." }[step.to] || "";
          msgEl.textContent = msg + (instant ? "" : " " + chips(M.potSize(hand)) + " in the middle.");
          if (step.to === "flop" && !instant) {
            for (let k = 0; k < 3; k++) { sfx.deal(); paint(); await wait(150); }
          } else {
            if (!instant) sfx.deal();
            paint();
            await wait(instant ? 0 : step.to === "flop" ? 380 : 320);
          }
        } else {
          break;
        }
      }
      if (!hand.done) M.settle(hand);

      /* ---- the result ---- */
      const hero = hand.seats[heroSeat];
      /* the EXACT ratio, not a cent-rounded one: main.js pays
         round(stake * mult) = round(hero.stack), so the cage's whole-dollar
         rounding is the only rounding in the payout. (Rounding this ratio to
         cents first -- 25 x R2(stack/25) -- added a second, stake-scaled error
         of up to $0.125 a hand at a $25 buy-in, and it was the larger of the
         two. See "the cage pays whole dollars" at the top of this file.) */
      const mult = Math.max(0, hero.stack / stake);
      lastPot = hand.result ? hand.result.pots.reduce((a, p) => a + p.amount, 0) : M.potSize(hand);
      if (mult > (state.holdem.bestMult || 1)) state.holdem.bestMult = mult;
      if (lastPot > (state.holdem.bestPot || 0)) state.holdem.bestPot = lastPot;
      if (!instant) saveState();
      await finish(mult, instant, auto);
      busy = false;
      if (!instant) {
        nextHandArmed = true;
        nextBtn.hidden = false;
        /* re-enable the opponent picker now that the table is idle again */
        paintHead();
      }
      return { multiplier: mult };
    }

    function v_turn(seat) {
      hand && views.forEach((v) => v.el.classList.toggle("turn", v.i === seat));
    }

    /* one action, animated: the engine has already applied it, we only say so */
    function applyAction(seat, action, instant) {
      /* `act` mutates the hand, so read the bet to CALL *before* we apply it:
         with nothing to call this is a BET (it opens the betting), otherwise a
         RAISE. After the call the engine's own currentBet is already ev.to, so
         testing it afterwards would label every bet a raise. */
      const priorBet = hand ? hand.currentBet : 0;
      const ev = M.act(hand, seat, action);
      if (!ev) { paint(); return; }
      const v = views[seat];
      const kind = ev.type;
      const opensBet = priorBet <= 1e-9;
      if (kind === "fold") { setBadge(v, "FOLD", "fold"); if (!instant) sfx.fold(); }
      else if (kind === "check") { setBadge(v, "CHECK", "call"); if (!instant) sfx.knock(); }
      else if (kind === "call") { setBadge(v, "CALL " + chips(ev.amount), "call"); if (!instant) sfx.chip(3); }
      else if (kind === "raise") {
        const allIn = ev.allIn;
        setBadge(v, (allIn ? "ALL IN " : "") + (opensBet ? "BET " : "RAISE TO ") + chips(ev.to), allIn ? "allin" : "raise");
        if (!instant) { if (allIn) sfx.allin(); else sfx.chip(6); }
      }
      v.el.classList.remove("turn");
      paint();
    }

    /* ---------- the end of a hand ---------- */
    async function finish(mult, instant, auto) {
      /* NOTE: `stake` is a parameter of play(), not of this function -- the
         stake this hand was played for is `lastStake` (set at the top of
         play). Referencing a bare `stake` here threw a ReferenceError on the
         fold/lose paths, which main.js catches as a x0 round. */
      const stake = lastStake;
      const res = hand.result || { pots: [], payouts: [], winners: [], showdown: [], foldedAll: false, board: [] };
      const hero = hand.seats[heroSeat];
      const heroWon = (res.payouts[heroSeat] || 0) > 0 && res.winners.indexOf(heroSeat) >= 0;
      const foldedAll = !!res.foldedAll || hand.board.length === 0;

      /* the showdown: turn the live seats' cards over, name their hands, and
         ring the five cards that actually won the pot */
      const best = new Set();
      for (const sd of res.showdown) {
        if (res.winners.indexOf(sd.seat) < 0) continue;
        for (const c of sd.best) best.add(c.r + c.s);
      }
      for (const sd of res.showdown) {
        const v = views[sd.seat];
        if (!v) continue;
        v.revealed = true;
        v.el.classList.add("showdown");
        for (const node of v.cardNodes) {
          if (!node.classList.contains("hole")) continue;
          node.classList.add("reveal");
          setTimeout(() => node.classList.remove("hole"), 640);
        }
        const won = res.winners.indexOf(sd.seat) >= 0;
        v.el.classList.add(won ? "win" : "lose");
        setBadge(v, won ? (sd.name || "WINS") : (sd.name || ""), won ? "raise" : "fold");
        if (won) {
          for (let k = 0; k < v.cardNodes.length && k < sd.hole.length; k++) {
            if (best.has(sd.hole[k].r + sd.hole[k].s)) v.cardNodes[k].classList.add("crown");
          }
        }
      }
      for (let k = 0; k < 5; k++) {
        const c = hand.board[k];
        if (c && best.has(c.r + c.s)) slots[k].firstChild.classList.add("crown");
      }
      /* if everyone folded there is no showdown, so the last seat standing is
         named by a badge instead */
      for (const w of res.winners) {
        const v = views[w];
        if (v && !v.el.classList.contains("showdown")) {
          v.revealed = true;
          v.el.classList.add("win");
          for (const node of v.cardNodes) {
            if (node.classList.contains("hole")) {
              node.classList.add("reveal");
              setTimeout(() => node.classList.remove("hole"), 640);
            }
          }
          setBadge(v, "TAKES IT DOWN", "raise");
        }
      }
      if (hero.folded) views[heroSeat].el.classList.add("lose");
      potVEl.textContent = chips(lastPot);
      streetEl.textContent = "SHOWDOWN";

      /* the headline: what the hand did to your stack */
      let tag, tagKind, msg, msgKind;
      if (heroWon) {
        tagKind = mult >= 1.02 ? "win" : "push";
        tag = mult >= 2 ? "\u00D7" + mult.toFixed(2) + " THE LOT" : "YOU WIN THE POT";
        msg = "You take the pot \u2014 " + chips(res.payouts[heroSeat]) + (foldedAll ? " (everyone folded)." : " at showdown.");
        msgKind = tagKind;
      } else if (hero.folded) {
        tag = "YOU FOLD"; tagKind = "lose";
        msg = res.winners.length
          ? BOT_NAMES[res.winners[0] % BOT_NAMES.length] + " takes " + chips(lastPot) + "."
          : "You let the hand go.";
        msgKind = "lose";
      } else {
        tag = "YOU LOSE"; tagKind = "lose";
        msg = res.winners.length
          ? "The pot goes the other way: " + chips(lastPot) + "."
          : "The hand ended with nothing to collect.";
        msgKind = "lose";
      }
      msgEl.className = "ht-msg " + msgKind;
      msgEl.textContent = msg;
      msgEl.appendChild(el("span", { class: "ht-mult", text: " \u00B7 your hand returned \u00D7" + mult.toFixed(2) }));

      if (heroWon) {
        if (!instant) sfx.pot(mult >= 2 ? 3 : 1);
        showTag(tag, tagKind);
        flash("green");
        coinBurst(Math.min(60, 14 + Math.round(res.payouts[heroSeat])));
        if (!instant && mult >= 1.5) confetti(46);
      } else if (hero.folded) {
        showTag(tag, "lose");
        flash("gold");
        if (!instant && lastPot >= stake * 2) shake(tableEl);
      } else {
        showTag(tag, "lose");
        flash("red");
        if (!instant && lastPot >= stake * 2) shake(tableEl);
      }
      paint();
    }

    function nextHand() {
      if (busy || !nextHandArmed) return;
      nextBtn.hidden = true;
      nextHandArmed = false;
      app.playAgain();
    }

    /* ---------- how to win ---------- */
    function openInfoCard() {
      const ranks = examples(
        exampleRow(["A\u2660", "K\u2660", "Q\u2660", "J\u2660", "10\u2660"], "<b>Straight flush</b> \u2014 five in a row, one suit. The ace-high one is the <b>royal</b>, the best hand there is."),
        exampleRow(["Q\u2663", "Q\u2666", "Q\u2660", "Q\u2665", "4\u2663"], "<b>Four of a kind</b> \u2014 quads. Nothing beats it but a straight flush."),
        exampleRow(["Q\u2663", "Q\u2666", "Q\u2660", "4\u2665", "4\u2663"], "<b>Full house</b> \u2014 three of one rank, two of another."),
        exampleRow(["K\u2665", "J\u2665", "9\u2665", "6\u2665", "3\u2665"], "<b>Flush</b> \u2014 five of one suit. Ties go to the highest cards."),
        exampleRow(["9\u2665", "8\u2663", "7\u2666", "6\u2660", "5\u2665"], "<b>Straight</b> \u2014 five in a row, any suits."),
        exampleRow(["8\u2665", "8\u2663", "8\u2660", "K\u2666", "3\u2665"], "<b>Three of a kind</b> \u2014 trips."),
        exampleRow(["A\u2665", "A\u2663", "9\u2660", "9\u2666", "7\u2665"], "<b>Two pair</b> \u2014 the higher pair decides, then the kicker."),
        exampleRow(["10\u2665", "10\u2663", "A\u2660", "6\u2666", "3\u2665"], "<b>One pair</b> \u2014 one pair, then three kickers."),
        exampleRow(["A\u2665", "Q\u2663", "9\u2660", "6\u2666", "3\u2665"], "<b>High card</b> \u2014 nothing made. Compare the top card, then the next.")
      );

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-hint", text: "FROM UNBEATABLE DOWN TO NOTHING" }),
        ranks
      );

      const pay = payChips([
        { glyph: "\u{1F3C6}", main: "the whole table", note: "every other stack", cls: "" },
        { glyph: "\u2713", main: "the pot", note: "your share of it" },
        { glyph: "\u00BD", main: "part", note: "a short stack left" },
        { glyph: "\u00D7", main: "the buy-in", note: "a lost hand", cls: "scat" },
      ]);

      openInfo("Texas Hold'em \u2014 How to Win", el("div", { class: "ic" },
        el("div", { class: "ic-top" },
          el("div", { class: "ic-map" }, visual),
          el("div", { class: "ic-col" },
            sec("One hand, start to finish",
              ul([
                "Every seat is dealt <b>two cards face down</b>, then five shared cards come out in three stages: the <b>flop</b> (3), the <b>turn</b> (1) and the <b>river</b> (1).",
                "Your best hand is the best <b>five</b> cards you can make from your two and the five on the table \u2014 you don't have to use your own cards at all.",
                "There are four rounds of betting: before the flop and after each stage. Everyone still in at the end turns their cards over, and the best hand takes the pot.",
              ])
            ),
            sec("Your moves",
              ul([
                "<b>FOLD</b> \u2014 give up the hand. Anything you have already put in stays in the pot.",
                "<b>CHECK</b> \u2014 no bet owed, so pass the action along. <b>CALL</b> \u2014 match the current bet.",
                "<b>BET / RAISE</b> \u2014 put in more. The slider and the quick chips (\u00BD pot, \u00BE pot, pot, all in) set the amount; <b>ALL IN</b> shoves the lot.",
              ])
            ),
            sec("The seat charge \u2014 and why there is no rake here",
              ul([
                "Your stake <b>is</b> your buy-in for the hand. Each seat, yours included, pays the House a <b>" + Math.round(CONFIG.holdemFee * 100) + "% seat charge</b> up front and plays with the rest.",
                "That is the whole house edge, and it is honest: four equal seats paying the same charge are an <b>even game between themselves</b>, so a seat that plays like the others returns <b>" + Math.round((1 - CONFIG.holdemFee) * 100) + "%</b>. Out-play them and you keep everything.",
                "Every seat starts <b>" + CONFIG.holdemDepth + " big blinds</b> deep, so the bet sizes scale with the stake \u2014 the game is the same at every table limit.",
                "The table opens at a <b>$" + Math.max(1, Math.round(CONFIG.holdemMinBet)) + " buy-in</b>. The felt runs on cents, but the cage pays whole dollars and rounds every hand to the nearest one \u2014 at a tiny buy-in that rounding would swamp the seat charge, so a seat that small isn't sold.",
              ])
            ),
            sec("Luck at this table",
              ul([
                "Luck buys you a discount on <b>your own seat charge</b> \u2014 up to " + Math.round(CONFIG.holdemLuckFee * 100) + "% off it at the luck cap, which takes your return from <b>" + Math.round((1 - CONFIG.holdemFee) * 100) + "%</b> to about <b>" + (Math.round((1 - CONFIG.holdemFee * (1 - CONFIG.holdemLuckFee)) * 1000) / 10) + "%</b>.",
                "It <b>never</b> touches the deal. The House does not deal a rigged hand at a poker table \u2014 the bots' styles are printed on their plates instead, and they play exactly the way they look.",
              ])
            )
          )
        ),
        sec("What a hand pays", pay,
          note("A hand you win is paid as <b>your final stack \u00F7 your stake</b>, so taking a pot with chips still behind can pay less than the pot \u2014 and a full-table win pays about <b>\u00D7" + (Math.round((4 - CONFIG.holdemFee * (3 + (1 - CONFIG.holdemLuckFee))) * 100) / 100) + "</b>. Your seat charge is already inside those numbers."))
      ));
    }

    /* ---------- boot ---------- */
    buildSeats();
    resetTable();
    paintHead();
    msgEl.textContent = "Pick your opponents, set a bet, then DEAL.";

    return {
      root,
      play,
      actionLabel: "DEAL",
      isBusy: () => busy,
      onBetChange: () => { if (!busy) paintHead(); },
      destroy() {
        dead = true;
        abandon();
      },
    };
  },
};
