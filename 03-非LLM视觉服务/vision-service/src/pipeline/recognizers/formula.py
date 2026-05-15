"""公式识别器 —— 步骤 4c：把公式区域转成 LaTeX。

引擎不可用（如 pix2tex 未装）时返回空，dispatch 会优雅降级回文本处理。
"""
from __future__ import annotations

from PIL import Image

from ...config import config
from ..formula import FormulaEngine
from .base import RawBlock, Recognizer


class FormulaRecognizer(Recognizer):
    block_type = "formula"

    def __init__(self, engine: FormulaEngine):
        self._engine = engine

    def recognize(self, image: Image.Image) -> list[RawBlock]:
        if not self._engine.available():
            return []   # 引擎不可用 → 空，dispatch 优雅降级回文本
        latex = self._engine.to_latex(image).strip()
        if not latex:
            return []
        w, h = image.size
        # raw_text 留空：pix2tex 不做 OCR，无「近似线性文本」可用。
        # encoded（LaTeX）走 payload → 转码器 → Block.encoded；按契约 raw_text
        # 是「原始 OCR 文本兜底」，没有就如实留空，由转码器标 latex_only。
        return [RawBlock(
            type="formula",
            bbox=(0, 0, w, h),
            raw_text="",
            # pix2tex 不提供置信度，用配置的名义值
            confidence=config.formula_nominal_confidence,
            payload={"latex": latex},
        )]
