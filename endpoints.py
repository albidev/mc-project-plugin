"""Mission Control plugin handlers; strict transport/auth boundary."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Callable
from datetime import datetime, timezone
import re
import secrets
import threading

from config import load_default_registry
from errors import ServiceError, service_error_from
from branch_mutations import BranchMutationService, validate_branch_name
from github_adapter import GitHubAdapter
from git_adapter import GitAdapter
from registry import Registry
from repository_context import resolve_context
from service import ProjectService

_MISSING = object()
_PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_COMMIT = re.compile(r"^[0-9a-fA-F]{40}$")
_MAX_PR = 1_000_000
_RUNTIME_LOCK = threading.RLock()
_REGISTRY = None
_PROJECT_SERVICE = None
_BRANCH_MUTATIONS = None


def _auth(auth: object) -> None:
    # Mission Control authenticates the dispatcher boundary before invoking a
    # plugin handler.  The only trusted direct-handler value is its explicit
    # host sentinel, None; arbitrary objects must never become authority.
    if auth is _MISSING or auth is not None:
        raise ServiceError("UNAUTHENTICATED", 401)


def _get_body(body: object) -> None:
    if body not in ({}, None):
        raise ServiceError("INVALID_REQUEST", 400)


def _mutation_body(body: object, fields: set[str]) -> dict[str, str]:
    if not isinstance(body, dict) or set(body) != fields:
        raise ServiceError("INVALID_REQUEST", 400)
    if any(not isinstance(value, str) or not value or value != value.strip()
           for value in body.values()):
        raise ServiceError("INVALID_REQUEST", 400)
    project_id = body["project_id"]
    branch = body.get("branch", body.get("name"))
    if not _PROJECT_ID.fullmatch(project_id) or not isinstance(branch, str):
        raise ServiceError("INVALID_REQUEST", 400)
    validate_branch_name(branch)
    return body


def _params(params: object, allowed: set[str]) -> Mapping[str, list[str]]:
    if not isinstance(params, Mapping):
        raise ServiceError("INVALID_REQUEST", 400)
    if any(not isinstance(key, str) or key not in allowed for key in params):
        raise ServiceError("INVALID_REQUEST", 400)
    for key, values in params.items():
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise ServiceError("INVALID_REQUEST", 400)
    return params


def _safe_optional_identifier(value: str | None) -> bool:
    return value is None or (value.isascii() and 0 < len(value) <= 256 and all(ord(char) >= 32 for char in value))


def _one(params: Mapping[str, list[str]], name: str, required: bool = True) -> str | None:
    values = params.get(name, [])
    if (required and len(values) != 1) or (not required and len(values) > 1):
        raise ServiceError("INVALID_REQUEST", 400)
    if not values:
        return None
    value = values[0]
    if not value or value != value.strip():
        raise ServiceError("INVALID_REQUEST", 400)
    return value


def _runtime() -> tuple[Registry, ProjectService]:
    global _REGISTRY, _PROJECT_SERVICE, _BRANCH_MUTATIONS
    with _RUNTIME_LOCK:
        loaded = load_default_registry()
        if _PROJECT_SERVICE is None:
            _REGISTRY = loaded
            _PROJECT_SERVICE = ProjectService(_REGISTRY, GitAdapter, lambda ctx: GitHubAdapter(ctx.remote_url, remote_alias=ctx.remote))
            _BRANCH_MUTATIONS = BranchMutationService(_PROJECT_SERVICE)
        elif _REGISTRY != loaded:
            _REGISTRY = loaded
            _PROJECT_SERVICE.update_registry(loaded)
        assert _REGISTRY is not None
        assert _BRANCH_MUTATIONS is not None
        return _REGISTRY, _PROJECT_SERVICE


def _service() -> ProjectService:
    return _runtime()[1]


def _branch_mutations() -> BranchMutationService:
    _runtime()
    assert _BRANCH_MUTATIONS is not None
    return _BRANCH_MUTATIONS


def _run(operation: Callable[[], dict[str, object]]) -> dict[str, object]:
    try:
        return operation()
    except Exception as exc:
        if isinstance(exc, ServiceError):
            public = {"BRANCH_NOT_FOUND": ("NOT_FOUND", 404), "BRANCH_ALREADY_EXISTS": ("INVALID_REQUEST", 400)}.get(exc.code)
            if public is not None:
                raise ServiceError(public[0], public[1]) from exc
            raise service_error_from(exc) from exc
        mapped = service_error_from(exc)
        raise mapped from exc


def _ok(data: object) -> dict[str, object]:
    return {
        "ok": True,
        "data": data,
        "meta": {
            "schemaVersion": 1,
            "requestId": secrets.token_urlsafe(18),
            "observedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


def listProjects(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth)
    _get_body(body)
    _params(params, set())
    return _run(lambda: _ok([{"project_id": p.project_id, "name": p.name, "enabled": p.enabled, "remote": p.remote, "default_branch": p.default_branch} for p in _runtime()[0].projects if p.enabled]))

def getSnapshot(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth); _get_body(body)
    values = _params(params, {"project_id", "recovery"})
    project_id = _one(values, "project_id")
    recovery = _one(values, "recovery", required=False)
    if recovery not in {None, "true"}:
        raise ServiceError("INVALID_REQUEST", 400)
    if not project_id or not _PROJECT_ID.fullmatch(project_id):
        raise ServiceError("INVALID_REQUEST", 400)
    def operation() -> dict[str, object]:
        registry, service = _runtime()
        context = resolve_context(registry, project_id)
        if recovery == "true":
            service.recover_mutation(context)
        return _ok(service.snapshot(context, _allow_recovery=recovery == "true"))
    return _run(operation)


def getCommitDetail(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth); _get_body(body)
    values = _params(params, {"project_id", "commit", "local_generation", "processInstanceId", "registryEpoch", "contextIdentity", "snapshotId"})
    project_id, commit = _one(values, "project_id"), _one(values, "commit")
    generation = _one(values, "local_generation", required=False)
    process_instance_id = _one(values, "processInstanceId", required=False)
    registry_epoch = _one(values, "registryEpoch", required=False)
    context_identity = _one(values, "contextIdentity", required=False)
    snapshot_id = _one(values, "snapshotId", required=False)
    if not all(_safe_optional_identifier(value) for value in (process_instance_id, context_identity, snapshot_id)):
        raise ServiceError("INVALID_REQUEST", 400)
    if generation is not None and (not generation.isascii() or not generation.isdecimal() or len(generation) > 9 or int(generation) < 1):
        raise ServiceError("INVALID_REQUEST", 400)
    if registry_epoch is not None and (not registry_epoch.isascii() or not registry_epoch.isdecimal() or len(registry_epoch) > 9 or int(registry_epoch) < 1):
        raise ServiceError("INVALID_REQUEST", 400)
    if not project_id or not _PROJECT_ID.fullmatch(project_id) or not commit or not _COMMIT.fullmatch(commit):
        raise ServiceError("INVALID_REQUEST", 400)
    def operation() -> dict[str, object]:
        registry, service = _runtime()
        return _ok(service.commit_detail(resolve_context(registry, project_id), commit, int(generation) if generation else None,
                                          process_instance_id, int(registry_epoch) if registry_epoch else None, context_identity, snapshot_id))
    return _run(operation)


def getPullRequestDetail(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth); _get_body(body)
    values = _params(params, {"project_id", "pull_request", "local_generation", "processInstanceId", "registryEpoch", "contextIdentity", "snapshotId"})
    project_id, number = _one(values, "project_id"), _one(values, "pull_request")
    generation = _one(values, "local_generation", required=False)
    process_instance_id = _one(values, "processInstanceId", required=False)
    registry_epoch = _one(values, "registryEpoch", required=False)
    context_identity = _one(values, "contextIdentity", required=False)
    snapshot_id = _one(values, "snapshotId", required=False)
    if not all(_safe_optional_identifier(value) for value in (process_instance_id, context_identity, snapshot_id)):
        raise ServiceError("INVALID_REQUEST", 400)
    if generation is not None and (not generation.isascii() or not generation.isdecimal() or len(generation) > 9 or int(generation) < 1):
        raise ServiceError("INVALID_REQUEST", 400)
    if registry_epoch is not None and (not registry_epoch.isascii() or not registry_epoch.isdecimal() or len(registry_epoch) > 9 or int(registry_epoch) < 1):
        raise ServiceError("INVALID_REQUEST", 400)
    if not project_id or not _PROJECT_ID.fullmatch(project_id) or not number or not number.isascii() or not number.isdecimal() or len(number) > 7 or not (1 <= int(number) <= _MAX_PR):
        raise ServiceError("INVALID_PULL_REQUEST", 400)
    def operation() -> dict[str, object]:
        registry, service = _runtime()
        context = resolve_context(registry, project_id)
        return _ok(service.pull_request_detail(context, int(number), int(generation) if generation else None,
                                                process_instance_id, int(registry_epoch) if registry_epoch else None, context_identity, snapshot_id))
    return _run(operation)


def switchBranch(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth)
    _params(params, set())
    parsed = _mutation_body(body, {"project_id", "branch"})
    return _run(lambda: _ok(_branch_mutations().switch(resolve_context(_runtime()[0], parsed["project_id"]), parsed["branch"])))


def createBranch(body: dict[str, Any], params: Mapping[str, list[str]], auth: object = _MISSING) -> dict[str, object]:
    _auth(auth)
    _params(params, set())
    parsed = _mutation_body(body, {"project_id", "name"})
    return _run(lambda: _ok(_branch_mutations().create(resolve_context(_runtime()[0], parsed["project_id"]), parsed["name"])))
