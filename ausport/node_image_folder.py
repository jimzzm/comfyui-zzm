"""Batch Load Pictures 🆎 — open a folder on this computer, pick its pictures,
and run the workflow on each one."""

from __future__ import annotations

import asyncio
from pathlib import Path
from urllib.parse import unquote

from ._execution_helpers import ignore_extra_inputs
from ._image_folder_helpers import (
    AFTER_RUN,
    AT_THE_END,
    IMAGE_EXTENSIONS,
    MAX_PICTURES,
    NO_PICTURES,
    NOT_CHOSEN,
    RUNS,
    SORTS,
    choose,
    fingerprint,
    list_pictures,
    load_picture,
    output_name,
    parse_picked,
    picture_at,
    shown_path,
    thumbnail,
    which,
)

# What the frontend reads to show "7 of 42" on the node after a run.
UI_KEY = "zzmaus_image_folder"

try:                                  # offline tests run without ComfyUI
    import folder_paths
except ImportError:                   # pragma: no cover
    folder_paths = None


def _own_folder(getter: str) -> str:
    """ComfyUI's own folder, as a whole path. Pictures added by hand or dropped
    on the node land in input, so the node can go and read them there."""
    if folder_paths is None:
        return ""
    try:
        return str(Path(getattr(folder_paths, getter)()).resolve())
    except Exception:                 # a core that renamed the getter
        return ""


def place_of(text: str) -> tuple[str, str]:
    """A whole path as (the folder it sits in, its name). A folder answers
    with itself and no name; a picture with its folder and its file name."""
    raw = str(text or "").strip().strip('"').strip("'")
    if not raw:
        raise ValueError(NOT_CHOSEN)
    if raw.lower().startswith("file:///"):
        raw = unquote(raw[8:])
    elif raw.lower().startswith("file://"):
        raw = unquote(raw[7:])
    try:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            raise ValueError(raw)
        path = path.resolve()
    except (OSError, ValueError):
        raise ValueError(f"这不是一个完整路径：{text}") from None
    if path.is_dir():
        return str(path), ""
    if path.is_file() and path.name.lower().endswith(IMAGE_EXTENSIONS):
        return str(path.parent), path.name
    raise ValueError(f"这不是图片或文件夹：{text}")


def _picked(folder, subfolders, sort, pictures) -> list[dict]:
    listed = list_pictures(folder, bool(subfolders), str(sort))
    if not listed:
        raise ValueError(NO_PICTURES.format(folder=shown_path(folder)))
    return choose(listed, parse_picked(pictures))


def _register_routes() -> None:
    """The gallery's questions: which pictures a folder holds, a small copy of
    one, where ComfyUI keeps its own folders, and where a whole path leads.

    The folder is the person's own machine, so the routes read it: a picture
    name is only ever resolved below the folder it came with."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    server = getattr(PromptServer, "instance", None)
    if server is None:
        return
    if getattr(server, "_zzmaus_image_folder_routes", False):
        return
    server._zzmaus_image_folder_routes = True
    routes = server.routes

    def query(request, name: str) -> str:
        return str(request.rel_url.query.get(name, "")).strip()

    def refused(error: Exception):
        return web.json_response({"error": str(error)}, status=400)

    async def off_loop(work, *args):
        return await asyncio.get_running_loop().run_in_executor(None, work, *args)

    @routes.get("/zzmaus/image_folder/where")
    async def where(request):
        """ComfyUI's own folders. The panel copies what a picker or a drop hands
        over into input/zzm_drop: a browser can only pass the file itself, never
        the path it came from. A folder typed into the box is read in place."""
        return web.json_response({
            "temp": _own_folder("get_temp_directory"),
            "input": _own_folder("get_input_directory"),
            "output": _own_folder("get_output_directory"),
        })

    @routes.get("/zzmaus/image_folder/list")
    async def pictures(request):
        folder = query(request, "folder")
        try:
            shown = shown_path(folder)
            listed = await off_loop(
                list_pictures, shown, query(request, "subfolders") == "1", query(request, "sort") or "名称"
            )
        except (ValueError, RuntimeError) as error:
            return refused(error)
        return web.json_response({
            "folder": shown,
            "full": len(listed) >= MAX_PICTURES,
            "pictures": [{"name": item["name"], "v": int(item["mtime"])} for item in listed],
        })

    @routes.get("/zzmaus/image_folder/thumb")
    async def thumb(request):
        folder = query(request, "folder")
        try:
            path = picture_at(folder, query(request, "name"))
            try:
                edge = int(query(request, "size") or 160)
            except ValueError:
                edge = 160
            data = await off_loop(thumbnail, path, edge)
        except (ValueError, RuntimeError) as error:
            return refused(error)
        except Exception:
            return web.json_response({"error": "这张图打不开"}, status=415)
        return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    @routes.get("/zzmaus/image_folder/resolve")
    async def resolve(request):
        """A whole path, from a drop or a paste: the folder it sits in, and
        the picture's name when it is a picture."""
        try:
            folder, name = place_of(query(request, "path"))
        except ValueError as error:
            return refused(error)
        return web.json_response({"folder": folder, "name": name})


_register_routes()


class ZZMImageFolder:
    CATEGORY = "⚡ zzm工具箱"
    DESCRIPTION = (
        "打开这台电脑上的任意文件夹，勾上要的图片，让工作流一张张跑完。\n"
        "· 卡片第一行填文件夹的完整路径：就地读取，一张也不复制\n"
        "· 手选的图片、拖进节点的图片，复制到 comfyui 输入目录的 input/zzm_drop 再读；\n"
        "  整个文件夹按文件夹名复制到 input/文件夹名（跟原来的做法一样）\n"
        "· 每次一张：每次运行只加载一张，跑完自动往后走，某张失败只跳过它自己\n"
        "· 一次全部：点一次运行，勾选的每张图各跑一遍\n"
        "· 同时给出每张的遮罩、文件名（接「保存图片」可沿用原名）、序号和总数\n"
        "鼠标在缩略图上停一秒会放大预览。"
    )
    SEARCH_ALIASES = [
        "batch load pictures", "load folder", "load from folder", "load images", "batch load",
        "directory", "image list", "gallery", "dataset", "load image batch", "zzmaus", "zzm",
        "批量加载图片", "批量", "文件夹",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "图片所在文件夹在这台电脑上的完整路径。直接粘进来，就地读取、不复制。",
                    },
                ),
                "subfolders": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "也把这个文件夹里面那些文件夹的图片算进来。"},
                ),
                "sort": (
                    list(SORTS),
                    {"default": SORTS[0], "tooltip": "图片顺序：按名称，或按文件修改时间。"},
                ),
                "pictures": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "勾中的图片。在节点上点选。留空 = 文件夹里的全部。",
                    },
                ),
                "run": (
                    list(RUNS),
                    {
                        "default": "每次一张",
                        "tooltip": (
                            "每次一张：每次运行只加载一张，跑完自动往后走，某张失败只跳过它自己。"
                            "一次全部：点一次运行，勾选的每张图各跑一遍。"
                        ),
                    },
                ),
                "position": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 1000000,
                        "step": 1,
                        "tooltip": "每次一张模式下，下一次运行加载第几张，从 1 数。",
                    },
                ),
                "after_run": (
                    list(AFTER_RUN),
                    {
                        "default": AFTER_RUN[0],
                        "tooltip": (
                            "每次一张模式下，排完一次队「当前位置」怎么走：下一张 = 往后走一张，"
                            "连着排几次就顺着文件夹走完；停留 = 一直加载同一张；随机 = 随便跳一张。"
                        ),
                    },
                ),
                "at_the_end": (
                    list(AT_THE_END),
                    {
                        "default": AT_THE_END[0],
                        "tooltip": "每次一张模式下跑过最后一张怎么办：停下来给个提示，或回到第 1 张继续。",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("图像", "遮罩", "文件名", "序号", "总数")
    OUTPUT_IS_LIST = (True, True, True, True, False)
    OUTPUT_TOOLTIPS = (
        "勾中的每一张，一张一张给出。接在后面的节点会为每张跑一遍。",
        "透明的地方为白。没有透明通道的图给出的空遮罩和 ComfyUI 的「加载图像」一致。",
        "图片文件名去掉扩展名。接到「保存图片」的文件名上，出图就沿用原名。",
        "这张在勾中的图片里排第几，从 1 数。",
        "一共勾了、选了几张。",
    )
    FUNCTION = "load"

    @classmethod
    def IS_CHANGED(cls, folder, subfolders, sort, pictures, run, position, after_run, at_the_end):
        try:
            chosen = _picked(folder, subfolders, sort, pictures)
        except Exception as error:  # noqa: BLE001 - a changed error is a change too
            return f"error: {error}"
        return f"{fingerprint(chosen)}|{run}|{position if run == '每次一张' else ''}|{at_the_end}"

    @classmethod
    @ignore_extra_inputs
    def VALIDATE_INPUTS(cls, folder):
        if folder is None:                        # wired in: only known when the run gets there
            return True
        try:
            shown = shown_path(folder)
            if not list_pictures(shown, True, "名称", limit=1):
                return NO_PICTURES.format(folder=shown)
        except (ValueError, RuntimeError) as error:
            return str(error)
        return True

    def load(self, folder, subfolders, sort, pictures, run, position, after_run, at_the_end):
        # after_run is the editor's: it moves Picture on after a run is queued. A run loads what Picture says.
        shown = shown_path(folder)
        chosen = _picked(shown, subfolders, sort, pictures)
        count = len(chosen)
        images, masks, names, numbers = [], [], [], []
        for place in which(count, position, str(run), str(at_the_end)):
            item = chosen[place]
            image, mask = load_picture(item["path"])
            images.append(image)
            masks.append(mask)
            names.append(output_name(item["name"]))
            numbers.append(place + 1)
        note = [{"count": count, "loaded": numbers[:64], "names": [chosen[n - 1]["name"] for n in numbers[:64]]}]
        return {"ui": {UI_KEY: note}, "result": (images, masks, names, numbers, count)}


NODE_CLASS_MAPPINGS = {"ZZM_NODES_ImageFolder": ZZMImageFolder}
NODE_DISPLAY_NAME_MAPPINGS = {"ZZM_NODES_ImageFolder": "批量加载图片 🆎"}
