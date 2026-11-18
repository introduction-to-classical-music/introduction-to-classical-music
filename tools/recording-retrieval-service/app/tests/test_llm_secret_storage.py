from __future__ import annotations

import sys

import pytest

from app.services import llm_client


def test_legacy_plaintext_is_migrated_to_dpapi_envelope(tmp_path) -> None:
    path = tmp_path / "llm.local.json"
    path.write_text('{"enabled": true, "fastModel": {"apiKey": "sk-legacy"}}', encoding="utf-8")

    payload, migrated = llm_client._read_secret_payload(path)
    assert migrated is True
    assert payload["fastModel"]["apiKey"] == "sk-legacy"
    text = path.read_text(encoding="utf-8")
    assert text.startswith("{")
    assert '"schemaVersion": "dpapi-v1"' in text
    assert "sk-legacy" not in text


def test_decrypt_failure_fails_closed(tmp_path, monkeypatch) -> None:
    path = tmp_path / "llm.local.json"
    llm_client._write_secret_payload(path, {"enabled": True})
    llm_client.set_secret_protector_for_tests(lambda data: b"x", lambda data: (_ for _ in ()).throw(RuntimeError("bad")))
    try:
        with pytest.raises(RuntimeError, match="refusing plaintext fallback"):
            llm_client._read_secret_payload(path)
    finally:
        llm_client.set_secret_protector_for_tests(None, None)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows DPAPI only")
def test_windows_dpapi_roundtrip_uses_current_user_scope(tmp_path) -> None:
    payload = {"enabled": True, "fastModel": {"apiKey": "sk-dpapi-roundtrip"}}
    path = tmp_path / "llm.local.json"
    llm_client._write_secret_payload(path, payload)
    text = path.read_text(encoding="utf-8")
    assert "sk-dpapi-roundtrip" not in text
    restored, migrated = llm_client._read_secret_payload(path)
    assert migrated is False
    assert restored == payload
