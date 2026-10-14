# Acceptance checklist (from the module brief, section 12)

- [ ] Client name to sourced, scored qualification in ~60s (Phase 2; mock only today)
- [ ] Every score has rationale, confidence, and at least one cited/flagged evidence item (schema supports it; mock data)
- [ ] Refine in plain English and see the scorecard update (mock supports weight changes)
- [ ] Account leader completes all three lenses in under 2 minutes (Phase 3)
- [x] Audit gate caps the tier in deterministic code, tested (`packages/shared/src/scoring.test.ts`); UI banner shown. Role-restricted clearing is Phase 3
- [ ] Leader/AI conflicts shown clearly (Phase 3)
- [x] Scorecard labels AI-estimated vs leader-informed (origin chip)
- [ ] Overrides, leader inputs, gate changes versioned and auditable (versions + audit log exist; overrides/leaders pending)
- [ ] Saved qualification in Clients list and hand-off (list done; hand-off is a stub)
