"""
网格线检测 —— 步骤 4b：在图像里找出水平 / 垂直的长暗线。

供两处使用：
  - 版面分析：region 里若有 >=2 横线且 >=2 竖线，判为 "table"
  - 表格识别器：用线的位置切单元格

返回线的「区间」(start, end) 而非中心 —— 这样调用方能按线的实际宽度精确避让，
不会把线残留在单元格里。只处理「有可见网格线」的表格，不做假精度。
"""
from __future__ import annotations

from PIL import Image


def _runs_to_ranges(indices: list[int]) -> list[tuple[int, int]]:
    """把连续的索引聚成 (start, end) 区间（一条线可能有几像素宽，含端点）。"""
    if not indices:
        return []
    ranges = []
    run_start = prev = indices[0]
    for i in indices[1:]:
        if i - prev > 1:
            ranges.append((run_start, prev))
            run_start = i
        prev = i
    ranges.append((run_start, prev))
    return ranges


def find_grid_lines(
    image: Image.Image,
    line_ratio: float = 0.7,
    threshold: int = 160,
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """返回 (水平线区间列表, 垂直线区间列表)，每个区间是 (start, end)，含端点。

    一行 / 列的暗像素占比超过 line_ratio 即视为网格线。
    水平线不足 2 条时直接返回 —— 不可能是网格，省掉昂贵的垂直扫描。
    """
    gray = image.convert("L")
    w, h = gray.size
    if w == 0 or h == 0:
        return [], []
    binary = gray.point(lambda p: 0 if p < threshold else 255)
    data = binary.tobytes()

    h_dark = [data[r * w:(r + 1) * w].count(0) for r in range(h)]
    h_lines = _runs_to_ranges([r for r in range(h) if h_dark[r] > line_ratio * w])
    if len(h_lines) < 2:
        return h_lines, []

    v_dark = [
        sum(1 for r in range(h) if data[r * w + c] == 0)
        for c in range(w)
    ]
    v_lines = _runs_to_ranges([c for c in range(w) if v_dark[c] > line_ratio * h])
    return h_lines, v_lines
