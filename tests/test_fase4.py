import json
from pathlib import Path

import pytest

from errors import service_error_from
from git_adapter import GitAdapterError
from github_adapter import GitHubAdapterError
from registry import ProjectRecord, Registry
from repository_context import RepositoryContext
from repository_context import RepositoryContextError
from service import MAX_AGGREGATE_BYTES, ProjectService, ServiceError


class MarkedGit:
    def __init__(self, markers):
        self.markers = iter(markers)

    def local_fingerprints(self):
        return next(self.markers)

    def working_tree(self):
        return {"files": [{"path": "README.md", "status": "M"}]}

    def branches(self):
        return {"local": [{"name": "main", "current": True}], "remote": []}

    def commits(self, ref):
        return [{"hash": "a" * 40, "shortHash": "a" * 7, "subject": "Initial", "author": "Test", "date": "2026-09-14T10:00:00+00:00", "merge": False}]


class Github:
    def pull_requests(self): return []
    def issues(self): return []


def make_service(tmp_path: Path, git):
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    context = RepositoryContext("demo", "Demo", tmp_path, "origin", "main", "https://github.com/example/repo.git")
    return ProjectService(registry, lambda _ctx: git, lambda _ctx: Github()), context


def test_unstable_local_read_retries_once_and_reports_unstable(tmp_path: Path) -> None:
    markers = [{"HEAD": "one", "status": "same", "refs/remotes": "same"},
               {"HEAD": "two", "status": "same", "refs/remotes": "same"},
               {"HEAD": "three", "status": "same", "refs/remotes": "same"},
               {"HEAD": "four", "status": "same", "refs/remotes": "same"}]
    service, context = make_service(tmp_path, MarkedGit(markers))
    with pytest.raises(ServiceError, match="SNAPSHOT_UNSTABLE"):
        service.snapshot(context)


def test_local_failure_uses_last_good_and_stale_capabilities(tmp_path: Path) -> None:
    class FailingGit(MarkedGit):
        def working_tree(self): raise GitAdapterError("GIT_TIMEOUT")
    good, context = make_service(tmp_path, MarkedGit([{"HEAD": "one", "status": "same", "refs/remotes": "same"}] * 3))
    first = good.snapshot(context)
    failing = ProjectService(good.registry, lambda _ctx: FailingGit([]), lambda _ctx: Github())
    failing._last_good["demo"] = first
    failing._cache_identity["demo"] = failing._cache_key(context)
    second = failing.snapshot(context)
    assert second["localStatus"] == "stale"
    assert second["capabilities"]["workingTree"]["stale"] is True
    assert second["workingTree"] == first["workingTree"]


def test_timeout_mappings_are_gateway_timeouts(tmp_path: Path) -> None:
    assert service_error_from(GitAdapterError("GIT_TIMEOUT")).status_code == 504
    assert service_error_from(GitHubAdapterError("GITHUB_TIMEOUT")).status_code == 504
    assert service_error_from(RepositoryContextError("GIT_TIMEOUT")).status_code == 504


def test_snapshot_has_distinct_local_markers_and_aggregate_bound(tmp_path: Path) -> None:
    service, context = make_service(tmp_path, MarkedGit([{"HEAD": "one", "status": "same", "refs/remotes": "same"}] * 3))
    snapshot = service.snapshot(context)
    assert {"HEAD", "status", "refs/remotes"}.issubset(snapshot["fingerprints"])
    assert len(json.dumps(snapshot).encode()) < MAX_AGGREGATE_BYTES


def test_error_fixture_is_host_visible_shape() -> None:
    fixture = Path(__file__).parent / "fixtures" / "contracts" / "error.json"
    value = json.loads(fixture.read_text())
    assert value == {"error": "INVALID_REQUEST", "detail": "INVALID_REQUEST"}
