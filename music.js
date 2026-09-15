/* =========================================================
   music.js — looping background casino soundtrack.

   Three ~3-minute tracks play back-to-back and then loop
   forever (1 -> 2 -> 3 -> 1 -> ...). Each transition is a
   short volume crossfade so one track melts into the next
   instead of stopping and restarting. The mix level is a fixed
   low volume and it has its own mute toggle, independent of
   the game's chiptune sound effects.

   Audio objects are created lazily on the first user gesture
   so browser autoplay policies are respected.

   Rebuild recipe: the three MP3s were produced with the
   `generate_music` tool (prompts in the project history) and
   uploaded to the URLs below; they are hosted, so there is
   nothing in src/ to rebuild from.
   ========================================================= */

const TRACKS = [
  "https://user.uploads.dev/file/a4c638afb081822de309b8147c9698a8.mp3",
  "https://user.uploads.dev/file/6123af37559d52fa2da62f6796b9d069.mp3",
  "https://user.uploads.dev/file/5aba2f86f237e886db10aacf1a383ac3.mp3",
];

const PREF_KEY = "casino-royale.music.v1";
const VOLUME = 0.01;
const FADE_MS = 2200;
const TICK_MS = 60;

let enabled = true;
try { if (localStorage.getItem(PREF_KEY) === "0") enabled = false; } catch (e) { /* storage blocked */ }

let audios = null;
let active = 0;
let nextIndex = 0;
let phase = "idle";       // idle | play | cross
let crossStart = 0;
let timer = null;
let wantPlaying = false;

function persist() {
  try { localStorage.setItem(PREF_KEY, enabled ? "1" : "0"); } catch (e) { /* ignore */ }
}

function build() {
  if (audios) return audios;
  audios = TRACKS.map((url, i) => {
    const a = new Audio();
    a.src = url;
    a.preload = i === 0 ? "auto" : "metadata";
    a.volume = 0;
    a.addEventListener("ended", onEnded);
    return a;
  });
  return audios;
}

function onEnded(e) {
  if (phase === "cross") return;
  const a = e.currentTarget;
  if (a !== audios[active]) return;
  if (!enabled || !wantPlaying) return;
  hardAdvance();
}

function startTicker() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
}

function stopTicker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function tick() {
  if (!enabled || !wantPlaying || !audios) return;
  const cur = audios[active];
  if (phase === "play") {
    const d = cur.duration;
    if (Number.isFinite(d) && d > 0) {
      const remainingMs = (d - cur.currentTime) * 1000;
      if (remainingMs <= FADE_MS) beginCross(performance.now());
    }
  } else if (phase === "cross") {
    const p = Math.min(1, (performance.now() - crossStart) / FADE_MS);
    cur.volume = VOLUME * (1 - p);
    audios[nextIndex].volume = VOLUME * p;
    if (p >= 1) finishCross();
  }
}

function beginCross(now) {
  nextIndex = (active + 1) % audios.length;
  const nxt = audios[nextIndex];
  try { nxt.currentTime = 0; } catch (e) { /* not seekable yet */ }
  nxt.volume = 0;
  nxt.play().catch(() => {});
  phase = "cross";
  crossStart = now;
}

function finishCross() {
  const old = audios[active];
  old.pause();
  old.volume = 0;
  try { old.currentTime = 0; } catch (e) { /* ignore */ }
  active = nextIndex;
  audios[active].volume = VOLUME;
  phase = "play";
}

function hardAdvance() {
  const old = audios[active];
  old.volume = 0;
  const i = (active + 1) % audios.length;
  const nxt = audios[i];
  try { nxt.currentTime = 0; } catch (e) { /* ignore */ }
  nxt.volume = VOLUME;
  nxt.play().catch(() => {});
  active = i;
  phase = "play";
}

function pauseAll() {
  if (!audios) return;
  for (const a of audios) { a.pause(); a.volume = 0; }
  phase = "idle";
}

function resume() {
  if (!audios) return;
  const a = audios[active];
  a.volume = VOLUME;
  a.play().catch(() => {});
  phase = "play";
  startTicker();
}

export function isMusicEnabled() { return enabled; }

export function setMusicEnabled(v) {
  enabled = !!v;
  persist();
  if (!enabled) {
    wantPlaying = false;
    stopTicker();
    pauseAll();
  } else if (audios) {
    wantPlaying = true;
    resume();
  }
  return enabled;
}

export function toggleMusic() { return setMusicEnabled(!enabled); }

/* Called on the first user gesture; safe to call repeatedly. */
export function startMusic() {
  if (!enabled || wantPlaying) return;
  build();
  wantPlaying = true;
  const a = audios[active];
  a.volume = VOLUME;
  a.play().catch(() => {});
  phase = "play";
  startTicker();
}

export function installMusicGesture() {
  const go = () => startMusic();
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
  window.addEventListener("touchstart", go, true);
}