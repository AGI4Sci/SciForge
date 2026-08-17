---
status: accepted
reviewed: 2026-08-17
---

# Scope Agent content access with confirmed Broker resources

A Personal Session Agent does not inherit every Content Container visible to the executing owner's Provider Token. It first requests Human confirmation for one exact personal or shared root that Content Space can currently enumerate. The Host Broker then issues a short-lived resource bound to the exact Agent caller, current Principal, and Workspace context. Listing an authorized directory may issue resources for its direct children; later reads and writes derive their Provider target only from those resources, never from a caller-supplied raw GUID or connection hint.

Human global Content Space capabilities and Agent resource-scoped capabilities are distinct admission contracts but converge on the same Content Space service, pinned Provider, Principal-owned connection, and transfer implementation. Every Agent create, upload, or download remains separately confirmed. Change 2 must disable ad-hoc root authorization for Project Tasks and issue only the current `ProjectContentSpaceBinding` directory resource, whose descendants follow the same rule.
