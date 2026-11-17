from __future__ import annotations

import json
import tomllib
from pathlib import Path

import pytest

from app.build_info import BUILD_INFO_SCHEMA_VERSION, build_build_info, hash_directory, write_build_info
from app.version import APP_VERSION

APP_ROOT = Path(__file__).resolve().parents[1]


def test_app_version_is_the_single_source_of_truth():
    project = tomllib.loads((APP_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert project["project"]["dynamic"] == ["version"]
    assert project["tool"]["setuptools"]["dynamic"]["version"]["attr"] == "app.version.APP_VERSION"
    assert APP_VERSION == "0.1.0"

    pytest.importorskip("pydantic")
    from app.models.protocol import HealthResponse

    assert HealthResponse().version == APP_VERSION


def test_protocol_health_example_matches_implementation():
    protocol = (APP_ROOT.parent / "PROTOCOL.md").read_text(encoding="utf-8")
    health_start = protocol.index("### 4.1 Health")
    health_section = protocol[health_start : health_start + 500]
    assert f'"version": "{APP_VERSION}"' in health_section


def test_requirements_lock_present_and_marked_as_draft():
    lock_text = (APP_ROOT / "requirements.lock").read_text(encoding="utf-8")
    assert "BLOCKED" in lock_text
    assert "fastapi==0.115.0" in lock_text


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
