"""代码转码器 —— 步骤 4a：RawBlock(type="code") → 契约 Block。

契约 5.2：code 块 target="code"，encoded = { lang, text }，text 保留缩进与空白。
"""
from __future__ import annotations

from ...config import config
from ...schema.contract import Block
from ..recognizers.base import RawBlock
from .base import Transcoder


class CodeTranscoder(Transcoder):
    block_type = "code"
    target = "code"

    def transcode(self, raw: RawBlock, block_id: str, order: int) -> Block:
        lang = (raw.payload or {}).get("lang", "plain")
        low = raw.confidence < config.ocr_low_confidence
        return Block(
            id=block_id,
            type="code",
            order=order,
            bbox=list(raw.bbox),
            target="code",
            encoded={"lang": lang, "text": raw.raw_text},
            raw_text=raw.raw_text,
            confidence=round(raw.confidence, 3),
            notes="low_confidence" if low else None,
        )
