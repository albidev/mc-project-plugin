import json
from pathlib import Path

import pytest

import endpoints
from errors import ServiceError, service_error_from
from github_adapter import GitHubAdapterError
from git_adapter import GitAdapterError
from registry import Registry
from tests.test_fase4_blockers import Github, MembershipGithub, make_service


def test_direct_missing_auth_is_rejected() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.listProjects({}, {})




def test_github_auth_unavailable_maps_to_503() -> None:
    error = service_error_from(GitHubAdapterError("GITHUB_AUTH_UNAVAILABLE"))
    assert (error.code, error.status_code) == ("GITHUB_AUTH_UNAVAILABLE", 503)



def test_public_error_table_normalizes_canonical_statuses() -> None:
    assert (service_error_from(ServiceError("INDETERMINATE", 504)).code, service_error_from(ServiceError("INDETERMINATE", 504)).status_code) == ("INDETERMINATE", 409)
    assert (service_error_from(ServiceError("GIT_ARGUMENTS_NOT_ALLOWED", 502)).code, service_error_from(ServiceError("GIT_ARGUMENTS_NOT_ALLOWED", 502)).status_code) == ("GIT_ARGUMENTS_NOT_ALLOWED", 400)
    assert service_error_from(GitAdapterError("INVALID_NOT_CANONICAL")).code == "INVALID_REQUEST"
    assert service_error_from(GitHubAdapterError("INVALID_NOT_CANONICAL")).code == "INVALID_REQUEST"
    assert service_error_from(ServiceError("NOT_ALLOWED", 403)).status_code == 403



def test_endpoint_boundary_normalizes_public_statuses() -> None:
    for source, expected in ((ServiceError("INDETERMINATE", 504), ("INDETERMINATE", 409)), (ServiceError("GIT_ARGUMENTS_NOT_ALLOWED", 502), ("GIT_ARGUMENTS_NOT_ALLOWED", 400))):
        with pytest.raises(ServiceError) as exc:
            endpoints._run(lambda source=source: (_ for _ in ()).throw(source))
        assert (exc.value.code, exc.value.status_code) == expected


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
    with pytest.raises(ServiceError, match="INVALID_BRANCH_NAME"):
        getattr(endpoints, endpoint)({key: ("bad..name" if key != "project_id" else value)
                                      for key, value in body.items()}, {}, None)
    with pytest.raises(ServiceError, match="INVALID_BRANCH_NAME"):
        getattr(endpoints, endpoint)({key: ("feature.lock/child" if key != "project_id" else value)
                                      for key, value in body.items()}, {}, None)
    with pytest.raises(ServiceError, match="UNKNOWN_PROJECT"):
        getattr(endpoints, endpoint)(body, {}, None)


def _make_git_repo(root: Path) -> None:
    import subprocess

    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True)

    (root / "src").mkdir(parents=True)
    (root / "src" / "a.ts").write_text("export const a = 1\n", encoding="utf-8")
    (root / "README.md").write_text("# repo\n", encoding="utf-8")
    git("init", "-q", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    git("add", ".")
    git("commit", "-q", "-m", "init")
    git("remote", "add", "origin", "https://github.com/example/repo.git")


def test_tree_endpoint_contract_boundaries() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.listTree({}, {})
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.listTree({"unexpected": True}, {}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.listTree({}, {"project_id": ["demo"], "unknown": ["x"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.listTree({}, {"project_id": ["demo", "other"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.listTree({}, {"project_id": ["demo"], "path": [".."]}, None)


def test_file_endpoint_contract_boundaries() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.readFile({}, {})
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFile({}, {"project_id": ["demo"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFile({}, {"project_id": ["demo"], "path": ["a", "b"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFile({}, {"project_id": ["demo"], "path": ["/etc/passwd"]}, None)


def test_tree_endpoint_lists_real_worktree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_git_repo(tmp_path)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    result = endpoints.listTree({}, {"project_id": ["demo"], "path": ["."]}, None)
    assert result["ok"] is True
    data = result["data"]
    assert data["path"] == "."
    assert data["truncated"] is False
    names = [entry["name"] for entry in data["entries"]]
    assert "src" in names and "README.md" in names
    assert ".git" not in names and "node_modules" not in names


def test_file_endpoint_reads_bounded_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_git_repo(tmp_path)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    result = endpoints.readFile({}, {"project_id": ["demo"], "path": ["src/a.ts"]}, None)
    assert result["ok"] is True
    data = result["data"]
    assert data["content"] == "export const a = 1\n"
    assert data["binary"] is False
    assert data["truncated"] is False
    assert data["size"] == len(b"export const a = 1\n")


def test_file_endpoint_rejects_containment_breakout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_git_repo(tmp_path)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    with pytest.raises(ServiceError) as exc:
        endpoints.readFile({}, {"project_id": ["demo"], "path": [".."]}, None)
    assert (exc.value.code, exc.value.status_code) == ("INVALID_REQUEST", 400)
    with pytest.raises(ServiceError) as exc:
        endpoints.readFile({}, {"project_id": ["demo"], "path": [".git/config"]}, None)
    assert (exc.value.code, exc.value.status_code) == ("NOT_ALLOWED", 403)


def test_file_raw_endpoint_contract_boundaries() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.readFileRaw({}, {})
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({"unexpected": True}, {}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({}, {"project_id": ["demo"], "unknown": ["x"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({}, {"project_id": ["demo"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": ["a", "b"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": ["/etc/passwd"]}, None)
    with pytest.raises(ServiceError, match="INVALID_REQUEST"):
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": [".."]}, None)


def _write_binary(root: Path, rel: str, payload: bytes) -> None:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)


def test_file_raw_endpoint_returns_base64_with_content_type(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import base64

    _make_git_repo(tmp_path)
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    _write_binary(tmp_path, "img.png", payload)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    result = endpoints.readFileRaw({}, {"project_id": ["demo"], "path": ["img.png"]}, None)
    assert result["ok"] is True
    data = result["data"]
    assert isinstance(data, dict)
    assert data["path"] == "img.png"
    assert data["contentType"] == "image/png"
    assert data["size"] == len(payload)
    assert data["truncated"] is False
    assert base64.b64decode(data["contentBase64"]) == payload


def test_file_raw_endpoint_maps_payload_too_large_to_413(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_git_repo(tmp_path)
    _write_binary(tmp_path, "big.bin", b"x" * (262_144 + 1))
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    with pytest.raises(ServiceError) as exc:
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": ["big.bin"]}, None)
    assert (exc.value.code, exc.value.status_code) == ("PAYLOAD_TOO_LARGE", 413)


def test_file_raw_endpoint_maps_not_allowed_and_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_git_repo(tmp_path)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: _context_for(tmp_path))
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, object()))
    with pytest.raises(ServiceError) as exc:
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": [".git/config"]}, None)
    assert (exc.value.code, exc.value.status_code) == ("NOT_ALLOWED", 403)
    with pytest.raises(ServiceError) as exc:
        endpoints.readFileRaw({}, {"project_id": ["demo"], "path": ["missing.bin"]}, None)
    assert (exc.value.code, exc.value.status_code) == ("NOT_FOUND", 404)


def test_payload_too_large_maps_to_413_in_error_table() -> None:
    error = service_error_from(ServiceError("PAYLOAD_TOO_LARGE", 413))
    assert (error.code, error.status_code) == ("PAYLOAD_TOO_LARGE", 413)


def _context_for(path: Path):
    from repository_context import RepositoryContext, resolve_context
    return RepositoryContext(
        project_id="demo",
        name="Demo",
        path=path,
        remote="origin",
        default_branch="main",
        remote_url="https://github.com/example/repo.git",
    )


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


def test_public_pull_request_detail_preserves_github_auth_unavailable(monkeypatch, tmp_path):
    def failing_github(_ctx):
        raise GitHubAdapterError("GITHUB_AUTH_UNAVAILABLE")

    service, context = make_service(tmp_path, github_factory=failing_github)
    registry = Registry((tmp_path,), (), epoch=4)
    monkeypatch.setattr(endpoints, "_runtime", lambda: (registry, service))
    monkeypatch.setattr(endpoints, "resolve_context", lambda _registry, _project_id: context)
    with pytest.raises(ServiceError) as exc:
        endpoints.getPullRequestDetail({}, {"project_id": ["demo"], "pull_request": ["7"]}, None)
    assert (exc.value.code, exc.value.status_code) == ("GITHUB_AUTH_UNAVAILABLE", 503)
