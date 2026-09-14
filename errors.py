"""Stable, non-leaking errors exposed by plugin handlers."""
from __future__ import annotations


class ServiceError(RuntimeError):
    def __init__(self, code: str, status: int = 400, message: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status
        self.message = message or code


def service_error_from(exc: BaseException) -> ServiceError:
    """Translate adapter/context failures to a stable public error."""
    from git_adapter import GitAdapterError
    from github_adapter import GitHubAdapterError
    from repository_context import RepositoryContextError

    if isinstance(exc, ServiceError):
        return exc
    if isinstance(exc, RepositoryContextError):
        code = str(exc) or "CONTEXT_UNAVAILABLE"
        status = (404 if code in {"UNKNOWN_PROJECT", "REMOTE_NOT_FOUND"}
                  else 413 if code == "GIT_OUTPUT_LIMIT"
                  else 504 if code == "GIT_TIMEOUT" else 400)
        return ServiceError(code, status)
    if isinstance(exc, GitAdapterError):
        code = exc.code
        status = 413 if code in {"GIT_OUTPUT_LIMIT", "OUTPUT_LIMIT"} else 400 if code.startswith("INVALID_") else 504 if code == "GIT_TIMEOUT" else 502
        return ServiceError(code, status)
    if isinstance(exc, GitHubAdapterError):
        code = str(exc) or "GITHUB_UNAVAILABLE"
        status = 413 if code in {"GITHUB_OUTPUT_LIMIT", "OUTPUT_LIMIT"} else 400 if code.startswith("INVALID_") or code in {"UNAUTHORIZED_REMOTE", "REMOTE_MISMATCH"} else 504 if code == "GITHUB_TIMEOUT" else 502
        return ServiceError(code, status)
    return ServiceError("SERVICE_UNAVAILABLE", 502)
