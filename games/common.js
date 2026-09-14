import { el } from "../ui.js";

export function stageShell(title, blurb, opts, ...kids) {
  const o = opts && opts.info !== undefined ? opts : null;
  if (!o && opts !== undefined && opts !== null) kids.unshift(opts);
  return el(
    "div",
    { class: "stage-inner" },
    el("div", { class: "stage-title" },
      el("h2", { text: title }),
      el("div", { class: "stage-side" },
        blurb ? el("p", { text: blurb }) : null,
        o ? o.info : null
      )
    ),
    ...kids
  );
}

export function weightedPickIndex(weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ---------- spin motion blur ----------------------------------------------
   The drums glide on a cubic-bezier(.14,.72,.12,1) transform. We sample that same
   curve to get each strip's instantaneous speed and blur it in proportion, so the
   symbols are unreadable while a drum races and snap into focus as it slows to a
   stop. */
export const SPIN_EASE_CSS = "cubic-bezier(.14,.72,.12,1)";

export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sy(t);
  };
}

export const SPIN_EASE = cubicBezier(0.14, 0.72, 0.12, 1);
export const SPIN_PEAK = 0.72 / 0.14;
export const BLUR_TICK = 33;

export function spinBlur(t, maxBlur) {
  if (t >= 1) return 0;
  const dt = 0.006;
  const lo = Math.max(0, t - dt);
  const hi = Math.min(1, t + dt);
  const speed = (SPIN_EASE(hi) - SPIN_EASE(lo)) / (hi - lo);
  const rel = Math.max(0, Math.min(1, speed / SPIN_PEAK));
  return maxBlur * Math.sqrt(rel);
}

export function randInt(n) { return Math.floor(Math.random() * (n + 1)); }

/* ---------- reel settle ("detent" bounce) --------------------------------
   The smooth transform stops a few px short of the payline; the settle animation
   overshoots, rebounds, then drops hard onto the mark and sticks. The .settle
   keyframes read these per-strip custom properties, so the distances follow the cell
   size of whichever machine is using them. */
export const SETTLE_MS = 470;

export function settleOffset(cellH) { return Math.max(4, Math.min(16, cellH * 0.12)); }

export function setSettleVars(strip, landY, over) {
  strip.style.setProperty("--sy", landY + "px");
  strip.style.setProperty("--sy1", (landY - over) + "px");
  strip.style.setProperty("--sy2", (landY + over * 0.55) + "px");
  strip.style.setProperty("--sy3", (landY - over * 0.28) + "px");
}

export function beginSettle(strip) {
  strip.classList.remove("settle");
  void strip.offsetWidth;
  strip.classList.add("settle");
}

export function endSettle(strip, landY) {
  strip.classList.remove("settle");
  strip.style.transition = "none";
  strip.style.transform = "translateY(" + landY + "px)";
}

export function clearSettle(strip) {
  if (strip) strip.classList.remove("settle");
}

export function setupCanvas(canvas, box) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = box.clientWidth || 300;
  const cssH = canvas.dataset.cssh ? Number(canvas.dataset.cssh) : null;
  const h = cssH || Math.round(w * (Number(canvas.dataset.ar) || 1));
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}
