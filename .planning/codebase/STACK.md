# Technology Stack

**Analysis Date:** 2026-04-22

## Languages

**Primary:**
- TypeScript `^5.9.3` - application/domain code in `apps/desktop/**/*.ts`, `apps/owner/server/**/*.ts`, `packages/**/*.ts`, `scripts/**/*.ts`
- JavaScript (ESM) - frontend and build/runtime scripts in `apps/owner/web/*.js`, `scripts/**/*.mjs`, `apps/site/astro.config.mjs`

**Secondary:**
- Astro component syntax - site UI in `apps/site/src/**/*.astro`
- Python `>=3.13` - recording retrieval service in `tools/recording-retrieval-service/app/app/**/*.py`
- PowerShell - Windows bootstrap and packaging in `scripts/*.ps1`, `tools/recording-retrieval-service/app/packaging/*.ps1`

## Runtime

**Environment:**
- Node.js `22.x` (declared in `package.json` `engines.node`)
- Electron runtime for desktop shell (`electron ^41.2.1`) in `apps/desktop/main.ts`
- Python runtime for retrieval service (`pyproject.toml` requires `>=3.13`)

**Package Manager:**
- npm (active in scripts and CI: `npm ci`, `npm run ...` in `.github/workflows/ci.yml`)
- pnpm lockfile present (`pnpm-lock.yaml`) but npm lockfile also present (`package-lock.json`)
- Lockfile: present (`package-lock.json`, `pnpm-lock.yaml`)

## Frameworks

**Core:**
- Astro `^5.18.1` - static site generation for `apps/site`
- Express `^5.2.1` - owner HTTP server in `apps/owner/server/owner-app.ts`
- Electron `^41.2.1` - desktop launcher and window/process management in `apps/desktop/main.ts`
- FastAPI `>=0.115,<1.0` - retrieval service API in `tools/recording-retrieval-service/app/app/main.py`
- Zod `^4.3.6` - schema validation in `packages/shared/src/schema.ts`

**Testing:**
- Vitest `^4.1.4` - TS/JS tests from `tests/**/*.test.ts` via `vitest.config.ts`
- Pytest `>=8.3,<9.0` - Python tests in `tools/recording-retrieval-service/app/tests`

**Build/Dev:**
- TypeScript compiler (`tsc`) for runtime transpilation via `tsconfig.runtime.json`
- Electron Builder `^26.0.12` for Windows installers in `package.json` `build` + `desktop:dist`
- Uvicorn `>=0.34,<1.0` for FastAPI serving in retrieval service
- PyInstaller `>=6.12,<7.0` for retrieval portable packaging (`pyproject.toml` optional `dev`)

## Key Dependencies

**Critical:**
- `zod` - canonical domain validation and normalization (`packages/shared/src/schema.ts`)
- `astro` - site build target consumed by desktop and owner flows (`packages/data-core/src/site-build-runner.ts`)
- `express` - owner API surface and static serving (`apps/owner/server/owner-app.ts`)
- `electron` - desktop process orchestration (`apps/desktop/main.ts`)
- `fastapi` + `httpx` - retrieval service protocol implementation (`tools/recording-retrieval-service/app/app/main.py`, `app/services/service_client.py`)

**Infrastructure:**
- `electron-builder` - installer creation (`package.json` `build` section)
- `cheerio` + `iconv-lite` - legacy parsing/import scripts (`scripts/import-legacy.ts`)
- `markdown-it` + `sanitize-html` - content rendering/sanitization in site/data modules
- `playwright` (Python) - retrieval fallback/web scraping path (`tools/recording-retrieval-service/app/app/services/browser_fetcher.py`)

## Configuration

**Environment:**
- Runtime path/mode configuration via env vars in `packages/data-core/src/app-paths.ts`:
  - `ICM_REPO_ROOT`, `ICM_RUNTIME_MODE`, `ICM_ACTIVE_LIBRARY_DIR`, `ICM_APP_DATA_DIR`, `ICM_DEFAULT_LIBRARY_DIR`
- Owner/retrieval ports and service URL:
  - `OWNER_PORT`, `LIBRARY_SITE_PORT`, `RECORDING_RETRIEVAL_SERVICE_URL`
- Site build output override:
  - `ICM_SITE_OUT_DIR` in `apps/site/astro.config.mjs`
- Optional `.env*` files: Not detected in repo root during scan

**Build:**
- TypeScript configs: `tsconfig.json`, `tsconfig.runtime.json`
- Astro config: `apps/site/astro.config.mjs`
- Vitest config: `vitest.config.ts`
- Electron Builder config embedded in `package.json` `build`
- Python project config: `tools/recording-retrieval-service/app/pyproject.toml`
- CI workflow: `.github/workflows/ci.yml`

## Platform Requirements

**Development:**
- Primary supported development path is Windows-first (`README.md`, Windows scripts in `scripts/*.ps1`)
- Node.js 22 + npm required for main repo workflows (`README.md`, CI)
- Python 3.13 required for retrieval service (`pyproject.toml`)

**Production:**
- Desktop distribution target: Windows NSIS installer via Electron Builder (`package.json` `build.win.target`)
- Site deployment target: local/static output in `output/site` and library-specific `build/site` directories (`packages/data-core/src/site-build-runner.ts`)
- Retrieval service deploys as local process (Python or packaged EXE), bound to loopback by default (`127.0.0.1`)

---

*Stack analysis: 2026-04-22*
