"""Strict, bounded local branch mutations with verified read-back."""
from __future__ import annotations

import os
import errno
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time

from errors import ServiceError, service_error_from
from git_adapter import GitAdapterError
from ref_validation import is_valid_ref_name
from repository_context import RepositoryContext, resolve_context


_LOCK_TIMEOUT = 2.0
_COMMAND_TIMEOUT = 5.0
_OBJECT_ID = re.compile(r"^[0-9a-fA-F]{40}$")



def validate_branch_name(name: object) -> str:
    if not is_valid_ref_name(name):
        raise ServiceError("INVALID_BRANCH_NAME", 400)
    assert isinstance(name, str)
    return name


class _MutationRunner:
    def __init__(self, path: Path) -> None:
        self.path = path

    @staticmethod
    def _stop(process: subprocess.Popen[bytes], pgid: int | None = None) -> None:
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

    def run(self, args: list[str]) -> str:
        allowed = (len(args) == 3 and args[0] == "switch"
                   and args[1] in {"--", "-c"} and isinstance(args[2], str))
        if not allowed or not isinstance(args[-1], str):
            raise ServiceError("GIT_ARGUMENTS_NOT_ALLOWED", 400)
        try:
            process = subprocess.Popen(["git", "-C", str(self.path), *args],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       shell=False, start_new_session=True)
        except OSError as exc:
            raise ServiceError("GIT_UNAVAILABLE", 503) from exc
        pgid = process.pid
        if type(pgid) is not int or pgid <= 0:
            self._stop(process)
            raise ServiceError("GIT_IO_ERROR", 503)
        selector = selectors.DefaultSelector()
        stdout, stderr = process.stdout, process.stderr
        output = {"stdout": bytearray(), "stderr": bytearray()}
        try:
            if stdout is None or stderr is None:
                raise ServiceError("GIT_IO_ERROR", 503)
            selector.register(stdout, selectors.EVENT_READ, "stdout")
            selector.register(stderr, selectors.EVENT_READ, "stderr")
            deadline = time.monotonic() + _COMMAND_TIMEOUT
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._stop(process, pgid)
                    raise ServiceError("GIT_TIMEOUT", 504)
                for key, _ in selector.select(remaining):
                    stream = key.fileobj
                    fd = stream if isinstance(stream, int) else stream.fileno()
                    chunk = os.read(fd, 8192)
                    if not chunk:
                        selector.unregister(stream)
                        continue
                    output[key.data].extend(chunk)
                    if sum(len(value) for value in output.values()) > 1024 * 1024:
                        self._stop(process, pgid)
                        raise ServiceError("GIT_OUTPUT_LIMIT", 413)
            try:
                returncode = process.wait(timeout=max(deadline - time.monotonic(), 0.1))
            except subprocess.TimeoutExpired as exc:
                self._stop(process, pgid)
                raise ServiceError("GIT_TIMEOUT", 504) from exc
            if returncode != 0:
                raise ServiceError("GIT_COMMAND_FAILED", 409)
            try:
                return output["stdout"].decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ServiceError("GIT_INVALID_ENCODING", 502) from exc
        except ServiceError:
            raise
        except (OSError, ValueError) as exc:
            self._stop(process, pgid)
            raise ServiceError("GIT_IO_ERROR", 503) from exc
        finally:
            self._stop(process, pgid)
            selector.close()
            for stream in (stdout, stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except OSError:
                        pass


class BranchMutationService:
    """Mutate only a validated configured repository and verify its final state."""
    def __init__(self, service, runner_factory=_MutationRunner, context_resolver=resolve_context) -> None:
        self.service = service
        self.runner_factory = runner_factory
        self.context_resolver = context_resolver

    def _recover_indeterminate(self, context: RepositoryContext) -> None:
        """Make one bounded best-effort refresh before leaving the mutation blocked."""
        try:
            self.service._snapshot_impl(context)
        except BaseException:
            pass

    @staticmethod
    def _read(git, context: RepositoryContext) -> dict[str, object]:
        working = git.working_tree()
        branches = git.branches()
        current = next((item for item in branches["local"] if item.get("current")), None)
        if not isinstance(current, dict) or not current.get("name"):
            raise ServiceError("INDETERMINATE", 409)
        try:
            fingerprints = getattr(git, "local_fingerprints", lambda: {})()
        except GitAdapterError as exc:
            raise ServiceError("INDETERMINATE", 409) from exc
        if (not isinstance(fingerprints, dict)
                or set(fingerprints) != {"HEAD", "status", "refs/remotes", "refs/heads", "currentBranch"}
                or any(not isinstance(value, str) for value in fingerprints.values())
                or not is_valid_ref_name(fingerprints.get("currentBranch"))):
            raise ServiceError("INDETERMINATE", 409)
        head = fingerprints.get("HEAD")
        if not isinstance(head, str) or not _OBJECT_ID.fullmatch(head):
            raise ServiceError("INDETERMINATE", 409)
        return {"branch": current["name"], "tracking": current.get("tracking"),
                "status": "dirty" if working.get("files") else "clean", "branches": branches,
                "head": head, "fingerprints": fingerprints}

    @staticmethod
    def _fingerprints_match(before: dict[str, str], after: dict[str, str], name: str,
                            create: bool) -> bool:
        if (after["HEAD"] != before["HEAD"] or after["status"] != before["status"]
                or after["refs/remotes"] != before["refs/remotes"]
                or after["currentBranch"] != name):
            return False

        def normalized(raw: str) -> list[tuple[str, str, str, str, str]]:
            rows = []
            for row in raw.splitlines():
                fields = row.split("\t")
                if len(fields) != 5:
                    return []
                rows.append((fields[0], fields[1], " ", fields[3], fields[4]))
            return sorted(rows)

        before_rows = normalized(before["refs/heads"])
        after_rows = normalized(after["refs/heads"])
        if not before_rows or not after_rows and before_rows:
            return False
        if create:
            expected = (name, before["HEAD"], " ", "", "")
            if after_rows.count(expected) != 1:
                return False
            after_rows.remove(expected)
        return before_rows == after_rows

    @staticmethod
    def _tracking_for(branches: object, name: str) -> str | None:
        local = branches.get("local") if isinstance(branches, dict) else None
        if not isinstance(local, list):
            raise ServiceError("INDETERMINATE", 409)
        item = next((item for item in local
                     if isinstance(item, dict) and item.get("name") == name), None)
        if not isinstance(item, dict):
            return None
        tracking = item.get("tracking")
        if not isinstance(tracking, (str, type(None))):
            raise ServiceError("INDETERMINATE", 409)
        return tracking

    def _run(self, context: RepositoryContext, name: str, create: bool) -> dict[str, object]:
        name = validate_branch_name(name)
        self.service._assert_context(context)
        if self.service._mutation_status(context.project_id) != "idle":
            state = self.service._mutation_status(context.project_id)
            raise ServiceError("MUTATION_IN_FLIGHT" if state == "running" else "MUTATION_INDETERMINATE", 409)
        with self.service.mutation_gate(context):
            state = self.service._mutation_status(context.project_id)
            if state != "idle":
                raise ServiceError("MUTATION_IN_FLIGHT" if state == "running" else "MUTATION_INDETERMINATE", 409)
            self.service._assert_context(context)
            git = self.service.git_factory(context)
            before = self._read(git, context)
            local = before["branches"]["local"]
            names = {item.get("name") for item in local if isinstance(item, dict)}
            if before["status"] != "clean":
                raise ServiceError("WORKTREE_DIRTY", 409)
            if create and name in names:
                raise ServiceError("BRANCH_ALREADY_EXISTS", 409)
            if not create and name not in names:
                raise ServiceError("BRANCH_NOT_FOUND", 404)
            expected_tracking = None if create else self._tracking_for(before["branches"], name)
            # Resolve the complete context again after acquiring the shared
            # gate.  The preflight context can be stale if the registry,
            # approved roots, or repository identity changed while waiting.
            try:
                validated = self.context_resolver(self.service.registry, context.project_id)
            except BaseException as exc:
                raise service_error_from(exc) from exc
            self.service._assert_context(validated)
            if validated != context:
                raise ServiceError("CONTEXT_MISMATCH", 409)
            # The resolver itself can observe or trigger a repository/registry
            # change. Re-read immediately before dispatch and refuse to run
            # Git unless the complete preflight observation is unchanged.
            dispatch_read = self._read(self.service.git_factory(validated), validated)
            if dispatch_read["status"] != "clean":
                raise ServiceError("WORKTREE_DIRTY", 409)
            if dispatch_read != before:
                raise ServiceError("READBACK_MISMATCH", 409)
            self.service.begin_mutation(context)
            registry_identity = self.service._registry_identity(self.service.registry)
            completed = False
            try:
                generation = self.service._next_generation(context.project_id)
                with self.service._lock:
                    self.service._last_good.pop(context.project_id, None)
                    self.service._snapshots.pop(context.project_id, None)
                args = ["switch", "-c", name] if create else ["switch", "--", name]
                self.runner_factory(validated.path).run(args)
                validated = self.context_resolver(self.service.registry, context.project_id)
                self.service._assert_context(validated)
                if validated != context:
                    raise ServiceError("CONTEXT_MISMATCH", 409)
                after = self._read(self.service.git_factory(validated), validated)
                if (after["branch"] != name or after["status"] != "clean"
                        or after["head"] != before["head"]
                        or after.get("tracking") != expected_tracking
                        or not isinstance(after.get("tracking"), (str, type(None)))
                        or not self._fingerprints_match(before["fingerprints"], after["fingerprints"], name, create)):
                    raise ServiceError("READBACK_MISMATCH", 409)
                if not self.service.finish_mutation_verified(context.project_id, registry_identity):
                    raise ServiceError("INDETERMINATE", 409)
                completed = True
                return {"project_id": context.project_id, "branch": name, "tracking": after["tracking"],
                        "status": after["status"], "created": create, "generation": generation, "verified": True}
            except ServiceError as exc:
                self._recover_indeterminate(context)
                if exc.code == "READBACK_MISMATCH":
                    raise
                raise ServiceError("INDETERMINATE", 409) from exc
            except BaseException as exc:
                self._recover_indeterminate(context)
                raise ServiceError("INDETERMINATE", 409) from exc
            finally:
                if not completed:
                    self.service.finish_mutation(context.project_id, indeterminate=True)

    def switch(self, context: RepositoryContext, branch: str) -> dict[str, object]:
        return self._run(context, branch, False)

    def create(self, context: RepositoryContext, name: str) -> dict[str, object]:
        return self._run(context, name, True)
