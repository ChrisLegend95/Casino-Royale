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

/* ---------- sound bank ---------- */
export const sfx = {
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
};

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
