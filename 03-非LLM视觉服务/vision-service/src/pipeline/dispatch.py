"""
区块分派 —— 步骤 3：按区域类型路由到对应识别器，识别后转码成契约 Block。

坐标流转：
  版面分析给出的 region.bbox 在「预处理图」坐标系
  → 裁出区域图，识别器在「区域局部」坐标系返回 RawBlock
  → 加上区域原点偏移 → 回到「预处理图」坐标系
  → 除以 pre.scale → 还原到「原图」坐标系
  → 转码成 Block
"""
from __future__ import annotations

from ..config import config
from ..log import get_logger
from ..schema.contract import Block
from .classify import classify_region
from .layout import LayoutRegion
from .preprocess import PreprocessedImage
from .recognizers.base import RawBlock
from .registry import RecognizerRegistry

logger = get_logger("pipeline.dispatch")

# 区域类型没有对应识别器时的回退类型
_FALLBACK_TYPE = "text"


def _to_orig(
    bbox: tuple[int, int, int, int], inv_scale: float
) -> tuple[int, int, int, int]:
    x, y, w, h = bbox
    return (
        round(x * inv_scale), round(y * inv_scale),
        round(w * inv_scale), round(h * inv_scale),
    )


def dispatch_regions(
    pre: PreprocessedImage,
    regions: list[LayoutRegion],
    registry: RecognizerRegistry,
) -> tuple[list[Block], list[str]]:
    """对每个区域做「识别 → 坐标还原 → 转码」。

    返回 (blocks, recognizers_used)，blocks 按阅读顺序排列。
    """
    inv_scale = 1.0 / pre.scale if pre.scale else 1.0
    img_w, img_h = pre.image.size
    pad = config.layout_region_padding
    blocks: list[Block] = []
    used: set[str] = set()
    order = 0

    for region in sorted(regions, key=lambda r: r.order):
        rx, ry, rw, rh = region.bbox

        # chart 区域：直通，不识别（步骤 3 的规则版不会产出 chart，此处为架构预留）
        if region.type == "chart":
            order += 1
            blocks.append(Block(
                id=f"b{order}", type="chart", order=order,
                bbox=list(_to_orig(region.bbox, inv_scale)),
                target=None, encoded=None, raw_text="",
                confidence=0.0, notes="chart_passthrough",
            ))
            continue

        entry = registry.get(region.type)
        note_prefix = None
        if entry is None:
            # 没有对应识别器 → 回退文本 OCR，并标记未专项处理
            entry = registry.get(_FALLBACK_TYPE)
            note_prefix = f"untranscoded:{region.type}"
            if entry is None:
                logger.warning("no recognizer for region type '%s'", region.type)
                continue

        recognizer, transcoder = entry
        # 裁剪时四周留 padding —— OCR 引擎需要边距才能正常工作；裁剪框夹到图像边界内
        cx0 = max(0, rx - pad)
        cy0 = max(0, ry - pad)
        cx1 = min(img_w, rx + rw + pad)
        cy1 = min(img_h, ry + rh + pad)
        crop = pre.image.crop((cx0, cy0, cx1, cy1))
        raw_blocks = recognizer.recognize(crop)

        # 基于 OCR 文本内容轻量分类：text 区域可能其实是代码或公式，改用专项识别器
        # （注：会对该区域二次识别；专项识别器无结果时保留文本结果 → 优雅降级）
        if region.type == "text":
            sub_type = classify_region(raw_blocks)
            if sub_type != "text":
                refined_entry = registry.get(sub_type)
                if refined_entry is not None:
                    refined = refined_entry[0].recognize(crop)
                    if refined:
                        recognizer, transcoder = refined_entry
                        raw_blocks = refined

        if raw_blocks:
            used.add(recognizer.block_type)

        for raw in raw_blocks:
            lx, ly, lw, lh = raw.bbox
            corrected = RawBlock(
                type=raw.type,
                # 裁剪图局部坐标 → 预处理图坐标（加裁剪原点）→ 原图坐标（除以 scale）
                bbox=_to_orig((cx0 + lx, cy0 + ly, lw, lh), inv_scale),
                raw_text=raw.raw_text,
                confidence=raw.confidence,
                payload=raw.payload,
            )
            order += 1
            block = transcoder.transcode(corrected, block_id=f"b{order}", order=order)
            if note_prefix:
                block.notes = (
                    note_prefix if not block.notes
                    else f"{note_prefix};{block.notes}"
                )
            blocks.append(block)

    return blocks, sorted(used)
