"""
zzm 工具箱 — ComfyUI 自定义节点合集

后端节点（CATEGORY: ⚡ zzm工具箱）：
  ZZM Aspect Ratio         图像高宽比
  ZZM Mask Fill Holes      遮罩填洞
  ZZM Prompt List          多段提示词（逐条）
  ZZM Prompt List Batch    多段提示词·列表模式
  ZZM_NODES_ImageFolder    Image Folder（图像 / 遮罩 / 文件名 / 序号 / 总数）
  ZZM_NODES_LoraLoader     LoRA Loader
  ZZM_NODES_SaveImage      Save Image

纯前端节点（web/js/set_get_nodes.js）：
  Set / Get                取值 / 赋值，跨节点传参不拉线

提示词「逐条」模式的做法：包一层 PromptQueue.task_done，一条跑完存完再自动排下一条。
对 ComfyUI 来说就是 N 个连续的独立任务，显存占用与单张出图相同，不随条数增长。

前端资源统一挂在 web/ 下，由 WEB_DIRECTORY 注册为 /extensions/zzm-toolbox/。
目录名 2026-11-10 从中文的 `zzm工具箱` 改成 ASCII：中文目录名会让 aiohttp 的
web.static 匹配不上（前端 JS 全部 404），节点上方的徽标也会被截成 `zzm工`
（那个徽标显示的就是 RELATIVE_PYTHON_MODULE 里的目录名）。
"""

# Register web extension directory for frontend JS
WEB_DIRECTORY = "./web"

from .nodes_resolution import AspectRatio
from .nodes_mask_fill_holes import MaskFillHoles
from .nodes_prompt_list import PromptList, PromptListBatch, install_queue_hook
from .ausport import NODE_CLASS_MAPPINGS as _AUS_MAP
from .ausport import NODE_DISPLAY_NAME_MAPPINGS as _AUS_NAME

# ---------------------------------------------------------------------------
# Node Registration
# ---------------------------------------------------------------------------
NODE_CLASS_MAPPINGS = {
    "ZZM Aspect Ratio": AspectRatio,
    "ZZM Mask Fill Holes": MaskFillHoles,
    "ZZM Prompt List": PromptList,
    "ZZM Prompt List Batch": PromptListBatch,
    **_AUS_MAP,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZZM Aspect Ratio": "图像分辨率",
    "ZZM Mask Fill Holes": "遮罩填洞",
    "ZZM Prompt List": "多段提示词（逐条）",
    "ZZM Prompt List Batch": "多段提示词·列表模式",
    **_AUS_NAME,
}

# 逐条模式依赖这个钩子：一条跑完自动排下一条
install_queue_hook()

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
