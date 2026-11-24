from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.parent_work_eval import (
    WORKSPACE_ROOT_ENV,
    _resolve_eval_target_override_path,
    load_eval_target_overrides,
    workspace_root,
)


def create_workspace(root: Path, *, with_library: bool = True) -> Path:
    if with_library:
        library = root / "data" / "library"
        library.mkdir(parents=True)
        for name in [
            "composers.json",
            "people.json",
            "works.json",
            "recordings.json",
            "work-groups.json",
        ]:
            (library / name).write_text(json.dumps([]), encoding="utf-8")
    return root


def test_workspace_root_uses_env_override(monkeypatch, tmp_path: Path):
    create_workspace(tmp_path)
    monkeypatch.setenv(WORKSPACE_ROOT_ENV, str(tmp_path))
    assert workspace_root() == tmp_path.resolve()


def test_workspace_root_rejects_invalid_env_override(monkeypatch, tmp_path: Path):
    invalid = tmp_path / "not-a-workspace"
    invalid.mkdir()
    monkeypatch.setenv(WORKSPACE_ROOT_ENV, str(invalid))
    with pytest.raises(FileNotFoundError, match="RRS_WORKSPACE_ROOT"):
        workspace_root()


def test_eval_target_override_prefers_env_workspace(monkeypatch, tmp_path: Path):
    workspace = create_workspace(tmp_path / "parent")
    materials = workspace / "materials"
    materials.mkdir()
    override_file = materials / "eval-target-overrides.json"
    override_file.write_text(json.dumps({"recording-1": {"youtube": ["abc"]}}), encoding="utf-8")
    monkeypatch.setenv(WORKSPACE_ROOT_ENV, str(workspace))

    assert _resolve_eval_target_override_path() == override_file.resolve()
    assert load_eval_target_overrides() == {"recording-1": {"youtube": ["abc"]}}


def test_eval_target_override_absent_in_env_workspace(monkeypatch, tmp_path: Path):
    workspace = create_workspace(tmp_path / "parent")
    monkeypatch.setenv(WORKSPACE_ROOT_ENV, str(workspace))
    # Falls back to the repository-local materials lookup (present in the RRS
    # checkout); with neither present it must return an empty mapping, not crash.
    path = _resolve_eval_target_override_path()
    if path is None:
        assert load_eval_target_overrides() == {}
