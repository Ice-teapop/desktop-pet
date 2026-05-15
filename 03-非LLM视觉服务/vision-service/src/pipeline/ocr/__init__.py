"""OCR 引擎工厂。按配置返回引擎实例 —— 后续接入注册表时从这里扩展。"""
from __future__ import annotations

from functools import lru_cache

from ...config import config
from .base import OcrEngine, OcrLine
from .tesseract import TesseractEngine

__all__ = ["OcrEngine", "OcrLine", "get_ocr_engine"]


@lru_cache(maxsize=1)
def get_ocr_engine() -> OcrEngine:
    # 缓存为单例：引擎无状态，且其 available() 子进程探测结果可随实例缓存复用
    name = config.ocr_engine
    if name == "tesseract":
        return TesseractEngine(lang=config.ocr_lang)
    raise ValueError(f"unknown OCR engine: {name}")
