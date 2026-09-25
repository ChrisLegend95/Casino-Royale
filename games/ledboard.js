import { el, clear } from "../ui.js";
import { on } from "../state.js";

/* =========================================================
   The pit meter -- the readouts the two 5-reel slot cabinets wear
   instead of the printed credit/meter strip a real machine has.

   Each number gets its OWN pod: a panel with its label above the digits and
   its own caption underneath, sitting on a line of its own. They used to
   share one sheet, stacked like two lines of one display, and at a two-digit
   LINES figure sitting over a seven-digit TOTAL the eye read them as a
   single clock -- so every pod is now a window in its own right, with no
   panel around the group at all. The window itself is cut from the casino's
   own navy panel with the gold hairline the rest of the page uses, so a
   readout is not a slab of glass flown in from some other building (the
   first skin was dark green glass with scanlines and a phosphor glow -- a
   CRT clock face, which is the look we are not having).

   Three reasons the board exists at all:

   1. On a multi-line machine the "bet" in the side panel is the money PER
      LINE, and the money actually leaving your pocket is that times the
      number of live lines. The TOTAL pod shows the REAL stake -- the number
      the round will cost -- so there is never any doubt about what a spin is
      about to charge.
   2. The LINES pod shows how many paylines that stake is spread over.
   3. A progressive jackpot meter can live in a pod of its own on a slot
      cabinet (see the jackpot block in src/state.js): the two 5-reel machines
      each keep their OWN bank, so the pod reads that cabinet's pot -- it
      climbs on every LOSING spin OF THIS MACHINE (a win or a push feeds it
      nothing) and empties into whoever lands three jackpot signs anywhere on
      THIS machine's drums. A spin on another cabinet never moves this meter.
      Lucky Sevens carries no pot at all (the player's request: the 3-reel
      machine is the plain one), and it wears **no board at all** -- a second
      reason the player gave: with no pot to window and the stake already on
      the side panel there was nothing on that glass worth saying. So the
      board is the two 5-reel machines' alone, and a pod is only a pot pod
      when the machine says so.
      A pot pod is the same navy window as the
      others, but with a RED rim lit like a neon tube and its digits cut like
      the gem on the drums (a faceted diamond gradient, icy blue), so the one
      number on the meter that is not about your own bet cannot be mistaken
      for one.

   A pod is `{ label, digits, read, caption, jackpot, size }`: the board calls
   `read()` for the number it should show, so it always displays live state
   and needs no push from the machine. Every pod listens on the state bus for
   "jackpot" (fired whenever the pot moves) and the machine calls refresh()
   from its own onBetChange hook, so a line-count change or a spin lands on
   the display immediately.

   The numbers are ordinary text, set in the game's own display face (Bebas
   Neue) in tabular figures and right-aligned, so a climbing total never
   shuffles the digits sideways and the figure reads exactly like the money
   in the top bar -- the same gold, the same glow. (The jackpot's figure is
   filled with a diamond facet gradient instead; see the pit meter block in
   src/styles.css.) (The board used to DRAW them -- seven clip-path bars per
   character, unlit ones dark -- which read as a digital clock rather than a
   number; the pods, the labels and the captions are unchanged.) Each pod
   keeps a min-width of its full digit count so the plate does not twitch as
   the figure grows, and a number too long for the field flips to a compact
   suffix ("1.2M") instead of overflowing.
   ========================================================= */

/* the number as text, plus a compact suffix for the (rare) case where it
   will not fit -- a meter that has run out of digits is worse than one that
   reads "1.2M" */
function formatValue(value, digits) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const cap = Math.pow(10, digits) - 1;
  const group = (n) => n.toLocaleString("en-US");
  if (v <= cap) return { text: group(v), suffix: "" };
  if (v >= 1e9) return { text: group(Math.round(v / 1e9)), suffix: "B" };
  if (v >= 1e6) return { text: group(Math.round(v / 1e6)), suffix: "M" };
  return { text: group(Math.round(v / 1e3)), suffix: "K" };
}

export function createLedBoard(rows) {
  const rowEls = [];

  function drawRow(row, numEl) {
    const { text, suffix } = formatValue(row.read(), row.digits);
    clear(numEl);
    numEl.appendChild(document.createTextNode(text));
    if (suffix) numEl.appendChild(el("span", { class: "led-suf", text: suffix }));
  }

  const pods = rows.map((row) => {
    const numEl = el("div", {
      class: "led-num" + (row.size === "big" ? " big" : ""),
      style: "--led-digits:" + row.digits,
    });
    rowEls.push({ row, numEl });
    return el("div", { class: "ledpod" + (row.jackpot ? " jackpot" : "") + (row.size ? " " + row.size : "") },
      el("div", { class: "led-lab", text: row.label }),
      numEl,
      row.caption ? el("div", { class: "led-cap", text: row.caption }) : null
    );
  });

  const node = el("div", { class: "ledboard" },
    ...pods,
    el("div", { class: "ledboard-foot", text: "PIT METER" })
  );

  function refresh() {
    for (const { row, numEl } of rowEls) {
      try { drawRow(row, numEl); } catch (e) { /* a bad reader must not break the board */ }
    }
  }

  /* the pot moves on its own (every spin feeds it, a hit empties it), so the
     board subscribes rather than waiting to be told */
  const off = on("jackpot", () => refresh());

  refresh();

  return {
    node,
    refresh,
    /* flash a pod's digits -- used when the jackpot lands */
    flash(label) {
      for (const { row, numEl } of rowEls) {
        if (label && row.label !== label) continue;
        numEl.classList.remove("hit");
        void numEl.offsetWidth;
        numEl.classList.add("hit");
        setTimeout(() => numEl.classList.remove("hit"), 2600);
      }
    },
    dispose() { off(); },
  };
}
