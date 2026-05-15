"""
《视觉服务接口契约 API v1》的数据模型。

这一份是契约的「单一事实来源」—— 请求 / 响应 / 区块 / 错误的结构都在这里定义。
契约冻结后，任何字段改动都要走《视觉服务接口契约》第八章的演进规则。
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# 区块类型枚举（契约第五章）
BlockType = Literal[
    "text", "heading", "table", "formula",
    "code", "symbol", "error", "chart", "unknown",
]


# ---------- 请求 ----------
class RegionSize(BaseModel):
    w: int
    h: int


class ExtractOptions(BaseModel):
    include_reading_text: bool = True
    include_chart_crop: bool = True
    max_blocks: int = 200


class ExtractMetadata(BaseModel):
    """POST /v1/extract 请求里 metadata 部分的结构。"""
    region_id: str
    frame_seq: int
    captured_at: str
    region_size: RegionSize
    content_hash: str
    options: ExtractOptions = Field(default_factory=ExtractOptions)


# ---------- 响应 ----------
class Block(BaseModel):
    """一个语义区块。encoded 的具体结构随 type 而定，见契约 5.2。"""
    id: str
    type: BlockType
    order: int
    bbox: list[int] = Field(min_length=4, max_length=4)   # [x, y, w, h]
    target: Optional[str] = None
    encoded: Any = None                   # string | object | null
    raw_text: str = ""
    confidence: float = 0.0
    image_crop: Optional[str] = None      # 仅 type=chart 提供，base64 PNG
    notes: Optional[str] = None           # low_confidence / untranscoded 等标记


class ExtractMeta(BaseModel):
    latency_ms: int
    pipeline_version: str
    recognizers_used: list[str]


class ExtractResponse(BaseModel):
    ok: bool = True
    request_id: str
    region_id: str
    frame_seq: int
    blocks: list[Block]
    reading_text: str = ""
    meta: ExtractMeta


# ---------- 错误 ----------
class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    ok: bool = False
    request_id: str
    error: ErrorBody


# ---------- 能力 / 健康 ----------
class CapabilitiesResponse(BaseModel):
    pipeline_version: str
    recognizers: list[str]
    targets: dict[str, str]
    max_image_bytes: int
    limits: dict[str, int]


class HealthResponse(BaseModel):
    ok: bool = True
    status: str = "healthy"
    pipeline_version: str
