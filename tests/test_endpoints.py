import json
from pathlib import Path

import pytest

import endpoints
from errors import ServiceError
from registry import Registry
from tests.test_fase4_blockers import Github, MembershipGithub, make_service


def test_direct_missing_auth_is_rejected() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.listProjects({}, {})


def test_arbitrary_auth_objects_are_rejected() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.listProjects({}, {}, {"trusted": True})


def test_duplicate_project_id_query_is_rejected() -> None:
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.getSnapshot({}, {"project_id": ["demo", "other"]}, None)


def test_mutations_resolve_configured_project_in_phase_five() -> None:
    with pytest.raises(ServiceError, match="UNKNOWN_PROJECT"):
        endpoints.createBranch({"project_id": "demo", "name": "feature/name"}, {}, None)


def test_unknown_query_and_non_empty_get_body_are_rejected() -> None:
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.getSnapshot({}, {"project_id": ["demo"], "extra": ["x"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.getSnapshot({"unexpected": True}, {"project_id": ["demo"]}, None)


@pytest.mark.parametrize("endpoint, body", [
    ("switchBranch", {"project_id": "demo", "branch": "feature/name"}),
    ("createBranch", {"project_id": "demo", "name": "feature/name"}),
])
def test_mutations_validate_strict_body_before_execution(endpoint, body):
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        getattr(endpoints, endpoint)({**body, "extra": "reject"}, {}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        getattr(endpoints, endpoint)(body, {"unexpected": ["x"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        getattr(endpoints, endpoint)({key: ("bad..name" if key != "project_id" else value)
                                      for key, value in body.items()}, {}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        getattr(endpoints, endpoint)({key: ("feature.lock/child" if key != "project_id" else value)
                                      for key, value in body.items()}, {}, None)
    with pytest.raises(ServiceError, match="UNKNOWN_PROJECT"):
        getattr(endpoints, endpoint)(body, {}, None)


@pytest.mark.parametrize("endpoint, params", [
    ("getCommitDetail", {"project_id": ["demo"], "commit": ["a" * 40]}),
    ("getPullRequestDetail", {"project_id": ["demo"], "pull_request": ["7"]}),
])
def test_detail_endpoints_accept_declared_public_params(monkeypatch, tmp_path, endpoint, params):
    github_factory = (lambda _ctx: MembershipGithub()) if endpoint == "getPullRequestDetail" else None
    service, context = make_service(tmp_path, github_factory=github_factory)
    registry = Registry((tmp_path,), (), epoch=4)
    # The endpoint contract test isolates transport parsing; the service still
    # performs its real current-snapshot binding.
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, service))
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: context)
    result = getattr(endpoints, endpoint)({}, params, None)
    assert result["ok"] is True
