"""转码器抽象：把识别器产出的 RawBlock 归一化成契约里的 Block。"""
from __future__ import annotations

from abc import ABC, abstractmethod

from ...schema.contract import Block
from ..recognizers.base import RawBlock


class Transcoder(ABC):
    block_type: str = "base"
    target: str = ""

    @abstractmethod
    def transcode(self, raw: RawBlock, block_id: str, order: int) -> Block:
        """把一个 RawBlock 转成契约 Block。"""
