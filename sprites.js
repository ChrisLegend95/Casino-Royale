/* =========================================================
   Sprite artwork — the symbols the machines show the player.

   \`src/sprites/\` holds one PNG per symbol (see sprites/README.md for the
   full name table and how the sheet was cut). This module is the only
   place that knows where those files live and how big they are, so a game
   asks for artwork by NAME and never builds a path itself.

   Two things make the files not directly interchangeable, and both are
   handled here:

   1. Every file is a 148x148 canvas with the artwork tight-cropped and
      centred inside it, so a crown (122x100 of art) and a coin (95x97)
      fill different fractions of their canvas. \`BOX\` below records each
      sprite's real art size, and every <img> gets \`--sp-k = 148 / the
      art's LONGEST side\` written on it. The container sets \`--sp-base\`
      (how big it wants the ARTWORK), \`.spr\` in styles.css keeps the
      image BOX square at exactly \`--sp-base\` and scales the image by
      \`--sp-k\`, and the art therefore lands inside a \`--sp-base\` square,
      centred, at the same visual size as every other symbol whatever
      shape its own file's crop happens to be.

      The box stays \`--sp-base\` (rather than growing with the crop, the
      way it used to) because an image bigger than the cell it sits in no
      longer has a centre to align to: grid/flex centring pushes an
      overflowing child to one edge instead, which is what used to make
      the wide sprites sit off-centre and crowd the cell border. A
      transform is painted, not laid out, so the cell sees a box that
      fits and every symbol stays dead centre.

   2. The art is resolved RELATIVE TO THIS FILE, so the same code works in
      both places this project is served from: on Perchance the page lives
      at /<name> and the module at /src/sprites.js (-> /src/sprites/*.png),
      while on the GitHub Pages mirror the \`src/\` prefix is stripped
      (DEPLOY.md) so the module sits at /sprites.js (-> /sprites/*.png).

   If a file is missing (a partial mirror upload, say), the <img> swaps
   itself for the plain-text glyph it was given as \`fallback\`, so a game
   degrades to its old emoji look instead of showing broken images.
   ========================================================= */

/* the canvas every sprite file is drawn on (see sprites/README.md) */
const CANVAS = 148;

/* where the files live — relative to THIS module, which is what makes the
   same code work on Perchance (/src/sprites.js -> /src/sprites/*.png) and
   on the GitHub Pages mirror (/sprites.js -> /sprites/*.png, src/ stripped) */
const SPRITE_DIR = new URL("sprites/", import.meta.url);

/* art size [width, height] of each sprite inside its canvas, measured from
   the alpha channel when the sheet was cut. Order runs across the sheet. */
const BOX = {
  "crown": [122, 100], "seven": [112, 99], "cherry": [103, 104], "bell": [89, 99],
  "watermelon": [110, 104], "grapes": [97, 104], "lemon": [89, 90], "orange": [102, 103],
  "plum": [90, 101], "diamond": [108, 100], "joker": [121, 107], "skull": [108, 122],
  "coin": [95, 97], "cash": [112, 105], "gold-bar": [108, 88], "dice": [92, 98],
  "horseshoe": [96, 98], "clover": [91, 99], "star": [98, 95], "hot-seven": [106, 114],
  "shark": [121, 100], "duck": [108, 111], "cat": [105, 104], "pig": [103, 97],
  "panda": [101, 102], "wolf": [102, 112], "tiger": [107, 109], "eagle": [102, 103],
  "bear": [104, 105], "lion": [104, 113], "rocket": [101, 109], "ufo": [125, 90],
  "bomb": [96, 108], "lightning": [73, 94], "magnet": [95, 98], "portal": [108, 106],
  "tornado": [110, 108], "meteor": [114, 108], "treasure": [101, 96], "boss": [105, 101],
  "wheel": [95, 97], "slot-machine": [123, 109], "key": [101, 100], "map": [114, 96],
  "scroll": [96, 94], "mystery": [96, 100], "orb": [87, 102], "trophy": [96, 97],
  "gift": [94, 95], "heart": [113, 85], "wild": [118, 94], "bonus": [114, 92],
  "jackpot": [131, 85], "x2": [94, 81], "x3": [97, 83], "x5": [98, 84],
  "free-spins": [122, 93], "chaos": [107, 94], "reset": [87, 85], "unknown": [98, 95],
  "casino": [104, 86], "cloud": [112, 67], "explosion": [96, 80], "coins": [81, 70],
  "gems": [98, 70], "water": [87, 82], "fire": [70, 81], "smoke": [99, 79],
  "vortex": [98, 83], "skull-crown": [55, 84],
};

export const SPRITE_NAMES = Object.keys(BOX);

const known = new Set(SPRITE_NAMES);
export function hasSprite(name) {
  return known.has(name);
}

/* both of these are lazy: nothing is fetched until a sprite is used */
const urls = new Map();
const scaling = new Map();

export function spriteUrl(name) {
  let u = urls.get(name);
  if (u === undefined) {
    if (!known.has(name)) console.warn("sprites.js: no artwork called '" + name + "'");
    u = new URL(name + ".png", SPRITE_DIR).href;
    urls.set(name, u);
  }
  return u;
}

/* how much the 148px image is scaled up inside its \`--sp-base\` box so the
   artwork itself comes out \`--sp-base\` across its longest side (and short
   of it on the other axis). Square art scales by ~1, a wide crop by more. */
function scaleOf(name) {
  const b = BOX[name];
  if (!b) return 1;
  return CANVAS / Math.max(b[0], b[1]);
}

export function spriteBox(name) {
  const b = BOX[name];
  return b ? { w: b[0], h: b[1] } : null;
}

/* an <img> for one sprite. opts:
     base     — CSS length for the artwork (defaults to the container's --sp-base)
     fallback — text (the old glyph) to show if the file cannot be loaded
     cls      — extra class names
     alt      — alt text; empty by default, because every sprite on screen is
                already labelled by the number or word next to it */
export function spriteEl(name, opts = {}) {
  const img = document.createElement("img");
  img.className = "spr" + (opts.cls ? " " + opts.cls : "");
  img.src = spriteUrl(name);
  img.alt = opts.alt === undefined ? "" : opts.alt;
  img.draggable = false;
  img.decoding = "async";
  img.style.setProperty("--sp-k", scaleOf(name).toFixed(4));
  if (opts.base) img.style.setProperty("--sp-base", typeof opts.base === "number" ? opts.base + "px" : opts.base);
  if (opts.fallback) {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "spr-fallback";
      span.textContent = opts.fallback;
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    });
  }
  return img;
}

/* a row of sprites (a payline result, a spin's outcome). items are names;
   opts is passed through to spriteEl, so \`base\` sizes the whole row. */
export function spriteRow(items, opts = {}) {
  const wrap = document.createElement("span");
  wrap.className = "spr-row" + (opts.cls ? " " + opts.cls : "");
  for (const it of items) {
    wrap.appendChild(typeof it === "string" ? spriteEl(it, opts) : spriteEl(it.name, Object.assign({}, opts, it)));
  }
  return wrap;
}

/* the same sprite as inline markup, for the info cards and payout notes,
   which are written as html strings. Sized to the text it sits in by
   default, so a symbol reads as part of the sentence. */
export function spriteHtml(name, opts = {}) {
  const base = opts.base || "1.05em";
  return '<img class="spr spr-inline" src="' + spriteUrl(name) + '" alt="" draggable="false"' +
    ' style="--sp-k:' + scaleOf(name).toFixed(4) + ';--sp-base:' + base + '">';
}

/* Warm the browser's image cache for a machine's symbols before its first
   spin, so a freshly built reel cell paints its artwork on the very first
   frame instead of flashing empty. Resolves when they have all settled
   (loaded or failed) — never rejects. */
const warmed = new Map();
export function preloadSprites(names) {
  const jobs = [];
  for (const n of names) {
    if (!known.has(n)) continue;
    let job = warmed.get(n);
    if (!job) {
      job = new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = spriteUrl(n);
      });
      warmed.set(n, job);
    }
    jobs.push(job);
  }
  return Promise.all(jobs);
}
