"""公式转码器 —— 步骤 4c：RawBlock(type="formula") → 契约 Block。

契约 5.2：formula 块 target="latex"，encoded = LaTeX 字符串（注意是字符串，不是对象）。
"""
from __future__ import annotations

from ...config import config
from ...schema.contract import Block
from ..recognizers.base import RawBlock
from .base import Transcoder


class FormulaTranscoder(Transcoder):
    block_type = "formula"
    target = "latex"

    def transcode(self, raw: RawBlock, block_id: str, order: int) -> Block:
        latex = (raw.payload or {}).get("latex", "")
        low = raw.confidence < config.ocr_low_confidence
        # notes：latex_only 表明本块无「近似 OCR 文本兜底」，客户端要纯文本展示
        # 只能用 encoded（LaTeX）自己渲染。低置信度时再叠加 low_confidence。
        notes_parts = ["latex_only"]
        if low:
            notes_parts.append("low_confidence")
        return Block(
            id=block_id,
            type="formula",
            order=order,
            bbox=list(raw.bbox),
            target="latex",
            encoded=latex,          # 契约：formula 的 encoded 是 LaTeX 字符串
            raw_text="",            # pix2tex 路径无近似 OCR 文本
            confidence=round(raw.confidence, 3),
            notes=";".join(notes_parts),
        )
