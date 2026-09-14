from __future__ import annotations

import threading

from errors import ServiceError
from registry import ProjectRecord, Registry
from test_branch_mutations import setup_service


def test_context_is_revalidated_after_waiting_for_gate(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    held = service.mutation_gate(context)
    held.__enter__()
    result = {}
    worker = threading.Thread(target=lambda: _capture(result, mutations, context))
    worker.start()
    # The caller entered the wait with a valid context; change the registry
    # before releasing the gate to prove the post-wait check is authoritative.
    service.update_registry(Registry(
        (tmp_path,),
        (ProjectRecord("demo", "Renamed", context.path, True, "origin", "main"),),
        epoch=2,
    ))
    held.__exit__(None, None, None)
    worker.join(timeout=3)
    assert not worker.is_alive()
    assert result["error"] in {"CONTEXT_MISMATCH", "CONTEXT_STALE"}
    assert service._mutation_state.get("demo", "idle") == "idle"


def test_shared_gate_times_out_as_locked(tmp_path):
    _repo, context, service, mutations = setup_service(tmp_path)
    held = service.mutation_gate(context)
    held.__enter__()
    result = {}
    worker = threading.Thread(target=lambda: _capture(result, mutations, context))
    worker.start()
    worker.join(timeout=3)
    held.__exit__(None, None, None)
    assert result["error"] == "LOCKED"


def _capture(result, mutations, context):
    try:
        mutations.create(context, "feature/wait")
    except ServiceError as exc:
        result["error"] = exc.code
    else:
        result["error"] = "unexpected-success"
