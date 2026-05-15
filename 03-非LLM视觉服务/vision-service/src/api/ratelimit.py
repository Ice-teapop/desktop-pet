"""
简单的进程内滑动窗口限流器（按 token 计数）。

局限：多 worker 部署时每个进程独立计数 —— 生产环境建议在反向代理 / 网关层
再加一道更严格的限流。本实现负责把契约里宣称的 rate_per_min 真正落地，
不再「宣称却不执行」。
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Depends

from ..config import config
from .auth import ServiceError, require_auth

_WINDOW_SECONDS = 60.0


class RateLimiter:
    def __init__(self, max_per_min: int):
        self.max_per_min = max_per_min
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> tuple[bool, int]:
        """返回 (是否放行, 建议的 Retry-After 秒数)。"""
        now = time.monotonic()
        window = self._hits[key]
        # 清掉窗口外的旧记录
        while window and now - window[0] >= _WINDOW_SECONDS:
            window.popleft()
        if len(window) >= self.max_per_min:
            retry_after = int(_WINDOW_SECONDS - (now - window[0])) + 1
            return False, max(retry_after, 1)
        window.append(now)
        return True, 0


# 进程内单例
_limiter = RateLimiter(config.rate_per_min)


async def rate_limit(auth: dict = Depends(require_auth)) -> None:
    """FastAPI 依赖：按 token 限流。先过 require_auth，再计数。"""
    allowed, retry_after = _limiter.check(auth["token_id"])
    if not allowed:
        raise ServiceError(
            "RATE_LIMITED", 429,
            f"rate limit exceeded, retry after {retry_after}s",
            headers={"Retry-After": str(retry_after)},
        )
