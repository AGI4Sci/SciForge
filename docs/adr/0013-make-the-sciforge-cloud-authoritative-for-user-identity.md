---
status: accepted
---

# Make the SciForge cloud authoritative for user identity

A Canonical SciForge User is established by SciForge Cloud after unified identity authentication and receives an opaque, permanently stable cloud-generated user ID; the Keycloak `issuer + subject` remains a unique authentication binding rather than the business identifier. The desktop application does not create a cloud identity or treat installation, operating-system, window, Agent, Local Account, Zulip Account, or another provider identity as a substitute. Local chat, Workspaces, models, and tools remain usable without login, but cloud Projects, remote Sessions, multi-user Tasks, Agent registration, and external-account authority require a current cloud-authenticated Human Principal; ADR-0014 remains the accepted temporary Local Account stage rather than superseding this cloud target.
