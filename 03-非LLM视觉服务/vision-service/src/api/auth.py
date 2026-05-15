"""
鉴权与统一错误类型。

- ServiceError：全服务统一的错误类型，携带契约里的 error.code、HTTP 状态码、message。
  由 main.py 的异常处理器转换成契约规定的错误响应体。
- require_auth：FastAPI 依赖，校验 Bearer Token 与 X-DeskPet-Client 请求头。
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Optional

from fastapi import Header

from ..config import config


class ServiceError(Exception):
    """对应《视觉服务接口契约》第六章的错误。

    headers：可选的附加响应头（如 RATE_LIMITED 配套的 Retry-After）。
    """

    def __init__(
        self,
        code: str,
        status: int,
        message: str,
        headers: Optional[dict[str, str]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.headers = headers or {}


async def require_auth(
    authorization: Optional[str] = Header(default=None),
    x_deskpet_client: Optional[str] = Header(default=None),
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise ServiceError("UNAUTHORIZED", 401,
                           "missing or malformed Authorization header")
    token = authorization[len("Bearer "):].strip()
    # 常数时间比较，避免计时侧信道
    if not hmac.compare_digest(token, config.bearer_token):
        raise ServiceError("UNAUTHORIZED", 401, "invalid token")
    if not x_deskpet_client:
        raise ServiceError("INVALID_REQUEST", 400, "missing X-DeskPet-Client header")
    # token_id：token 的短哈希，用于限流计数等，避免在内存里到处传原始 token
    token_id = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    return {"client": x_deskpet_client, "token_id": token_id}
