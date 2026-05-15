"""
接口路由 —— 实现《视觉服务接口契约 API v1》的三个接口：
  GET  /v1/health
  GET  /v1/capabilities
  POST /v1/extract
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile

from ..config import config
from ..log import get_logger
from ..pipeline.pipeline import run_pipeline
from ..schema.contract import (
    CapabilitiesResponse,
    ExtractMeta,
    ExtractMetadata,
    ExtractResponse,
    HealthResponse,
)
from ..util import safe_request_id
from .auth import ServiceError, require_auth
from .ratelimit import rate_limit

router = APIRouter(prefix="/v1")
logger = get_logger("api")


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """健康检查，供客户端探活。无需鉴权。"""
    return HealthResponse(pipeline_version=config.pipeline_version)


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def capabilities(_auth: dict = Depends(require_auth)) -> CapabilitiesResponse:
    """查询服务能力：启用的识别器、转码目标、各项限制。"""
    return CapabilitiesResponse(
        pipeline_version=config.pipeline_version,
        recognizers=config.recognizers,
        targets=config.targets,
        max_image_bytes=config.max_image_bytes,
        limits={
            "rate_per_min": config.rate_per_min,
            "max_blocks": config.max_blocks,
        },
    )


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    image: UploadFile = File(...),
    metadata: str = Form(...),
    x_request_id: Optional[str] = Header(default=None),
    content_length: Optional[str] = Header(default=None),
    _auth: dict = Depends(require_auth),
    _rl: None = Depends(rate_limit),
) -> ExtractResponse:
    """提交一帧画面，返回结构化提取结果。"""
    request_id = safe_request_id(x_request_id)

    # —— Content-Length 粗检：在读取整个请求体之前先挡掉超大请求 ——
    # 精确校验仍由下面的 len(image_bytes) 负责；生产环境建议反向代理也设 body 上限。
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError:
            declared = -1
        envelope_margin = 65536  # metadata 与 multipart 信封的余量
        if declared > config.max_image_bytes + envelope_margin:
            raise ServiceError(
                "IMAGE_TOO_LARGE", 413,
                f"request body {declared} bytes exceeds limit",
            )

    # —— 解析 metadata JSON ——
    try:
        meta_obj = ExtractMetadata.model_validate_json(metadata)
    except Exception as e:  # noqa: BLE001
        raise ServiceError("INVALID_REQUEST", 400, f"invalid metadata: {e}")

    # —— 读取并校验图像 ——
    image_bytes = await image.read()
    if len(image_bytes) == 0:
        raise ServiceError("INVALID_IMAGE", 400, "empty image")
    if len(image_bytes) > config.max_image_bytes:
        raise ServiceError(
            "IMAGE_TOO_LARGE", 413,
            f"frame exceeds {config.max_image_bytes} bytes limit",
        )

    # —— 跑流水线 ——
    started = time.time()
    try:
        blocks, reading_text, recognizers_used = run_pipeline(image_bytes, meta_obj)
    except ServiceError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ServiceError("PIPELINE_ERROR", 500, f"pipeline failed: {e}")
    latency_ms = int((time.time() - started) * 1000)

    if not meta_obj.options.include_reading_text:
        reading_text = ""

    # 只记不含画面内容的指标（遵守「不留存」纪律）
    logger.info(
        "extract ok request_id=%s region=%s frame=%s blocks=%d latency=%dms",
        request_id, meta_obj.region_id, meta_obj.frame_seq, len(blocks), latency_ms,
    )

    return ExtractResponse(
        request_id=request_id,
        region_id=meta_obj.region_id,
        frame_seq=meta_obj.frame_seq,
        blocks=blocks,
        reading_text=reading_text,
        meta=ExtractMeta(
            latency_ms=latency_ms,
            pipeline_version=config.pipeline_version,
            recognizers_used=recognizers_used,
        ),
    )
