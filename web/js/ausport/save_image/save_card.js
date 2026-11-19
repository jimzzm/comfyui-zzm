// Save Image 🆎: one compact card in place of the widget stack.
//
// Folder (with a Browse into ComfyUI's output folder), Filename, a live
// Path preview, the name tags as small chips, the Format pills and the
// Embed workflow pill. The saved picture below is js/input_preview's panel.
// The standard widgets stay the source of truth and stay serialized in
// their old order; the card only reads and writes them.
// When the `filename` input is linked the name comes from upstream: the
// field shows {{filename}} and the tags fold away, since an exact name is
// never decorated.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { isForeignRun } from "../shared/prompt_scope.mjs?v=20261116";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs?v=20261116";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyZzmChange, showToast } from "../shared/index.mjs?v=20261116";
import { installNameTokens, previewName as previewTokens } from "../shared/name_tokens.mjs?v=20261116";
import { hideInputsInDef, hideWidget, showWidget } from "../shared/widget_visibility.mjs?v=20261116";
import { ensureCardCss } from "../shared/widget_card.mjs?v=20261116";
import { holdNodeMinWidth, pinVuePanelHeight } from "../shared/panel_layout.mjs?v=20261116";
import {
  FORMAT_LABELS, TAGS, isAbsoluteFolder, namingMode, previewFolder, previewName, tagsEnabled,
} from "../shared/save_formats.mjs?v=20261116";

const NODE_CLASS = "ZZM_NODES_SaveImage";
const WIDGET_NAME = "zzmaus_save_image_card";
const CSS_ID = "zzmaus-save-image-css";
const NODE_MIN_WIDTH = 340;
const NAME_TITLE = "本地文件名，可以带子目录；下面的标签会追加在它后面。支持令牌：%date:yyyy-MM-dd%、%width%、%KSampler.seed%。";
// Captions, fields, the two-line preview, chips, pills, the embed row and
// the gaps between them; the frontend's wrapper insets ride on top.
const CARD_BODY = 288;
const CARD_HEIGHT = CARD_BODY;
// The fold toggle is its own row above the card's frame: a small widget of
// its own, not a row inside the card (zzm 2026-11-18).
const FOLD_BAR = 22;
const WRAPPER_INSET = 16;
// Kept in node.properties with the same name a widget card's disclosure uses
// (zzmaus_show_<group>), so the fold travels with the workflow exactly the
// way the pack's group rows do.
const FOLD_PROP = "zzmaus_show_settings";
const HIDDEN = [
  "filename_prefix", "format", "save_metadata", "exact_name", "on_existing",
  "output_dir", "caption", "name_counter", "name_date", "name_time", "name_size", "name_batch",
];
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

function ensureCss() {
  ensureCardCss();
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.zzmaus-save{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:8px 9px;margin-top:-10px;overflow:hidden;border:1px solid rgba(192,92,67,.22);border-radius:8px;background:rgba(0,0,0,.28);font:12px/1.3 ${FONT};color:var(--zzm-text,#edeef0);pointer-events:none}
/* Fold toggle, taken from Pixaroma's Save Image (js/save_image/ui.mjs): an
   orange square with a white CSS triangle, on its own strip ABOVE the card
   frame - it drives the card, it is not a row of it. Unfolded it shows the
   up-pointing triangle (fold away), folded the down-pointing one (open).
   Folded, the strip also says where the next save lands, so a folded node
   still tells you what it is about to write. */
.zzmaus-save-foldbar{box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;gap:8px;justify-content:flex-start;pointer-events:none}
.zzmaus-save-fold{width:24px;height:22px;border:none;border-radius:4px;background:${BRAND};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:0 0 auto;pointer-events:auto}
.zzmaus-save-fold:hover{background:#D26B52}
.zzmaus-save-fold i{display:block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent}
.zzmaus-save-fold:not(.folded) i{border-bottom:6px solid #fff}
.zzmaus-save-fold.folded i{border-top:6px solid #fff}
.zzmaus-save-foldinfo{display:none;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11.5px/1 ${MONO};color:var(--zzm-dim,#b0b4ba);pointer-events:none}
.zzmaus-save-foldbar.folded .zzmaus-save-foldinfo{display:block}
/* The folder button sits on the strip beside the toggle and never folds: it is
   a control of the node, like the triangle, not part of the settings. */
.zzmaus-save-open{display:inline-flex;align-items:center;height:22px;padding:0 10px;border:none;border-radius:4px;background:${BRAND};color:#fff;font:11.5px/1 ${FONT};cursor:pointer;flex:0 0 auto;margin-left:auto;pointer-events:auto}
.zzmaus-save-open:hover{background:#D26B52}
.zzmaus-save.folded{display:none;margin:0}
.zzmaus-save-cap{height:14px;flex:none;color:var(--zzm-dim,#b0b4ba);font-size:11px;letter-spacing:.12em;text-transform:uppercase;user-select:none}
.zzmaus-save-row{display:flex;align-items:center;gap:6px;flex:none;height:26px;pointer-events:auto}
.zzmaus-save .zzmaus-card-seg.zzmaus-save-format{height:36px;flex:none;pointer-events:auto}
.zzmaus-save .zzmaus-save-format button{font-size:12px}
.zzmaus-save-row.linked .zzmaus-card-text{color:var(--zzm-dim,#b0b4ba);font-family:${MONO}}
.zzmaus-save-tag{flex:none;color:${BRAND};font-size:11.5px;padding:0 4px;user-select:none}
.zzmaus-save-preview{flex:none;padding:6px 9px;border:1px solid var(--zzm-line-soft,#363a3f);border-radius:6px;background:var(--zzm-field,#212225);font-family:${MONO};overflow:hidden;pointer-events:auto}
.zzmaus-save-preview .name{color:var(--zzm-text,#edeef0);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zzmaus-save-preview.saved .name{color:${BRAND}}
.zzmaus-save-chips{display:flex;flex-wrap:wrap;gap:5px;flex:none;pointer-events:auto}
.zzmaus-save-chip{height:22px;padding:0 9px;border:1px solid var(--zzm-line,#43484e);border-radius:6px;background:transparent;color:var(--zzm-dim,#b0b4ba);font:400 11.5px/1 ${FONT};cursor:pointer;white-space:nowrap}
.zzmaus-save-chip:hover{color:var(--zzm-text,#edeef0);border-color:${BRAND}}
.zzmaus-save-chip.on{background:${BRAND};border-color:${BRAND};color:#fff}
.zzmaus-save-chips.off .zzmaus-save-chip{opacity:.4;pointer-events:none}
.zzmaus-save-embed-label{flex:0 0 30%;color:var(--zzm-dim,#b0b4ba);font-size:11.5px;user-select:none}
.zzmaus-save-browse{position:fixed;z-index:10000;width:260px;max-height:320px;overflow:auto;padding:4px;border:1px solid var(--zzm-line,#43484e);border-radius:7px;background:var(--zzm-panel,#212225);box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.3 ${FONT};color:var(--zzm-text,#edeef0)}
.zzmaus-save-browse-head{padding:5px 8px 6px;border-bottom:1px solid var(--zzm-chip-bg,#2e3135);color:var(--zzm-dim,#b0b4ba);font:11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zzmaus-save-browse button{display:block;width:100%;padding:6px 8px;border:none;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.zzmaus-save-browse button:hover{background:var(--zzm-line-soft,#363a3f)}
.zzmaus-save-browse button.use{color:${BRAND}}
`;
  document.head.append(style);
}

const el = (tag, className = "", text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name) ?? null;
}

function value(node, name, fallback) {
  const target = widget(node, name);
  return target ? target.value : fallback;
}

function filenameLinked(node) {
  return Boolean(node.inputs?.some((input) => input?.name === "filename" && input.link !== null && input.link !== undefined));
}

function inputConnected(node, input) {
  if (!input) return false;
  // 挂在图上才问前端；加载途中 graph 未就绪时只有序列化里的 link 镜像可看。
  if (node.graph && typeof node.isInputConnected === "function") return node.isInputConnected(input);
  return input.link != null;
}

// 每个 widget 在图上还挂着一个「widget 输入槽」。卡片把它们藏了，槽却还在：
// 前端按 `pos = [10, widget.y + 10]` 给 widget 槽定位（LGraphNode
// _arrangeWidgetInputSlots），而隐藏的 widget 不参与布局、y 恒为 0 ——
// 十几个槽全叠在 (10, 10)，跟 images 槽的 (10, 14) 只差 4px。悬停时前端
// 按「鼠标在槽上」把这些槽画出来（drawSlots 对 widget 槽只在悬停/连线时画），
// 提示气泡还是那个 widget 自己的说明 —— 就是 zzm 2026-11-19 截图里的
// 「两个几乎重叠的点，一个悬停才有反应、注释还不一样」。
// 这些槽接不了线（widget 已被卡片接管、藏掉了），带着只会让人误连，直接摘掉。
// 有线的跳过：存量工作流扫描过 26 个实例，一条都没有，但不能赌。
function dropHiddenWidgetSlots(node) {
  const inputs = node.inputs;
  if (!Array.isArray(inputs) || !inputs.length) return 0;
  let removed = 0;
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const input = inputs[index];
    const name = input?.widget?.name;
    if (!name || inputConnected(node, input)) continue;
    const target = node.widgets?.find((item) => item?.name === name);
    if (!target) continue;
    if (!target.hidden && !target.options?.hidden) continue;
    inputs.splice(index, 1);
    removed += 1;
  }
  if (removed) {
    // 槽数组换了长度，重排一次；DOM 侧的卡片高度不受影响。
    node._widgetSlotsDirty = true;
    node.graph?.setDirtyCanvas?.(true, true);
  }
  return removed;
}

function setValue(node, name, next) {
  const target = widget(node, name);
  if (!target || target.value === next) return false;
  target.value = next;
  target.callback?.(next, app.canvas, node);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function readValues(node) {
  const values = {};
  for (const name of HIDDEN) values[name] = value(node, name, undefined);
  values.filenameLinked = filenameLinked(node);
  return values;
}

// ---------- the Browse popup: subfolders of ComfyUI's output folder ----------

let openPopup = null;
function closeBrowse() {
  openPopup?.abort.abort();
  openPopup?.element.remove();
  openPopup = null;
}

async function listFolders(path) {
  const response = await api.fetchApi(`/zzmaus/save_image/folders?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "读不到文件夹列表。");
  return response.json();
}

async function openBrowse(state, anchor) {
  closeBrowse();
  const popup = el("div", "zzmaus-save-browse");
  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 270))}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  document.body.append(popup);
  // The dismiss listeners live and die with this popup, so a second Browse
  // never leaves an old one behind to close the new popup.
  const abort = new AbortController();
  openPopup = { element: popup, anchor, abort };
  const current = String(value(state.node, "output_dir", "")).trim().replace(/\\/g, "/");
  // A full path is browsed exactly as typed - that folder is the save root.
  let path = isAbsoluteFolder(current) ? current : current.replace(/^\/+|\/+$/g, "");
  const render = async () => {
    popup.textContent = "";
    popup.append(el("div", "zzmaus-save-browse-head", isAbsoluteFolder(path) ? path : `ComfyUI/output/${path}`));
    let listing;
    try {
      listing = await listFolders(path);
    } catch (error) {
      popup.append(el("div", "zzmaus-save-browse-head", error.message));
      return;
    }
    path = listing.path;
    const use = el("button", "use", path ? `Use “${path}”` : "用输出目录");
    use.addEventListener("click", () => { setValue(state.node, "output_dir", path); state.refresh(); notifyZzmChange(); closeBrowse(); });
    popup.append(use);
    if (path) {
      const up = el("button", "", "↑ up one level");
      up.addEventListener("click", () => { path = path.split("/").slice(0, -1).join("/"); render(); });
      popup.append(up);
    }
    for (const folder of listing.folders) {
      const button = el("button", "", `📁 ${folder}`);
      button.addEventListener("click", () => { path = path ? `${path}/${folder}` : folder; render(); });
      popup.append(button);
    }
    if (!listing.folders.length) popup.append(el("div", "zzmaus-save-browse-head", "这里没有子文件夹"));
  };
  window.addEventListener("pointerdown", (event) => {
    if (popup.contains(event.target) || event.target === anchor) return;
    closeBrowse();
  }, { capture: true, signal: abort.signal });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeBrowse();
  }, { capture: true, signal: abort.signal });
  await render();
}

// ---------- the card ----------

function textField(state, name, placeholder, title) {
  const input = el("input", "zzmaus-card-text");
  input.type = "text"; input.placeholder = placeholder; input.title = title; input.spellcheck = false;
  // A field may stand in for another widget (the name field shows a legacy
  // exact name); dataset.target names the widget it currently edits.
  const target = () => input.dataset.target || name;
  const commit = () => {
    if (input.disabled) return;
    if (setValue(state.node, target(), input.value.trim())) { state.savedPath = null; notifyZzmChange(); }
    state.refresh();
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    keepKeyInField(event);
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") { input.value = String(value(state.node, target(), "")); input.blur(); }
  });
  return input;
}

// Open the save folder in the OS file manager - ComfyUI-Pixaroma's Folder
// button, same route shape: the backend opens it only for a local caller and
// refuses a network path before touching the disk.
async function openSaveFolder(node) {
  try {
    const response = await api.fetchApi("/zzmaus/save_image/open_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: String(value(node, "output_dir") ?? "") }),
    });
    const result = await response.json().catch(() => null);
    if (!result?.ok) showToast({ detail: result?.message || "打不开这个文件夹。", severity: "warn" });
  } catch (_error) {
    showToast({ detail: "打不开这个文件夹。", severity: "warn" });
  }
}

function buildCard(node) {
  ensureCss();
  const root = el("div", "zzmaus-save");
  const state = {
    node, root, savedPath: null, alive: true,
    collapsed: Boolean(node.properties?.[FOLD_PROP]),
  };
  node.__zzmausSaveImage = state;
  // The card's own height follows the fold: a fixed card, but one whose fixed
  // number changes when the settings are folded away.
  // Folded, the whole frame goes away - settings, format pills and the embed
  // row all give their room to the picture, which is what a folded node is
  // for. Only the strip above (toggle + "保存在") stays.
  const cardBox = () => (state.collapsed ? 0 : CARD_HEIGHT + WRAPPER_INSET);
  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (!target) continue;
    hideWidget(target);
    // The legacy caption is a multiline DOM widget: collapsing its layout is
    // not enough, its textarea has to go too. Its value still saves.
    if (target.element) target.element.style.display = "none";
  }
  // The preview switch is gone from the face (zzm 2026-11-18): you save a
  // picture to look at it. The widget stays in the graph - older workflows
  // carry it and the picture panel reads it - but it is pinned on and hidden.
  const previewFlag = widget(node, "preview");
  if (previewFlag) {
    hideWidget(previewFlag);
    if (previewFlag.element) previewFlag.element.style.display = "none";
    if (previewFlag.value !== true) previewFlag.value = true;
  }

  // The fold toggle lives on its own strip above the card (a widget of its
  // own, spliced in ahead of the card below), not among the card's rows.
  const foldBtn = el("button", "zzmaus-save-fold");
  foldBtn.type = "button";
  foldBtn.appendChild(el("i"));
  // Folded, this says where the next save lands ("保存路径：sets/portrait.png")
  // and carries the folder button on the right - a folded node is exactly when
  // you want to go look at what it wrote (Pixaroma's Folder button, same strip).
  const foldInfo = el("span", "zzmaus-save-foldinfo");
  const foldOpen = el("button", "zzmaus-save-open", "打开");
  foldOpen.type = "button";
  foldOpen.title = "在文件管理器里打开保存文件夹";
  foldOpen.addEventListener("pointerdown", (event) => event.stopPropagation());
  foldOpen.addEventListener("click", () => openSaveFolder(node));
  const foldBar = el("div", "zzmaus-save-foldbar");
  foldBar.append(foldBtn, foldInfo, foldOpen);

  // Folder (a setting: folds away)
  root.append(el("div", "zzmaus-save-cap zzmaus-save-foldable", "文件夹"));
  const folderRow = el("div", "zzmaus-save-row zzmaus-save-foldable");
  // Folder: a subfolder of output, or a full path (F:\下载\网图) to save
  // straight into a library on any local drive.
  const folder = textField(state, "output_dir", "output 子目录 或 F:\\下载\\网图", "存到哪里：留空 = ComfyUI 的 output 目录；填 sets/portraits = output 下的子目录；填完整路径（如 F:\\下载\\网图）= 直接存到那个文件夹，不存在会自动建。不支持网络路径 \\\\server\\share。");
  const browse = el("button", "zzmaus-card-btn", "浏览");
  browse.title = "挑一个文件夹";
  browse.addEventListener("click", () => {
    if (openPopup?.anchor === browse) closeBrowse();
    else openBrowse(state, browse);
  });
  // Open the folder in the OS file manager (Pixaroma's Folder button: the
  // route is local-only and refuses network paths before touching the disk).
  folderRow.append(folder, browse);
  root.append(folderRow);

  // Filename (a setting: folds away)
  root.append(el("div", "zzmaus-save-cap zzmaus-save-foldable", "文件名"));
  const nameRow = el("div", "zzmaus-save-row zzmaus-save-foldable");
  const nameField = textField(state, "filename_prefix", "image", NAME_TITLE);
  const nameTag = el("span", "zzmaus-save-tag", "");
  nameRow.append(nameField, nameTag);
  root.append(nameRow);

  // Path preview (a setting: folds away)
  root.append(el("div", "zzmaus-save-cap zzmaus-save-foldable", "路径预览"));
  const preview = el("div", "zzmaus-save-preview zzmaus-save-foldable");
  const previewNameLine = el("div", "name");
  preview.append(previewNameLine);
  preview.title = "这次会存成什么名字；跑完之后显示它实际写下的第一个文件。";
  root.append(preview);

  // Tags (settings too: they fold away with the name)
  const chips = el("div", "zzmaus-save-chips zzmaus-save-foldable");
  const chipButtons = new Map();
  for (const tag of TAGS) {
    const chip = el("button", "zzmaus-save-chip", tag.label);
    chip.type = "button"; chip.title = tag.title;
    chip.addEventListener("click", () => {
      if (setValue(node, tag.key, !Boolean(value(node, tag.key, false)))) { state.savedPath = null; notifyZzmChange(); }
      state.refresh();
    });
    chips.append(chip); chipButtons.set(tag.key, chip);
  }
  root.append(chips);

  // Format: the pill alone, tall enough to read as the one big choice on
  // the card - the three names say what it is.
  const seg = el("div", "zzmaus-card-seg zzmaus-save-format");
  const formatButtons = new Map();
  const formatTitles = {
    png: "无损、兼容性最好。保留透明通道，还能把工作流嵌进文件，拖回 ComfyUI 可还原。",
    "webp 无损": "无损，通常比 PNG 小，保留透明；工作流走 EXIF，拖回 ComfyUI 能还原。",
    "jpg": "兼容性最好、体积最小，质量 95。没有透明通道（透明区压黑底）；工作流拖回 ComfyUI 认不出来，只当图片载入。",
  };
  // 选项以节点自己的 widget 为准（那就是 Python 的 IMAGE_FORMATS）；
  // FORMAT_LABELS 只负责给个好看的名字，后端换了格式这里跟着变
  const formatKeys = (() => {
    const spec = node.widgets?.find((item) => item?.name === "format")?.options;
    const values = Array.isArray(spec?.values) ? spec.values : [];
    return values.length ? values : Object.keys(FORMAT_LABELS);
  })();
  for (const key of formatKeys) {
    const label = FORMAT_LABELS[key] ?? String(key).toUpperCase();
    const button = el("button", "", label);
    button.type = "button"; button.title = formatTitles[key] ?? key;
    button.addEventListener("click", () => { if (setValue(node, "format", key)) { state.savedPath = null; notifyZzmChange(); } state.refresh(); });
    seg.append(button); formatButtons.set(key, button);
  }
  root.append(seg);

  // Embed workflow: a no | yes pill, the pack's boolean.
  const embedRow = el("div", "zzmaus-save-row");
  const embedSeg = el("div", "zzmaus-card-seg zzmaus-card-bool");
  embedSeg.setAttribute("role", "radiogroup");
  const embedButtons = new Map();
  const embedTitle = "开启：把提示词和工作流嵌进图里，拖回 ComfyUI 能还原（只有 png / webp 认，jpg 拖回去只当图片载入）；关闭：写出干净的图，适合发人或者做数据集。";
  for (const [on, text] of [[false, "否"], [true, "是"]]) {
    const button = el("button", "", text);
    button.type = "button"; button.title = embedTitle;
    button.addEventListener("click", () => { if (setValue(node, "save_metadata", on)) notifyZzmChange(); state.refresh(); });
    embedSeg.append(button); embedButtons.set(on, button);
  }
  embedRow.append(el("span", "zzmaus-save-embed-label", "嵌入工作流"), embedSeg);
  root.append(embedRow);

  // Clicks on the toggle and on the controls stay out of the graph's drag;
  // empty card space still falls through.
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });

  // ---------- folding (Pixaroma's Save Image behaviour) ----------
  // Hiding the settings shortens the card, and the node shrinks by exactly
  // that much (applyFold in Pixaroma's js/save_image/index.js), so the picture
  // panel below keeps the size it had. Loading a workflow only sets the look
  // and trusts the size the workflow saved.
  const relayout = () => {
    if (!state.alive) return;
    const floor = Number(node.computeSize?.()?.[1]) || cardBox();
    const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
    const height = Math.max(Number(node.size?.[1]) || floor, floor);
    if (height !== Number(node.size?.[1])) node.setSize?.([width, height]);
    try { node.arrange?.(); } catch (_error) { /* older frontend: the next draw sorts it */ }
    node._widgetSlotsDirty = true;
    node.graph?.setDirtyCanvas?.(true, true);
    requestAnimationFrame(() => {
      if (!state.alive) return;
      node._widgetSlotsDirty = true;
      node.graph?.setDirtyCanvas?.(true, true);
    });
  };

  const updateFoldIcon = () => {
    foldBtn.classList.toggle("folded", state.collapsed);
    foldBar.classList.toggle("folded", state.collapsed);
    foldBtn.title = state.collapsed
      ? "展开 —— 显示文件夹、文件名、格式和嵌入设置"
      : "折叠 —— 收起整块设置，把地方让给下面的图";
  };

  // remember = false for the state a workflow was saved with: no dirty mark,
  // no undo entry, nothing to write back.
  const applyFold = (collapsed, { resize = true, remember = true } = {}) => {
    const next = Boolean(collapsed);
    const changing = state.collapsed !== next;
    state.collapsed = next;
    root.classList.toggle("folded", next);
    // The card's widget leaves the layout entirely (hideWidget, the pack's
    // own zero-height switch): display:none alone left the wrapper standing
    // at its old height - a transparent band over the picture that also ate
    // the clicks meant for it.
    if (state.widget) {
      if (next && !state.widget.hidden) hideWidget(state.widget);
      else if (!next && state.widget.hidden) showWidget(state.widget);
    }
    updateFoldIcon();
    state.refresh?.();
    if (next) closeBrowse();
    if (remember) {
      node.properties ??= {};
      node.properties[FOLD_PROP] = next;
      notifyZzmChange();
    }
    if (resize && changing) {
      // The height the card gave back, taken off the node so the panel below
      // does not move; on unfold the same amount comes back.
      const shrink = CARD_HEIGHT + WRAPPER_INSET;
      const floor = Number(node.computeSize?.()?.[1]) || 0;
      const current = Number(node.size?.[1]) || floor;
      const target = Math.max(floor, current + (next ? -shrink : shrink));
      const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
      node.setSize?.([width, target]);
    }
    relayout();
  };
  // pointerdown stopped here too: the canvas must not start dragging the node
  // when the toggle is pressed, or the release lands elsewhere and no click
  // ever fires (the toggle looked dead).
  foldBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  foldBtn.addEventListener("click", () => applyFold(!state.collapsed));

  state.refresh = () => {
    if (!state.alive) return;
    const values = readValues(node);
    const mode = namingMode({ filenameLinked: values.filenameLinked, exactName: values.exact_name });
    if (document.activeElement !== folder) folder.value = String(values.output_dir ?? "");
    nameRow.classList.toggle("linked", mode === "linked");
    nameField.disabled = mode === "linked";
    if (mode === "linked") {
      nameField.value = "{{filename}}"; nameTag.textContent = "linked";
      nameField.title = "文件名来自「文件名」输入。";
    } else if (mode === "exact") {
      if (document.activeElement !== nameField) nameField.value = String(values.exact_name ?? "");
      nameTag.textContent = "exact";
      nameField.title = "精确文件名（旧参数）：用这个名字原样保存，不加任何标签。清空则按前缀组合。";
    } else {
      if (document.activeElement !== nameField) nameField.value = String(values.filename_prefix ?? "");
      nameTag.textContent = "";
      nameField.title = NAME_TITLE;
    }
    // An exact-mode edit writes the exact name; a local-mode edit the prefix.
    nameField.dataset.target = mode === "exact" ? "exact_name" : "filename_prefix";
    if (state.savedPath) {
      const slash = state.savedPath.lastIndexOf("/");
      previewNameLine.textContent = state.savedPath.slice(slash + 1);
      preview.classList.add("saved");
    } else {
      // Name tokens show as what they will be: %date:yyyy-MM-dd% as today's date.
      const shown = { ...values, filename_prefix: previewTokens(values.filename_prefix, app), exact_name: previewTokens(values.exact_name, app) };
      previewNameLine.textContent = previewName(shown);
      preview.classList.remove("saved");
    }
    chips.classList.toggle("off", !tagsEnabled(values));
    for (const [key, chip] of chipButtons) chip.classList.toggle("on", Boolean(values[key]));
    for (const [key, button] of formatButtons) button.classList.toggle("on", values.format === key);
    const embed = Boolean(values.save_metadata);
    for (const [on, button] of embedButtons) {
      button.classList.toggle("on", on === embed);
      button.setAttribute("aria-checked", String(on === embed));
    }
    // The folded strip's line: the whole destination, folder and all - the
    // output folder, the subfolder field and any subfolder typed into the
    // name, then the file name (previewFolder/previewName in save_formats).
    // After a run it names the file that really landed.
    const where = state.savedPath
      ? state.savedPath
      : `${previewFolder(values)}${previewNameLine.textContent}`;
    foldInfo.textContent = `保存路径：${where}`;
    foldInfo.title = where;
  };

  const domWidget = node.addDOMWidget(WIDGET_NAME, WIDGET_NAME, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => cardBox(),
  });
  keepDomWidgetWidthAuto(domWidget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  domWidget.serialize = false;
  state.widget = domWidget;
  // A constant-height card, pinned on purpose (tests/panel_guards.test.mjs,
  // fixedByDesign): fields and pills, not a stage that follows the node.
  domWidget.computeSize = (width) => [Math.max(NODE_MIN_WIDTH, Number(width || node.size?.[0] || NODE_MIN_WIDTH)), cardBox()];
  // Pinned in Nodes 2.0 as well: the saved picture below takes the node's
  // spare height there too.
  pinVuePanelHeight(domWidget);
  domWidget.options.minNodeSize = [NODE_MIN_WIDTH, 120];
  // A pinned card is skipped by the frontend's width rule, so the card's
  // number becomes the node's floor here (panel_layout.mjs).
  holdNodeMinWidth(domWidget, NODE_MIN_WIDTH);
  // Ahead of the legacy caption textarea, which stays hidden underneath.
  const index = node.widgets.indexOf(domWidget);
  const firstDom = node.widgets.findIndex((item) => item !== domWidget && item.element);
  if (index >= 0 && firstDom >= 0 && firstDom < index) {
    node.widgets.splice(index, 1); node.widgets.splice(firstDom, 0, domWidget);
  }

  // The fold toggle as its own widget, right above the card's frame.
  const foldWidget = node.addDOMWidget("zzmaus_save_fold", "zzmaus_save_fold", foldBar, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => FOLD_BAR + WRAPPER_INSET,
  });
  keepDomWidgetWidthAuto(foldWidget);
  foldWidget.serialize = false;
  foldWidget.computeSize = (width) => [Math.max(NODE_MIN_WIDTH, Number(width || node.size?.[0] || NODE_MIN_WIDTH)), FOLD_BAR + WRAPPER_INSET];
  pinVuePanelHeight(foldWidget);
  foldWidget.options.minNodeSize = [NODE_MIN_WIDTH, 120];
  holdNodeMinWidth(foldWidget, NODE_MIN_WIDTH);
  // Directly before the card: addDOMWidget appends, so move it up one slot.
  const foldAt = node.widgets.indexOf(foldWidget);
  const cardAt = node.widgets.indexOf(domWidget);
  if (foldAt >= 0 && cardAt >= 0 && foldAt > cardAt) {
    node.widgets.splice(foldAt, 1);
    node.widgets.splice(cardAt, 0, foldWidget);
  }

  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (target) chainCallback(target, "callback", () => state.refresh());
  }
  chainCallback(node, "onConfigure", () => queueMicrotask(() => {
    for (const name of HIDDEN) { const target = widget(node, name); if (target) { hideWidget(target); if (target.element) target.element.style.display = "none"; } }
    // A workflow saved while the preview could be switched off comes back with
    // it on: the switch no longer exists on the face.
    const flag = widget(node, "preview");
    if (flag) { hideWidget(flag); if (flag.element) flag.element.style.display = "none"; flag.value = true; }
    // 老工作流里存着 16 条输入（含 13 个 widget 槽），加载时原样恢复 —— 隐藏
    // widget 之后再把它们摘掉，否则幽灵点又回来。
    dropHiddenWidgetSlots(node);
    // 旧工作流里存的格式是 "jxl 无损"（这一版换成了 jpg），加载时顺手改过来
    const formatWidget = widget(node, "format");
    if (formatWidget && String(formatWidget.value).toLowerCase().startsWith("jxl")) formatWidget.value = "jpg";
    // The workflow carries the fold it was saved with. Restoring it only sets
    // the look (no resize, no dirty mark): the saved node size already fits it.
    applyFold(Boolean(node.properties?.[FOLD_PROP]), { resize: false, remember: false });
    state.savedPath = null; state.refresh();
  }));
  chainCallback(node, "onConnectionsChange", () => queueMicrotask(() => state.refresh()));
  chainCallback(node, "onExecuted", (output) => {
    if (isForeignRun()) return;
    const saved = output?.zzmaus_saved_path?.[0];
    if (typeof saved === "string" && saved) { state.savedPath = saved; state.refresh(); }
  });
  chainCallback(node, "onRemoved", () => { state.alive = false; closeBrowse(); });
  // A node dragged out fresh starts unfolded; a loaded one already has its
  // saved state, applied in onConfigure.
  applyFold(state.collapsed, { resize: false, remember: false });
  state.refresh();
  node.setSize?.([Math.max(node.size?.[0] || 0, NODE_MIN_WIDTH), node.computeSize?.()[1] || cardBox()]);
  return state;
}

app.registerExtension({
  name: "zzmaus.save_image",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, HIDDEN);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__zzmausSaveImage) return;
      buildCard(this);
      // buildCard 已把这些 widget 藏掉，它们留下的空槽现在才能认出并摘掉。
      dropHiddenWidgetSlots(this);
      // %date:yyyy-MM-dd% and %Node.setting% in the name (js/shared/name_tokens.mjs).
      installNameTokens(this, ["filename_prefix", "exact_name"], app);
    });
  },
});
