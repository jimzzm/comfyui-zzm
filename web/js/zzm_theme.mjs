// AI-zzm 主题层 —— 配色取自 Radix Colors（Slate + Orange 12 级色阶）
//
// 为什么用它：Radix 是目前唯一把「每一级色阶对应什么用途 + 对比度」写死的
// 公开配色系统（1~2 底色 / 3~4 次级面 / 5~6 控件底 / 7~8 描边 / 9~10 实心 /
// 11~12 文字，对比度按 APCA 逐级校验），而且天生带浅色与深色两套。
//
// 关键改动（针对「底色太深、不跟系统配色」）：
//   · 不再写死 #1d1d1d 这种近黑色，深色主题用 slate-3/4/5，整体提亮一档
//   · 所有颜色走 CSS 变量，浅色 / 深色各一套，主题一变整套跟着换
//   · 文字用 slate-11/12，不用纯黑纯白（纯白在深色底上刺眼）
//
// .mjs 不会被 ComfyUI 当扩展自动加载，只供 import。

// ---------------------------------------------------------------------------
// 两套色板（Radix Colors v3 的 slate / orange）
// ---------------------------------------------------------------------------
const DARK = {
  name: "dark",
  title: "#2e3135",      // slate-5  节点标题栏
  body: "#272a2d",       // slate-4  节点主体
  field: "#212225",      // slate-3  输入框底
  line: "#43484e",       // slate-7  常规描边
  lineSoft: "#363a3f",   // slate-6  弱描边
  text: "#edeef0",       // slate-12 正文
  dim: "#b0b4ba",        // slate-11 次要文字
  chipBg: "#2e3135",     // slate-5
  chipLine: "#43484e",   // slate-7
  panel: "#212225",      // slate-3  弹窗
  view: "#18191b",       // slate-2  图片区
  acc: "#C05C43",        // 比 orange-9 沉一档，压住对比
  accHi: "#f0763a",      // 悬停亮一点
  accText: "#e8a184",    // 深底上的橙字
  ok: "#3dd68c",
  warn: "#ffca16",
  err: "#ff9592",
};

const LIGHT = {
  name: "light",
  title: "#e8e8ec",      // slate-4
  body: "#fcfcfd",       // slate-1
  field: "#ffffff",
  line: "#cdced6",       // slate-7
  lineSoft: "#d9d9e0",   // slate-6
  text: "#1c2024",       // slate-12
  dim: "#60646c",        // slate-11
  chipBg: "#f0f0f3",     // slate-3
  chipLine: "#d9d9e0",
  panel: "#ffffff",
  view: "#f0f0f3",
  acc: "#c9500a",
  accHi: "#dd5f14",
  accText: "#a03e00",    // 白底上的橙字
  ok: "#218358",
  warn: "#ab6400",
  err: "#ce2c31",
};

// 组件里统一用 var(--zzm-acc) 引用，节点可单独覆盖
export const ACC = "var(--zzm-acc,#C05C43)";

// ---------------------------------------------------------------------------
// 主题判定
// ---------------------------------------------------------------------------
export function themeName() {
  // 1) ComfyUI 设置里明确写了 dark / light
  try {
    const v = window.app?.ui?.settings?.getSettingValue?.("Comfy.ColorPalette");
    if (v === "dark" || v === "light") return v;
  } catch (_) {}
  // 2) body 上的主题类
  const cls = document.body?.classList;
  if (cls?.contains("dark-theme")) return "dark";
  if (cls?.contains("light-theme")) return "light";
  // 3) 兜底：量一下 body 背景亮度
  try {
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const m = bg.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) {
      const [r, g, b] = m.map(Number);
      return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "light" : "dark";
    }
  } catch (_) {}
  return "dark";
}

export function palette(name) {
  return (name || themeName()) === "light" ? LIGHT : DARK;
}

// 把一套色板写成 CSS 变量挂到元素上
function writeVars(node, p) {
  const set = (k, v) => node.style.setProperty(k, v);
  set("--zzm-title", p.title);
  set("--zzm-body", p.body);
  set("--zzm-field", p.field);
  set("--zzm-line", p.line);
  set("--zzm-line-soft", p.lineSoft);
  set("--zzm-text", p.text);
  set("--zzm-dim", p.dim);
  set("--zzm-chip-bg", p.chipBg);
  set("--zzm-chip-line", p.chipLine);
  set("--zzm-panel", p.panel);
  set("--zzm-view", p.view);
  set("--zzm-acc", p.acc);
  set("--zzm-acc-hi", p.accHi);
  set("--zzm-acc-text", p.accText);
  set("--zzm-err", p.err);
  node.style.setProperty("color-scheme", p.name === "light" ? "light" : "dark");
  return p;
}

// 同一套变量也挂到 <html> 上：弹窗挂 body 也能拿到主题色
export function syncGlobalTheme(name) {
  const p = palette(name);
  if (document.documentElement) writeVars(document.documentElement, p);
  return p;
}

export function applyThemeVars(node, name) {
  const p = palette(name);
  if (node?.style) writeVars(node, p);
  return p;
}

// 主题切换订阅：ComfyUI 换配色时重新上色（返回取消函数）
export function onThemeChange(cb) {
  let last = themeName();
  const fire = () => {
    const now = themeName();
    if (now === last) return;
    last = now;
    cb(now);
  };
  const obs = new MutationObserver(fire);
  obs.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  try {
    window.app?.ui?.settings?.addEventListener?.("Comfy.ColorPalette.change", fire);
  } catch (_) {}
  return () => obs.disconnect();
}

// ---------------------------------------------------------------------------
// 样式表：只引用变量，深浅两套自动生效
// ---------------------------------------------------------------------------
const CSS_ID = "zzm-theme-css";

const CSS = `
.zzm-root{position:relative;width:100%;height:100%;box-sizing:border-box;color:var(--zzm-text,#edeef0);
  font-family:'Segoe UI',system-ui,'Microsoft YaHei',sans-serif;}
.zzm-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;
  padding:8px 10px 6px;box-sizing:border-box;overflow:hidden;}

.zzm-top{display:flex;align-items:center;gap:6px;flex:0 0 auto;margin:-4px 0 -2px;}

.zzm-lab{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;
  color:var(--zzm-acc-text,#ffa057);margin-bottom:3px;flex:0 0 auto;}
.zzm-row{display:flex;gap:6px;align-items:center;flex:0 0 auto;}
.zzm-col{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 0;}

.zzm-field{width:100%;box-sizing:border-box;background:var(--zzm-field,#212225);
  border:1px solid var(--zzm-line,#43484e);border-radius:4px;color:var(--zzm-text,#edeef0);
  padding:5px 8px;font-size:12px;outline:none;font-family:inherit;}
.zzm-field::placeholder{color:var(--zzm-dim,#b0b4ba);opacity:.65;}
.zzm-field:focus{border-color:var(--zzm-acc,#C05C43);}
.zzm-field.mono{font-family:Consolas,ui-monospace,monospace;}
.zzm-field.ta{resize:none;line-height:1.5;padding:7px 8px;}

.zzm-btn{box-sizing:border-box;background:var(--zzm-chip-bg,#2e3135);border:1px solid var(--zzm-chip-line,#43484e);
  color:var(--zzm-text,#edeef0);border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;flex:0 0 auto;
  font-family:inherit;user-select:none;transition:background .1s,color .1s,border-color .1s;}
.zzm-btn:hover{background:var(--zzm-acc,#C05C43);border-color:var(--zzm-acc,#C05C43);color:#fff;}
.zzm-btn.on{background:var(--zzm-acc,#C05C43);border-color:var(--zzm-acc,#C05C43);color:#fff;}
.zzm-btn:disabled{opacity:.45;cursor:default;}
.zzm-btn:disabled:hover{background:var(--zzm-chip-bg,#2e3135);border-color:var(--zzm-chip-line,#43484e);color:var(--zzm-text,#edeef0);}
.zzm-btn.sq{padding:4px 7px;font-size:11.5px;}

.zzm-chip{background:var(--zzm-chip-bg,#2e3135);border:1px solid var(--zzm-chip-line,#43484e);
  color:var(--zzm-text,#edeef0);opacity:.92;border-radius:4px;padding:2px 7px;font-size:11.5px;
  cursor:pointer;font-family:inherit;user-select:none;white-space:nowrap;}
.zzm-chip:hover{border-color:var(--zzm-acc,#C05C43);opacity:1;}
.zzm-chip.on{background:var(--zzm-acc,#C05C43);border-color:var(--zzm-acc,#C05C43);color:#fff;opacity:1;}

.zzm-seg{display:inline-flex;border:1px solid var(--zzm-line,#43484e);border-radius:999px;overflow:hidden;
  flex:0 0 auto;max-width:100%;}
.zzm-seg button{background:var(--zzm-field,#212225);color:var(--zzm-text,#edeef0);opacity:.8;border:none;
  padding:4px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;white-space:nowrap;}
.zzm-seg button:hover{opacity:1;}
.zzm-seg button.on{background:var(--zzm-acc,#C05C43);color:#fff;opacity:1;}
.zzm-seg.wrap{flex-wrap:wrap;border-radius:6px;}

.zzm-sw{width:30px;height:16px;border-radius:8px;background:var(--zzm-line,#43484e);position:relative;
  display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}
.zzm-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;
  background:#fff;transition:left .15s;}
.zzm-sw.on{background:var(--zzm-acc,#C05C43);}
.zzm-sw.on::after{left:16px;}

.zzm-box{background:var(--zzm-view,#18191b);border:1px solid var(--zzm-line-soft,#363a3f);border-radius:4px;overflow:hidden;}
.zzm-panel{position:fixed;z-index:10020;width:320px;max-width:94vw;background:var(--zzm-panel,#212225);
  border:1px solid var(--zzm-line,#43484e);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.35);
  font-family:'Segoe UI',system-ui,'Microsoft YaHei',sans-serif;display:flex;flex-direction:column;
  max-height:70vh;overflow:hidden;color:var(--zzm-text,#edeef0);}
.zzm-ph{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
  border-bottom:1px solid var(--zzm-line-soft,#363a3f);font-size:12px;font-weight:600;}
.zzm-px{border:0;background:transparent;color:var(--zzm-dim,#b0b4ba);font-size:13px;cursor:pointer;
  padding:0 6px;border-radius:4px;}
.zzm-px:hover{color:var(--zzm-text,#edeef0);background:var(--zzm-chip-bg,#2e3135);}
.zzm-pb{padding:8px 10px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;}
.zzm-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;}
.zzm-item{padding:5px 8px;font-size:12px;color:var(--zzm-text,#edeef0);border-radius:4px;cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.zzm-item:hover{background:var(--zzm-chip-bg,#2e3135);}
.zzm-item.on{background:var(--zzm-acc,#C05C43);color:#fff;}

.zzm-hint{font-size:11px;color:var(--zzm-dim,#b0b4ba);line-height:1.45;flex:0 0 auto;}
.zzm-badge{background:rgba(192,92,67,.16);background:color-mix(in srgb,var(--zzm-acc,#C05C43) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--zzm-acc,#C05C43) 45%,transparent);
  color:var(--zzm-acc-text,#ffa057);border-radius:999px;padding:1px 8px;font-size:11.5px;
  white-space:nowrap;flex:0 0 auto;}
.zzm-err{color:var(--zzm-err,#ff9592);font-size:11.5px;}

.zzm-wall{flex:1 1 0;min-height:90px;overflow-y:auto;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:4px;padding:4px;
  background:var(--zzm-view,#18191b);border:1px solid var(--zzm-line-soft,#363a3f);border-radius:4px;}
.zzm-cell{position:relative;aspect-ratio:1/1;border-radius:3px;overflow:hidden;cursor:pointer;
  background:var(--zzm-field,#212225);border:1px solid var(--zzm-line-soft,#363a3f);display:flex;
  align-items:center;justify-content:center;}
.zzm-cell img{width:100%;height:100%;object-fit:cover;display:block;}
.zzm-cell:hover{border-color:rgba(192,92,67,.6);border-color:color-mix(in srgb,var(--zzm-acc,#C05C43) 60%,transparent);}
.zzm-cell.on{border-color:var(--zzm-acc,#C05C43);box-shadow:inset 0 0 0 1px var(--zzm-acc,#C05C43);}
.zzm-cell.on::after{content:"✓";position:absolute;right:2px;top:1px;font-size:11px;color:#fff;
  text-shadow:0 0 3px #000;line-height:1;}
.zzm-cell .zzm-cn{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.62);color:#fff;
  font-size:10.5px;padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

.zzm-lrow{display:flex;align-items:center;gap:4px;background:var(--zzm-chip-bg,#2e3135);
  border:1px solid var(--zzm-line-soft,#363a3f);border-radius:4px;padding:3px 4px;flex:0 0 auto;}
.zzm-lrow.off{opacity:.5;}
.zzm-lname{flex:1 1 0;min-width:0;font-size:11.5px;color:var(--zzm-text,#edeef0);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding:2px 3px;border-radius:3px;}
.zzm-lname:hover{background:color-mix(in srgb,var(--zzm-text,#edeef0) 10%,transparent);}
.zzm-num{width:46px;flex:0 0 auto;background:var(--zzm-field,#212225);border:1px solid var(--zzm-line,#43484e);
  border-radius:3px;color:var(--zzm-text,#edeef0);font-size:11.5px;padding:2px 3px;text-align:center;
  font-family:Consolas,monospace;cursor:ew-resize;outline:none;box-sizing:border-box;}
.zzm-num:focus{border-color:var(--zzm-acc,#C05C43);}
.zzm-x{width:18px;height:18px;flex:0 0 auto;border:none;border-radius:3px;background:transparent;
  color:var(--zzm-dim,#b0b4ba);cursor:pointer;font-size:12px;line-height:1;padding:0;}
.zzm-x:hover{background:rgba(255,90,70,.25);background:color-mix(in srgb,var(--zzm-err,#ff9592) 28%,transparent);color:var(--zzm-text,#edeef0);}
.zzm-tog{width:18px;height:18px;flex:0 0 auto;border:1px solid var(--zzm-line,#43484e);border-radius:3px;
  background:var(--zzm-field,#212225);color:transparent;cursor:pointer;font-size:11.5px;line-height:1;padding:0;}
.zzm-tog.on{background:var(--zzm-acc,#C05C43);border-color:var(--zzm-acc,#C05C43);color:#fff;}

.zzm-prev{flex:0 0 auto;height:92px;overflow-y:auto;background:var(--zzm-view,#18191b);
  border:1px solid var(--zzm-line-soft,#363a3f);border-radius:4px;padding:4px 6px;
  font-family:Consolas,ui-monospace,monospace;font-size:11px;line-height:1.5;color:var(--zzm-dim,#b0b4ba);}
.zzm-prev b{color:var(--zzm-acc-text,#ffa057);font-weight:600;}
.zzm-prev .cur{color:var(--zzm-text,#edeef0);background:rgba(192,92,67,.22);
  background:color-mix(in srgb,var(--zzm-acc,#C05C43) 22%,transparent);border-radius:2px;}
`;

export function injectTheme() {
  syncGlobalTheme();
  if (!injectTheme._bound) {
    injectTheme._bound = true;
    onThemeChange((name) => syncGlobalTheme(name));
  }
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// DOM 工具
// ---------------------------------------------------------------------------
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function label(text) {
  return el("div", "zzm-lab", text);
}

export function btn(text, cls) {
  const b = el("button", "zzm-btn" + (cls ? " " + cls : ""), text);
  b.type = "button";
  return b;
}

export function chip(text) {
  const c = el("button", "zzm-chip", text);
  c.type = "button";
  return c;
}

export function seg(options, onPick) {
  const root = el("div", "zzm-seg");
  const map = new Map();
  for (const o of options) {
    const b = el("button", "", o.t ?? o.v);
    b.type = "button";
    b.dataset.v = o.v;
    b.onclick = () => { set(o.v); onPick?.(o.v); };
    map.set(o.v, b);
    root.appendChild(b);
  }
  function set(v) {
    for (const [k, b] of map) b.classList.toggle("on", k === v);
  }
  return { root, set };
}

export function toggle(on, onChange) {
  const s = el("span", "zzm-sw" + (on ? " on" : ""));
  s.onclick = () => {
    const next = !s.classList.contains("on");
    s.classList.toggle("on", next);
    onChange?.(next);
  };
  return s;
}

export function scrub(input, { min = -100, max = 100, step = 0.05 } = {}) {
  input.type = "text";
  let dragging = false, startX = 0, startV = 0;
  input.addEventListener("pointerdown", (e) => {
    if (document.activeElement === input) return;
    dragging = true;
    startX = e.clientX;
    startV = parseFloat(input.value) || 0;
    input.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  input.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const v = Math.max(min, Math.min(max, startV + (e.clientX - startX) * step));
    input.value = (Math.round(v * 100) / 100).toFixed(2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { input.releasePointerCapture(e.pointerId); } catch (_) {}
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);
  input.addEventListener("dblclick", () => { input.focus(); input.select(); });
  return input;
}

// ---------------------------------------------------------------------------
// 与 ComfyUI 打交道的工具
// ---------------------------------------------------------------------------
export function hideWidget(node, name) {
  const w = (node.widgets || []).find((x) => x && x.name === name);
  if (!w) return null;
  w.hidden = true;
  w.computeSize = () => [0, -4];
  w.options = w.options || {};
  w.options.canvasOnly = true;
  const e = w.element || w.inputEl;
  if (e) e.style.display = "none";
  return w;
}

export function hideWidgets(node, names) {
  const out = {};
  for (const n of names) out[n] = hideWidget(node, n);
  requestAnimationFrame(() => {
    for (const w of node.widgets || []) {
      if (!w || w.name === "zzm_ui") continue;
      const e = w.element || w.inputEl;
      if (e) e.style.display = "none";
    }
  });
  return out;
}

export function keepWidthAuto(widget) {
  if (!widget) return widget;
  try {
    Object.defineProperty(widget, "width", {
      get() { return undefined; },
      set(_v) {},
      configurable: true,
    });
  } catch (_) {}
  return widget;
}

let _changeTimer = null;
export function markChanged(node) {
  node?.setDirtyCanvas?.(true, true);
  window.app?.graph?.setDirtyCanvas?.(true, true);
  if (_changeTimer) clearTimeout(_changeTimer);
  _changeTimer = setTimeout(() => {
    _changeTimer = null;
    try {
      const wf = window.app?.extensionManager?.workflow?.activeWorkflow
        || window.app?.workflowManager?.activeWorkflow;
      const t = wf?.changeTracker;
      if (!t) return;
      if (typeof t.captureCanvasState === "function") t.captureCanvasState();
      else t.checkState?.();
    } catch (_) {}
  }, 120);
}

export function toast(severity, detail, summary = "AI-zzm") {
  try {
    const t = window.app?.extensionManager?.toast;
    if (t?.add) { t.add({ severity, summary, detail, life: 3000 }); return; }
  } catch (_) {}
  console.log(`[${summary}] ${detail}`);
}

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}
