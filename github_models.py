"""GitHub adapter output models."""
from __future__ import annotations

from typing import TypedDict


class GitHubPullRequest(TypedDict):
    number: int
    title: str
    url: str
    draft: bool
    head: str
    base: str
    head_repository: str | None
    base_repository: str | None


class GitHubIssue(TypedDict):
    number: int
    title: str
    url: str
    created_at: str


class GitHubPullRequestDetail(GitHubPullRequest):
    description: str
    author: str
    labels: list[str]
    reviewers: list[str]
    assignees: list[str]
    head_repository: str | None
    base_repository: str | None
    checks: list[dict[str, object]]
    created_at: str
    updated_at: str
