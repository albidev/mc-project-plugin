"""Deterministic configuration boundary for mc-project-plugin."""
from __future__ import annotations

from pathlib import Path

from registry import Registry, load_registry


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "mission-control" / "mc-project-plugin" / "config.json"


def load_default_registry() -> Registry:
    return load_registry(DEFAULT_CONFIG_PATH)
