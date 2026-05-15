"""
基于 pix2tex 的公式识别引擎（LaTeX-OCR）。

依赖：pix2tex（含 PyTorch，较重），装在用户自有服务器上。首次调用会下载模型权重。

注意：本文件的 pix2tex API 按官方用法编写，但因依赖过重未能在开发沙箱内安装实测，
需在部署服务器上验证（见 README / 进度日志）。pix2tex 不可用时整体优雅降级 ——
公式区域回退按文本处理，服务不受影响。
"""
from __future__ import annotations

import threading
from typing import Optional

from PIL import Image

from ...log import get_logger
from .base import FormulaEngine

logger = get_logger("formula.pix2tex")


class Pix2TexEngine(FormulaEngine):
    name = "pix2tex"

    def __init__(self):
        self._import_ok: Optional[bool] = None   # 缓存：pix2tex 是否可导入
        self._model = None                       # 延迟加载的模型
        # 模型加载临界区锁：FastAPI sync 路由跑在 threadpool，并发首请求
        # 可能两线程都看到 self._model is None，各加载一份 ~1GB 模型 → 2GB 机器 OOM。
        # 用双检锁（DCL）守住，正常路径几乎无开销。
        self._model_lock = threading.Lock()

    def available(self) -> bool:
        if self._import_ok is None:
            try:
                import pix2tex.cli  # noqa: F401
                self._import_ok = True
            except Exception:  # noqa: BLE001
                self._import_ok = False
                logger.warning("pix2tex 未安装，公式识别将优雅降级为文本")
        return self._import_ok

    def _ensure_model(self):
        # 双检锁：快路径无锁，仅首次加载时进入临界区
        if self._model is not None:
            return self._model
        with self._model_lock:
            if self._model is None:
                from pix2tex.cli import LatexOCR
                self._model = LatexOCR()   # 首次实例化会下载模型权重
        return self._model

    def warmup(self) -> None:
        """启动阶段预加载模型 —— 避免首请求阻塞客户端 10s 超时。

        失败（模型下载失败 / 磁盘满 / 权重损坏等）则把 _import_ok 强制改 False，
        让 available() 返 False，所有公式区域走优雅降级路径。
        """
        if not self.available():
            return
        try:
            self._ensure_model()
            logger.info("pix2tex 模型预热完成")
        except Exception as e:  # noqa: BLE001
            logger.warning("pix2tex 模型预热失败: %s（标记不可用，公式区域将降级为文本）", e)
            self._import_ok = False
            self._model = None

    def to_latex(self, image: Image.Image) -> str:
        try:
            latex = self._ensure_model()(image)
            return (latex or "").strip()
        except Exception as e:  # noqa: BLE001
            logger.warning("pix2tex 识别失败: %s", e)
            return ""
