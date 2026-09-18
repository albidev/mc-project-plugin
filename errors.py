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
    from registry import RegistryError

    if isinstance(exc, ServiceError):
        status_by_code = {
            "UNAUTHENTICATED": 401, "INVALID_REQUEST": 400, "INVALID_PULL_REQUEST": 400, "INVALID_BRANCH_NAME": 400, "INVALID_REF": 400, "INVALID_PATH": 400, "INVALID_COMMIT": 400, "INVALID_GITHUB_REPOSITORY": 400, "UNKNOWN_PROJECT": 404, "NOT_FOUND": 404, "NOT_ALLOWED": 403, "REMOTE_NOT_FOUND": 404, "GIT_ARGUMENTS_NOT_ALLOWED": 400, "WORKTREE_DIRTY": 409, "LOCKED": 409, "MUTATION_IN_FLIGHT": 409, "MUTATION_INDETERMINATE": 409, "INDETERMINATE": 409, "STALE_CONTEXT": 409, "CONTEXT_MISMATCH": 409, "CONTEXT_STALE": 409, "SNAPSHOT_UNSTABLE": 409, "READBACK_MISMATCH": 409, "GIT_COMMAND_FAILED": 409, "OUTPUT_LIMIT": 413, "PAYLOAD_TOO_LARGE": 413, "GIT_OUTPUT_LIMIT": 413, "GIT_TIMEOUT": 504, "GITHUB_TIMEOUT": 504, "GIT_UNAVAILABLE": 503, "GIT_IO_ERROR": 503, "GIT_INVALID_ENCODING": 502, "GIT_MALFORMED_OUTPUT": 502, "REPOSITORY_UNAVAILABLE": 502, "GITHUB_AUTH_UNAVAILABLE": 503, "GITHUB_UNAVAILABLE": 502, "GITHUB_MALFORMED_RESPONSE": 502, "UNSUPPORTED_REMOTE": 400, "UNAUTHORIZED_REMOTE": 400, "REMOTE_MISMATCH": 400, "SERVICE_UNAVAILABLE": 502,
        }
        if exc.code in status_by_code:
            return ServiceError(exc.code, status_by_code[exc.code], exc.message)
        return ServiceError("SERVICE_UNAVAILABLE", 502)
    if isinstance(exc, RegistryError):
        return ServiceError("SERVICE_UNAVAILABLE", 502)
    if isinstance(exc, RepositoryContextError):
        raw_code = str(exc) or "CONTEXT_UNAVAILABLE"
        code = {
            "PATH_OUTSIDE_APPROVED_ROOT": "UNKNOWN_PROJECT",
            "NOT_GIT": "REPOSITORY_UNAVAILABLE",
            "REPOSITORY_IDENTITY_MISMATCH": "CONTEXT_MISMATCH",
            "INVALID_REMOTE_URL": "INVALID_GITHUB_REPOSITORY",
        }.get(raw_code, raw_code)
        if code not in {"UNKNOWN_PROJECT", "REMOTE_NOT_FOUND", "INVALID_PATH", "GIT_OUTPUT_LIMIT", "GIT_TIMEOUT", "GIT_UNAVAILABLE", "GIT_IO_ERROR", "GIT_INVALID_ENCODING", "GIT_MALFORMED_OUTPUT", "REPOSITORY_UNAVAILABLE", "CONTEXT_MISMATCH", "INVALID_GITHUB_REPOSITORY", "SERVICE_UNAVAILABLE"}:
            code = "SERVICE_UNAVAILABLE"
        status = (404 if code in {"UNKNOWN_PROJECT", "REMOTE_NOT_FOUND"}
                  else 413 if code == "GIT_OUTPUT_LIMIT"
                  else 504 if code == "GIT_TIMEOUT"
                  else 503 if code in {"GIT_UNAVAILABLE", "GIT_IO_ERROR"}
                  else 502 if code in {"GIT_INVALID_ENCODING", "GIT_MALFORMED_OUTPUT", "REPOSITORY_UNAVAILABLE"}
                  else 409 if code == "CONTEXT_MISMATCH"
                  else 400)
        return ServiceError(code, status)
    if isinstance(exc, GitAdapterError):
        code = exc.code
        allowed_invalid = {"INVALID_BRANCH_NAME", "INVALID_REF", "INVALID_PATH", "INVALID_COMMIT", "INVALID_REQUEST"}
        if code not in {"GIT_OUTPUT_LIMIT", "OUTPUT_LIMIT", "GIT_ARGUMENTS_NOT_ALLOWED", "GIT_COMMAND_FAILED", "GIT_TIMEOUT", "GIT_UNAVAILABLE", "GIT_IO_ERROR", "GIT_MALFORMED_OUTPUT", "GIT_INVALID_ENCODING"}:
            code = code if code in allowed_invalid else "INVALID_REQUEST"
        status = (413 if code in {"GIT_OUTPUT_LIMIT", "OUTPUT_LIMIT"}
                  else 400 if code == "GIT_ARGUMENTS_NOT_ALLOWED" or code.startswith("INVALID_")
                  else 409 if code == "GIT_COMMAND_FAILED"
                  else 504 if code == "GIT_TIMEOUT"
                  else 503 if code in {"GIT_UNAVAILABLE", "GIT_IO_ERROR"}
                  else 502)
        return ServiceError(code, status)
    if isinstance(exc, GitHubAdapterError):
        raw_code = str(exc) or "GITHUB_UNAVAILABLE"
        code = {"GITHUB_OUTPUT_LIMIT": "OUTPUT_LIMIT", "GITHUB_RATE_LIMIT": "GITHUB_UNAVAILABLE", "GITHUB_UPSTREAM": "GITHUB_UNAVAILABLE", "GITHUB_HTTP_401": "GITHUB_AUTH_UNAVAILABLE", "GITHUB_HTTP_403": "GITHUB_AUTH_UNAVAILABLE", "GITHUB_HTTP_404": "NOT_FOUND", "INVALID_GITHUB_ENDPOINT": "GITHUB_UNAVAILABLE", "INVALID_GITHUB_PATH": "INVALID_REQUEST"}.get(raw_code, raw_code)
        allowed_invalid = {"INVALID_GITHUB_REPOSITORY", "INVALID_REQUEST", "INVALID_PULL_REQUEST"}
        if code not in {"OUTPUT_LIMIT", "GITHUB_AUTH_UNAVAILABLE", "GITHUB_UNAVAILABLE", "NOT_FOUND", "GITHUB_TIMEOUT", "GITHUB_MALFORMED_RESPONSE", "UNSUPPORTED_REMOTE", "UNAUTHORIZED_REMOTE", "REMOTE_MISMATCH"}:
            code = code if code in allowed_invalid else "INVALID_REQUEST"
        status = (503 if code == "GITHUB_AUTH_UNAVAILABLE"
                  else 413 if code == "OUTPUT_LIMIT"
                  else 400 if code.startswith("INVALID_") or code in {"UNSUPPORTED_REMOTE", "UNAUTHORIZED_REMOTE", "REMOTE_MISMATCH"}
                  else 404 if code == "NOT_FOUND"
                  else 504 if code == "GITHUB_TIMEOUT" else 502)
        return ServiceError(code, status)
    return ServiceError("SERVICE_UNAVAILABLE", 502)
