"""
zzm 工具箱 — ComfyUI 自定义节点合集

后端节点（CATEGORY: ⚡ zzm工具箱）：
  ZZM Aspect Ratio         图像高宽比
  ZZM Mask Fill Holes      遮罩填洞
  ZZM Prompt List          多段提示词（逐条）
  ZZM Prompt List Batch    多段提示词·列表模式
  ZZM_NODES_ImageFolder    批量加载图片（图像 / 遮罩 / 文件名 / 序号 / 总数）
  ZZM_NODES_LoraLoader     LoRA Loader
  ZZM_NODES_SaveImage      Save Image
  ZZM Audio Duration       音频时长（AUDIO → 秒 / 毫秒）

纯前端节点（web/js/set_get_nodes.js）：
  Set / Get                取值 / 赋值，跨节点传参不拉线

提示词「逐条」模式的做法：包一层 PromptQueue.task_done，一条跑完存完再自动排下一条。
对 ComfyUI 来说就是 N 个连续的独立任务，显存占用与单张出图相同，不随条数增长。

前端资源统一挂在 web/ 下，由 WEB_DIRECTORY 注册为 /extensions/comfyui-zzm/。
目录名必须保持 ASCII（本目录 2026-11-11 定为 `comfyui-zzm`，与 GitHub 仓库同名）：
中文目录名会让 aiohttp 的 web.static 匹配不上（前端 JS 全部 404），节点上方的徽标
也会被截断（那个徽标显示的就是 RELATIVE_PYTHON_MODULE 里的目录名）。
"""

import pathlib

# Register web extension directory for frontend JS
WEB_DIRECTORY = "./web"


def _no_store_assets() -> None:
    """Tell the browser never to reuse this pack's frontend files from cache.

    They change together with the pack, and aiohttp serves them with nothing but
    an ETag: Chrome is then free to treat them as fresh for a while and hand back
    last version's file. A stale shared/image_folder.mjs next to a new index.js is
    a SyntaxError {"does not provide an export named ..."}, and one failed import
    takes the whole extension down - no card, no gallery, no drop handling.
    """
    try:
        from server import PromptServer
    except Exception:                    # offline tests, or a core too old
        return
    server = getattr(PromptServer, "instance", None)
    if server is None or getattr(server, "_zzmaus_no_store", False):
        return
    server._zzmaus_no_store = True

    async def no_store(request, response):
        # `/extensions` is the list of files the page imports. It carries no
        # cache header of its own, so a browser keeps the old list and asks for
        # files that have been renamed or removed — a 404 the page never shows.
        path = str(request.path)
        if path == "/extensions" or path.startswith("/extensions/comfyui-zzm/"):
            response.headers["Cache-Control"] = "no-store"
            # A line per request, so a page that loads the wrong file can be
            # traced from the server side. Small, and only this pack's paths.
            try:
                import datetime
                import tempfile
                log = pathlib.Path(tempfile.gettempdir()) / "zzmaus_access.log"
                if log.exists() and log.stat().st_size > 1_000_000:
                    log.unlink()                 # start over rather than grow forever
                with open(log, "a", encoding="utf-8") as handle:
                    handle.write(f"{datetime.datetime.now():%H:%M:%S} "
                                 f"{response.status} {path}\n")
            except Exception:
                pass

    server.app.on_response_prepare.append(no_store)


_no_store_assets()

from .nodes_resolution import AspectRatio
from .nodes_mask_fill_holes import MaskFillHoles
from .nodes_prompt_list import PromptList, PromptListBatch, install_queue_hook
from .nodes_audio_duration import AudioDuration
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
    "ZZM Audio Duration": AudioDuration,
    **_AUS_MAP,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZZM Aspect Ratio": "图像分辨率",
    "ZZM Mask Fill Holes": "遮罩填洞",
    "ZZM Prompt List": "多段提示词（逐条）",
    "ZZM Prompt List Batch": "多段提示词·列表模式",
    "ZZM Audio Duration": "音频时长",
    **_AUS_NAME,
}

# 逐条模式依赖这个钩子：一条跑完自动排下一条
install_queue_hook()

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
