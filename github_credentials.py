"""Server-side GitHub credential lookup."""
from __future__ import annotations

import os


class GitHubCredentialsProvider:
    def __init__(self, token: str | None = None) -> None:
        self._token = token if token is not None else os.environ.get("MC_PROJECT_GITHUB_TOKEN")

    def token(self) -> str | None:
        if not isinstance(self._token, str) or any(ord(char) < 32 or ord(char) == 127 for char in self._token):
            return None
        return self._token.strip() if self._token and self._token.strip() else None
