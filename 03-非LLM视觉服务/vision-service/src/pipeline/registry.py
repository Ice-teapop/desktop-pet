"""
识别器注册表 —— 步骤 3：集中管理「区块类型 → (识别器, 转码器)」的映射。

步骤 4 新增表格 / 公式 / 代码识别器时，只需在 build_default_registry 里多 register
一行，分派与流水线主流程都不用动。
"""
from __future__ import annotations

from typing import Optional

from ..config import config
from .formula import get_formula_engine
from .ocr import OcrEngine
from .recognizers.base import Recognizer
from .recognizers.code import CodeRecognizer
from .recognizers.formula import FormulaRecognizer
from .recognizers.table import TableRecognizer
from .recognizers.text import TextRecognizer
from .transcoders.base import Transcoder
from .transcoders.code import CodeTranscoder
from .transcoders.formula import FormulaTranscoder
from .transcoders.table import TableTranscoder
from .transcoders.text import TextTranscoder


class RecognizerRegistry:
    def __init__(self):
        self._map: dict[str, tuple[Recognizer, Transcoder]] = {}

    def register(
        self, block_type: str, recognizer: Recognizer, transcoder: Transcoder
    ) -> None:
        self._map[block_type] = (recognizer, transcoder)

    def get(self, block_type: str) -> Optional[tuple[Recognizer, Transcoder]]:
        return self._map.get(block_type)

    @property
    def types(self) -> list[str]:
        return sorted(self._map.keys())


def build_default_registry(ocr_engine: OcrEngine) -> RecognizerRegistry:
    """按 config.recognizers.enabled 条件注册。

    不在 enabled 列表里的 recognizer 不注册 —— dispatch 拿到 region.type 未注册
    时会 fallback 到 _FALLBACK_TYPE（text），让该类型区域走 text OCR。
    用途：某识别器误判过多（例如 table 把界面边框当表格）时，改 config 即可
    临时关掉，无需改代码。
    """
    enabled = set(config.recognizers)
    reg = RecognizerRegistry()
    # text 是 dispatch._FALLBACK_TYPE，强制注册 —— 否则未识别 region 全丢
    reg.register("text", TextRecognizer(ocr_engine), TextTranscoder())
    if "code" in enabled:
        reg.register("code", CodeRecognizer(ocr_engine), CodeTranscoder())
    if "table" in enabled:
        reg.register("table", TableRecognizer(ocr_engine), TableTranscoder())
    if "formula" in enabled:
        reg.register(
            "formula",
            FormulaRecognizer(get_formula_engine()),
            FormulaTranscoder(),
        )
    return reg
