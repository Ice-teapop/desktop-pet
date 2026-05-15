"""OCR 引擎抽象。不同引擎（Tesseract / 其它）实现同一接口，可插拔。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from PIL import Image


@dataclass
class OcrLine:
    text: str
    bbox: tuple[int, int, int, int]   # x, y, w, h —— 在传入图像的坐标系
    confidence: float                 # 0~1


class OcrEngine(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool:
        """引擎当前是否可用（二进制、语言包等是否就绪）。"""

    @abstractmethod
    def recognize_lines(self, image: Image.Image) -> list[OcrLine]:
        """识别图像中的文本行。"""
