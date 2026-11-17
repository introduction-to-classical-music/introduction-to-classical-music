# -*- mode: python ; coding: utf-8 -*-

import json
import re
from pathlib import Path, PurePosixPath

project_root = Path(SPECPATH).resolve().parent
ui_root = project_root / "app" / "ui"
config_root = project_root / "config"
materials_whitelist_path = project_root / "packaging" / "materials-whitelist.json"
safe_config_files = [
    config_root / ".gitkeep",
    config_root / "llm.example.json",
    config_root / "platform-search.example.json",
]

# Packaging allow-list (W1b / F01): never pack the whole materials/ tree.
# The legacy `materials/source-profiles/LLM config.txt` used to carry LLM API
# keys and must not be shipped; the service falls back to
# `%APPDATA%/.../retrieval-service/config/llm.local.json` (or an empty config)
# when the legacy file is absent. User-local config, caches and downloads are
# never packaging inputs.
_SENSITIVE_MATERIALS_PATTERN = re.compile(
    r"llm[\s_-]*config|\.local\.json$|\.env$|secret|token|credential|password|cookie",
    re.IGNORECASE,
)


def load_materials_datas():
    if not materials_whitelist_path.is_file():
        raise SystemExit(f"Missing materials whitelist: {materials_whitelist_path}")
    payload = json.loads(materials_whitelist_path.read_text(encoding="utf-8"))
    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise SystemExit("Materials whitelist is empty; refusing to package any materials")

    datas = []
    for entry in files:
        relative = PurePosixPath(str(entry))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise SystemExit(f"Invalid materials whitelist entry: {entry}")
        if _SENSITIVE_MATERIALS_PATTERN.search(relative.name):
            raise SystemExit(f"Refusing to package sensitive materials file: {entry}")
        source = project_root / relative
        if not source.is_file():
            raise SystemExit(f"Whitelisted materials file is missing: {entry}")
        datas.append((str(source), str(PurePosixPath(*relative.parts[:-1]))))
    return datas


materials_datas = load_materials_datas()

a = Analysis(
    [str(project_root / "app" / "main.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=[
        (str(ui_root), "app/ui"),
        *materials_datas,
        *[(str(path), f"config/{path.name}") for path in safe_config_files if path.is_file()],
    ],
    hiddenimports=[
        "playwright",
        "playwright.async_api",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="recording-retrieval-service",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="recording-retrieval-service",
)
