from pathlib import Path
import threading
import pytest

from registry import ProjectRecord, Registry
from repository_context import RepositoryContext
from service import ProjectService, ServiceError
from github_adapter import GitHubAdapterError


class FakeGit:
    def working_tree(self): return {"files": [{"path": "README.md", "status": "M"}]}
    def branches(self): return {"local": [{"name": "main", "current": True}], "remote": [], "remoteAlias": "origin", "repository": "https://github.com/example/repo.git"}
    def commits(self, ref): return [{"hash": "a" * 40, "shortHash": "a" * 7, "subject": "Initial", "author": "Test", "date": "2026-09-14T10:00:00+00:00", "merge": False}]
    def file_diff(self, path): return "diff --git a/README.md b/README.md\n+change"


class FakeGithub:
    def pull_requests(self): return [{"number": 1, "title": "PR", "url": "https://github.com/example/repo/pull/1"}]
    def issues(self): return [{"number": 2, "title": "Issue", "url": "https://github.com/example/repo/issues/2"}]


def context(tmp_path: Path) -> RepositoryContext:
    return RepositoryContext("demo", "Demo", tmp_path, "origin", "main", "https://github.com/example/repo.git")


def test_snapshot_contains_local_and_github_capabilities(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    service = ProjectService(registry, lambda _ctx: FakeGit(), lambda _ctx: FakeGithub())
    snapshot = service.snapshot(context(tmp_path))
    assert snapshot["project_id"] == "demo"
    assert snapshot["workingTree"]["files"][0]["path"] == "README.md"
    assert snapshot["github"]["pullRequests"][0]["number"] == 1
    assert snapshot["capabilities"]["workingTree"]["status"] == "ready"
    assert snapshot["fileDiffs"]["README.md"].startswith("diff --git")
    assert snapshot["branchLogs"]["main"][0]["hash"] == "a" * 40


def test_github_failure_isolated_from_local_snapshot(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    service = ProjectService(registry, lambda _ctx: FakeGit(), lambda _ctx: (_ for _ in ()).throw(RuntimeError("offline")))
    snapshot = service.snapshot(context(tmp_path))
    assert snapshot["workingTree"]["files"]
    assert snapshot["github"]["status"] == "unavailable"


def test_unknown_context_is_rejected(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    service = ProjectService(registry, lambda _ctx: FakeGit(), lambda _ctx: FakeGithub())
    bad = RepositoryContext("other", "Other", tmp_path, "origin", "main", "https://github.com/example/repo.git")
    try:
        service.snapshot(bad)
    except ServiceError as exc:
        assert str(exc) == "UNKNOWN_PROJECT"
    else:
        raise AssertionError("expected ServiceError")


def test_snapshot_has_process_registry_generation_and_fingerprints(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,), epoch=7)
    service = ProjectService(registry, lambda _ctx: FakeGit(), lambda _ctx: FakeGithub())
    snapshot = service.snapshot(RepositoryContext("demo", "Demo", tmp_path, "origin", "main", "https://github.com/example/repo.git", 7))
    assert snapshot["processInstanceId"] == service.process_instance_id
    assert snapshot["registryEpoch"] == 7
    assert isinstance(snapshot["localGeneration"], int)
    assert set(snapshot["fingerprints"]) >= {"workingTree", "branches", "commits", "local"}
    assert snapshot["fingerprints"]["local"]


def test_failed_github_refresh_preserves_last_known_good(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    available = {"value": True}

    def github(_ctx):
        if not available["value"]:
            raise GitHubAdapterError("GITHUB_TIMEOUT")
        return FakeGithub()

    service = ProjectService(registry, lambda _ctx: FakeGit(), github)
    first = service.snapshot(context(tmp_path))
    available["value"] = False
    second = service.snapshot(context(tmp_path))
    assert second["workingTree"] == first["workingTree"]
    assert second["github"]["status"] == "stale"
    assert second["github"]["pullRequests"] == first["github"]["pullRequests"]
    assert second["capabilities"]["github"]["stale"] is True


def test_context_binding_rejects_changed_identity(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    service = ProjectService(registry, lambda _ctx: FakeGit(), lambda _ctx: FakeGithub())
    bad = RepositoryContext("demo", "Changed", tmp_path, "origin", "main", "https://github.com/example/repo.git")
    with pytest.raises(ServiceError, match="CONTEXT_MISMATCH"):
        service.snapshot(bad)


def test_concurrent_refresh_returns_last_known_good_as_refreshing(tmp_path: Path) -> None:
    record = ProjectRecord("demo", "Demo", tmp_path, True, "origin", "main")
    registry = Registry((tmp_path,), (record,))
    entered = threading.Event()
    release = threading.Event()

    class BlockingGit(FakeGit):
        def working_tree(self):
            entered.set()
            release.wait(timeout=2)
            return super().working_tree()

    service = ProjectService(registry, lambda _ctx: BlockingGit(), lambda _ctx: FakeGithub())
    # Seed a last-known-good snapshot with a non-blocking read.
    service.git_factory = lambda _ctx: FakeGit()
    previous = service.snapshot(context(tmp_path))
    service.git_factory = lambda _ctx: BlockingGit()
    result = {}
    worker = threading.Thread(target=lambda: result.setdefault("value", service.snapshot(context(tmp_path))))
    worker.start()
    assert entered.wait(timeout=2)
    concurrent = service.snapshot(context(tmp_path))
    assert concurrent["refreshing"] is True
    assert concurrent["snapshotId"] == previous["snapshotId"]
    release.set()
    worker.join(timeout=2)
    assert not worker.is_alive()
