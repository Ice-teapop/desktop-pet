"""
预处理：把原始图像归一化成更利于 OCR 的形式。

对应《非 LLM 视觉服务 — 框架设计》3.2。当前做：
  - 摆正方向（exif）
  - 转灰度
  - 自动对比度
  - 小图按比例放大（OCR 对小字偏弱）

记录 scale，供后续把识别坐标还原回原图坐标系。只用 PIL，不引入额外重依赖。
"""
from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageOps

# 宽度低于此值的图放大到此宽度
_MIN_OCR_WIDTH = 1000


@dataclass
class PreprocessedImage:
    image: Image.Image            # 处理后的灰度图
    scale: float                  # 处理图相对原图的缩放系数（>1 表示放大）
    orig_size: tuple[int, int]    # 原图 (w, h)


def preprocess(img: Image.Image) -> PreprocessedImage:
    orig_size = (img.width, img.height)
    work = ImageOps.exif_transpose(img)   # 摆正（截图通常无 exif，稳妥起见）
    work = work.convert("L")              # 灰度
    work = ImageOps.autocontrast(work)    # 自动对比度

    scale = 1.0
    if 0 < work.width < _MIN_OCR_WIDTH:
        scale = _MIN_OCR_WIDTH / work.width
        new_size = (round(work.width * scale), round(work.height * scale))
        work = work.resize(new_size, Image.Resampling.LANCZOS)

    return PreprocessedImage(image=work, scale=scale, orig_size=orig_size)
