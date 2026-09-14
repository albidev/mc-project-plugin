from __future__ import annotations

import json
import shutil
from pathlib import Path

from test_host_contract import EXPECTED_ENDPOINTS, _host_root, _make_fixture, _run_loader


def test_installation_resolves_symlinked_fixture_without_touching_host_roots(tmp_path: Path) -> None:
    host_root = _host_root()
    fixture = _make_fixture(tmp_path)
    try:
        installed_root = fixture / "installed"
        result = _run_loader(fixture, host_root)
        installed_link = installed_root / "mc-project-plugin"
        assert installed_link.is_symlink()
        assert installed_link.resolve() == fixture
        assert Path(result["resolved_dir"]) == fixture
        assert installed_root.is_relative_to(tmp_path)
        assert fixture.is_relative_to(tmp_path)
        assert json.loads((fixture / "manifest.json").read_text(encoding="utf-8"))["endpoints"] == EXPECTED_ENDPOINTS
    finally:
        if fixture.exists() or fixture.is_symlink():
            shutil.rmtree(fixture)
