---
status: deferred
reviewed: 2026-08-17
---

# Use system-browser OIDC with PKCE for desktop login

SciForge Desktop is a secretless public Keycloak client and authenticates through the system browser using Authorization Code with PKCE. The Electron application never embeds the Keycloak login page, collects the user's password, uses an implicit flow, shares the Zulip client, or distributes a confidential client secret; cloud deployment topology remains outside the login module contract.

## Deferral audit

This remains a defensible design for a future desktop OIDC change, but it is not the current collaboration login or identity path and no active implementation provides it. The current PoC uses provider challenge pairing plus user/endpoint/Agent credentials. Promoting OIDC+PKCE requires a new reviewed identity change, migration contract, and source/packaged security evidence.
