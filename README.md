# AI Native NewCo Campaign Hub

Module 1: **Client Qualification**. Chat-first scoring of whether a client is a good fit for the AI Native Enterprise campaign and whether we are positioned to pitch.

> **Data handling:** client data must be handled per firm policy. The app does not make independence determinations; follow the firm's official independence process.

## Status
Phases 1-3 built. Phase 2 (real research and scoring) is covered by offline tests; run `npm run smoke` with a key to verify it live. See [docs/acceptance.md](docs/acceptance.md) and the phase plan below.

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, data model, chat + scorecard layout, mock LLM, scoring + gate logic | Done |
| 2 | Real research (web search) and scoring via Anthropic, sector memory, refinement, PDF/text attachments | Built, needs live check |
| 3 | Account leader input, role-restricted audit gate, conflict highlighting | Built (tested on mock AI) |
| 4 | Clients search, compare, bulk mode, overrides, PDF export | |

## Account leaders and the audit gate (Phase 3)
No login yet: use the **Viewing as** switcher (top right) to act as a consultant, one of three account leaders, the Risk / Independence role, or leadership. The server looks the role up from the user, and enforces it on gate changes.

- **Ask account leader** (scorecard): pick one or more leaders; they get an in-app notification (badge on My Requests) and a link you can copy for email.
- **Leader review page**: AI summary first, then three lenses with one-tap answers, or type / dictate a sentence and confirm the draft. AI-suggested answers are labelled "Suggested, please confirm" and must be confirmed. Nothing is saved until the leader submits.
- **Each leader's view is kept and shown separately**, with name, role, time and the scorecard version it reacted to. Disagreement is spelled out ("1 of 2 rate executive access as Strong; 1 rates it Weak"). For the score, brand permission and executive relationship use the most conservative leader view by default (`leader_aggregation` in `config/methodology.yaml`, or `median`).
- **AI vs leader conflicts** (a gap of 2+ points) are flagged, with a suggested softer entry point or different sponsor.
- **Audit gate**: follows leaders' answers (audit or related-entity audit client -> restricted, tier capped at "Nurture (advisory-only)"; "Unsure" -> blocks "Pursue now" and notifies Risk). Leaders and the AI can only tighten it. Only the **Risk / Independence** role can clear or change it, with a required reason; every change and every denied attempt is audit-logged. After Risk decides, only newer leader answers can re-tighten it. Caps come from `config/independence.yaml` (placeholder rules, not validated by Risk).
- **Leader commentary** is hidden from the read-only leadership role.
- Email is a stub (logged to the server console); in-app notifications are real.

## Real AI mode
```bash
cp .env.example .env     # add ANTHROPIC_API_KEY (stays on the server)
npm run dev              # uses the real provider when a key is set, otherwise the mock
npm run smoke -w @ainative/api -- "Qualify Acme Insurance, UK P&C insurer"   # live check with timings
```
How it works: one call reads the request; two research calls (client and sector, in parallel) use web search; a separate scoring call returns schema-constrained JSON. In code, a claim only stays a **Fact** if its source was actually retrieved, otherwise it is downgraded to **Inference**. Tier, score and the audit gate are computed in code, never by the model. Sector research is cached for 30 days (refresh button on the scorecard). Model defaults to `claude-sonnet-5-5` (`ANTHROPIC_MODEL` to change).

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
