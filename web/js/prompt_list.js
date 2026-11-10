// 多段提示词（逐条）—— Pixaroma 风格的节点面板
//
// 原生 widget 全部隐藏，值仍然由它们持有（工作流序列化、后端读取都不变），
// DOM 控件只做「显示 + 写回」。分段逻辑在 JS 里复刻了一份 Python 的
// split_text/_clean_parts，用来实时算「共 N 段」和分段预览。

import { app } from "/scripts/app.js";
import {
  injectTheme, el, label, btn, chip, seg, applyThemeVars, onThemeChange,
  hideWidgets, keepWidthAuto, markChanged,
} from "./zzm_theme.mjs";

const MODE_AUTO = "自动（空行优先，无空行按换行）";
const MODE_BLANK = "空行分段";
const MODE_LINE = "每行一段";
const MODE_SPACE = "空格分段（中文提示词常用）";
const MODE_CUSTOM = "自定义分隔符";

const MODES = [
  { v: MODE_AUTO, t: "自动" },
  { v: MODE_BLANK, t: "空行" },
  { v: MODE_LINE, t: "每行" },
  { v: MODE_SPACE, t: "空格" },
  { v: MODE_CUSTOM, t: "自定义" },
];

const DEFAULT_W = 480;
const DEFAULT_H = 700;
const MIN_H = 520;

// ---------------------------------------------------------------------------
// 分段逻辑（与 nodes_prompt_list.py 保持一致）
// ---------------------------------------------------------------------------
function splitText(text, mode, sep) {
  let t = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!t) return [""];
  if (mode === MODE_CUSTOM) {
    const s = String(sep ?? "").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    return s ? t.split(s) : [t];
  }
  if (mode === MODE_SPACE) return t.split(/[ \t\u3000\u00a0]+/);
  if (mode === MODE_LINE) return t.split("\n");
  if (mode === MODE_BLANK) return t.split(/\n[ \t]*\n\s*/);
  const parts = t.split(/\n[ \t]*\n\s*/);
  if (parts.filter((p) => p.trim()).length <= 1) return t.split("\n");
  return parts;
}

function cleanParts(parts, prefix, suffix, dedup, limit) {
  const out = [];
  const seen = new Set();
  for (let p of parts) {
    p = String(p ?? "").trim();
    if (!p) continue;
    if (dedup) {
      if (seen.has(p)) continue;
      seen.add(p);
    }
    out.push(`${prefix}${p}${suffix}`);
  }
  if (!out.length) out.push("");
  return limit > 0 ? out.slice(0, limit) : out;
}

function computeSegments(values) {
  const parts = splitText(values.文本, values.分隔方式, values.自定义分隔符);
  return cleanParts(parts, values.统一前缀, values.统一后缀, values.去重, values.最大条数);
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------
function buildPanel(node, w) {
  const root = el("div", "zzm-root");
  applyThemeVars(root);
  onThemeChange(() => applyThemeVars(root));
  const inner = el("div", "zzm-inner");

  // 顶部条
  const top = el("div", "zzm-top");
  const fold = el("button", "zzm-fold");
  fold.type = "button";
  fold.title = "折叠 / 展开";
  fold.appendChild(el("i"));
  const title = el("div", "", "多段提示词");
  title.style.cssText = "font-size:12px;font-weight:600;color:var(--zzm-text,#edeef0);margin-left:2px;flex:0 0 auto;";
  const badge = el("div", "zzm-badge", "共 0 段");
  badge.style.marginLeft = "auto";
  const gear = el("button", "zzm-gear", "⚙");
  gear.type = "button";
  gear.title = "把当前分段结果打印到浏览器控制台";
  top.append(fold, title, badge, gear);

  // 文本
  const ta = el("textarea", "zzm-field ta mono");
  ta.placeholder = "一行/一段/空行分隔都行，自动识别。中文空格分段也支持。";
  ta.spellcheck = false;
  ta.style.flex = "1 1 0";
  ta.style.minHeight = "120px";

  // 分隔方式
  const modeRow = el("div", "zzm-row");
  const modeLab = label("分隔方式");
  modeLab.style.cssText += "margin:0 4px 0 0;line-height:22px;";
  const modeSeg = seg(MODES, (v) => {
    setW("分隔方式", v);
    sepRow.style.display = v === MODE_CUSTOM ? "flex" : "none";
    refresh();
  });
  modeRow.append(modeLab, modeSeg.root);

  // 自定义分隔符
  const sepRow = el("div", "zzm-row");
  sepRow.style.display = "none";
  const sepLab = label("分隔符");
  sepLab.style.cssText += "margin:0 4px 0 0;line-height:24px;";
  const sepInput = el("input", "zzm-field mono");
  sepInput.placeholder = "例如 ---  或  ###  （支持 \\n）";
  sepInput.addEventListener("input", () => {
    setW("自定义分隔符", sepInput.value);
    refresh();
  });
  sepRow.append(sepLab, sepInput);

  // 前缀 / 后缀
  const affix = el("div", "zzm-row");
  const preCol = el("div", "zzm-col");
  preCol.append(label("统一前缀"));
  const preInput = el("input", "zzm-field");
  preInput.placeholder = "每段前面加（可留空）";
  preInput.addEventListener("input", () => { setW("统一前缀", preInput.value); refresh(); });
  preCol.append(preInput);
  const sufCol = el("div", "zzm-col");
  sufCol.append(label("统一后缀"));
  const sufInput = el("input", "zzm-field");
  sufInput.placeholder = "每段后面加（可留空）";
  sufInput.addEventListener("input", () => { setW("统一后缀", sufInput.value); refresh(); });
  sufCol.append(sufInput);
  affix.append(preCol, sufCol);

  // 去重 / 条数 / 索引
  const optRow = el("div", "zzm-row");
  const dedup = chip("去重");
  dedup.onclick = () => {
    const on = !dedup.classList.contains("on");
    dedup.classList.toggle("on", on);
    setW("去重", on);
    refresh();
  };
  optRow.append(dedup);

  const mkNum = (lab, name, min, max, step) => {
    const box = el("div", "zzm-col");
    const l = label(lab);
    l.style.marginBottom = "0";
    const input = el("input", "zzm-field");
    input.style.textAlign = "center";
    input.style.setProperty("font-family", "Consolas,monospace");
    input.addEventListener("change", () => {
      let v = parseInt(input.value, 10);
      if (Number.isNaN(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      input.value = String(v);
      setW(name, v);
      refresh();
    });
    box.append(l, input);
    box.style.flex = "0 0 74px";
    return { box, input };
  };
  const maxNum = mkNum("最大条数", "最大条数", 0, 9999, 1);
  const idxNum = mkNum("当前索引", "当前索引", 1, 9999, 1);
  optRow.append(maxNum.box, idxNum.box);

  const clearBtn = btn("清空", "sq");
  clearBtn.style.marginLeft = "auto";
  clearBtn.title = "清空文本（只清文本，不动其他设置）";
  clearBtn.onclick = () => {
    ta.value = "";
    setW("文本", "");
    refresh();
  };
  optRow.append(clearBtn);

  // 分段预览
  const previewLab = label("分段预览");
  previewLab.style.marginBottom = "0";
  const prev = el("div", "zzm-prev");

  inner.append(top, ta, modeRow, sepRow, affix, optRow, previewLab, prev);
  root.appendChild(inner);

  // -------------------------------------------------------------------------
  function setW(name, value) {
    const wdg = (node.widgets || []).find((x) => x && x.name === name);
    if (!wdg) return;
    if (wdg.value !== value) {
      wdg.value = value;
      markChanged(node);
    }
  }

  function readW(name, fallback) {
    const wdg = (node.widgets || []).find((x) => x && x.name === name);
    return wdg ? wdg.value : fallback;
  }

  function values() {
    return {
      文本: ta.value,
      分隔方式: currentMode(),
      自定义分隔符: sepInput.value,
      统一前缀: preInput.value,
      统一后缀: sufInput.value,
      去重: dedup.classList.contains("on"),
      最大条数: parseInt(maxNum.input.value, 10) || 0,
    };
  }

  function currentMode() {
    const on = modeSeg.root.querySelector("button.on");
    return on ? on.dataset.v : MODE_AUTO;
  }

  let lastCount = 0;
  function refresh() {
    const segs = computeSegments(values());
    const n = segs.length;
    lastCount = n;
    const idx = Math.max(1, Math.min(parseInt(idxNum.input.value, 10) || 1, n));
    badge.textContent = `共 ${n} 段 · 第 ${idx} 段`;
    idxNum.input.max = String(n);

    const head = [];
    const show = Math.min(n, 30);
    for (let i = 0; i < show; i++) {
      let one = String(segs[i] ?? "").replace(/\s+/g, " ");
      if (one.length > 64) one = one.slice(0, 64) + "…";
      const cls = i + 1 === idx ? ' class="cur"' : "";
      head.push(`<div${cls}><b>${String(i + 1).padStart(2, "0")}</b>. ${escapeHtml(one)}</div>`);
    }
    if (n > show) head.push(`<div>… 另有 ${n - show} 段</div>`);
    prev.innerHTML = head.join("") || "<div>（还没有内容）</div>";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function syncFromWidgets() {
    ta.value = readW("文本", "");
    sepInput.value = readW("自定义分隔符", "---");
    preInput.value = readW("统一前缀", "");
    sufInput.value = readW("统一后缀", "");
    dedup.classList.toggle("on", !!readW("去重", false));
    maxNum.input.value = String(readW("最大条数", 0) ?? 0);
    idxNum.input.value = String(readW("当前索引", 1) ?? 1);
    const mode = readW("分隔方式", MODE_AUTO);
    modeSeg.set(mode);
    sepRow.style.display = mode === MODE_CUSTOM ? "flex" : "none";
    refresh();
  }

  ta.addEventListener("input", () => { setW("文本", ta.value); refresh(); });
  idxNum.input.addEventListener("change", refresh);
  fold.onclick = () => {
    const collapsed = !node.flags?.collapsed;
    node.flags = node.flags || {};
    node.flags.collapsed = collapsed;
    fold.classList.toggle("folded", collapsed);
    node.setDirtyCanvas?.(true, true);
  };
  gear.onclick = () => {
    const segs = computeSegments(values());
    console.group?.("[AI-zzm] 多段提示词：" + segs.length + " 段");
    segs.forEach((s, i) => console.log(String(i + 1).padStart(2, "0"), s));
    console.groupEnd?.();
    badge.textContent = `共 ${segs.length} 段（详见控制台）`;
  };

  root._zzm = { ta, syncFromWidgets, refresh, get count() { return lastCount; } };
  return root;
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------
app.registerExtension({
  name: "AIzzm.PromptList",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ZZM Prompt List") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      const node = this;
      injectTheme();

      const root = buildPanel(node, node.size?.[0] || DEFAULT_W);
      const widget = node.addDOMWidget("zzm_ui", "custom", root, {
        getValue: () => null,
        setValue: () => {},
        getMinHeight: () => 220,
        margin: 4,
        serialize: false,
      });
      keepWidthAuto(widget);

      // 原生 widget 隐藏（值仍由它们持有）
      hideWidgets(node, ["文本", "分隔方式", "自定义分隔符", "当前索引",
        "统一前缀", "统一后缀", "去重", "最大条数"]);

      if (!node.size || node.size[0] < 320) node.setSize([DEFAULT_W, DEFAULT_H]);
      else if (node.size[1] < MIN_H) node.setSize([node.size[0], DEFAULT_H]);

      setTimeout(() => root._zzm?.syncFromWidgets(), 0);

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const rr = onConfigure?.apply(this, arguments);
        // 老工作流里存的高度可能装不下面板，直接撑到默认高度
        if (node.size && node.size[1] < MIN_H) node.setSize([Math.max(node.size[0], DEFAULT_W), DEFAULT_H]);
        setTimeout(() => root._zzm?.syncFromWidgets(), 0);
        return rr;
      };

      const onResize = nodeType.prototype.onResize;
      nodeType.prototype.onResize = function (size) {
        if (size && size[1] < MIN_H) size[1] = MIN_H;
        if (onResize) return onResize.apply(this, arguments);
      };

      return r;
    };
  },
});
