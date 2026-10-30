---
status: accepted
reviewed: 2026-08-24
amends: ADR-0028, ADR-0029
---

# Orchestrate Project content provisioning on the Owner Desktop

Cloud Collaboration owns the Project, exact content provisioning intent and final binding, while the Project Owner Desktop owns the saga that executes ordinary Content Space shared-container and member operations with the Owner's current Provider Connection. One Human confirmation carries the Host-canonical SHA-256 of the complete immutable finite operation plan; the Broker recomputes and binds that digest before minting any one-use proof, and consumes the confirmation on a mismatch so plan replacement cannot fall back to the originally confirmed plan. Each underlying call still traverses the canonical Broker/Content Space/Provider path, and failure preserves a recovery journal without deleting Provider content. We reject both Cloud-side Provider administration, which would require shared credentials, and a privileged Content Space `provisionProject` port, which would import Project semantics into the wrong domain.
