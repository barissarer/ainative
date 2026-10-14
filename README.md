# AI Native NewCo Campaign Hub

Module 1: **Client Qualification**. Chat-first scoring of whether a client is a good fit for the AI Native Enterprise campaign and whether we are positioned to pitch.

> **Data handling:** client data must be handled per firm policy. The app does not make independence determinations; follow the firm's official independence process.

## Status
Phase 1 (scaffold + mocked LLM) complete. See [docs/acceptance.md](docs/acceptance.md) and the phase plan below.

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, data model, chat + scorecard layout, mock LLM, scoring + gate logic | Done |
| 2 | Real research (web search) and scoring via Anthropic, sector memory, refinement | Next |
| 3 | Account leader input, gate admin/clearing, conflict highlighting | |
| 4 | Clients search, compare, bulk mode, overrides, PDF export | |

## Run
```bash
npm install
npm run dev        # API on :8787, web on :5173
npm test
```
Dev data lives in `.data/` (PGlite, real Postgres in WASM). The same migrations in `supabase/migrations` run on hosted Postgres/Supabase.

## Layout
- `apps/web` React + TypeScript + Tailwind
- `apps/api` Fastify API; LLM provider interface (`llm/`), currently a deterministic mock
- `packages/shared` types, Zod schemas, scoring and gate logic (tested)
- `config/methodology.yaml` weights, thresholds, rubric, prompts (editable, no code change)
- `config/independence.yaml` audit gate rules. **Placeholder, not validated by Risk / Independence.**

## Default weights (proposed)
Client circumstances 20, Executive relationship 20, Offering fit 15, Brand permission 15, Competitive landscape 10, Sector dynamics 10, AI impact 10. Tiers: Pursue now >= 70, Nurture >= 45, else Deprioritize. The audit gate can only lower a tier.

## Access control
Intentionally omitted for now (no login). Roles and row-level security come later.
