from __future__ import annotations

import pytest

from app.services import llm_client


def _fake_protect(data: bytes) -> bytes:
    return b"FAKE-DPAPI:" + data


def _fake_unprotect(data: bytes) -> bytes:
    if not data.startswith(b"FAKE-DPAPI:"):
        raise RuntimeError("not a fake DPAPI ciphertext")
    return data[len(b"FAKE-DPAPI:") :]


@pytest.fixture(autouse=True)
def _fake_llm_secret_protector():
    """Linux CI has no DPAPI; tests inject a deterministic fake protector."""
    llm_client.set_secret_protector_for_tests(_fake_protect, _fake_unprotect)
    yield
    llm_client.set_secret_protector_for_tests(None, None)
