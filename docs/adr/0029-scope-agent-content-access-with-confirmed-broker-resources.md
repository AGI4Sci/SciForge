---
status: accepted
reviewed: 2026-08-18
---

# Scope Agent content access with confirmed Broker resources

A Personal Session Agent does not inherit every Content Container visible to the executing owner's Provider Token. Before requesting root authority, an Agent handling an explicit external Provider intent may use the provider-neutral native path to read bounded, label-only personal or shared root candidates for a trusted Provider Instance. This projection contains no Provider resource identity and grants no content authority; when no exact unambiguous choice exists, the Agent asks the Human instead of guessing.

The Agent then requests Human confirmation for one exact personal or shared root that Content Space can currently enumerate. The Host Broker re-enumerates live state and issues a short-lived resource bound to the exact Agent caller, current Principal, and Workspace context only for one exact match. Listing an authorized directory may issue resources for its direct children; later reads and writes derive their Provider target only from those resources, never from a caller-supplied raw GUID, descriptive reference, or connection hint.

Human global raw-reference capabilities, Agent global root-discovery/authorization capabilities, and Agent resource-scoped content capabilities are distinct admission contracts but converge on the same Content Space service, pinned Provider, Principal-owned connection, and transfer implementation. Every Agent create, upload, or download remains separately confirmed. Change 2 must disable ad-hoc root authorization for Project Tasks and issue only the current `ProjectContentSpaceBinding` directory resource, whose descendants follow the same rule.
