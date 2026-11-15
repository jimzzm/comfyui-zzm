// Image Folder 🆎: the gallery under the card.
//
// The card (js/widget_cards) holds the settings. This panel shows the folder's
// pictures as tiles: a click ticks one, Shift + click ticks a run of them, and
// the count line says how many are in. The picked names live in the hidden
// `pictures` widget, so they save, undo and reach an API prompt like any
// other value. With "每次一张" the tile the next run loads is ringed, and
// Picture moves on by one each time a run is queued.
//
// The folder is a whole path on this machine, the one the folder dialog hands
// back: the pictures are read where they are, and nothing is copied. That
// dialog is the system's own, opened by the server, so the panel asks for it
// and waits while the person navigates. 添加 is gone with the input folder it
// used to fill; 📋 reads what was copied in Explorer instead, which is the one
// way a page can name a real path - a drop carries none.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, chainHandler, keepDomWidgetWidthAuto, notifyZzmChange, showToast } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import {
  askClipboard,
  askForFolder,
  countLine,
  isPicked,
  listAddress,
  nameAt,
  nextPosition,
  parsePicked,
  pickRange,
  pickedNames,
  placeOf,
  resolveAddress,
  serializePicked,
  thumbAddress,
  togglePick,
} from "../shared/image_folder.mjs";

const NODE_CLASS = "ZZM_NODES_ImageFolder";
const PANEL = "zzmaus_image_folder_panel";
const CSS_ID = "zzmaus-image-folder-css";
const MIN_WIDTH = 320;
const MIN_HEIGHT = 204;
// Tiles are added this many at a time: a folder of thousands stays light.
const SHOWN_STEP = 300;
const WATCHED = ["folder", "subfolders", "sort", "pictures", "run", "position", "at_the_end"];
// How long the pointer rests on a tile before the preview is read. A folder of
// thousands is a lot of pictures to ask for, so passing over one is not enough.
const HOVER_DELAY = 1000;
// The preview's longest side, and the size the copy it shows is made at.
const VIEW_EDGE = 460;
const VIEW_THUMB = 720;

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.zzmaus-if{box-sizing:border-box;overflow:hidden;position:relative;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:2px 6px 6px;color:var(--zzm-text,#edeef0);font:11.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.zzmaus-if-bar{flex:none;display:flex;align-items:center;gap:6px;height:26px;}
.zzmaus-if-chip{box-sizing:border-box;height:26px;padding:0 10px;border:1px solid rgba(192,92,67,.5);border-radius:10px;background:rgba(192,92,67,.14);color:${BRAND};font:600 11.5px/24px "Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.zzmaus-if-chip.warn{border-color:var(--zzm-warn,#ffca16);background:rgba(201,138,43,.16);color:var(--zzm-warn,#ffca16);}
.zzmaus-if-gap{flex:1 1 auto;}
.zzmaus-if-btn{flex:none;box-sizing:border-box;height:26px;padding:0 10px;border:1px solid var(--zzm-line-soft,#363a3f);border-radius:5px;background:var(--zzm-view,#18191b);color:var(--zzm-dim,#b0b4ba);font:600 11.5px/24px "Segoe UI",sans-serif;cursor:pointer;}
.zzmaus-if-btn:hover{color:var(--zzm-text,#edeef0);border-color:${BRAND};}
.zzmaus-if-btn[disabled]{opacity:.38;cursor:default;border-color:var(--zzm-line-soft,#363a3f);color:var(--zzm-dim,#b0b4ba);}
.zzmaus-if-grid{flex:1 1 auto;min-height:0;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));grid-auto-rows:max-content;align-content:start;gap:5px;padding:5px;overflow-y:auto;border:1px solid rgba(192,92,67,.22);border-radius:6px;background:var(--zzm-view,#18191b);scrollbar-width:thin;}
.zzmaus-if-cell{position:relative;box-sizing:border-box;aspect-ratio:1;padding:0;overflow:hidden;border:1px solid var(--zzm-line-soft,#363a3f);border-radius:5px;background:var(--zzm-line-soft,#363a3f);cursor:pointer;}
.zzmaus-if-cell img{display:block;width:100%;height:100%;object-fit:cover;opacity:.34;transition:opacity .12s;}
.zzmaus-if-cell.picked{border-color:rgba(192,92,67,.8);}
.zzmaus-if-cell.picked img{opacity:1;}
.zzmaus-if-cell:hover img{opacity:.8;}
.zzmaus-if-cell.picked:hover img{opacity:1;}
.zzmaus-if-cell.current{outline:2px solid var(--zzm-text,#edeef0);outline-offset:-2px;}
.zzmaus-if-tick{position:absolute;top:3px;right:3px;display:none;width:15px;height:15px;border-radius:50%;background:${BRAND};color:#fff;font:700 11px/15px "Segoe UI",sans-serif;text-align:center;}
.zzmaus-if-cell.picked .zzmaus-if-tick{display:block;}
.zzmaus-if-num{position:absolute;left:3px;bottom:3px;display:none;min-width:8px;padding:0 4px;border-radius:7px;background:rgba(0,0,0,.72);color:var(--zzm-text,#edeef0);font:700 10.5px/14px "Segoe UI",sans-serif;text-align:center;}
.zzmaus-if-cell.picked .zzmaus-if-num{display:block;}
.zzmaus-if-cell.done .zzmaus-if-num{background:${BRAND};color:#fff;}
.zzmaus-if.dropping .zzmaus-if-grid{border-color:${BRAND};box-shadow:inset 0 0 0 1px ${BRAND};background:var(--zzm-view,#18191b);}
.zzmaus-if-pick{display:block;margin:12px auto 0;height:26px;padding:0 12px;border:1px solid ${BRAND};border-radius:6px;background:rgba(192,92,67,.16);color:var(--zzm-text,#edeef0);font:700 11.5px/24px "Segoe UI",sans-serif;letter-spacing:.03em;cursor:pointer;}
.zzmaus-if-pick:hover{background:${BRAND};color:#fff;}
.zzmaus-if-note{grid-column:1/-1;align-self:center;padding:22px 12px;color:var(--zzm-dim,#b0b4ba);font-size:11.5px;line-height:1.45;text-align:center;}
.zzmaus-if-more{grid-column:1/-1;height:24px;border:1px dashed var(--zzm-line-soft,#363a3f);border-radius:5px;background:transparent;color:var(--zzm-dim,#b0b4ba);font:600 11.5px/22px "Segoe UI",sans-serif;cursor:pointer;}
.zzmaus-if-more:hover{color:var(--zzm-text,#edeef0);border-color:${BRAND};}
.zzmaus-if-view{position:fixed;z-index:10000;display:none;box-sizing:border-box;padding:3px;border:1px solid rgba(192,92,67,.65);border-radius:6px;background:var(--zzm-view,#18191b);box-shadow:0 14px 36px rgba(0,0,0,.6);pointer-events:none;}
.zzmaus-if-view.on{display:block;}
.zzmaus-if-view img{display:block;width:100%;height:auto;border-radius:4px;background:var(--zzm-line-soft,#363a3f);}
.zzmaus-if-view span{display:block;padding:3px 2px 0;overflow:hidden;color:var(--zzm-dim,#b0b4ba);font:11px/14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;}
`;
  document.head.appendChild(style);
}

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function widgetOf(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) ?? null;
}

function settings(node) {
  const value = (name, fallback) => widgetOf(node, name)?.value ?? fallback;
  return {
    folder: String(value("folder", "") ?? "").trim(),
    subfolders: Boolean(value("subfolders", false)),
    sort: String(value("sort", "名称")),
    pictures: String(value("pictures", "") ?? ""),
    run: String(value("run", "每次一张")),
    position: Number(value("position", 1)) || 1,
    afterRun: String(value("after_run", "下一张")),
    atTheEnd: String(value("at_the_end", "停下来")),
  };
}

function write(node, name, value) {
  const widget = widgetOf(node, name);
  if (!widget || widget.value === value) return false;
  commitWidgetValue(node, widget, value, app.canvas);
  return true;
}

// Workflows saved before the Chinese enum values keep the English ones
// (name, newest first, ...). The card's select appends a value that is not
// among the options, so they showed up beside the translated names.
const LEGACY = {
  sort: { name: "名称", "newest first": "最新优先", "oldest first": "最旧优先" },
  run: { "all in one run": "一次全部", "one per run": "每次一张" },
  after_run: { next: "下一张", stay: "停留", random: "随机" },
  at_the_end: { "stop the run": "停下来", "start over": "从头再来", "重头再来": "从头再来" },
};

function normalizeLegacyValues(node) {
  for (const [name, map] of Object.entries(LEGACY)) {
    const current = String(widgetOf(node, name)?.value ?? "");
    const mapped = map[current];
    if (mapped) write(node, name, mapped);
  }
}

function isLinked(node, name) {
  return Boolean(node.inputs?.some((input) => (input?.widget?.name ?? input?.name) === name && input.link != null));
}

// A workflow saved while the node still had a 来源 widget holds one value too
// many, so every widget after it took its neighbour's value. The old folder was
// a name below ComfyUI's input or output, which means nothing now: the whole set
// goes back to the defaults and the person picks a folder anew.
const OLD_SOURCES = ["输入目录", "输出目录", "input", "output"];
const DEFAULTS = {
  folder: "", subfolders: false, sort: "名称", pictures: "", run: "每次一张",
  position: 1, after_run: "下一张", at_the_end: "停下来",
};

function resetShiftedValues(node) {
  if (!OLD_SOURCES.includes(String(widgetOf(node, "folder")?.value ?? ""))) return;
  for (const [name, value] of Object.entries(DEFAULTS)) {
    const widget = widgetOf(node, name);
    if (widget) widget.value = value;
  }
}

// --- the tiles -------------------------------------------------------------------
function cellFor(state, picture) {
  const cell = el("button", "zzmaus-if-cell");
  cell.type = "button";
  cell.dataset.name = picture.name;
  cell.title = picture.name;
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.dataset.src = api.apiURL(thumbAddress({ ...state.shown, name: picture.name, v: picture.v }));
  cell.append(img, el("span", "zzmaus-if-tick", "✓"), el("span", "zzmaus-if-num"));
  state.watcher?.observe(cell);
  return cell;
}

// Rebuild the tiles: the folder, or what it holds, changed.
function rebuild(state) {
  state.watcher?.disconnect();
  state.grid.replaceChildren();
  state.cells = new Map();
  const hint = (text, offer) => {
    const note = el("div", "zzmaus-if-note", text);
    if (offer) {
      const pick = el("button", "zzmaus-if-pick", "📂 打开文件夹…");
      pick.type = "button";
      pick.title = "从这台电脑上选一个文件夹。里面的图片就地读取，不复制。";
      pick.addEventListener("click", () => pickFolder(state));
      note.append(pick);
    }
    state.grid.append(note);
  };
  if (state.error) {
    hint(state.error, true);
  } else if (!state.list.length) {
    if (state.cleared) {
      hint("已清空。点 ↻ 重新读取，或选一个文件夹。", true);
    } else if (!state.shown.folder) {
      hint(state.busy ? "正在读取文件夹…" : "还没有选文件夹。点下面的按钮，从这台电脑上挑一个；图片就地读取，不复制。", !state.busy);
    } else {
      hint(state.busy ? "正在读取文件夹…" : "这个文件夹里没有图片。", !state.busy);
    }
  } else {
    for (const picture of state.list.slice(0, state.limit)) {
      const cell = cellFor(state, picture);
      state.cells.set(picture.name, cell);
      state.grid.append(cell);
    }
    const rest = state.list.length - state.limit;
    if (rest > 0) {
      const more = el("button", "zzmaus-if-more", `再显示 ${Math.min(rest, SHOWN_STEP)} 张（共 ${rest} 张）`);
      more.type = "button";
      more.addEventListener("click", () => { state.limit += SHOWN_STEP; rebuild(state); });
      state.grid.append(more);
    }
  }
  paint(state);
}

// Bring ticks, numbers, the ring and the count line up to date.
function paint(state) {
  const now = settings(state.node);
  const picked = parsePicked(now.pictures);
  const names = state.names;
  const next = now.run === "每次一张" ? nameAt(picked, names, now.position, now.atTheEnd) : null;
  const order = new Map(pickedNames(picked, names).map((name, index) => [name, index + 1]));
  for (const [name, cell] of state.cells) {
    const place = order.get(name) ?? 0;
    cell.classList.toggle("picked", place > 0);
    cell.classList.toggle("current", name === next);
    cell.classList.toggle("done", state.done.has(name));
    cell.lastChild.textContent = place ? String(place) : "";
  }
  const line = state.picking
    ? { text: "在对话框里选文件夹…", warn: false }
    : !now.folder ? { text: "no folder", warn: false }
      : state.error ? { text: "folder not found", warn: true }
        : state.busy ? { text: "looking...", warn: false }
          : state.cleared ? { text: "未载入", warn: false } : countLine(picked, names, now);
  state.chip.textContent = line.text;
  state.chip.classList.toggle("warn", line.warn);
  state.chip.title = [line.text, state.full ? "这个文件夹只列出前 5000 张。" : "", state.loadedLine].filter(Boolean).join("\n");
  state.paste.disabled = state.picking;
  state.paste.title = "用剪贴板里的文件：在资源管理器里选中一张图或一个文件夹，Ctrl+C，再点这里。图片就地读取，不复制。";
}

// ---------------------------------------------------------------------------
// Clear / restore the gallery
// 节点一建立就会去读 input / output 根目录。这里是"不想看"的出口：清空之后不再读，
// 状态写进 node.properties，重开工作流仍然是空的，直到点 ↻ 或另选文件夹。
// ---------------------------------------------------------------------------
function setCleared(state, on) {
  state.cleared = on;
  if (!state.node.properties) state.node.properties = {};
  state.node.properties.zzmaus_cleared = on;
}

function clearLoaded(state) {
  if (!state.alive) return;
  clearTimeout(state.timer);
  state.token += 1;          // 让还在路上的响应作废
  setCleared(state, true);
  state.busy = false;
  state.list = [];
  state.names = [];
  state.cells = new Map();
  state.full = false;
  state.error = "";
  state.loadedLine = "";
  write(state.node, "pictures", "");
  rebuild(state);
}

// Ask the server what the folder holds.
async function refresh(state) {
  if (!state.alive) return;
  if (state.cleared) { state.busy = false; rebuild(state); return; }
  const now = settings(state.node);
  const token = ++state.token;
  // No folder yet: nothing to ask for, and the gallery says so instead of
  // showing a request that cannot succeed.
  if (!now.folder) {
    state.list = [];
    state.names = [];
    state.full = false;
    state.error = "";
    state.busy = false;
    state.shown = { folder: "", subfolders: now.subfolders, sort: now.sort };
    rebuild(state);
    return;
  }
  state.busy = true;
  const shown = { folder: now.folder, subfolders: now.subfolders, sort: now.sort };
  try {
    const response = await api.fetchApi(listAddress(shown));
    const data = await response.json().catch(() => ({}));
    if (token !== state.token || !state.alive) return;
    if (response.ok) {
      state.list = Array.isArray(data.pictures) ? data.pictures : [];
      state.full = Boolean(data.full);
      state.error = "";
    } else {
      state.list = [];
      state.full = false;
      state.error = String(data?.error ?? "这个文件夹读不出来。").replace(/^(Image Folder|批量加载图片)[:：]\s*/, "");
    }
  } catch {
    if (token !== state.token || !state.alive) return;
    state.list = [];
    state.error = "文件夹没加载出来。点刷新按钮再试一次。";
  }
  state.busy = false;
  state.shown = shown;
  state.names = state.list.map((picture) => picture.name);
  state.limit = SHOWN_STEP;
  takeWanted(state);
  rebuild(state);
}

// A picture named as a whole path (a dropped one, or one on the clipboard):
// the folder is being read, and this is the one the person pointed at.
function takeWanted(state) {
  const want = state.want;
  if (!want) return;
  state.want = "";
  if (!state.names.includes(want)) return;
  write(state.node, "pictures", JSON.stringify([want]));
  if (settings(state.node).run === "每次一张") write(state.node, "position", placeOf([want], state.names, want));
}

function scheduleRefresh(state, delay = 160) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => refresh(state), delay);
}

function setPicked(state, picked) {
  if (write(state.node, "pictures", serializePicked(picked, state.names))) notifyZzmChange();
  paint(state);
}

// --- choosing a folder -----------------------------------------------------------
// The server opens the system's own folder dialog on this machine, so the folder
// it answers with is a whole path and the pictures are read where they are. The
// request stays open while the person navigates, so the button says what it is
// waiting for.
async function pickFolder(state) {
  if (state.picking) return;
  state.picking = true;
  paint(state);
  try {
    const folder = await askForFolder(settings(state.node).folder);
    if (!folder || !state.alive) return;                 // called off: nothing changes
    state.want = "";
    setCleared(state, false);
    if (!write(state.node, "folder", folder)) await refresh(state);
    else notifyZzmChange();
  } catch (error) {
    showToast({ severity: "warn", detail: String(error?.message ?? error) || "打不开文件夹对话框。" });
  } finally {
    state.picking = false;
    if (state.alive) paint(state);
  }
}

// Open this folder, and pick this one picture in it once the list is in.
async function goTo(state, folder, name) {
  if (!state.alive) return;
  state.want = String(name ?? "");
  setCleared(state, false);
  if (!write(state.node, "folder", folder)) await refresh(state);
  else notifyZzmChange();
}

// What is on the clipboard: the folder a copied file sits in, plus the file. A
// browser never hands a page the path of a dropped file, so this is how one
// picture gets named for real.
async function useClipboard(state) {
  if (state.picking) return;
  state.picking = true;
  paint(state);
  try {
    const { folder, name } = await askClipboard();
    await goTo(state, folder, name);
  } catch (error) {
    showToast({ severity: "warn", detail: String(error?.message ?? error) || "剪贴板里没有文件。" });
  } finally {
    state.picking = false;
    if (state.alive) paint(state);
  }
}

// --- what a drop carries ---------------------------------------------------------
// A browser hides the path of a dropped file, but ComfyUI's desktop window and
// some browsers still hand one over. When there is one, the node reads that very
// folder: nothing is copied.
function asWholePath(text) {
  const raw = String(text ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) return raw;
  if (/^[a-z]:[\\/]/i.test(raw)) return raw;
  if (raw.startsWith("\\\\")) return raw;                // a share on the network
  return "";
}

function pathFromEvent(event) {
  const transfer = event?.dataTransfer;
  if (!transfer) return "";
  for (const type of ["text/uri-list", "text/plain"]) {
    let text = "";
    try { text = transfer.getData(type); } catch { text = ""; }
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const hit = asWholePath(line);
      if (hit) return hit;
    }
  }
  for (const file of transfer.files ?? []) {
    const path = asWholePath(file?.path ?? "");
    if (path) return path;
  }
  return "";
}

async function takeDrop(state, event) {
  const path = pathFromEvent(event);
  if (path) {
    try {
      const response = await api.fetchApi(resolveAddress(path));
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.folder) { await goTo(state, data.folder, data.name); return; }
    } catch { /* the message below says what to do instead */ }
  }
  // No path to read: a picture already in the folder can still be picked by its
  // name, which is all a browser tells a page about a dropped file.
  const names = [...(event?.dataTransfer?.files ?? [])].map((file) => String(file?.name ?? ""));
  const known = names.find((name) => state.names.includes(name));
  if (known) {
    setPicked(state, [known]);
    if (settings(state.node).run === "每次一张") write(state.node, "position", placeOf([known], state.names, known));
    paint(state);
    showToast({ detail: `${known}：拖进来的这张已在文件夹里，按文件名选中了它。` });
    return;
  }
  showToast({
    severity: "warn",
    detail: "浏览器不给网页本地图片的路径，拖进来读不到原文件。两个办法：点「打开文件夹」选它所在的文件夹；或者在资源管理器里选中它 Ctrl+C，回来点面板上的 📋。都是就地读取，不复制。",
  });
}

// --- the preview that opens under the pointer ------------------------------------
// A folder can hold thousands of pictures, so nothing is read until the pointer
// has rested on one tile for a moment, and only one at a time.
function viewSource(state, cell) {
  return api.apiURL(thumbAddress({
    folder: state.shown.folder, name: cell.dataset.name, v: cell.dataset.v, size: VIEW_THUMB,
  }));
}

function placeView(state, cell, picture) {
  const box = state.view;
  const edge = Math.min(VIEW_EDGE, window.innerWidth - 24, window.innerHeight - 60);
  const wide = picture.naturalWidth || 1;
  const tall = picture.naturalHeight || 1;
  // One scale for both sides, from the longer one: the preview keeps the
  // picture's shape. A tiny picture is blown up to something visible.
  const longest = Math.max(wide, tall);
  let scale = longest > edge ? edge / longest : 1;
  if (longest * scale < 64) scale = 64 / longest;
  const width = Math.max(8, Math.round(wide * scale));
  const height = Math.max(8, Math.round(tall * scale));
  const caption = 20;
  const place = cell.getBoundingClientRect();
  let left = place.right + 10;
  if (left + width + 12 > window.innerWidth) left = place.left - width - 10;
  if (left < 8) left = Math.max(8, (window.innerWidth - width) / 2);
  const top = Math.max(8, Math.min(window.innerHeight - height - caption - 12, place.top));
  box.style.width = `${width + 8}px`;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  picture.style.height = `${height}px`;
  box.classList.add("on");
}

function showView(state, cell) {
  if (!state.alive || !state.shown.folder || !cell.isConnected) return;
  const name = cell.dataset.name;
  if (!name) return;
  const token = ++state.viewToken;
  const picture = state.viewImg;
  state.viewName.textContent = name;
  picture.onload = () => {
    if (token !== state.viewToken || !state.alive) return;
    placeView(state, cell, picture);
  };
  picture.onerror = () => { if (token === state.viewToken) hideView(state); };
  picture.src = viewSource(state, cell);
}

function hideView(state) {
  state.viewToken += 1;
  state.view?.classList.remove("on");
}

// The pointer rested on a tile: wait, then show. Moving off, scrolling or
// rebuilding the wall cancels it before anything is read.
function watchPointer(state) {
  const grid = state.grid;
  const signal = state.abort.signal;
  grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest?.(".zzmaus-if-cell");
    if (!cell || cell === state.hoverCell) return;
    state.hoverCell = cell;
    clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(() => {
      if (state.hoverCell === cell) showView(state, cell);
    }, HOVER_DELAY);
  }, { signal });
  grid.addEventListener("pointerout", (event) => {
    const cell = event.target.closest?.(".zzmaus-if-cell");
    if (!cell || cell.contains(event.relatedTarget)) return;
    if (state.hoverCell === cell) state.hoverCell = null;
    clearTimeout(state.hoverTimer);
    hideView(state);
  }, { signal });
  grid.addEventListener("scroll", () => {
    state.hoverCell = null;
    clearTimeout(state.hoverTimer);
    hideView(state);
  }, { passive: true, signal });
}

// --- the panel -------------------------------------------------------------------
function buildPanel(node) {
  if (node.__zzmausImageFolder) return node.__zzmausImageFolder;
  ensureCss();
  const root = el("div", "zzmaus-if");
  const bar = el("div", "zzmaus-if-bar");
  const chip = el("span", "zzmaus-if-chip", "");
  const all = el("button", "zzmaus-if-btn", "全选");
  const none = el("button", "zzmaus-if-btn", "取消");
  const paste = el("button", "zzmaus-if-btn", "📋");
  const reload = el("button", "zzmaus-if-btn", "↻");
  const wipe = el("button", "zzmaus-if-btn", "清空");
  all.title = "全选文件夹里的图片，之后新加的也算在内。";
  none.title = "全部取消，再点你要的那几张。";
  reload.title = "重新读取文件夹。";
  wipe.title = "清空已载入的文件夹，面板回到空白，重开工作流也保持空白。点 ↻ 或另选文件夹可以再读回来。";
  for (const button of [all, none, paste, reload, wipe]) button.type = "button";
  bar.append(chip, el("span", "zzmaus-if-gap"), all, none, paste, reload, wipe);
  const grid = el("div", "zzmaus-if-grid");
  root.append(bar, grid);

  const widget = node.addDOMWidget(PANEL, PANEL, root, { serialize: false, hideOnZoom: false });
  keepDomWidgetWidthAuto(widget);
  // The gallery is not a value: the picked names live in the `pictures` widget.
  widget.serialize = false;
  // A viewport onto the folder: it takes the node's spare height.
  fillNodeHeight(widget, { minWidth: MIN_WIDTH, minHeight: () => MIN_HEIGHT, minNodeSize: [MIN_WIDTH, 90], exactMinWidth: true });

  // The preview sits outside the node's clipped box, so it can be bigger than
  // the node and still be drawn whole.
  const view = el("div", "zzmaus-if-view");
  const viewImg = el("img");
  viewImg.alt = "";
  viewImg.draggable = false;
  const viewName = el("span");
  view.append(viewImg, viewName);

  const abort = new AbortController();
  const state = node.__zzmausImageFolder = {
    node, root, widget, chip, grid, paste, abort,
    view, viewImg, viewName, viewToken: 0, hoverCell: null, hoverTimer: null,
    alive: true, list: [], names: [], cells: new Map(), done: new Set(), limit: SHOWN_STEP,
    shown: { folder: "", subfolders: false, sort: "名称" },
    token: 0, timer: null, busy: true, error: "", full: false, last: null, loadedLine: "", key: "",
    cleared: Boolean(node.properties?.zzmaus_cleared),
    picking: false, want: "", dropTimer: null,
  };
  document.body.append(view);
  // A tile's picture is fetched when it scrolls near the view.
  state.watcher = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target.firstChild;
        if (img?.dataset?.src) { img.src = img.dataset.src; delete img.dataset.src; }
        state.watcher.unobserve(entry.target);
      }
    }, { root: grid, rootMargin: "160px" })
    : null;

  const signal = abort.signal;
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest?.(".zzmaus-if-cell");
    if (!cell) return;
    const name = cell.dataset.name;
    const picked = parsePicked(settings(node).pictures);
    const on = !isPicked(picked, name);
    const next = event.shiftKey && state.last && state.last !== name
      ? pickRange(picked, state.names, state.last, name, on)
      : togglePick(picked, state.names, name);
    state.last = name;
    setPicked(state, next);
  }, { signal });
  // With 每次一张, a double click makes a picture the next one to load.
  grid.addEventListener("dblclick", (event) => {
    const cell = event.target.closest?.(".zzmaus-if-cell");
    if (!cell || settings(node).run !== "每次一张") return;
    const name = cell.dataset.name;
    let picked = parsePicked(settings(node).pictures);
    if (!isPicked(picked, name)) { picked = togglePick(picked, state.names, name); setPicked(state, picked); }
    if (write(node, "position", placeOf(picked, state.names, name))) notifyZzmChange();
    paint(state);
  }, { signal });
  all.addEventListener("click", () => setPicked(state, null), { signal });
  none.addEventListener("click", () => setPicked(state, []), { signal });
  reload.addEventListener("click", () => { setCleared(state, false); refresh(state); }, { signal });
  wipe.addEventListener("click", () => clearLoaded(state), { signal });
  paste.addEventListener("click", () => useClipboard(state), { signal });
  watchPointer(state);

  state.pick = () => pickFolder(state);
  state.refresh = () => refresh(state);

  // A setting changed: the folder is read again, or only the marks move.
  for (const name of WATCHED) {
    const target = widgetOf(node, name);
    if (!target) continue;
    chainCallback(target, "callback", () => {
      if (!state.alive) return;
      const now = settings(node);
      const key = `${now.folder}|${now.subfolders}|${now.sort}`;
      if (key === state.key) { paint(state); return; }
      // Another folder holds other names: a pick made in the old one means nothing there.
      const moved = state.key && (now.folder !== state.shown.folder || now.subfolders !== state.shown.subfolders);
      state.key = key;
      if (moved && !state.restoring && now.pictures) write(node, "pictures", "");
      // 换了文件夹：用户明显是想看东西，取消"已清空"状态
      setCleared(state, false);
      state.busy = true;
      paint(state);
      scheduleRefresh(state);
    });
  }

  // One per run: Picture moves on when a run is queued. A run of another node
  // alone leaves it where it is.
  const position = widgetOf(node, "position");
  if (position) {
    chainCallback(position, "afterQueued", (options) => {
      if (!state.alive || options?.isPartialExecution) return;
      const now = settings(node);
      if (now.run !== "每次一张" || isLinked(node, "position")) return;
      const count = pickedNames(parsePicked(now.pictures), state.names).length;
      const next = nextPosition(now.position, count, now.afterRun, now.atTheEnd);
      if (next !== now.position) { position.value = next; position.callback?.(next); }
    });
  }

  // A folder or picture dropped on the node is read where it is: nothing is copied.
  const carriesFiles = (event) => [...(event?.dataTransfer?.types ?? [])].includes("Files");
  chainHandler(node, "onDragOver", (event) => {
    if (!carriesFiles(event)) return false;
    root.classList.add("dropping");
    clearTimeout(state.dropTimer);
    state.dropTimer = setTimeout(() => root.classList.remove("dropping"), 260);
    return true;
  });
  chainHandler(node, "onDragDrop", (event) => {
    root.classList.remove("dropping");
    if (!carriesFiles(event)) return false;
    takeDrop(state, event);
    return true;
  });

  // 画布上的 onDragOver/onDragDrop 只有拖到 canvas 上才收得到。可这个节点的大半
  // 面积盖的是 DOM（设置卡片 + 缩略图墙），拖到那儿事件根本到不了 canvas，直接被
  // 前端当成"拖进来一张图"处理。所以在这两块 DOM 上也挂一份，并 stopPropagation。
  const markDropping = () => {
    root.classList.add("dropping");
    clearTimeout(state.dropTimer);
    state.dropTimer = setTimeout(() => root.classList.remove("dropping"), 260);
  };
  const cardHost = () => (node.widgets || []).find((w) => w?.name === "zzmaus_widget_card")?.element;
  // 卡片的 DOM 有可能比这个面板晚挂上，所以先挂一次、下一帧和 400ms 后再补两次
  const attachDropHosts = () => {
    for (const host of [root, cardHost()]) attachDropHost(host);
  };
  const attachDropHost = (host) => {
    if (!host || host.__zzmausDropHost) return;
    host.__zzmausDropHost = true;
    host.addEventListener("dragover", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      markDropping();
    });
    host.addEventListener("dragleave", () => root.classList.remove("dropping"));
    host.addEventListener("drop", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      root.classList.remove("dropping");
      takeDrop(state, event);
    });
  };
  attachDropHosts();
  requestAnimationFrame(attachDropHosts);
  setTimeout(attachDropHosts, 400);

  const now = settings(node);
  state.key = `${now.folder}|${now.subfolders}|${now.sort}`;
  // Say "reading" rather than "no folder" for the moment before the first answer.
  state.shown = { folder: now.folder, subfolders: now.subfolders, sort: now.sort };
  rebuild(state);
  scheduleRefresh(state, 60);
  // A new node opens with room for three rows of tiles. It takes that size as
  // it joins the graph: the card is in place by then, and a size put on the
  // node afterwards wins (a loaded workflow, an undo). A copy gets its size
  // before it joins, which onConfigure notes below.
  chainCallback(node, "onAdded", () => {
    if (state.sized) return;
    state.sized = true;
    const floor = Number(node.computeSize?.()?.[1]);
    if (Number.isFinite(floor) && node.size?.[1] <= floor + 1) node.setSize?.([Math.max(node.size[0], 340), floor + 96]);
  });
  ensurePanelRoom(state);
  return state;
}

// The card alone can be taller than the node a workflow was saved with, which
// leaves the gallery at no height at all: nothing to click, nothing to drop on.
// When that happens the node gets the room back.
function ensurePanelRoom(state) {
  requestAnimationFrame(() => {
    if (!state.alive || !state.root.isConnected) return;
    const shown = state.root.getBoundingClientRect().height;
    if (shown >= 90) return;
    const node = state.node;
    const tall = Math.round((node.size?.[1] ?? 0) + (150 - shown));
    node.setSize?.([node.size?.[0] ?? MIN_WIDTH, tall]);
    node.graph?.setDirtyCanvas?.(true, true);
  });
}

function mountPanel(node) {
  try {
    return buildPanel(node);
  } catch (error) {
    // The gallery is a convenience: the card still picks a folder and runs.
    console.error("[ZZM] 批量加载图片：缩略图面板没挂上，卡片上的「打开文件夹」仍然可用。", error);
    return null;
  }
}

app.registerExtension({
  name: "zzmaus.image_folder",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      mountPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      const state = mountPanel(this);
      if (!state) return;
      // A node that comes with a size keeps it, the smallest one too.
      if (info?.size) state.sized = true;
      // A workflow from before the folder was a whole path: put the widgets back
      // on their defaults, then translate the English enum values.
      resetShiftedValues(this);
      // English values from a pre-translation workflow become the Chinese ones.
      normalizeLegacyValues(this);
      // A loaded workflow brings its own folder and its own pick.
      state.restoring = true;
      queueMicrotask(() => {
        const now = settings(this);
        state.key = `${now.folder}|${now.subfolders}|${now.sort}`;
        state.restoring = false;
        scheduleRefresh(state, 30);
        ensurePanelRoom(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (output) {
      if (isForeignRun()) return;
      const state = this.__zzmausImageFolder;
      const note = output?.zzmaus_image_folder?.[0];
      if (!state?.alive || !note) return;
      for (const name of note.names ?? []) state.done.add(name);
      const loaded = note.loaded ?? [];
      state.loadedLine = loaded.length === 1
        ? `The last run loaded picture ${loaded[0]} of ${note.count}.`
        : `The last run loaded ${loaded.length} of ${note.count} pictures.`;
      paint(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__zzmausImageFolder;
      if (!state) return;
      state.alive = false;
      clearTimeout(state.timer);
      clearTimeout(state.hoverTimer);
      state.watcher?.disconnect();
      state.abort.abort();
      clearTimeout(state.dropTimer);
      state.view.remove();
    });
  },
});
