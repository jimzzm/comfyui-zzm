// Image Folder 🆎: the gallery under the card.
//
// The card (js/widget_cards) holds the settings. This panel shows the folder's
// pictures as tiles: a click ticks one, Shift + click ticks a run of them, and
// the count line says how many are in. The picked names live in the hidden
// `pictures` widget, so they save, undo and reach an API prompt like any
// other value. With "每次一张" the tile the next run loads is ringed, and
// Picture moves on by one each time a run is queued.
//
// The folder the node reads is a whole path on this machine, so a folder that
// is already on disk is read where it is and nothing is copied: paste its path
// into the box. The browser's own pickers cannot hand over a path - only the
// files themselves - so what they bring in is copied into ComfyUI's input
// folder under zzm_drop, and the node moves there and ticks what just came in.
// That is the same door the原版 used, moved into one folder so the input folder
// stays tidy. A browser asks its own question about a chosen folder ("Upload 74
// files to this site?"); the note on the node says what it means while the
// file explorer is open.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, chainHandler, keepDomWidgetWidthAuto, notifyZzmChange, showToast } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import {
  comfyFolders,
  countLine,
  isPicked,
  listAddress,
  nameAt,
  nextPosition,
  parsePicked,
  pickRange,
  pickedNames,
  placeOf,
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
// Pictures added by hand or dropped on the node land in this folder inside
// ComfyUI's input folder: a browser can only hand the server the file itself.
const DROP_FOLDER = "zzm_drop";
// How long the pointer rests on a tile before the preview is read.
const HOVER_DELAY = 1000;
// The preview's longest side, and the size the copy it shows is made at.
const VIEW_EDGE = 460;
const VIEW_THUMB = 720;
const PICTURE = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
// A dropped folder is copied up to this many pictures.
const COPY_LIMIT = 3000;
// From here on a folder is "really big": the node asks before it copies.
const BIG_COUNT = 300;
const BIG_BYTES = 1024 ** 3;
// On the node while the file explorer is open for a folder.
const CHOOSING = [
  "在文件浏览器里选择文件夹",
  "选中的图片会复制到 ComfyUI 的输入目录（input/文件夹名），节点随后切过去。",
  '浏览器可能先问「是否上传文件到此站点？」—— 那就是这次复制，站点就是你的 ComfyUI。',
];

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
.zzmaus-if-menu{position:fixed;z-index:10000;box-sizing:border-box;min-width:170px;padding:4px;border:1px solid rgba(192,92,67,.5);border-radius:8px;background:var(--zzm-view,#18191b);box-shadow:0 12px 32px rgba(0,0,0,.6);font:11.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.zzmaus-if-ask{position:fixed;z-index:10001;box-sizing:border-box;width:300px;padding:12px;border:1px solid var(--zzm-warn,#ffca16);border-radius:8px;background:var(--zzm-view,#18191b);box-shadow:0 12px 32px rgba(0,0,0,.6);color:var(--zzm-text,#edeef0);font:11.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.zzmaus-if-ask b{display:block;margin-bottom:6px;color:var(--zzm-warn,#ffca16);font-size:12.5px;}
.zzmaus-if-ask .zzmaus-if-browse-foot{padding:10px 0 0;border-top:0;}
/* 添加: the one button in the bar that brings something in, so it carries the
   pack's color instead of blending with the rest. */
.zzmaus-if-btn.accent{border-color:${BRAND};background:rgba(192,92,67,.22);color:var(--zzm-text,#edeef0);}
.zzmaus-if-btn.accent:hover{background:${BRAND};color:#fff;}
.zzmaus-if-btn.accent[disabled]{background:rgba(192,92,67,.22);color:var(--zzm-text,#edeef0);}
/* The 添加 menu: one row under the other, full width. */
.zzmaus-if-menu-row{display:block;width:100%;box-sizing:border-box;margin:0 0 2px;padding:6px 9px;border:0;border-radius:5px;background:transparent;color:var(--zzm-text,#edeef0);font:inherit;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.zzmaus-if-menu-row:last-child{margin-bottom:0;}
.zzmaus-if-menu-row:hover{background:rgba(192,92,67,.18);color:var(--zzm-text,#edeef0);}
.zzmaus-if-cover{position:absolute;left:6px;right:6px;top:28px;bottom:6px;z-index:2;box-sizing:border-box;display:flex;flex-direction:column;justify-content:safe center;gap:6px;padding:12px 14px;overflow:auto;border:1px solid ${BRAND};border-radius:6px;background:var(--zzm-view,#18191b);color:var(--zzm-text,#edeef0);font-size:11.5px;line-height:1.45;text-align:center;}
.zzmaus-if-cover[hidden]{display:none;}
.zzmaus-if-cover b{color:var(--zzm-text,#edeef0);font-size:12.5px;}
.zzmaus-if-note{grid-column:1/-1;align-self:center;padding:22px 12px;color:var(--zzm-dim,#b0b4ba);font-size:11.5px;line-height:1.45;text-align:center;white-space:pre-line;}
.zzmaus-if-more{grid-column:1/-1;height:24px;border:1px dashed var(--zzm-line-soft,#363a3f);border-radius:5px;background:transparent;color:var(--zzm-dim,#b0b4ba);font:600 11.5px/22px "Segoe UI",sans-serif;cursor:pointer;}
.zzmaus-if-more:hover{color:var(--zzm-text,#edeef0);border-color:${BRAND};}
.zzmaus-if-view{position:fixed;z-index:10000;display:none;box-sizing:border-box;padding:3px;border:1px solid rgba(192,92,67,.65);border-radius:6px;background:var(--zzm-view,#18191b);box-shadow:0 14px 36px rgba(0,0,0,.6);pointer-events:none;}
.zzmaus-if-view.on{display:block;}
.zzmaus-if-view img{display:block;width:100%;height:auto;border-radius:4px;background:var(--zzm-line-soft,#363a3f);}
.zzmaus-if-view span{display:block;padding:3px 2px 0;overflow:hidden;color:var(--zzm-dim,#b0b4ba);font:11px/14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;}
.zzmaus-if-browse-foot{flex:none;display:flex;gap:6px;justify-content:flex-end;padding:6px 8px;border-top:1px solid var(--zzm-line-soft,#363a3f);}
.zzmaus-if-browse-foot .use{background:${BRAND};border-color:${BRAND};color:#fff;}
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

function isLinked(node, name) {
  return Boolean(node.inputs?.some((input) => (input?.widget?.name ?? input?.name) === name && input.link != null));
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
  const hint = (text) => state.grid.append(el("div", "zzmaus-if-note", text));
  if (state.error) {
    hint(state.error);
  } else if (!state.list.length) {
    if (state.cleared) {
      hint("已清空。点 ↻ 重新读取，或另选一个文件夹。");
    } else if (!state.shown.folder) {
      hint(state.busy ? "正在读取文件夹…" : "还没有文件夹：把完整路径粘进上面的地址栏，或者\n\n拖入图片或者文件夹");
    } else {
      hint(state.busy ? "正在读取文件夹…" : "这个文件夹里没有图片。\n\n拖入图片或者文件夹");
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
  const line = state.copying
    ? { text: `copying ${state.copying.done} of ${state.copying.total}`, warn: false }
    : !now.folder ? { text: "未选文件夹", warn: false }
      : state.error ? { text: "文件夹打不开", warn: true }
        : state.busy ? { text: "读取中…", warn: false }
          : state.cleared ? { text: "未载入", warn: false } : countLine(picked, names, now);
  state.chip.textContent = line.text;
  state.chip.classList.toggle("warn", line.warn);
  state.chip.title = [line.text, state.full ? "这个文件夹只列出前 5000 张。" : "", state.loadedLine].filter(Boolean).join("\n");
  state.add.disabled = false;
  state.add.title = "添加图片或整个文件夹：用系统的选择框，选中的会复制到 ComfyUI 的输入目录（input/zzm_drop）。也可以直接拖到节点上。";
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
  state.busy = true;
  // No folder yet: nothing to ask for.
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
  rebuild(state);
}

function scheduleRefresh(state, delay = 160) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => refresh(state), delay);
}

function setPicked(state, picked) {
  if (write(state.node, "pictures", serializePicked(picked, state.names))) notifyZzmChange();
  paint(state);
}

// --- what the node says while a folder comes in -----------------------------------
// The note over the tiles: what happens with a folder that is being chosen,
// and how far a copy is.
function cover(state) {
  const copying = state.copying;
  const lines = copying
    ? [`Copying ${copying.done} of ${copying.total} pictures`, `from "${copying.name}" into ComfyUI's input folder (input/${copying.target}).`]
    : state.choosing ? CHOOSING : null;
  state.cover.hidden = !lines;
  if (!lines) return;
  [...state.cover.children].forEach((line, index) => { line.textContent = lines[index] ?? ""; line.hidden = !lines[index]; });
}

function endChoosing(state) {
  state.choosing?.abort();
  state.choosing = null;
  cover(state);
}

// Open the file explorer for a folder, and say on the node what happens with
// it. The note goes when a folder is chosen or the choice is called off.
function chooseFolder(state) {
  endChoosing(state);
  const abort = new AbortController();
  state.choosing = abort;
  const opened = performance.now();
  const stop = () => { if (state.choosing === abort) endChoosing(state); };
  state.pickFolder.addEventListener("cancel", stop, { signal: abort.signal });
  // A browser that does not report a called-off choice: no click or key
  // reaches the page while the file explorer or the browser's question is
  // open, so the next one means both are closed.
  const later = () => { if (performance.now() - opened > 700) stop(); };
  window.addEventListener("pointerdown", later, { capture: true, signal: abort.signal });
  window.addEventListener("keydown", later, { capture: true, signal: abort.signal });
  cover(state);
  state.pickFolder.click();
}

// --- adding pictures -------------------------------------------------------------
const isPicture = (file) => String(file?.type ?? "").startsWith("image/") || PICTURE.test(String(file?.name ?? ""));

async function upload(file, subfolder, overwrite) {
  const body = new FormData();
  body.append("image", file, file.name);
  // input, the way the原版 did it: the browser cannot hand over a path, so the
  // file itself comes in. It lands under input/zzm_drop, one folder to clean up.
  body.append("type", "input");
  if (subfolder) body.append("subfolder", subfolder);
  if (overwrite) body.append("overwrite", "true");
  try {
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.name ? String(data.name) : null;
  } catch {
    return null;
  }
}

// Loose pictures go into input/zzm_drop, and the node moves there with them
// ticked: what was just brought in is what the person wants to use.
async function addFiles(state, files) {
  const images = [...(files ?? [])].filter(isPicture);
  if (!images.length) return false;
  const added = [];
  let failed = 0;
  for (const file of images) {
    const name = await upload(file, DROP_FOLDER, false);
    if (name) added.push(name); else failed += 1;
  }
  const folders = await comfyFolders();
  const target = `${folders.input || "input"}/${DROP_FOLDER}`;
  // 往里加图片说明用户要看东西：先退出"已清空"状态，否则 refresh 不会执行
  setCleared(state, false);
  if (added.length) write(state.node, "folder", target);
  endChoosing(state);
  await refresh(state);
  const came = added.filter((name) => state.names.includes(name));
  if (came.length) setPicked(state, came);
  if (added.length) showToast({ detail: `Added ${added.length} picture${added.length === 1 ? "" : "s"} to ${target}.` });
  if (failed) showToast({ severity: "warn", detail: `${failed} file${failed === 1 ? "" : "s"} could not be added.` });
  return true;
}

function folderName(name) {
  return String(name ?? "").replace(/[\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim() || "pictures";
}

function sizeText(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

// A really big folder: say how big, and let the person decide. Copying makes
// a second copy on disk, and that many pictures take a while.
let openAsk = null;

function closeAsk(answer = false) {
  const ask = openAsk;
  openAsk = null;
  if (!ask) return;
  ask.abort.abort();
  ask.root.remove();
  ask.done(answer);
}

function askBig(state, name, pictures) {
  const bytes = pictures.reduce((sum, item) => sum + (Number(item.file?.size) || 0), 0);
  if (pictures.length <= BIG_COUNT && bytes <= BIG_BYTES) return Promise.resolve(true);
  closeAsk(false);
  return new Promise((done) => {
    const root = el("div", "zzmaus-if-ask");
    const many = pictures.length.toLocaleString("en-US");
    root.append(el("b", "", `Copy ${many} pictures into ComfyUI's input folder?`));
    root.append(el("div", "", `"${name}" holds ${many} pictures, ${sizeText(bytes)}. The copies take that much disk space again, and it can take a while.`));
    if (pictures.length > COPY_LIMIT) root.append(el("div", "", `Only the first ${COPY_LIMIT.toLocaleString("en-US")} are copied.`));
    const foot = el("div", "zzmaus-if-browse-foot");
    const cancel = el("button", "zzmaus-if-btn", "Cancel");
    const go = el("button", "zzmaus-if-btn use", "复制进来");
    cancel.type = "button"; go.type = "button";
    foot.append(cancel, go);
    root.append(foot);
    const abort = new AbortController();
    openAsk = { root, abort, done };
    cancel.addEventListener("click", () => closeAsk(false));
    go.addEventListener("click", () => closeAsk(true));
    document.body.append(root);
    const box = state.grid.getBoundingClientRect();
    root.style.left = `${Math.max(8, Math.min(window.innerWidth - 308, box.left + (box.width - 300) / 2))}px`;
    root.style.top = `${Math.max(8, Math.min(window.innerHeight - 190, box.top + 16))}px`;
    window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAsk(false); }, { capture: true, signal: abort.signal });
    root.addEventListener("wheel", (event) => event.stopPropagation(), { signal: abort.signal });
  });
}

// A whole folder from the computer: its pictures are copied into
// input/<its name>, folders inside it too, and the node moves there. Copying
// the same folder again writes over its copies instead of piling up doubles.
async function copyFolder(state, name, pictures) {
  if (!(await askBig(state, name, pictures)) || !state.alive) return;
  const target = folderName(name);
  const queue = pictures.slice(0, COPY_LIMIT);
  state.copying = { done: 0, total: queue.length, name, target };
  paint(state);
  cover(state);
  let copied = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next || !state.alive) return;
      if (await upload(next.file, next.folder ? `${target}/${next.folder}` : target, true)) copied += 1;
      state.copying.done += 1;
      paint(state);
      cover(state);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const total = state.copying.total;
  state.copying = null;
  cover(state);
  if (!state.alive) return;
  setCleared(state, false);
  const folders = await comfyFolders();
  const moved = write(state.node, "folder", `${folders.input || "input"}/${target}`) | 0;
  if (moved) notifyZzmChange(); else await refresh(state);
  paint(state);
  showToast({ detail: `Copied ${copied} picture${copied === 1 ? "" : "s"} from "${name}" into ComfyUI's input folder (input/${target}).` });
  if (copied < total) showToast({ severity: "warn", detail: `${total - copied} could not be copied.` });
  if (pictures.length > COPY_LIMIT) showToast({ severity: "warn", detail: `Only the first ${COPY_LIMIT} pictures were copied.` });
}

// What a drop carries, read while the drop is still happening: the browser
// hands out a dropped folder only then.
function dropped(event) {
  const folders = [];
  const files = [];
  for (const item of [...(event?.dataTransfer?.items ?? [])]) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) folders.push(entry);
    else { const file = item.getAsFile?.(); if (file) files.push(file); }
  }
  if (!folders.length && !files.length) files.push(...(event?.dataTransfer?.files ?? []));
  return { folders, files };
}

// Every picture in a dropped folder, with the folder it sits in below it.
async function picturesIn(entry, below = "", found = []) {
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    for (const child of batch) {
      if (found.length > COPY_LIMIT) return found;
      if (child.name.startsWith(".")) continue;
      if (child.isDirectory) await picturesIn(child, below ? `${below}/${child.name}` : child.name, found);
      else if (PICTURE.test(child.name)) {
        const file = await new Promise((resolve) => child.file(resolve, () => resolve(null)));
        if (file) found.push({ file, folder: below });
      }
    }
  }
  return found;
}

async function takeDrop(state, things) {
  // A drop is the same thing as the picker: whatever the picker was waiting
  // for is over now, and its note must not stay over the tiles.
  endChoosing(state);
  for (const entry of things.folders) {
    const pictures = await picturesIn(entry);
    if (!pictures.length) { showToast({ severity: "warn", detail: `No pictures in "${entry.name}".` }); continue; }
    await copyFolder(state, entry.name, pictures);
  }
  if (!things.folders.length) await addFiles(state, things.files);
}

// Add: pictures, or a whole folder.
let openMenu = null;

function closeMenu() {
  openMenu?.abort.abort();
  openMenu?.root.remove();
  openMenu = null;
}

function addMenu(state, anchor) {
  closeMenu();
  const root = el("div", "zzmaus-if-menu");
  const abort = new AbortController();
  openMenu = { root, abort };
  const row = (text, title, run) => {
    const button = el("button", "zzmaus-if-menu-row", text);
    button.type = "button"; button.title = title;
    button.addEventListener("click", () => { closeMenu(); run(); });
    root.append(button);
  };
  row("图片…", "用系统的选择框挑图片，会复制到输入目录（input/zzm_drop），节点切过去。", () => state.pickFiles.click());
  row("整个文件夹…", "用系统的选择框挑一个文件夹，里面的图片按文件夹名复制到输入目录（input/文件夹名）。", () => chooseFolder(state));
  document.body.append(root);
  const box = anchor.getBoundingClientRect();
  root.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, box.left))}px`;
  root.style.top = `${Math.max(8, Math.min(window.innerHeight - 80, box.bottom + 4))}px`;
  window.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) closeMenu(); }, { capture: true, signal: abort.signal });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); }, { capture: true, signal: abort.signal });
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
  const add = el("button", "zzmaus-if-btn accent", "添加");
  const reload = el("button", "zzmaus-if-btn", "↻");
  const wipe = el("button", "zzmaus-if-btn", "清空");
  all.title = "全选文件夹里的图片，之后新加的也算在内。";
  none.title = "全部取消，再点你要的那几张。";
  reload.title = "重新读取文件夹。";
  wipe.title = "清空已载入的文件夹，面板回到空白，重开工作流也保持空白。点 ↻ 或另选文件夹可以再读回来。";
  for (const button of [all, none, add, reload, wipe]) button.type = "button";
  const picker = el("input");
  picker.type = "file"; picker.multiple = true; picker.accept = "image/*"; picker.style.display = "none";
  const folderPicker = el("input");
  folderPicker.type = "file"; folderPicker.webkitdirectory = true; folderPicker.multiple = true; folderPicker.style.display = "none";
  bar.append(chip, el("span", "zzmaus-if-gap"), all, none, add, reload, wipe);
  const grid = el("div", "zzmaus-if-grid");
  const note = el("div", "zzmaus-if-cover");
  note.hidden = true;
  note.append(el("b"), el("div"), el("div"));
  root.append(bar, grid, note, picker, folderPicker);

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
    node, root, widget, chip, grid, add, abort, cover: note, choosing: null,
    alive: true, list: [], names: [], cells: new Map(), done: new Set(), limit: SHOWN_STEP,
    shown: { folder: "", subfolders: false, sort: "名称" },
    token: 0, timer: null, busy: true, error: "", full: false, last: null, loadedLine: "", key: "",
    view, viewImg, viewName, viewToken: 0, hoverCell: null, hoverTimer: null, folders: null,
    cleared: Boolean(node.properties?.zzmaus_cleared),
    copying: null, pickFiles: picker, pickFolder: folderPicker, dropTimer: null,
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
  add.addEventListener("click", () => addMenu(state, add), { signal });
  picker.addEventListener("change", async () => { await addFiles(state, picker.files); picker.value = ""; }, { signal });
  // A folder chosen in the browser's own folder picker: every file comes with
  // its path below that folder.
  folderPicker.addEventListener("change", async () => {
    endChoosing(state);
    const groups = new Map();
    for (const file of [...folderPicker.files]) {
      if (!PICTURE.test(file.name) || file.name.startsWith(".")) continue;
      const parts = String(file.webkitRelativePath || file.name).split("/");
      const top = parts.length > 1 ? parts[0] : "pictures";
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push({ file, folder: parts.slice(1, -1).join("/") });
    }
    folderPicker.value = "";
    if (!groups.size) { showToast({ severity: "warn", detail: "那个文件夹里没有图片。" }); return; }
    for (const [name, pictures] of groups) await copyFolder(state, name, pictures);
  }, { signal });

  state.pick = () => chooseFolder(state);
  state.refresh = () => refresh(state);
  watchPointer(state);
  // Where ComfyUI's input folder is: pictures added or dropped land there.
  comfyFolders().then((folders) => { state.folders = folders; });

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
      // 换了来源或文件夹：用户明显是想看东西，取消"已清空"状态
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

  // A folder or pictures dropped on the node are copied in.
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
    const things = dropped(event);
    if (!things.folders.length && !things.files.some(isPicture)) return false;
    takeDrop(state, things);
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
      const things = dropped(event);
      if (!things.folders.length && !things.files.some(isPicture)) return;
      takeDrop(state, things);
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
      // A workflow from before the folder was a whole path: back to defaults.
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
      state.watcher?.disconnect();
      state.abort.abort();
      state.choosing?.abort();
      clearTimeout(state.dropTimer);
      clearTimeout(state.hoverTimer);
      state.view?.remove();
      if (openMenu) closeMenu();
      if (openAsk?.root && state.grid.isConnected === false) closeAsk(false);
    });
  },
});
