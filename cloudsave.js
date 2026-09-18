/* =========================================================
   Cloud saves -- optional "Sign in with Google" save sync
   =========================================================
   The run always lives in localStorage first: this module is a MIRROR, never a
   dependency. Signing in copies the save to one small file in the app's own hidden
   Google Drive folder (the `appDataFolder` space), and pulls it back on the next
   device. Nothing but the save object is ever stored or sent anywhere.

   Why this design:
   - No server. Google Identity Services hands the page a short-lived access token,
     and the page talks to the Drive REST API itself. GitHub Pages hosting stays a
     plain static site (the client ID is public by definition -- no secret exists).
   - appDataFolder, not the visible Drive: the file is invisible in the player's
     normal Drive list and only this app (this client ID) can read it, so we never
     ask for anything more than one hidden folder.
   - Newest-wins is NOT automatic when the two saves disagree. A fresh device
     (brand new run) must never be able to silently bury a real cloud save, so a
     conflict always asks, with the likely answer pre-selected.
   - Push is debounced (every 15s at most, plus one last push on tab hide) so a
     round of blackjack costs one upload, not thirty.

   ONE-TIME SETUP (~5 minutes, you only do it once)
     1. console.cloud.google.com -> create a project (e.g. "Casino Royale").
     2. APIs & Services -> Library -> enable "Google Drive API".
     3. APIs & Services -> OAuth consent screen -> External; add yourself (and
        any friends, up to 100 test users) under "Test users"; add the two
        scopes this file asks for (drive.appdata, userinfo.email).
     4. Credentials -> Create credentials -> OAuth client ID -> Web application.
        Authorized JavaScript origins:
            https://chrislegend95.github.io
        (plus https://<your-public-id>.perchance.org if you also want cloud
        saves on the Perchance build, and turn `cloudSaves` on in main.pjs)
     5. Paste the client ID into CLIENT_ID below and re-upload this file.
   DEPLOY.md has the same steps with the click-by-click detail.

   Debug switch: `CASINO_CLOUD_FORCE = true` (or adding `?cloud` to the URL)
   shows the cloud button even on a build where the `cloudSaves` knob is 0.
   ========================================================= */

import {
  CONFIG, state, on, applySaveObject, saveSnapshot, snapshotSummary, isFreshSnapshot,
} from "./state.js";
import { el, clear, fmt, toast, modal, confirmDialog } from "./ui.js";

/* ---- paste the OAuth client ID here (see the setup steps above) ---- */
const CLIENT_ID = "";

const APP_TAG = "casino-royale";
const BLOB_VERSION = 1;
const DRIVE_FILE = "casino-royale-save.json";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
const DEVICE_KEY = "casino-royale.device.v1";
const DEFER_KEY = "casino-royale.cloud.deferred.v1";
/* one autosave upload per 15s of play at most; a save tab-close flushes it */
const AUTO_PUSH_MS = 15000;
const MAX_UPLOAD = 4 * 1024 * 1024;
const SILENT_TIMEOUT_MS = 180000;

class CloudError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code || "error";
    this.status = Number(status) || 0;
  }
}

/* ------------------------------------------------------------------ *
   small helpers
   ------------------------------------------------------------------ */
function clientId() {
  try {
    const override = window.CASINO_GOOGLE_CLIENT_ID;
    if (typeof override === "string" && override.trim()) return override.trim();
  } catch (e) { /* ignore */ }
  return String(CLIENT_ID || "").trim();
}

function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ":" + s.length.toString(36);
}

/* The fingerprint used to decide "are these two saves the same run?". `savedAt` is
   left out on purpose: it changes on every single write, so including it would make
   two copies of an identical run look different and pop a pointless conflict dialog
   (or re-upload the same bytes every few minutes). Everything the player can
   actually see is in the hash. */
function hashSave(save) {
  const s = Object.assign({}, save || {});
  delete s.savedAt;
  return hashText(JSON.stringify(s));
}

function ago(ts) {
  const t = Number(ts) || 0;
  if (!t) return "unknown";
  const d = Date.now() - t;
  if (d < 45000) return "just now";
  const m = Math.floor(d / 60000);
  if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const dd = Math.floor(h / 24);
  if (dd < 30) return dd + (dd === 1 ? " day ago" : " days ago");
  try { return new Date(t).toLocaleDateString(); } catch (e) { return "a while ago"; }
}

function deviceLabel() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const br = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
      : /Firefox\//.test(ua) ? "Firefox"
        : /Chrome\//.test(ua) ? "Chrome"
          : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
      : /Windows/.test(ua) ? "Windows"
        : /Mac OS X/.test(ua) ? "macOS"
          : /Linux/.test(ua) ? "Linux" : "";
  return os ? br + " on " + os : br;
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id) return id;
    id = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch (e) {
    return "dev-nostorage";
  }
}

/* the cloud revision a player dismissed the conflict dialog on -- so we ask once
   per revision instead of on every page load */
function deferredChoice() {
  try { return JSON.parse(localStorage.getItem(DEFER_KEY) || "null"); } catch (e) { return null; }
}
function setDeferred(v) {
  try {
    if (v) localStorage.setItem(DEFER_KEY, JSON.stringify(v));
    else localStorage.removeItem(DEFER_KEY);
  } catch (e) { /* ignore */ }
}

function friendly(e) {
  const code = (e && e.code) || "";
  const here = " (this site: " + location.origin + ")";
  switch (code) {
    case "no_client_id": return "Cloud saves are not set up yet -- paste your OAuth client ID into src/cloudsave.js (see DEPLOY.md).";
    case "popup_closed": return "The Google sign-in window was closed before it finished.";
    case "popup_failed_to_open": return "The Google sign-in window was blocked. Allow popups for this site and try again.";
    case "interaction_required":
    case "consent_required": return "Google needs you to sign in again.";
    case "access_denied": return "Google refused the sign-in. If the app is still in testing, make sure this account is on its test-user list.";
    case "invalid_client": return "Google rejected the client ID" + here + " -- check it in the OAuth credentials page.";
    case "origin_mismatch":
    case "idpiframe_initialization_failed": return "This site's address is not an authorized origin for the OAuth client" + here + ". Third-party cookies also have to be allowed for Google sign-in.";
    case "auth": return "Google sign-in has expired -- sign in again.";
    case "network": return "Could not reach Google Drive -- check your connection.";
    case "notfound": return "The cloud save file is gone (deleted?). Saving will create a new one.";
    case "forbidden": return "Google Drive refused the request -- make sure the Drive API is enabled for the project.";
    case "rate": return "Google is rate-limiting requests -- try again in a minute.";
    case "too_big": return "The save is too big to upload.";
    case "timeout": return "Google sign-in timed out.";
    default: return (e && e.message) || "Something went wrong while syncing.";
  }
}

/* ------------------------------------------------------------------ *
   module state
   ------------------------------------------------------------------ */
const S = {
  enabled: false,
  status: "off",        // off | noclient | ready | syncing | synced | dirty | error
  message: "",
  account: null,        // {email, name, picture}
  token: "",
  tokenExp: 0,
  fileId: "",
  cloud: null,          // {updatedAt, hash, saveVersion, summary, device}
  lastSyncAt: 0,
  reconciled: false,
  busy: false,
  onApplied: null,
  canApply: null,
};

let apiFetch = (url, opts) => fetch(url, opts);
let tokenProvider = null;
let gisPromise = null;

function storeToken(token, expiresInSec) {
  S.token = String(token || "");
  const secs = Number(expiresInSec) > 0 ? Number(expiresInSec) : 3600;
  S.tokenExp = Date.now() + Math.max(30, secs - 120) * 1000;
  return S.token;
}
function clearToken() { S.token = ""; S.tokenExp = 0; }

/* ------------------------------------------------------------------ *
   Google sign-in (GIS token model)
   ------------------------------------------------------------------ */
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const ok = () => {
      const g = window.google;
      if (g && g.accounts && g.accounts.oauth2) resolve(g.accounts.oauth2);
      else reject(new CloudError("auth", "Google sign-in library did not load."));
    };
    try {
      const g = window.google;
      if (g && g.accounts && g.accounts.oauth2) { resolve(g.accounts.oauth2); return; }
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = ok;
      s.onerror = () => reject(new CloudError("network", "Could not load Google sign-in."));
      document.head.appendChild(s);
    } catch (e) {
      reject(new CloudError("auth", String((e && e.message) || e)));
    }
  });
  return gisPromise;
}

/* Ask GIS for an access token. `prompt` is "select_account" when the player just
   clicked sign-in, and "none" for the silent attempt on page load -- "none" fails
   with interaction_required instead of popping anything up, which is exactly what
   an unattended call should do. */
function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    let client;
    try {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPES,
        callback: (resp) => {
          if (resp && resp.access_token) {
            storeToken(resp.access_token, resp.expires_in);
            done(resolve, resp);
          } else {
            done(reject, new CloudError((resp && resp.error) || "auth", "Google refused the sign-in."));
          }
        },
        error_callback: (err) => {
          const code = (err && err.type) || "auth";
          done(reject, new CloudError(code === "unknown" ? "auth" : code, (err && err.message) || "Sign-in failed."));
        },
      });
    } catch (e) {
      done(reject, new CloudError("auth", String((e && e.message) || e)));
      return;
    }
    setTimeout(() => done(reject, new CloudError("timeout", "Sign-in timed out.")), SILENT_TIMEOUT_MS);
    try {
      client.requestAccessToken({ prompt });
    } catch (e) {
      done(reject, new CloudError("auth", String((e && e.message) || e)));
    }
  });
}

async function ensureToken(interactive) {
  if (S.token && Date.now() < S.tokenExp) return S.token;
  if (tokenProvider) return storeToken(await tokenProvider(interactive), 3600);
  if (!clientId()) throw new CloudError("no_client_id", "No OAuth client ID configured.");
  await loadGis();
  const resp = await requestToken(interactive ? "select_account" : "none");
  return resp.access_token;
}

/* ------------------------------------------------------------------ *
   Drive REST (appDataFolder only)
   ------------------------------------------------------------------ */
async function httpError(res) {
  let msg = "HTTP " + res.status;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const m = j && j.error && (j.error.message || j.error.status);
      if (m) msg = String(m);
    } catch (e) { if (text && text.length < 200) msg = text.trim() || msg; }
  } catch (e) { /* ignore */ }
  const code = res.status === 401 ? "auth"
    : res.status === 403 ? "forbidden"
      : res.status === 404 ? "notfound"
        : res.status === 429 ? "rate" : "http";
  return new CloudError(code, msg, res.status);
}

/* Run a Drive call with a token, refreshing once if the token died mid-flight. */
async function authed(fn, interactive) {
  let token = await ensureToken(!!interactive);
  try {
    return await fn(token);
  } catch (e) {
    if (e && e.status === 401) {
      clearToken();
      token = await ensureToken(!!interactive);
      return await fn(token);
    }
    throw e;
  }
}

async function driveFind(interactive) {
  return authed(async (token) => {
    const q = encodeURIComponent("name = '" + DRIVE_FILE + "' and trashed = false");
    const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
    const res = await apiFetch(DRIVE + "/files?spaces=appDataFolder&q=" + q + "&fields=" + fields + "&pageSize=5", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const files = Array.isArray(data.files) ? data.files : [];
    return files[0] || null;
  }, interactive);
}

async function driveRead(id) {
  return authed(async (token) => {
    const res = await apiFetch(DRIVE + "/files/" + encodeURIComponent(id) + "?alt=media", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw await httpError(res);
    return await res.text();
  }, false);
}

async function driveCreate(text, token) {
  const boundary = "crb" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const meta = JSON.stringify({ name: DRIVE_FILE, mimeType: "application/json", parents: ["appDataFolder"] });
  const body = "--" + boundary + "\r\n"
    + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
    + meta + "\r\n"
    + "--" + boundary + "\r\n"
    + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
    + text + "\r\n"
    + "--" + boundary + "--\r\n";
  const res = await apiFetch(DRIVE_UPLOAD + "/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "multipart/related; boundary=" + boundary,
    },
    body,
  });
  if (!res.ok) throw await httpError(res);
  const data = await res.json();
  if (!data || !data.id) throw new CloudError("http", "Drive did not return a file id.");
  return data.id;
}

async function driveWrite(id, text) {
  if (text.length > MAX_UPLOAD) throw new CloudError("too_big", "Save is too big to upload.");
  return authed(async (token) => {
    if (!id) return await driveCreate(text, token);
    const res = await apiFetch(DRIVE_UPLOAD + "/files/" + encodeURIComponent(id) + "?uploadType=media&fields=id", {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" },
      body: text,
    });
    /* the player may have deleted the file from Drive's app-data list -- make a new one */
    if (res.status === 404) return await driveCreate(text, token);
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    return (data && data.id) || id;
  }, false);
}

async function driveDelete(id) {
  return authed(async (token) => {
    const res = await apiFetch(DRIVE + "/files/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok && res.status !== 404) throw await httpError(res);
    return true;
  }, false);
}

async function fetchUser(token) {
  try {
    const res = await apiFetch(USERINFO, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) return { email: "", name: "", picture: "" };
    const d = await res.json();
    return {
      email: String((d && d.email) || ""),
      name: String((d && d.name) || ""),
      picture: String((d && d.picture) || ""),
    };
  } catch (e) {
    return { email: "", name: "", picture: "" };
  }
}

/* ------------------------------------------------------------------ *
   the save blob
   ------------------------------------------------------------------ */
function buildBlob() {
  const save = saveSnapshot();
  return {
    app: APP_TAG,
    blob: BLOB_VERSION,
    saveVersion: CONFIG.saveVersion,
    updatedAt: Number(save.savedAt) || Date.now(),
    device: { id: deviceId(), label: deviceLabel() },
    summary: snapshotSummary(save),
    save,
  };
}

/* Read either our wrapper blob or a bare save object (a hand-made file should
   still work). Returns a normalised view, never throws. */
function parseCloud(text) {
  let raw = null;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, reason: "json" }; }
  if (!raw || typeof raw !== "object") return { ok: false, reason: "shape" };
  const save = raw.save && typeof raw.save === "object" ? raw.save : raw;
  if (!save || typeof save !== "object") return { ok: false, reason: "shape" };
  if (!Number.isFinite(Number(save.v)) || !Number.isFinite(Number(save.money))) return { ok: false, reason: "shape" };
  return {
    ok: true,
    save,
    saveVersion: Number(save.v),
    updatedAt: Number(raw.updatedAt) || Number(save.savedAt) || 0,
    device: raw.device && typeof raw.device === "object" ? raw.device : null,
    summary: snapshotSummary(save),
    hash: hashSave(save),
  };
}

function adoptCloud(cloud) {
  S.cloud = {
    updatedAt: cloud.updatedAt,
    hash: cloud.hash,
    saveVersion: cloud.saveVersion,
    summary: cloud.summary,
    device: cloud.device,
  };
  S.lastSyncAt = Date.now();
  S.reconciled = true;
}

/* ------------------------------------------------------------------ *
   sync engine
   ------------------------------------------------------------------ */
/* True while a cloud save is being written into localStorage. Used to mute the
   "saved" hook so applying a save doesn't immediately look like a local edit. */
let applying = false;

function fail(e, quiet) {
  const msg = friendly(e);
  S.status = "error";
  S.message = msg;
  S.busy = false;
  render();
  if (!quiet) toast("Cloud save: " + msg, "lose", 4600);
  return false;
}

/* `force` skips the identical-content shortcut below: used whenever the player
   (or a reconcile decision) has explicitly said "write this run to Drive", which
   must also work when the cloud file was deleted or corrupted out from under us. */
async function pushBlob(announce, force) {
  const blob = buildBlob();
  const text = JSON.stringify(blob);
  const hash = hashSave(blob.save);
  /* Nothing the player can see has changed since the last sync -- only the
     timestamp moved (loading a save re-stamps it, for example). Don't spend an
     upload on identical content. */
  if (!force && S.fileId && S.cloud && S.cloud.hash === hash) {
    adoptCloud({
      updatedAt: blob.updatedAt,
      hash,
      saveVersion: blob.saveVersion,
      summary: blob.summary,
      device: blob.device,
    });
    setDeferred(null);
    S.status = "synced";
    S.message = "";
    render();
    return true;
  }
  S.fileId = await driveWrite(S.fileId, text);
  adoptCloud({
    updatedAt: blob.updatedAt,
    hash,
    saveVersion: blob.saveVersion,
    summary: blob.summary,
    device: blob.device,
  });
  setDeferred(null);
  S.status = "synced";
  S.message = "";
  render();
  if (announce) toast("Cloud save updated \u2014 " + fmt(blob.summary.money) + ", level " + blob.summary.level + ".", "gold", 3600);
  return true;
}

/* Apply a cloud (or exported-file) save, keeping the chosen timestamp when the
   content came FROM the cloud so the two sides keep hashing equal afterwards. */
async function loadCloud(cloud, opts = {}) {
  if (!cloud || !cloud.ok) { toast("That is not a usable save.", "lose", 3400); return false; }
  if (S.canApply && !S.canApply()) {
    toast("Finish this round first \u2014 then load the save.", "info", 3400);
    return false;
  }
  /* Applying a save writes it straight back to localStorage, which normally
     schedules a cloud push. While we're mid-apply that push is pointless (and
     would flash the button into "SYNC/DIRTY" for no reason), so mute it. */
  applying = true;
  let res;
  try {
    res = applySaveObject(cloud.save, { keepStamp: opts.keepStamp === true });
    if (!res.ok) {
      if (res.reason === "version") {
        toast("That save is from a different save generation \u2014 this build cannot open it.", "lose", 5200);
      } else {
        toast("That save is not usable.", "lose", 3800);
      }
      S.status = "error";
      S.message = "cloud save unusable";
      render();
      return false;
    }
    if (opts.keepStamp) adoptCloud(cloud);
    else { S.reconciled = true; setDeferred(null); }
    if (S.onApplied) { try { S.onApplied(res.summary); } catch (e) { console.error(e); } }
  } finally {
    applying = false;
  }
  /* Loading the cloud save settles the sync: whatever we were doing before
     (reconciling, asking) is done, and both sides now hold this run. */
  S.status = "synced";
  S.message = "";
  S.busy = false;
  toast((opts.label || "Cloud save") + " loaded \u2014 " + fmt(res.summary.money) + ", level " + res.summary.level + ".", "gold", 4400);
  if (opts.push && S.account) {
    try { await pushBlob(false, true); } catch (e) { fail(e, true); }
  }
  render();
  return true;
}

/* The two saves disagree. Ask -- always. The likely answer is the pre-selected
   button, and a fresh local run can never bury a real cloud save by itself. */
function askConflict(cloud, localSave) {
  return new Promise((resolve) => {
    const local = snapshotSummary(localSave);
    const cloudNewer = cloud.updatedAt > local.savedAt + 4000;
    const freshLocal = isFreshSnapshot(localSave);
    const preferCloud = freshLocal || cloudNewer;
    const why = freshLocal
      ? "This computer is still on a fresh run, so the cloud save is almost certainly the one you want."
      : cloudNewer
        ? "The cloud save was written more recently than this computer's save."
        : "This computer's save was written more recently than the cloud one.";

    const side = (title, s, savedAt, pick) => el("div", { class: "cloud-side" + (pick ? " pick" : "") },
      el("div", { class: "cloud-side-h", text: title }),
      el("div", { class: "cloud-side-big", text: fmt(s.money) }),
      el("div", { class: "cloud-side-line", text: "level " + s.level + " \u00B7 " + s.plays + (s.plays === 1 ? " hand played" : " hands played") }),
      el("div", { class: "cloud-side-sub", text: "saved " + ago(savedAt) })
    );

    const body = el("div", { class: "cloud-conflict" },
      el("p", { class: "cloud-lead", text: "Both saves are real, and they are different. Pick the one to keep \u2014 the other side gets overwritten." }),
      el("div", { class: "cloud-sides" },
        side("THIS COMPUTER", local, local.savedAt, !preferCloud),
        side("GOOGLE ACCOUNT" + (cloud.device && cloud.device.label ? " \u00B7 " + cloud.device.label : ""), cloud.summary, cloud.updatedAt, preferCloud)
      ),
      el("div", { class: "cloud-hint", text: why })
    );

    const chooseCloud = { label: "LOAD CLOUD SAVE", cls: "gold", onClick: () => resolve("cloud") };
    const chooseLocal = { label: "KEEP THIS COMPUTER", cls: "ghost", onClick: () => resolve("local") };
    modal({
      title: "Cloud save found",
      width: 580,
      body,
      buttons: preferCloud ? [chooseCloud, chooseLocal] : [chooseLocal, chooseCloud],
      onClose: () => resolve(null),
    });
  });
}

function askUnreadableCloud(cloud) {
  return new Promise((resolve) => {
    modal({
      title: cloud.reason === "json" ? "Cloud file is not readable" : "Cloud file is not a save",
      width: 520,
      body: el("div", {},
        el("p", { class: "cloud-lead", text: "The file in your Google account is not a Casino Royale save this build can read. Nothing on this computer has been touched." }),
        el("div", { class: "cloud-hint", text: "Overwriting it replaces that file with this computer's run. Cancel leaves it alone (and leaves cloud saves paused until you pick one)." })
      ),
      buttons: [
        { label: "OVERWRITE IT", cls: "gold", onClick: () => resolve("overwrite") },
        { label: "CANCEL", cls: "ghost", onClick: () => resolve(null) },
      ],
      onClose: () => resolve(null),
    });
  });
}

function askVersionMismatch(cloud, localSummary) {
  return new Promise((resolve) => {
    modal({
      title: "Cloud save is from another version",
      width: 540,
      body: el("div", {},
        el("p", { class: "cloud-lead", text: "The cloud save was written by save generation v" + cloud.saveVersion + ", and this build is v" + CONFIG.saveVersion + ". Loading it would be refused (that check is what keeps old saves from breaking the game)." }),
        el("div", { class: "cloud-hint", text: "You can upload this computer's run (" + fmt(localSummary.money) + ", level " + localSummary.level + ") over it instead." })
      ),
      buttons: [
        { label: "UPLOAD THIS RUN", cls: "gold", onClick: () => resolve("overwrite") },
        { label: "CANCEL", cls: "ghost", onClick: () => resolve(null) },
      ],
      onClose: () => resolve(null),
    });
  });
}

/* The heart of it: look at both sides and settle on one. */
async function reconcile(opts = {}) {
  if (!S.enabled) return false;
  if (!S.account) { toast("Sign in with Google first.", "info", 2600); return false; }
  if (S.busy) { schedulePush(4000); return false; }
  S.busy = true;
  S.status = "syncing";
  S.message = "";
  render();
  try {
    const meta = await driveFind(false);
    if (!meta) {
      await pushBlob(true);
      S.busy = false;
      return true;
    }
    S.fileId = meta.id;
    const text = await driveRead(meta.id);
    const cloud = parseCloud(text);
    const localSave = saveSnapshot();
    const localSummary = snapshotSummary(localSave);

    if (cloud.ok) {
      const cloudHash = cloud.hash;
      const localHash = hashSave(localSave);
      if (cloudHash === localHash) {
        adoptCloud(cloud);
        S.status = "synced";
        S.busy = false;
        render();
        return true;
      }
    }

    S.busy = false;

    if (!cloud.ok) {
      const pick = await askUnreadableCloud(cloud);
      if (pick === "overwrite") return await pushBlob(true, true);
      S.status = "dirty";
      S.message = "cloud file unreadable \u2014 nothing uploaded";
      setDeferred({ hash: "unreadable:" + hashText(text), updatedAt: 0 });
      render();
      return false;
    }

    if (cloud.saveVersion !== CONFIG.saveVersion) {
      const pick = await askVersionMismatch(cloud, localSummary);
      if (pick === "overwrite") return await pushBlob(true, true);
      S.status = "dirty";
      S.message = "cloud save is from save generation v" + cloud.saveVersion;
      render();
      return false;
    }

    const deferred = deferredChoice();
    if (opts.auto && deferred && deferred.hash === cloud.hash) {
      S.status = "dirty";
      S.message = "cloud save waiting for your answer";
      render();
      return false;
    }

    const pick = await askConflict(cloud, localSave);
    if (pick === "cloud") return await loadCloud(cloud, { keepStamp: true });
    if (pick === "local") return await pushBlob(true, true);
    /* dismissed: leave the cloud file alone and stop auto-uploading until the
       player answers, so the unanswered save can never be silently overwritten */
    setDeferred({ hash: cloud.hash, updatedAt: cloud.updatedAt });
    S.status = "dirty";
    S.message = "cloud save waiting for your answer";
    render();
    return false;
  } catch (e) {
    S.busy = false;
    return fail(e, opts.quiet === true);
  }
}

async function flushPush(quiet) {
  if (!S.enabled || !S.account || !S.reconciled) return false;
  if (S.busy) { schedulePush(5000); return false; }
  S.busy = true;
  try {
    await pushBlob(false);
    S.busy = false;
    return true;
  } catch (e) {
    S.busy = false;
    return fail(e, quiet === true);
  }
}

let pushTimer = null;
function schedulePush(delay) {
  if (!S.enabled || !S.account) return;
  if (!S.reconciled) { S.status = "dirty"; render(); return; }
  /* A save event can fire for something that changed nothing the cloud cares
     about -- the load-time re-stamp, or a rerender that saves again. Compare
     fingerprints before promising an upload, so the button doesn't flicker
     "SYNC" every few seconds on an idle game. */
  let same = false;
  try { same = !!(S.cloud && S.cloud.hash === hashSave(saveSnapshot())); } catch (e) { same = false; }
  if (same) {
    S.status = "synced";
    S.message = "";
    render();
    return;
  }
  S.status = "dirty";
  render();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; flushPush(true); }, Number(delay) > 0 ? Number(delay) : AUTO_PUSH_MS);
}

/* ------------------------------------------------------------------ *
   sign in / out
   ------------------------------------------------------------------ */
async function signIn() {
  if (!S.enabled) return false;
  if (S.busy) return false;
  S.status = "syncing";
  S.message = "";
  render();
  try {
    const token = await ensureToken(true);
    S.account = await fetchUser(token);
    S.reconciled = false;
    if (S.account.email) toast("Signed in as " + S.account.email + ".", "gold", 3000);
    else toast("Signed in to Google.", "gold", 2600);
    return await reconcile({});
  } catch (e) {
    return fail(e);
  }
}

async function silentSignIn() {
  if (!S.enabled || !clientId()) return false;
  try {
    const token = await ensureToken(false);
    S.account = await fetchUser(token);
    S.reconciled = false;
    render();
    return await reconcile({ auto: true, quiet: true });
  } catch (e) {
    /* no existing grant (or no third-party cookies) -- the player just uses the
       button. Silent failure is not an error the player needs to see. */
    clearToken();
    S.account = null;
    S.status = clientId() ? "ready" : "noclient";
    S.message = (e && e.code === "invalid_client") ? friendly(e) : "";
    if (e && e.code === "invalid_client") S.status = "error";
    render();
    return false;
  }
}

async function signOut() {
  const token = S.token;
  clearToken();
  S.account = null;
  S.cloud = null;
  S.fileId = "";
  S.reconciled = false;
  S.status = clientId() ? "ready" : "noclient";
  S.message = "";
  render();
  toast("Signed out \u2014 your run stays saved on this computer.", "info", 3200);
  try {
    const oauth2 = await loadGis();
    if (oauth2 && oauth2.revoke && token) oauth2.revoke(token, () => {});
  } catch (e) { /* revoking is best-effort */ }
}

async function deleteCloudSave() {
  const ok = await confirmDialog(
    "Delete the cloud save?",
    "This removes casino-royale-save.json from your Google account. Your run on this computer is untouched. Playing again will upload a fresh copy.",
    "Delete it", "red"
  );
  if (!ok) return false;
  try {
    if (!S.fileId) {
      const meta = await driveFind(false);
      if (meta) S.fileId = meta.id;
    }
    if (S.fileId) await driveDelete(S.fileId);
    S.fileId = "";
    S.cloud = null;
    S.reconciled = true;
    S.status = "dirty";
    S.message = "cloud copy deleted";
    setDeferred(null);
    render();
    toast("Cloud save deleted.", "info", 3000);
    return true;
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------------ *
   manual backup (works signed out, on any build)
   ------------------------------------------------------------------ */
function fileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return "casino-royale-save-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".json";
}

function downloadSave() {
  try {
    const blob = buildBlob();
    const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 1)], { type: "application/json" }));
    const a = el("a", { href: url, download: fileName() });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Save file downloaded.", "gold", 2600);
    return true;
  } catch (e) {
    toast("Could not build the save file.", "lose", 3000);
    return false;
  }
}

async function importSaveText(text, label) {
  const cloud = parseCloud(text);
  if (!cloud.ok) { toast("That file is not a Casino Royale save.", "lose", 3800); return false; }
  const cur = snapshotSummary(state);
  const ok = await confirmDialog(
    "Load this save" + (label ? " (" + label + ")" : "") + "?",
    "It replaces this computer's run (" + fmt(cur.money) + ", level " + cur.level + ") with " + fmt(cloud.summary.money) + ", level " + cloud.summary.level + ".",
    "Load it", "gold"
  );
  if (!ok) return false;
  return await loadCloud(cloud, { label: label || "Save file", keepStamp: false, push: true });
}

function pickSaveFile() {
  const input = el("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) { input.remove(); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      await importSaveText(String(reader.result || ""), file.name);
      input.remove();
    };
    reader.onerror = () => { toast("Could not read that file.", "lose", 3200); input.remove(); };
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
}

/* ------------------------------------------------------------------ *
   panel + button
   ------------------------------------------------------------------ */
let panel = null;

function statusText() {
  switch (S.status) {
    case "synced": return S.lastSyncAt ? "All changes saved \u00B7 last sync " + ago(S.lastSyncAt) : "All changes saved";
    case "syncing": return "Talking to Google Drive\u2026";
    case "dirty": return S.message || "Changes waiting to upload";
    case "error": return friendly({ code: "", message: S.message || "Cloud save problem" });
    case "noclient": return "Not set up yet";
    case "ready": return "Not signed in";
    default: return "Cloud saves are off on this build";
  }
}

function statusKind() {
  if (S.status === "synced") return "ok";
  if (S.status === "dirty") return "warn";
  if (S.status === "error") return "err";
  if (S.status === "syncing") return "busy";
  return "";
}

function pill(text, kind) {
  return el("div", { class: "cloud-pill " + (kind || ""), text });
}

function actionBtn(label, cls, fn, disabled) {
  return el("button", {
    class: "btn " + (cls || "ghost") + " cloud-act",
    type: "button",
    text: label,
    disabled: disabled === true ? "" : null,
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await fn(); }
      finally { b.disabled = false; }
    },
  });
}

function sideInfo(title, s, savedAt) {
  return el("div", { class: "cloud-side" },
    el("div", { class: "cloud-side-h", text: title }),
    el("div", { class: "cloud-side-big", text: fmt(s.money) }),
    el("div", { class: "cloud-side-line", text: "level " + s.level + " \u00B7 " + s.plays + (s.plays === 1 ? " hand" : " hands") }),
    el("div", { class: "cloud-side-sub", text: "saved " + ago(savedAt) })
  );
}

function localSides() {
  const cur = snapshotSummary(state);
  const cloud = S.cloud;
  return el("div", { class: "cloud-sides" },
    sideInfo("THIS COMPUTER", cur, cur.savedAt),
    cloud ? sideInfo("GOOGLE ACCOUNT", cloud.summary, cloud.updatedAt)
      : el("div", { class: "cloud-side" },
        el("div", { class: "cloud-side-h", text: "GOOGLE ACCOUNT" }),
        el("div", { class: "cloud-side-big", text: "\u2014" }),
        el("div", { class: "cloud-side-line", text: "nothing stored yet" }),
        el("div", { class: "cloud-side-sub", text: S.account ? "signing in will back this run up" : "not signed in" })
      )
  );
}

function setupBlock() {
  const origin = el("code", { class: "cloud-code", text: location.origin });
  return el("div", { class: "cloud-sec" },
    el("div", { class: "cloud-sec-h", text: "ONE-TIME SETUP (5 MINUTES)" }),
    el("p", { class: "cloud-lead", text: "Cloud saves need an OAuth client ID from your own Google account, and this site's address added to it. Until then the button is here but nothing can sign in." }),
    el("ol", { class: "cloud-steps" },
      el("li", { html: "Open <b>console.cloud.google.com</b>, create a project." }),
      el("li", { html: "APIs &amp; Services \u2192 Library \u2192 enable <b>Google Drive API</b>." }),
      el("li", { html: "OAuth consent screen \u2192 External \u2192 add yourself as a <b>test user</b>." }),
      el("li", { html: "Credentials \u2192 Create credentials \u2192 <b>OAuth client ID</b> \u2192 Web application." }),
      el("li", {}, "Authorized JavaScript origins \u2014 add this exact address:", el("div", { class: "cloud-codewrap" }, origin,
        el("button", {
          class: "btn ghost cloud-mini", type: "button", text: "COPY",
          onclick: () => copyText(location.origin),
        })
      )),
      el("li", { html: "Paste the generated client ID into <b>CLIENT_ID</b> at the top of <b>src/cloudsave.js</b> and upload it." })
    ),
    el("div", { class: "cloud-hint", text: "DEPLOY.md in the repo has the same steps written out, plus what to do if the sign-in popup is blocked." })
  );
}

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast("Copied: " + text, "gold", 2600),
        () => toast("Copy failed \u2014 select it by hand: " + text, "info", 5200)
      );
      return;
    }
  } catch (e) { /* fall through */ }
  toast("Copy this by hand: " + text, "info", 6000);
}

function signInBlock() {
  return el("div", { class: "cloud-sec" },
    el("p", { class: "cloud-lead", text: "Sign in and this run is copied to a small hidden file in your own Google Drive, then pulled back automatically on any other computer you sign in on." }),
    el("div", { class: "cloud-acts" },
      el("button", {
        class: "btn cloud-gbtn", type: "button",
        onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await signIn(); } finally { b.disabled = false; } },
      },
        el("span", { class: "g-mark", text: "G" }),
        el("span", { text: "Sign in with Google" })
      ),
      actionBtn("SYNC NOW", "ghost", () => reconcile({}))
    ),
    el("div", { class: "cloud-hint", text: "If nothing opens, allow popups for this site. Google may show an \"unverified app\" warning while the app is in testing \u2014 that is expected; continue to the app." }),
    localSides()
  );
}

function accountBlock() {
  const a = S.account || {};
  const initial = (a.email || a.name || "G").trim().slice(0, 1).toUpperCase() || "G";
  const ava = a.picture
    ? el("img", { class: "cloud-ava", src: a.picture, alt: "", referrerpolicy: "no-referrer" })
    : el("div", { class: "cloud-ava cloud-ava-txt", text: initial });
  return el("div", { class: "cloud-sec" },
    el("div", { class: "cloud-acct" },
      ava,
      el("div", { class: "cloud-acct-txt" },
        el("div", { class: "cloud-acct-name", text: a.name || a.email || "Google account" }),
        a.email ? el("div", { class: "cloud-acct-mail", text: a.email }) : null
      ),
      pill(statusText(), statusKind())
    ),
    localSides(),
    el("div", { class: "cloud-acts" },
      actionBtn("SYNC NOW", "gold", () => reconcile({})),
      actionBtn("UPLOAD THIS COMPUTER", "ghost", () => pushBlob(true, true)),
      actionBtn("DOWNLOAD CLOUD SAVE", "ghost", async () => {
        const meta = await driveFind(false);
        if (!meta) { toast("There is no cloud save to download yet.", "info", 3000); return; }
        S.fileId = meta.id;
        const cloud = parseCloud(await driveRead(meta.id));
        if (!cloud.ok) { toast("The cloud file is not a readable save.", "lose", 3800); return; }
        const pick = await askConflict(cloud, saveSnapshot());
        if (pick === "cloud") await loadCloud(cloud, { keepStamp: true });
        else if (pick === "local") await pushBlob(true, true);
      }),
      actionBtn("SIGN OUT", "ghost", () => signOut())
    ),
    el("div", { class: "cloud-acts" },
      actionBtn("DELETE CLOUD SAVE", "ghost danger", () => deleteCloudSave())
    ),
    el("div", { class: "cloud-hint", text: "Stored as " + DRIVE_FILE + " in this app's hidden Drive folder (" + (S.cloud && S.cloud.device && S.cloud.device.label ? "last written by " + S.cloud.device.label : "not visible in your normal Drive list") + ")." })
  );
}

function backupBlock() {
  return el("div", { class: "cloud-sec" },
    el("div", { class: "cloud-sec-h", text: "MANUAL BACKUP" }),
    el("div", { class: "cloud-hint", text: "Works with or without an account: download the run as a small file and load it on any other computer. Handy if a browser is clearing its storage on exit, or you play on a shared PC." }),
    el("div", { class: "cloud-acts" },
      actionBtn("DOWNLOAD SAVE FILE", "ghost", () => downloadSave()),
      actionBtn("LOAD SAVE FILE", "ghost", () => { pickSaveFile(); })
    )
  );
}

function panelBody() {
  const wrap = el("div", { class: "cloud-body" });
  if (!S.enabled) {
    wrap.appendChild(el("p", { class: "cloud-lead", text: "Cloud saves are switched off on this build (the cloudSaves knob in main.pjs is 0)." }));
    wrap.appendChild(backupBlock());
    return wrap;
  }
  wrap.appendChild(el("div", { class: "cloud-status " + statusKind() },
    el("span", { class: "cloud-dot" }),
    el("span", { text: statusText() })
  ));
  if (!clientId()) wrap.appendChild(setupBlock());
  else if (!S.account) wrap.appendChild(signInBlock());
  else wrap.appendChild(accountBlock());
  wrap.appendChild(backupBlock());
  wrap.appendChild(el("p", { class: "cloud-fine", text: "Saving is always local first. Signing in only mirrors the save into your own Google Drive \u2014 there is no game server, and nothing is sent to the person who made this game." }));
  return wrap;
}

function renderPanel() {
  if (!panel) return;
  clear(panel.body);
  panel.body.appendChild(panelBody());
}

function render() {
  renderBtn();
  renderPanel();
}

function renderBtn() {
  const btn = document.getElementById("cloudBtn");
  if (!btn) return;
  if (!S.enabled) { btn.hidden = true; return; }
  const txt = btn.querySelector(".cloud-txt");
  btn.hidden = false;
  btn.classList.remove("ok", "warn", "err", "busy");
  const kind = statusKind();
  if (kind === "ok") btn.classList.add("ok");
  else if (kind === "warn") btn.classList.add("warn");
  else if (kind === "err") btn.classList.add("err");
  else if (kind === "busy") btn.classList.add("busy");
  const label = S.status === "synced" ? "SYNCED"
    : S.status === "dirty" ? "SYNC"
      : S.status === "syncing" ? "SYNCING"
        : S.status === "error" ? "CLOUD !"
          : S.status === "noclient" ? "CLOUD"
            : S.account ? "CLOUD" : "SIGN IN";
  if (txt) txt.textContent = label;
  const title = statusText();
  btn.title = title;
  btn.setAttribute("aria-label", "Cloud saves \u2014 " + title);
}

export function openCloudPanel() {
  if (panel) { renderPanel(); return panel; }
  panel = modal({
    title: "Cloud Save",
    width: 640,
    body: el("div", { class: "cloud-body" }),
    onClose: () => { panel = null; },
  });
  renderPanel();
  return panel;
}

/* ------------------------------------------------------------------ *
   init
   ------------------------------------------------------------------ */
export function initCloud(opts = {}) {
  let forced = false;
  try {
    forced = window.CASINO_CLOUD_FORCE === true || /[?&]cloud\b/.test(location.search);
  } catch (e) { /* ignore */ }
  S.enabled = opts.enabled !== false || forced;
  S.onApplied = typeof opts.onApplied === "function" ? opts.onApplied : null;
  S.canApply = typeof opts.canApply === "function" ? opts.canApply : null;
  S.status = S.enabled ? (clientId() ? "ready" : "noclient") : "off";

  const btn = document.getElementById("cloudBtn");
  if (btn) {
    btn.hidden = !S.enabled;
    if (S.enabled) btn.addEventListener("click", () => openCloudPanel());
  }

  on("saved", () => { if (S.enabled && S.account && !applying) schedulePush(); });

  try {
    window.addEventListener("pagehide", () => { if (S.account) flushPush(true); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && S.account) flushPush(true);
    });
  } catch (e) { /* ignore */ }

  render();
  if (S.enabled && clientId()) silentSignIn();
  return cloud;
}

export const cloud = {
  state: S,
  panel: openCloudPanel,
  signIn,
  signOut,
  deleteCloudSave,
  syncNow: () => reconcile({}),
  upload: () => pushBlob(true, true),
  downloadSave,
  importSaveText,
  pickSaveFile,
  clientId,
  /* Seams for testing the sync engine without a live Google account, and for
     poking at it from the console. `setFetch` swaps the network layer, and
     `setTokenProvider` stands in for Google sign-in. */
  debug: {
    setFetch(fn) { apiFetch = typeof fn === "function" ? fn : ((url, o) => fetch(url, o)); },
    setTokenProvider(fn) { tokenProvider = typeof fn === "function" ? fn : null; },
    setToken(token, ttlMs) { storeToken(token, (Number(ttlMs) || 3600000) / 1000); },
    forgetToken: clearToken,
    buildBlob,
    parseCloud,
    reconcile,
    pushBlob,
    loadCloud,
    driveFind,
    driveRead,
    driveWrite,
    hashText,
    hashSave,
    adoptCloud,
    deferred: { get: deferredChoice, set: setDeferred },
  },
};
