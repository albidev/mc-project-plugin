from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST_ROOT = Path("/home/cyclone/Developer/third_party/hermes-mission-control")
HOST_LOADER = HOST_ROOT / "server" / "plugins" / "loader.py"
FIXTURE_SOURCE = ROOT / "tests" / "fixtures" / "host-plugin"
FIXTURE_TARGET = Path("/tmp/mc-project-plugin-host-fixture")

EXPECTED_ENDPOINTS = [
    {"method": "GET", "path": "/mc-project-plugin/projects/catalog", "handler": "listProjects", "authRequired": True},
    {"method": "GET", "path": "/mc-project-plugin/projects/snapshot", "handler": "getSnapshot", "authRequired": True},
    {"method": "GET", "path": "/mc-project-plugin/projects/commit", "handler": "getCommitDetail", "authRequired": True},
    {"method": "GET", "path": "/mc-project-plugin/projects/pull-request", "handler": "getPullRequestDetail", "authRequired": True},
    {"method": "POST", "path": "/mc-project-plugin/projects/branch/switch", "handler": "switchBranch", "authRequired": True},
    {"method": "POST", "path": "/mc-project-plugin/projects/branch/create", "handler": "createBranch", "authRequired": True},
]


def _make_fixture() -> Path:
    if FIXTURE_TARGET.exists() or FIXTURE_TARGET.is_symlink():
        shutil.rmtree(FIXTURE_TARGET)
    shutil.copytree(FIXTURE_SOURCE, FIXTURE_TARGET, symlinks=True)
    return FIXTURE_TARGET


def _run_loader(fixture: Path) -> dict[str, object]:
    script = """
import json
import sys
from pathlib import Path
from plugins.loader import PluginLoader

fixture = Path(sys.argv[1])
external = fixture / "installed"
external.mkdir()
link = external / "mc-project-plugin"
link.symlink_to(fixture, target_is_directory=True)
loader = PluginLoader(internal_dir=fixture / "empty-internal", external_dir=external)
assert loader.load_plugin("mc-project-plugin")
manifest = loader.get_manifest("mc-project-plugin")
module = loader.get_module("mc-project-plugin")
paths = [
    (ep["method"], ep["path"])
    for ep in manifest["endpoints"]
]
responses = []
for method, path in paths:
    handler = loader.resolve(method, path)
    response = handler.handler_fn({}, {}, None)
    responses.append({"handled": handler is not None, "status": 200, "ok": response["ok"]})
print(json.dumps({
    "plugin_dir": str(loader.get_plugin_dir("mc-project-plugin")),
    "resolved_dir": str(loader.get_plugin_dir("mc-project-plugin").resolve()),
    "manifest": manifest,
    "handlers": sorted(name for name in ("listProjects", "getSnapshot", "getCommitDetail", "getPullRequestDetail", "switchBranch", "createBranch") if hasattr(module, name)),
    "responses": responses,
}))
"""
    env = {"PYTHONPATH": str(HOST_ROOT / "server")}
    result = subprocess.run(
        [sys.executable, "-c", script, str(fixture)],
        cwd=HOST_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def test_manifest_declares_exact_host_contract() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["id"] == "mc-project-plugin"
    assert manifest["name"] == "Projects"
    assert manifest["routePath"] == "/mc-project-plugin"
    assert manifest["endpoints"] == EXPECTED_ENDPOINTS


def test_real_host_loader_loads_isolated_fixture_and_dispatches_all_handlers() -> None:
    fixture = _make_fixture()
    try:
        result = _run_loader(fixture)
        assert result["manifest"]["id"] == "mc-project-plugin"
        assert result["manifest"]["routePath"] == "/mc-project-plugin"
        assert result["handlers"] == sorted(ep["handler"] for ep in EXPECTED_ENDPOINTS)
        assert result["resolved_dir"] == str(fixture)
        assert all(item == {"handled": True, "status": 200, "ok": True} for item in result["responses"])
    finally:
        if fixture.exists() or fixture.is_symlink():
            shutil.rmtree(fixture)


def test_plugin_endpoint_exports_are_exactly_manifest_handlers() -> None:
    spec = importlib.util.spec_from_file_location("plugin_endpoints", ROOT / "endpoints.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    exported = {
        name for name, value in vars(module).items()
        if callable(value) and getattr(value, "__module__", None) == module.__name__ and not name.startswith("_")
    }
    assert exported == {ep["handler"] for ep in EXPECTED_ENDPOINTS}
