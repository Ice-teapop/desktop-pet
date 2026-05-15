"""公式识别引擎抽象。把图像里的数学公式转成 LaTeX。可插拔。"""
from __future__ import annotations

from abc import ABC, abstractmethod

from PIL import Image


class FormulaEngine(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool:
        """引擎是否可用（依赖是否就绪）。"""

    @abstractmethod
    def to_latex(self, image: Image.Image) -> str:
        """把公式图像转成 LaTeX 字符串；失败 / 空返回 ""。"""

    def warmup(self) -> None:
        """启动时预加载模型/依赖。默认 no-op；子类可覆写。

        作用：把首请求才会触发的重加载（如 pix2tex 下载/装载权重）提到 lifespan 阶段，
        避免第一个公式请求阻塞超过客户端 10s 超时。预热失败应让 available() 返 False。
        """
        return None
