# Acceptance checklist (from the module brief, section 12)

- [ ] Client name to sourced, scored qualification in ~60s (built; needs a live timing run via `npm run smoke`)
- [x] Every score has rationale, confidence, and at least one cited/flagged evidence item (enforced in `llm/assemble.ts`, tested)
- [x] Refine in plain English and see the scorecard update (weights and stated assumptions; tested offline)
- [x] Account leader completes all three lenses via taps or a typed/dictated sentence (built; timing not user-tested)
- [x] Audit gate caps the tier in deterministic code; only the Risk role can clear it, with a logged reason (tested in `leaders.api.test.ts`)
- [x] Leader/leader and leader/AI conflicts shown clearly
- [x] Scorecard labels AI-estimated vs leader-informed (origin chip)
- [ ] Overrides, leader inputs, gate changes versioned and auditable (leader inputs and gate changes done; human overrides are Phase 4)
- [ ] Saved qualification in Clients list and hand-off (list done; hand-off is a stub)
