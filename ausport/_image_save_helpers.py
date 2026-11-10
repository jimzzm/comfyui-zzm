"""Naming, policy, and encoding for the ZZM Save Image node. Save Video
shares its name check, output-folder check and --disable-metadata switch.

The naming and collision logic is pure so tests can drive it without a
filesystem; the three encoders (PNG, lossless WebP, JPEG) sit at the
bottom and are the only functions that touch PIL.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath

import numpy as np
import torch
from PIL import Image

# Extensions recognized (and stripped) on an exact filename, so pairing a
# save with "photo123.jpg" under png format yields photo123.png, not
# photo123.jpg.png. Anything else after a dot is part of the name.
IMAGE_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".jxl",
    ".png", ".tif", ".tiff", ".webp",
}

IMAGE_FORMATS = ("png", "webp 无损", "jpg")
EXISTING_POLICIES = ("覆盖", "跳过", "报错")

FORMAT_EXTENSIONS = {"png": "png", "webp 无损": "webp", "jpg": "jpg"}

COUNTER_WIDTH = 5
BATCH_WIDTH = 3


def metadata_disabled() -> bool:
    """True when ComfyUI was launched with --disable-metadata.

    That flag is the server owner's decision that no save embeds workflows,
    so it overrides the node's own toggle. Fail-soft outside ComfyUI.
    """
    try:
        from comfy.cli_args import args

        return bool(getattr(args, "disable_metadata", False))
    except Exception:
        return False


def strip_image_extension(name: str) -> str:
    """Drop one trailing image extension; other suffixes stay part of the name."""
    text = str(name or "").strip()
    suffix = PurePosixPath(text).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return text[: -len(suffix)]
    return text


def sanitize_exact_name(name: str, source: str = "Save Image: exact_name") -> str:
    """Normalize an exact name into a safe relative subpath.

    Widget values are attacker-controlled: parent traversal, drive letters,
    and rooted paths are rejected rather than silently rewritten, so the
    save always lands inside the chosen output root. Forward and backward
    slashes both separate subfolders. ``source`` names the node and input
    in the error, as "Node: input", so Save Video's prefix is reported
    against Save Video.
    """
    text = str(name or "").strip().replace("\\", "/")
    if not text:
        return ""
    if ":" in text or PureWindowsPath(text).drive or text.startswith("/"):
        raise ValueError(f"{source} must be a relative name, not a rooted path.")
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ValueError(f"{source} may not contain '..'.")
    if not parts:
        return ""
    return "/".join(parts)


OUTPUT_DIR_RULE = (
    "Save Image saves only inside ComfyUI's output folder: output_dir takes a "
    "subfolder name such as sets/portraits, or stays empty for the output folder itself."
)


def resolve_output_root(output_dir: str, default_root: str | Path) -> Path:
    """'' -> the output folder; otherwise a subfolder inside it.

    output_dir is a widget, and widget values arrive through ComfyUI's
    unauthenticated /prompt route, so Save Image writes only inside the
    output folder, like ComfyUI's own Save Image. Rooted paths, drive
    letters, network paths, '~' and '..' are refused from the text alone,
    before anything touches the disk; a subfolder that a link would carry
    outside the output folder is refused as well.
    """
    text = str(output_dir or "").strip()
    default = Path(default_root)
    if not text:
        return default
    written = text.replace("\\", "/")
    parts = [part for part in written.split("/") if part not in ("", ".")]
    if written.startswith(("/", "~")) or ":" in written or PureWindowsPath(text).drive or ".." in parts:
        raise ValueError(OUTPUT_DIR_RULE)
    if not parts:
        return default
    root = default.resolve()
    resolved = (root / "/".join(parts)).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(OUTPUT_DIR_RULE)
    return resolved


def require_output_path(path: Path, output_root: Path) -> Path:
    """Check the final destination too: a filename or caption can be a symlink."""
    root = output_root.resolve()
    resolved = path.resolve()
    if root not in resolved.parents and resolved != root:
        raise ValueError("Save destination must stay inside ComfyUI's output folder.")
    return path


def plan_exact_names(base: str, extension: str, count: int) -> list[str]:
    """One exact filename, or numbered siblings for a batch.

    A single image gets exactly ``base.ext`` — the whole point of exact
    mode. A batch cannot share one name, so frames become base_001.ext …
    in a stable width that sorts correctly.
    """
    if count <= 0:
        return []
    if count == 1:
        return [f"{base}.{extension}"]
    width = max(3, len(str(count)))
    return [f"{base}_{index:0{width}}.{extension}" for index in range(1, count + 1)]


def split_prefix(prefix: str) -> tuple[str, str]:
    """A sanitized local prefix as (subfolder, basename); '' subfolder at root."""
    clean = sanitize_exact_name(prefix) or "image"
    if "/" in clean:
        folder, base = clean.rsplit("/", 1)
        return folder, base
    return "", clean


def fill_name_tokens(text: str, now: datetime, width: int, height: int) -> str:
    """Fill the name tokens ComfyUI's own Save Image fills on the server.

    %width% and %height% are the picture's size. %year% %month% %day%
    %hour% %minute% %second% are the time of the save, two digits each but
    the year. %date:...% and %Node.setting% are filled by the browser before
    a run is sent, so they do not come through here. Any other text between
    percent signs stays as typed.
    """
    text = str(text or "")
    if "%" not in text:
        return text
    values = {
        "width": str(int(width)),
        "height": str(int(height)),
        "year": f"{now.year:04d}",
        "month": f"{now.month:02d}",
        "day": f"{now.day:02d}",
        "hour": f"{now.hour:02d}",
        "minute": f"{now.minute:02d}",
        "second": f"{now.second:02d}",
    }
    for name, value in values.items():
        text = text.replace(f"%{name}%", value)
    return text


def name_stem(base: str, flags: dict, now: datetime, width: int, height: int) -> str:
    """The local filename before its counter and batch tags.

    ``flags`` holds the modifier switches (date, time, size); the parts are
    appended in that fixed order so files from one node sort together.
    """
    parts = [base]
    if flags.get("date"):
        parts.append(now.strftime("%Y-%m-%d"))
    if flags.get("time"):
        parts.append(now.strftime("%H-%M-%S"))
    if flags.get("size"):
        parts.append(f"{int(width)}x{int(height)}")
    return "_".join(parts)


def counter_pattern(stem: str) -> re.Pattern:
    """Matches ``stem_00042.ext`` and ``stem_00042_b003.ext`` for one stem."""
    return re.compile(
        rf"^{re.escape(stem)}_(\d{{{COUNTER_WIDTH},}})(?:_b\d{{{BATCH_WIDTH},}})?\.[A-Za-z0-9]+$"
    )


def next_free_counter(existing_names, stem: str) -> int:
    """One past the highest counter already used by ``stem`` in a folder."""
    pattern = counter_pattern(stem)
    highest = 0
    for name in existing_names:
        match = pattern.match(str(name))
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def plan_local_names(
    stem: str, extension: str, count: int, *, counter: bool, batch: bool, next_counter: int = 1
) -> list[str]:
    """Filenames for a local-mode save of ``count`` images.

    Counter on: the next free number; a batch shares it and adds b001…
    when the batch tag is on, otherwise each frame takes the next number.
    Counter off: the stem alone (a single image reuses its path on purpose);
    a batch without the batch tag still numbers its frames, since frames
    cannot share one file.
    """
    if count <= 0:
        return []
    names = []
    for index in range(count):
        parts = [stem]
        if counter:
            number = next_counter if batch else next_counter + index
            parts.append(f"{number:0{COUNTER_WIDTH}}")
        if batch and count > 1:
            parts.append(f"b{index + 1:0{BATCH_WIDTH}}")
        elif not counter and count > 1:
            parts.append(f"{index + 1:0{max(3, len(str(count)))}}")
        names.append("_".join(parts) + f".{extension}")
    return names


def existing_action(exists: bool, policy: str) -> str:
    """'write' or 'skip'; the error policy raises so the run stops loudly."""
    if policy not in EXISTING_POLICIES:
        raise ValueError(f"Save Image: on_existing must be one of {EXISTING_POLICIES}.")
    if not exists:
        return "write"
    if policy == "覆盖":
        return "write"
    if policy == "跳过":
        return "skip"
    raise ValueError("Save Image: the file already exists and on_existing is 'error'.")


def sidecar_path(image_path: Path) -> Path:
    """The caption .txt sharing the image's exact basename."""
    return image_path.with_suffix(".txt")


def frame_to_pil(frame: torch.Tensor) -> Image.Image:
    array = np.clip(frame.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(array)


def _png_info(metadata: dict | None):
    if not metadata:
        return None
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    for key, value in metadata.items():
        info.add_text(key, value)
    return info


# JPEG 的 APP1 段大约 65535 字节封顶，Pillow 超了直接抛 "EXIF data is too
# long"，所以嵌元数据要留退路（这套退让逻辑照抄 Pixaroma 的 _build_jpeg_exif）
EXIF_MAX = 64000
# WebP 的 EXIF 在自己的 RIFF 块里，没有 64KB 限制，给个宽上限防止图变态大
EXIF_MAX_WEBP = 8 * 1024 * 1024
# 没做质量选项，固定一个"看不太出来又不太占"的值
JPEG_QUALITY = 95


def _build_exif(metadata: dict | None, max_bytes: int = EXIF_MAX) -> bytes | None:
    """把 prompt / workflow 写进 EXIF，写法跟 Pixaroma 一致（前端就认这个）：
    0x010E ImageDescription = "Workflow:<json>"，0x010F Make = "Prompt:<json>"。

    JPEG 装不下整份工作流是常态，所以按「workflow+prompt → 只 workflow」
    逐级退让；WebP 传大一点的 max_bytes 就能整份带上，拖回 ComfyUI 能还原。
    """
    if not metadata:
        return None
    try:
        data = {key: json.loads(value) for key, value in metadata.items()}
    except Exception:
        return None
    workflow = data.get("workflow")
    prompt = data.get("prompt")
    attempts = [(workflow, prompt), (workflow, None)]
    for wf, pr in attempts:
        if wf is None and pr is None:
            continue
        exif = Image.Exif()
        if wf is not None:
            exif[0x010E] = "Workflow:" + json.dumps(wf)
        if pr is not None:
            exif[0x010F] = "Prompt:" + json.dumps(pr)
        payload = exif.tobytes()
        if len(payload) <= max_bytes:
            return payload
    return None


def encode_image(path: Path, frame: torch.Tensor, format_name: str, metadata: dict | None) -> None:
    """Write one frame; metadata=None saves clean."""
    # 旧工作流（或 API 直接喂的 prompt）里可能还是 "jxl 无损"
    if format_name in ("jxl 无损", "jxl"):
        format_name = "jpg"
    image = frame_to_pil(frame)
    if format_name == "png":
        image.save(path, format="PNG", pnginfo=_png_info(metadata), compress_level=4)
        return
    if format_name == "webp 无损":
        kwargs = {"format": "WEBP", "lossless": True, "quality": 100, "method": 4}
        exif = _build_exif(metadata, EXIF_MAX_WEBP)
        if exif is not None:
            kwargs["exif"] = exif
        try:
            image.save(path, **kwargs)
        except (ValueError, OSError):
            # EXIF 被这个 Pillow/libwebp 拒了：图比元数据重要，存图
            kwargs.pop("exif", None)
            image.save(path, **kwargs)
        return
    if format_name == "jpg":
        rgb = image
        if image.mode == "RGBA":
            # JPG 没有 alpha：按 Pixaroma 的做法预乘压到黑底
            arr = np.asarray(image).astype(np.float32)
            alpha = arr[..., 3:4] / 255.0
            rgb = Image.fromarray((arr[..., :3] * alpha).clip(0, 255).astype(np.uint8))
        elif image.mode != "RGB":
            rgb = image.convert("RGB")
        exif = _build_exif(metadata)
        try:
            if exif is not None:
                rgb.save(path, "JPEG", quality=JPEG_QUALITY, exif=exif)
            else:
                rgb.save(path, "JPEG", quality=JPEG_QUALITY)
        except ValueError:
            # EXIF 被拒（不同 Pillow 版本的大小限制不一样）：照样存图
            rgb.save(path, "JPEG", quality=JPEG_QUALITY)
        return
    raise ValueError(f"Save Image: unknown format '{format_name}'.")


__all__ = [
    "BATCH_WIDTH",
    "COUNTER_WIDTH",
    "EXISTING_POLICIES",
    "FORMAT_EXTENSIONS",
    "IMAGE_EXTENSIONS",
    "IMAGE_FORMATS",
    "OUTPUT_DIR_RULE",
    "counter_pattern",
    "encode_image",
    "existing_action",
    "fill_name_tokens",
    "frame_to_pil",
    "metadata_disabled",
    "name_stem",
    "next_free_counter",
    "plan_exact_names",
    "plan_local_names",
    "require_output_path",
    "resolve_output_root",
    "sanitize_exact_name",
    "sidecar_path",
    "split_prefix",
    "strip_image_extension",
]
