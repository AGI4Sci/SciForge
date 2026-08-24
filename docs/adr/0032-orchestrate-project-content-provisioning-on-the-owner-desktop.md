---
status: accepted
reviewed: 2026-08-24
amends: ADR-0028, ADR-0029
---

# Orchestrate Project content provisioning on the Owner Desktop

Cloud Collaboration owns the Project, exact content provisioning intent and final binding, while the Project Owner Desktop owns the saga that executes ordinary Content Space shared-container and member operations with the Owner's current Provider Connection. One Human confirmation binds an immutable finite operation plan, each underlying call still traverses the canonical Broker/Content Space/Provider path with one-use proof, and failure preserves a recovery journal without deleting Provider content. We reject both Cloud-side Provider administration, which would require shared credentials, and a privileged Content Space `provisionProject` port, which would import Project semantics into the wrong domain.
