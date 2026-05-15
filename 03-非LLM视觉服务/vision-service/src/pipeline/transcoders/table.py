"""表格转码器 —— 步骤 4b：RawBlock(type="table") → 契约 Block。

契约 5.2：table 块 target="table-json"，encoded = { headers, rows }。
"""
from __future__ import annotations

from ...config import config
from ...schema.contract import Block
from ..recognizers.base import RawBlock
from .base import Transcoder


class TableTranscoder(Transcoder):
    block_type = "table"
    target = "table-json"

    def transcode(self, raw: RawBlock, block_id: str, order: int) -> Block:
        payload = raw.payload or {}
        low = raw.confidence < config.ocr_low_confidence
        return Block(
            id=block_id,
            type="table",
            order=order,
            bbox=list(raw.bbox),
            target="table-json",
            encoded={
                "headers": payload.get("headers", []),
                "rows": payload.get("rows", []),
            },
            raw_text=raw.raw_text,
            confidence=round(raw.confidence, 3),
            notes="low_confidence" if low else None,
        )
