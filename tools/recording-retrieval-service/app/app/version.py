"""Single source of truth for the Recording Retrieval Service version.

`pyproject.toml` reads this attribute dynamically, `app.main` reports it on
/health, and the packaging script writes it into build-info.json. Keep
PROTOCOL.md's health example in sync via `tests/test_version_consistency.py`.
"""

__version__ = "0.1.0"
APP_VERSION = __version__
