"""文本识别器：用 OCR 引擎把图像里的文本行识别出来。"""
from __future__ import annotations

from PIL import Image

from ..ocr import OcrEngine
from .base import RawBlock, Recognizer


class TextRecognizer(Recognizer):
    block_type = "text"

    def __init__(self, engine: OcrEngine):
        self._engine = engine

    def recognize(self, image: Image.Image) -> list[RawBlock]:
        # OCR 已返回「传入 image 的局部坐标」；坐标偏移与还原交给分派层
        return [
            RawBlock(
                type="text",
                bbox=line.bbox,
                raw_text=line.text,
                confidence=line.confidence,
            )
            for line in self._engine.recognize_lines(image)
        ]
