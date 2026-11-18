from __future__ import annotations

import asyncio
import time

from fastapi.testclient import TestClient

from app.main import MAX_JOB_REQUEST_BYTES, create_app
from app.models.protocol import CreateJobRequest
from app.services.orchestrator import JobOrchestrator
from app.services.retrieval import StubRetriever
from tests.fixtures import sample_request


class CountingRetriever:
    def __init__(self) -> None:
        self.calls = 0

    async def retrieve(self, item, *, cancel_event=None, deadline=None):
        del item, cancel_event, deadline
        self.calls += 1
        await asyncio.sleep(0.05)
        raise RuntimeError("should not be called after cancellation")


def test_job_ttl_and_retention_cap(tmp_path) -> None:
    orchestrator = JobOrchestrator(
        log_dir=tmp_path,
        retriever=StubRetriever(),
        job_ttl_seconds=0.01,
        max_retained_jobs=2,
    )
    accepted_ids = []
    for _ in range(3):
        accepted = orchestrator.create_job(CreateJobRequest.model_validate(sample_request(item_count=1)))
        accepted_ids.append(accepted.job_id)
        asyncio.run(orchestrator.wait_for_job(accepted.job_id, timeout=5))
    time.sleep(0.02)
    orchestrator.prune_jobs()
    remaining = [job_id for job_id in accepted_ids if orchestrator.get_status(job_id) is not None]
    assert len(remaining) <= 2


def test_cancelled_job_stops_dispatching_new_items(tmp_path) -> None:
    retriever = CountingRetriever()
    orchestrator = JobOrchestrator(log_dir=tmp_path, retriever=retriever)  # type: ignore[arg-type]
    request = CreateJobRequest.model_validate(sample_request(item_count=3))
    accepted = orchestrator.create_job(request)
    orchestrator.cancel_job(accepted.job_id)
    asyncio.run(orchestrator.wait_for_job(accepted.job_id, timeout=5))
    status = orchestrator.get_status(accepted.job_id)
    assert status is not None and status.status == "canceled"
    # Cancellation must not start a new network call for every queued item.
    assert retriever.calls < 3


def test_create_app_rejects_oversized_job_body(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ICM_APP_DATA_DIR", str(tmp_path))
    app = create_app(retriever=StubRetriever())
    client = TestClient(app)
    response = client.post(
        "/v1/jobs",
        content=b"{" + b"x" * (MAX_JOB_REQUEST_BYTES + 1) + b"}",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert "too large" in response.text.lower()


def test_create_app_logs_under_app_data_directory(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ICM_APP_DATA_DIR", str(tmp_path))
    app = create_app(retriever=StubRetriever())
    log_dir = app.state.orchestrator._logger.log_dir
    assert str(tmp_path) in str(log_dir)
    assert str(log_dir).replace("\\", "/").endswith("retrieval-service/logs")
