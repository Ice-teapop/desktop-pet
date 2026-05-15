# DeskPet 非 LLM 视觉服务

跑在用户自有服务器上的视觉服务。桌宠客户端把用户划定区域的画面帧发过来，
本服务把画面提取成机器可理解的结构化表示再返回 —— 不含 LLM、不做推理，只做感知与提取。

详细设计见同目录的《非 LLM 视觉服务-框架设计》《视觉服务接口契约-API v1》两份文档。

## 当前进度：步骤 4c —— 公式识别器

已完成：
- 按《接口契约 API v1》立起三个接口：`GET /v1/health`、`GET /v1/capabilities`、`POST /v1/extract`
- 契约数据模型、Bearer Token 鉴权 + 启动安全自检、限流、请求体粗检、解压炸弹防护、结构化日志
- **预处理**（`pipeline/preprocess.py`）：灰度、自动对比度、小图放大
- **OCR 引擎**（`pipeline/ocr/`）：可插拔，已实现 Tesseract 引擎
- **版面分析**（`pipeline/layout.py`）：规则版，两段式自适应切分（先找行、再按行间距聚成区域）
- **注册表 + 区块分派**（`pipeline/registry.py`、`pipeline/dispatch.py`）：按区域类型路由到识别器，坐标还原 + 转码
- **结构化合并**（`pipeline/assembly.py`）：截断 + 阅读顺序 + reading_text
- **文本 / 代码 / 表格 / 公式识别器与转码器**（`pipeline/recognizers/`、`pipeline/transcoders/`）
- **轻量分类器**（`pipeline/classify.py`）：基于 OCR 文本内容判 text / code / formula
- **网格线检测**（`pipeline/grid.py`）：找水平/垂直长暗线，供表格检测与切单元格
- **可插拔公式引擎**（`pipeline/formula/`）：`FormulaEngine` 抽象 + `Pix2TexEngine`（→ LaTeX）
- 流水线 `pipeline/pipeline.py`：解码 → 预处理 → 版面分析（含 table 检测）→ 区块分派（含 text/code/formula 分类）→ 结构化合并；
  识别器不可用时优雅降级，服务不中断

**定位**：视觉服务只「提取直观信息」（文字 / 符号 / 代码 / 表格 / 公式 / …），不做「理解」—— 理解交给 LLM。

**说明**：
- 公式识别需在服务器安装 pix2tex（含 PyTorch，较重）；未装则公式区域优雅降级为文本。
  pix2tex 推理路径未在开发沙箱实测（依赖过重装不上），需在部署服务器验证。
- 表格只处理「有可见网格线」的；无边框表格交文本处理。
- 公式 / 代码的区域检测是规则启发式，召回率有限，不做假精度。

后续步骤：
- 步骤 5：置信度回退完善、可观测、资源隔离等非功能项

### OCR 依赖

文本识别依赖系统的 tesseract：

```bash
# Ubuntu/Debian
apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim
```

读中文必须装 `tesseract-ocr-chi-sim`，并把 `config/config.yaml` 的 `ocr.lang`
改为 `"chi_sim+eng"`。tesseract 不可用时服务不会崩，`/v1/extract` 会降级返回占位块。

## 目录结构

```
vision-service/
├── config/config.yaml      # 配置：token、限制、识别器、转码目标
├── src/
│   ├── main.py             # 应用入口 + 异常处理
│   ├── config.py           # 配置加载
│   ├── api/
│   │   ├── auth.py         # 鉴权 + 统一错误类型 ServiceError
│   │   └── routes.py       # 三个接口的实现
│   ├── schema/contract.py  # 接口契约数据模型（单一事实来源）
│   └── pipeline/pipeline.py# 处理流水线（当前为骨架）
├── tests/test_contract.py  # 契约骨架测试
└── requirements.txt
```

## 运行

```bash
# 1. 安装依赖（建议用虚拟环境）
pip install -r requirements.txt

# 2. 配置 token（推荐用环境变量，不要把真实 token 写进 config.yaml）
export DESKPET_VISION_TOKEN="your-secret-token"

# 3. 启动服务
python -m src.main
# 或： uvicorn src.main:app --host 0.0.0.0 --port 8800

# 4. 跑测试
pytest -q
```

启动后可访问 `http://localhost:8800/docs` 查看自动生成的接口文档。

## 快速验证

```bash
# 健康检查
curl http://localhost:8800/v1/health

# 能力查询
curl http://localhost:8800/v1/capabilities \
  -H "Authorization: Bearer your-secret-token" \
  -H "X-DeskPet-Client: curl/test"

# 提交一帧（image 为任意 PNG）
curl -X POST http://localhost:8800/v1/extract \
  -H "Authorization: Bearer your-secret-token" \
  -H "X-DeskPet-Client: curl/test" \
  -F "image=@frame.png;type=image/png" \
  -F 'metadata={"region_id":"r1","frame_seq":1,"captured_at":"2026-05-15T06:30:00Z","region_size":{"w":640,"h":320},"content_hash":"p:abc"}'
```

## 注意

- `config.yaml` 里的 `bearer_token` 是占位值，部署时务必用环境变量
  `DESKPET_VISION_TOKEN` 覆盖。
- 本服务遵守「不留存」原则：收到帧 → 提取 → 即销毁，不写图、不写含画面内容的日志。
