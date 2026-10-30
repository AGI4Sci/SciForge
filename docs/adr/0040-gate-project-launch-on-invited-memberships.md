---
status: accepted
reviewed: 2026-08-28
amends: ADR-0035
---

# Gate Project launch on invited Memberships

Non-Owner Users selected for a Project begin in the `invited` phase of the Project Membership aggregate and must accept the exact current confirmed Plan through their own OIDC session. This phase permits only bounded launch visibility; it grants no Task Authority and cannot authorize Team provisioning. Keeping invitation consent in the Membership lifecycle preserves one identity and revision for invitation, content activation, removal fencing, and audit, while a separate invitation aggregate would duplicate the same Project/User relationship and create two competing activation paths.
