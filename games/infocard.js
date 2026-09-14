import { el, modal } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs, ...kids) {
  const node = document.createElementNS(NS, tag);
  if (attrs && typeof attrs === "object") {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function infoBtn(onclick, label = "HOW TO WIN") {
  return el("button", {
    class: "infobtn", type: "button", title: "How this game works",
    onclick: (e) => { e.preventDefault(); onclick(); },
  }, "\u24D8", el("span", { class: "infobtn-lbl", text: " " + label }));
}

export function openInfo(title, body, width = 780) {
  return modal({ title, width, body, buttons: [{ label: "GOT IT", cls: "gold" }] });
}

export function sec(title, ...kids) {
  return el("div", { class: "ic-sec" }, el("h3", { text: title }), ...kids);
}

export function ul(items) {
  return el("ul", {}, ...items.map((h) => el("li", { html: h })));
}

export function note(html) {
  return el("div", { class: "ic-fs", html });
}

export function cap(html) {
  return el("div", { class: "ic-cap", html });
}

export function exampleRow(cells, noteHtml) {
  return el("div", { class: "ic-ex" },
    el("div", { class: "ic-excells" }, ...cells.map((g) =>
      el("div", { class: "ic-excell" + (g === "" ? " blank" : " win"), text: g })
    )),
    el("div", { class: "ic-exnote", html: noteHtml })
  );
}

export function examples(...rows) {
  return el("div", { class: "ic-examples" }, ...rows);
}

export function payChips(items) {
  return el("div", { class: "ml-pay" }, ...items.map((it) =>
    el("div", { class: "mlchip" + (it.cls ? " " + it.cls : "") },
      it.glyph ? el("span", { class: "g", text: it.glyph }) : null,
      el("span", { class: "triple", text: it.main }),
      it.note ? el("span", { class: "note", text: it.note }) : null
    )
  ));
}

export function gridMap(cols, rows, opts = {}) {
  const cell = opts.cell || 42;
  const gap = opts.gap === undefined ? 6 : opts.gap;
  const node = el("div", { class: "ic-grid" });
  node.style.gridTemplateColumns = "repeat(" + cols + "," + cell + "px)";
  node.style.gridTemplateRows = "repeat(" + rows + "," + cell + "px)";
  node.style.gap = gap + "px";
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cnode = el("div", { class: "ic-cell" });
      row.push(cnode);
      node.appendChild(cnode);
    }
    cells.push(row);
  }
  const w = cols * cell + (cols - 1) * gap;
  const h = rows * cell + (rows - 1) * gap;
  const svg = svgEl("svg", { class: "ic-svg", viewBox: "0 0 " + w + " " + h });
  node.appendChild(svg);
  return {
    node, cells, svg, cell, gap, w, h,
    px: (c) => c * (cell + gap) + cell / 2,
    py: (r) => r * (cell + gap) + cell / 2,
  };
}

export function legend(items, onPick, allItem, initial) {
  const wrap = el("div", { class: "ic-legend" });
  const entries = [];
  const add = (item, isAll) => {
    const btn = el("button", {
      class: "ic-lbtn" + (isAll ? " all" : ""), type: "button",
      text: item.label, title: item.title || "",
      onclick: () => pick(item.value),
    });
    if (item.color) btn.style.setProperty("--lc", item.color);
    wrap.appendChild(btn);
    entries.push({ btn, item });
  };
  if (allItem) add(allItem, true);
  items.forEach((it) => add(it, false));
  const start = initial !== undefined ? initial : allItem ? allItem.value : null;
  function pick(value) {
    for (const { btn, item } of entries) btn.classList.toggle("on", item.value === value);
    last = value;
    onPick(value);
  }
  let last = start;
  pick(start);
  return { node: wrap, pick, get value() { return last; } };
}

export function markCells(cells, coords, color) {
  for (const row of cells) for (const c of row) { c.classList.remove("lit"); c.style.removeProperty("--lc"); }
  for (const [r, c] of coords) {
    const node = cells[r] && cells[r][c];
    if (!node) continue;
    node.classList.add("lit");
    if (color) node.style.setProperty("--lc", color);
  }
}
