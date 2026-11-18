from __future__ import annotations

import json
import os
import re
import tomllib
from pathlib import Path

import pytest

from app.build_info import BUILD_INFO_SCHEMA_VERSION, build_build_info, hash_directory, read_git_state, write_build_info
from app.version import APP_VERSION

APP_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH_ENV = "RRS_PROTOCOL_PATH"


def _resolve_protocol_path(app_root: Path | None = None) -> Path | None:
    """Locate PROTOCOL.md for both the parent-repo layout and standalone RRS.

    Preference order: `RRS_PROTOCOL_PATH` (when it points at a readable file),
    then `<app-root>/PROTOCOL.md`, then `<app-root>/../PROTOCOL.md`. The
    standalone RRS repository does not contain PROTOCOL.md; its CI sets the env
    var from the checked-out parent workspace.
    """
    root = app_root or APP_ROOT
    override = os.environ.get(PROTOCOL_PATH_ENV, "").strip()
    if override:
        override_path = Path(override).expanduser()
        if override_path.is_file():
            return override_path
    for candidate in (root / "PROTOCOL.md", root.parent / "PROTOCOL.md"):
        if candidate.is_file():
            return candidate
    return None


def test_app_version_is_the_single_source_of_truth():
    project = tomllib.loads((APP_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert project["project"]["dynamic"] == ["version"]
    assert project["tool"]["setuptools"]["dynamic"]["version"]["attr"] == "app.version.APP_VERSION"
    assert APP_VERSION == "0.1.0"

    pytest.importorskip("pydantic")
    from app.models.protocol import HealthResponse

    assert HealthResponse().version == APP_VERSION


def test_protocol_health_example_matches_implementation():
    protocol_path = _resolve_protocol_path()
    if protocol_path is None:
        pytest.skip("PROTOCOL.md not available in this checkout (set RRS_PROTOCOL_PATH or run from the parent repository)")
    protocol = protocol_path.read_text(encoding="utf-8")
    health_start = protocol.index("### 4.1 Health")
    health_section = protocol[health_start : health_start + 500]
    assert f'"version": "{APP_VERSION}"' in health_section


def test_protocol_path_resolution_env_and_fallbacks(monkeypatch, tmp_path: Path):
    monkeypatch.delenv(PROTOCOL_PATH_ENV, raising=False)
    assert _resolve_protocol_path(tmp_path) is None

    parent = tmp_path / "workspace"
    app_root = parent / "app"
    app_root.mkdir(parents=True)
    (parent / "PROTOCOL.md").write_text("parent protocol", encoding="utf-8")
    assert _resolve_protocol_path(app_root) == parent / "PROTOCOL.md"

    (app_root / "PROTOCOL.md").write_text("app protocol", encoding="utf-8")
    assert _resolve_protocol_path(app_root) == app_root / "PROTOCOL.md"

    env_file = tmp_path / "env-PROTOCOL.md"
    env_file.write_text("env protocol", encoding="utf-8")
    monkeypatch.setenv(PROTOCOL_PATH_ENV, str(env_file))
    assert _resolve_protocol_path(app_root) == env_file

    monkeypatch.setenv(PROTOCOL_PATH_ENV, str(tmp_path / "missing-PROTOCOL.md"))
    assert _resolve_protocol_path(app_root) == app_root / "PROTOCOL.md"


def test_requirements_lock_is_hash_locked_with_key_pins():
    lock_text = (APP_ROOT / "requirements.lock").read_text(encoding="utf-8")
    # Hash-locked dependency set generated from the verified W8 environment.
    # It must not regress to a placeholder or an unhashed hand-written list.
    assert "pip-compile" in lock_text or "pip freeze" in lock_text
    assert "--hash=sha256:" in lock_text
    assert "BLOCKED" not in lock_text
    assert "DRAFT" not in lock_text
    for package in ("fastapi", "httpx", "playwright", "pydantic", "uvicorn", "pyinstaller", "pytest"):
        assert re.search(rf"(?m)^{re.escape(package)}==", lock_text), f"missing pin for {package} in requirements.lock"
    pins = re.findall(r"(?m)^([A-Za-z0-9_.-]+)==", lock_text)
    assert len(pins) == len(set(pins)), "requirements.lock contains duplicate package pins"
    assert len(pins) >= 20, f"requirements.lock should pin the transitive set too, got {len(pins)}"


def test_build_info_covers_identity_and_materials_whitelist(tmp_path: Path):
    bundle_dir = tmp_path / "bundle"
    bundle_dir.mkdir()
    (bundle_dir / "recording-retrieval-service.exe").write_bytes(b"exe")
    (bundle_dir / "start-service.cmd").write_text("@echo off\n", encoding="utf-8")
    (bundle_dir / "build-info.json").write_text("{}", encoding="utf-8")

    info = build_build_info(
        app_root=APP_ROOT,
        bundle_dir=bundle_dir,
        pyinstaller_version="6.12.0",
        generated_at="2026-01-01T00:00:00Z",
    )
    assert info["schemaVersion"] == BUILD_INFO_SCHEMA_VERSION
    assert info["appVersion"] == APP_VERSION
    assert info["pyinstallerVersion"] == "6.12.0"
    assert info["materialsWhitelistSha256"]
    assert info["requirementsLockSha256"]
    assert info["bundle"]["fileCount"] == 2  # build-info.json itself is excluded from the digest
    # C-F02: the bundle location must not leak the build machine's absolute path.
    assert "path" not in info["bundle"]
    assert info["bundle"]["name"] == bundle_dir.name
    serialized = json.dumps(info)
    assert str(bundle_dir) not in serialized
    assert "path" not in info["bundle"]
    assert "git" in info and "commit" in info["git"]

    info_path = write_build_info(tmp_path / "release" / "build-info.json", info)
    payload = json.loads(info_path.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == BUILD_INFO_SCHEMA_VERSION
    assert payload["bundle"]["digest"] == info["bundle"]["digest"]


def test_hash_directory_is_deterministic(tmp_path: Path):
    root = tmp_path / "tree"
    (root / "nested").mkdir(parents=True)
    (root / "a.txt").write_text("a", encoding="utf-8")
    (root / "nested" / "b.txt").write_text("b", encoding="utf-8")
    first = hash_directory(root)
    second = hash_directory(root)
    assert first["digest"] == second["digest"]
    assert [entry["path"] for entry in first["files"]] == ["a.txt", "nested/b.txt"]


def test_build_info_schema_is_json_serializable():
    info = build_build_info(app_root=APP_ROOT)
    json.dumps(info)


def test_snapshot_identity_file_is_used_when_nested_git_is_absent(tmp_path: Path) -> None:
    app_root = tmp_path / "app"
    app_root.mkdir()
    (app_root / "app").mkdir()
    (app_root / "app" / "version.py").write_text('APP_VERSION = "0.1.0"\n', encoding="utf-8")
    (tmp_path / "RRS-COMMIT.txt").write_text("commit=abc123\nbranch=snapshot-test\n", encoding="utf-8")
    state = read_git_state(app_root)
    assert state["commit"] == "abc123"
    assert state["branch"] == "snapshot-test"
    assert state["worktreeClean"] is True
    assert state["source"] == "RRS-COMMIT.txt"
