from __future__ import annotations

import threading

import pytest

from errors import ServiceError
from registry import ProjectRecord, Registry
from repository_context import RepositoryContextError
from test_branch_mutations import setup_service
from branch_mutations import BranchMutationService


def test_mutation_state_blocks_refresh_and_second_mutation(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    entered = threading.Event()
    release = threading.Event()

    class BlockingRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            entered.set()
            assert release.wait(timeout=2)
            return ""

    mutations.runner_factory = BlockingRunner
    result = {}
    worker = threading.Thread(
        target=lambda: result.setdefault("error", _run_mutation(mutations, context))
    )
    worker.start()
    assert entered.wait(timeout=2)
    with pytest.raises(ServiceError, match="MUTATION_IN_FLIGHT"):
        service.snapshot(context)
    with pytest.raises(ServiceError, match="MUTATION_IN_FLIGHT"):
        mutations.create(context, "feature/second")
    release.set()
    worker.join(timeout=2)
    assert not worker.is_alive()
    assert result["error"] == "READBACK_MISMATCH"
    with pytest.raises(ServiceError, match="MUTATION_INDETERMINATE"):
        service.snapshot(context)


def _run_mutation(mutations, context):
    try:
        mutations.create(context, "feature/first")
    except ServiceError as exc:
        return exc.code
    return "unexpected-success"


@pytest.mark.parametrize("fingerprints", [
    {"HEAD": "not-a-hash"},
    {"HEAD": "a" * 39},
    {},
])
def test_mutation_read_rejects_malformed_or_missing_head(tmp_path, fingerprints):
    _repo, context, _service, _mutations = setup_service(tmp_path)

    class FakeGit:
        def working_tree(self):
            return {"files": []}

        def branches(self):
            return {"local": [{"name": "main", "current": True}]}

        def local_fingerprints(self):
            return fingerprints

    with pytest.raises(ServiceError) as exc:
        BranchMutationService._read(FakeGit(), context)
    assert (exc.value.code, exc.value.status_code) == ("INDETERMINATE", 409)


def test_failed_mutation_performs_refresh_before_indeterminate(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    service.snapshot(context)
    before_generation = service._generation["demo"]

    class FailingRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            raise ServiceError("GIT_COMMAND_FAILED", 409)

    mutations.runner_factory = FailingRunner
    with pytest.raises(ServiceError, match="INDETERMINATE"):
        mutations.create(context, "feature/fails")
    assert service._generation["demo"] > before_generation
    assert service._mutation_state["demo"] == "indeterminate"
    with pytest.raises(ServiceError, match="MUTATION_INDETERMINATE"):
        mutations.create(context, "feature/again")


def test_raw_runner_runtime_error_is_mapped_and_state_is_indeterminate(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)

    class ExplodingRunner:
        def __init__(self, _path):
            raise RuntimeError("runner construction failed")

    mutations.runner_factory = ExplodingRunner
    with pytest.raises(ServiceError, match="INDETERMINATE"):
        mutations.create(context, "feature/raw-error")
    assert service._mutation_state["demo"] == "indeterminate"


def test_registry_change_during_command_preserves_disabled_mutation_state(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)

    class RegistryChangingRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            service.update_registry(Registry(
                (tmp_path,),
                (ProjectRecord("demo", "Changed", context.path, False, "origin", "main"),),
                epoch=2,
            ))
            return ""

    mutations.runner_factory = RegistryChangingRunner
    with pytest.raises(ServiceError, match="INDETERMINATE"):
        mutations.create(context, "feature/registry-change")
    assert service._mutation_status("demo") == "indeterminate"


def test_post_command_context_invalidation_is_indeterminate(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    calls = []

    def invalidating_resolver(_registry, _project_id):
        calls.append(True)
        if len(calls) == 1:
            return context
        raise RepositoryContextError("PATH_OUTSIDE_APPROVED_ROOT")

    mutations.context_resolver = invalidating_resolver
    class NoopRunner:
        def __init__(self, _path):
            pass

        def run(self, _args):
            return ""

    mutations.runner_factory = NoopRunner
    with pytest.raises(ServiceError, match="INDETERMINATE"):
        mutations.create(context, "feature/context-invalid")
    assert calls == [True, True]
    assert service._mutation_status("demo") == "indeterminate"
