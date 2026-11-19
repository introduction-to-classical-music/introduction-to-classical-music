"""Opt-in live RRS health check (C-F11).

Excluded from offline CI (`pytest -m "not network"`). Run manually only:
    RRS_NETWORK_TEST_BASE_URL=http://127.0.0.1:4780 pytest -m network -q
"""

from __future__ import annotations

import os
import urllib.request

import pytest


@pytest.mark.network
def test_live_health_endpoint_returns_protocol_contract() -> None:
    base_url = str(os.getenv("RRS_NETWORK_TEST_BASE_URL", "")).strip()
    if not base_url:
        pytest.skip("set RRS_NETWORK_TEST_BASE_URL to run the opt-in network test")
    import json

    with urllib.request.urlopen(f"{base_url.rstrip('/')}/health", timeout=10) as response:
        assert response.status == 200
        payload = json.loads(response.read().decode("utf-8"))
    assert payload["service"] == "recording-retrieval-service"
    assert payload["protocolVersion"] == "v1"
    assert payload["status"] == "ok"
