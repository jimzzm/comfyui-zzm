// AI-zzm 品牌层：给所有 CATEGORY 以「⚡ AI-zzm」开头的节点统一上色 + 中文标签
//
// 配色逻辑照搬 ComfyUI-Pixaroma 的 js/brand：只改标题栏，主体走 ComfyUI 默认，
// 用户自己改过的颜色优先（右键 Colors 改完会被工作流存下来，下次加载不再被覆盖）。
//
// 唯一多留的一点：老版本把标题刷成过 slate 灰（#2e3135 / #e8e8ec），这里把这两个
// "是我们刷的"值当好认的旧色，顺手换成新色，省得旧工作流看不出改动。

import { app } from "/scripts/app.js";
import { injectTheme } from "./zzm_theme.mjs";

const TITLE_BAR = "#C05C43";
// 标题栏上的字：默认是浅灰，压在砖红底上发飘，直接给白色（LiteGraph 读的是类上的静态属性）
const TITLE_TEXT = "#FFFFFF";
// 旧版刷进去的标题色：遇到就当自己的，换成新色
const OUR_OLD_TITLES = new Set(["#2e3135", "#e8e8ec"]);

// 原生控件/输入口的中文标签（键是内部名，不动值，避免破坏逻辑）
const WIDGET_LABELS = {
  // 图片文件夹
  source: "来源", folder: "子目录", subfolders: "含子文件夹", sort: "排序",
  pictures: "选中图片", run: "运行模式", position: "当前位置",
  after_run: "运行后", at_the_end: "到尾后",
  // 保存图片
  images: "图像", filename_prefix: "文件名前缀", format: "格式",
  save_metadata: "保存元数据", exact_name: "精确文件名", on_existing: "同名处理",
  output_dir: "输出子目录", caption: "说明文字", filename: "文件名",
  caption_text: "说明文字输入", name_counter: "名称计数器", name_date: "名称带日期",
  name_time: "名称带时间", name_size: "名称带尺寸", name_batch: "名称带批次号",
  preview: "预览",
  // LoRA 加载器
  model: "模型", loras: "LoRA 栈", clip: "CLIP",
  trigger_separator: "触发词分隔符", on_missing: "缺文件时",
};

function localize(node) {
  for (const w of node.widgets || []) {
    const zh = w && WIDGET_LABELS[w.name];
    if (zh) w.label = zh;
  }
  for (const inp of node.inputs || []) {
    const zh = inp && WIDGET_LABELS[inp.name];
    if (zh) inp.label = zh;
  }
  applyTooltips(node);
  for (const out of node.outputs || []) {
    if (out && out.name === "triggers") out.label = "触发词";
    if (out && out.name === "file_path") out.label = "文件路径";
  }
}

// 悬停提示的中文：按「节点类 + 控件名」覆盖，避免在 Python 里改长段英文
const TOOLTIPS = {
  ZZM_NODES_ImageFolder: {
    source: "去 ComfyUI 的哪个目录找：输入目录（你放素材的地方）或输出目录（你出图的地方）。",
    folder: "里面的子文件夹。留空 = 就是输入/输出目录本身。「浏览」会列出里面的文件夹。",
    subfolders: "把子文件夹里的图片也算进来。",
    sort: "图片顺序：按名称，或按文件修改时间。",
    pictures: "勾选的图片。在节点上点选；留空 = 文件夹里的全部。",
    run: "一次全部：点一次运行，勾选的每张各跑一遍。每次一张：每次运行只加载一张，跑完自动往后走，某张失败只跳过它自己。",
    position: "每次一张模式下，下一次运行加载第几张（从 1 数）。",
    after_run: "每次一张模式下：下一张 = 每排一次队就往后走一张；停留 = 一直加载同一张；随机 = 随机跳。",
    at_the_end: "每次一张模式下跑过最后一张怎么办：停下来提示，或回到第 1 张继续。",
  },
  ZZM_NODES_SaveImage: {
    images: "BHWC 图像批次，里面的每一帧都会存下来。",
    filename_prefix: "本地文件名，可以带子目录；日期/时间/尺寸/计数/批次这些标签会追加在后面。接上「文件名」输入时忽略。",
    format: "png 到处都能看、保留透明；webp 无损通常更小、保留透明；jpg 兼容性最广、体积最小，质量 95，没有透明通道（透明区压黑底）。",
    save_metadata: "开：把提示词和工作流嵌进文件，拖回 ComfyUI 能还原 —— 但只有 png 和 webp 能还原，jpg 里虽然也写了 EXIF，前端没有 jpeg 读取器，拖回去只会当图片载入。关：写干净文件，适合发人/做数据集。",
    exact_name: "用这个名字原样保存，不加标签。带图片扩展名会被换成所选格式；允许子目录；整批会加 _001、_002。",
    on_existing: "撞到同名文件怎么办：覆盖 / 跳过 / 报错停下。只有关掉计数器、用精确文件名或接上文件名时才用得上。",
    output_dir: "保存到 output 目录下的哪个子目录，例如 sets/portraits，不存在会自动建。留空就是 output 根目录。只往 output 里写。",
    caption: "不为空时，给每张图写一个同名 UTF-8 .txt。接上「说明文字输入」时以输入为准。",
    filename: "来自上游的精确文件名（加载图像的文件名、打标工具的 id）。扩展名会被换成所选格式，不加标签，整批加 _001。",
    caption_text: "来自上游的说明文字：存成同目录同名的 .txt（portrait.png → portrait.txt）。空则不写。",
    name_counter: "追加下一个空闲的 5 位编号。开着永不覆盖；关掉就复用同一路径、覆盖旧文件。",
    name_date: "文件名加保存日期 YYYY-MM-DD。",
    name_time: "文件名加保存时间 HH-mm-ss。",
    name_size: "文件名加图片尺寸，例如 1024x1024。",
    name_batch: "整批保存时加 b001、b002……，看出一张是这批里的第几张。单张不变。",
    preview: "在节点上显示存下来的图。只是显示：文件照存，队列里也照列。",
  },
  ZZM_NODES_LoraLoader: {
    model: "被这栈 LoRA 打补丁的扩散模型。",
    loras: "由节点上的行编辑器维护的 LoRA 栈。要改就改行，别手改这个值。",
    clip: "可选，要给 CLIP 打补丁时接上；不接则所有 CLIP 强度都不生效。",
    trigger_separator: "把启用行的触发词拼成「触发词」输出时用。在节点的齿轮菜单里设置。",
    on_missing: "启用的行找不到文件时怎么办。报错（默认）会在采样前拦住并指出文件名；跳过则控制台提示一下继续跑。",
  },
};

function applyTooltips(node) {
  const table = TOOLTIPS[node.comfyClass || node.type];
  if (!table) return;
  for (const w of node.widgets || []) {
    const tip = table[w?.name];
    if (tip && w.options) w.options.tooltip = tip;
  }
  for (const inp of node.inputs || []) {
    const tip = table[inp?.name];
    if (tip) inp.tooltip = tip;
  }
}

function brand(node, fresh) {
  // fresh = 刚从菜单拖出来的新节点：ComfyUI 可能已经按类型塞了个颜色，直接盖掉
  // 不是 fresh = 加载工作流：只有"空"或"上一版我们自己刷的灰"才换，
  // 他右键改过的颜色一律不动
  const color = node.color ? String(node.color).toLowerCase() : "";
  if (fresh || !color || OUR_OLD_TITLES.has(color)) node.color = TITLE_BAR;
  try {
    if (node.constructor) node.constructor.title_text_color = TITLE_TEXT;
  } catch (_) {}
}

injectTheme();

app.registerExtension({
  name: "AIzzm.BrandDefaults",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const cat = nodeData?.category;
    if (typeof cat !== "string" || (cat !== "⚡ zzm工具箱" && !cat.startsWith("⚡ zzm工具箱/"))) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      brand(this, true);
      localize(this);
      requestAnimationFrame(() => localize(this));
      return r;
    };

    // 加载旧工作流时只把「上一版我们自己刷的灰标题」换成新色，
    // 他右键改过的颜色不动 —— 这正是"切一下网页颜色就回去"的病根
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      brand(this);
      localize(this);
      return r;
    };
  },
});
