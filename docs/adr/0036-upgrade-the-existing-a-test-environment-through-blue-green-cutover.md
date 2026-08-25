---
status: accepted
reviewed: 2026-08-25
---

# Upgrade the existing A test environment through a blue-green cutover

The first live meeting PoC reuses `cloud-test.sciforge.cn` and the existing `login-test.sciforge.cn/realms/SciForge` issuer instead of waiting for a second Run-0 DNS/issuer stack. The current Cloud database is backed up, restored into an independently named candidate, migrated and verified before the existing edge upstream is switched, while the old app/database remain the rollback target; this deliberately trades isolation purity for delivery speed without allowing an unbacked in-place migration.
