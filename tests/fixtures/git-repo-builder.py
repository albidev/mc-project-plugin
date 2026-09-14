"""Small fixture helper for disposable local Git repositories."""
from __future__ import annotations

from pathlib import Path
import subprocess


def run_git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def create_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    run_git(path, "init", "-q", "-b", "main")
    run_git(path, "config", "user.email", "fixture@example.com")
    run_git(path, "config", "user.name", "Fixture")
    (path / "README.md").write_text("fixture\n")
    run_git(path, "add", "README.md")
    run_git(path, "commit", "-q", "-m", "fixture commit")
    return path
