# Deploying to GitHub Pages

The published site is a plain static site: the browser loads every script and stylesheet straight
from the repo, so relative ES-module imports (`./state.js`, `../audio.js`, ...) resolve natively.

- `src/index.html` is the GitHub Pages entry point. Upload it to the repo ROOT as `index.html`.
  It references `styles.css` and `main.js` (no `src/` prefix).
- Do NOT replace that file with a Perchance "saved page" export. Those snapshots rewrite script
  paths to Perchance's CDN (`user.uploads.dev/file/<key>.js`), and the modules there import each
  other relatively, which 404s outside Perchance — the page then renders only the static top bar.
- Upload the rest of `src/` to the repo with the `src/` prefix stripped and the `games/`
  subfolder preserved (`src/games/crash.js` -> `games/crash.js`).
- **Binary assets too:** `src/audio/revolver-spin.mp3` must land at `audio/revolver-spin.mp3`.
  `audio.js` resolves it relative to itself (`new URL("audio/revolver-spin.mp3", import.meta.url)`),
  so a missing file just costs the recorded Russian Roulette spin — that machine falls back to its
  synthesized whirl (see DEV-NOTES.md), and nothing else breaks.
- GitHub Pages caches JS/CSS for ~10 minutes (`Cache-Control: max-age=600`); hard-reload or tick
  "Disable cache" in DevTools after uploading.

The Perchance generator itself keeps working as before — this file and the repo copy are only
about the GitHub Pages mirror.

---

# Cloud saves (optional Google sign-in)

Players keep their run in `localStorage`, which is why a wiped/reinstalled browser starts over.
`src/cloudsave.js` adds an **optional** mirror of that save into the player's own Google Drive, so
the same run can be picked up on another computer. It is **local-first**: nothing changes about how
the game saves; the cloud copy is a backup that is pushed ~15 seconds after a change and read on
sign-in.

There is no server of ours in the loop. The browser talks straight to Google
(`www.googleapis.com`), and the save file lives in the hidden `appDataFolder` of the player's own
Drive — it does not show up in their normal Drive list and only this app's own OAuth client can
read it. Nobody but the player can see it (including you).

## One-time setup (the site owner does this once)

Cloud saves need a client ID from *your* Google account. Until you paste one in, the button still
appears but the panel shows these same steps — nothing can sign in.

1. <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → Library → Google Drive API → Enable**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app name and your email.
   - Scopes: the app only asks for `drive.appdata` and `userinfo.email`, both non-sensitive, so no
     Google verification review is needed.
   - While the app is in **Testing**, add every account that should be able to sign in under
     **Test users** (up to 100). Anyone not on that list gets `access_denied`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
5. Under **Authorized JavaScript origins** add the exact site address:
   - `https://chrislegend95.github.io` (the GitHub Pages mirror)
   - optionally `https://<publicId>.perchance.org` (the iframe the Perchance page runs in — only if
     you also flip `cloudSaves` to `1` in `main.pjs`)
   No redirect URI is needed; the popup uses the token flow.
6. Copy the generated client ID into `CLIENT_ID` at the top of `src/cloudsave.js` and upload that
   file (see the deploy notes above). A client ID is public by design — it is fine in the repo.

## Knobs and switches

- `cloudSaves` in `main.pjs` — `0` (default) hides the whole feature on Perchance, `1` turns it on
  there too. The GitHub build has no `main.pjs`, so it uses the fallback in `src/state.js`
  (`cfg("cloudSaves", 1)`), i.e. **on**.
- `window.CASINO_GOOGLE_CLIENT_ID = "..."` — override the baked-in client ID without editing the
  file (handy for testing a second origin).
- `?cloud` in the URL, or `window.CASINO_CLOUD_FORCE = true` — force the feature on even when
  `cloudSaves` is `0`.
- `window.casino.cloud` is the live object (`state`, `signIn()`, `syncNow()`, `upload()`,
  `downloadSave()`, `importSaveText()`, `deleteCloudSave()`, plus a `debug` bag with
  `setFetch`/`setTokenProvider` for testing the sync engine without a Google account).

## When sign-in does not work

- **Popup never appears** — popups are blocked for the site; allow them.
- **`origin_mismatch` / `idpiframe_initialization_failed`** — the exact origin (scheme + host, no
  trailing slash) is missing from the client's authorized JS origins, or the browser blocks
  third-party cookies, which the token flow needs.
- **`access_denied`** — that account is not on the OAuth consent screen's test-user list.
- **"Google hasn't verified this app"** — expected while the app is in Testing; continue to the app.
- **`forbidden`** — the Drive API is not enabled on the project.
- Anything the player sees is a plain-language message from `friendly()` in `src/cloudsave.js`.

## If a player has no Google account

The panel's **Manual backup** section works signed out: it writes the run out as a small `.json`
file and can load it back on another computer. That is the recommended answer for someone whose
browser wipes storage on exit.

