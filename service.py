"""Application service composing coherent local Git and GitHub snapshots."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import threading
from contextlib import contextmanager
import time
from typing import Callable
import uuid

from errors import ServiceError, service_error_from
from repository_context import RepositoryContext
from snapshot import MAX_STALE_SECONDS, capability, fingerprint, observed_at

_PROCESS_INSTANCE_ID = str(uuid.uuid4())
MAX_AGGREGATE_BYTES = 10 * 1024 * 1024
MAX_CAPABILITY_BYTES = 2 * 1024 * 1024
DETAIL_OUTPUT_BYTES = 1024 * 1024
MAX_FILE_DIFFS = 100
MAX_BRANCH_LOGS = 100
MAX_BRANCH_LOG_COMMITS = 100
MAX_FILE_DIFF_BYTES = 64 * 1024


class ProjectService:
    def __init__(self, registry, git_factory: Callable, github_factory: Callable) -> None:
        self.registry = registry
        self.git_factory = git_factory
        self.github_factory = github_factory
        self.process_instance_id = _PROCESS_INSTANCE_ID
        self._lock = threading.RLock()
        self._generation: dict[str, int] = {}
        self._last_good: dict[str, dict[str, object]] = {}
        self._github_good: dict[str, tuple[float, dict[str, object]]] = {}
        self._snapshots: dict[str, dict[str, object]] = {}
        self._inflight: dict[str, threading.Event] = {}
        self._local_ready: dict[str, threading.Event] = {}
        self._local_read_gates: dict[str, threading.RLock] = {}
        self._mutation_gates: dict[str, threading.Lock] = {}
        self._mutation_state: dict[str, str] = {}

    @staticmethod
    def _gate_key(context: RepositoryContext) -> str:
        return f"{context.project_id}:{context.path.resolve()}"

    def _gate_for(self, context: RepositoryContext) -> threading.Lock:
        key = self._gate_key(context)
        with self._lock:
            return self._mutation_gates.setdefault(key, threading.Lock())

    def _local_read_gate_for(self, context: RepositoryContext) -> threading.RLock:
        key = self._gate_key(context)
        with self._lock:
            return self._local_read_gates.setdefault(key, threading.RLock())

    def _mutation_status(self, project_id: str) -> str:
        with self._lock:
            return self._mutation_state.get(project_id, "idle")

    @contextmanager
    def mutation_gate(self, context: RepositoryContext):
        """Own the same repository gate for refreshes and branch mutations."""
        gate = self._gate_for(context)
        if not gate.acquire(timeout=2.0):
            raise ServiceError("LOCKED", 409)
        try:
            yield
        finally:
            gate.release()

    def begin_mutation(self, context: RepositoryContext) -> None:
        with self._lock:
            state = self._mutation_state.get(context.project_id, "idle")
            if state == "running":
                raise ServiceError("MUTATION_IN_FLIGHT", 409)
            if state == "indeterminate":
                raise ServiceError("MUTATION_INDETERMINATE", 409)
            self._mutation_state[context.project_id] = "running"

    def finish_mutation(self, project_id: str, *, indeterminate: bool) -> None:
        with self._lock:
            current = self._mutation_state.get(project_id, "idle")
            # A registry reload can mark a running operation indeterminate.
            # Its worker must not subsequently turn that unsafe state back to idle.
            if current == "indeterminate" and not indeterminate:
                return
            self._mutation_state[project_id] = "indeterminate" if indeterminate else "idle"

    @staticmethod
    def _registry_identity(registry) -> tuple[object, ...]:
        return (tuple(str(root) for root in registry.approved_roots), tuple(
            (item.project_id, item.name, str(item.path), item.enabled, item.remote, item.default_branch)
            for item in registry.projects))

    def update_registry(self, registry) -> None:
        with self._lock:
            changed = (registry.epoch != self.registry.epoch
                       or self._registry_identity(registry) != self._registry_identity(self.registry))
            self.registry = registry
            if changed:
                active_mutations = {
                    project_id for project_id, state in self._mutation_state.items()
                    if state == "running"
                }
                self._generation.clear()
                self._last_good.clear()
                self._github_good.clear()
                self._snapshots.clear()
                self._mutation_state.clear()
                self._mutation_state.update({project_id: "indeterminate" for project_id in active_mutations})

    def _assert_context(self, context: RepositoryContext) -> None:
        record = self.registry.get(context.project_id)
        if record is None or not record.enabled:
            raise ServiceError("UNKNOWN_PROJECT", 404)
        try:
            same_path = record.path.resolve() == context.path.resolve()
        except (OSError, RuntimeError) as exc:
            raise ServiceError("CONTEXT_MISMATCH", 409) from exc
        if (not same_path or record.name != context.name or record.remote != context.remote
                or record.default_branch != context.default_branch):
            raise ServiceError("CONTEXT_MISMATCH", 409)
        if getattr(context, "registry_epoch", self.registry.epoch) != self.registry.epoch:
            raise ServiceError("CONTEXT_STALE", 409)

    def _next_generation(self, project_id: str) -> int:
        with self._lock:
            generation = self._generation.get(project_id, 0) + 1
            self._generation[project_id] = generation
            return generation

    @staticmethod
    def _markers(git, local: dict[str, object] | None = None) -> dict[str, str]:
        for name in ("local_fingerprints", "fingerprints"):
            method = getattr(git, name, None)
            if callable(method):
                value = method()
                if not isinstance(value, dict) or not {"HEAD", "status", "refs/remotes"}.issubset(value):
                    raise ServiceError("SNAPSHOT_UNSTABLE", 409)
                return {key: fingerprint(raw) for key, raw in value.items()}
        # Test doubles and older adapters without marker support remain coherent
        # because their complete read is the only available observation.
        assert local is not None
        return {"HEAD": fingerprint(local.get("commits", [])[:1]),
                "status": fingerprint(local.get("workingTree", {})),
                "refs/remotes": fingerprint(local.get("branches", {}).get("remote", [])),
                "refs/heads": fingerprint(local.get("branches", {}).get("local", [])),
                "currentBranch": fingerprint(next((item.get("name") for item in local.get("branches", {}).get("local", []) if item.get("current")), None))}

    @staticmethod
    def _bounded(value: object) -> None:
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")) > MAX_CAPABILITY_BYTES:
            raise ServiceError("OUTPUT_LIMIT", 413)

    @staticmethod
    def _detail_bounded(value: object) -> None:
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")) > DETAIL_OUTPUT_BYTES:
            raise ServiceError("OUTPUT_LIMIT", 413)

    def _detail_binding(self, context: RepositoryContext, generation: int | None,
                        process_instance_id: str | None, registry_epoch: int | None,
                        context_identity: str | None, snapshot_id: str | None) -> None:
        if all(value is None for value in (generation, process_instance_id, registry_epoch, context_identity, snapshot_id)):
            current = self.snapshot(context)
            generation = current["localGeneration"]
            process_instance_id = current["processInstanceId"]
            registry_epoch = current["registryEpoch"]
            context_identity = current["contextIdentity"]
            snapshot_id = current["snapshotId"]
        elif None in (generation, process_instance_id, registry_epoch, context_identity, snapshot_id):
            raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")
        expected_identity = fingerprint({"project_id": context.project_id, "path": str(context.path.resolve()),
                                         "remote": context.remote, "remote_url": context.remote_url})
        with self._lock:
            current = self._snapshots.get(context.project_id)
            current_generation = self._generation.get(context.project_id)
        if (process_instance_id != self.process_instance_id or registry_epoch != self.registry.epoch
                or context.registry_epoch != self.registry.epoch or context_identity != expected_identity
                or generation != current_generation or current is None or snapshot_id != current.get("snapshotId")
                or current.get("localGeneration") != generation or current.get("contextIdentity") != context_identity):
            raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")

    def _read_local_once(self, context: RepositoryContext, git) -> tuple[dict[str, object], dict[str, str]]:
        has_markers = any(callable(getattr(git, name, None)) for name in ("local_fingerprints", "fingerprints"))
        before = self._markers(git) if has_markers else None
        working = git.working_tree()
        branches = git.branches()
        current = next((item["name"] for item in branches["local"] if item.get("current")), context.default_branch)
        commits = git.commits(current)
        local = {"workingTree": working, "branches": branches, "commits": commits}
        after = self._markers(git, local)
        if before is not None and before != after:
            raise ServiceError("SNAPSHOT_UNSTABLE", 409)
        return local, after

    def _local_snapshot(self, context: RepositoryContext, generation: int) -> tuple[dict[str, object], dict[str, str], str | None, object | None]:
        last_error: BaseException | None = None
        try:
            git = self.git_factory(context)
            for _attempt in range(2):
                try:
                    local, markers = self._read_local_once(context, git)
                    return local, markers, None, git
                except Exception as exc:
                    last_error = exc
                    if getattr(exc, "code", None) != "SNAPSHOT_UNSTABLE" or _attempt:
                        break
        except Exception as exc:
            last_error = exc
        mapped = service_error_from(last_error or RuntimeError("local unavailable"))
        with self._lock:
            cached = deepcopy(self._last_good.get(context.project_id))
        if cached is None:
            raise mapped from last_error
        cached["localGeneration"] = generation
        cached["warnings"] = list(cached.get("warnings", [])) + [mapped.code]
        for name in ("workingTree", "branches", "commits"):
            cap = cached.get("capabilities", {}).get(name)
            if isinstance(cap, dict):
                cap["status"] = "stale"
                cap["stale"] = True
                cap["errorCode"] = mapped.code
                cap["generation"] = generation
        cached["localStatus"] = "stale"
        return {key: cached[key] for key in ("workingTree", "branches", "commits", "fileDiffs", "branchLogs")}, cached["fingerprints"], mapped.code, None

    def snapshot(self, context: RepositoryContext, _allow_retry: bool = True) -> dict[str, object]:
        """Refresh once per project; concurrent callers see the last good snapshot."""
        self._assert_context(context)
        state = self._mutation_status(context.project_id)
        if state == "running":
            raise ServiceError("MUTATION_IN_FLIGHT", 409)
        if state == "indeterminate":
            raise ServiceError("MUTATION_INDETERMINATE", 409)
        while True:
            with self._lock:
                event = self._inflight.get(context.project_id)
                previous = deepcopy(self._last_good.get(context.project_id))
                if event is not None and previous is None:
                    # There is no coherent cached snapshot to return.  Do not
                    # enter the adapter path while the owner holds the shared
                    # mutation gate, even if its local read has completed.
                    raise ServiceError("LOCKED", 409)
                elif event is None:
                    owner_event = threading.Event()
                    self._inflight[context.project_id] = owner_event
                    self._local_ready[context.project_id] = threading.Event()
                    break
            previous["refreshing"] = True
            return previous
        try:
            with self.mutation_gate(context):
                state = self._mutation_status(context.project_id)
                if state != "idle":
                    raise ServiceError("MUTATION_IN_FLIGHT" if state == "running" else "MUTATION_INDETERMINATE", 409)
                return self._snapshot_impl(context, _allow_retry)
        finally:
            with self._lock:
                if self._inflight.get(context.project_id) is owner_event:
                    self._inflight.pop(context.project_id, None)
                    self._local_ready.pop(context.project_id, None)
                    owner_event.set()

    def _snapshot_impl(self, context: RepositoryContext, _allow_retry: bool = True) -> dict[str, object]:
        self._assert_context(context)
        generation = self._next_generation(context.project_id)
        with self._lock:
            previous = deepcopy(self._last_good.get(context.project_id))
        try:
            with self._local_read_gate_for(context):
                local, markers, local_error, git = self._local_snapshot(context, generation)
        except Exception as exc:
            raise service_error_from(exc) from exc
        finally:
            with self._lock:
                ready = self._local_ready.get(context.project_id)
            if ready is not None:
                ready.set()
        working, branches, commits = local["workingTree"], local["branches"], local["commits"]
        file_diffs: dict[str, str] = {}
        branch_logs: dict[str, list[dict[str, object]]] = {}
        if git is not None and not local_error:
            for entry in working.get("files", [])[:MAX_FILE_DIFFS]:
                path = entry.get("path") if isinstance(entry, dict) else None
                if not isinstance(path, str):
                    continue
                try:
                    diff = git.file_diff(path)
                    if isinstance(diff, str) and len(diff.encode("utf-8")) <= MAX_FILE_DIFF_BYTES:
                        file_diffs[path] = diff
                except Exception:
                    continue
            branch_names = [item.get("name") for item in branches.get("local", []) + branches.get("remote", [])
                            if isinstance(item, dict) and isinstance(item.get("name"), str)]
            for branch_name in branch_names[:MAX_BRANCH_LOGS]:
                try:
                    value = git.commits(branch_name)
                    if isinstance(value, list):
                        branch_logs[branch_name] = value[:MAX_BRANCH_LOG_COMMITS]
                except Exception:
                    continue
        caps: dict[str, object] = {
            "workingTree": capability("stale" if local_error else ("ready" if working.get("files") else "empty"), "local_git", working, local_error, generation=generation),
            "branches": capability("stale" if local_error else "ready", "local_git", branches, local_error, generation=generation),
            "commits": capability("stale" if local_error else ("ready" if commits else "empty"), "local_git", commits, local_error, generation=generation),
        }
        if local_error:
            stale_since = observed_at()
            if previous:
                previous_caps = previous.get("capabilities", {})
                if isinstance(previous_caps, dict):
                    for previous_cap in previous_caps.values():
                        if isinstance(previous_cap, dict) and previous_cap.get("staleSince"):
                            stale_since = previous_cap["staleSince"]
                            break
            for name in ("workingTree", "branches", "commits"):
                if isinstance(caps[name], dict):
                    caps[name]["staleSince"] = stale_since
        bounded_local: dict[str, object] = {}
        for name, value, fallback in (("workingTree", working, {"files": []}),
                                      ("branches", branches, {"local": [], "remote": []}),
                                      ("commits", commits, []),
                                      ("fileDiffs", file_diffs, {}),
                                      ("branchLogs", branch_logs, {})):
            try:
                self._bounded(value)
                bounded_local[name] = value
            except ServiceError as exc:
                if exc.code != "OUTPUT_LIMIT":
                    raise
                bounded_local[name] = fallback
                caps[name] = capability("error", "local_git", fallback, "OUTPUT_LIMIT", generation=generation)
        working, branches, commits = (bounded_local["workingTree"], bounded_local["branches"], bounded_local["commits"])
        file_diffs, branch_logs = bounded_local["fileDiffs"], bounded_local["branchLogs"]
        local = {"workingTree": working, "branches": branches, "commits": commits,
                 "fileDiffs": file_diffs, "branchLogs": branch_logs}
        github_value: dict[str, object]
        github_error: str | None = None
        now = time.monotonic()
        try:
            github = self.github_factory(context)
            github_value = {"pullRequests": github.pull_requests(), "issues": github.issues(), "status": "ready"}
            with self._lock:
                if self._generation.get(context.project_id) != generation:
                    raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")
                self._bounded(github_value)
                self._github_good[context.project_id] = (now, deepcopy(github_value))
            caps["github"] = capability("ready", "github", github_value, generation=generation)
        except Exception as exc:
            mapped = service_error_from(exc)
            github_error = mapped.code
            if mapped.code == "OUTPUT_LIMIT":
                github_value = {"status": "error", "pullRequests": [], "issues": []}
                caps["github"] = capability("error", "github", github_value, "OUTPUT_LIMIT", generation=generation)
                github_error = "OUTPUT_LIMIT"
            else:
                with self._lock:
                    cached = self._github_good.get(context.project_id)
                if cached is not None and now - cached[0] <= MAX_STALE_SECONDS:
                    github_value = deepcopy(cached[1]); github_value["status"] = "stale"
                    stale_since = datetime.fromtimestamp(time.time() - (now - cached[0]), timezone.utc).isoformat()
                    caps["github"] = capability("stale", "github", github_value, github_error, generation=generation, stale_since=stale_since)
                else:
                    github_value = {"status": "unavailable", "pullRequests": [], "issues": []}
                    caps["github"] = capability("unavailable", "github", github_value, github_error, generation=generation)
        # Recheck local markers after the GitHub read and before publication.
        if (local_error is None and git is not None
                and any(callable(getattr(git, name, None)) for name in ("local_fingerprints", "fingerprints"))):
            try:
                with self._local_read_gate_for(context):
                    final_markers = self._markers(git)
            except Exception:
                final_markers = None
            if final_markers != markers:
                if _allow_retry:
                    return self._snapshot_impl(context, _allow_retry=False)
                raise ServiceError("SNAPSHOT_UNSTABLE", 409)
            markers = final_markers
        if self.registry.epoch != context.registry_epoch:
            raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")
        context_identity = fingerprint({"project_id": context.project_id, "path": str(context.path.resolve()), "remote": context.remote, "remote_url": context.remote_url})
        last_updated = (previous or {}).get("lastUpdated") if local_error else observed_at()
        result = {
            "schemaVersion": 1, "project_id": context.project_id,
            "project": {"name": context.name, "repository": context.remote_url},
            "processInstanceId": self.process_instance_id, "registryEpoch": self.registry.epoch,
            "contextIdentity": context_identity, "localGeneration": generation,
            "snapshotId": str(uuid.uuid4()), "head": commits[0]["hash"] if commits else None,
            "observedAt": observed_at(), "refreshing": False, "lastUpdated": last_updated,
            "fingerprints": {**markers, "workingTree": markers["status"], "branches": markers["refs/remotes"], "commits": markers["HEAD"], "local": fingerprint(local)},
            "capabilities": caps, "localStatus": "stale" if local_error else "ready", **local,
            "focusDefaults": {"kind": "file", "value": working.get("files", [None])[0].get("path") if working.get("files") else None},
            "github": github_value, "warnings": ([local_error] if local_error else []) + ([github_error] if github_error else []),
        }
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")) > MAX_AGGREGATE_BYTES:
            raise ServiceError("OUTPUT_LIMIT", 413)
        with self._lock:
            if self._generation.get(context.project_id) != generation:
                raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")
            if self.registry.epoch != context.registry_epoch:
                raise ServiceError("STALE_CONTEXT", 409, "STALE_SNAPSHOT")
            if not local_error:
                self._last_good[context.project_id] = deepcopy(result)
            self._snapshots[context.project_id] = deepcopy(result)
        return result

    def commit_detail(self, context: RepositoryContext, commit: str, generation: int | None = None,
                      process_instance_id: str | None = None, registry_epoch: int | None = None,
                      context_identity: str | None = None, snapshot_id: str | None = None) -> dict[str, object]:
        self._assert_context(context)
        self._detail_binding(context, generation, process_instance_id, registry_epoch, context_identity, snapshot_id)
        with self._lock:
            current = self._snapshots.get(context.project_id)
        commits = (current or {}).get("commits", [])
        if not any(isinstance(item, dict) and commit in {item.get("hash"), item.get("shortHash")} for item in commits):
            raise ServiceError("NOT_FOUND", 404)
        try:
            result = self.git_factory(context).commit_detail(commit)
            self._detail_bounded(result)
            return result
        except ServiceError:
            raise
        except Exception as exc:
            if getattr(exc, "code", None) in {"GIT_OUTPUT_LIMIT", "OUTPUT_LIMIT"}:
                raise ServiceError("OUTPUT_LIMIT", 413) from exc
            raise service_error_from(exc) from exc

    def pull_request_detail(self, context: RepositoryContext, number: int, generation: int | None = None,
                            process_instance_id: str | None = None, registry_epoch: int | None = None,
                            context_identity: str | None = None, snapshot_id: str | None = None) -> dict[str, object]:
        self._assert_context(context)
        self._detail_binding(context, generation, process_instance_id, registry_epoch, context_identity, snapshot_id)
        with self._lock:
            current = self._snapshots.get(context.project_id)
        github = (current or {}).get("github", {})
        pull_requests = github.get("pullRequests", []) if isinstance(github, dict) else []
        if not any(isinstance(item, dict) and item.get("number") == number for item in pull_requests):
            raise ServiceError("NOT_FOUND", 404)
        result = self.github_factory(context).pull_request_detail(number)
        self._detail_bounded(result)
        return result
