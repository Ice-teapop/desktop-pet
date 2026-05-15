"""
区域内容轻量分类 —— 步骤 4a/4c：判断一个文本区域其实是「代码」还是「公式」。

定位：基于「已 OCR 出的文本内容」做判断（比纯像素猜测可靠）。这是启发式、尽力而为：
判定原则保守 —— 宁可漏判（当普通文本），也别误判（改变输出结构代价更大）。

公式检测的已知局限：tesseract 不认数学符号，很多公式 OCR 出来不含数学符号，
会被漏判成普通文本。规则法召回率有限，要可靠检测需后续上检测模型 —— 不做假精度。
"""
from __future__ import annotations

from .recognizers.base import RawBlock

# 强代码标记：日常文字里几乎不会出现
_STRONG_MARKERS = (
    "def ", "function ", "#include", "#define", "=>", "===", "!==",
    "::", "</", "/>", "printf", "console.", "System.out",
    "public static", "});", ");", "){",
)
# 代码符号
_CODE_SYMBOLS = set("{}[]();=<>")
# 数学专用符号：代码和普通文字里几乎不出现
_MATH_SYMBOLS = set("∫∑∏√∞∂∇≤≥≠≈±×÷∈∉⊂⊆∀∃→⇒↔"
                    "αβγδεζηθλμνξπρστφχψωΓΔΘΛΞΠΣΦΨΩ")

# 判定阈值（保守）
_STRONG_HITS_HIGH = 2       # 强标记出现 >= 此值 → 代码
_STRONG_HITS_LOW = 1        # 强标记 >= 此值且符号密度够 → 代码
_SYMBOL_DENSITY_MID = 0.04
_SYMBOL_DENSITY_HIGH = 0.10
_MATH_HITS_MIN = 2          # 数学符号 >= 此值且无代码标记 → 公式
_MATH_DENSITY_MIN = 0.10    # 数学符号密度 >= 此值才判公式，防止「长代码里碰巧 2 个数学符号」被误判
_MIN_TEXT_LEN = 4


def classify_region(raw_blocks: list[RawBlock]) -> str:
    """返回 "text" / "code" / "formula"。"""
    text = "\n".join(b.raw_text for b in raw_blocks)
    if len(text.strip()) < _MIN_TEXT_LEN:
        return "text"

    strong = sum(text.count(m) for m in _STRONG_MARKERS)
    math_hits = sum(1 for ch in text if ch in _MATH_SYMBOLS)
    math_density = math_hits / len(text)

    # 公式：数学专用符号够多、密度够高，且不含代码标记
    if (math_hits >= _MATH_HITS_MIN
            and math_density >= _MATH_DENSITY_MIN
            and strong == 0):
        return "formula"

    # 代码
    symbol_density = sum(1 for ch in text if ch in _CODE_SYMBOLS) / len(text)
    if strong >= _STRONG_HITS_HIGH:
        return "code"
    if strong >= _STRONG_HITS_LOW and symbol_density >= _SYMBOL_DENSITY_MID:
        return "code"
    if symbol_density >= _SYMBOL_DENSITY_HIGH:
        return "code"
    return "text"
