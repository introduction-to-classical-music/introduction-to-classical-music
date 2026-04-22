# Codebase Structure

**Analysis Date:** 2026-04-22

## Directory Layout

```text
introduction-to-classical-music/
├── apps/                            # Runtime app surfaces (desktop shell, owner tool, Astro site)
├── packages/                        # Shared domain/core logic reused by apps and scripts
├── scripts/                         # Build, audit, import, packaging, and verification entry scripts
├── tools/recording-retrieval-service/  # Standalone Python retrieval service and protocol docs
├── tests/                           # Vitest TS test suites (unit/integration/e2e folders)
├── data/                            # Legacy/default local data roots used by runtime modes
├── materials/                       # Templates, references, and default library docs assets
├── docs/                            # Project/release architecture and operational docs
├── .github/workflows/ci.yml         # CI verification and Windows packaging pipeline
└── package.json                     # Node workspace scripts + Electron builder config
```

## Directory Purposes

**apps:**
- Purpose: app-level interfaces and entrypoints.
- Contains: Electron shell (`apps/desktop`), owner UI/API (`apps/owner`), Astro static site (`apps/site`).
- Key files: `apps/desktop/main.ts`, `apps/owner/server/owner-app.ts`, `apps/site/src/pages/index.astro`.

**packages:**
- Purpose: reusable logic that should stay app-agnostic.
- Contains: domain schema/display (`packages/shared/src`), data/runtime/build (`packages/data-core/src`), automation/retrieval adapters (`packages/automation/src`).
- Key files: `packages/shared/src/schema.ts`, `packages/data-core/src/library-store.ts`, `packages/automation/src/automation-checks.ts`.

**scripts:**
- Purpose: operational commands triggered by npm scripts and CI.
- Contains: build orchestration, audits, importers, release helpers.
- Key files: `scripts/build-library-site.ts`, `scripts/build-indexes.ts`, `scripts/import-legacy.ts`.

**tools/recording-retrieval-service:**
- Purpose: independent retrieval service with strict protocol integration boundary.
- Contains: Python service (`app/`), packaging scripts, protocol/context docs.
- Key files: `tools/recording-retrieval-service/PROTOCOL.md`, `tools/recording-retrieval-service/app/app/main.py`, `tools/recording-retrieval-service/app/pyproject.toml`.

**tests:**
- Purpose: Vitest coverage for package/app behaviors.
- Contains: broad unit test suites plus integration/e2e directories.
- Key files: `tests/unit/*.test.ts`, `vitest.config.ts`.

## Key File Locations

**Entry Points:**
- `apps/desktop/main.ts`: Electron process bootstrap and orchestration.
- `apps/owner/server/owner-app.ts`: owner Express server and API.
- `apps/owner/web/app.js`: owner browser UI controller.
- `apps/site/src/pages/index.astro`: Astro site home route.
- `tools/recording-retrieval-service/app/app/main.py`: retrieval service startup and API.

**Configuration:**
- `package.json`: scripts, dependency versions, Electron builder config.
- `tsconfig.json`: shared TS config and path aliases for site source.
- `tsconfig.runtime.json`: runtime transpile scope and output (`output/runtime`).
- `apps/site/astro.config.mjs`: Astro site output path and alias.
- `vitest.config.ts`: test include patterns and coverage config.
- `.github/workflows/ci.yml`: CI jobs for verify/package.

**Core Logic:**
- `packages/shared/src/schema.ts`: canonical data schema and cross-entity validation.
- `packages/data-core/src/app-paths.ts`: runtime directory topology.
- `packages/data-core/src/library-manager.ts`: library activation/import/export lifecycle.
- `packages/data-core/src/site-build-runner.ts`: generated artifacts + Astro build pipeline.
- `packages/automation/src/automation-checks.ts`: automation enrichment/check logic.
- `packages/automation/src/recording-retrieval.ts`: provider contract and result translation.

**Testing:**
- `tests/unit/`: primary TS test coverage.
- `tests/integration/`: integration-oriented TS tests.
- `tests/e2e/`: e2e-oriented TS tests.
- `tools/recording-retrieval-service/app/tests/`: Python retrieval service tests.

## Naming Conventions

**Files:**
- TypeScript module files use kebab-case for multi-word modules: `library-store.ts`, `recording-retrieval-audit.ts`.
- Astro page routes follow route semantics including dynamic segments: `apps/site/src/pages/composers/[slug].astro`.
- Script names are verb-first and task-oriented: `build-library-site.ts`, `verify-recording-retrieval-live-integration.mjs`.

**Directories:**
- App surfaces grouped under `apps/{surface}`.
- Reusable logic grouped by concern under `packages/{domain}`.
- Runtime artifact roots grouped under `output/` and library-specific `build/`/`runtime/` dirs resolved by `app-paths`.

## Where to Add New Code

**New Feature:**
- Primary code: place reusable logic in `packages/data-core/src/` or `packages/automation/src/`; app-specific transport/UI in corresponding `apps/*`.
- Tests: add Vitest coverage in `tests/unit/` (or `tests/integration/` for cross-module flows).

**New Component/Module:**
- Site component/page implementation: `apps/site/src/components/` and `apps/site/src/pages/`.
- Owner server endpoint: `apps/owner/server/owner-app.ts` plus supporting helpers in `packages/*` or `apps/owner/server/*-utils.ts`.
- Desktop IPC/window behaviors: `apps/desktop/main.ts` (+ `apps/desktop/preload.ts` bridge if renderer exposure is required).

**Utilities:**
- Shared helpers: prefer `packages/shared/src/` (pure domain utilities) or the owning package (`packages/data-core/src/`, `packages/automation/src/`) instead of app-local duplication.
- Site-only adapters/re-exports: `apps/site/src/lib/` should stay thin and re-export package modules where possible.

## Special Directories

**output/:**
- Purpose: runtime transpiled JS and build/release artifacts.
- Generated: Yes (from `tsc`, Astro build, packaging scripts).
- Committed: No (`output` ignored in `.gitignore`).

**apps/site/src/generated/:**
- Purpose: generated JSON consumed by Astro at build/runtime.
- Generated: Yes (`writeGeneratedArtifacts`).
- Committed: No (`apps/site/src/generated/*.json` ignored).

**tools/recording-retrieval-service/app/config/:**
- Purpose: retrieval local config templates and local overrides.
- Generated: Partially (local runtime variants may be created).
- Committed: Example files only (`llm.example.json`, `platform-search.example.json`); local secret-bearing variants are excluded.

---

*Structure analysis: 2026-04-22*
