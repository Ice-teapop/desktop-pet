"""
版面分析 —— 步骤 3：把预处理图像按空白切成区域，供分派用。

定位（经确认）：视觉服务只「提取直观信息」，不「理解图像」。所以版面分析做的是
轻量规则切分 —— 靠水平空白投影把内容切成区域，不靠检测模型「看懂」图。

区域类型：架构上 LayoutRegion 带 type 字段、注册表按 type 分派。但纯规则要可靠
区分 表格/公式/代码 并不现实（那是假精度），所以本步骤所有区域先标 "text"，
精确类型检测留到步骤 4 跟对应识别器一起做。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache

from PIL import Image

from ..config import config
from .grid import find_grid_lines


@dataclass
class LayoutRegion:
    bbox: tuple[int, int, int, int]   # x, y, w, h —— 预处理图坐标系
    type: str                         # 区块类型，步骤 3 统一为 "text"
    order: int                        # 阅读顺序，从 1 递增


class LayoutAnalyzer(ABC):
    @abstractmethod
    def analyze(self, image: Image.Image) -> list[LayoutRegion]:
        """在预处理后的（灰度）图像上切分区域。"""


class ProjectionLayoutAnalyzer(LayoutAnalyzer):
    """基于水平空白投影的区域切分：内容行聚成带，带之间用足够宽的空白隔开。"""

    def __init__(
        self,
        binarize_threshold: int = 160,
        min_gap_rows: int = 8,
        min_content_pixels: int = 3,
        max_regions: int = 200,
        block_gap_factor: float = 1.0,
        table_line_ratio: float = 0.7,
    ):
        self.binarize_threshold = binarize_threshold
        self.min_gap_rows = min_gap_rows
        self.min_content_pixels = min_content_pixels
        self.max_regions = max_regions
        # 行间距 > 行高 * 此系数 才算「区域边界」，避免把段落/代码块按行拆碎
        self.block_gap_factor = block_gap_factor
        self.table_line_ratio = table_line_ratio

    def _region_type(self, image: Image.Image, y0: int, y1: int, w: int) -> str:
        """检测区域类型 —— 当前只识别「有网格线的表格」，其余为 text。"""
        h_ranges, v_ranges = find_grid_lines(
            image.crop((0, y0, w, y1)),
            line_ratio=self.table_line_ratio,
            threshold=self.binarize_threshold,
        )
        if len(h_ranges) >= 2 and len(v_ranges) >= 2:
            return "table"
        return "text"

    def analyze(self, image: Image.Image) -> list[LayoutRegion]:
        gray = image.convert("L")
        w, h = gray.size
        if w == 0 or h == 0:
            return []

        # 二值化：内容像素 = 0，背景 = 255
        binary = gray.point(lambda p: 0 if p < self.binarize_threshold else 255)
        data = binary.tobytes()   # "L" 模式，w*h 字节

        # 每行的内容（暗）像素数 —— bytes.count(0) 是 C 级操作，快
        is_content = [
            data[r * w:(r + 1) * w].count(0) >= self.min_content_pixels
            for r in range(h)
        ]

        # 第一步：找出所有「行」—— 任意空白行即分隔
        lines: list[tuple[int, int]] = []
        r = 0
        while r < h:
            if not is_content[r]:
                r += 1
                continue
            start = r
            while r < h and is_content[r]:
                r += 1
            lines.append((start, r - 1))
        if not lines:
            return []

        # 第二步：按「行间距」把行聚成区域 —— 间距明显大于行高才算区域边界，
        # 避免把段落 / 代码块按行拆碎
        heights = sorted(e - s + 1 for s, e in lines)
        typical_h = heights[len(heights) // 2]   # 行高中位数
        split_gap = max(self.min_gap_rows, int(typical_h * self.block_gap_factor))

        regions: list[LayoutRegion] = []
        order = 0
        cur_start, cur_end = lines[0]
        for s, e in lines[1:]:
            if s - cur_end - 1 > split_gap:
                order += 1
                regions.append(LayoutRegion(
                    bbox=(0, cur_start, w, cur_end - cur_start + 1),
                    type=self._region_type(gray, cur_start, cur_end + 1, w),
                    order=order,
                ))
                # 区域数量封顶：防止被构造的图打出过多 OCR 子进程
                if len(regions) >= self.max_regions:
                    return regions
                cur_start = s
            cur_end = e
        if len(regions) < self.max_regions:
            order += 1
            regions.append(LayoutRegion(
                bbox=(0, cur_start, w, cur_end - cur_start + 1),
                type=self._region_type(gray, cur_start, cur_end + 1, w),
                order=order,
            ))
        return regions


@lru_cache(maxsize=1)
def get_layout_analyzer() -> LayoutAnalyzer:
    # 无状态、可安全复用 —— 缓存为单例，避免每请求重建
    return ProjectionLayoutAnalyzer(
        binarize_threshold=config.layout_binarize_threshold,
        min_gap_rows=config.layout_min_gap_rows,
        min_content_pixels=config.layout_min_content_pixels,
        max_regions=config.layout_max_regions,
        block_gap_factor=config.layout_block_gap_factor,
        table_line_ratio=config.table_line_ratio,
    )
