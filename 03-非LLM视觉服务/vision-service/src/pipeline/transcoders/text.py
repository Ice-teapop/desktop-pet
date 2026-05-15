"""文本转码器：文本区块的转码是平凡的 —— encoded 就是文本本身。"""
from __future__ import annotations

from ...config import config
from ...schema.contract import Block
from ..recognizers.base import RawBlock
from .base import Transcoder


class TextTranscoder(Transcoder):
    block_type = "text"
    target = "text"

    def transcode(self, raw: RawBlock, block_id: str, order: int) -> Block:
        low = raw.confidence < config.ocr_low_confidence
        return Block(
            id=block_id,
            type="text",
            order=order,
            bbox=list(raw.bbox),
            target="text",
            encoded=raw.raw_text,
            raw_text=raw.raw_text,
            confidence=round(raw.confidence, 3),
            notes="low_confidence" if low else None,
        )
