from __future__ import annotations

import asyncio

import httpx
import pytest

from app.services.http_sources import HttpSourceProvider
from app.services.platform_search_config import BilibiliSearchConfig, PlatformSearchConfig
from app.services.source_profiles import SourceProfileLoader


class _EmptyTransport(httpx.AsyncBaseTransport):
    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, request=request, text="<html><head><title></title></head><body></body></html>")


class _RecordingBrowserFetcher:
    def __init__(self) -> None:
        self.search_calls: list[str] = []
        self.page_calls: list[str] = []

    async def fetch_links(self, url: str, *, url_patterns=None, timeout_seconds=None):
        del url_patterns, timeout_seconds
        self.search_calls.append(url)
        return [f"https://www.bilibili.com/video/BV1xx411c7mD"]

    async def fetch_page(self, url: str, timeout_seconds=None):
        del timeout_seconds
        self.page_calls.append(url)
        return {"title": "Browser title", "description": "Browser description"}


def build_provider(tmp_path, fetcher, *, bilibili_enabled: bool) -> HttpSourceProvider:
    root = tmp_path / "profiles"
    (root / "high-quality").mkdir(parents=True)
    (root / "streaming").mkdir(parents=True)
    (root / "high-quality" / "global.txt").write_text("https://catalog.example\n", encoding="utf-8")
    config = PlatformSearchConfig(enabled=True, bilibili=BilibiliSearchConfig(enabled=bilibili_enabled))
    return HttpSourceProvider(
        profile_loader=SourceProfileLoader(root),
        client=httpx.AsyncClient(transport=_EmptyTransport()),
        browser_fetcher=fetcher,
        platform_search_config=config,
    )


def _draft():
    from tests.test_playwright_fallback import sample_draft

    return sample_draft()


def test_bilibili_browser_search_fallback_is_skipped_when_disabled(tmp_path) -> None:
    fetcher = _RecordingBrowserFetcher()
    provider = build_provider(tmp_path, fetcher, bilibili_enabled=False)
    rows = asyncio.run(
        provider._search_platform_via_browser_pages(
            queries=["贝多芬 第五交响曲"],
            url_builders=[lambda query: f"https://search.bilibili.com/all?keyword={query}"],
            source_label="Bilibili",
            url_patterns=["bilibili.com"],
        )
    )
    assert rows == []
    assert fetcher.search_calls == []


def test_bilibili_browser_search_fallback_still_runs_when_enabled(tmp_path) -> None:
    fetcher = _RecordingBrowserFetcher()
    provider = build_provider(tmp_path, fetcher, bilibili_enabled=True)
    rows = asyncio.run(
        provider._search_platform_via_browser_pages(
            queries=["贝多芬 第五交响曲"],
            url_builders=[lambda query: f"https://search.bilibili.com/all?keyword={query}"],
            source_label="Bilibili",
            url_patterns=["bilibili.com"],
        )
    )
    assert rows
    assert fetcher.search_calls


def test_bilibili_browser_page_fallback_is_skipped_when_disabled(tmp_path) -> None:
    fetcher = _RecordingBrowserFetcher()
    provider = build_provider(tmp_path, fetcher, bilibili_enabled=False)
    record = asyncio.run(
        provider._fetch_page_record(
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "Bilibili",
            "streaming",
            _draft(),
            asyncio.Semaphore(1),
        )
    )
    assert record is not None
    assert fetcher.page_calls == []


def test_bilibili_browser_page_fallback_still_runs_when_enabled(tmp_path) -> None:
    fetcher = _RecordingBrowserFetcher()
    provider = build_provider(tmp_path, fetcher, bilibili_enabled=True)
    asyncio.run(
        provider._fetch_page_record(
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "Bilibili",
            "streaming",
            _draft(),
            asyncio.Semaphore(1),
        )
    )
    assert fetcher.page_calls == ["https://www.bilibili.com/video/BV1xx411c7mD"]


def test_non_bilibili_page_fallback_unaffected_by_bilibili_enabled(tmp_path) -> None:
    fetcher = _RecordingBrowserFetcher()
    provider = build_provider(tmp_path, fetcher, bilibili_enabled=False)
    asyncio.run(
        provider._fetch_page_record(
            "https://www.youtube.com/watch?v=abc123xyz01",
            "YouTube",
            "streaming",
            _draft(),
            asyncio.Semaphore(1),
        )
    )
    assert fetcher.page_calls == ["https://www.youtube.com/watch?v=abc123xyz01"]
