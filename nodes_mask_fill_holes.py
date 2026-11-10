"""Mask Fill Holes node
Extracted from WAS Node Suite (nodes/mask/mask_fill_region.py + modules/mask/regions.py)
MIT License, Copyright (c) 2023 Jordan Thompson (WASasquatch)
Standalone rewrite: the fill algorithm is equivalent to scipy.ndimage.binary_fill_holes.
Behaviour matches WAS: only fully enclosed holes are filled; a hole touching the
image border counts as open air and is left alone.
"""

import numpy as np
import torch
from scipy import ndimage


class MaskFillHoles:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "masks": ("MASK",),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("masks",)
    FUNCTION = "fill_holes"
    CATEGORY = "⚡ zzm工具箱"
    SEARCH_ALIASES = ["zzm", "mask", "fill holes", "遮罩填洞"]

    def fill_holes(self, masks):
        device, dtype = masks.device, masks.dtype
        out = []
        for mask in masks:
            m = mask.detach().cpu().numpy() > 0
            filled = ndimage.binary_fill_holes(m)
            out.append(torch.from_numpy(filled.astype(np.float32)))
        return (torch.stack(out).to(device=device, dtype=dtype),)
