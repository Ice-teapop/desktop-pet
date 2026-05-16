"""
DeskPet 非 LLM 视觉服务 —— 应用入口。

启动方式（在 vision-service/ 目录下）：
    python -m src.main
或：
    uvicorn src.main:app --host 0.0.0.0 --port 8800

接口契约见《视觉服务接口契约 API v1》。
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .api.auth import ServiceError
from .api.routes import router
from .config import assert_secure_config, config
from .log import get_logger, setup_logging
from .util import safe_request_id

setup_logging(config.log_level)
logger = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动前安全自检：拒绝以默认占位 token 运行。
    # 用 uvicorn / python -m src.main 启动会触发；裸 TestClient(app) 不触发。
    assert_secure_config(config)

    # 预热公式引擎：把 pix2tex 模型加载从首请求路径提到启动阶段，
    # 避免第一个公式请求阻塞超过客户端 10s 超时（部署文档 7 节）。
    # 预热失败会让引擎 available() 转 False，整套优雅降级回文本。
    from .pipeline.formula import get_formula_engine
    get_formula_engine().warmup()

    logger.info("vision service started, pipeline_version=%s", config.pipeline_version)
    yield


app = FastAPI(
    title="DeskPet Vision Service",
    version=config.pipeline_version,
    lifespan=lifespan,
)
app.include_router(router)


def _request_id(request: Request) -> str:
    return safe_request_id(request.headers.get("X-Request-Id"))


@app.exception_handler(ServiceError)
async def _service_error_handler(request: Request, exc: ServiceError):
    """把 ServiceError 转成契约规定的错误响应体。"""
    logger.warning("service_error code=%s status=%d", exc.code, exc.status)
    return JSONResponse(
        status_code=exc.status,
        content={
            "ok": False,
            "request_id": _request_id(request),
            "error": {"code": exc.code, "message": exc.message},
        },
        headers=exc.headers or None,
    )


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    """请求结构不合法（缺字段、类型不对等）统一映射为 INVALID_REQUEST。

    校验细节只记服务端日志，不回显到响应里，避免泄露内部校验结构。
    """
    logger.warning("validation_error: %s", exc.errors())
    return JSONResponse(
        status_code=400,
        content={
            "ok": False,
            "request_id": _request_id(request),
            "error": {
                "code": "INVALID_REQUEST",
                "message": "request validation failed",
            },
        },
    )


@app.get("/")
async def root():
    return {
        "service": "deskpet-vision",
        "version": config.pipeline_version,
        "contract": "v1",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn

    # access_log=False：不打访问行（IP、路径、UA），守「不留存」纪律的元信息层。
    # systemd ExecStart 也带 --no-access-log，本地裸启走这条路径同样静音。
    uvicorn.run(
        "src.main:app",
        host=config.host,
        port=config.port,
        reload=False,
        access_log=False,
    )
