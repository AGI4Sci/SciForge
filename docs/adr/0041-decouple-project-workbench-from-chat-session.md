---
status: accepted
reviewed: 2026-08-30
amends: ADR-0039
---

# Decouple the Project Workbench target from the chat Session

The Project Coordinator right panel is a Project Workbench. It may select any Project visible to the current authenticated Principal, regardless of which Project (if any) the hosting chat Session previously coordinated. The selected `projectId` is published through the generic renderer visible-context contract and descriptive composer context so an Agent can route canonical Project Coordinator reads and writes to the exact Project.

The target is routing context only. Session bindings remain useful for durable Coordinator or Worker execution projections, but they are not used as a prerequisite for an explicit Project read. Every command still authorizes the current Principal against the exact Project and enforces Coordinator, member, Task, revision, and execution-fence rules at the canonical handler. This avoids silently changing a user's panel selection when a Session refreshes while preserving the existing authority model.
