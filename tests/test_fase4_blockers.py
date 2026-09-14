import json
import re
import threading
from datetime import datetime
from pathlib import Path

import pytest

import endpoints
from errors import ServiceError
from registry import ProjectRecord, Registry
from repository_context import RepositoryContext
from service import ProjectService
from snapshot import fingerprint


class Git:
    def __init__(self, detail=None):
        self.detail = detail or {"hash": "a" * 40, "files": [], "diff": "ok"}

    def working_tree(self):
        return {"files": []}

    def branches(self):
        return {"local": [{"name": "main", "current": True}], "remote": []}

    def commits(self, ref):
        return [{"hash": "a" * 40, "shortHash": "a" * 7, "subject": "Initial"}]

    def commit_detail(self, commit):
        return self.detail


class Github:
    def __init__(self, detail=None, entered=None, release=None):
        self.detail = detail or {"number": 1, "title": "PR"}
        self.entered = entered
        self.release = release

    def pull_requests(self):
        if self.entered:
            self.entered.set()
        if self.release:
            self.release.wait(timeout=2)
        return []

    def issues(self):
        return []

    def pull_request_detail(self, number):
        return self.detail


class MembershipGit(Git):
    def commits(self, ref):
        return [{"hash": "a" * 40, "shortHash": "a" * 7, "subject": "Initial"}]


class MembershipGithub(Github):
    def pull_requests(self):
        return [{"number": 7, "title": "PR"}]


def make_service(tmp_path: Path, github_factory=None, git=None):
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,), epoch=4)
    context = RepositoryContext("demo", "Demo", tmp_path, "origin", "main", "https://github.com/example/repo.git", registry.epoch)
    service = ProjectService(registry, lambda _ctx: git or Git(), github_factory or (lambda _ctx: Github()))
    return service, context


def binding(snapshot, service, context):
    return (snapshot["localGeneration"], service.process_instance_id, snapshot["registryEpoch"],
            snapshot["contextIdentity"], snapshot["snapshotId"])


def test_endpoint_runtime_keeps_registry_and_service_state(monkeypatch):
    registry = Registry((), ())
    monkeypatch.setattr(endpoints, "load_default_registry", lambda: registry)
    monkeypatch.setattr(endpoints, "_REGISTRY", None)
    monkeypatch.setattr(endpoints, "_PROJECT_SERVICE", None)
    first = endpoints._service()
    second = endpoints._service()
    assert first is second
    assert first.registry is registry


def test_endpoint_runtime_reloads_registry_without_replacing_service(monkeypatch):
    first_registry = Registry((), (), epoch=1)
    second_registry = Registry((), (), epoch=2)
    registries = iter((first_registry, second_registry))
    monkeypatch.setattr(endpoints, "load_default_registry", lambda: next(registries))
    monkeypatch.setattr(endpoints, "_REGISTRY", None)
    monkeypatch.setattr(endpoints, "_PROJECT_SERVICE", None)
    first = endpoints._service()
    second = endpoints._service()
    assert first is second
    assert second.registry is second_registry
    assert second._generation == {}


def test_detail_rejects_identifier_not_in_current_snapshot(tmp_path: Path):
    service, context = make_service(tmp_path, github_factory=lambda _ctx: MembershipGithub(), git=MembershipGit())
    snapshot = service.snapshot(context)
    args = binding(snapshot, service, context)
    with pytest.raises(ServiceError) as commit_error:
        service.commit_detail(context, "b" * 40, *args)
    assert commit_error.value.code == "NOT_FOUND"
    with pytest.raises(ServiceError) as pr_error:
        service.pull_request_detail(context, 8, *args)
    assert pr_error.value.code == "NOT_FOUND"


def test_local_fallback_preserves_last_updated_and_stale_metadata(tmp_path: Path):
    service, context = make_service(tmp_path)
    first = service.snapshot(context)
    service.git_factory = lambda _ctx: (_ for _ in ()).throw(RuntimeError("offline"))
    second = service.snapshot(context)
    assert second["lastUpdated"] == first["lastUpdated"]
    assert second["localStatus"] == "stale"
    assert second["capabilities"]["workingTree"]["stale"] is True
    assert second["refreshing"] is False


def test_detail_requires_current_snapshot_binding(tmp_path: Path):
    service, context = make_service(tmp_path)
    snapshot = service.snapshot(context)
    args = binding(snapshot, service, context)
    assert service.commit_detail(context, "a" * 40, *args) == {"hash": "a" * 40, "files": [], "diff": "ok"}
    with pytest.raises(ServiceError, match="STALE_CONTEXT"):
        service.commit_detail(context, "a" * 40, args[0], args[1], args[2], args[3], "old-snapshot")
    newer = service.snapshot(context)
    with pytest.raises(ServiceError, match="STALE_CONTEXT"):
        service.commit_detail(context, "a" * 40, *args)
    assert service.commit_detail(context, "a" * 40, *binding(newer, service, context))["hash"] == "a" * 40


def test_detail_output_over_one_mib_is_rejected_not_truncated(tmp_path: Path):
    service, context = make_service(tmp_path, git=Git({"hash": "a" * 40, "files": [], "diff": "x" * (1024 * 1024 + 1)}))
    snapshot = service.snapshot(context)
    with pytest.raises(ServiceError) as exc:
        service.commit_detail(context, "a" * 40, *binding(snapshot, service, context))
    assert exc.value.code == "OUTPUT_LIMIT"
    assert exc.value.status_code == 413


def test_github_cache_write_is_generation_guarded(tmp_path: Path):
    entered = threading.Event()
    release = threading.Event()
    calls = [0]

    def github(_ctx):
        calls[0] += 1
        return Github(entered=entered if calls[0] == 1 else None, release=release if calls[0] == 1 else None)

    service, context = make_service(tmp_path, github_factory=github)
    result = {}
    def run_first():
        try:
            result["first"] = service.snapshot(context)
        except ServiceError as exc:
            result["error"] = exc.code

    first = threading.Thread(target=run_first)
    first.start()
    assert entered.wait(timeout=2)
    with pytest.raises(ServiceError, match="LOCKED"):
        service.snapshot(context)
    release.set()
    first.join(timeout=2)
    assert "first" in result
    assert service._github_good["demo"][1]["status"] == "ready"


def test_final_marker_change_during_github_retries_complete_composition(tmp_path: Path):
    markers = [
        {"HEAD": "one", "status": "same", "refs/remotes": "same"},
        {"HEAD": "one", "status": "same", "refs/remotes": "same"},
        {"HEAD": "two", "status": "same", "refs/remotes": "same"},
        {"HEAD": "three", "status": "same", "refs/remotes": "same"},
        {"HEAD": "three", "status": "same", "refs/remotes": "same"},
        {"HEAD": "three", "status": "same", "refs/remotes": "same"},
    ]
    service, context = make_service(tmp_path, git=type("MarkedGit", (Git,), {
        "local_fingerprints": lambda self: markers.pop(0),
    })())
    snapshot = service.snapshot(context)
    assert snapshot["head"] == "a" * 40
    assert len(markers) == 0


def test_snapshot_capability_limit_isolated(tmp_path: Path):
    huge = [{"path": "x", "status": "M", "padding": "x" * (2 * 1024 * 1024)}]
    class HugeGit(Git):
        def working_tree(self):
            return {"files": huge}

    service, context = make_service(tmp_path, git=HugeGit())
    snapshot = service.snapshot(context)
    assert snapshot["capabilities"]["workingTree"]["status"] == "error"
    assert snapshot["capabilities"]["workingTree"]["errorCode"] == "OUTPUT_LIMIT"
    assert snapshot["workingTree"] == {"files": []}


def test_registry_project_identity_change_invalidates_all_service_state(monkeypatch):
    first_registry = Registry((), (), epoch=1)
    second_registry = Registry((Path("/new-root"),), (), epoch=1)
    registries = iter((first_registry, second_registry))
    monkeypatch.setattr(endpoints, "load_default_registry", lambda: next(registries))
    monkeypatch.setattr(endpoints, "_REGISTRY", None)
    monkeypatch.setattr(endpoints, "_PROJECT_SERVICE", None)
    service = endpoints._service()
    service._generation["demo"] = 3
    service._snapshots["demo"] = {"snapshotId": "old"}
    service._last_good["demo"] = {"snapshotId": "old"}
    service._github_good["demo"] = (0, {"status": "ready"})
    endpoints._service()
    assert service._generation == {}
    assert service._snapshots == {}
    assert service._last_good == {}
    assert service._github_good == {}


def test_refs_only_marker_mutation_retries_snapshot(tmp_path: Path):
    markers = [
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "one", "currentBranch": "main"},
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "one", "currentBranch": "main"},
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "two", "currentBranch": "main"},
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "three", "currentBranch": "main"},
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "three", "currentBranch": "main"},
        {"HEAD": "same", "status": "same", "refs/remotes": "same", "refs/heads": "three", "currentBranch": "main"},
    ]
    service, context = make_service(tmp_path, git=type("MarkedGit", (Git,), {
        "local_fingerprints": lambda self: markers.pop(0),
    })())
    service.snapshot(context)
    assert not markers


def test_output_limit_is_error_for_capabilities_and_aggregate(tmp_path: Path):
    class HugeGithub(Github):
        def pull_requests(self):
            return [{"number": 1, "padding": "x" * (2 * 1024 * 1024)}]

    service, context = make_service(tmp_path, github_factory=lambda _ctx: HugeGithub())
    snapshot = service.snapshot(context)
    assert snapshot["capabilities"]["github"]["status"] == "error"
    assert snapshot["capabilities"]["github"]["errorCode"] == "OUTPUT_LIMIT"


def test_public_detail_params_bind_to_current_snapshot(tmp_path: Path):
    service, context = make_service(tmp_path)
    snapshot = service.snapshot(context)
    assert service.commit_detail(context, "a" * 40) == {"hash": "a" * 40, "files": [], "diff": "ok"}


def test_aggregate_output_limit_is_bounded_error(tmp_path: Path, monkeypatch):
    import service as service_module
    service, context = make_service(tmp_path)
    monkeypatch.setattr(service_module, "MAX_AGGREGATE_BYTES", 1)
    with pytest.raises(ServiceError) as exc:
        service.snapshot(context)
    assert exc.value.code == "OUTPUT_LIMIT"
    assert exc.value.status_code == 413


def test_success_envelope_has_opaque_request_id_and_iso_observed_at() -> None:
    first = endpoints._ok({"safe": True})
    second = endpoints._ok({"safe": True})
    assert first["meta"]["schemaVersion"] == 1
    assert re.fullmatch(r"[A-Za-z0-9_-]{16,}", first["meta"]["requestId"])
    assert first["meta"]["requestId"] != second["meta"]["requestId"]
    observed_at = first["meta"]["observedAt"]
    assert isinstance(observed_at, str)
    assert datetime.fromisoformat(observed_at).tzinfo is not None
    assert "safe" in json.dumps(first)
    assert "token" not in json.dumps(first).lower()


SNAPSHOT_KEYS = {
    "schemaVersion", "project", "snapshotId", "head", "observedAt", "refreshing",
    "lastUpdated", "capabilities", "workingTree", "branches", "commits",
    "focusDefaults", "github", "warnings",
}
CAPABILITY_KEYS = {"status", "stale", "source", "observedAt", "generation", "value"}


def test_snapshot_contract_fixtures_validate_envelope_and_capability_shapes() -> None:
    fixture_dir = Path(__file__).parent / "fixtures" / "contracts"
    for name in ("snapshot-ready.json", "snapshot-partial.json"):
        envelope = json.loads((fixture_dir / name).read_text())
        assert set(envelope) == {"ok", "data", "meta"}
        assert envelope["ok"] is True
        assert set(envelope["meta"]) == {"schemaVersion", "requestId", "observedAt"}
        assert envelope["meta"]["schemaVersion"] == 1
        assert envelope["meta"]["requestId"]
        datetime.fromisoformat(envelope["meta"]["observedAt"])
        snapshot = envelope["data"]
        assert SNAPSHOT_KEYS <= set(snapshot)
        datetime.fromisoformat(snapshot["observedAt"])
        datetime.fromisoformat(snapshot["lastUpdated"])
        for capability in snapshot["capabilities"].values():
            assert CAPABILITY_KEYS <= set(capability)
            assert capability["status"] in {"ready", "empty", "stale", "unavailable", "error"}
            assert isinstance(capability["stale"], bool)
            assert isinstance(capability["generation"], int)
            datetime.fromisoformat(capability["observedAt"])


def test_actual_host_dispatcher_serializes_plugin_success_without_leaking_secrets(monkeypatch) -> None:
    import sys

    host_server = Path("/home/cyclone/Developer/third_party/hermes-mission-control/server")
    sys.path.insert(0, str(host_server))
    try:
        from plugins.loader import PluginLoader, dispatch_plugin_request
        loader = PluginLoader(internal_dir=Path("/nonexistent"), external_dir=Path("/home/cyclone/Developer/projects"))
        assert loader.load_plugin("mc-project-plugin")
        monkeypatch.setattr("plugins.loader._loader", loader)
        module = loader.get_module("mc-project-plugin")
        empty_registry = Registry((), ())
        monkeypatch.setattr(module, "_runtime", lambda: (empty_registry, None))
        handled, response, status = dispatch_plugin_request(
            "GET", "/api/local/mc-project-plugin/projects/catalog", {}, {}, auth=None
        )
    finally:
        sys.path.remove(str(host_server))
    assert handled is True
    assert status == 200
    assert response["ok"] is True
    assert set(response["meta"]) == {"schemaVersion", "requestId", "observedAt"}
    assert "MC_PROJECT_GITHUB_TOKEN" not in json.dumps(response)
