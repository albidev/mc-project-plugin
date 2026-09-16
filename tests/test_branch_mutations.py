from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from errors import ServiceError
from registry import ProjectRecord, Registry
from repository_context import RepositoryContext
from service import ProjectService


_BUILDER = Path(__file__).parent / "fixtures" / "mutation-repo-builder.py"
_spec = importlib.util.spec_from_file_location("mutation_repo_builder", _BUILDER)
assert _spec and _spec.loader
_builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_builder)
create_repo = _builder.create_repo


class NoopGithub:
    def pull_requests(self): return []
    def issues(self): return []


def setup_service(tmp_path: Path):
    repo = create_repo(tmp_path / "repo")
    registry = Registry((tmp_path,), (ProjectRecord("demo", "Demo", repo, True, "origin", "main"),), epoch=1)
    context = RepositoryContext("demo", "Demo", repo, "origin", "main", str(tmp_path / "repo-remote.git"), 1)
    service = ProjectService(registry, __import__("git_adapter").GitAdapter, lambda _ctx: NoopGithub())
    from branch_mutations import BranchMutationService
    # The disposable fixture uses a local filesystem remote, while production
    # context resolution intentionally accepts only network remotes. Keep the
    # mutation tests focused on the fixture and inject the revalidation seam.
    return repo, context, service, BranchMutationService(
        service, context_resolver=lambda _registry, _project_id: context
    )


def test_switch_branch_changes_fixture_and_verifies_readback(tmp_path):
    repo, context, service, mutations = setup_service(tmp_path)
    # Seed the existing branch in this disposable fixture; switch must not create it.
    import subprocess
    subprocess.run(["git", "-C", str(repo), "branch", "feature/demo"], check=True, capture_output=True)
    result = mutations.switch(context, "feature/demo")
    assert result["branch"] == "feature/demo"
    assert result["status"] == "clean"
    assert result["tracking"] is None
    assert service._generation["demo"] == 1
    assert service._last_good.get("demo") is None
    assert (repo / ".git" / "HEAD").read_text().strip() == "ref: refs/heads/feature/demo"


def test_create_branch_creates_and_checks_out_fixture(tmp_path):
    _repo, context, _service, mutations = setup_service(tmp_path)
    result = mutations.create(context, "feature/new")
    assert result["branch"] == "feature/new"
    assert result["created"] is True


def test_switch_to_branch_with_different_commit_verifies(tmp_path):
    repo, context, _service, mutations = setup_service(tmp_path)
    import subprocess
    # feature/demo e' creata sul commit iniziale; main avanza su un commit diverso.
    subprocess.run(["git", "-C", str(repo), "branch", "feature/demo"], check=True, capture_output=True)
    (repo / "second.txt").write_text("second\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "second.txt"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "second commit"], check=True, capture_output=True)
    result = mutations.switch(context, "feature/demo")
    assert result["branch"] == "feature/demo"
    assert result["status"] == "clean"
    assert result["created"] is False
    assert result["verified"] is True
    # HEAD ora coincide con la destinazione richiesta, non piu' con il vecchio HEAD.
    target = subprocess.run(["git", "-C", str(repo), "rev-parse", "feature/demo"], check=True, capture_output=True, text=True).stdout.strip()
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    assert head == target
    assert not (repo / "second.txt").exists()


def test_switch_with_conflicting_changes_is_definitive_4xx(tmp_path):
    repo, context, service, mutations = setup_service(tmp_path)
    import subprocess
    # feature/demo modifica README; su main una modifica locale confligge.
    subprocess.run(["git", "-C", str(repo), "branch", "feature/demo"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "feature/demo"], check=True, capture_output=True)
    (repo / "README.md").write_text("fixture demo\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "README.md"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "demo change"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "main"], check=True, capture_output=True)
    (repo / "README.md").write_text("fixture local\n", encoding="utf-8")
    with pytest.raises(ServiceError) as exc:
        mutations.switch(context, "feature/demo")
    assert (exc.value.code, exc.value.status_code) == ("GIT_COMMAND_FAILED", 409)
    # Rifiuto definitivo: la mutazione non resta indeterminata e il repo e' intatto.
    assert service._mutation_state.get("demo") == "idle"
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    assert head == subprocess.run(["git", "-C", str(repo), "rev-parse", "main"], check=True, capture_output=True, text=True).stdout.strip()
    assert (repo / "README.md").read_text() == "fixture local\n"


def test_switch_carries_uncommitted_untracked_when_git_accepts(tmp_path):
    repo, context, _service, mutations = setup_service(tmp_path)
    import subprocess
    subprocess.run(["git", "-C", str(repo), "branch", "feature/demo"], check=True, capture_output=True)
    (repo / "notes.txt").write_text("work in progress\n", encoding="utf-8")
    result = mutations.switch(context, "feature/demo")
    assert result["branch"] == "feature/demo"
    assert result["status"] == "dirty"
    assert result["verified"] is True
    assert (repo / "notes.txt").read_text() == "work in progress\n"


def test_dirty_fixture_with_missing_branch_is_not_found(tmp_path):
    repo, context, _service, mutations = setup_service(tmp_path)
    (repo / "README.md").write_text("dirty\n", encoding="utf-8")
    with pytest.raises(ServiceError) as exc:
        mutations.switch(context, "does-not-exist")
    # Il preflight WORKTREE_DIRTY non maschera piu' errori applicativi determinati.
    assert (exc.value.code, exc.value.status_code) == ("BRANCH_NOT_FOUND", 404)
    assert "dirty" in (repo / "README.md").read_text()


@pytest.mark.parametrize("name", ["bad..name", "-bad", "bad/", "bad//name", "bad@{x}", ".hidden", "bad/.leaf", "feature.lock/child", "feature/child.lock"])
def test_invalid_branch_names_are_rejected_before_git(tmp_path, name):
    _repo, context, _service, mutations = setup_service(tmp_path)
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, name)
    assert (exc.value.code, exc.value.status_code) == ("INVALID_BRANCH_NAME", 400)


def test_missing_branch_is_not_found(tmp_path):
    _repo, context, _service, mutations = setup_service(tmp_path)
    with pytest.raises(ServiceError) as exc:
        mutations.switch(context, "does-not-exist")
    assert (exc.value.code, exc.value.status_code) == ("BRANCH_NOT_FOUND", 404)


def test_existing_branch_is_conflict(tmp_path):
    _repo, context, _service, mutations = setup_service(tmp_path)
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "main")
    assert (exc.value.code, exc.value.status_code) == ("BRANCH_ALREADY_EXISTS", 409)


def test_queued_mutation_rechecks_status_immediately_after_gate(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    import threading

    acquired = threading.Event()
    release = threading.Event()

    def hold_gate():
        with service.mutation_gate(context):
            acquired.set()
            release.wait(timeout=2)

    holder = threading.Thread(target=hold_gate)
    holder.start()
    assert acquired.wait(timeout=2)

    result = {}

    def run_queued_mutation():
        try:
            mutations.create(context, "feature/queued")
        except ServiceError as exc:
            result["error"] = (exc.code, exc.status_code)

    queued = threading.Thread(target=run_queued_mutation)
    queued.start()
    with service._lock:
        service._mutation_state[context.project_id] = "running"
    release.set()
    holder.join(timeout=2)
    queued.join(timeout=2)

    assert not queued.is_alive()
    assert result["error"] == ("MUTATION_IN_FLIGHT", 409)
    assert not (context.path / ".git" / "refs" / "heads" / "feature" / "queued").exists()
