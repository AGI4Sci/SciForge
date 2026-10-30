---
status: accepted
---

# Attach document references to consumer contexts, not Workspaces

Threads, Task inputs, live evidence, and Project Records may explicitly own a Document Reference Association containing a portable live Document Reference, while Shared Documents only resolves it. Evidence that must preserve the observed state records the observed revision as association provenance or uses a version-fixed Artifact Reference; completed task `artifactRefs` accept only Artifact References, never live Document References. V1 creates no persistent Workspace binding because current Workspace identity is path- or session-locator-based and unsuitable for durable resource identity; this keeps cloud and Workspace models out of the domains at the cost of having no automatic Workspace-level document catalog.
