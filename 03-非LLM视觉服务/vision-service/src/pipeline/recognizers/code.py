"""
代码识别器 —— 步骤 4a。

把一个代码区域 OCR 出来，并尽量保留缩进：用每行最左词的 x 位置、配合估算的
平均字符宽度，重建行首空格。整段代码作为一个 RawBlock 返回（payload 里带语言）。

语言判断是轻量启发式，尽力而为 —— 认不出就 "plain"。
"""
from __future__ import annotations

from PIL import Image

from ..ocr import OcrEngine
from .base import RawBlock, Recognizer


def detect_language(code: str) -> str:
    """轻量语言判断；认不出返回 "plain"。"""
    c = code
    if "def " in c or "elif " in c or "    return " in c:
        return "python"
    if "function " in c or "=>" in c or "console." in c or "const " in c:
        return "javascript"
    if "#include" in c or "printf" in c or "int main" in c:
        return "c"
    if "public class" in c or "System.out" in c or "public static void" in c:
        return "java"
    return "plain"


class CodeRecognizer(Recognizer):
    block_type = "code"

    def __init__(self, engine: OcrEngine):
        self._engine = engine

    @staticmethod
    def _estimate_char_width(lines) -> float:
        """用行宽 / 字符数估算平均字符宽度。"""
        widths = [l.bbox[2] / len(l.text) for l in lines if l.text]
        return sum(widths) / len(widths) if widths else 0.0

    def recognize(self, image: Image.Image) -> list[RawBlock]:
        lines = self._engine.recognize_lines(image)
        if not lines:
            return []

        char_w = self._estimate_char_width(lines)
        min_x = min(l.bbox[0] for l in lines)
        ordered = sorted(lines, key=lambda l: l.bbox[1])   # 按 y 排序

        text_lines = []
        for line in ordered:
            indent_px = line.bbox[0] - min_x
            indent = round(indent_px / char_w) if char_w else 0
            text_lines.append(" " * max(indent, 0) + line.text)
        code_text = "\n".join(text_lines)

        # 整段代码的外接矩形
        x0 = min(l.bbox[0] for l in lines)
        y0 = min(l.bbox[1] for l in lines)
        x1 = max(l.bbox[0] + l.bbox[2] for l in lines)
        y1 = max(l.bbox[1] + l.bbox[3] for l in lines)
        conf = sum(l.confidence for l in lines) / len(lines)

        return [RawBlock(
            type="code",
            bbox=(x0, y0, x1 - x0, y1 - y0),
            raw_text=code_text,
            confidence=conf,
            payload={"lang": detect_language(code_text)},
        )]
