import json
from pathlib import Path
import pytest

from github_adapter import GitHubAdapter, GitHubAdapterError
from github_credentials import GitHubCredentialsProvider
from github_transport import GitHubTransport, GitHubTransportError


class FakeTransport:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path: str, token: str):
        self.calls.append((path, token))
        return self.responses[path]


def adapter(responses):
    return GitHubAdapter("https://github.com/example/repo.git", GitHubCredentialsProvider("token"), FakeTransport(responses))


def test_lists_open_pull_requests_and_issues() -> None:
    fixture = Path(__file__).parent / "fixtures" / "github"
    a = adapter({
        "/repos/example/repo/pulls?state=open&per_page=100": json.loads((fixture / "pull-requests.json").read_text()),
        "/repos/example/repo/issues?state=open&per_page=100": json.loads((fixture / "issues.json").read_text()),
    })
    assert a.pull_requests()[0]["number"] == 4
    assert a.issues()[0]["title"] == "Bug"


def test_pull_request_detail_is_on_demand() -> None:
    fixture = Path(__file__).parent / "fixtures" / "github" / "pull-request-detail.json"
    a = adapter({"/repos/example/repo/pulls/4": json.loads(fixture.read_text())})
    detail = a.pull_request_detail(4)
    assert detail["description"] == "Details"
    assert detail["author"] == "davide"


def test_pull_request_detail_normalizes_missing_body_to_explicit_empty_description() -> None:
    fixture = Path(__file__).parent / "fixtures" / "github" / "pull-request-detail-empty-body.json"
    detail = adapter({"/repos/example/repo/pulls/4": json.loads(fixture.read_text())}).pull_request_detail(4)
    assert detail["description"] == ""


def test_missing_token_is_unavailable() -> None:
    a = GitHubAdapter("https://github.com/example/repo.git", GitHubCredentialsProvider(None), FakeTransport({}))
    with pytest.raises(GitHubAdapterError, match="GITHUB_AUTH_UNAVAILABLE"):
        a.pull_requests()


def test_non_github_remote_is_rejected() -> None:
    with pytest.raises(GitHubAdapterError, match="UNSUPPORTED_REMOTE"):
        GitHubAdapter("https://gitlab.com/example/repo.git", GitHubCredentialsProvider("token"), FakeTransport({}))


def test_http_github_remote_and_remote_credentials_are_rejected() -> None:
    with pytest.raises(GitHubAdapterError, match="INVALID_GITHUB_REPOSITORY"):
        GitHubAdapter("http://github.com/example/repo.git", GitHubCredentialsProvider("token"), FakeTransport({}))
    with pytest.raises(GitHubAdapterError, match="INVALID_GITHUB_REPOSITORY"):
        GitHubAdapter("https://user:pass@github.com/example/repo.git", GitHubCredentialsProvider("token"), FakeTransport({}))
    assert GitHubAdapter("ssh://git@github.com/example/repo.git", GitHubCredentialsProvider("token"), FakeTransport({})).repository == "example/repo"


def test_malformed_pull_request_detail_is_rejected() -> None:
    a = adapter({"/repos/example/repo/pulls/4": {"number": 4, "title": "bad", "body": {}, "user": None}})
    with pytest.raises(GitHubAdapterError, match="GITHUB_MALFORMED_RESPONSE"):
        a.pull_request_detail(4)


def test_catalog_fixture_is_valid() -> None:
    fixture = Path(__file__).parent / "fixtures" / "github" / "catalog.json"
    assert json.loads(fixture.read_text())["repository"] == "example/repo"


def test_transport_rejects_untrusted_endpoint() -> None:
    with pytest.raises(GitHubTransportError, match="INVALID_GITHUB_ENDPOINT"):
        GitHubTransport("https://api.github.com:444")


def test_transport_enforces_streaming_body_limit(monkeypatch) -> None:
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self, _size): return b"x" * 2048

    monkeypatch.setattr("github_transport.urlopen", lambda *_args, **_kwargs: Response())
    with pytest.raises(GitHubTransportError, match="GITHUB_OUTPUT_LIMIT"):
        GitHubTransport().get("/repos/example/repo/issues", "token")


def test_credentials_with_control_character_are_unavailable() -> None:
    assert GitHubCredentialsProvider("token\nvalue").token() is None
