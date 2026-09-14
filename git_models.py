"""Typed-ish wire dictionaries for local Git observations."""
from __future__ import annotations

from typing import TypedDict


class GitFile(TypedDict):
    path: str
    status: str


class GitCommit(TypedDict):
    hash: str
    subject: str
    author: str
    date: str
    merge: bool
    shortHash: str
    parents: list[str]
    refs: list[str]


class GitBranch(TypedDict):
    name: str
    current: bool
    tracking: str | None
    ahead: int
    behind: int
    relation: str
    remoteAlias: str
    repository: str | None
