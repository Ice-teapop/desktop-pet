"""
识别器注册表 —— 步骤 3：集中管理「区块类型 → (识别器, 转码器)」的映射。

步骤 4 新增表格 / 公式 / 代码识别器时，只需在 build_default_registry 里多 register
一行，分派与流水线主流程都不用动。
"""
from __future__ import annotations

from typing import Optional

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
    """默认注册表。步骤 4 逐个登记专项识别器。"""
    reg = RecognizerRegistry()
    reg.register("text", TextRecognizer(ocr_engine), TextTranscoder())
    reg.register("code", CodeRecognizer(ocr_engine), CodeTranscoder())
    reg.register("table", TableRecognizer(ocr_engine), TableTranscoder())
    reg.register(
        "formula",
        FormulaRecognizer(get_formula_engine()),
        FormulaTranscoder(),
    )
    return reg
