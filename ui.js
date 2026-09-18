/* ---------- tiny DOM helper ---------- */
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    }
  } else if (attrs !== undefined && attrs !== null) {
    kids.unshift(attrs);
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ---------- numbers ---------- */
/* money is whole dollars only — never show cents */
export function fmt(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const a = Math.abs(v);
  let s;
  if (a >= 1e12) s = Math.round(a / 1e12) + "T";
  else if (a >= 1e9) s = (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  else s = Math.round(a).toLocaleString("en-US");
  return (neg ? "-$" : "$") + s;
}

export function fmtShort(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v));
}

export function mult(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + "x";
}

export function pct(n, digits = 1) { return (n * 100).toFixed(digits) + "%"; }

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
export function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------- perchance flavour lists ---------- */
export function flavor(listName) {
  try {
    const g = window.root;
    if (!g) return "";
    const list = g[listName];
    if (list === undefined || list === null) return "";
    if (typeof list === "string") return list;
    if (typeof list === "number") return String(list);
    if (typeof list.selectOne !== "undefined") return String(list.selectOne.evaluateItem);
    if (typeof list.evaluateItem !== "undefined") return String(list.evaluateItem);
    return String(list);
  } catch (e) {
    return "";
  }
}

/* ---------- toasts ---------- */
/* `msg` is usually a string, but a Node is allowed so a message can carry
   symbol artwork (see src/sprites.js) without giving up the toast styling. */
export function toast(msg, kind = "info", ms = 2400) {
  const layer = document.getElementById("toastLayer");
  if (!layer) return;
  const node = el("div", { class: "toast " + kind },
    msg instanceof Node ? msg : document.createTextNode(String(msg)));
  layer.appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 320);
  }, ms);
  while (layer.children.length > 5) layer.firstChild.remove();
  return node;
}

/* ---------- floating numbers ---------- */
export function floatText(x, y, text, kind = "win") {
  const layer = document.getElementById("fxLayer");
  if (!layer) return;
  const node = el("div", { class: "floaty " + kind, text, style: { left: x + "px", top: y + "px" } });
  layer.appendChild(node);
  setTimeout(() => node.remove(), 1600);
}

export function floatAtElement(target, text, kind = "win") {
  const elNode = typeof target === "string" ? document.querySelector(target) : target;
  const r = elNode ? elNode.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  floatText(r.left + r.width / 2, r.top + r.height / 2, text, kind);
}

/* ---------- win popup (big, fades away) ---------- */
export function winPopup({ amount = 0, mult: m = 0, label = "WIN" } = {}) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return null;
  const node = el("div", { class: "winpop" },
    el("div", { class: "wp-label", text: label }),
    el("div", { class: "wp-amount", text: fmt(amount) }),
    m > 1 ? el("div", { class: "wp-mult", text: mult(m) }) : null
  );
  layer.appendChild(node);
  while (layer.querySelectorAll(".winpop").length > 3) {
    const old = layer.querySelector(".winpop");
    if (!old) break;
    old.remove();
  }
  const life = 2100;
  setTimeout(() => node.classList.add("out"), life);
  setTimeout(() => node.remove(), life + 420);
  return node;
}

export function confetti(count = 60) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return;
  const colors = ["#f2c14e", "#37d67a", "#4d9fff", "#ff5fa2", "#a06bff", "#ff7c88"];
  for (let i = 0; i < count; i++) {
    const c = el("div", { class: "confetti" });
    c.style.left = Math.random() * 100 + "%";
    c.style.top = "-20px";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    c.style.animationDelay = Math.random() * 0.5 + "s";
    layer.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

export function shake(node) {
  if (!node) return;
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
  setTimeout(() => node.classList.remove("shake"), 500);
}

/* ---------- modals ---------- */
const modalStack = [];

export function modal({ title, body, buttons = [], dismissible = true, width, onClose }) {
  const layer = document.getElementById("modalLayer");
  const box = el("div", { class: "modal" });
  if (width) box.style.width = "min(96vw," + width + "px)";

  const head = el("div", { class: "modal-head" },
    el("h2", { text: title || "" }),
    dismissible ? el("button", {
      class: "x-btn", type: "button", text: "\u2715",
      onclick: () => api.close(),
    }) : null
  );
  const bodyWrap = el("div", { class: "modal-body" });
  if (body) bodyWrap.appendChild(body instanceof Node ? body : el("div", { html: body }));
  box.appendChild(head);
  box.appendChild(bodyWrap);

  const api = {
    el: box,
    body: bodyWrap,
    close() {
      const i = modalStack.indexOf(api);
      if (i >= 0) modalStack.splice(i, 1);
      box.remove();
      if (modalStack.length === 0) layer.hidden = true;
      if (onClose) onClose();
    },
    setLocked(locked) { api.locked = locked; },
  };

  if (buttons.length) {
    const foot = el("div", { class: "modal-foot" });
    for (const b of buttons) {
      foot.appendChild(el("button", {
        class: "btn " + (b.cls || ""),
        type: "button",
        text: b.label,
        onclick: () => {
          if (b.onClick) b.onClick(api);
          if (b.keepOpen !== true) api.close();
        },
      }));
    }
    box.appendChild(foot);
  }

  layer.hidden = false;
  layer.appendChild(box);
  modalStack.push(api);

  layer.onclick = (e) => {
    if (e.target !== layer) return;
    const top = modalStack[modalStack.length - 1];
    if (top && top.dismissible !== false && dismissible) top.close();
  };

  return api;
}

export function closeAllModals() {
  while (modalStack.length) modalStack.pop().close();
}

export function confirmDialog(title, message, okLabel = "Confirm", okCls = "red") {
  return new Promise((resolve) => {
    modal({
      title,
      dismissible: true,
      body: el("div", { class: "gameover-sub", text: message }),
      buttons: [
        { label: "Cancel", cls: "ghost", onClick: () => resolve(false) },
        { label: okLabel, cls: okCls, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ---------- misc ---------- */

/* Where the privacy policy lives (privacy.html -- also the "Application privacy
   policy link" on the Google OAuth consent screen). On the static mirror the page
   sits right beside this one, so a relative link is the correct one there, and it
   survives a repo rename or a fork. Inside the Perchance iframe there is no such
   file next to the page, so it points at the published GitHub Pages copy instead. */
const MIRROR_PRIVACY_URL = "https://chrislegend95.github.io/Casino-Royale/privacy.html";
export function privacyUrl() {
  try {
    if (location.protocol === "http:" || location.protocol === "https:") {
      return /perchance\.org$/i.test(location.hostname) ? MIRROR_PRIVACY_URL : "privacy.html";
    }
  } catch (e) { /* fall through */ }
  return MIRROR_PRIVACY_URL;
}

export function animateNumber(node, from, to, ms = 550, formatter = fmt) {
  if (!node) return;
  const t0 = performance.now();
  const dur = Math.max(120, ms);
  cancelAnimationFrame(node.__anim || 0);
  node.__from = from;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const v = from + (to - from) * eased;
    node.textContent = formatter(v);
    if (k < 1) node.__anim = requestAnimationFrame(step);
    else node.textContent = formatter(to);
  };
  node.__anim = requestAnimationFrame(step);
}
