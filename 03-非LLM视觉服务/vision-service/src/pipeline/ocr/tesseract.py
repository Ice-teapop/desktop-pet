"""Tesseract OCR 引擎。

依赖：系统需安装 tesseract-ocr 二进制 + 对应语言包；Python 端 pytesseract。
读中文需安装 tesseract-ocr-chi-sim，并把 config 的 ocr.lang 设为 "chi_sim+eng"。
"""
from __future__ import annotations

from typing import Optional

from PIL import Image

from ...log import get_logger
from .base import OcrEngine, OcrLine

logger = get_logger("ocr.tesseract")


class TesseractEngine(OcrEngine):
    name = "tesseract"

    def __init__(self, lang: str = "eng"):
        self.lang = lang
        self._available: Optional[bool] = None   # 可用性缓存：进程生命周期内不变
        # 延迟导入：缺 pytesseract 时不至于在 import 阶段就炸
        try:
            import pytesseract
            self._pt = pytesseract
        except ImportError:
            self._pt = None

    def available(self) -> bool:
        # available() 会 shell out 跑 tesseract 子进程，结果进程内不变 —— 缓存
        if self._available is None:
            self._available = self._check_available()
        return self._available

    def _check_available(self) -> bool:
        if self._pt is None:
            return False
        try:
            self._pt.get_tesseract_version()
        except Exception:  # noqa: BLE001  二进制缺失等
            return False
        # 检查配置的语言（如 "chi_sim+eng"）是否都已安装
        try:
            installed = set(self._pt.get_languages(config=""))
        except Exception:  # noqa: BLE001
            return True  # 拿不到语言列表就不拦，交给识别时再暴露
        wanted = {part for part in self.lang.split("+") if part}
        missing = wanted - installed
        if missing:
            logger.warning(
                "tesseract 缺少语言包: %s（已安装: %s）", missing, sorted(installed)
            )
            return False
        return True

    def recognize_lines(self, image: Image.Image) -> list[OcrLine]:
        pt = self._pt
        if pt is None:
            return []
        data = pt.image_to_data(
            image, lang=self.lang, output_type=pt.Output.DICT
        )
        # 按 (block_num, par_num, line_num) 把词聚成行
        grouped: dict[tuple, dict] = {}
        for i in range(len(data["text"])):
            word = data["text"][i].strip()
            if not word:
                continue
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < 0:                # tesseract 用 -1 表示非文本
                continue
            key = (
                data["block_num"][i], data["par_num"][i], data["line_num"][i],
            )
            entry = grouped.setdefault(key, {"words": [], "confs": [], "boxes": []})
            entry["words"].append(word)
            entry["confs"].append(conf)
            entry["boxes"].append((
                data["left"][i], data["top"][i],
                data["width"][i], data["height"][i],
            ))

        lines: list[OcrLine] = []
        for key in sorted(grouped.keys()):
            entry = grouped[key]
            boxes = entry["boxes"]
            x = min(b[0] for b in boxes)
            y = min(b[1] for b in boxes)
            x2 = max(b[0] + b[2] for b in boxes)
            y2 = max(b[1] + b[3] for b in boxes)
            conf = sum(entry["confs"]) / len(entry["confs"]) / 100.0
            # 注意：中文场景下用空格连接词段并不理想，后续步骤再细化
            lines.append(OcrLine(
                text=" ".join(entry["words"]),
                bbox=(x, y, x2 - x, y2 - y),
                confidence=conf,
            ))
        return lines
