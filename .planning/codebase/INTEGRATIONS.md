# External Integrations

**Analysis Date:** 2026-04-22

## APIs & External Services

**OpenAI-compatible LLM endpoints:**
- Configurable OpenAI-compatible chat completion endpoint - used for summary generation, entity/work knowledge candidates, and proposal review
  - SDK/Client: native `fetch` in `packages/automation/src/llm.ts` and `tools/recording-retrieval-service/app/app/services/llm_client.py`
  - Auth: API key from app-level settings file resolved by `packages/automation/src/automation-store.ts` (`runtimePaths.appData.secretsPath`) and retrieval local config (`tools/recording-retrieval-service/app/config/llm.local.json`, example file present)

**Recording retrieval local service:**
- `recording-retrieval-service` (local HTTP service) - async enrichment for recording fields in owner automation flow
  - SDK/Client: custom HTTP client in `packages/automation/src/recording-retrieval.ts`; Python service in `tools/recording-retrieval-service/app/app/main.py`
  - Auth: Not required (local loopback service, protocol check uses `expectedProtocolVersion: "v1"` in `packages/automation/src/automation-store.ts`)

**Public web knowledge/search sources (automation checks):**
- Wikipedia REST/API, Wikidata/Wikimedia endpoints, Baidu/Baike, YouTube, Bilibili, Apple Music, Google search - used by automation enrichment/check modules
  - SDK/Client: native `fetch` with Windows fallback in `packages/automation/src/automation-checks.ts`, `packages/automation/src/recording-auto-check.ts`, `packages/automation/src/external-fetch.ts`
  - Auth: mostly unauthenticated by default; optional platform API/session config via retrieval service local config (`tools/recording-retrieval-service/app/config/platform-search.local.json`, example file present)

## Data Storage

**Databases:**
- Not detected (no SQL/NoSQL client in primary app paths)
  - Connection: Not applicable
  - Client: Not applicable

**File Storage:**
- Local filesystem only
  - Canonical runtime path resolver: `packages/data-core/src/app-paths.ts`
  - Library content and generated artifacts persisted by `packages/data-core/src/library-store.ts`
  - Managed/imported image assets persisted by `packages/automation/src/automation-store.ts`

**Caching:**
- Filesystem cache directories only
  - Main app cache path: `runtimePaths.appData.cacheDir` from `packages/data-core/src/app-paths.ts`
  - Retrieval service cache dirs are local folders under `tools/recording-retrieval-service/app/` and ignored in `.gitignore`

## Authentication & Identity

**Auth Provider:**
- Custom local process trust model
  - Implementation: desktop shell launches local owner server and retrieval service bound to `127.0.0.1` (`apps/desktop/main.ts`), no user-account auth layer detected

## Monitoring & Observability

**Error Tracking:**
- Dedicated SaaS tracker not detected

**Logs:**
- File-based runtime logs
  - Desktop runtime log: `logs/desktop-runtime.log` managed in `apps/desktop/main.ts`
  - Site build runtime log: `logs/site-build-runtime.log` managed in `packages/data-core/src/site-build-runner.ts`
  - Retrieval service logs under `tools/recording-retrieval-service/app/logs/` (ignored in git)

## CI/CD & Deployment

**Hosting:**
- Windows desktop installer artifacts (Electron NSIS) and local static site output (`output/site` / library `build/site`)
- No external cloud host integration declared in repository automation

**CI Pipeline:**
- GitHub Actions in `.github/workflows/ci.yml`
  - Linux verify job: install, runtime build, checks, site build
  - Windows package job: bootstrap + package Windows release with Python setup

## Environment Configuration

**Required env vars:**
- Main runtime/path vars:
  - `ICM_REPO_ROOT`, `ICM_RUNTIME_MODE`, `ICM_ACTIVE_LIBRARY_DIR`, `ICM_DEFAULT_LIBRARY_DIR`, `ICM_APP_DATA_DIR`, `ICM_SITE_OUT_DIR`
- Ports/service vars:
  - `OWNER_PORT`, `LIBRARY_SITE_PORT`, `RECORDING_RETRIEVAL_SERVICE_URL`, `OWNER_BASE_URL`, `MOCK_RECORDING_RETRIEVAL_PORT`
- Desktop portability detection:
  - `PORTABLE_EXECUTABLE_DIR`, `PORTABLE_EXECUTABLE_FILE`

**Secrets location:**
- Main app: app data JSON files resolved from `packages/data-core/src/app-paths.ts`:
  - LLM/secrets: `runtimePaths.appData.secretsPath`
  - Retrieval settings: `runtimePaths.appData.settingsPath`
- Retrieval service:
  - Local config files in `tools/recording-retrieval-service/app/config/` (example files committed; local secret variants are gitignored)

## Webhooks & Callbacks

**Incoming:**
- None (no public webhook receiver pattern detected)

**Outgoing:**
- HTTP calls from automation/retrieval modules to third-party web endpoints as part of enrichment and validation

---

*Integration audit: 2026-04-22*
