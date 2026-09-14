"""Read-only GitHub adapter for repository PRs and issues."""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlparse

from github_credentials import GitHubCredentialsProvider
from github_transport import GitHubTransport, GitHubTransportError


class GitHubAdapterError(RuntimeError):
    pass


_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def _github_url(value: object, repository: str, suffix: str | None = None) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == "github.com" and port is None and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and bool(parsed.path) and (suffix is None or parsed.path == f"/{repository}/{suffix}")


def _valid_date(value: object) -> bool:
    if not isinstance(value, str) or not _DATE.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _valid_repository_name(value: object) -> bool:
    return isinstance(value, str) and bool(_REPO.fullmatch(value))


def repository_from_remote(remote: str) -> str:
    try:
        parsed = urlparse(remote)
        port = parsed.port
    except ValueError as exc:
        raise GitHubAdapterError("INVALID_GITHUB_REPOSITORY") from exc
    if parsed.hostname != "github.com":
        if remote.startswith("git@github.com:"):
            value = remote.removeprefix("git@github.com:")
        else:
            raise GitHubAdapterError("UNSUPPORTED_REMOTE")
    else:
        if parsed.scheme not in {"https", "ssh"} or port is not None or parsed.username not in {None, "git"} or parsed.password or parsed.query or parsed.fragment:
            raise GitHubAdapterError("INVALID_GITHUB_REPOSITORY")
        value = parsed.path.lstrip("/")
    value = value.removesuffix(".git")
    if not _REPO.fullmatch(value):
        raise GitHubAdapterError("INVALID_GITHUB_REPOSITORY")
    return value


class GitHubAdapter:
    def __init__(self, remote: str, credentials: GitHubCredentialsProvider | None = None, transport: GitHubTransport | object | None = None, remote_alias: str = "origin", configured_remote: str | None = None) -> None:
        if remote_alias not in {"origin", "upstream"}:
            raise GitHubAdapterError("UNAUTHORIZED_REMOTE")
        self.repository = repository_from_remote(remote)
        if configured_remote is not None and repository_from_remote(configured_remote) != self.repository:
            raise GitHubAdapterError("REMOTE_MISMATCH")
        self.credentials = credentials or GitHubCredentialsProvider()
        self.transport = transport or GitHubTransport()

    def _get(self, path: str) -> object:
        token = self.credentials.token()
        if not token:
            raise GitHubAdapterError("GITHUB_AUTH_UNAVAILABLE")
        try:
            return self.transport.get(path, token)  # type: ignore[attr-defined]
        except GitHubTransportError as exc:
            raise GitHubAdapterError(exc.code) from exc

    def pull_requests(self) -> list[dict[str, object]]:
        raw = self._get(f"/repos/{self.repository}/pulls?state=open&per_page=100")
        if not isinstance(raw, list) or len(raw) > 100:
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        result = []
        for item in raw:
            if not isinstance(item, dict) or isinstance(item.get("number"), bool) or not isinstance(item.get("number"), int) or item["number"] <= 0 or not isinstance(item.get("title"), str) or not _github_url(item.get("html_url"), self.repository, f"pull/{item.get('number')}" ) or not isinstance(item.get("draft"), bool) or not _valid_date(item.get("created_at")) or not isinstance(item.get("head"), dict) or not isinstance(item.get("base"), dict) or not isinstance(item["head"].get("ref"), str) or not isinstance(item["base"].get("ref"), str):
                raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
            for side in (item["head"], item["base"]):
                if side.get("repo") is not None and (not isinstance(side.get("repo"), dict) or not _valid_repository_name(side["repo"].get("full_name"))):
                    raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
            if not isinstance(item["base"].get("repo"), dict) or item["base"]["repo"].get("full_name") != self.repository:
                raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
            result.append({"number": item["number"], "title": item["title"], "url": item["html_url"], "draft": item["draft"], "head": item["head"]["ref"], "base": item["base"]["ref"], "head_repository": (item["head"].get("repo") or {}).get("full_name"), "base_repository": (item["base"].get("repo") or {}).get("full_name"), "created_at": item["created_at"]})
        return result

    def issues(self) -> list[dict[str, object]]:
        raw = self._get(f"/repos/{self.repository}/issues?state=open&per_page=100")
        if not isinstance(raw, list) or len(raw) > 100:
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        result = []
        for item in raw:
            marker = item.get("pull_request") if isinstance(item, dict) else None
            if marker is not None:
                if not isinstance(item, dict) or isinstance(item.get("number"), bool) or not isinstance(item.get("number"), int) or item["number"] <= 0 or not isinstance(marker, dict) or not _github_url(marker.get("html_url"), self.repository, f"pull/{item['number']}" ):
                    raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
                continue
            if not isinstance(item, dict) or isinstance(item.get("number"), bool) or not isinstance(item.get("number"), int) or item["number"] <= 0 or not isinstance(item.get("title"), str) or not _github_url(item.get("html_url"), self.repository, f"issues/{item.get('number')}" ) or not _valid_date(item.get("created_at")):
                raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
            result.append({"number": item["number"], "title": item["title"], "url": item["html_url"], "created_at": item["created_at"]})
        return result

    def pull_request_detail(self, number: int) -> dict[str, object]:
        if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
            raise GitHubAdapterError("INVALID_PULL_REQUEST")
        item = self._get(f"/repos/{self.repository}/pulls/{number}")
        if not isinstance(item, dict) or isinstance(item.get("number"), bool) or item.get("number") != number or not isinstance(item.get("title"), str) or not _github_url(item.get("html_url"), self.repository, f"pull/{number}") or not isinstance(item.get("draft"), bool) or not isinstance(item.get("body"), (str, type(None))) or not _valid_date(item.get("created_at")) or not _valid_date(item.get("updated_at")) or not isinstance(item.get("user"), dict) or not isinstance(item.get("head"), dict) or not isinstance(item.get("base"), dict) or not isinstance(item.get("labels"), list) or not isinstance(item.get("requested_reviewers"), list) or not isinstance(item.get("assignees"), list):
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        user = item.get("user") or {}
        if not isinstance(user.get("login"), str) or not isinstance((item.get("head") or {}).get("ref"), str) or not isinstance((item.get("base") or {}).get("ref"), str) or (item["head"].get("repo") is not None and (not isinstance(item["head"].get("repo"), dict) or not _valid_repository_name(item["head"]["repo"].get("full_name")))) or (not isinstance(item["base"].get("repo"), dict) or item["base"]["repo"].get("full_name") != self.repository) or not isinstance(item.get("checks"), list) or any(not isinstance(check, dict) or not isinstance(check.get("status"), str) or not isinstance(check.get("name"), str) or ("conclusion" in check and not isinstance(check["conclusion"], (str, type(None)))) for check in item["checks"]):
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        if any(not isinstance(entry, dict) or not isinstance(entry.get("name"), str) for entry in item["labels"]):
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        if any(not isinstance(entry, dict) or not isinstance(entry.get("login"), str) for collection in (item["requested_reviewers"], item["assignees"]) for entry in collection):
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        if any(not isinstance(check, dict) or not isinstance(check.get("status"), str) or ("conclusion" in check and not isinstance(check["conclusion"], (str, type(None)))) for check in item.get("checks", [])):
            raise GitHubAdapterError("GITHUB_MALFORMED_RESPONSE")
        return {"number": number, "title": item["title"], "url": item["html_url"], "description": item.get("body") or "", "author": user["login"], "labels": [label["name"] for label in item["labels"]], "reviewers": [reviewer["login"] for reviewer in item["requested_reviewers"]], "assignees": [assignee["login"] for assignee in item["assignees"]], "head": item["head"]["ref"], "base": item["base"]["ref"], "head_repository": (item["head"].get("repo") or {}).get("full_name"), "base_repository": (item["base"].get("repo") or {}).get("full_name"), "checks": item.get("checks", []), "created_at": item["created_at"], "updated_at": item["updated_at"], "draft": item["draft"]}
