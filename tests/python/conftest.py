"""Shared pytest setup: every test runs against a throwaway HERMES_HOME.

The real ~/.hermes is never read or written: HERMES_HOME is pointed at a temp
dir before any host module is imported, and again per test.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import pytest

_SESSION_HOME = tempfile.mkdtemp(prefix="diple-pytest-home-")
os.environ["HERMES_HOME"] = _SESSION_HOME

REPO = Path(__file__).resolve().parents[2]


def load_plugin_package(plugin_dir: Path, name: str):
    """Import a plugin's python/ folder as a package, like the host loader does."""
    for key in [k for k in sys.modules if k == name or k.startswith(name + ".")]:
        del sys.modules[key]
    spec = importlib.util.spec_from_file_location(name, plugin_dir / "__init__.py",
                                                  submodule_search_locations=[str(plugin_dir)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def load_api_module(plugin_dir: Path, plugin_name: str, store_module: str):
    """Import dashboard/plugin_api.py standalone, like web_server_dashboard does."""
    for key in (f"hermes_dashboard_plugin_{plugin_name}", store_module):
        sys.modules.pop(key, None)
    module_name = f"hermes_dashboard_plugin_{plugin_name}"
    spec = importlib.util.spec_from_file_location(module_name, plugin_dir / "dashboard" / "plugin_api.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes-home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    real = Path.home() / ".hermes"
    assert not str(home).startswith(str(real) + "/plugin-data")
    return home


def pytest_sessionfinish(session, exitstatus):
    import shutil

    shutil.rmtree(_SESSION_HOME, ignore_errors=True)
