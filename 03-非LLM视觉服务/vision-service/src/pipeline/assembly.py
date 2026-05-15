"""
结构化合并 —— 步骤 3：把分派得到的 Block 列表整理成最终输出。

步骤 3 的区域已按阅读顺序排好，这里只做：截断到 max_blocks、重排连续 order、
拼接 reading_text。多栏 / 嵌套的复杂顺序重建留待后续步骤。
"""
from __future__ import annotations

from ..schema.contract import Block


def assemble(blocks: list[Block], max_blocks: int) -> tuple[list[Block], str]:
    """返回 (blocks, reading_text)。"""
    if len(blocks) > max_blocks:
        blocks = blocks[:max_blocks]
    # 重排 order 为连续 1..N
    for i, block in enumerate(blocks, start=1):
        block.order = i
    reading_text = "\n".join(b.raw_text for b in blocks if b.raw_text)
    return blocks, reading_text
