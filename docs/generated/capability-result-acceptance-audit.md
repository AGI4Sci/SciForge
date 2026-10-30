# Capability result-acceptance audit

Generated from the 198-action Agent-visible plan. Effect counts are derived from the Registry: compute 13; destructive 12; external-write 39; read 76; workspace-write 58.

| Effect | Actions | Fixture/oracle status | Acceptance method | Boundary obligations |
| --- | ---: | --- | --- | --- |
| compute | 13 | fixture 3/13; oracle 3/13 | terminal state plus trace closure and artifact readback；provider mode, attempts, event sequence, output schema, artifact count and blocked/failure semantics | invalid-input-or-missing-resource, provider-failure-or-timeout |
| destructive | 12 | fixture 1/12; oracle 1/12 | before/after protected-state readback；target identity, deletion/restoration result, absence/presence and audit record | invalid-input-or-missing-resource, stale-revision-or-precondition, approval-allowed, approval-denied-no-side-effect |
| external-write | 39 | fixture 1/39; oracle 1/39 | isolated service receipt plus service-side readback；request payload, response identity, protected side effect and approval-denied absence | invalid-input-or-missing-resource, approval-allowed, approval-denied-no-side-effect |
| read | 76 | fixture 27/76; oracle 27/76 | structured value/state readback；identity, count, ordering, range, empty-result and missing-resource checks | invalid-input-or-missing-resource |
| workspace-write | 58 | fixture 37/58; oracle 37/58 | parse workspace output plus manifest/content hashes；before/after state, format validity, parent lineage and idempotency where applicable | invalid-input-or-missing-resource, approval-allowed, approval-denied-no-side-effect |

The methods above are acceptance contracts, not live acceptance results. A successful invocation without independent output/state readback remains invocation-succeeded only.
