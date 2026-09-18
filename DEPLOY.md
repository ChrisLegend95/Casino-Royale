# Deploying to GitHub Pages

The published site is a plain static site: the browser loads every script and stylesheet straight
from the repo, so relative ES-module imports (`./state.js`, `../audio.js`, ...) resolve natively.

- `src/index.html` is the GitHub Pages entry point. Upload it to the repo ROOT as `index.html`.
  It references `styles.css` and `main.js` (no `src/` prefix).
- Upload the rest of `src/` to the repo with the `src/` prefix stripped and the `games/`
  subfolder preserved (`src/games/crash.js` -> `games/crash.js`).
- **Binary assets too:** `src/audio/revolver-spin.mp3` must land at `audio/revolver-spin.mp3`.
  `audio.js` resolves it relative to itself (`new URL("audio/revolver-spin.mp3", import.meta.url)`),
  so a missing file just costs the recorded Russian Roulette spin — that machine falls back to its
  synthesized whirl (see DEV-NOTES.md), and nothing else breaks.
- GitHub Pages caches JS/CSS for ~10 minutes (`Cache-Control: max-age=600`); hard-reload or tick
  "Disable cache" in DevTools after uploading.
