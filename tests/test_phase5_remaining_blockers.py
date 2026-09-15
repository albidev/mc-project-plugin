from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

import pytest

import branch_mutations
import endpoints
import git_runner
import repository_context
import signal
from errors import ServiceError
from repository_context import RepositoryContextError
from test_branch_mutations import setup_service


def test_initial_snapshot_refreshes_never_overlap(tmp_path):
    _repo, context, service, _mutations = setup_service(tmp_path)
    entered = threading.Event()
    release = threading.Event()
    reads = 0
    active = 0
    maximum = 0
    lock = threading.Lock()

    class BlockingGit:
        def _read(self):
            nonlocal reads, active, maximum
            with lock:
                reads += 1
                active += 1
                maximum = max(maximum, active)
            entered.set()
            assert release.wait(timeout=2)
            with lock:
                active -= 1

        def working_tree(self):
            self._read()
            return {"files": []}

        def branches(self):
            return {"local": [{"name": "main", "current": True, "tracking": None}], "remote": []}

        def commits(self, _branch):
            return []

    service.git_factory = lambda _context: BlockingGit()
    first_result = {}
    first = threading.Thread(target=lambda: _capture_snapshot(first_result, service, context))
    first.start()
    assert entered.wait(timeout=2)

    second = {}
    worker = threading.Thread(target=lambda: _capture_snapshot(second, service, context))
    worker.start()
    worker.join(timeout=3)
    assert not worker.is_alive()
    assert second["error"] == "LOCKED"
    assert reads == 1
    assert maximum == 1

    release.set()
    first.join(timeout=3)
    assert not first.is_alive()
    assert "value" in first_result


def test_initial_refresh_never_bypasses_mutation_gate_after_local_read(tmp_path):
    _repo, context, service, _mutations = setup_service(tmp_path)
    entered = threading.Event()
    release = threading.Event()
    local_done = threading.Event()
    reads = 0

    class BlockingGit:
        def working_tree(self):
            nonlocal reads
            reads += 1
            entered.set()
            local_done.set()
            return {"files": []}

        def branches(self):
            assert release.wait(timeout=2)
            return {"local": [{"name": "main", "current": True, "tracking": None}], "remote": []}

        def commits(self, _branch):
            return []

    service.git_factory = lambda _context: BlockingGit()
    first_result = {}
    first = threading.Thread(target=lambda: _capture_snapshot(first_result, service, context))
    first.start()
    assert entered.wait(timeout=2)
    assert local_done.wait(timeout=2)

    # The owner may have published its local read but still hold the shared
    # gate. A concurrent caller must not start a second adapter read.
    second_result = {}
    second = threading.Thread(target=lambda: _capture_snapshot(second_result, service, context))
    second.start()
    second.join(timeout=3)
    assert not second.is_alive()
    assert second_result.get("error") in {"LOCKED", "MUTATION_IN_FLIGHT"}
    assert reads == 1
    release.set()
    first.join(timeout=3)
    assert not first.is_alive()


def _capture_snapshot(target, service, context):
    try:
        target["value"] = service.snapshot(context)
    except ServiceError as exc:
        target["error"] = exc.code


def test_pre_command_context_revalidation_blocks_git(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    calls = []

    def invalidating_resolver(_registry, _project_id):
        calls.append(True)
        raise RepositoryContextError("PATH_OUTSIDE_APPROVED_ROOT")

    class MustNotRun:
        def __init__(self, _path):
            raise AssertionError("git command must not start")

    mutations.context_resolver = invalidating_resolver
    mutations.runner_factory = MustNotRun
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/pre-command")
    assert exc.value.code == "UNKNOWN_PROJECT"
    assert exc.value.status_code == 404
    assert calls == [True]
    assert service._mutation_status("demo") == "idle"


def test_pre_command_state_change_blocks_git_dispatch(tmp_path):
    repo, context, service, mutations = setup_service(tmp_path)
    calls = []

    def changing_resolver(_registry, _project_id):
        calls.append(True)
        (repo / "README.md").write_text("changed after preflight\n", encoding="utf-8")
        return context

    class MustNotRun:
        def __init__(self, _path):
            raise AssertionError("git command must not start")

    mutations.context_resolver = changing_resolver
    mutations.runner_factory = MustNotRun
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/precondition")
    assert (exc.value.code, exc.value.status_code) == ("WORKTREE_DIRTY", 409)
    assert calls == [True]
    assert service._mutation_status("demo") == "idle"


def test_pre_command_branch_fingerprint_change_blocks_git_dispatch(tmp_path):
    repo, context, service, mutations = setup_service(tmp_path)

    def changing_resolver(_registry, _project_id):
        subprocess.run(
            ["git", "-C", str(repo), "branch", "feature/external"],
            check=True,
            capture_output=True,
        )
        return context

    class MustNotRun:
        def __init__(self, _path):
            raise AssertionError("git command must not start")

    mutations.context_resolver = changing_resolver
    mutations.runner_factory = MustNotRun
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/precondition-ref")
    assert (exc.value.code, exc.value.status_code) == ("READBACK_MISMATCH", 409)
    assert service._mutation_status("demo") == "idle"

def test_deterministic_readback_mismatch_is_conflict(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)

    class NoopRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            return ""

    mutations.runner_factory = NoopRunner
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/noop")
    assert (exc.value.code, exc.value.status_code) == ("READBACK_MISMATCH", 409)
    assert service._mutation_status("demo") == "indeterminate"


def test_runner_wait_timeout_maps_to_git_timeout_and_cleans_group(monkeypatch, tmp_path):
    class WrappedProcess:
        def __init__(self):
            self._process = subprocess.Popen(
                [sys.executable, "-c", ""], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True,
            )
            self.pid = self._process.pid
            self.stdout = self._process.stdout
            self.stderr = self._process.stderr
            self.wait_calls = 0
            self.killed = False

        def poll(self):
            return None

        def wait(self, timeout=None):
            self.wait_calls += 1
            if self.wait_calls == 1:
                raise subprocess.TimeoutExpired("git", timeout)
            return self._process.wait(timeout=timeout)

    process = WrappedProcess()
    monkeypatch.setattr(branch_mutations.subprocess, "Popen", lambda *args, **kwargs: process)
    killed = []
    monkeypatch.setattr(branch_mutations.os, "killpg", lambda pid, sig: killed.append((pid, sig)))

    with pytest.raises(ServiceError) as exc:
        branch_mutations._MutationRunner(tmp_path).run(["switch", "--", "main"])
    assert (exc.value.code, exc.value.status_code) == ("GIT_TIMEOUT", 504)
    assert process.wait_calls >= 2
    assert killed

    process._process.wait(timeout=1)


def test_repository_context_wait_timeout_is_bounded_and_mapped(monkeypatch, tmp_path):
    class WrappedProcess:
        def __init__(self):
            self._process = subprocess.Popen(
                [sys.executable, "-c", ""], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True,
            )
            self.pid = self._process.pid
            self.stdout = self._process.stdout
            self.stderr = self._process.stderr
            self.wait_calls = []

        def poll(self):
            return None

        def wait(self, timeout=None):
            self.wait_calls.append(timeout)
            if len(self.wait_calls) == 1:
                raise subprocess.TimeoutExpired("git", timeout)
            return self._process.wait(timeout=timeout)

    process = WrappedProcess()
    monkeypatch.setattr(repository_context.subprocess, "Popen", lambda *args, **kwargs: process)
    killed = []
    monkeypatch.setattr(repository_context.os, "killpg", lambda pid, sig: killed.append((pid, sig)))
    monkeypatch.setattr(repository_context.time, "monotonic", lambda: 0.0)

    with pytest.raises(RepositoryContextError, match="GIT_TIMEOUT"):
        repository_context._run_git(tmp_path, "test", ["status"])
    assert process.wait_calls and process.wait_calls[0] == 5.0
    assert killed
    process._process.wait(timeout=1)


def test_post_readback_checks_target_branch_tracking(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    import subprocess
    subprocess.run(["git", "-C", str(context.path), "branch", "feature/tracked"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(context.path), "config", "branch.feature/tracked.remote", "origin"], check=True)
    subprocess.run(["git", "-C", str(context.path), "config", "branch.feature/tracked.merge", "refs/heads/feature/tracked"], check=True)

    class NoopRunner:
        def __init__(self, path):
            self.path = path

        def run(self, _args):
            subprocess.run(["git", "-C", str(self.path), "switch", "--", "feature/tracked"],
                           check=True, capture_output=True)
            subprocess.run(["git", "-C", str(self.path), "config", "--unset-all",
                            "branch.feature/tracked.remote"], check=True, capture_output=True)
            return ""

    mutations.runner_factory = NoopRunner
    with pytest.raises(ServiceError) as exc:
        mutations.switch(context, "feature/tracked")
    assert (exc.value.code, exc.value.status_code) == ("READBACK_MISMATCH", 409)


def test_mutation_timeout_is_indeterminate_and_remains_locked_out(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)

    class TimeoutRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            raise ServiceError("GIT_TIMEOUT", 504)

    mutations.runner_factory = TimeoutRunner
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/timeout")
    assert (exc.value.code, exc.value.status_code) == ("INDETERMINATE", 409)
    assert service._mutation_status("demo") == "indeterminate"
    with pytest.raises(ServiceError) as locked:
        mutations.create(context, "feature/retry")
    assert locked.value.code == "MUTATION_INDETERMINATE"


@pytest.mark.parametrize(
    ("stop", "module"),
    [
        (branch_mutations._MutationRunner._stop, branch_mutations),
        (git_runner.GitRunner._stop, git_runner),
        (repository_context._stop_process, repository_context),
    ],
)
def test_stop_attempts_group_cleanup_after_leader_exits(monkeypatch, stop, module):
    class ExitedLeader:
        pid = 43210

        def poll(self):
            return 0

        def wait(self, timeout=None):
            return 0

    attempted = []
    monkeypatch.setattr(module.os, "killpg", lambda pid, sig: attempted.append((pid, sig)))

    stop(ExitedLeader(), 98765)

    assert attempted == [(98765, signal.SIGTERM), (98765, signal.SIGKILL)]


@pytest.mark.parametrize(
    "stop",
    [
        branch_mutations._MutationRunner._stop,
        git_runner.GitRunner._stop,
        repository_context._stop_process,
    ],
)
def test_real_group_cleanup_kills_descendant_after_leader_exits(stop):
    child_code = (
        "import signal, time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "time.sleep(30)"
    )
    leader = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import subprocess, sys; "
            "child = subprocess.Popen([sys.executable, '-c', sys.argv[1]]); "
            "print(child.pid, flush=True)",
            child_code,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    stdout = leader.stdout
    stderr = leader.stderr
    assert stdout is not None and stderr is not None
    child_pid = int(stdout.readline())
    pgid = leader.pid
    assert type(pgid) is int and pgid > 0
    leader.wait(timeout=2)
    os.kill(child_pid, 0)

    stop(leader, pgid)

    deadline = time.monotonic() + 2
    while True:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            break
        if time.monotonic() >= deadline:
            pytest.fail("descendant process group survived cleanup")
        time.sleep(0.01)
    stdout.close()
    stderr.close()


@pytest.mark.parametrize("name", ["feature.lock/child", "feature/child.lock", "feature/.hidden"])
def test_complete_ref_grammar_rejects_lock_and_dot_components(tmp_path, name):
    _repo, context, _service, mutations = setup_service(tmp_path)
    with pytest.raises(ServiceError, match="INVALID_BRANCH_NAME"):
        mutations.create(context, name)


@pytest.mark.parametrize("operation", ["registry", "log"])
def test_complete_ref_grammar_rejects_intermediate_lock_component(tmp_path, operation):
    from ref_validation import is_valid_ref_name

    assert not is_valid_ref_name("release.lock/candidate")
    assert not is_valid_ref_name("release/.candidate")


def test_post_readback_rejects_rogue_ref_change(tmp_path):
    repo, context, service, mutations = setup_service(tmp_path)

    class RogueRunner:
        def __init__(self, path):
            self.path = path

        def run(self, _args):
            subprocess.run(["git", "-C", str(self.path), "branch", "rogue/ref"], check=True,
                           capture_output=True)
            return ""

    mutations.runner_factory = RogueRunner
    with pytest.raises(ServiceError) as exc:
        mutations.create(context, "feature/rogue")
    assert (exc.value.code, exc.value.status_code) == ("READBACK_MISMATCH", 409)


def test_context_output_limit_maps_to_stable_endpoint_error(monkeypatch):
    class StubService:
        def snapshot(self, _context):
            return {}

    monkeypatch.setattr(endpoints, "_runtime", lambda: (object(), StubService()))
    monkeypatch.setattr(
        endpoints,
        "resolve_context",
        lambda _registry, _project_id: (_ for _ in ()).throw(
            RepositoryContextError("GIT_OUTPUT_LIMIT")
        ),
    )

    with pytest.raises(ServiceError) as exc:
        endpoints.getSnapshot({}, {"project_id": ["demo"]}, None)

    assert (exc.value.code, exc.value.status_code) == ("GIT_OUTPUT_LIMIT", 413)
    assert exc.value.message == "GIT_OUTPUT_LIMIT"
