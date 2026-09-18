"""Contract tests for the catalog `repository` (owner/repo) derivation (issue #25)."""
from __future__ import annotations

from pathlib import Path
import subprocess
import time

import pytest

import endpoints
from errors import ServiceError
from registry import ProjectRecord, Registry, RegistryError


def _repo(path: Path, remote: str | None = None) -> Path:
    """Create a disposable repo; set a remote only when one is requested.

    tests/fixtures/git-repo-builder.py configures no remote, so the remote is
    added here instead of editing that shared (out-of-allowlist) fixture.
    """
    path.mkdir(parents=True, exist_ok=True)

    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True, text=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "fixture@example.com")
    git("config", "user.name", "Fixture")
    (path / "README.md").write_text("fixture\n")
    git("add", "README.md")
    git("commit", "-q", "-m", "fixture commit")
    if remote is not None:
        git("remote", "add", "origin", remote)
    return path


def _registry(tmp_path: Path, path: Path) -> Registry:
    return Registry((tmp_path,), (ProjectRecord("demo", "Demo", path, True, "origin", "main"),), epoch=1)


def _derive(registry: Registry, deadline: float | None = None) -> str | None:
    limit = time.monotonic() + 5.0 if deadline is None else deadline
    return endpoints._catalog_repository(registry, registry.projects[0], limit)


@pytest.mark.parametrize("remote, expected", [
    ("https://github.com/owner/repo.git", "owner/repo"),
    ("https://github.com/owner/repo", "owner/repo"),
    ("ssh://git@github.com/owner/repo.git", "owner/repo"),
    ("git@github.com:owner/repo.git", "owner/repo"),
])
def test_github_remotes_derive_owner_repo(tmp_path: Path, remote: str, expected: str) -> None:
    repo = _repo(tmp_path / "repo", remote)
    assert _derive(_registry(tmp_path, repo)) == expected


@pytest.mark.parametrize("remote", [
    "git@gitlab-deghi:progetti/deghi/odoo/deghi.git",
    "git@gitlab.com:group/sub/repo.git",
])
def test_non_github_host_yields_none(tmp_path: Path, remote: str) -> None:
    repo = _repo(tmp_path / "repo", remote)
    assert _derive(_registry(tmp_path, repo)) is None


def test_missing_path_yields_none_without_raising(tmp_path: Path) -> None:
    assert _derive(_registry(tmp_path, tmp_path / "does-not-exist")) is None


def test_non_git_directory_yields_none(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    assert _derive(_registry(tmp_path, plain)) is None


def test_expired_deadline_skips_git_entirely(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path / "repo", "https://github.com/owner/repo.git")
    calls: list[str] = []
    original = endpoints.resolve_context

    def counted(*args: object, **kwargs: object) -> object:
        calls.append("resolve_context")
        return original(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(endpoints, "resolve_context", counted)
    assert _derive(_registry(tmp_path, repo), deadline=time.monotonic() - 1.0) is None
    assert calls == []


def test_symlink_loop_toplevel_is_absorbed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression for the escape at repository_context.py:191 (plan D12/F1).

    `rev-parse --show-toplevel` succeeds and prints a path that resolves to a
    symlink loop: Path.resolve(strict=True) raises RuntimeError there, and
    repository_context.py does not remap it to RepositoryContextError.
    """
    import repository_context

    loop, other = tmp_path / "l1", tmp_path / "l2"
    loop.symlink_to(other)
    other.symlink_to(loop)

    def fake_run_git(path: object, operation: str, args: list[str]) -> str:
        return f"{loop}\n" if operation == "rev-parse" else "https://github.com/owner/repo.git\n"

    monkeypatch.setattr(repository_context, "_run_git", fake_run_git)
    repo = _repo(tmp_path / "repo", "https://github.com/owner/repo.git")
    assert _derive(_registry(tmp_path, repo)) is None


def _payload(monkeypatch: pytest.MonkeyPatch, registry: Registry) -> list[dict[str, object]]:
    monkeypatch.setattr(endpoints, "load_default_registry", lambda: registry)
    monkeypatch.setattr(endpoints, "_REGISTRY", None)
    monkeypatch.setattr(endpoints, "_PROJECT_SERVICE", None)
    result = endpoints.listProjects({}, {}, None)
    assert result["ok"] is True
    return list(result["data"])  # type: ignore[arg-type]


def test_catalog_payload_shape_and_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry = Registry(
        (tmp_path,),
        (
            ProjectRecord("gh", "GitHub", _repo(tmp_path / "gh", "https://github.com/owner/repo.git"), True, "origin", "main"),
            ProjectRecord("gl", "GitLab", _repo(tmp_path / "gl", "git@gitlab-deghi:progetti/deghi/odoo/deghi.git"), True, "origin", "main"),
            ProjectRecord("off", "Off", _repo(tmp_path / "off", "https://github.com/owner/off.git"), False, "origin", "main"),
        ),
        epoch=1,
    )
    items = _payload(monkeypatch, registry)
    assert [item["project_id"] for item in items] == ["gh", "gl"]
    for item in items:
        assert set(item) == {"project_id", "name", "enabled", "remote", "default_branch", "repository"}
        assert item["remote"] == "origin"
    assert items[0]["repository"] == "owner/repo"
    assert items[1]["repository"] is None


def test_one_broken_project_does_not_fail_the_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry = Registry(
        (tmp_path,),
        (
            ProjectRecord("ok", "Ok", _repo(tmp_path / "ok", "https://github.com/owner/repo.git"), True, "origin", "main"),
            ProjectRecord("broken", "Broken", tmp_path / "nope", True, "origin", "main"),
        ),
        epoch=1,
    )
    items = {str(item["project_id"]): item for item in _payload(monkeypatch, registry)}
    assert set(items) == {"ok", "broken"}
    assert items["ok"]["repository"] == "owner/repo"
    assert items["broken"]["repository"] is None


def test_registry_error_still_maps_to_502(monkeypatch: pytest.MonkeyPatch) -> None:
    """The nested operation() must keep load_default_registry inside _run."""

    def broken() -> Registry:
        raise RegistryError("INVALID_CONFIG")

    monkeypatch.setattr(endpoints, "load_default_registry", broken)
    monkeypatch.setattr(endpoints, "_REGISTRY", None)
    monkeypatch.setattr(endpoints, "_PROJECT_SERVICE", None)

    with pytest.raises(ServiceError) as exc:
        endpoints.listProjects({}, {}, None)
    assert (exc.value.code, exc.value.status_code) == ("SERVICE_UNAVAILABLE", 502)


def test_catalog_requires_authentication() -> None:
    with pytest.raises(ServiceError, match="UNAUTHENTICATED"):
        endpoints.listProjects({}, {})
