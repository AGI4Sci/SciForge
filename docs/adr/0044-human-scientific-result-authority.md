---
status: accepted
---

# Keep scientific result authority in the Human review chain

Collaboration scientific work will represent a Worker result as an immutable, digest-bound Result Bundle whose material Claims require validated EvidenceRefs. The responsible Worker User must review and attest the Bundle, the Coordinator User must approve it or request a result revision, and only Claims from an approved Bundle may enter synthesis; existing summary/output Project Records remain historical and are not promoted into this authority chain.

This separates scientific responsibility from Agent execution while retaining the existing PostgreSQL ledger, Inbox/Outbox, Project Coordinator, and Project Record presentation paths. A result correction keeps the same Task Contract, Execution, and Worker and appends a new result revision; a material work change creates a new Contract revision and Offer.
