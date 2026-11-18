"""Generate build-info.json for portable releases (stdlib only).

Run by `packaging/build-portable.ps1` after PyInstaller produces the onedir
bundle; also usable from tests without third-party dependencies:

    python app/build_info.py --app-root . --bundle-dir dist/portable --output dist/portable/build-info.json

The file records the identity of the build: application version (single source
`app/version.py`), RRS git commit/status, Python/PyInstaller versions, the
packaging material allow-list hash, the requirements lock hash and a digest of
the emitted bundle (excluding build-info.json itself).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import platform
from datetime import UTC, datetime
from pathlib import Path

BUILD_INFO_SCHEMA_VERSION = "rrs-build-info-v1"
BUILD_INFO_FILE_NAME = "build-info.json"


def _ensure_import_path(app_root: Path) -> None:
    candidates = [str(app_root), str(app_root.parent)]
    for candidate in candidates:
        if candidate and candidate not in sys.path:
            sys.path.insert(0, candidate)


def _import_app_version(app_root: Path) -> str:
    _ensure_import_path(app_root)
    try:
        from app.version import APP_VERSION  # type: ignore import-not-found

        return str(APP_VERSION)
    except Exception:  # pragma: no cover - fallback for unusual layouts
        version_file = app_root / "app" / "version.py"
        text = version_file.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("APP_VERSION"):
                return stripped.split("=", 1)[1].strip().strip("'\"")
        raise


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str | None:
    try:
        return sha256_bytes(path.read_bytes())
    except FileNotFoundError:
        return None


def hash_directory(root: Path, exclude: tuple[str, ...] = ()) -> dict:
    """Deterministic digest of a directory tree (same scheme as the site export helper)."""

    root = root.resolve()
    excluded = set(exclude)
    entries: list[dict] = []
    if not root.exists():
        return {"digest": None, "fileCount": 0, "files": []}
    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(root).as_posix()
        if relative in excluded:
            continue
        entries.append({"path": relative, "sha256": sha256_file(file_path)})
    digest_input = "".join(f"{entry['path']}\0{entry['sha256']}\n" for entry in entries)
    return {
        "digest": sha256_bytes(digest_input.encode("utf-8")),
        "fileCount": len(entries),
        "files": entries,
    }


def _git(app_root: Path, args: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "-C", str(app_root), *args],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def read_git_state(app_root: Path) -> dict:
    # Parent repository checkouts do not contain the nested RRS .git directory
    # (it is not tracked by the parent). In that case use the tracked snapshot
    # identity file so release artifacts still record the embedded RRS commit.
    if not (app_root / ".git").exists():
        identity_file = app_root.parent / "RRS-COMMIT.txt"
        if identity_file.is_file():
            identity: dict[str, str] = {}
            for line in identity_file.read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    identity[key.strip()] = value.strip()
            if identity.get("commit"):
                return {
                    "commit": identity["commit"],
                    "branch": identity.get("branch", "snapshot"),
                    "worktreeClean": True,
                    "source": "RRS-COMMIT.txt",
                }
    commit = _git(app_root, ["rev-parse", "HEAD"])
    status = _git(app_root, ["status", "--porcelain"])
    branch = _git(app_root, ["rev-parse", "--abbrev-ref", "HEAD"])
    return {
        "commit": commit or "unknown",
        "branch": branch or "unknown",
        "worktreeClean": None if status is None else status == "",
        "source": "git",
    }


def build_build_info(
    *,
    app_root: Path,
    bundle_dir: Path | None = None,
    pyinstaller_version: str = "",
    portable_zip_sha256: str = "",
    generated_at: str | None = None,
) -> dict:
    app_root = app_root.resolve()
    info = {
        "schemaVersion": BUILD_INFO_SCHEMA_VERSION,
        "service": "recording-retrieval-service",
        "appVersion": _import_app_version(app_root),
        "generatedAt": generated_at or datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "pythonVersion": platform.python_version(),
        "pythonImplementation": platform.python_implementation(),
        "platform": platform.platform(),
        "pyinstallerVersion": str(pyinstaller_version or "").strip() or "unknown",
        "git": read_git_state(app_root),
        "requirementsLockSha256": sha256_file(app_root / "requirements.lock"),
        "materialsWhitelistSha256": sha256_file(app_root / "packaging" / "materials-whitelist.json"),
        "portableZipSha256": str(portable_zip_sha256 or "").strip() or None,
    }
    if bundle_dir is not None:
        bundle_info = hash_directory(
            bundle_dir,
            exclude=(BUILD_INFO_FILE_NAME, ".build-info.json"),
        )
        # C-F02: never record the build machine's absolute bundle path. The
        # directory name plus the content digest identifies the bundle without
        # leaking local workspace layout.
        info["bundle"] = {
            "name": bundle_dir.resolve().name,
            "digest": bundle_info["digest"],
            "fileCount": bundle_info["fileCount"],
        }
    return info


def write_build_info(output_path: Path, info: dict) -> Path:
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(info, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
    return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write Recording Retrieval Service build-info.json")
    parser.add_argument("--app-root", required=True)
    parser.add_argument("--bundle-dir", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument("--pyinstaller-version", default="")
    parser.add_argument("--portable-zip-sha256", default="")
    args = parser.parse_args(argv)

    app_root = Path(args.app_root).resolve()
    bundle_dir = Path(args.bundle_dir).resolve() if args.bundle_dir else None
    info = build_build_info(
        app_root=app_root,
        bundle_dir=bundle_dir,
        pyinstaller_version=args.pyinstaller_version,
        portable_zip_sha256=args.portable_zip_sha256,
    )
    output = write_build_info(Path(args.output), info)
    print(json.dumps({"output": str(output), "appVersion": info["appVersion"], "schemaVersion": info["schemaVersion"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
