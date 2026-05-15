"""公式识别引擎工厂。按配置返回引擎实例（缓存为单例）。"""
from __future__ import annotations

from functools import lru_cache

from ...config import config
from .base import FormulaEngine
from .pix2tex_engine import Pix2TexEngine

__all__ = ["FormulaEngine", "get_formula_engine"]


@lru_cache(maxsize=1)
def get_formula_engine() -> FormulaEngine:
    name = config.formula_engine
    if name == "pix2tex":
        return Pix2TexEngine()
    raise ValueError(f"unknown formula engine: {name}")
