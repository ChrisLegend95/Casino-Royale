import { el, clear, sleep, toast, confetti, shake } from "../ui.js";
import { stageShell } from "./common.js";
import { infoBtn, openInfo, examples, exampleRow, sec, ul, note, payChips } from "./infocard.js";
import { sfx } from "../audio.js";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [{ s: "\u2660", red: false }, { s: "\u2665", red: true }, { s: "\u2666", red: true }, { s: "\u2663", red: false }];

function buildShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const r of RANKS) for (let s = 0; s < 4; s++) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function cardValue(c) {
  if (c.r === "A") return 11;
  if (c.r === "J" || c.r === "Q" || c.r === "K" || c.r === "10") return 10;
  return Number(c.r);
}

function score(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c); if (c.r === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const isBJ = (cards) => cards.length === 2 && score(cards).total === 21;

/* gold arc of felt text stamped above the dealer, like a real table layout */
function arcSvg(id) {
  return '<svg class="bj-arc-svg" viewBox="0 26 420 100" preserveAspectRatio="xMidYMid meet">' +
    '<defs><path id="' + id + '" d="M 30 112 Q 210 -8 390 112" fill="none"/></defs>' +
    '<text class="bj-arc-text"><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>' +
    '</svg>';
}

export default {
  id: "blackjack",
  name: "Blackjack",
  icon: "\u{1F0CF}",
  action: "DEAL",
  blurb: "Beat the dealer to 21 without busting. The House always plays by the rules.",
  payoutNote: () =>
    'Win <span class="k">2x</span>, blackjack <span class="k">2.5x</span>, push returns your bet. ' +
    "Double down to stake twice on one card. Lucky Coin perks can save a bust.",
  minBet: 1,

  create(app) {
    let shoe = buildShoe(6);
    const dealer = { cards: [] };
    const player = { cards: [] };
    let hidden = true;
    let busy = false;
    let usedSave = false;
    let actionResolver = null;
    let lastStake = 1;
    let dealerNodes = [];
    let playerNodes = [];
    let dealt = false;

    const dealerHandEl = el("div", { class: "hand dealer-hand" });
    const playerHandEl = el("div", { class: "hand player-hand" });
    const dealerScoreEl = el("div", { class: "bj-score", text: "\u2013" });
    const playerScoreEl = el("div", { class: "bj-score", text: "\u2013" });
    const msgEl = el("div", { class: "bj-msg", text: "Place your bet, then DEAL." });

    const shoeCountEl = el("span", { class: "shoe-count", text: "312" });
    const shoeEl = el("div", { class: "bj-shoe" },
      el("div", { class: "shoe-stack" }, el("i"), el("i"), el("i")),
      el("div", { class: "shoe-box" }, el("span", { class: "shoe-emblem", text: "\u2660" })),
      el("div", { class: "shoe-label" }, el("span", { text: "SHOE" }), shoeCountEl)
    );
    const flashEl = el("div", { class: "bj-flash" });
    const burstEl = el("div", { class: "bj-burst" });
    const tagEl = el("div", { class: "bj-tag" });
    const arcEl = el("div", { class: "bj-arc", html: arcSvg("bjArcPath") });
    const strokeEl = el("div", { class: "bj-stroke", text: "DEALER MUST DRAW TO 16 AND STAND ON ALL 17s" });

    const tableEl = el("div", { class: "bj-table" },
      el("div", { class: "bj-glow" }),
      arcEl,
      el("div", { class: "bj-stroke-wrap" }, strokeEl),
      shoeEl,
      el("div", { class: "bj-row dealer" },
        el("div", { class: "bj-row-head" }, el("div", { class: "label", text: "Dealer" }), dealerScoreEl),
        dealerHandEl
      ),
      el("div", { class: "bj-row player" },
        el("div", { class: "bj-row-head" }, el("div", { class: "label", text: "You" }), playerScoreEl),
        playerHandEl
      ),
      flashEl,
      burstEl,
      tagEl
    );

    const hitBtn = el("button", { class: "btn green", type: "button", text: "HIT", disabled: true, onclick: () => sendAction("hit") });
    const standBtn = el("button", { class: "btn red", type: "button", text: "STAND", disabled: true, onclick: () => sendAction("stand") });
    const dblBtn = el("button", { class: "btn gold", type: "button", text: "DOUBLE", disabled: true, onclick: () => sendAction("double") });

    const root = stageShell(
      "The House \u2014 Blackjack",
      "You against the dealer. 6-deck shoe, dealer stands on all 17s.",
      { info: infoBtn(() => openInfoCard()) },
      el("div", { class: "bj-wrap" },
        tableEl,
        msgEl,
        el("div", { class: "bj-actions" }, hitBtn, standBtn, dblBtn)
      )
    );

    function drawCard() {
      if (shoe.length < 20) shoe = buildShoe(6);
      const c = shoe.pop();
      shoeCountEl.textContent = String(shoe.length);
      return c;
    }

    function makeCard(c, isHole) {
      const suit = SUITS[c.s];
      const front = el("div", { class: "card-face front" + (suit.red ? " red" : "") },
        el("div", { class: "corner top", text: c.r }),
        el("div", { class: "pip", text: suit.s }),
        el("div", { class: "corner bottom", text: c.r })
      );
      const back = el("div", { class: "card-face back" },
        el("div", { class: "card-back-pattern" }),
        el("div", { class: "card-emblem", text: "\u2660" })
      );
      const inner = el("div", { class: "card-inner" }, back, front);
      return el("div", { class: "card" + (isHole ? " hole" : "") }, inner);
    }

    /* diff instead of rebuild: a card element is created once and then reused, so
       only freshly dealt cards run the deal-in animation (and the hole card flips
       by gaining a class rather than being swapped for a new node) */
    function syncHand(container, cards, nodes, holeIndex) {
      while (nodes.length > cards.length) {
        const n = nodes.pop();
        if (n) n.remove();
      }
      for (let i = 0; i < cards.length; i++) {
        if (nodes[i]) continue;
        const isHole = holeIndex === i;
        const node = makeCard(cards[i], isHole);
        nodes[i] = node;
        container.appendChild(node);
        if (dealt) sfx.blip();
      }
    }

    function paintScore(node, cards, isDealer) {
      if (isDealer && hidden) {
        const up = cards.length ? score([cards[0]]).total : null;
        setScore(node, up === null ? "\u2013" : up + " + ?", "bj-score");
        return;
      }
      const v = score(cards);
      if (!cards.length) { setScore(node, "\u2013", "bj-score"); return; }
      setScore(node, String(v.total), "bj-score" + (v.total > 21 ? " bust" : isBJ(cards) ? " bj" : ""));
    }
    function setScore(node, text, cls) {
      if (node.textContent !== text) {
        node.textContent = text;
        node.classList.remove("pop");
        void node.offsetWidth;
        node.classList.add("pop");
      }
      node.className = cls + (node.classList.contains("pop") ? " pop" : "");
    }

    function render() {
      syncHand(dealerHandEl, dealer.cards, dealerNodes, hidden ? 1 : -1);
      if (!hidden && dealerNodes[1] && !dealerNodes[1].classList.contains("reveal")) {
        const holeNode = dealerNodes[1];
        holeNode.classList.add("reveal");
        setTimeout(() => holeNode.classList.remove("hole"), 640);
        if (dealt) sfx.reelStop();
      }
      syncHand(playerHandEl, player.cards, playerNodes, -1);
      paintScore(dealerScoreEl, dealer.cards, true);
      paintScore(playerScoreEl, player.cards, false);
    }

    function enableActions(on) {
      hitBtn.disabled = !on;
      standBtn.disabled = !on;
      dblBtn.disabled = !on || player.cards.length !== 2 || !app.canAfford(lastStake);
    }
    function sendAction(a) {
      if (!actionResolver) return;
      const r = actionResolver;
      actionResolver = null;
      enableActions(false);
      r(a);
    }
    const waitAction = () =>
      new Promise((resolve) => {
        actionResolver = resolve;
        enableActions(true);
      });

    function autoAction() {
      const v = score(player.cards);
      const up = cardValue(dealer.cards[0]);
      const twoCards = player.cards.length === 2;
      const canDouble = twoCards && app.canAfford(lastStake);
      const dbl = (range) => twoCards && canDouble && up >= range[0] && up <= range[1];
      if (v.soft) {
        if (v.total >= 19) return "stand";
        if (v.total === 18) {
          if (dbl([3, 6])) return "double";
          if (up >= 2 && up <= 8) return "stand";
          return "hit";
        }
        if (v.total === 17) return dbl([3, 6]) ? "double" : "hit";
        if (v.total === 15 || v.total === 16) return dbl([4, 6]) ? "double" : "hit";
        if (v.total === 13 || v.total === 14) return dbl([5, 6]) ? "double" : "hit";
        return "hit";
      }
      if (v.total >= 17) return "stand";
      if (v.total >= 13) return up >= 2 && up <= 6 ? "stand" : "hit";
      if (v.total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
      if (v.total === 11) return dbl([2, 10]) ? "double" : "hit";
      if (v.total === 10) return dbl([2, 9]) ? "double" : "hit";
      if (v.total === 9) return dbl([3, 6]) ? "double" : "hit";
      return "hit";
    }

    /* ---------- table effects ---------- */
    function setTable(kind) {
      tableEl.classList.remove("win", "lose", "push", "blackjack", "bust");
      if (kind) tableEl.classList.add(kind);
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
    function coinBurst(count, kind) {
      const n = Math.min(70, Math.max(8, count));
      for (let i = 0; i < n; i++) {
        const c = el("div", { class: "bj-coin " + (kind || "gold") });
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 150;
        c.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
        c.style.setProperty("--dy", Math.round(Math.sin(ang) * dist - 40) + "px");
        c.style.animationDelay = (Math.random() * 0.18).toFixed(2) + "s";
        burstEl.appendChild(c);
        setTimeout(() => c.remove(), 1800);
      }
    }
    function resetFx() {
      setTable(null);
      flashEl.className = "bj-flash";
      tagEl.className = "bj-tag";
      clear(burstEl);
      dealerNodes = [];
      playerNodes = [];
      clear(dealerHandEl);
      clear(playerHandEl);
    }

    async function play(stake, opts) {
      const instant = !!(opts && opts.instant);
      const auto = !!(opts && opts.auto);
      const luck = app.effects().luck;
      lastStake = stake;
      busy = true;
      usedSave = false;
      dealt = false;
      resetFx();
      hidden = true;
      dealer.cards = [];
      player.cards = [];
      msgEl.className = "bj-msg";
      msgEl.textContent = "";
      player.cards.push(drawCard(), drawCard());
      dealer.cards.push(drawCard(), drawCard());
      render();
      dealt = true;

      if (!instant) await sleep(430);

      const naturalBJ = isBJ(player.cards);
      const dealerBJ = isBJ(dealer.cards);

      if (naturalBJ || dealerBJ) {
        hidden = false;
        render();
        if (!instant) await sleep(560);
        if (naturalBJ && dealerBJ) {
          setTable("push"); showTag("PUSH", "push"); flash("gold");
          msgEl.className = "bj-msg push"; msgEl.textContent = "Both blackjack \u2014 push.";
          busy = false; return { multiplier: 1 };
        }
        if (naturalBJ) {
          setTable("blackjack"); showTag("BLACKJACK!", "gold"); flash("gold");
          coinBurst(46, "gold"); confetti(80);
          msgEl.className = "bj-msg win"; msgEl.textContent = "BLACKJACK! Pays 3:2";
          busy = false; return { multiplier: 2.5 };
        }
        setTable("lose"); showTag("DEALER BLACKJACK", "lose"); flash("red"); shake(tableEl);
        msgEl.className = "bj-msg lose"; msgEl.textContent = "Dealer blackjack.";
        busy = false; return { multiplier: 0 };
      }

      let doubled = false;
      let busted = false;
      let stood = false;

      while (!busted && !stood) {
        const a = (instant || auto) ? autoAction() : await waitAction();
        if (a === "stand") { stood = true; break; }
        if (a === "double") {
          if (player.cards.length === 2 && app.spend(stake)) {
            doubled = true;
            player.cards.push(drawCard());
            render();
            if (!instant) await sleep(320);
            if (score(player.cards).total > 21) busted = true;
            break;
          }
          continue;
        }
        player.cards.push(drawCard());
        render();
        if (!instant) await sleep(280);
        if (score(player.cards).total > 21) busted = true;
      }

      if (busted && !usedSave && score(player.cards).total > 21) {
        const chance = Math.min(0.3, luck);
        if (chance > 0 && Math.random() < chance) {
          usedSave = true;
          player.cards.pop();
          player.cards.push(drawCard());
          render();
          if (!instant) {
            toast("Lucky save! The dealer looks away\u2026", "gold", 1600);
            await sleep(500);
          }
          busted = score(player.cards).total > 21;
        }
      }

      if (busted) {
        hidden = false;
        render();
        if (!instant) await sleep(420);
        setTable("bust"); showTag("BUST", "lose"); flash("red"); shake(tableEl);
        msgEl.className = "bj-msg lose";
        msgEl.textContent = "Bust with " + score(player.cards).total + ".";
        busy = false;
        return { multiplier: 0 };
      }

      hidden = false;
      render();
      if (!instant) await sleep(420);
      while (score(dealer.cards).total < 17) {
        dealer.cards.push(drawCard());
        render();
        if (!instant) await sleep(360);
      }

      const p = score(player.cards).total;
      const d = score(dealer.cards).total;
      let mult;
      if (d > 21) {
        mult = 2;
        setTable("win"); showTag("DEALER BUSTS", "win"); flash("green"); coinBurst(30, "gold");
        msgEl.className = "bj-msg win"; msgEl.textContent = "Dealer busts with " + d + " \u2014 you win!";
      } else if (p > d) {
        mult = 2;
        setTable("win"); showTag("YOU WIN", "win"); flash("green"); coinBurst(doubled ? 44 : 28, "gold");
        msgEl.className = "bj-msg win"; msgEl.textContent = p + " beats " + d + " \u2014 you win!";
      } else if (p === d) {
        mult = 1;
        setTable("push"); showTag("PUSH", "push"); flash("gold");
        msgEl.className = "bj-msg push"; msgEl.textContent = "Push at " + p + ".";
      } else {
        mult = 0;
        setTable("lose"); showTag(d + " BEATS " + p, "lose"); flash("red"); shake(tableEl);
        msgEl.className = "bj-msg lose"; msgEl.textContent = d + " beats " + p + " \u2014 dealer wins.";
      }
      if (doubled && mult > 1) msgEl.textContent += " (doubled)";
      if (!instant && mult >= 2 && p - d >= 4) confetti(36);
      busy = false;
      return { multiplier: mult };
    }

    function openInfoCard() {
      const ex = examples(
        exampleRow(["10\u2660", "9\u2665"],
          "A solid <b>20</b>. The dealer shows 8 and draws out to 15 \u2014 <b>you win</b>, paid <b>2x</b> your stake."),
        exampleRow(["A\u2660", "K\u2665"],
          "<b>Blackjack!</b> An ace plus a ten on the first two cards \u2014 paid <b>3:2</b>, i.e. <b>2.5x</b>."),
        exampleRow(["10\u2663", "9\u2666"],
          "The dealer also finishes on 19 \u2014 <b>push</b>. Your stake comes straight back."),
        exampleRow(["K\u2663", "8\u2665", "7\u2660"],
          "<b>26 \u2014 bust.</b> Go over 21 and you lose immediately, however the dealer finishes.")
      );

      const visual = el("div", { class: "ic-visual" },
        el("div", { class: "ic-hint", text: "FOUR WAYS A HAND ENDS" }),
        ex
      );

      const top = el("div", { class: "ic-top" },
        el("div", { class: "ic-map" }, visual),
        el("div", { class: "ic-col" },
          sec("How a hand plays out",
            ul([
              "You and the dealer are each dealt <b>two cards</b>; one of the dealer's stays face down.",
              "Totals aim at <b>21</b> without going over. An ace counts <b>11 or 1</b>, whichever keeps the hand alive.",
              "Highest total at or under 21 wins. Going over 21 is a <b>bust</b> \u2014 the stake is gone at once.",
            ])
          ),
          sec("Your three moves",
            ul([
              "<b>HIT</b> \u2014 take another card. Hit as often as you like.",
              "<b>STAND</b> \u2014 end your turn on the total you have.",
              "<b>DOUBLE</b> \u2014 first two cards only: match your stake, take exactly <b>one</b> more card, then stand. A winning double pays on both stakes.",
            ])
          ),
          sec("The dealer's rule",
            ul([
              "The dealer <b>draws to 16 and stands on all 17s</b>, soft 17s included.",
              "It never changes, so you always know exactly what the dealer will do next.",
            ])
          ),
          sec("Lucky Coin perks",
            ul([
              "Perks can <b>save a bust</b>: the busting card is swapped for a fresh one (up to a <b>30%</b> chance).",
              "One save per hand, and it only ever triggers on a bust.",
            ])
          )
        )
      );

      const pay = payChips([
        { glyph: "\u2713", main: "2x", note: "a win" },
        { glyph: "\u2605", main: "2.5x", note: "blackjack" },
        { glyph: "=", main: "1x", note: "push" },
        { glyph: "\u00D7", main: "0", note: "loss / bust", cls: "scat" },
      ]);

      openInfo("Blackjack \u2014 How to Win", el("div", { class: "ic" },
        top,
        sec("Pays on your bet", pay,
          note("A winning double pays on the doubled stake, so a doubled 2x win returns <b>4x</b> your original bet."))
      ));
    }

    render();
    return { root, play, actionLabel: "DEAL", isBusy: () => busy };
  },
};
