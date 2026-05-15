"""
日志配置。

纪律（呼应「不留存」铁律）：
  只记不含画面内容的指标 —— region_id、frame_seq、延迟、区块数、错误码。
  绝不记录图像字节、像素、raw_text / encoded 等可能含屏幕内容的数据。
"""
from __future__ import annotations

import logging
import sys

_ROOT_NAME = "deskpet.vision"
_configured = False


def setup_logging(level: str = "INFO") -> None:
    """配置一次根 logger；重复调用幂等。"""
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger(_ROOT_NAME)
    root.setLevel(level.upper())
    root.addHandler(handler)
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"{_ROOT_NAME}.{name}")
