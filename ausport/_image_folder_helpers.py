"""Image Folder helpers: which pictures a folder holds, which of them are
picked, and how one is loaded.

A folder is a whole path on this machine ("D:/pictures/2024"), the one the
folder dialog hands back or a person pastes, so the pictures are read where
they already are: nothing is ever copied and no ComfyUI folder is involved.
Everything here works on plain paths, so the tests run without ComfyUI.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections import OrderedDict
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote

import numpy as np
import torch
from PIL import Image, ImageOps

SORTS = ("名称", "最新优先", "最旧优先")
RUNS = ("一次全部", "每次一张")
AT_THE_END = ("停下来", "从头再来")
# What the editor does with Picture once a run is queued. A run itself loads what Picture says.
AFTER_RUN = ("下一张", "停留", "随机")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
# A folder this full is listed up to here; the gallery says so.
MAX_PICTURES = 5000
# Core Load Image hands out a 64 x 64 mask of zeros for a picture with no
# see-through part. The pack's mask nodes know that stand-in ("no mask").
NO_MASK_SIZE = (64, 64)

NOT_CHOSEN = "批量加载图片：还没有选文件夹。点卡片上的「打开文件夹」选一个。"
NOT_WHOLE = '批量加载图片：请填完整路径，像 D:\\图片\\待处理 这样，"{folder}" 不是。'
NO_FOLDER = '批量加载图片：找不到文件夹 "{folder}"。'
NO_PICTURES = '批量加载图片："{folder}" 里没有图片。'
NO_PICTURE = '批量加载图片：这个文件夹里没有这张图。'
NONE_LEFT = "批量加载图片：选中的图片都不在文件夹里了。在节点上重新勾一次。"
NONE_PICKED = "批量加载图片：一张都没勾。在节点上勾至少一张，或者点「全选」。"
BAD_PICKS = "批量加载图片：选中列表读不出来。在节点上重新勾一次。"
THE_END = "批量加载图片：已经是最后一张（共 {count} 张）。把「当前位置」改回 1 就从头再来。"

# Values a workflow saved by an older release still carries.
_ONE_PER_RUN = ("每次一张", "one per run")
_STARTS_OVER = ("从头再来", "重头再来", "start over")


def one_per_run(run) -> bool:
    """每次一张, and the English value older workflows saved."""
    return str(run) in _ONE_PER_RUN


def starts_over(at_the_end) -> bool:
    """从头再来, and the 重头再来 / start over an older workflow saved."""
    return str(at_the_end) in _STARTS_OVER


def whole_path(folder) -> Path:
    """The folder as a real path on this machine. Raises when it is not a
    whole path, or when there is nothing there."""
    text = str(folder or "").strip().strip('"').strip("'")
    if text.lower().startswith("file:///"):
        text = unquote(text[8:])
    elif text.lower().startswith("file://"):
        text = unquote(text[7:])
    text = os.path.expandvars(os.path.expanduser(text.strip()))
    if not text:
        raise ValueError(NOT_CHOSEN)
    path = Path(text)
    if not path.is_absolute():
        raise ValueError(NOT_WHOLE.format(folder=text))
    try:
        path = path.resolve()
    except OSError:
        raise ValueError(NO_FOLDER.format(folder=text)) from None
    if not path.is_dir():
        raise ValueError(NO_FOLDER.format(folder=text))
    return path


def shown_path(folder) -> str:
    """The folder the way messages and the node name it, with the separators
    the system uses."""
    return str(whole_path(folder))


def natural_key(name: str):
    """photo_2 before photo_10, upper and lower case together."""
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", str(name))]


def list_pictures(folder, subfolders: bool = False, sort: str = "名称",
                  limit: int = MAX_PICTURES) -> list[dict]:
    """Every picture in the folder: {"name": path below the folder, "path",
    "mtime", "size"}, in the chosen order. Hidden files and anything that is
    not a picture are left out."""
    base = whole_path(folder)
    found: list[dict] = []
    try:
        if subfolders:
            walker = os.walk(base, followlinks=False)
        else:
            walker = [(str(base), [], sorted(os.listdir(base)))]
        for directory, folders, files in walker:
            folders[:] = sorted(name for name in folders if not name.startswith("."))
            for name in files:
                if name.startswith(".") or not name.lower().endswith(IMAGE_EXTENSIONS):
                    continue
                path = Path(directory) / name
                try:
                    if not path.is_file():
                        continue
                    stat = path.stat()
                except OSError:
                    continue
                found.append({
                    "name": path.relative_to(base).as_posix(),
                    "path": path,
                    "mtime": float(stat.st_mtime),
                    "size": int(stat.st_size),
                })
                if len(found) >= limit:
                    break
            if len(found) >= limit:
                break
    except OSError:
        raise ValueError(NO_FOLDER.format(folder=base)) from None
    if sort == "最新优先":
        found.sort(key=lambda item: (-item["mtime"], natural_key(item["name"])))
    elif sort == "最旧优先":
        found.sort(key=lambda item: (item["mtime"], natural_key(item["name"])))
    else:
        found.sort(key=lambda item: natural_key(item["name"]))
    return found


def picture_at(folder, name) -> Path:
    """One picture in the folder, as a real path. The name comes from the
    gallery or from a typed one, so it is only read as a path below the
    folder: anything that leaves it is refused."""
    base = whole_path(folder)
    parts = [part for part in str(name or "").replace("\\", "/").split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        raise ValueError(NO_PICTURE)
    path = base.joinpath(*parts)
    try:
        real = path.resolve()
    except OSError:
        raise ValueError(NO_PICTURE) from None
    if base != real and base not in real.parents:
        raise ValueError(NO_PICTURE)
    if not real.is_file() or not real.name.lower().endswith(IMAGE_EXTENSIONS):
        raise ValueError(NO_PICTURE)
    return real


def parse_picked(text) -> list[str] | None:
    """The picked pictures from the widget: None means every picture."""
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError as error:
        raise ValueError(BAD_PICKS) from error
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(BAD_PICKS)
    names = [item.replace("\\", "/") for item in value]
    return list(dict.fromkeys(names))


def choose(pictures: list[dict], picked: list[str] | None) -> list[dict]:
    """The picked pictures in the folder's order. Picked names are only ever
    compared with what the folder holds, never opened as paths."""
    if picked is None:
        return list(pictures)
    if not picked:
        raise ValueError(NONE_PICKED)
    wanted = set(picked)
    chosen = [item for item in pictures if item["name"] in wanted]
    if not chosen:
        raise ValueError(NONE_LEFT)
    return chosen


def which(count: int, position, run: str, at_the_end: str) -> list[int]:
    """Which of `count` picked pictures this run loads, counted from 0."""
    if not one_per_run(run):
        return list(range(count))
    place = max(1, int(position))
    if place > count:
        if starts_over(at_the_end):
            return [(place - 1) % count]
        raise RuntimeError(THE_END.format(count=count))
    return [place - 1]


def output_name(name: str) -> str:
    """The name a result is saved under: the file name without its ending. A
    picture from a folder inside carries that folder in front, so two files
    with one name never land on each other."""
    stem = name.rsplit(".", 1)[0] if "." in name.rsplit("/", 1)[-1] else name
    return stem.replace("/", "_")


def _has_see_through(frame: Image.Image) -> bool:
    return frame.mode in ("RGBA", "LA", "PA") or (frame.mode == "P" and "transparency" in frame.info)


def load_picture(path) -> tuple[torch.Tensor, torch.Tensor]:
    """(1 x H x W x 3 image, mask). The mask is white where the picture is
    see-through, as core Load Image has it, and the 64 x 64 stand-in when the
    picture has no see-through part."""
    with Image.open(path) as source:
        frame = ImageOps.exif_transpose(source)
        if frame.mode == "I":
            frame = frame.point(lambda value: value * (1 / 255))
        see_through = _has_see_through(frame)
        rgba = np.asarray(frame.convert("RGBA"), dtype=np.float32) / 255.0
    image = torch.from_numpy(rgba[..., :3].copy()).unsqueeze(0)
    if see_through:
        mask = (1.0 - torch.from_numpy(rgba[..., 3].copy())).unsqueeze(0)
    else:
        mask = torch.zeros((1, *NO_MASK_SIZE), dtype=torch.float32)
    return image, mask


def fingerprint(pictures: list[dict]) -> str:
    """Changes when a picked file is added, removed or rewritten."""
    digest = hashlib.sha1()
    for item in pictures:
        digest.update(f"{item['name']}|{item['mtime']}|{item['size']}\n".encode("utf-8"))
    return digest.hexdigest()


# --- thumbnails for the gallery -------------------------------------------------
# A tile reads one of these, and so does the preview that opens under the
# pointer after a moment: the same file, decoded once at each size.
_THUMBS: "OrderedDict[tuple, bytes]" = OrderedDict()
_THUMBS_LOCK = threading.Lock()
_THUMBS_BYTES = 24 * 1024 * 1024
_thumbs_size = 0
THUMB_BACK = (27, 35, 38)


def thumbnail(path, edge: int = 160) -> bytes:
    """A small JPEG of the picture. A see-through part shows on the gallery's
    dark tile. Kept in a small cache keyed by the file's state."""
    global _thumbs_size
    edge = max(48, min(1024, int(edge)))
    real = Path(path)
    stat = real.stat()
    key = (str(real), int(stat.st_mtime_ns), int(stat.st_size), edge)
    with _THUMBS_LOCK:
        hit = _THUMBS.get(key)
        if hit is not None:
            _THUMBS.move_to_end(key)
            return hit
    with Image.open(real) as source:
        source.draft("RGB", (edge * 2, edge * 2))        # a JPEG decodes small straight away
        frame = ImageOps.exif_transpose(source)
        if frame.mode == "I":
            frame = frame.point(lambda value: value * (1 / 255))
        if _has_see_through(frame):
            rgba = frame.convert("RGBA")
            rgba.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            small = Image.new("RGB", rgba.size, THUMB_BACK)
            small.paste(rgba, (0, 0), rgba)
        else:
            small = frame.convert("RGB")
            small.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    out = BytesIO()
    small.save(out, format="JPEG", quality=82)
    data = out.getvalue()
    with _THUMBS_LOCK:
        if key not in _THUMBS:
            _THUMBS[key] = data
            _thumbs_size += len(data)
            while _thumbs_size > _THUMBS_BYTES and len(_THUMBS) > 1:
                _, old = _THUMBS.popitem(last=False)
                _thumbs_size -= len(old)
    return data


__all__ = [
    "AFTER_RUN",
    "AT_THE_END",
    "BAD_PICKS",
    "IMAGE_EXTENSIONS",
    "MAX_PICTURES",
    "NONE_LEFT",
    "NONE_PICKED",
    "NO_FOLDER",
    "NO_MASK_SIZE",
    "NO_PICTURES",
    "NO_PICTURE",
    "NOT_CHOSEN",
    "NOT_WHOLE",
    "RUNS",
    "SORTS",
    "THE_END",
    "choose",
    "fingerprint",
    "list_pictures",
    "load_picture",
    "natural_key",
    "one_per_run",
    "output_name",
    "parse_picked",
    "picture_at",
    "shown_path",
    "starts_over",
    "thumbnail",
    "which",
    "whole_path",
]
