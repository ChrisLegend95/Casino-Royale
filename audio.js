/* =========================================================
   audio.js — tiny WebAudio chiptune engine (no asset files).
   Every sound is synthesized from short oscillator blips and
   filtered noise, which keeps the retro arcade character and
   means there is nothing to download.

   The AudioContext is created lazily on the first user gesture
   so browser autoplay policies are respected. Sound can be
   muted from the top bar; the preference persists.
   ========================================================= */

const PREF_KEY = "casino-royale.sound.v1";

let ac = null;
let master = null;
let enabled = true;
let chompFlip = false;
let siren = null;

try {
  if (localStorage.getItem(PREF_KEY) === "0") enabled = false;
} catch (e) { /* storage blocked */ }

function persist() {
  try { localStorage.setItem(PREF_KEY, enabled ? "1" : "0"); } catch (e) { /* ignore */ }
}

function ctx() {
  if (ac) return ac;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.42;
    master.connect(ac.destination);
  } catch (e) { ac = null; }
  return ac;
}

export function unlock() {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
}

export function isEnabled() { return enabled; }

export function setEnabled(v) {
  enabled = !!v;
  persist();
  if (!enabled) stopSiren();
}

export function toggle() { setEnabled(!enabled); return enabled; }

/* ---------- primitives ---------- */
function tone(o) {
  if (!enabled) return;
  const c = ctx(); if (!c) return;
  const {
    freq = 440, dur = 0.12, type = "square", vol = 0.3, slide = null,
    delay = 0, attack = 0.006,
  } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + attack + dur + 0.05);
}

let noiseBuf = null;
function noiseBuffer(c) {
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(c.sampleRate * 0.5);
  noiseBuf = c.createBuffer(1, n, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise(o) {
  if (!enabled) return;
  const c = ctx(); if (!c) return;
  const {
    dur = 0.12, vol = 0.2, freq = 1200, q = 1, delay = 0,
    type = "bandpass", attack = 0.004,
  } = o;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + attack + dur + 0.05);
}

/* ---------- pac-man siren (looping background warble) ---------- */
function stopSiren() {
  if (!siren) return;
  const { osc, g, lfo } = siren;
  siren = null;
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value || 0.0001), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.stop(t + 0.2);
    lfo.stop(t + 0.2);
  } catch (e) { /* already stopped */ }
}

/* ---------- the recorded revolver cylinder ----------
   The revolver's spin is a real recording of a cylinder being spun, kept as an
   asset beside this file (src/audio/revolver-spin.mp3). It is decoded once into
   an AudioBuffer and the drum ANIMATION is driven from it: SPIN_CLICKS_MS is
   the measured time of every chamber clack in the take, and the drum passes
   exactly one chamber each time one of those clacks sounds. The take plays at a
   constant rate chosen so its last clack lands on the end of the spin, so the
   picture and the sound cannot drift apart no matter how long the spin is.

   SPIN_CLICKS_MS was measured off the asset with an energy-envelope onset
   detector (high-passed ~800 Hz, ~1 ms attack / 12 ms release envelope, 2 ms
   hop, adaptive threshold, 12 ms minimum separation). The final entry is the
   clack the cylinder locks on and SPIN_SETTLE_MS is the small latch that
   follows it, which the animation lets the drum rock out on. If the asset can't
   be fetched or decoded the effect falls back to the synthesized cylinder
   below, and the animation to its quart-out whirl.
   --------------------------------------------------- */
const SPIN_GAIN = 0.4;            // sample level, on the same scale as the bank
const SPIN_PREROLL_MS = 30;       // played ahead of the first clack (the take's first
                                  // ~160 ms is silence, RMS < 0.0005, so nothing is lost)
const SPIN_CLICKS_MS = [
  184, 218, 238, 258, 276, 294, 314, 334, 350, 370, 390, 412, 434, 454, 476, 502,
  526, 552, 582, 618, 658, 704, 764, 826, 890, 976, 1078, 1174, 1278, 1412, 1552,
  1764, 2302,
];
const SPIN_SETTLE_MS = 2436;

let spinBuf = null;
let spinState = "idle";           // idle | loading | ready | failed

/* one 66 KB fetch, fired when the roulette table is opened (see preloadSpin),
   so a page that never visits that machine never pays for it */
function loadSpin() {
  if (spinState !== "idle") return;
  spinState = "loading";
  (async () => {
    try {
      const res = await fetch(new URL("audio/revolver-spin.mp3", import.meta.url));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const bytes = await res.arrayBuffer();
      spinBuf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
      spinState = "ready";
    } catch (err) {
      spinState = "failed";
      console.warn("[audio] the recorded revolver spin is unavailable; using the synthesized one. (" + (err && err.message) + ")");
    }
  })();
}

/* Fired off when the roulette table is opened, so the take has landed by the
   time the player asks for the first spin. */
export function preloadSpin() { loadSpin(); }

/* The take fitted to a spin of durMs (with a little give so no two spins are
   the same length), plus the chamber-clack times the drum should land on. */
function sampleSpin(durMs) {
  if (spinState !== "ready" || !spinBuf) { if (spinState === "idle") loadSpin(); return null; }
  const first = SPIN_CLICKS_MS[0] - SPIN_PREROLL_MS;              // buffer ms the take starts at
  const span = SPIN_SETTLE_MS - first;                            // ...out to the settle clack
  const ms = Math.max(200, Math.round(durMs * (0.95 + Math.random() * 0.1)));
  return {
    ms,
    rate: (span / 1000) / (ms / 1000),
    offset: first / 1000,
    span: span / 1000,
    buffer: spinBuf,
    keys: SPIN_CLICKS_MS.map((t) => (t - first) / span),
  };
}

/* Plays a plan from sampleSpin() into any context (the live one, or an offline
   one when checking the click times -- see DEV-NOTES.md). */
export function scheduleSpin(c, dest, plan, when) {
  const t0 = when === undefined ? c.currentTime : when;
  const end = t0 + plan.ms / 1000;
  const src = c.createBufferSource();
  src.buffer = plan.buffer;
  src.playbackRate.value = plan.rate;
  const g = c.createGain();
  g.gain.setValueAtTime(SPIN_GAIN, t0);
  g.gain.setValueAtTime(SPIN_GAIN, end);
  g.gain.linearRampToValueAtTime(0, end + 0.14);                  // let the latch ring, then clear the tail
  src.connect(g); g.connect(dest);
  src.start(t0, plan.offset, Math.min(plan.span + 0.5, plan.buffer.duration - plan.offset));
  return src;
}

/* the fallback: the cylinder is flicked and left to whir down. The ratchet
   ticks are placed by inverting the same quart-out curve the drum is animated
   with, so one click lands each time a chamber passes the pin -- a hard metal
   rattle up front that stretches out and dies as the drum loses speed -- over a
   band-passed whirr that sweeps down with it. */
function synthCylinder(durMs = 1500, turns = 4, chambers = 6) {
  const c = ctx(); if (!c) return;
  const dur = Math.max(0.2, durMs / 1000);
  const t0 = c.currentTime;

  /* the flick that starts it: a metal snap with a low thunk under it */
  noise({ dur: 0.05, vol: 0.16, freq: 3000, q: 1.3, type: "bandpass" });
  tone({ freq: 240, dur: 0.1, type: "triangle", vol: 0.15, slide: 120 });
  noise({ dur: 0.09, vol: 0.1, freq: 820, q: 0.7, type: "lowpass", delay: 0.01 });

  /* the whirr underneath: band-passed noise falling away as the drum slows */
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 2.6;
  bp.frequency.setValueAtTime(1750, t0);
  bp.frequency.exponentialRampToValueAtTime(320, t0 + dur * 0.85);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);

  /* the ratchet: one tick per chamber going past the pin */
  const passes = Math.max(4, Math.round(turns * chambers));
  for (let n = 1; n <= passes; n++) {
    const e = n / passes;                          // fraction of the sweep done
    const k = 1 - Math.pow(1 - e, 0.25);           // ...inverted quart-out ease
    const t = k * dur;
    const hard = 1 - e;                            // the fast early ticks hit hardest
    tone({ freq: 1240 + (n % 4) * 150, dur: 0.012, type: "square", vol: 0.028 + 0.03 * hard, delay: t });
    if (n % 2 === 0 || e < 0.3) {
      noise({ dur: 0.016, vol: 0.045 + 0.05 * hard, freq: 3600, q: 1.6, type: "bandpass", delay: t });
    }
  }

  /* it settles: a last tick and a faint ring off the metal */
  tone({ freq: 640, dur: 0.05, type: "triangle", vol: 0.09, delay: dur });
  tone({ freq: 1560, dur: 0.34, type: "sine", vol: 0.03, slide: 1080, delay: dur + 0.01 });
}

/* ---------- sound bank ---------- */
const bank = {
  click() {
    tone({ freq: 760, dur: 0.03, type: "square", vol: 0.11 });
    tone({ freq: 1140, dur: 0.025, type: "square", vol: 0.045, delay: 0.014 });
  },

  /* lever pull + reel ratchet for the full spin duration */
  spin(durMs = 1400) {
    if (!enabled) return;
    noise({ dur: 0.08, vol: 0.18, freq: 680, q: 0.7 });
    tone({ freq: 150, dur: 0.1, type: "sawtooth", vol: 0.15, slide: 88 });
    const c = ctx(); if (!c) return;
    const count = Math.max(8, Math.min(44, Math.round(durMs / 62)));
    const gaps = [];
    for (let i = 0; i < count; i++) gaps.push(30 + (i / Math.max(1, count - 1)) * 82);
    const sum = gaps.reduce((a, b) => a + b, 0);
    const scale = durMs / sum;
    let t = 0;
    for (let i = 0; i < count; i++) {
      tone({ freq: 1450 + (i % 3) * 130, dur: 0.018, type: "square", vol: 0.055, delay: t / 1000 });
      t += gaps[i] * scale;
    }
  },

  /* coin cascade + register cha-ching; tier scales the payout size */
  cash(tier = 1) {
    if (!enabled) return;
    const n = tier <= 1 ? 7 : tier === 2 ? 12 : tier === 3 ? 18 : 26;
    for (let i = 0; i < n; i++) {
      const f = 2100 + Math.random() * 2800;
      const d = i * 0.042 + Math.random() * 0.028;
      tone({ freq: f, dur: 0.11 + Math.random() * 0.09, type: "triangle", vol: 0.1 + Math.random() * 0.06, delay: d });
      tone({ freq: f * 1.5, dur: 0.055, type: "sine", vol: 0.05, delay: d + 0.004 });
    }
    tone({ freq: 1047, dur: 0.1, type: "square", vol: 0.13, delay: 0.02 });
    tone({ freq: 1568, dur: 0.14, type: "square", vol: 0.12, delay: 0.13 });
    tone({ freq: 2093, dur: 0.32, type: "triangle", vol: 0.11, delay: 0.26 });
    noise({ dur: 0.16, vol: 0.09, freq: 5400, type: "highpass", delay: 0.03 });
    noise({ dur: 0.22, vol: 0.07, freq: 3400, type: "highpass", delay: 0.2 });
  },

  reelStop(delay = 0) {
    noise({ dur: 0.05, vol: 0.15, freq: 420, q: 1, delay, type: "lowpass" });
    tone({ freq: 175, dur: 0.06, type: "triangle", vol: 0.13, delay });
  },

  win(tier = 1) {
    const A = [523, 659, 784, 1047];
    if (tier <= 1) {
      A.slice(0, 3).forEach((n, i) => tone({ freq: n, dur: 0.1, type: "square", vol: 0.2, delay: i * 0.07 }));
    } else if (tier === 2) {
      A.forEach((n, i) => tone({ freq: n, dur: 0.11, type: "square", vol: 0.22, delay: i * 0.085 }));
    } else if (tier === 3) {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((n, i) =>
        tone({ freq: n, dur: 0.12, type: "square", vol: 0.24, delay: i * 0.1 }));
    } else {
      [523, 659, 784, 1047, 784, 1047, 1319, 1568, 1319, 1568, 2093].forEach((n, i) =>
        tone({ freq: n, dur: 0.13, type: "square", vol: 0.26, delay: i * 0.095 }));
      noise({ dur: 0.55, vol: 0.09, freq: 4200, type: "highpass", delay: 0.75 });
    }
  },

  lose() {
    tone({ freq: 220, dur: 0.12, type: "sawtooth", vol: 0.12 });
    tone({ freq: 160, dur: 0.16, type: "sawtooth", vol: 0.11, delay: 0.1 });
  },

  levelUp() {
    [659, 784, 988, 1319].forEach((n, i) =>
      tone({ freq: n, dur: 0.14, type: "square", vol: 0.22, delay: i * 0.1 }));
  },

  /* ---------- frogger ---------- */
  blip() {
    tone({ freq: 880, dur: 0.045, type: "square", vol: 0.13, slide: 1320 });
  },

  hop() {
    tone({ freq: 420, dur: 0.07, type: "triangle", vol: 0.16, slide: 620 });
    noise({ dur: 0.045, vol: 0.07, freq: 900, q: 0.8, delay: 0.01 });
  },

  squish() {
    noise({ dur: 0.2, vol: 0.24, freq: 320, q: 0.6, type: "lowpass" });
    tone({ freq: 300, dur: 0.26, type: "sawtooth", vol: 0.2, slide: 60 });
    tone({ freq: 150, dur: 0.34, type: "square", vol: 0.14, slide: 44, delay: 0.05 });
  },

  horn() {
    tone({ freq: 392, dur: 0.16, type: "sawtooth", vol: 0.12 });
    tone({ freq: 523, dur: 0.16, type: "sawtooth", vol: 0.09 });
    tone({ freq: 392, dur: 0.13, type: "sawtooth", vol: 0.1, delay: 0.24 });
  },

  bank() {
    [784, 988, 1319].forEach((n, i) =>
      tone({ freq: n, dur: 0.08, type: "square", vol: 0.18, delay: i * 0.06 }));
    noise({ dur: 0.12, vol: 0.06, freq: 5200, type: "highpass", delay: 0.16 });
  },

  /* ---------- pac-man (Ghost Muncher) ---------- */
  chomp() {
    chompFlip = !chompFlip;
    const f = chompFlip ? 305 : 205;
    tone({ freq: f, dur: 0.05, type: "square", vol: 0.15, slide: f * 0.62 });
  },

  power() {
    tone({ freq: 170, dur: 0.26, type: "square", vol: 0.2, slide: 900 });
    tone({ freq: 340, dur: 0.26, type: "square", vol: 0.1, slide: 1500, delay: 0.03 });
  },

  eatGhost() {
    tone({ freq: 300, dur: 0.18, type: "square", vol: 0.22, slide: 1650 });
  },

  death() {
    [660, 590, 520, 460, 400, 300, 175].forEach((n, i) =>
      tone({ freq: n, dur: 0.1, type: "square", vol: 0.2, delay: i * 0.1 }));
  },

  ready() {
    [523, 392, 523, 784].forEach((n, i) =>
      tone({ freq: n, dur: 0.12, type: "square", vol: 0.19, delay: i * 0.15 }));
  },

  gameOver() {
    [392, 330, 262, 196].forEach((n, i) =>
      tone({ freq: n, dur: 0.22, type: "triangle", vol: 0.2, delay: i * 0.2 }));
  },

  sirenStart() {
    if (!enabled) return;
    const c = ctx(); if (!c || siren) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    osc.type = "square";
    osc.frequency.value = 265;
    lfo.type = "sine";
    lfo.frequency.value = 6;
    lfoGain.gain.value = 85;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    osc.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.04, c.currentTime + 0.15);
    osc.start(); lfo.start();
    siren = { osc, g, lfo };
  },

  sirenStop() { stopSiren(); },

  sirenPace(n) {
    if (!siren) return;
    const c = ctx(); if (!c) return;
    siren.lfo.frequency.setTargetAtTime(5 + Math.min(9, Math.max(0, n)), c.currentTime, 0.25);
  },

  /* ---------- neon recall (colour memory) ---------- */
  /* four rising pad tones so a sequence can be learned by ear as well as by eye */
  pad(i = 0) {
    const tones = [261.63, 329.63, 392.0, 523.25];
    const f = tones[Math.max(0, Math.min(3, Math.round(i) || 0))];
    tone({ freq: f, dur: 0.32, type: "triangle", vol: 0.22 });
    tone({ freq: f * 0.5, dur: 0.3, type: "sine", vol: 0.09, delay: 0.01 });
    tone({ freq: f * 2, dur: 0.16, type: "sine", vol: 0.06, delay: 0.02 });
  },

  padWrong() {
    tone({ freq: 150, dur: 0.34, type: "sawtooth", vol: 0.2, slide: 78 });
    tone({ freq: 96, dur: 0.4, type: "square", vol: 0.14, slide: 52, delay: 0.03 });
    noise({ dur: 0.24, vol: 0.12, freq: 520, q: 0.7, type: "lowpass" });
  },

  padPass() {
    [659, 880].forEach((n, i) =>
      tone({ freq: n, dur: 0.12, type: "square", vol: 0.17, delay: i * 0.08 }));
    noise({ dur: 0.12, vol: 0.05, freq: 5600, type: "highpass", delay: 0.05 });
  },

  /* ---------- horse racing ---------- */
  callToPost() {
    [523, 523, 523, 659, 784].forEach((n, i) =>
      tone({ freq: n, dur: 0.16, type: "triangle", vol: 0.2, delay: i * 0.19 }));
    tone({ freq: 1047, dur: 0.4, type: "triangle", vol: 0.18, delay: 1.0 });
  },

  hoof() {
    noise({ dur: 0.035, vol: 0.1, freq: 160, q: 1.1, type: "lowpass" });
    tone({ freq: 95, dur: 0.045, type: "triangle", vol: 0.09, slide: 70 });
  },

  crowd(vol = 0.14) {
    noise({ dur: 1.1, vol, freq: 1000, q: 0.4, attack: 0.25, type: "bandpass" });
    noise({ dur: 0.9, vol: vol * 0.7, freq: 3000, q: 0.5, attack: 0.2, type: "highpass" });
  },

  boom() {
    noise({ dur: 0.5, vol: 0.3, freq: 240, q: 0.5, type: "lowpass", attack: 0.005 });
    noise({ dur: 0.16, vol: 0.2, freq: 2600, q: 0.6, type: "highpass" });
    tone({ freq: 120, dur: 0.34, type: "sawtooth", vol: 0.26, slide: 34 });
    tone({ freq: 62, dur: 0.5, type: "square", vol: 0.18, slide: 26, delay: 0.02 });
  },

  /* ---------- russian roulette ---------- */
  /* The drum is loaded and spun. Returns the plan the caller should animate to
     -- { ms, steps, keys }, where `keys` are the fractions of the spin at which
     a chamber goes past the pin -- so the picture is cut to the take. With no
     take to play it returns a quart-out plan (keys: null) instead. */
  cylinder(durMs = 1500, turns = 4, chambers = 6) {
    const plan = sampleSpin(durMs);
    if (plan) {
      plan.steps = plan.keys.length;
      if (enabled) {
        const c = ctx();
        if (c) {
          scheduleSpin(c, master, plan, c.currentTime);
          /* the picture waits for however long the sound takes to reach the ear,
             so a chamber lands with its clack instead of just after it */
          const lat = c.outputLatency || c.baseLatency || 0;
          plan.delayMs = Math.min(120, Math.max(0, lat * 1000));
        }
      }
      return plan;
    }
    if (enabled) synthCylinder(durMs, turns, chambers);
    return { ms: durMs, steps: Math.max(1, Math.round(turns * chambers)), keys: null };
  },

  /* hammer drawn back: two dry mechanical clicks */
  cock() {
    noise({ dur: 0.05, vol: 0.16, freq: 2600, q: 1.4, type: "bandpass" });
    tone({ freq: 1500, dur: 0.03, type: "square", vol: 0.09, slide: 900 });
    noise({ dur: 0.06, vol: 0.14, freq: 1800, q: 1.2, type: "bandpass", delay: 0.09 });
    tone({ freq: 1100, dur: 0.035, type: "square", vol: 0.08, slide: 700, delay: 0.09 });
  },

  /* the pin falls on an empty chamber */
  dryFire() {
    noise({ dur: 0.035, vol: 0.17, freq: 3200, q: 1.6, type: "highpass" });
    tone({ freq: 2400, dur: 0.02, type: "square", vol: 0.07, slide: 1400 });
  },

  /* the other kind of chamber */
  gunshot() {
    noise({ dur: 0.42, vol: 0.34, freq: 900, q: 0.4, type: "lowpass", attack: 0.002 });
    noise({ dur: 0.14, vol: 0.26, freq: 5200, q: 0.5, type: "highpass" });
    tone({ freq: 190, dur: 0.3, type: "sawtooth", vol: 0.3, slide: 40 });
    tone({ freq: 86, dur: 0.5, type: "square", vol: 0.22, slide: 34 });
    noise({ dur: 0.9, vol: 0.08, freq: 1200, q: 0.3, type: "bandpass", attack: 0.2, delay: 0.1 });
  },

  /* a chamber is passed: a relief chime for a bullet, a dull thud for a blank */
  dodge(wasLive = true) {
    if (wasLive) {
      noise({ dur: 0.3, vol: 0.13, freq: 1600, q: 0.6, attack: 0.06, type: "bandpass" });
      [659, 988, 1319].forEach((n, i) =>
        tone({ freq: n, dur: 0.1, type: "triangle", vol: 0.18, delay: 0.02 + i * 0.06 }));
    } else {
      noise({ dur: 0.16, vol: 0.14, freq: 420, q: 0.7, type: "lowpass" });
      tone({ freq: 230, dur: 0.2, type: "sawtooth", vol: 0.14, slide: 120 });
      tone({ freq: 150, dur: 0.26, type: "square", vol: 0.1, slide: 80, delay: 0.04 });
    }
  },

  /* insurance: a rising read of the chamber */
  scan() {
    tone({ freq: 520, dur: 0.34, type: "sine", vol: 0.14, slide: 1500 });
    tone({ freq: 780, dur: 0.2, type: "sine", vol: 0.08, slide: 2100, delay: 0.12 });
    noise({ dur: 0.3, vol: 0.05, freq: 4200, q: 0.6, type: "highpass", attack: 0.1 });
  },

  /* the bullet lands: a heavy low thud with the sub dropping out from under it */
  wound() {
    noise({ dur: 0.26, vol: 0.2, freq: 340, q: 0.5, type: "lowpass", attack: 0.004 });
    tone({ freq: 120, dur: 0.42, type: "sine", vol: 0.3, slide: 42 });
    tone({ freq: 62, dur: 0.6, type: "square", vol: 0.2, slide: 26, delay: 0.02 });
    noise({ dur: 0.5, vol: 0.06, freq: 900, q: 0.35, type: "bandpass", attack: 0.18, delay: 0.08 });
  },

  /* the dealer snaps a fresh cylinder in: latch out, latch home */
  reload() {
    noise({ dur: 0.05, vol: 0.15, freq: 2400, q: 1.5, type: "bandpass" });
    tone({ freq: 1300, dur: 0.03, type: "square", vol: 0.08, slide: 820 });
    noise({ dur: 0.05, vol: 0.17, freq: 1900, q: 1.3, type: "bandpass", delay: 0.16 });
    tone({ freq: 980, dur: 0.035, type: "square", vol: 0.09, slide: 620, delay: 0.16 });
    tone({ freq: 320, dur: 0.12, type: "triangle", vol: 0.1, slide: 190, delay: 0.17 });
  },
};

const missingSfx = new Set();

export const sfx = new Proxy(bank, {
  get(target, prop) {
    if (prop === "then") return undefined;
    if (typeof prop !== "string") return target[prop];
    const fn = target[prop];
    if (fn !== undefined) return fn;
    if (!missingSfx.has(prop)) {
      missingSfx.add(prop);
      console.warn("[audio] sfx." + prop + "() is not defined; ignoring.");
    }
    return () => {};
  },
});

/* ---------- global button feedback ---------- */
const BUTTON_SEL = "button, .btn, .segbtn, .hpick, .dbtn, .machine-btn, .ml-linebtn, .x-btn, .pill, .paychip";

export function installGlobalSounds() {
  const gesture = () => unlock();
  window.addEventListener("pointerdown", gesture, true);
  window.addEventListener("keydown", gesture, true);

  document.addEventListener("pointerdown", (e) => {
    const t = e.target && e.target.closest ? e.target.closest(BUTTON_SEL) : null;
    if (!t || t.disabled) return;
    sfx.click();
  }, true);
}
