"""Build disposable Git repositories for branch mutation tests only."""
from __future__ import annotations

from pathlib import Path
import subprocess


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)
    return result.stdout


def create_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    remote = path.parent / f"{path.name}-remote.git"
    remote.mkdir(parents=True, exist_ok=True)
    run_git(path, "init", "-q", "-b", "main")
    run_git(path, "config", "user.email", "fixture@example.com")
    run_git(path, "config", "user.name", "Fixture")
    (path / "README.md").write_text("fixture\n", encoding="utf-8")
    run_git(path, "add", "README.md")
    run_git(path, "commit", "-q", "-m", "fixture commit")
    run_git(remote, "init", "--bare", "-q")
    run_git(path, "remote", "add", "origin", str(remote))
    run_git(path, "push", "-q", "-u", "origin", "main")
    return path
