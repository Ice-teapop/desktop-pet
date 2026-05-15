"""
视觉服务处理流水线 —— 步骤 3：预处理 + 版面分析 + 区块分派 + 结构化合并。

链路：
  解码 + 像素校验 → 预处理 → 版面分析（切区域）
  → 区块分派（按类型路由到识别器，识别 + 坐标还原 + 转码）
  → 结构化合并（截断 + reading_text）

定位：视觉服务只提取直观信息（文字 / 符号 / …），不做理解 —— 理解交给 LLM。
OCR 引擎不可用时优雅降级：记 warning，返回占位 unknown 块，服务不中断。

后续步骤继续按《非 LLM 视觉服务 — 框架设计》填充：
  步骤 4 —— 表格 / 公式 / 代码识别器与转码器（在 registry 里登记即可接入）。
"""
from __future__ import annotations

import io

from PIL import Image

from ..api.auth import ServiceError
from ..config import config
from ..log import get_logger
from ..schema.contract import Block, ExtractMetadata
from .assembly import assemble
from .dispatch import dispatch_regions
from .layout import get_layout_analyzer
from .ocr import get_ocr_engine
from .preprocess import preprocess
from .registry import build_default_registry

logger = get_logger("pipeline")

# 解压炸弹兜底：限制 PIL 解码的最大像素数
Image.MAX_IMAGE_PIXELS = config.max_image_pixels

# 启动时构建一次，请求间复用（引擎 / 分析器 / 注册表都无状态，可安全共享）。
# 这样每请求不再重复 shell out 跑 tesseract 子进程做可用性探测。
_ocr_engine = get_ocr_engine()
_layout_analyzer = get_layout_analyzer()
_registry = build_default_registry(_ocr_engine)


def _placeholder_block(width: int, height: int, note: str) -> Block:
    """无可用结果时的占位块，保证 blocks 非空、客户端可统一处理。"""
    return Block(
        id="b1", type="unknown", order=1,
        bbox=[0, 0, width, height],
        target=None, encoded=None, raw_text="",
        confidence=0.0, notes=note,
    )


def run_pipeline(image_bytes: bytes, metadata: ExtractMetadata):
    """返回 (blocks, reading_text, recognizers_used)。"""
    # —— 解码 + 像素上限校验 + 预处理 ——
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
            # 解码前先按尺寸卡一道，防解压炸弹（.load() 才会真正解码像素）
            if width * height > config.max_image_pixels:
                raise ServiceError(
                    "IMAGE_TOO_LARGE", 413,
                    f"image {width}x{height} px exceeds pixel limit",
                )
            img.load()
            pre = preprocess(img)
    except ServiceError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ServiceError("INVALID_IMAGE", 400, f"cannot decode image: {e}")

    # —— OCR 引擎不可用 → 优雅降级 ——
    if not _ocr_engine.available():   # available() 结果已缓存，不再每请求 shell out
        logger.warning(
            "OCR engine '%s' unavailable, degrading to placeholder", _ocr_engine.name
        )
        return [_placeholder_block(width, height, "ocr_engine_unavailable")], "", []

    # —— 版面分析 → 区块分派 → 结构化合并 ——
    regions = _layout_analyzer.analyze(pre.image)
    blocks, recognizers_used = dispatch_regions(pre, regions, _registry)
    blocks, reading_text = assemble(blocks, metadata.options.max_blocks)

    # 没识别到任何内容 → 占位块
    if not blocks:
        return [_placeholder_block(width, height, "no_content_detected")], "", []

    return blocks, reading_text, recognizers_used
