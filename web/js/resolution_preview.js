/**
 * 图像分辨率 —— 把算出来的最终尺寸写进「宽度 / 高度」输出插槽的标签里。
 *
 * 例如选「9:16（竖屏）」+ 3.0 百万像素 + 倍数 8，
 * 输出口就显示成「1328 宽度」「2368 高度」。
 *
 * 只改 node.outputs[i].label 的文字内容，其余全部交给前端原生渲染：
 * 字体、字号、字重、颜色、位置、与插槽圆点的间距，都跟「批量大小」「Latent图像」一模一样。
 * 不做 canvas 自绘、不加 CSS 伪元素、不改插槽颜色。
 *
 * 纯前端计算，参数一动立刻更新，不用先运行一次。
 * 算法必须与 nodes_resolution.py 完全一致，否则显示值会和实际出图尺寸对不上：
 *     scale = sqrt(百万像素 × 1024² / (宽比 × 高比))
 *     宽度  = round(宽比 × scale / 倍数) × 倍数
 * 注意 Python 的 round() 是银行家舍入（四舍六入五取偶），JS 的 Math.round 是四舍五入，
 * 这里用 pyRound() 复刻，否则边界值会差一个倍数。
 *
 * ⚠️ RATIOS / LEGACY 是 nodes_resolution.py 里两份表的副本，后端改了这里要同步。
 */

import { app } from "/scripts/app.js";

const CUSTOM = "自定义";

const RATIOS = {
  "1:1（方形）": [1, 1],
  "2:3（竖版照片）": [2, 3],
  "3:2（横版照片）": [3, 2],
  "3:4（竖版标准）": [3, 4],
  "4:3（标准）": [4, 3],
  "5:7（竖版）": [5, 7],
  "9:16（竖屏）": [9, 16],
  "16:9（宽屏）": [16, 9],
  "21:9（超宽）": [21, 9],
  "1:2（长竖）": [1, 2],
  "2:1（长横）": [2, 1],
};

// 【待删除】与后端 LEGACY_SIZES 对应，仅为兼容老工作流显示
const LEGACY = {
  "512×512（1:1）": [512, 512],
  "1024×1024（1:1）": [1024, 1024],
  "2048×2048（1:1）": [2048, 2048],
  "1080×608（135:76）": [1080, 608],
  "1024×768（4:3）": [1024, 768],
  "1280×720（16:9）": [1280, 720],
  "800×1280（5:8）": [800, 1280],
  "1536×1024（3:2）": [1536, 1024],
  "1920×1080（16:9）": [1920, 1080],
  "1200×1920（5:8）": [1200, 1920],
  "2560×1440（16:9）": [2560, 1440],
  "3840×2160（16:9）": [3840, 2160],
};

/** Python 3 的 round()：四舍六入五取偶 */
function pyRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function widgetValue(node, name) {
  const w = node.widgets?.find((x) => x.name === name);
  return w ? w.value : undefined;
}

/** 与后端 run() 同一套计算，返回 [宽, 高]；算不出时返回 null */
function computeSize(node) {
  const ratio = widgetValue(node, "宽高比");
  if (ratio === undefined) return null;

  if (ratio === CUSTOM) {
    const w = Number(widgetValue(node, "宽度"));
    const h = Number(widgetValue(node, "高度"));
    return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : null;
  }

  const fixed = LEGACY[ratio];
  if (fixed) return fixed;

  const pair = RATIOS[ratio];
  if (!pair) return null;

  const megapixels = Number(widgetValue(node, "百万像素"));
  const multiple = Number(widgetValue(node, "倍数"));
  if (!Number.isFinite(megapixels) || !Number.isFinite(multiple) || multiple <= 0) return null;

  const [wRatio, hRatio] = pair;
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (wRatio * hRatio));
  return [
    pyRound((wRatio * scale) / multiple) * multiple,
    pyRound((hRatio * scale) / multiple) * multiple,
  ];
}

/** 只改插槽标签文字，其余交给原生 */
function refresh(node) {
  const size = computeSize(node);
  if (!size) return;

  const texts = [`${size[0]} 宽度`, `${size[1]} 高度`];
  let changed = false;
  for (let i = 0; i < Math.min(2, node.outputs?.length ?? 0); i += 1) {
    const out = node.outputs[i];
    if (!out || out.label === texts[i]) continue;
    out.label = texts[i];
    changed = true;
  }

  if (changed) app.canvas?.setDirty?.(true, true);
}

const WATCHED = ["宽高比", "宽度", "高度", "百万像素", "倍数"];

app.registerExtension({
  name: "zzm.resolution_preview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ZZM Aspect Ratio") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      const node = this;

      // 首帧还没排好版，等下一帧再写
      requestAnimationFrame(() => refresh(node));

      // 参数一动就更新
      for (const name of WATCHED) {
        const widget = node.widgets?.find((x) => x.name === name);
        if (!widget) continue;
        const original = widget.callback;
        widget.callback = function (...args) {
          const out = original?.apply(this, args);
          refresh(node);
          return out;
        };
      }

      // 打开工作流 / 撤销重做后，值是被批量填进来的，收尾再算一次
      const onConfigure = node.onConfigure;
      node.onConfigure = function (...args) {
        const out = onConfigure?.apply(this, args);
        requestAnimationFrame(() => refresh(node));
        return out;
      };

      return result;
    };
  },
});
