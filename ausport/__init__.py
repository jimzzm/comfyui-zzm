"""从 ComfyUI-AusBoss 原样移植的三个节点（可重复生成）。

只改：中文文案、配色（Radix Slate + Orange）、命名空间隔离。
"""

from .node_image_folder import NODE_CLASS_MAPPINGS as _IF_MAP
from .node_image_folder import NODE_DISPLAY_NAME_MAPPINGS as _IF_NAME
from .node_save_image import NODE_CLASS_MAPPINGS as _SI_MAP
from .node_save_image import NODE_DISPLAY_NAME_MAPPINGS as _SI_NAME
from .node_lora_loader import NODE_CLASS_MAPPINGS as _LL_MAP
from .node_lora_loader import NODE_DISPLAY_NAME_MAPPINGS as _LL_NAME

NODE_CLASS_MAPPINGS = {**_IF_MAP, **_SI_MAP, **_LL_MAP}

NODE_DISPLAY_NAME_MAPPINGS = {
    **_IF_NAME,
    **_SI_NAME,
    **_LL_NAME,
    "ZZM_NODES_ImageFolder": "图片文件夹",
    "ZZM_NODES_SaveImage": "保存图片",
    "ZZM_NODES_LoraLoader": "LoRA 加载器",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
