# Architecture

**Analysis Date:** 2026-04-22

## Pattern Overview

**Overall:** Layered monorepo with shared domain packages, multiple app surfaces, and file-backed runtime state.

**Key Characteristics:**
- Domain logic is centralized in shared packages and re-exported into app surfaces (`apps/site/src/lib/*` re-exporting `packages/*`).
- Runtime state is filesystem-first; no database layer is present (`packages/data-core/src/library-store.ts`, `packages/data-core/src/app-paths.ts`).
- Desktop shell orchestrates local subprocesses (owner server + retrieval service) and local site serving (`apps/desktop/main.ts`).

## Layers

**App Surface Layer:**
- Purpose: user-facing entry points and transport boundaries (desktop windows, owner HTTP API, Astro pages).
- Location: `apps/desktop/`, `apps/owner/`, `apps/site/`
- Contains: Electron launcher, Express routes, Astro components/pages, browser-side owner UI scripts.
- Depends on: `packages/data-core`, `packages/automation`, `packages/shared`.
- Used by: end users via desktop app, browser sessions, and local automation scripts.

**Domain/Core Layer:**
- Purpose: core domain schemas, library lifecycle, site generation, automation pipelines.
- Location: `packages/shared/src/`, `packages/data-core/src/`, `packages/automation/src/`
- Contains: schema validation, display/index transforms, runtime pathing, build runners, automation and proposal logic.
- Depends on: Node standard library + selected libs (`zod`, `cheerio`, etc).
- Used by: all app surfaces and CLI scripts.

**Tooling/Integration Layer:**
- Purpose: external-process integration and protocol boundary for recording retrieval.
- Location: `tools/recording-retrieval-service/app/`, plus integration clients in `packages/automation/src/recording-retrieval.ts`
- Contains: FastAPI service, protocol models, retrieval orchestration, optional LLM/platform adapter config.
- Depends on: FastAPI/httpx/playwright stack.
- Used by: owner automation flows via local HTTP.

## Data Flow

**Owner Edit + Build Flow:**

1. Owner UI calls API routes in `apps/owner/server/owner-app.ts`.
2. Server reads/modifies library/site/article JSON through `packages/data-core/src/library-store.ts` and validates with `packages/shared/src/schema.ts`.
3. Server regenerates artifacts (`writeGeneratedArtifacts`) and can trigger Astro build via `packages/data-core/src/site-build-runner.ts`.

**Automation Recording Enrichment Flow:**

1. Owner server creates automation jobs via `packages/automation/src/automation-jobs.ts`.
2. Recording checks call provider adapter in `packages/automation/src/recording-retrieval.ts` based on settings in `packages/automation/src/automation-store.ts`.
3. Retrieval service (`tools/recording-retrieval-service/app/app/main.py`) returns structured results; owner translates them into proposals and persists runs.

**Desktop Launch Flow:**

1. Electron main process in `apps/desktop/main.ts` primes runtime env and bootstraps active library (`packages/data-core/src/library-manager.ts`).
2. It spawns owner server script and retrieval service process as needed.
3. It serves/open local site using `packages/data-core/src/local-site-server.ts`.

**State Management:**
- Source of truth is JSON files under active library/app-data paths resolved by `packages/data-core/src/app-paths.ts`.
- Mutations are persisted through dedicated save functions and revalidated (`validateLibrary`).
- Generated runtime artifacts are materialized to `runtime/generated` and consumed by Astro pages.

## Key Abstractions

**RuntimePaths:**
- Purpose: single resolver for all environment-dependent directories and files.
- Examples: `packages/data-core/src/app-paths.ts`
- Pattern: compute-on-read path map driven by env and runtime mode (`legacy` vs `bundle`).

**Library Bundle Lifecycle:**
- Purpose: activate/bootstrap/import/export managed libraries.
- Examples: `packages/data-core/src/library-manager.ts`, `packages/data-core/src/library-bundle.ts`
- Pattern: explicit lifecycle API + persisted app state.

**Automation Proposal Model:**
- Purpose: represent candidate changes with evidence/review status before apply.
- Examples: `packages/automation/src/automation.ts`, `packages/automation/src/automation-jobs.ts`, `apps/owner/server/owner-app.ts`
- Pattern: check -> proposal -> review -> apply/revert pipeline.

**Recording Retrieval Provider Contract:**
- Purpose: decouple owner automation from retrieval implementation details.
- Examples: `packages/automation/src/recording-retrieval.ts`, `tools/recording-retrieval-service/PROTOCOL.md`
- Pattern: protocol-driven local HTTP adapter with health/status/results endpoints.

## Entry Points

**Desktop App Main:**
- Location: `apps/desktop/main.ts`
- Triggers: Electron startup (`app.whenReady`)
- Responsibilities: runtime bootstrap, window management, child-service orchestration, IPC handlers.

**Owner API Server:**
- Location: `apps/owner/server/owner-app.ts`
- Triggers: `node output/runtime/apps/owner/server/owner-app.js` from desktop or `npm run owner`
- Responsibilities: serve owner UI, entity/article/library APIs, automation and retrieval orchestration.

**Site Build Runtime:**
- Location: `packages/data-core/src/site-build-runner.ts` and `scripts/build-library-site.ts`
- Triggers: build scripts, owner/desktop rebuild actions.
- Responsibilities: write generated artifacts, run Astro build, sync assets, write build metadata.

**Retrieval Service API:**
- Location: `tools/recording-retrieval-service/app/app/main.py`
- Triggers: `python -m app.main --mode service|ui` or packaged EXE.
- Responsibilities: protocol endpoints, job orchestration, UI serving for standalone mode.

## Error Handling

**Strategy:** Fail-fast at boundaries with explicit catches for user-facing operations, plus structured fallback for known network/platform issues.

**Patterns:**
- Route-level `try/catch` returning HTTP 4xx/5xx JSON errors in `apps/owner/server/owner-app.ts`.
- Validation-first parsing with `zod` and thrown domain errors in `packages/shared/src/schema.ts`.
- Windows network fallback path (`fetch` -> PowerShell invoke) in `packages/automation/src/external-fetch.ts`.

## Cross-Cutting Concerns

**Logging:** File-based runtime logs (`apps/desktop/main.ts`, `packages/data-core/src/site-build-runner.ts`) plus job/event logs in automation and retrieval service.
**Validation:** Centralized schema validation in `packages/shared/src/schema.ts`; request/response model validation in retrieval service Pydantic models.
**Authentication:** No user auth layer detected; trust boundary is local process and loopback-only services.

---

*Architecture analysis: 2026-04-22*
