"""识别器抽象 + 识别器输出的中间结构 RawBlock。

识别与转码分离（框架设计第四章）：识别器只产出「认出了什么」（RawBlock），
转码器再把它归一化成契约里的 Block。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

from PIL import Image


@dataclass
class RawBlock:
    type: str                                  # 区块类型，如 "text"
    bbox: tuple[int, int, int, int]            # x, y, w, h —— 传入图像的局部坐标系
    raw_text: str
    confidence: float                          # 0~1
    payload: Optional[dict[str, Any]] = None   # 识别器附带的额外信息（文本暂不用）


class Recognizer(ABC):
    block_type: str = "base"

    @abstractmethod
    def recognize(self, image: Image.Image) -> list[RawBlock]:
        """在给定图像（整张预处理图或某个区域裁剪）上识别本类型区块。

        RawBlock.bbox 用「传入 image 的局部坐标系」；坐标偏移与缩放还原由分派层负责。
        """
