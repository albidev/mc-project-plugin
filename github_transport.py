"""Bounded GitHub REST transport."""
from __future__ import annotations

import json
import re
import time
from urllib.parse import urlparse
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class GitHubTransportError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class GitHubTransport:
    def __init__(self, base_url: str = "https://api.github.com", timeout: float = 5.0, body_limit: int = 1024 * 1024) -> None:
        parsed = urlparse(base_url)
        if parsed.scheme != "https" or parsed.hostname != "api.github.com" or parsed.port is not None or parsed.path not in {"", "/"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise GitHubTransportError("INVALID_GITHUB_ENDPOINT")
        self.base_url = base_url.rstrip("/")
        self.timeout = min(max(timeout, 0.1), 5.0)
        self.body_limit = min(max(body_limit, 1024), 1024 * 1024)

    def get(self, path: str, token: str) -> object:
        if not path.startswith("/") or "\x00" in path or "\\" in path or re.search(r"%2e|%2f|%5c", path, re.IGNORECASE) or re.search(r"/(?:\.{1,2})(?:/|$)", path):
            raise GitHubTransportError("INVALID_GITHUB_PATH")
        request = Request(self.base_url + path, headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "User-Agent": "mc-project-plugin"})
        deadline = time.monotonic() + self.timeout
        for attempt in range(2):
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise GitHubTransportError("GITHUB_TIMEOUT")
                with urlopen(request, timeout=remaining) as response:
                    chunks: list[bytes] = []
                    total = 0
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise GitHubTransportError("GITHUB_TIMEOUT")
                        chunk = response.read(min(8192, self.body_limit + 1 - total))
                        if not chunk:
                            break
                        chunks.append(chunk)
                        total += len(chunk)
                        if total > self.body_limit:
                            raise GitHubTransportError("GITHUB_OUTPUT_LIMIT")
                    body = b"".join(chunks)
                    if len(body) > self.body_limit:
                        raise GitHubTransportError("GITHUB_OUTPUT_LIMIT")
                    return json.loads(body.decode("utf-8"))
            except HTTPError as exc:
                if exc.code == 429 or (exc.code == 403 and exc.headers.get("X-RateLimit-Remaining") == "0"):
                    raise GitHubTransportError("GITHUB_RATE_LIMIT") from exc
                if exc.code in {401, 403, 404}:
                    raise GitHubTransportError(f"GITHUB_HTTP_{exc.code}") from exc
                if exc.code >= 500 and attempt == 0:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise GitHubTransportError("GITHUB_TIMEOUT") from exc
                    time.sleep(min(0.05, remaining))
                    continue
                raise GitHubTransportError("GITHUB_UPSTREAM") from exc
            except (URLError, TimeoutError, socket.timeout, OSError) as exc:
                is_timeout = isinstance(exc, (TimeoutError, socket.timeout)) or isinstance(getattr(exc, "reason", None), TimeoutError)
                if is_timeout and attempt == 0:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise GitHubTransportError("GITHUB_TIMEOUT") from exc
                    time.sleep(min(0.05, remaining))
                    continue
                raise GitHubTransportError("GITHUB_UPSTREAM") from exc
            except (json.JSONDecodeError, UnicodeError) as exc:
                raise GitHubTransportError("GITHUB_MALFORMED_RESPONSE") from exc
        raise GitHubTransportError("GITHUB_UPSTREAM")
