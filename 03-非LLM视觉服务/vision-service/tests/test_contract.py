"""
接口契约骨架测试（步骤 1）。

验证三个接口在骨架阶段就符合《视觉服务接口契约 API v1》的结构。
运行（在 vision-service/ 目录下）： pytest -q

M4-A-1 之后 /v1/extract 用 raw-bytes 模式：image 走 body，metadata 走
X-DeskPet-Meta header（base64(JSON)）—— 避免 multipart UploadFile 在大请求
时 spool 到 /tmp 临时文件，守「截屏字节不落盘」纪律。
"""
from __future__ import annotations

import base64
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.config import Config, assert_secure_config, config
from src.main import app

client = TestClient(app)
AUTH = {
    "Authorization": f"Bearer {config.bearer_token}",
    "X-DeskPet-Client": "deskpet-test/0.1.0",
}


def _png_bytes(w: int = 64, h: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _png_with_text(text: str = "Hello DeskPet 123", w: int = 420, h: int = 90) -> bytes:
    from PIL import ImageDraw

    buf = io.BytesIO()
    img = Image.new("RGB", (w, h), (255, 255, 255))
    ImageDraw.Draw(img).text((14, 32), text, fill=(0, 0, 0))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _meta(**over) -> str:
    base = {
        "region_id": "region_1",
        "frame_seq": 1,
        "captured_at": "2026-05-15T06:30:00Z",
        "region_size": {"w": 64, "h": 32},
        "content_hash": "p:test",
    }
    base.update(over)
    return json.dumps(base)


def _b64meta(meta_json: str) -> str:
    """metadata JSON → base64 ASCII 字符串（X-DeskPet-Meta 头部用）。"""
    return base64.b64encode(meta_json.encode("utf-8")).decode("ascii")


def _post_extract(
    image_bytes: bytes | None = None,
    meta: str | None = None,
    *,
    headers: dict | None = None,
):
    """发 POST /v1/extract raw-bytes 请求。

    默认带 AUTH + 默认 meta；可通过 headers 覆盖任意头或传 None 删除。
    image_bytes=None 表示空请求体（用于测 INVALID_IMAGE/empty 路径）。
    """
    base = {**AUTH, "X-DeskPet-Meta": _b64meta(meta or _meta())}
    if headers:
        for k, v in headers.items():
            if v is None:
                base.pop(k, None)
            else:
                base[k] = v
    return client.post("/v1/extract", headers=base, content=image_bytes or b"")


def test_health():
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "pipeline_version" in body


def test_capabilities_requires_auth():
    assert client.get("/v1/capabilities").status_code == 401


def test_capabilities_shape():
    r = client.get("/v1/capabilities", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    for k in ("pipeline_version", "recognizers", "targets", "max_image_bytes", "limits"):
        assert k in body
    assert body["targets"]["formula"] == "latex"
    assert body["targets"]["table"] == "table-json"


def test_extract_ok():
    r = _post_extract(_png_bytes())
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["region_id"] == "region_1"
    assert body["frame_seq"] == 1
    assert isinstance(body["blocks"], list) and len(body["blocks"]) >= 1
    block = body["blocks"][0]
    for k in ("id", "type", "order", "bbox", "confidence"):
        assert k in block
    assert "meta" in body and "pipeline_version" in body["meta"]


def test_extract_rejects_bad_token():
    r = _post_extract(_png_bytes(), headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_extract_rejects_missing_client_header():
    r = _post_extract(_png_bytes(), headers={"X-DeskPet-Client": None})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_extract_rejects_bad_image():
    r = _post_extract(b"not-an-image")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_IMAGE"


def test_extract_rejects_empty_body():
    """空 body → INVALID_IMAGE/empty image（raw-bytes 模式特有路径）。"""
    r = _post_extract(b"")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_IMAGE"


def test_extract_rejects_missing_meta_header():
    """X-DeskPet-Meta 必填，缺失 → INVALID_REQUEST。"""
    r = _post_extract(_png_bytes(), headers={"X-DeskPet-Meta": None})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_extract_rejects_bad_meta_base64():
    """X-DeskPet-Meta 不是合法 base64 → INVALID_REQUEST。"""
    r = _post_extract(
        _png_bytes(),
        headers={"X-DeskPet-Meta": "!!! not base64 !!!"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_extract_rejects_bad_metadata():
    """base64 合法但解码后不是合法 JSON → INVALID_REQUEST。"""
    r = _post_extract(
        _png_bytes(),
        headers={"X-DeskPet-Meta": _b64meta("{ not valid json")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_assert_secure_config_rejects_default_token(monkeypatch):
    """启动安全自检：用默认占位 token 必须拒绝启动，换成真实 token 才放行。"""
    monkeypatch.delenv("DESKPET_VISION_TOKEN", raising=False)
    base = {
        "service": {"pipeline_version": "t", "host": "0.0.0.0", "port": 1},
        "limits": {
            "max_image_bytes": 1, "max_image_pixels": 1,
            "rate_per_min": 1, "max_blocks": 1,
        },
        "recognizers": {"enabled": []},
        "targets": {},
    }

    insecure = Config({**base, "auth": {"bearer_token": "change-me-please"}})
    with pytest.raises(RuntimeError):
        assert_secure_config(insecure)

    secure = Config({**base, "auth": {"bearer_token": "a-real-secret"}})
    assert_secure_config(secure)  # 不应抛异常


def test_extract_include_reading_text_false():
    """options.include_reading_text=false 时 reading_text 应为空串。"""
    r = _post_extract(_png_bytes(), _meta(options={"include_reading_text": False}))
    assert r.status_code == 200
    assert r.json()["reading_text"] == ""


def test_extract_rejects_oversize_pixels(monkeypatch):
    """像素数超过 max_image_pixels 时返回 IMAGE_TOO_LARGE（防解压炸弹）。"""
    # 把像素上限临时调到极小值，64x32=2048 像素即超限
    monkeypatch.setitem(config._d["limits"], "max_image_pixels", 100)
    r = _post_extract(_png_bytes(64, 32))
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "IMAGE_TOO_LARGE"


def test_rate_limiter_unit():
    """限流器：超过 max_per_min 后拒绝，并给出 Retry-After；不同 key 独立计数。"""
    from src.api.ratelimit import RateLimiter

    rl = RateLimiter(max_per_min=2)
    ok1, _ = rl.check("k")
    ok2, _ = rl.check("k")
    ok3, retry = rl.check("k")
    assert ok1 and ok2
    assert not ok3 and retry >= 1
    ok_other, _ = rl.check("other-key")
    assert ok_other  # 不同 key 不受影响


# ---------- M4-A-1：pet_bbox 桌宠 echo 防御 ----------

def test_pet_bbox_masks_pet_region():
    """pet_bbox：服务端应在 OCR 前把桌宠区域涂白，避免桌宠形象 echo 进文本。

    构造：左半边写文字（OCR 应识别），右半边画"假桌宠"（深色色块）；
    送 pet_bbox 覆盖右半区域 —— 期待结果不含右半区造成的乱码 OCR。
    本测试只验证不报错且能跑通 raw-bytes 路径；具体 OCR 内容由
    test_extract_reads_text 兜底。
    """
    from PIL import ImageDraw

    buf = io.BytesIO()
    img = Image.new("RGB", (420, 90), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((14, 32), "Real text here", fill=(0, 0, 0))
    # 右半边画深色色块模拟桌宠像素
    d.rectangle([260, 10, 410, 80], fill=(40, 30, 20))
    img.save(buf, format="PNG")

    meta = _meta(
        region_size={"w": 420, "h": 90},
        pet_bbox={"x": 260, "y": 10, "w": 150, "h": 70},
    )
    r = _post_extract(buf.getvalue(), meta)
    assert r.status_code == 200, r.json()


def test_pet_bbox_invalid_rejected():
    """pet_bbox 字段缺尺寸 → metadata 校验失败 → INVALID_REQUEST。"""
    r = _post_extract(
        _png_bytes(),
        _meta(pet_bbox={"x": 0, "y": 0, "w": 0, "h": 10}),  # w=0 违反 gt=0
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_mask_pet_region_exact_pixel_count():
    """_mask_pet_region：精确涂 w×h 像素（end-exclusive 语义），不多不少 1 像素。

    PIL ImageDraw.rectangle 是 end-inclusive，需要 x+w-1/y+h-1 才能涂出 w×h。
    构造黑底图 + bbox(10,10,5,5)：(10,10)..(14,14) 应全白（255），(15,10) 与
    (10,15) 应仍为黑（0）。
    """
    from src.pipeline.pipeline import _mask_pet_region
    from src.schema.contract import PetBbox

    img = Image.new("L", (30, 30), 0)
    out = _mask_pet_region(img, PetBbox(x=10, y=10, w=5, h=5))

    # 涂白区域 5x5：左上 (10,10) ~ 右下 (14,14) 都应是 255
    for x in range(10, 15):
        for y in range(10, 15):
            assert out.getpixel((x, y)) == 255, f"({x},{y}) 应被涂白"
    # 边界外像素仍为黑（关键断言：不能多涂 1 行 1 列）
    assert out.getpixel((15, 12)) == 0, "(15,12) 在 bbox 之外，不应被涂白"
    assert out.getpixel((12, 15)) == 0, "(12,15) 在 bbox 之外，不应被涂白"
    assert out.getpixel((15, 15)) == 0, "(15,15) 在 bbox 之外，不应被涂白"


def test_mask_pet_region_handles_palette_mode():
    """_mask_pet_region：P (palette) 模式不应崩 —— 先 convert 兜底再涂。

    P 模式直接传 (255,255,255) tuple 给 ImageDraw.rectangle 会 raise；
    fix 后应 convert 成 RGB 再涂白。
    """
    from src.pipeline.pipeline import _mask_pet_region
    from src.schema.contract import PetBbox

    # 构造 P 模式图（palette index 0 = 黑）
    img = Image.new("P", (30, 30), 0)
    out = _mask_pet_region(img, PetBbox(x=5, y=5, w=10, h=10))

    # convert 后 mode 是 RGB，涂白区域应是 (255,255,255)
    assert out.mode == "RGB"
    assert out.getpixel((10, 10)) == (255, 255, 255)
    # 边界外是 palette index 0 对应的 RGB 值（通常黑）
    assert out.getpixel((20, 20)) != (255, 255, 255)


def test_mask_pet_region_rgba_keeps_alpha_opaque():
    """_mask_pet_region：RGBA 模式涂白时 alpha 应保持 255（不透明白）。"""
    from src.pipeline.pipeline import _mask_pet_region
    from src.schema.contract import PetBbox

    img = Image.new("RGBA", (20, 20), (0, 0, 0, 255))
    out = _mask_pet_region(img, PetBbox(x=2, y=2, w=4, h=4))
    assert out.getpixel((3, 3)) == (255, 255, 255, 255)


# ---------- 步骤 2：预处理 + 文本 OCR + 文本转码 ----------

def test_preprocess_upscales_small_image():
    """预处理：小图转灰度并放大，记录 scale 与原图尺寸。"""
    from src.pipeline.preprocess import preprocess

    pre = preprocess(Image.new("RGB", (200, 100), (255, 255, 255)))
    assert pre.image.mode == "L"
    assert pre.scale > 1.0
    assert pre.image.width >= 1000
    assert pre.orig_size == (200, 100)


def test_text_transcoder_marks_low_confidence():
    """文本转码：encoded == raw_text；低置信度打 low_confidence 标记。"""
    from src.pipeline.recognizers.base import RawBlock
    from src.pipeline.transcoders.text import TextTranscoder

    tc = TextTranscoder()
    hi = tc.transcode(RawBlock("text", (1, 2, 3, 4), "hello", 0.95), "b1", 1)
    lo = tc.transcode(RawBlock("text", (1, 2, 3, 4), "hmm", 0.10), "b2", 2)

    assert hi.target == "text" and hi.encoded == "hello" and hi.notes is None
    assert lo.notes == "low_confidence" and lo.raw_text == "hmm"


def test_extract_reads_text():
    """有文字的图应被识别成 text 区块（OCR 引擎不可用则跳过）。"""
    from src.pipeline.ocr import get_ocr_engine

    if not get_ocr_engine().available():
        pytest.skip("OCR 引擎不可用，跳过文本识别测试")

    r = _post_extract(_png_with_text(), _meta(region_size={"w": 420, "h": 90}))
    assert r.status_code == 200
    body = r.json()
    text_blocks = [b for b in body["blocks"] if b["type"] == "text"]
    assert text_blocks, f"未识别出文本块: {body['blocks']}"

    tb = text_blocks[0]
    assert tb["target"] == "text"
    assert tb["encoded"] == tb["raw_text"]
    assert tb["raw_text"].strip() != ""
    assert len(tb["bbox"]) == 4
    assert body["reading_text"].strip() != ""
    assert "text" in body["meta"]["recognizers_used"]


# ---------- 步骤 3：版面分析 + 区块分派 + 结构化合并 ----------

def test_layout_segments_separated_regions():
    """版面分析：被大段空白隔开的两块内容应切成至少两个区域，阅读顺序递增。"""
    from src.pipeline.layout import ProjectionLayoutAnalyzer

    img = Image.new("L", (300, 300), 255)
    # 顶部一条暗带、底部一条暗带，中间留大段空白
    for y in list(range(20, 35)) + list(range(250, 265)):
        for x in range(20, 280):
            img.putpixel((x, y), 0)

    analyzer = ProjectionLayoutAnalyzer(min_gap_rows=8, min_content_pixels=3)
    regions = analyzer.analyze(img)
    assert len(regions) >= 2
    assert [r.order for r in regions] == sorted(r.order for r in regions)
    assert all(r.type == "text" for r in regions)


def test_layout_blank_image_has_no_region():
    """版面分析：纯空白图不应切出任何区域。"""
    from src.pipeline.layout import ProjectionLayoutAnalyzer

    regions = ProjectionLayoutAnalyzer().analyze(Image.new("L", (200, 200), 255))
    assert regions == []


def test_layout_caps_region_count():
    """版面分析：区域数量封顶 —— 防止被构造的图打出大量 OCR 子进程。"""
    from src.pipeline.layout import ProjectionLayoutAnalyzer

    # 画很多条明显分开的暗带（4px 内容 + 40px 空白），约 18 条
    img = Image.new("L", (100, 800), 255)
    for i in range(18):
        top = i * 44
        for y in range(top, top + 4):
            for x in range(10, 90):
                img.putpixel((x, y), 0)

    analyzer = ProjectionLayoutAnalyzer(
        min_gap_rows=8, min_content_pixels=3, max_regions=5
    )
    regions = analyzer.analyze(img)
    assert len(regions) == 5   # 被 max_regions 封顶


def test_layout_keeps_close_lines_together():
    """版面分析：行间距小（如代码块/段落内的行）不应被拆成多个区域。"""
    from src.pipeline.layout import ProjectionLayoutAnalyzer

    # 5 行紧挨着的暗带（每行 6px 内容 + 6px 间距），间距 < 行高
    img = Image.new("L", (200, 200), 255)
    for i in range(5):
        top = 20 + i * 12
        for y in range(top, top + 6):
            for x in range(20, 180):
                img.putpixel((x, y), 0)

    regions = ProjectionLayoutAnalyzer(min_gap_rows=8).analyze(img)
    assert len(regions) == 1   # 紧挨的行聚成一个区域，不拆碎


def test_ocr_available_is_cached():
    """OCR 引擎可用性探测会 shell out 子进程，结果应被缓存（进程内不变）。"""
    from src.pipeline.ocr.tesseract import TesseractEngine

    eng = TesseractEngine(lang="eng")
    assert eng._available is None          # 尚未探测
    result = eng.available()
    assert eng._available is result        # 已缓存
    assert eng.available() is result       # 再次调用复用缓存


# ---------- 步骤 4a：代码识别器 ----------

def test_classify_detects_code():
    """轻量分类：代码文本判为 code，普通文字判为 text。"""
    from src.pipeline.classify import classify_region
    from src.pipeline.recognizers.base import RawBlock

    def _rb(t):
        return RawBlock("text", (0, 0, 1, 1), t, 0.9)

    code = [_rb("def add(a, b):"), _rb("return a + b"), _rb("def mul(x, y):")]
    prose = [_rb("The quick brown fox jumps"), _rb("over the lazy dog every day")]
    assert classify_region(code) == "code"
    assert classify_region(prose) == "text"


def test_detect_language():
    """语言判断：尽力而为，认不出返回 plain。"""
    from src.pipeline.recognizers.code import detect_language

    assert detect_language("def foo():\n    return 1") == "python"
    assert detect_language("const x = () => 1") == "javascript"
    assert detect_language("#include <stdio.h>") == "c"
    assert detect_language("just some plain words here") == "plain"


def test_code_recognizer_reconstructs_indentation():
    """代码识别器：用行首 x 位置重建缩进（用假引擎，不依赖 tesseract）。"""
    from src.pipeline.ocr.base import OcrEngine, OcrLine
    from src.pipeline.recognizers.code import CodeRecognizer

    class _FakeEngine(OcrEngine):
        name = "fake"

        def available(self):
            return True

        def recognize_lines(self, image):
            return [
                OcrLine("def foo():", (10, 0, 100, 12), 0.9),
                OcrLine("return 1", (50, 20, 80, 12), 0.9),
            ]

    blocks = CodeRecognizer(_FakeEngine()).recognize(Image.new("L", (200, 50), 255))
    assert len(blocks) == 1
    rb = blocks[0]
    assert rb.type == "code"
    code_lines = rb.raw_text.split("\n")
    assert code_lines[0] == "def foo():"
    assert code_lines[1].startswith("    ")     # 第二行重建出缩进
    assert rb.payload["lang"] == "python"


def test_code_transcoder_builds_encoded():
    """代码转码器：encoded = {lang, text}，target = code。"""
    from src.pipeline.recognizers.base import RawBlock
    from src.pipeline.transcoders.code import CodeTranscoder

    raw = RawBlock("code", (1, 2, 30, 40), "def f():\n    pass", 0.9,
                   payload={"lang": "python"})
    block = CodeTranscoder().transcode(raw, "b1", 1)
    assert block.type == "code"
    assert block.target == "code"
    assert block.encoded == {"lang": "python", "text": "def f():\n    pass"}
    assert block.raw_text == "def f():\n    pass"


def test_extract_code_region():
    """端到端：代码截图应被识别成 code 区块（OCR 不可用则跳过）。"""
    from PIL import ImageDraw

    from src.pipeline.ocr import get_ocr_engine

    if not get_ocr_engine().available():
        pytest.skip("OCR 引擎不可用，跳过")

    code = ("def add(a, b):\n    return a + b\n"
            "def mul(a, b):\n    return a * b\n"
            "def sub(a, b):\n    return a - b")
    buf = io.BytesIO()
    img = Image.new("RGB", (420, 200), (255, 255, 255))
    ImageDraw.Draw(img).text((12, 12), code, fill=(0, 0, 0))
    img.save(buf, format="PNG")

    r = _post_extract(buf.getvalue(), _meta(region_size={"w": 420, "h": 200}))
    assert r.status_code == 200
    body = r.json()
    code_blocks = [b for b in body["blocks"] if b["type"] == "code"]
    assert code_blocks, f"未识别出 code 区块: {body['blocks']}"
    cb = code_blocks[0]
    assert cb["target"] == "code"
    assert isinstance(cb["encoded"], dict)
    assert "lang" in cb["encoded"] and "text" in cb["encoded"]
    assert "\n" in cb["encoded"]["text"], f"代码块应为多行: {cb['encoded']}"
    assert "code" in body["meta"]["recognizers_used"]


# ---------- 步骤 4b：表格识别器 ----------

def _grid_image(mode="L", line_fill=0, bg=255):
    """画一个 2x2 的网格（3 横线 3 竖线），200x150。"""
    from PIL import ImageDraw

    img = Image.new(mode, (200, 150), bg)
    d = ImageDraw.Draw(img)
    for y in (10, 70, 130):
        d.line([(10, y), (190, y)], fill=line_fill, width=2)
    for x in (10, 100, 190):
        d.line([(x, 10), (x, 130)], fill=line_fill, width=2)
    return img


def test_find_grid_lines_detects_grid():
    """网格线检测：画出来的网格应找到 >=2 横线和 >=2 竖线。"""
    from src.pipeline.grid import find_grid_lines

    h_lines, v_lines = find_grid_lines(_grid_image(), line_ratio=0.6)
    assert len(h_lines) >= 2
    assert len(v_lines) >= 2


def test_find_grid_lines_ignores_text():
    """网格线检测：普通文字不会被误判为网格线。"""
    from PIL import ImageDraw

    from src.pipeline.grid import find_grid_lines

    img = Image.new("L", (200, 100), 255)
    ImageDraw.Draw(img).text((10, 40), "just some normal text here", fill=0)
    h_lines, _ = find_grid_lines(img)
    assert len(h_lines) < 2


def test_layout_tags_table_region():
    """版面分析：带网格线的区域应被标为 table。"""
    from src.pipeline.layout import ProjectionLayoutAnalyzer

    regions = ProjectionLayoutAnalyzer().analyze(_grid_image())
    assert any(r.type == "table" for r in regions)


def test_table_transcoder_builds_encoded():
    """表格转码器：encoded = {headers, rows}，target = table-json。"""
    from src.pipeline.recognizers.base import RawBlock
    from src.pipeline.transcoders.table import TableTranscoder

    raw = RawBlock("table", (0, 0, 100, 60), "Name\tAge\nBob\t30", 0.8,
                   payload={"headers": ["Name", "Age"], "rows": [["Bob", "30"]]})
    block = TableTranscoder().transcode(raw, "b1", 1)
    assert block.type == "table"
    assert block.target == "table-json"
    assert block.encoded == {"headers": ["Name", "Age"], "rows": [["Bob", "30"]]}


def test_extract_table_region():
    """端到端：有边框的表格应被识别成 table 区块（OCR 不可用则跳过）。"""
    from PIL import ImageDraw

    from src.pipeline.ocr import get_ocr_engine

    if not get_ocr_engine().available():
        pytest.skip("OCR 引擎不可用，跳过")

    img = Image.new("RGB", (320, 170), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for y in (20, 90, 150):
        d.line([(20, y), (300, y)], fill=(0, 0, 0), width=2)
    for x in (20, 160, 300):
        d.line([(x, 20), (x, 150)], fill=(0, 0, 0), width=2)
    d.text((35, 45), "Name", fill=(0, 0, 0))
    d.text((175, 45), "Age", fill=(0, 0, 0))
    d.text((35, 110), "Bob", fill=(0, 0, 0))
    d.text((175, 110), "30", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    r = _post_extract(buf.getvalue(), _meta(region_size={"w": 320, "h": 170}))
    assert r.status_code == 200
    body = r.json()
    table_blocks = [b for b in body["blocks"] if b["type"] == "table"]
    assert table_blocks, f"未识别出 table 区块: {body['blocks']}"
    tb = table_blocks[0]
    assert tb["target"] == "table-json"
    assert isinstance(tb["encoded"], dict)
    assert isinstance(tb["encoded"].get("headers"), list)
    assert isinstance(tb["encoded"].get("rows"), list)
    assert "table" in body["meta"]["recognizers_used"]


# ---------- 步骤 4c：公式识别器 ----------

class _FakeFormulaEngine:
    """测试用假公式引擎（避开 pix2tex 重依赖）。"""

    name = "fake"

    def __init__(self, available=True, latex="\\frac{1}{2}"):
        self._available = available
        self._latex = latex

    def available(self):
        return self._available

    def to_latex(self, image):
        return self._latex


def test_classify_detects_formula():
    """轻量分类：含数学符号的内容判为 formula。"""
    from src.pipeline.classify import classify_region
    from src.pipeline.recognizers.base import RawBlock

    def _rb(t):
        return RawBlock("text", (0, 0, 1, 1), t, 0.9)

    formula = [_rb("∫ f(x) dx ≈ ∑ α"), _rb("π ≤ θ")]
    prose = [_rb("The quick brown fox jumps"), _rb("over the lazy dog every day")]
    assert classify_region(formula) == "formula"
    assert classify_region(prose) == "text"


def test_formula_recognizer_with_fake_engine():
    """公式识别器：引擎可用时产出 formula RawBlock，payload 带 latex。
    raw_text 留空：pix2tex 不做 OCR，无「近似线性文本」可用（契约 5.3）。"""
    from src.pipeline.recognizers.formula import FormulaRecognizer

    rec = FormulaRecognizer(_FakeFormulaEngine(latex="\\sum_{i=1}^{n} i"))
    blocks = rec.recognize(Image.new("L", (120, 40), 255))
    assert len(blocks) == 1
    rb = blocks[0]
    assert rb.type == "formula"
    assert rb.payload["latex"] == "\\sum_{i=1}^{n} i"
    assert rb.raw_text == ""


def test_formula_recognizer_degrades_when_unavailable():
    """公式识别器：引擎不可用时返回空 → dispatch 会优雅降级回文本。"""
    from src.pipeline.recognizers.formula import FormulaRecognizer

    rec = FormulaRecognizer(_FakeFormulaEngine(available=False))
    assert rec.recognize(Image.new("L", (120, 40), 255)) == []


def test_formula_transcoder_builds_encoded():
    """公式转码器：encoded 是 LaTeX 字符串（不是对象），target = latex。
    raw_text 必须为空、notes 必须含 latex_only —— 标记本块无近似 OCR 文本兜底。"""
    from src.pipeline.recognizers.base import RawBlock
    from src.pipeline.transcoders.formula import FormulaTranscoder

    raw = RawBlock("formula", (0, 0, 80, 30), "", 0.6,
                   payload={"latex": "\\frac{1}{2}"})
    block = FormulaTranscoder().transcode(raw, "b1", 1)
    assert block.type == "formula"
    assert block.target == "latex"
    assert block.encoded == "\\frac{1}{2}"     # 字符串，不是对象
    assert block.raw_text == ""                # 守住契约 raw_text 语义
    assert "latex_only" in (block.notes or "")


def test_extract_formula_degrades_to_text(monkeypatch):
    """端到端：区域被判为 formula 但公式引擎不可用时，应优雅降级为文本块。

    沙箱内 pix2tex 未安装，正是这个降级场景；若引擎可用则跳过。
    """
    from src.pipeline.formula import get_formula_engine
    from src.pipeline.ocr import get_ocr_engine

    if not get_ocr_engine().available():
        pytest.skip("OCR 引擎不可用，跳过")
    if get_formula_engine().available():
        pytest.skip("公式引擎可用，本测试只验证降级场景")

    # 强制把区域判为 formula
    monkeypatch.setattr(
        "src.pipeline.dispatch.classify_region", lambda rb: "formula"
    )

    r = _post_extract(_png_with_text(), _meta(region_size={"w": 420, "h": 90}))
    assert r.status_code == 200
    body = r.json()
    # 公式引擎不可用 → 不应产出 formula 块，而是降级为 text
    text_blocks = [b for b in body["blocks"] if b["type"] == "text"]
    assert text_blocks, f"应降级为文本块: {body['blocks']}"
    assert "formula" not in body["meta"]["recognizers_used"]


def test_registry_register_and_get():
    """注册表：text / code / table / formula 已注册；未注册类型返回 None。"""
    from src.pipeline.ocr import get_ocr_engine
    from src.pipeline.registry import build_default_registry

    reg = build_default_registry(get_ocr_engine())
    entry = reg.get("text")
    assert entry is not None
    recognizer, _transcoder = entry
    assert recognizer.block_type == "text"
    assert reg.get("table") is not None
    assert reg.get("formula") is not None     # 步骤 4c 已注册
    assert reg.get("chart") is None           # chart 走直通，不注册识别器
    for t in ("text", "code", "table", "formula"):
        assert t in reg.types


def test_extract_segments_two_regions():
    """端到端：上下两段被空白隔开的文字应切成多个 text 区块（OCR 不可用则跳过）。"""
    from PIL import ImageDraw

    from src.pipeline.ocr import get_ocr_engine

    if not get_ocr_engine().available():
        pytest.skip("OCR 引擎不可用，跳过")

    buf = io.BytesIO()
    img = Image.new("RGB", (480, 320), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), "First line here", fill=(0, 0, 0))
    draw.text((20, 270), "Second line there", fill=(0, 0, 0))
    img.save(buf, format="PNG")

    r = _post_extract(buf.getvalue(), _meta(region_size={"w": 480, "h": 320}))
    assert r.status_code == 200
    body = r.json()
    text_blocks = [b for b in body["blocks"] if b["type"] == "text"]
    assert len(text_blocks) >= 2, f"应切出多个文本块: {body['blocks']}"
    assert "text" in body["meta"]["recognizers_used"]
    # 区块阅读顺序应连续递增
    orders = [b["order"] for b in body["blocks"]]
    assert orders == list(range(1, len(orders) + 1))


# ---------- 审查回归测试（修复 #1 #2 #3 #4） ----------

def test_classify_does_not_misclassify_code_with_few_math_symbols():
    """回归 #1：代码片段里含 ≥2 数学符号但数学密度低 → 不应判 formula。

    原 bug：classify 用 math_hits >= 2 + strong == 0 即判 formula，
    导致 `# Compute α ± β\nresult = x * y` 这类代码被误判，进 pix2tex
    把代码当公式产出错 latex。修复后引入 math_density >= 0.10 阈值。"""
    from src.pipeline.classify import classify_region
    from src.pipeline.recognizers.base import RawBlock

    def _rb(t):
        return RawBlock("text", (0, 0, 1, 1), t, 0.9)

    code_with_few_math = [
        _rb("# Compute angles: alpha α and beta β"),
        _rb("result = x * y + z + offset"),
        _rb("output_array = [i for i in range(n)]"),
    ]
    assert classify_region(code_with_few_math) != "formula"


def test_formula_warmup_failure_marks_unavailable(monkeypatch):
    """回归 #3 + #7：预热时 LatexOCR 抛异常 → available() 应转 False，
    避免后续每个公式请求都重抛同一个异常。"""
    import sys
    import types
    from src.pipeline.formula.pix2tex_engine import Pix2TexEngine

    class _BrokenModel:
        def __init__(self):
            raise RuntimeError("model weights corrupted")

    fake_cli = types.ModuleType("pix2tex.cli")
    fake_cli.LatexOCR = _BrokenModel
    fake_pix = types.ModuleType("pix2tex")
    fake_pix.cli = fake_cli
    monkeypatch.setitem(sys.modules, "pix2tex", fake_pix)
    monkeypatch.setitem(sys.modules, "pix2tex.cli", fake_cli)

    eng = Pix2TexEngine()
    assert eng.available() is True              # 导入成功
    eng.warmup()                                # 但模型加载失败
    assert eng.available() is False             # warmup 把它标 False
    assert eng._model is None


def test_pix2tex_ensure_model_is_thread_safe(monkeypatch):
    """回归 #4：并发首请求，_ensure_model 只能加载一次模型，不能因竞态
    各加载一份 ~1GB 模型导致 2GB 机器 OOM。双检锁（DCL）必须守住。"""
    import sys
    import time
    import types
    import threading
    from src.pipeline.formula.pix2tex_engine import Pix2TexEngine

    counter = {"n": 0}

    class _SlowFakeModel:
        def __init__(self):
            counter["n"] += 1
            # 模拟慢加载（让其它线程有机会同时撞 self._model is None 判断）
            time.sleep(0.05)

        def __call__(self, image):
            return ""

    fake_cli = types.ModuleType("pix2tex.cli")
    fake_cli.LatexOCR = _SlowFakeModel
    fake_pix = types.ModuleType("pix2tex")
    fake_pix.cli = fake_cli
    monkeypatch.setitem(sys.modules, "pix2tex", fake_pix)
    monkeypatch.setitem(sys.modules, "pix2tex.cli", fake_cli)

    eng = Pix2TexEngine()
    threads = [threading.Thread(target=eng._ensure_model) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert counter["n"] == 1, f"模型被加载 {counter['n']} 次，预期 1 次（DCL 失守）"
    assert eng._model is not None


def test_formula_warmup_on_unavailable_engine_is_noop():
    """warmup 在 available() 为 False 时应直接返回，不抛异常。
    （主链路：pix2tex 未装时 lifespan 调 warmup 不能让服务起不来）"""
    from src.pipeline.formula.base import FormulaEngine

    class _UnavailEngine(FormulaEngine):
        name = "unavail"

        def available(self):
            return False

        def to_latex(self, image):
            return ""

    _UnavailEngine().warmup()  # 不抛即通过
