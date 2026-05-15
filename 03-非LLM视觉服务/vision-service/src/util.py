"""通用小工具。"""
from __future__ import annotations

import re
import uuid

# 请求 ID 允许的字符集：字母数字、点、下划线、连字符
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._\-]+")
_MAX_REQUEST_ID_LEN = 64


def safe_request_id(raw: str | None) -> str:
    """清洗客户端传入的 X-Request-Id。

    限定字符集 + 限长，防止把任意 / 超长的客户端输入原样回显到响应与日志里。
    清洗后为空则服务端自生成一个。
    """
    if raw:
        cleaned = "".join(_REQUEST_ID_RE.findall(raw))[:_MAX_REQUEST_ID_LEN]
        if cleaned:
            return cleaned
    return f"req_{uuid.uuid4().hex[:12]}"
