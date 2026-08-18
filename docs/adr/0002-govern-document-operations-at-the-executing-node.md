---
status: accepted
---

# Govern document operations at the executing SciForge node

A distributed Project or remote Task may carry a Document Reference, but a Shared Documents operation requested as part of that Task is performed and governed by the full SciForge node that actually executes it. The consuming cloud/thread context owns the Document Reference Association and maps generic receipts to its own states; Shared Documents imports no Project, Task, Record, Coordinator, or Inbox type. The cloud coordinator cannot carry the node’s provider credentials or bypass its identity, approval, capability, and audit boundaries; any future OpenContent use owned directly by the cloud-collaboration context requires its own authority model.
