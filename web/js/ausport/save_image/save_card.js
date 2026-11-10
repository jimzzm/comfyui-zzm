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
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyZzmChange } from "../shared/index.mjs";
import { installNameTokens, previewName as previewTokens } from "../shared/name_tokens.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { ensureCardCss } from "../shared/widget_card.mjs";
import { holdNodeMinWidth, pinVuePanelHeight } from "../shared/panel_layout.mjs";
import {
  FORMAT_LABELS, TAGS, namingMode, previewName, tagsEnabled,
} from "../shared/save_formats.mjs?v=20261105";

const NODE_CLASS = "ZZM_NODES_SaveImage";
const WIDGET_NAME = "zzmaus_save_image_card";
const CSS_ID = "zzmaus-save-image-css";
const NODE_MIN_WIDTH = 340;
const NAME_TITLE = "本地文件名，可以带子目录；下面的标签会追加在它后面。支持令牌：%date:yyyy-MM-dd%、%width%、%KSampler.seed%。";
// Captions, fields, the two-line preview, chips, pills, the embed row and
// the gaps between them; the frontend's wrapper insets ride on top.
const CARD_HEIGHT = 288;
const WRAPPER_INSET = 16;
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
.zzmaus-save{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:8px 9px;overflow:hidden;border:1px solid rgba(192,92,67,.22);border-radius:8px;background:rgba(0,0,0,.28);font:12px/1.3 ${FONT};color:var(--zzm-text,#edeef0);pointer-events:none}
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
.zzmaus-save-chip{height:22px;padding:0 9px;border:1px solid var(--zzm-line,#43484e);border-radius:6px;background:transparent;color:var(--zzm-dim,#b0b4ba);font:600 11.5px/1 ${FONT};cursor:pointer;white-space:nowrap}
.zzmaus-save-chip:hover{color:var(--zzm-text,#edeef0);border-color:${BRAND}}
.zzmaus-save-chip.on{background:${BRAND};border-color:${BRAND};color:#fff}
.zzmaus-save-chips.off .zzmaus-save-chip{opacity:.4;pointer-events:none}
.zzmaus-save-embed-label{flex:0 0 30%;color:var(--zzm-dim,#b0b4ba);font-size:11.5px;user-select:none}
.zzmaus-save-browse{position:fixed;z-index:10000;width:260px;max-height:320px;overflow:auto;padding:4px;border:1px solid var(--zzm-line,#43484e);border-radius:7px;background:var(--zzm-panel,#212225);box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.3 ${FONT};color:var(--zzm-text,#edeef0)}
.zzmaus-save-browse-head{padding:5px 8px 6px;border-bottom:1px solid var(--zzm-chip-bg,#2e3135);color:var(--zzm-dim,#b0b4ba);font:11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zzmaus-save-browse button{display:block;width:100%;padding:6px 8px;border:none;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.zzmaus-save-browse button:hover{background:var(--zzm-line-soft,#363a3f)}
.zzmaus-save-browse button.use{color:${BRAND};font-weight:600}
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
  let path = /^([A-Za-z]:[\\/]|\/|~)/.test(current) ? "" : current.replace(/^\/+|\/+$/g, "");
  const render = async () => {
    popup.textContent = "";
    popup.append(el("div", "zzmaus-save-browse-head", `ComfyUI/output/${path}`));
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

function buildCard(node) {
  ensureCss();
  const root = el("div", "zzmaus-save");
  const state = { node, root, savedPath: null, alive: true };
  node.__zzmausSaveImage = state;
  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (!target) continue;
    hideWidget(target);
    // The legacy caption is a multiline DOM widget: collapsing its layout is
    // not enough, its textarea has to go too. Its value still saves.
    if (target.element) target.element.style.display = "none";
  }

  // Folder
  root.append(el("div", "zzmaus-save-cap", "文件夹"));
  const folderRow = el("div", "zzmaus-save-row");
  const folder = textField(state, "output_dir", "ComfyUI/output", "存到 ComfyUI 输出目录下的哪个子文件夹，例如 sets/portraits。留空就存到输出目录本身；这个节点只往输出目录里写，不会写到外面。");
  const browse = el("button", "zzmaus-card-btn", "浏览");
  browse.title = "选择 ComfyUI 输出目录里的子文件夹";
  browse.addEventListener("click", () => {
    if (openPopup?.anchor === browse) closeBrowse();
    else openBrowse(state, browse);
  });
  folderRow.append(folder, browse);
  root.append(folderRow);

  // Filename
  root.append(el("div", "zzmaus-save-cap", "文件名"));
  const nameRow = el("div", "zzmaus-save-row");
  const nameField = textField(state, "filename_prefix", "image", NAME_TITLE);
  const nameTag = el("span", "zzmaus-save-tag", "");
  nameRow.append(nameField, nameTag);
  root.append(nameRow);

  // Path preview
  root.append(el("div", "zzmaus-save-cap", "路径预览"));
  const preview = el("div", "zzmaus-save-preview");
  const previewNameLine = el("div", "name");
  preview.append(previewNameLine);
  preview.title = "这次会存成什么名字；跑完之后显示它实际写下的第一个文件。";
  root.append(preview);

  // Tags
  const chips = el("div", "zzmaus-save-chips");
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

  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });

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
  };

  const domWidget = node.addDOMWidget(WIDGET_NAME, WIDGET_NAME, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => CARD_HEIGHT + WRAPPER_INSET,
  });
  keepDomWidgetWidthAuto(domWidget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  domWidget.serialize = false;
  // A constant-height card, pinned on purpose (tests/panel_guards.test.mjs,
  // fixedByDesign): fields and pills, not a stage that follows the node.
  domWidget.computeSize = (width) => [Math.max(NODE_MIN_WIDTH, Number(width || node.size?.[0] || NODE_MIN_WIDTH)), CARD_HEIGHT + WRAPPER_INSET];
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

  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (target) chainCallback(target, "callback", () => state.refresh());
  }
  chainCallback(node, "onConfigure", () => queueMicrotask(() => {
    for (const name of HIDDEN) { const target = widget(node, name); if (target) { hideWidget(target); if (target.element) target.element.style.display = "none"; } }
    // 旧工作流里存的格式是 "jxl 无损"（这一版换成了 jpg），加载时顺手改过来
    const formatWidget = widget(node, "format");
    if (formatWidget && String(formatWidget.value).toLowerCase().startsWith("jxl")) formatWidget.value = "jpg";
    state.savedPath = null; state.refresh();
  }));
  chainCallback(node, "onConnectionsChange", () => queueMicrotask(() => state.refresh()));
  chainCallback(node, "onExecuted", (output) => {
    if (isForeignRun()) return;
    const saved = output?.zzmaus_saved_path?.[0];
    if (typeof saved === "string" && saved) { state.savedPath = saved; state.refresh(); }
  });
  chainCallback(node, "onRemoved", () => { state.alive = false; closeBrowse(); });
  state.refresh();
  node.setSize?.([Math.max(node.size?.[0] || 0, NODE_MIN_WIDTH), node.computeSize?.()[1] || CARD_HEIGHT]);
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
      // %date:yyyy-MM-dd% and %Node.setting% in the name (js/shared/name_tokens.mjs).
      installNameTokens(this, ["filename_prefix", "exact_name"], app);
    });
  },
});
