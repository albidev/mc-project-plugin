from __future__ import annotations

import json
import shutil
from pathlib import Path

from test_host_contract import EXPECTED_ENDPOINTS, FIXTURE_TARGET, _make_fixture, _run_loader


def test_installation_resolves_symlinked_fixture_without_touching_host_roots() -> None:
    fixture = _make_fixture()
    try:
        installed_root = fixture / "installed"
        result = _run_loader(fixture)
        installed_link = installed_root / "mc-project-plugin"
        assert installed_link.is_symlink()
        assert installed_link.resolve() == fixture
        assert Path(result["resolved_dir"]) == fixture
        assert not str(installed_root).startswith(str(Path.home() / ".hermes"))
        assert not str(fixture).startswith(str(Path("/home/cyclone/Developer/third_party/hermes-mission-control")))
        assert json.loads((fixture / "manifest.json").read_text(encoding="utf-8"))["endpoints"] == EXPECTED_ENDPOINTS
    finally:
        if fixture.exists() or fixture.is_symlink():
            shutil.rmtree(fixture)


def test_installation_cleanup_is_complete() -> None:
    assert not FIXTURE_TARGET.exists()
