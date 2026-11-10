"""Save Image 🆎."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ._execution_helpers import ignore_extra_inputs
from ._image_save_helpers import (
    EXISTING_POLICIES,
    FORMAT_EXTENSIONS,
    IMAGE_FORMATS,
    encode_image,
    existing_action,
    fill_name_tokens,
    metadata_disabled,
    name_stem,
    next_free_counter,
    plan_exact_names,
    plan_local_names,
    resolve_output_root,
    require_output_path,
    sanitize_exact_name,
    sidecar_path,
    split_prefix,
    strip_image_extension,
)
from ._video_save_helpers import workflow_metadata

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None


def _register_folder_route() -> None:
    """GET /zzmaus/save_image/folders?path=<relative> lists the subfolders
    under ComfyUI's output folder, for the node's Browse button. Paths are
    attacker-controlled: anything that resolves outside the output folder
    answers 400, and nothing outside it is ever listed."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    server = getattr(PromptServer, "instance", None)
    if server is None:
        return
    if getattr(server, "_zzmaus_save_image_folders", False):
        return
    server._zzmaus_save_image_folders = True

    @server.routes.get("/zzmaus/save_image/folders")
    async def list_folders(request):
        root = Path(folder_paths.get_output_directory()).resolve()
        relative = str(request.rel_url.query.get("path", "")).strip().replace("\\", "/")
        try:
            target = resolve_output_root(relative, root)
        except Exception:
            return web.json_response({"error": "bad path"}, status=400)
        if target != root and root not in target.parents:
            return web.json_response({"error": "outside the output folder"}, status=400)
        if not target.is_dir():
            return web.json_response({"error": "not a folder"}, status=404)
        folders = sorted(
            entry.name for entry in target.iterdir()
            if not entry.name.startswith(".") and not entry.is_symlink() and entry.is_dir()
        )
        shown = "" if target == root else target.relative_to(root).as_posix()
        return web.json_response({"path": shown, "folders": folders})


class ZZMSaveImage:
    CATEGORY = "⚡ zzm工具箱"
    DESCRIPTION = (
        "把 IMAGE 批次存成 PNG、无损 WebP 或 JPG，可以嵌入工作流，也可以刻意不嵌。\n· 文件名可以在这里拼：前缀 + 日期/时间/尺寸/计数/批次号\n· 也可以由「文件名」输入给出精确名字（改图、放大后沿用原名）\n· 说明文字不为空时，写一个同名 .txt，做数据集打标那种配对\n只往 ComfyUI 的 output 目录里写，绝对路径会被拒绝。"
    )
    SEARCH_ALIASES = [
        "save image",
        "png",
        "webp",
        "jpg",
        "jpeg",
        "exact filename",
        "caption",
        "dataset",
        "zzmaus",
        "zzm",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "BHWC 图像批次，批次里的每一帧都会存一份。"},
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "image",
                        "tooltip": (
                            "本地文件名，可以带子目录；下面的名称标签（日期、时间、"
                            "尺寸、计数、批次号）会追加在它后面。接上「文件名」输入或"
                            "填了「精确文件名」时，这一项忽略。"
                        ),
                    },
                ),
                "format": (
                    list(IMAGE_FORMATS),
                    {
                        "default": "png",
                        "tooltip": (
                            "png 到处都能看、保留透明，还能把工作流嵌进文件；"
                            "webp 无损通常比 png 小、也保留透明；"
                            "jpg 兼容性最广、体积最小，质量 95，没有透明通道"
                            "（透明区按预乘压到黑底）。"
                        ),
                    },
                ),
                "save_metadata": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "开：把提示词和工作流嵌进文件（png 写文本块，webp / jpg 写 "
                            "EXIF），拖回 ComfyUI 能还原工作流 —— 但只有 png 和 webp 能还原，"
                            "前端没有 jpeg 读取器，jpg 拖回去只会当图片载入。"
                            "关：写干净文件，里面什么都不带，适合发人或做数据集。"
                        ),
                    },
                ),
            },
            "optional": {
                "exact_name": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "用这个名字原样保存，不加任何标签。值里带的图片扩展名会被换成"
                            "所选格式的；允许子目录；整批保存会加 _001、_002…… "
                            "留空则按「文件名前缀」拼。接上「文件名」输入时以输入为准。"
                        ),
                    },
                ),
                "on_existing": (
                    list(EXISTING_POLICIES),
                    {
                        "default": "覆盖",
                        "tooltip": (
                            "撞到同名文件时怎么办：覆盖就替换它，跳过就留着旧文件，"
                            "报错则让这次运行停下来。只有关掉计数器、用精确文件名或"
                            "接上文件名时才碰得到这种情况 —— 计数器永远不会撞名。"
                        ),
                    },
                ),
                "output_dir": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "存到 output 目录下的哪个子目录，例如 sets/portraits，"
                            "不存在会自动建。留空就是 output 根目录。"
                            "这个节点只往 output 里写，绝不写到外面去。"
                        ),
                    },
                ),
                "caption": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": (
                            "不为空时，把这段文字写成 UTF-8 的 .txt，和每张图同目录同名"
                            "（portrait.png → portrait.txt）。接上「说明文字输入」时以输入为准。"
                        ),
                    },
                ),
                "filename": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "来自上游的精确文件名（加载图像的文件名、打标工具给的 id）。"
                            "它的图片扩展名会被换成所选格式的；不加标签；整批加 _001、_002…… "
                            "接了但值是空的，会直接停下，而不是编一个名字存出去。"
                        ),
                    },
                ),
                "caption_text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "来自上游的说明文字：存成同目录同名的 .txt"
                            "（portrait.png → portrait.txt）。空则不写。"
                        ),
                    },
                ),
                "name_counter": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "追加下一个空闲的五位编号。开着永远不会覆盖已有文件；"
                            "关掉就复用同一路径、直接覆盖旧文件。"
                        ),
                    },
                ),
                "name_date": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "文件名加保存日期 YYYY-MM-DD。"},
                ),
                "name_time": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "文件名加保存时间 HH-mm-ss。"},
                ),
                "name_size": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "文件名加图片尺寸，例如 1024x1024。",
                    },
                ),
                "name_batch": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "整批保存时加 b001、b002……，看出一张图是这一批里的第几张。"
                            "只存一张时不变。"
                        ),
                    },
                ),
                "preview": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "在节点上显示存下来的图。只是显示：文件照存，队列里也照列。"
                        ),
                    },
                ),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("文件路径", "图像")
    OUTPUT_TOOLTIPS = (
        "这次运行存下的第一个文件的绝对路径（全被跳过时为空），给下游想直接拿文件的节点用。",
        "原样传出去的输入批次 —— 先保存，接线不用断。",
    )
    OUTPUT_NODE = True
    FUNCTION = "save"

    def save(
        self,
        images,
        filename_prefix,
        format,
        save_metadata,
        exact_name="",
        on_existing="覆盖",
        output_dir="",
        caption="",
        filename=None,
        caption_text=None,
        name_counter=True,
        name_date=False,
        name_time=False,
        name_size=False,
        name_batch=False,
        preview=True,
        prompt=None,
        extra_pnginfo=None,
    ):
        if folder_paths is None:
            raise RuntimeError("Save Image requires ComfyUI's folder_paths at runtime.")
        extension = FORMAT_EXTENSIONS[format]
        # --disable-metadata is the server owner's call and beats the widget.
        embed = save_metadata and not metadata_disabled()
        metadata = workflow_metadata(prompt, extra_pnginfo) if embed else None
        # A linked caption wins over the legacy text box; blank means no sidecar.
        linked_caption = str(caption_text or "") if caption_text is not None else ""
        caption_value = linked_caption if linked_caption.strip() else str(caption or "")
        output_root = Path(folder_paths.get_output_directory())
        root = resolve_output_root(output_dir, output_root)
        count = int(images.shape[0])
        height, width = int(images.shape[1]), int(images.shape[2])
        # Name tokens typed on the node (%width%, %year%...). A linked
        # filename is another node's exact name and is left as it is.
        now = datetime.now()
        filename_prefix = fill_name_tokens(filename_prefix, now, width, height)
        exact_name = fill_name_tokens(exact_name, now, width, height)

        # Exact naming: the linked filename first, then the legacy widget.
        if filename is not None:
            text = str(filename).strip()
            if not text:
                raise ValueError(
                    "Save Image: the linked filename is empty. Feed it a name "
                    "or unlink it to compose the name here."
                )
            exact = sanitize_exact_name(text)
        else:
            exact = sanitize_exact_name(exact_name)

        planned: list[tuple[Path, str]] = []  # (path, collision policy)
        if exact:
            base = strip_image_extension(exact)
            for name in plan_exact_names(base, extension, count):
                planned.append((root / name, on_existing))
        else:
            subfolder, base = split_prefix(filename_prefix)
            folder = root / subfolder if subfolder else root
            require_output_path(folder, output_root)
            stem = name_stem(
                base,
                {"date": bool(name_date), "time": bool(name_time), "size": bool(name_size)},
                now,
                width,
                height,
            )
            counter = bool(name_counter)
            existing = [entry.name for entry in folder.iterdir()] if folder.is_dir() else []
            names = plan_local_names(
                stem, extension, count, counter=counter, batch=bool(name_batch),
                next_counter=next_free_counter(existing, stem),
            )
            # The counter is collision-safe by construction; without it the
            # legacy policy decides, and its default deliberately overwrites.
            policy = "覆盖" if counter else on_existing
            planned.extend((folder / name, policy) for name in names)

        # Validate the whole batch before any write, including caption targets,
        # then settle every collision: an "error" on a later frame must stop
        # the run before the first frame lands, not after.
        for path, _policy in planned:
            require_output_path(path, output_root)
            if caption_value.strip():
                require_output_path(sidecar_path(path), output_root)
        actions = [existing_action(path.exists(), policy) for path, policy in planned]

        saved: list[Path] = []
        for (path, _policy), action, frame in zip(planned, actions, images):
            if action == "skip":
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            encode_image(path, frame, format, metadata)
            if caption_value.strip():
                sidecar_path(path).write_text(caption_value, encoding="utf-8")
            saved.append(path)

        # Every destination was confined to the output folder above, so each
        # saved file previews from there and is shown relative to it. The
        # preview switch is display only: these entries are also how the
        # queue lists the save, and there is no temp file to skip.
        previews: list[dict] = []
        resolved_root = output_root.resolve()
        shown_paths: list[str] = []
        for path in saved:
            resolved = path.resolve()
            relative = resolved.parent.relative_to(resolved_root)
            previews.append({
                "filename": resolved.name,
                "subfolder": "" if relative == Path(".") else str(relative),
                "type": "output",
            })
            shown_paths.append(resolved.relative_to(resolved_root).as_posix())
        return {
            "ui": {"images": previews, "zzmaus_saved_path": shown_paths[:1]},
            "result": (str(saved[0]) if saved else "", images),
        }

    @classmethod
    def IS_CHANGED(cls, **_values):
        # A saver's job is the side effect: deleting the file and queueing
        # again must save again, so this node never reports "unchanged".
        return float("nan")

    @classmethod
    @ignore_extra_inputs
    def VALIDATE_INPUTS(cls, exact_name="", filename_prefix="", output_dir=""):
        # Surface a bad name before the run instead of mid-save. Only the
        # three inputs read here are named, so ComfyUI still checks the
        # others (format, on_existing, ...) itself.
        for label, value in (("exact_name", exact_name), ("filename_prefix", filename_prefix)):
            if isinstance(value, str) and value.strip():
                try:
                    sanitize_exact_name(value)
                except ValueError as exc:
                    return str(exc).replace("exact_name", label)
        # A folder outside the output folder is refused before the run.
        if isinstance(output_dir, str) and output_dir.strip() and folder_paths is not None:
            try:
                resolve_output_root(output_dir, folder_paths.get_output_directory())
            except ValueError as exc:
                return str(exc)
        return True


_register_folder_route()

NODE_CLASS_MAPPINGS = {"ZZM_NODES_SaveImage": ZZMSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"ZZM_NODES_SaveImage": "Save Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
