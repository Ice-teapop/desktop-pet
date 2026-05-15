"""
表格识别器 —— 步骤 4b。

只处理「有可见网格线」的表格：用网格线把区域切成单元格，逐格 OCR，第一行作表头。
无边框表格规则不可靠，不在此处理（交回退按文本处理 —— 不做假精度）。

网格线按「实际区间」避让：单元格取「上线下沿 ~ 下线上沿」，不让线残留进单元格。
"""
from __future__ import annotations

from PIL import Image, ImageOps

from ...config import config
from ..grid import find_grid_lines
from ..ocr import OcrEngine
from .base import RawBlock, Recognizer


class TableRecognizer(Recognizer):
    block_type = "table"

    def __init__(self, engine: OcrEngine):
        self._engine = engine

    def _ocr_cell(self, cell_img: Image.Image) -> tuple[str, float]:
        """裁到内容外接框 + 放大 + 补白边再 OCR。

        OCR 对「大片空白里的小字」识别很差 —— 先把单元格裁紧到文字本身、
        小字放大、再补白边，准确率明显更高。
        """
        gray = cell_img.convert("L")
        content_bbox = ImageOps.invert(gray).getbbox()
        if content_bbox is None:
            return "", 0.0   # 空单元格
        content = gray.crop(content_bbox)
        # 小字放大，OCR 对过小的字偏弱
        if content.height < 40:
            content = content.resize(
                (content.width * 3, content.height * 3),
                Image.Resampling.LANCZOS,
            )
        padded = ImageOps.expand(content, border=12, fill=255)
        lines = self._engine.recognize_lines(padded)
        if not lines:
            return "", 0.0
        text = " ".join(l.text for l in lines).strip()
        conf = sum(l.confidence for l in lines) / len(lines)
        return text, conf

    def recognize(self, image: Image.Image) -> list[RawBlock]:
        h_ranges, v_ranges = find_grid_lines(
            image,
            line_ratio=config.table_line_ratio,
            threshold=config.layout_binarize_threshold,
        )
        # 防御：正常情况下 layout 已筛过，这里再确认一次
        if len(h_ranges) < 2 or len(v_ranges) < 2:
            return []

        nrows, ncols = len(h_ranges) - 1, len(v_ranges) - 1
        if nrows * ncols > config.table_max_cells:
            return []   # 网格过大，放弃（交回退按文本处理）

        margin = config.table_cell_inset
        grid: list[list[str]] = []
        confs: list[float] = []
        for ri in range(nrows):
            # 单元格在两条横线之间：上线的下沿 ~ 下线的上沿
            y0 = h_ranges[ri][1] + margin
            y1 = h_ranges[ri + 1][0] - margin
            row: list[str] = []
            for ci in range(ncols):
                x0 = v_ranges[ci][1] + margin
                x1 = v_ranges[ci + 1][0] - margin
                if x1 <= x0 or y1 <= y0:
                    row.append("")
                    continue
                text, conf = self._ocr_cell(image.crop((x0, y0, x1, y1)))
                row.append(text)
                if text:
                    confs.append(conf)
            grid.append(row)

        headers = grid[0]
        rows = grid[1:]
        bbox = (
            v_ranges[0][0], h_ranges[0][0],
            v_ranges[-1][1] - v_ranges[0][0],
            h_ranges[-1][1] - h_ranges[0][0],
        )
        confidence = sum(confs) / len(confs) if confs else 0.0
        # raw_text：表格的可读文本兜底
        raw_text = "\n".join("\t".join(r) for r in grid)
        return [RawBlock(
            type="table",
            bbox=bbox,
            raw_text=raw_text,
            confidence=confidence,
            payload={"headers": headers, "rows": rows},
        )]
