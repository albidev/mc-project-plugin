"""Immutable, validated repository context for one configured project."""
from __future__ import annotations

from dataclasses import dataclass
import errno
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
from urllib.parse import urlparse

from registry import Registry, ProjectRecord


class RepositoryContextError(ValueError):
    pass


class GitCommandError(RuntimeError):
    def __init__(self, operation: str, returncode: int) -> None:
        super().__init__(operation)
        self.operation = operation
        self.returncode = returncode


@dataclass(frozen=True)
class RepositoryContext:
    project_id: str
    name: str
    path: Path
    remote: str
    default_branch: str
    remote_url: str
    registry_epoch: int = 1


_OUTPUT_LIMIT = 64 * 1024
_COMMAND_TIMEOUT = 5.0


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _stop_process(process: subprocess.Popen[bytes], pgid: int | None = None) -> None:
    stable_pgid = pgid if pgid is not None else getattr(process, "_mc_pgid", None)
    if type(stable_pgid) is int and stable_pgid > 0:
        try:
            os.killpg(stable_pgid, signal.SIGTERM)
        except OSError as exc:
            if exc.errno != errno.ESRCH:
                pass
        try:
            process.wait(timeout=0.2)
        except subprocess.TimeoutExpired:
            pass
        except OSError:
            pass
        try:
            os.killpg(stable_pgid, signal.SIGKILL)
        except OSError as exc:
            if exc.errno != errno.ESRCH:
                pass
    try:
        process.wait(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _run_git(path: Path, operation: str, args: list[str]) -> str:
    try:
        process = subprocess.Popen(
            ["git", "-C", str(path), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            start_new_session=True,
        )
    except OSError as exc:
        raise RepositoryContextError("GIT_UNAVAILABLE") from exc
    pgid = process.pid
    if type(pgid) is not int or pgid <= 0:
        _stop_process(process)
        raise RepositoryContextError("GIT_IO_ERROR")
    selector = selectors.DefaultSelector()
    stdout = process.stdout
    stderr = process.stderr
    streams = (stdout, stderr)
    try:
        if any(stream is None for stream in streams):
            raise RepositoryContextError("GIT_IO_ERROR")
        assert stdout is not None and stderr is not None
        selector.register(stdout, selectors.EVENT_READ, "stdout")
        selector.register(stderr, selectors.EVENT_READ, "stderr")
        output: dict[str, bytearray] = {"stdout": bytearray(), "stderr": bytearray()}
        deadline = time.monotonic() + _COMMAND_TIMEOUT
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _stop_process(process, pgid)
                raise RepositoryContextError("GIT_TIMEOUT")
            for key, _ in selector.select(remaining):
                stream = key.fileobj
                fd = stream if isinstance(stream, int) else stream.fileno()
                chunk = os.read(fd, 8192)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output[key.data].extend(chunk)
                if len(output[key.data]) > _OUTPUT_LIMIT:
                    _stop_process(process, pgid)
                    raise RepositoryContextError("GIT_OUTPUT_LIMIT")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _stop_process(process, pgid)
            raise RepositoryContextError("GIT_TIMEOUT")
        try:
            returncode = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as exc:
            _stop_process(process, pgid)
            raise RepositoryContextError("GIT_TIMEOUT") from exc
        if returncode != 0:
            raise GitCommandError(operation, returncode)
        try:
            return output["stdout"].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RepositoryContextError("GIT_INVALID_ENCODING") from exc
    except (OSError, ValueError) as exc:
        _stop_process(process, pgid)
        if isinstance(exc, RepositoryContextError):
            raise
        raise RepositoryContextError("GIT_IO_ERROR") from exc
    finally:
        _stop_process(process, pgid)
        selector.close()
        for stream in streams:
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass


def _valid_remote_url(remote: str) -> bool:
    if any(ord(char) < 32 or ord(char) == 127 for char in remote) or any(char.isspace() for char in remote):
        return False
    try:
        parsed = urlparse(remote)
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme in {"https", "ssh", "git"}:
        host = parsed.hostname
        return (bool(host) and not host.startswith("-") and not parsed.username and not parsed.password
                and not parsed.query and not parsed.fragment and (port is None or 1 <= port <= 65535))
    if remote.startswith("git@") and ":" in remote:
        host, path = remote[4:].split(":", 1)
        return bool(host and path and not host.startswith("-") and all(c.isalnum() or c in ".-_" for c in host))
    return False


def resolve_context(registry: Registry, project_id: str) -> RepositoryContext:
    record: ProjectRecord | None = registry.get(project_id)
    if record is None or not record.enabled:
        raise RepositoryContextError("UNKNOWN_PROJECT")
    try:
        path = record.path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise RepositoryContextError("INVALID_PATH") from exc
    if not any(_inside(path, root) for root in registry.approved_roots):
        raise RepositoryContextError("PATH_OUTSIDE_APPROVED_ROOT")
    if not path.is_dir():
        raise RepositoryContextError("NOT_GIT")
    try:
        top = Path(_run_git(path, "rev-parse", ["rev-parse", "--show-toplevel"]).strip()).resolve(strict=True)
    except GitCommandError as exc:
        if exc.operation == "rev-parse":
            raise RepositoryContextError("NOT_GIT") from exc
        raise RepositoryContextError("REPOSITORY_UNAVAILABLE") from exc
    if top != path:
        raise RepositoryContextError("REPOSITORY_IDENTITY_MISMATCH")
    try:
        remote = _run_git(path, "remote", ["remote", "get-url", record.remote]).strip()
    except GitCommandError as exc:
        if exc.operation == "remote":
            raise RepositoryContextError("REMOTE_NOT_FOUND") from exc
        raise RepositoryContextError("REPOSITORY_UNAVAILABLE") from exc
    if not _valid_remote_url(remote):
        raise RepositoryContextError("INVALID_REMOTE_URL")
    return RepositoryContext(record.project_id, record.name, path, record.remote, record.default_branch, remote, registry.epoch)
