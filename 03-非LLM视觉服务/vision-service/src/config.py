"""
配置加载。读取 config/config.yaml，bearer_token 可被环境变量
DESKPET_VISION_TOKEN 覆盖（部署时推荐这样做，避免明文 token 进版本库）。
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "config.yaml"

# config.yaml 里的占位 token —— 用它启动视为不安全配置
_DEFAULT_TOKEN_PLACEHOLDER = "change-me-please"


class Config:
    def __init__(self, data: dict):
        self._d = data

    @property
    def pipeline_version(self) -> str:
        return self._d["service"]["pipeline_version"]

    @property
    def host(self) -> str:
        return self._d["service"]["host"]

    @property
    def port(self) -> int:
        return int(self._d["service"]["port"])

    @property
    def bearer_token(self) -> str:
        # 环境变量优先
        return os.environ.get("DESKPET_VISION_TOKEN") or self._d["auth"]["bearer_token"]

    @property
    def max_image_bytes(self) -> int:
        return int(self._d["limits"]["max_image_bytes"])

    @property
    def max_image_pixels(self) -> int:
        return int(self._d["limits"]["max_image_pixels"])

    @property
    def rate_per_min(self) -> int:
        return int(self._d["limits"]["rate_per_min"])

    @property
    def log_level(self) -> str:
        return str(self._d.get("logging", {}).get("level", "INFO"))

    @property
    def max_blocks(self) -> int:
        return int(self._d["limits"]["max_blocks"])

    @property
    def recognizers(self) -> list[str]:
        return list(self._d["recognizers"]["enabled"])

    @property
    def targets(self) -> dict[str, str]:
        return dict(self._d["targets"])

    @property
    def ocr_engine(self) -> str:
        return str(self._d.get("ocr", {}).get("engine", "tesseract"))

    @property
    def ocr_lang(self) -> str:
        return str(self._d.get("ocr", {}).get("lang", "eng"))

    @property
    def ocr_low_confidence(self) -> float:
        return float(self._d.get("ocr", {}).get("low_confidence", 0.5))

    @property
    def layout_binarize_threshold(self) -> int:
        return int(self._d.get("layout", {}).get("binarize_threshold", 160))

    @property
    def layout_min_gap_rows(self) -> int:
        return int(self._d.get("layout", {}).get("min_gap_rows", 8))

    @property
    def layout_min_content_pixels(self) -> int:
        return int(self._d.get("layout", {}).get("min_content_pixels", 3))

    @property
    def layout_region_padding(self) -> int:
        return int(self._d.get("layout", {}).get("region_padding", 16))

    @property
    def layout_max_regions(self) -> int:
        return int(self._d.get("layout", {}).get("max_regions", 200))

    @property
    def layout_block_gap_factor(self) -> float:
        return float(self._d.get("layout", {}).get("block_gap_factor", 1.0))

    @property
    def table_line_ratio(self) -> float:
        return float(self._d.get("table", {}).get("line_ratio", 0.7))

    @property
    def table_max_cells(self) -> int:
        return int(self._d.get("table", {}).get("max_cells", 200))

    @property
    def table_cell_inset(self) -> int:
        return int(self._d.get("table", {}).get("cell_inset", 2))

    @property
    def formula_engine(self) -> str:
        return str(self._d.get("formula", {}).get("engine", "pix2tex"))

    @property
    def formula_nominal_confidence(self) -> float:
        return float(self._d.get("formula", {}).get("nominal_confidence", 0.6))


def load_config(path: Path = _CONFIG_PATH) -> Config:
    with open(path, "r", encoding="utf-8") as f:
        return Config(yaml.safe_load(f))


def assert_secure_config(cfg: Config) -> None:
    """启动前安全自检：拒绝以默认占位 token 运行。

    由 main.py 的 lifespan 在服务启动时调用 —— 用 `uvicorn src.main:app`
    或 `python -m src.main` 启动都会触发；用裸 TestClient(app) 不触发，
    所以单元测试不受影响。
    """
    if cfg.bearer_token == _DEFAULT_TOKEN_PLACEHOLDER:
        raise RuntimeError(
            "拒绝以默认占位 token 启动。请设置环境变量 DESKPET_VISION_TOKEN，"
            "或修改 config/config.yaml 的 auth.bearer_token。"
        )


# 模块级单例
config = load_config()
