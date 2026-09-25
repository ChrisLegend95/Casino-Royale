/* =========================================================
   holdem-math.js — the Texas Hold'em engine, pure and headless.

   One module holds the whole game: the cards, the evaluator, the betting
   engine and the bot policy. The table UI (src/games/holdem.js) drives it
   by asking `nextStep()` and feeding the human's click back in through
   `act()`; the measurement harness in DEV-NOTES.md drives the very same
   functions and asks `decide()` for every seat instead of waiting for a
   click. There is therefore exactly one copy of the rules, and the numbers
   in the notes come from the code that ships.

   ----- money model (why the House takes a seat charge, not a rake) -----
   Every hand re-buys the four seats for the round stake, so a round's
   maximum LOSS is the stake (main.js charges it up front and pays back
   `stake x multiplier`). Each seat pays the House a flat `holdemFee`
   fraction of its buy-in before the cards come out, and then plays with
   what is left. There is no rake on the pots.

   That choice is not cosmetic. A pot rake is a hopeless house edge at
   these depths: the player only wins a pot about a third of the time and
   an average pot is a quarter of a buy-in, so even a 10% rake costs the
   player roughly 0.1 x 0.25 x P(win) = under 1% of the stake a hand.
   Charging the buy-in instead is worth exactly `holdemFee` a hand, and it
   has a second, better property: it makes the game **exactly** symmetric.
   Four seats paying the same fee and playing the same policy are an even
   game between them - every seat's expected share of the chips on the
   table is the same - so the reference player's return is

       E[multiplier] = 1 - holdemFee        (provably, not measured)

   and the only way to beat it is to out-play the other three seats. That
   is what a poker table should be: the House sells you a seat, and what
   happens after that is between the players. See the balance book in
   DEV-NOTES.md.

   Blinds are a fixed depth (`holdemDepth` big blinds per stack) and are
   always drawn from the post-fee stack, so the game is scale-invariant:
   the fee cannot change the game being played, only its size.

   The casino's luck perk buys the hero a discount on *their own* seat
   charge (`holdemLuckFee` off it at full luck) - never a rigged deal,
   which is the one thing a poker table must not do. Poker is a fair
   betting game, so each seat's expected final stack is its own post-fee
   stack (the harness measures 24.6925 vs a 24.70 start, and 24.2525 vs
   24.25 for the three full-fee seats), which means the discount survives
   in full: the return at the luck cap is `1 - fee x (1 - luck)` = 98.8%
   rather than the `1 - fee` the seats without the perk get.
   `cfg.fees` therefore takes a per-seat charge; `cfg.fee` sets them all.
   ========================================================= */

/* ---------- cards ------------------------------------------------------- */

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
export const SUIT_RED = [false, true, true, false];

const RV = {};   // "A" -> 14
const RI = {};   // "A" -> 12
RANKS.forEach((r, i) => { RV[r] = i + 2; RI[r] = i; });

export function makeDeck() {
  const d = [];
  for (const r of RANKS) for (let s = 0; s < 4; s++) d.push({ r, s });
  return d;
}
export function cardId(c) { return RI[c.r] * 4 + c.s; }
export function cardText(c) { return c.r + SUITS[c.s]; }
export function rankVal(c) { return RV[c.r]; }

export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Deterministic RNG for the harness (mulberry32). The live table uses
   Math.random; the harness seeds this so a run can be replayed exactly. */
export function seededRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- the evaluator ---------------------------------------------- *
   A five-card hand packs into one integer, biggest hand biggest number:

     score = ((((cat*16 + k1)*16 + k2)*16 + k3)*16 + k4)*16 + k5

   with ranks 2..14 (they fit in a nibble, which is the whole trick) and
   `cat` the hand class. Comparing two scores is then just `>`, which is
   what makes the Monte Carlo cheap enough to run between plays. */

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, BOAT: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};
const CAT_NAME = ["High card", "Pair", "Two pair", "Three of a kind", "Straight",
  "Flush", "Full house", "Four of a kind", "Straight flush"];

const _v = new Int32Array(5);
const _gv = new Int32Array(5);
const _gc = new Int32Array(5);

function pack(c, k1, k2, k3, k4, k5) {
  return ((((c * 16 + k1) * 16 + k2) * 16 + k3) * 16 + k4) * 16 + k5;
}

export function scoreParts(score) {
  const k = [0, 0, 0, 0, 0];
  let s = score;
  for (let i = 4; i >= 0; i--) { k[i] = s % 16; s = Math.floor(s / 16); }
  return { cat: s, k };
}
export function catOf(score) { return Math.floor(score / 1048576); }

function scoreFive(a, b, c, d, e) {
  _v[0] = RV[a.r]; _v[1] = RV[b.r]; _v[2] = RV[c.r]; _v[3] = RV[d.r]; _v[4] = RV[e.r];
  for (let i = 1; i < 5; i++) {
    const x = _v[i];
    let j = i - 1;
    while (j >= 0 && _v[j] < x) { _v[j + 1] = _v[j]; j--; }
    _v[j + 1] = x;
  }
  const v0 = _v[0], v1 = _v[1], v2 = _v[2], v3 = _v[3], v4 = _v[4];
  const flush = a.s === b.s && b.s === c.s && c.s === d.s && d.s === e.s;
  let straight = 0;
  if (v0 !== v1 && v1 !== v2 && v2 !== v3 && v3 !== v4) {
    if (v0 - v4 === 4) straight = v0;
    /* the wheel: ace plays low, so A-5 is a five-high straight */
    else if (v0 === 14 && v1 === 5) straight = 5;
  }
  if (flush && straight) return pack(CAT.STRAIGHT_FLUSH, straight, 0, 0, 0, 0);
  if (flush) return pack(CAT.FLUSH, v0, v1, v2, v3, v4);
  /* group the sorted ranks into (rank, count) runs */
  let ng = 0;
  for (let i = 0; i < 5; i++) {
    if (ng > 0 && _gv[ng - 1] === _v[i]) _gc[ng - 1]++;
    else { _gv[ng] = _v[i]; _gc[ng] = 1; ng++; }
  }
  /* order the groups by count, then by rank (the runs come out rank-desc, and
     this selection sort is stable over them, so ties keep the higher rank first) */
  for (let i = 1; i < ng; i++) {
    const cv = _gv[i], cc = _gc[i];
    let j = i - 1;
    while (j >= 0 && _gc[j] < cc) { _gv[j + 1] = _gv[j]; _gc[j + 1] = _gc[j]; j--; }
    _gv[j + 1] = cv; _gc[j + 1] = cc;
  }
  if (_gc[0] === 4) return pack(CAT.QUADS, _gv[0], _gv[1], 0, 0, 0);
  if (_gc[0] === 3 && _gc[1] === 2) return pack(CAT.BOAT, _gv[0], _gv[1], 0, 0, 0);
  if (straight) return pack(CAT.STRAIGHT, straight, 0, 0, 0, 0);
  if (_gc[0] === 3) return pack(CAT.TRIPS, _gv[0], _gv[1], _gv[2], 0, 0);
  if (_gc[0] === 2 && _gc[1] === 2) return pack(CAT.TWO_PAIR, _gv[0], _gv[1], _gv[2], 0, 0);
  if (_gc[0] === 2) return pack(CAT.PAIR, _gv[0], _gv[1], _gv[2], _gv[3], 0);
  return pack(CAT.HIGH, v0, v1, v2, v3, v4);
}

/* the index lists for "best five of N cards" - 21 combinations at seven */
function combosOf(n) {
  const out = [];
  const pick = (start, cur) => {
    if (cur.length === 5) { out.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); pick(i + 1, cur); cur.pop(); }
  };
  pick(0, []);
  return out;
}
const COMB = { 5: combosOf(5), 6: combosOf(6), 7: combosOf(7) };

/* best five-card score out of 5, 6 or 7 cards */
export function evalScore(cards) {
  const n = cards.length;
  if (n < 5) return 0;
  if (n === 5) return scoreFive(cards[0], cards[1], cards[2], cards[3], cards[4]);
  const list = COMB[n];
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const s = scoreFive(cards[x[0]], cards[x[1]], cards[x[2]], cards[x[3]], cards[x[4]]);
    if (s > best) best = s;
  }
  return best;
}

/* the same, but also hands back WHICH five cards made it (the UI crowns them) */
export function evaluate(cards) {
  const n = cards.length;
  if (n < 5) return { score: 0, best: cards.slice() };
  if (n === 5) return { score: scoreFive(cards[0], cards[1], cards[2], cards[3], cards[4]), best: cards.slice() };
  const list = COMB[n];
  let best = -1, bi = null;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const s = scoreFive(cards[x[0]], cards[x[1]], cards[x[2]], cards[x[3]], cards[x[4]]);
    if (s > best) { best = s; bi = x; }
  }
  return { score: best, best: bi.map((i) => cards[i]) };
}

const RN = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "jack", "queen", "king", "ace"];
const RP = ["", "", "twos", "threes", "fours", "fives", "sixes", "sevens", "eights",
  "nines", "tens", "jacks", "queens", "kings", "aces"];

export function scoreName(score) {
  const { cat, k } = scoreParts(score);
  switch (cat) {
    case CAT.HIGH: return "High card, " + RN[k[0]];
    case CAT.PAIR: return "Pair of " + RP[k[0]];
    case CAT.TWO_PAIR: return "Two pair, " + RP[k[0]] + " and " + RP[k[1]];
    case CAT.TRIPS: return "Three " + RP[k[0]];
    case CAT.STRAIGHT: return k[0] === 14 ? "Royal straight" : RN[k[0]] + "-high straight";
    case CAT.FLUSH: return RN[k[0]] + "-high flush";
    case CAT.BOAT: return RP[k[0]] + " full of " + RP[k[1]];
    case CAT.QUADS: return "Four " + RP[k[0]];
    default: return k[0] === 14 ? "Royal flush" : RN[k[0]] + "-high straight flush";
  }
}
export function catLabel(score) { return CAT_NAME[catOf(score)]; }

/* ---------- whose hand is it? -------------------------------------------
   The evaluator answers "how good is the best five of these seven?". The
   helper chip under the hero's cards has to answer a different question --
   "what do I actually have?" -- because the board is shared. A beginner
   reads "pair of sixes" on a 6-6-Q-3-2 board as their own pair when the two
   sixes are the table's and their king and seven are only kickers, which is
   exactly the misreading this breaks down.

   The way in is which of the hole cards supply what DEFINES the hand: the
   rank of a pair (the two ranks of a two pair, the trips and the pair of a
   boat), or the suit of a flush, or the five ranks of a straight. A hole
   card can sit in the best five -- a kicker -- without being any part of the
   hand's identity, which is why `works` and `key` are counted separately:

     works     hole cards in the best five at all (kickers included)
     key       hole cards that supply the defining rank/suit
     boardKey  board cards that supply the defining rank/suit

   So key.length 2/1/0 reads "mine / shared / the table's", and works.length
   0 means the board's five are literally the whole hand. Ask it for five or
   more cards: before the flop there is no best five to talk about.
   ------------------------------------------------------------------------ */
export function readHole(hole, board) {
  const cards = hole.concat(board);
  if (cards.length < 5) return { score: 0, cat: CAT.HIGH, name: "", top: 0, works: [], key: [], boardKey: 0 };
  const ev = evaluate(cards);
  const { cat, k } = scoreParts(ev.score);
  const best = ev.best;
  const inBest = (c) => best.indexOf(c) >= 0;
  const works = [];
  for (let i = 0; i < hole.length; i++) if (inBest(hole[i])) works.push(i);

  /* the ranks that define a pair-shaped hand, if this is one */
  let ranks = null;
  if (cat === CAT.PAIR || cat === CAT.TRIPS || cat === CAT.QUADS) ranks = [k[0]];
  else if (cat === CAT.TWO_PAIR || cat === CAT.BOAT) ranks = [k[0], k[1]];

  const key = [];
  let boardKey = 0;
  if (cat === CAT.FLUSH || cat === CAT.STRAIGHT_FLUSH) {
    const suit = best[0].s;   // every card of a flush shares the suit
    for (let i = 0; i < hole.length; i++) if (works.indexOf(i) >= 0 && hole[i].s === suit) key.push(i);
    for (const c of board) if (inBest(c) && c.s === suit) boardKey++;
  } else if (cat === CAT.STRAIGHT) {
    /* all five cards of a straight define it equally, so a hole card in the
       five is part of the run rather than a passenger */
    for (const i of works) key.push(i);
    for (const c of board) if (inBest(c)) boardKey++;
  } else if (cat === CAT.HIGH) {
    /* nothing made: the only thing worth saying about your cards is whether
       one of them is the high card itself */
    for (let i = 0; i < hole.length; i++) if (works.indexOf(i) >= 0 && rankVal(hole[i]) === k[0]) key.push(i);
    for (const c of board) if (inBest(c) && rankVal(c) === k[0]) boardKey++;
  } else if (ranks) {
    for (let i = 0; i < hole.length; i++) if (works.indexOf(i) >= 0 && ranks.indexOf(rankVal(hole[i])) >= 0) key.push(i);
    for (const c of board) if (inBest(c) && ranks.indexOf(rankVal(c)) >= 0) boardKey++;
  }
  return { score: ev.score, cat, name: scoreName(ev.score), top: k[0], works, key, boardKey };
}

/* ---------- the two draws worth naming ----------------------------------
   Before the last card comes out, the question is not only what you hold but
   what you are DRAWING to: four of a suit, or four ranks inside a five-rank
   window. Either is reported only when at least one of the cards in the draw
   is one of YOURS -- a four-flush the board dealt itself is not something you
   did. Call it for the flop and the turn; on the river nothing is left to
   come.

   The straight scan counts DISTINCT ranks held inside each five-rank window
   (A-2-3-4-5 is one, so the wheel turns up too) and keeps the windows that
   are exactly one short; the missing rank (or the two of them, which is the
   difference between an open-ender and a gutshot said in plain words) is
   what completes it. */
export function draws(hole, board) {
  const out = [];
  if (board.length < 3 || board.length >= 5) return out;
  const seen = hole.concat(board);
  const bySuit = [0, 0, 0, 0];
  for (const c of seen) bySuit[c.s]++;
  const suitHole = [0, 0, 0, 0];
  for (const c of hole) suitHole[c.s]++;
  for (let s = 0; s < 4; s++) if (bySuit[s] === 4 && suitHole[s] > 0) out.push({ kind: "flush", suit: s });

  const have = new Set();
  for (const c of seen) have.add(rankVal(c));
  const mine = new Set();
  for (const c of hole) mine.add(rankVal(c));
  const windows = [[14, 2, 3, 4, 5]];
  for (let lo = 2; lo <= 10; lo++) windows.push([lo, lo + 1, lo + 2, lo + 3, lo + 4]);
  const need = new Set();
  for (const w of windows) {
    let held = 0, missing = 0, yours = false;
    for (const v of w) {
      if (have.has(v)) { held++; if (mine.has(v)) yours = true; }
      else missing = v;
    }
    if (held === 4 && yours) need.add(missing);
  }
  if (need.size) out.push({ kind: "straight", ranks: [...need].sort((a, b) => a - b) });
  return out;
}

/* ---------- the helper's sentence ---------------------------------------
   `readHole` and `draws` say what the cards mean; this says it in English.
   The chip's original complaint -- "it told me pair of sixes, how is that a
   helping hand for me? I could not have used my cards for that" -- was a
   matter of ATTRIBUTION: a hand's name on its own reads as yours, when the
   pair showing may be the table's and your two may be nothing but kickers.
   So every sentence names the hand and then says WHOSE it is -- yours,
   yours with the board, or the board's -- and names your cards doing it.

   `kind` is what colours the chip: "yours" (your cards make the hand),
   "part" (you share it with the board, or are live drawing to it), "board"
   (it is the table's and you have nothing in it), "wait" (no verdict to
   give), "fold". `mine` is the hole-card indices to ring.
   ------------------------------------------------------------------------ */
export const SUIT_WORD = ["spades", "hearts", "diamonds", "clubs"];
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function readout(hole, board, folded) {
  if (folded) return { kind: "fold", mine: [], text: "You folded \u2014 your cards are out of it.", draw: "" };

  /* preflop: two cards and no board, so all there is to say is what they are */
  if (board.length < 3) {
    const [a, b] = hole;
    if (a.r === b.r) {
      return { kind: "yours", mine: [0, 1], draw: "", text: "You start with a pair of " + RP[RV[a.r]] + "." };
    }
    const hi = RV[a.r] >= RV[b.r] ? a : b;
    return { kind: "wait", mine: [], draw: "",
      text: RN[RV[hi.r]] + "-high" + (a.s === b.s ? ", both " + SUIT_WORD[a.s] : "") + " \u2014 no pair yet." };
  }

  const r = readHole(hole, board);
  const yet = board.length < 5 ? " yet" : "";
  const mineTxt = r.key.map((i) => cardText(hole[i]));
  let kind, text;
  if (!r.works.length) {
    /* the five on the table are the whole hand: your two add nothing */
    kind = "board";
    text = "The board plays itself \u2014 neither of your cards is in the five.";
  } else if (r.cat === CAT.HIGH) {
    kind = "wait";
    text = r.key.length
      ? "No pair" + yet + " \u2014 your " + mineTxt[0] + " is the high card."
      : "No pair" + yet + " \u2014 the board's " + RN[r.top] + " is high.";
  } else if (r.cat === CAT.FLUSH || r.cat === CAT.STRAIGHT || r.cat === CAT.STRAIGHT_FLUSH) {
    /* a flush or a straight is five cards all doing the same thing, so the
       honest answer is which of the five are yours, not who "made" it */
    if (r.key.length) {
      kind = "part";
      text = r.name + " \u2014 your " + mineTxt.join(" ") + (r.key.length > 1 ? " are" : " is") + " in it.";
    } else {
      kind = "board";
      text = "The board's " + lower(r.name) + " \u2014 neither of your cards is in it.";
    }
  } else {
    /* a pair-shaped hand has a rank that defines it, so say whether that rank
       is yours, shared, or the table's */
    const verb = r.key.length > 1 ? "make" : "makes";
    if (r.key.length && !r.boardKey) {
      kind = "yours";
      text = r.name + " \u2014 your " + mineTxt.join(" ") + " " + verb + " it.";
    } else if (r.key.length) {
      kind = "part";
      text = r.name + " \u2014 your " + mineTxt.join(" ") + " " + verb + " it with the board.";
    } else {
      kind = "board";
      text = "The board's " + lower(r.name) + " \u2014 your cards are only kickers.";
    }
  }

  /* what you are drawing to, while there is still a card to come */
  let draw = "";
  if (r.cat < CAT.STRAIGHT && board.length < 5) {
    const ds = draws(hole, board);
    const d = ds.find((x) => x.kind === "flush") || ds[0];
    if (d && d.kind === "flush") {
      draw = "Four " + SUIT_WORD[d.suit] + " \u2014 one more makes a flush.";
    } else if (d) {
      draw = "Four to a straight \u2014 " + d.ranks.map((v) => "a " + RN[v]).join(" or ") + " makes it.";
    }
    /* a live draw off a hand that is otherwise the board's is something of
       yours after all, so it lifts the chip out of the "nothing for you" red */
    if (draw && kind === "board") kind = "part";
  }
  return { kind, mine: r.key, text, draw };
}

/* ---------- equity ------------------------------------------------------ *
   Monte Carlo against `nOpp` random hands: deal the board out and then each
   opponent's hole cards from the unseen deck, and count. Ties split, so a
   tie against one opponent is worth half a win. Sampling is without
   replacement (a partial Fisher-Yates on the live deck), so nobody can be
   dealt a card that is already out. */
const ALL = makeDeck();
export function equity(hole, board, nOpp, iters, rng = Math.random) {
  if (nOpp <= 0) return 1;
  const mark = new Uint8Array(52);
  for (const c of hole) mark[cardId(c)] = 1;
  for (const c of board) mark[cardId(c)] = 1;
  const rest = [];
  for (const c of ALL) if (!mark[cardId(c)]) rest.push(c);
  const bn = 5 - board.length;
  const need = nOpp * 2 + bn;
  const n = rest.length;
  const full = [board[0], board[1], board[2], board[3], board[4]];
  let wins = 0, ties = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + ((rng() * (n - i)) | 0);
      const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
    }
    for (let i = 0; i < bn; i++) full[board.length + i] = rest[i];
    full[5] = hole[0]; full[6] = hole[1];
    const hero = evalScore(full);
    let equal = 0, beaten = false;
    for (let o = 0; o < nOpp; o++) {
      const i0 = bn + o * 2;
      full[5] = rest[i0]; full[6] = rest[i0 + 1];
      const s = evalScore(full);
      if (s > hero) { beaten = true; break; }
      if (s === hero) equal++;
    }
    if (beaten) continue;
    if (equal) ties += 1 / (equal + 1);
    else wins++;
  }
  return (wins + ties) / iters;
}

/* ---------- preflop chart ---------------------------------------------- *
   169 starting hands against 1, 2 or 3 random hands, precomputed so a bot
   never rolls dice for its opening range and so the reference policy is
   the same on every run. Stored as 169 x 3 unsigned 16-bit equities in one
   base64 string; `buildPreflopTable()` below is the recipe that made it and
   can be re-run at any time (see DEV-NOTES.md).

   The grid is the usual 13x13 chart: cell (hi, lo) holds the SUITED hand
   (A-Ks at (12,11)), cell (lo, hi) the OFFSUIT one, and the diagonal (i,i)
   a pair. */
const PREFLOP_B64 =
  "p4HAS4E4YVOZMpQjZVRBM78mqViWNpkpQFa8NKsku1YVNBcl9V+yN0Im7mVqO5EpSGrbP6UtQnHWRBEvR3ilSFcyD4L4UB05" +
  "TouAWRVBZFs8PBUtKouLV0g7yVsaOhsqKV01PM0rV1wpOu0qQF8ZOekplmBiOFwn22Y4PZ0qfWtbQUIuq3MKR9Axynx7THc0" +
  "lIJzUGw6Z4/4W9VAPmBGPwIwMmIIRPsyWJIRXudC5F8yQXcwbWDWQPstJ2I6P9ssm2M1QA0ug2hcPXor7G4hQhYwUnUVSB8z" +
  "r31PTrs20oSpUnw+SJJsXgVFjGEBQ2syomaURW80MWjyS+U5yZtjZoVK5mbVRcg0UmkiQgEypWrFQ7YwDG5zREIyDHJ5Qx0x" +
  "eHjwTA80qH+fUBA5q4irVxc+r5FyYMRG5mLHPccwY2UURPczgWoUSIQ4g23jTH087qL6blFRrmsYSWA2JG1YSjQ3unFOSnQ1" +
  "iXU9StA2yXviS583+4E3U8A7fIpnWeA/8pNWYgpHpGFbQBQuJWcdQ7ozA20QSWo3jnBDTtI7YHLHUeQ/oanlditXgXGvTro6" +
  "f3bXTSg6mHgKUE4584DVUqk6KoN4VdE7p42IXmJBT5WiZbRJzmckQNUxO2eJQ1oyp211SHE2xHAWTMM6BnWJVBlBJHlzV6RD" +
  "j7KXgWJhXnotU0pAh3/ZVJZAM4PQVadAmYkUWiJB4Y98X/tEgJlNaHFODm0BRMEzHG5ZR382a3G7SGU3vnPdTXc70ngOUTlA" +
  "uH4zVxtF7IMyXFNKnri6iVdo1INoXA1Fz4iYXY5I7o0wX+dI1JQLZGhL2J2SaNNQ7nHwSH02CHVVTOQ58XXRTsQ4BXjZTyU8" +
  "d3tiVMlAX4AnWcpDMYV1XgNL4YtqZHlNKr/fkvh0G4x5ZeFNoZCTZmFPNpiYaR1Uo6DpcHNXw3c/TGM63npTTyc84nz3UtY9" +
  "BYA3VDE9HIJYVZE/1ISJWstFwol9X4dLLpD8ZX9PNZP2azpXhsbBmqB6lJWbaetTOpqZbjtWd6Nvc5laE4GKU7s+EoN2VctB" +
  "R4VrV4BBWIZWWDxB44r7W81EooqUXmdGd486YuZLb5R5ZklSh5ZLcYhZ9JohcJBY2ctFpoeIBZz2cFBbLqSKeJldYYfvWK9C" +
  "a4rIWz1Et40KXSNHw47oYE9H8pDKYUZMEZIlZdJKxJR9aKxN35jEaehSMZwVc4Baa6EIdM1eTqMre45hu9O2sFOVw6Z2e6tj" +
  "LJLFY1BJfpZuZWROgpe8aKtPI5hoasVOrJlLaXhQpZ6JauhQrZ6yboxU0qHbcXtYKqfpeCtfjKalevFg7Krrf7Bk2atygmhr" +
  "sto2vPii";

const tableIdx = (() => {
  const m = new Int32Array(169).fill(-1);
  for (let a = 0; a < 13; a++) for (let b = 0; b < 13; b++) {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    m[a * 13 + b] = hi * 13 + lo;   // suited (or pair on the diagonal)
    m[b * 13 + a] = lo * 13 + hi;   // offsuit mirror
  }
  return m;
})();

export function handCell(hole) {
  const a = RI[hole[0].r], b = RI[hole[1].r];
  if (a === b) return a * 13 + a;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const suited = hole[0].s === hole[1].s;
  return suited ? hi * 13 + lo : lo * 13 + hi;
}

let preflop = null;
function loadPreflop() {
  if (preflop) return preflop;
  preflop = new Float32Array(169 * 3);
  if (!PREFLOP_B64) { preflop.fill(-1); return preflop; }
  const bin = (typeof atob === "function")
    ? atob(PREFLOP_B64)
    : Buffer.from(PREFLOP_B64, "base64").toString("binary");
  for (let i = 0; i < 169 * 3; i++) {
    const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1);
    preflop[i] = (hi * 256 + lo) / 65535;
  }
  return preflop;
}

export function preflopEquity(hole, nOpp, rng) {
  const t = loadPreflop();
  const i = handCell(hole) * 3 + Math.max(0, Math.min(2, nOpp - 1));
  if (t[i] >= 0) return t[i];
  /* no chart yet (a test run): fall back to a healthy Monte Carlo */
  return equity(hole, [], nOpp, 240, rng || Math.random);
}

/* The recipe. Run this once and paste the base64 into PREFLOP_B64 above -
   `node -e` style, or in the editor: open the page and evaluate
   `[...holdemMath.buildPreflopTable(12000, holdemMath.seededRng(7))]
    .map(b=>String.fromCharCode(b)).join('')` through btoa. The banner in
   DEV-NOTES.md has the exact one-liner. */
export function buildPreflopTable(iters, rng) {
  const out = new Uint8Array(169 * 3 * 2);
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const cell = row * 13 + col;
      let hole;
      if (row === col) hole = [{ r: RANKS[row], s: 0 }, { r: RANKS[row], s: 1 }];
      else if (row > col) hole = [{ r: RANKS[row], s: 0 }, { r: RANKS[col], s: 0 }];   // suited
      else hole = [{ r: RANKS[col], s: 0 }, { r: RANKS[row], s: 1 }];                 // offsuit
      for (let o = 1; o <= 3; o++) {
        const e = equity(hole, [], o, iters, rng);
        const v = Math.max(0, Math.min(65535, Math.round(e * 65535)));
        const i = (cell * 3 + (o - 1)) * 2;
        out[i] = v & 255; out[i + 1] = v >> 8;
      }
    }
  }
  return out;
}

/* ---------- the betting engine ----------------------------------------- *
   h = {
     seats: [{ i, name, stack, bet, potted, folded, allIn, acted, hole[], style }],
     board: [cards], deck: [cards], button, sb, bb,
     street, currentBet, minRaise, raises, aggressor, order, pos,
     done, result, log[]
   }

   `bet` is what a seat has in front of it on THIS street, `potted` what it
   put in on earlier ones, so the pot at any moment is sum(bet) + sum(potted)
   - derived, never stored, which is what makes the chip-conservation check
   in the harness a real test.

   Invariant (the thing the harness asserts every single step):
     sum(stack + bet + potted) + seats * fee === sum(buyIns)
   */

const EPS = 1e-9;

export function createHand(cfg) {
  const rng = cfg.rng || Math.random;
  const seatsIn = cfg.stacks;
  const n = seatsIn.length;
  /* the seat charge can differ per seat: the casino's "luck" perk gives the
     hero a discount on *their own* seat charge (see the header comment), and
     everything downstream just reads the per-seat number. */
  const fees = seatsIn.map((_, i) => {
    if (cfg.fees) return cfg.fees[i] || 0;
    return cfg.fee || 0;
  });
  const deck = shuffle(makeDeck(), rng);
  const deckCards = deck.slice(0, n * 2 + 5);
  const boardCards = deckCards.slice(n * 2, n * 2 + 5);
  const seats = seatsIn.map((buyIn, i) => ({
    i,
    name: (cfg.names && cfg.names[i]) || ("Seat " + i),
    style: (cfg.styles && cfg.styles[i]) || null,
    fee: fees[i],
    stack: buyIn - fees[i],
    bet: 0,
    potted: 0,
    folded: false,
    allIn: false,
    acted: false,
    hole: [deckCards[i * 2], deckCards[i * 2 + 1]],
    won: 0,
  }));
  const h = {
    seats,
    board: [],
    holeBoard: boardCards,
    button: cfg.button % n,
    sb: cfg.sb,
    bb: cfg.bb,
    fees,
    buyIns: seatsIn.slice(),
    street: "preflop",
    currentBet: 0,
    minRaise: cfg.bb,
    raises: 0,
    aggressor: -1,
    order: [],
    pos: 0,
    done: false,
    result: null,
    rng,
    log: [],
  };
  /* blinds: the seat after the button is the small blind and the next one the
     big blind. With two players that lands the small blind on the button,
     which is exactly how heads-up poker is played. */
  if (n > 1) {
    const sbSeat = (h.button + 1) % n;
    const bbSeat = (h.button + 2) % n;
    post(h, sbSeat, Math.min(cfg.sb, seats[sbSeat].stack));
    post(h, bbSeat, Math.min(cfg.bb, seats[bbSeat].stack));
    h.currentBet = Math.max(seats[sbSeat].bet, seats[bbSeat].bet);
    startRound(h, (h.button + 3) % n);
  }
  return h;
}

function post(h, seat, amount) {
  const s = h.seats[seat];
  const amt = Math.max(0, Math.min(amount, s.stack));
  s.stack -= amt;
  s.bet += amt;
  if (s.stack <= EPS) s.allIn = true;
  h.log.push({ t: "post", seat, amount: amt });
  return amt;
}

export function potSize(h) {
  let p = 0;
  for (const s of h.seats) p += s.bet + s.potted;
  return p;
}
/* chips still on the table plus the house's fee - the conservation check */
export function chipTotal(h) {
  let t = 0;
  for (const s of h.seats) t += s.stack + s.bet + s.potted;
  return t;
}

function actOrderFrom(h, start) {
  const n = h.seats.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const s = h.seats[i];
    if (!s.folded && !s.allIn) out.push(i);
  }
  return out;
}

function startRound(h, first) {
  h.order = actOrderFrom(h, first);
  h.pos = 0;
  for (const s of h.seats) s.acted = false;
}

export function nextToAct(h) {
  if (h.done) return -1;
  const live = h.seats.filter((s) => !s.folded);
  if (live.length <= 1) return -1;
  const canAct = h.seats.filter((s) => !s.folded && !s.allIn);
  if (canAct.length <= 1) {
    const s = canAct[0];
    if (!s) return -1;
    return s.bet < h.currentBet - EPS ? s.i : -1;
  }
  const len = h.order.length;
  for (let k = 0; k < len; k++) {
    const idx = (h.pos + k) % len;
    const s = h.seats[h.order[idx]];
    if (s.folded || s.allIn) continue;
    if (!s.acted || s.bet < h.currentBet - EPS) { h.pos = idx; return s.i; }
  }
  return -1;
}

export function legalActions(h) {
  const seat = nextToAct(h);
  if (seat < 0) return null;
  const s = h.seats[seat];
  const toCall = Math.max(0, h.currentBet - s.bet);
  const maxTo = round2(s.bet + s.stack);
  const minTo = round2(Math.min(h.currentBet + h.minRaise, maxTo));
  /* you may only raise if somebody can still answer it: with every other seat
     folded or all-in, the only moves are call and fold */
  const answerable = h.seats.filter((o) => !o.folded && !o.allIn && o.i !== seat).length > 0;
  return {
    seat, toCall: round2(toCall), pot: round2(potSize(h)),
    canCheck: toCall <= EPS,
    canCall: toCall > EPS,
    canRaise: answerable && maxTo > h.currentBet + EPS,
    minRaiseTo: minTo, maxRaiseTo: maxTo,
    allInTo: maxTo,
    stack: round2(s.stack),
  };
}

export function round2(v) { return Math.round(v * 100) / 100; }

/* Apply one action. Returns an event the UI animates from. */
export function act(h, seat, action) {
  const s = h.seats[seat];
  if (!s || s.folded || h.done) return null;
  const la = legalActions(h);
  const toCall = Math.max(0, h.currentBet - s.bet);
  const ev = { seat, type: action.type, street: h.street, amount: 0, allIn: false, to: 0 };

  if (action.type === "fold") {
    s.folded = true;
    s.acted = true;
    ev.amount = 0;
  } else if (action.type === "check") {
    if (toCall > EPS) return act(h, seat, { type: "call" });
    s.acted = true;
  } else if (action.type === "call") {
    const amt = Math.min(toCall, s.stack);
    s.stack -= amt;
    s.bet += amt;
    s.acted = true;
    if (s.stack <= EPS) { s.allIn = true; ev.allIn = true; }
    ev.amount = round2(amt);
  } else if (action.type === "raise") {
    let to = Number(action.to);
    const maxTo = s.bet + s.stack;
    if (!Number.isFinite(to)) to = la ? la.minRaiseTo : maxTo;
    to = round2(Math.max(Math.min(to, maxTo), Math.min(h.currentBet + h.minRaise, maxTo)));
    const amt = to - s.bet;
    if (amt <= EPS) return act(h, seat, { type: "check" });
    s.stack -= amt;
    s.bet = to;
    s.acted = true;
    if (s.stack <= EPS) { s.allIn = true; ev.allIn = true; }
    ev.amount = round2(amt);
    ev.to = round2(to);
    const inc = to - h.currentBet;
    if (inc > EPS) {
      h.raises += 1;
      if (inc >= h.minRaise - EPS) {
        h.minRaise = inc;
        /* a full raise reopens the betting for everyone else */
        for (const o of h.seats) if (o.i !== seat && !o.folded && !o.allIn) o.acted = false;
      }
      h.currentBet = to;
      h.aggressor = seat;
    }
  } else {
    return null;
  }
  h.log.push({ t: "act", seat, kind: ev.type, amount: ev.amount, street: h.street });
  return ev;
}

/* Deal the next street (returns null when the river has been dealt). */
export function advanceStreet(h) {
  const order = ["preflop", "flop", "turn", "river"];
  const at = order.indexOf(h.street);
  if (at < 0 || at >= 3) return null;
  /* everyone's street bet rolls into the pot */
  for (const s of h.seats) { s.potted += s.bet; s.bet = 0; }
  const next = order[at + 1];
  const cards = next === "flop" ? h.holeBoard.slice(0, 3) : [h.holeBoard[next === "turn" ? 3 : 4]];
  for (const c of cards) h.board.push(c);
  h.street = next;
  h.currentBet = 0;
  h.minRaise = h.bb;
  h.raises = 0;
  h.aggressor = -1;
  /* the action starts with the first live seat after the button */
  startRound(h, (h.button + 1) % h.seats.length);
  return { from: order[at], to: next, cards };
}

export function liveSeats(h) { return h.seats.filter((s) => !s.folded); }

export function isOver(h) {
  if (h.done) return true;
  if (liveSeats(h).length <= 1) return true;
  if (h.street === "river" && nextToAct(h) < 0) return true;
  return false;
}

/* One step of the game: whose turn it is, or a street, or the end. The UI
   loops on this and only needs to await the human on a "turn" event. */
export function nextStep(h) {
  if (isOver(h)) { settle(h); return { type: "end", result: h.result }; }
  const seat = nextToAct(h);
  if (seat >= 0) return { type: "turn", seat, legal: legalActions(h) };
  const ev = advanceStreet(h);
  if (ev) return { type: "street", ...ev };
  settle(h);
  return { type: "end", result: h.result };
}

/* ---------- showdown / payout ------------------------------------------ *
   Side pots fall out of the contribution column: cut it at every distinct
   contribution level, and each slice is a pot whose contenders are the live
   seats that reached that level. A slice with a single contributor is an
   unmatched bet coming straight back to them - which is also what returns
   the over-bet when a short stack calls all-in for less. */
export function settle(h) {
  if (h.result) return h.result;
  const n = h.seats.length;
  const contrib = (s) => round2(s.bet + s.potted);
  const levels = [...new Set(h.seats.map(contrib).filter((v) => v > EPS))].sort((a, b) => a - b);
  const live = liveSeats(h);
  const scores = h.seats.map((s) => (s.folded || s.hole.length < 2 || h.board.length < 5)
    ? null : evaluate(s.hole.concat(h.board)).score);
  const payouts = new Array(n).fill(0);
  const winners = new Set();
  const pots = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    const contributors = [];
    for (const s of h.seats) {
      const c = Math.min(contrib(s), lv) - Math.min(contrib(s), prev);
      if (c > EPS) { amount += c; contributors.push(s); }
    }
    prev = lv;
    if (amount <= EPS) continue;
    let take = null;
    if (contributors.length === 1) {
      take = contributors[0];            // unmatched: comes back, uncalled
    } else {
      const contenders = contributors.filter((s) => !s.folded);
      if (contenders.length === 1) {
        take = contenders[0];
      } else if (contenders.length > 1) {
        let best = -1;
        for (const s of contenders) if (scores[s.i] > best) best = scores[s.i];
        const tied = contenders.filter((s) => scores[s.i] === best);
        /* An odd number of cents does not divide. Floor each share to the cent
           and hand the leftover cents out one at a time (the dealer's "odd chip"
           rule) instead of rounding each share independently, which would mint
           or burn a cent on every split pot and quietly bias the table. */
        const cents = Math.round(amount * 100);
        const base = Math.floor(cents / tied.length);
        let odd = cents - base * tied.length;
        for (const t of tied) {
          let c = base;
          if (odd > 0) { c += 1; odd -= 1; }
          payouts[t.i] += c / 100;
          winners.add(t.i);
        }
        pots.push({ amount: round2(amount), winners: tied.map((s) => s.i), showdown: true });
        continue;
      } else {
        /* impossible in a legal hand (the biggest contributor is always live),
           but never lose chips over it: hand it to the last live seat */
        take = live[0] || h.seats[0];
      }
    }
    payouts[take.i] += amount;
    if (contributors.length > 1) winners.add(take.i);
    pots.push({ amount: round2(amount), winners: [take.i], showdown: contributors.length > 1 });
  }
  for (const s of h.seats) {
    const p = Math.round(payouts[s.i] * 100) / 100;
    s.stack = Math.round((s.stack + p) * 100) / 100;
    s.won = p;
    /* the pot has been paid out: take it off the table so the chips in front
       of the seats are the whole of it from here on */
    s.bet = 0;
    s.potted = 0;
  }
  const showdown = live.length > 1 ? live.map((s) => ({
    seat: s.i, hole: s.hole.slice(), score: scores[s.i],
    name: scores[s.i] === null ? "" : scoreName(scores[s.i]),
    best: scores[s.i] === null ? [] : evaluate(s.hole.concat(h.board)).best,
  })) : [];
  h.done = true;
  h.result = {
    pots,
    payouts: payouts.map((p) => Math.round(p * 100) / 100),
    winners: [...winners],
    showdown,
    board: h.board.slice(),
    foldedAll: live.length <= 1,
    winner: winners.size ? [...winners][0] : (live[0] ? live[0].i : -1),
  };
  return h.result;
}

/* ---------- the bot policy --------------------------------------------- *
   Styles are drawn around a neutral centre and describe HOW a seat plays,
   not how well: a tight seat needs a better price, a loose one calls wider,
   an aggressive one bets more often and bigger, and `bluff` is the chance
   to fire with nothing. Every seat at the table - the bots AND the seat the
   table plays for you when you are not clicking - draws from this same
   distribution, which is what keeps the game symmetric and the reference
   return exactly `1 - holdemFee`. */
export const HOUSE = { tightness: 0.42, aggression: 0.62, bluff: 0.07 };

function gauss(rng) { return (rng() + rng() + rng() - 1.5) * 2; }   // ~N(0,1)
const clamp01 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const STYLE_WORDS = [
  { t: "tight", a: "aggressive", label: "Tight-Aggressive" },
  { t: "tight", a: "passive", label: "Tight-Passive" },
  { t: "loose", a: "aggressive", label: "Loose-Aggressive" },
  { t: "loose", a: "passive", label: "Loose-Passive" },
];
export function styleLabel(st) {
  const t = st.tightness > 0.46 ? "tight" : st.tightness < 0.34 ? "loose" : "balanced";
  const a = st.aggression > 0.66 ? "aggressive" : st.aggression < 0.5 ? "passive" : "steady";
  return t[0].toUpperCase() + t.slice(1) + "-" + a[0].toUpperCase() + a.slice(1);
}
export function makeStyle(rng) {
  const st = {
    tightness: clamp01(HOUSE.tightness + gauss(rng) * 0.13, 0.08, 0.85),
    aggression: clamp01(HOUSE.aggression + gauss(rng) * 0.14, 0.22, 1),
    bluff: clamp01(HOUSE.bluff + gauss(rng) * 0.045, 0, 0.22),
  };
  st.label = styleLabel(st);
  return st;
}
export { STYLE_WORDS };

/* how many raises this street have already gone in - a raise says the
   raiser's range is better than random, so equity gets taxed for it */
const RAISE_TAX = { preflop: 0.075, flop: 0.06, turn: 0.055, river: 0.05 };

export function strength(h, seat, style, eqIters) {
  const me = h.seats[seat];
  const live = liveSeats(h).length;
  const nOpp = Math.max(1, live - 1);
  const street = h.street;
  let eq;
  if (street === "preflop") {
    eq = preflopEquity(me.hole, nOpp, h.rng);
  } else {
    eq = equity(me.hole, h.board, nOpp, eqIters || 110, h.rng);
  }
  eq -= RAISE_TAX[street] * h.raises;
  const order = h.order;
  const last = order.length ? order[order.length - 1] : -1;
  const first = order.length ? order[0] : -1;
  if (seat === last) eq += 0.022;
  else if (seat === first) eq -= 0.012;
  return Math.max(0, Math.min(1, eq));
}

function betSize(h, seat, la, kind, style) {
  const rng = h.rng;
  const pot = potSize(h);
  const bb = h.bb;
  let to;
  if (h.street === "preflop") {
    if (h.currentBet <= bb + EPS) to = bb * (2.4 + rng() * 1.2);          // open
    else to = h.currentBet * (2.5 + rng() * 0.9);                          // 3-bet
  } else {
    const frac = kind === "bluff" ? 0.45 + rng() * 0.2 : 0.5 + rng() * 0.3;
    to = h.currentBet + Math.max(bb, pot * frac);
  }
  to = round2(to);
  if (to >= la.maxRaiseTo * 0.82) return la.maxRaiseTo;   // just shove it
  return Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, to));
}

/* Decide for one seat. `tilt` is the mistake chance (the admin rig and the
   luck discount never touch the deal, so it is the only thing that can make
   a bot blunder - it ships at 0). */
export function decide(h, seat, style, opts) {
  const rng = h.rng;
  const st = style || HOUSE;
  const la = legalActions(h);
  if (!la) return { type: "check" };
  const optsIn = opts || {};
  const toCall = la.toCall;
  const pot = la.pot;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const eq = strength(h, seat, st, optsIn.eqIters);

  if (optsIn.tilt && rng() < optsIn.tilt) {
    /* a blunder: pick something plausible instead of the right thing */
    const roll = rng();
    if (toCall > 0) {
      if (roll < 0.45) return { type: "call" };
      if (roll < 0.8) return { type: "fold" };
    } else if (roll < 0.5) return { type: "check" };
    if (la.canRaise) return { type: "raise", to: betSize(h, seat, la, "value", st) };
    return { type: toCall > 0 ? "call" : "check" };
  }

  /* price of a call: needs to beat the pot odds by a margin that grows with
     how tight the seat is; position loosens it a little */
  const margin = 0.015 + st.tightness * 0.11 - (seat === h.order[h.order.length - 1] ? 0.03 : 0);
  const valueRaise = eq > 0.58 + st.tightness * 0.16;

  if (toCall <= EPS) {
    /* nothing to call: check, value-bet, or take a shot */
    if (valueRaise && la.canRaise && rng() < 0.35 + st.aggression * 0.5) {
      return { type: "raise", to: betSize(h, seat, la, "value", st) };
    }
    const bluffable = h.street !== "preflop" && eq < 0.42 && la.canRaise;
    if (bluffable && rng() < st.bluff * (h.street === "river" ? 1.4 : 1)) {
      return { type: "raise", to: betSize(h, seat, la, "bluff", st) };
    }
    return { type: "check" };
  }

  if (eq < potOdds + margin) {
    /* too expensive - but a big hand facing a small price still calls */
    if (eq > 0.62 && potOdds < 0.2 && rng() < 0.5) return { type: "call" };
    return { type: "fold" };
  }
  if (valueRaise && la.canRaise && rng() < 0.25 + st.aggression * 0.55) {
    return { type: "raise", to: betSize(h, seat, la, "value", st) };
  }
  if (eq < 0.5 && h.street !== "preflop" && la.canRaise && rng() < st.bluff * 0.5) {
    return { type: "raise", to: betSize(h, seat, la, "bluff", st) };
  }
  return { type: "call" };
}

/* ---------- headless hand (the harness' entry point) ------------------- */
export function playHand(cfg) {
  const h = createHand(cfg);
  let guard = 0;
  while (!h.done && guard++ < 400) {
    const st = nextStep(h);
    if (st.type !== "turn") continue;
    act(h, st.seat, decide(h, st.seat, h.seats[st.seat].style, cfg.decideOpts));
  }
  if (!h.done) settle(h);
  return h;
}
