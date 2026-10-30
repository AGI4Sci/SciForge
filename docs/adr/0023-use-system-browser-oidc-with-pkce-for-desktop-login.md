---
status: accepted
reviewed: 2026-08-22
amends: ADR-0014, ADR-0015
---

# Use system-browser OIDC with PKCE for desktop login

SciForge Desktop is a secretless public Keycloak client and authenticates through the system browser using Authorization Code with PKCE. The Electron application never embeds the Keycloak login page, collects the user's password, uses an implicit flow, shares the Zulip client, or distributes a confidential client secret; cloud deployment topology remains outside the login module contract.

## Current implementation

The `identity-access` domain package owns the Desktop OIDC lifecycle, encrypted session persistence, canonical `/v1/me` projection, Device enrollment and revocation state, renderer contribution, and the `cloud-authenticated` Principal transition. It validates the configured issuer, JWKS signature, RS256 algorithm, signing `kid`, audience, authorized party, subject, and required NumericDate claims before exposing a signed-in state.

Cloud configuration is explicit. Missing or invalid issuer or Cloud API configuration fails closed without substituting an in-memory identity service or a default endpoint. Local Account selection remains available as `local-selection`, but it cannot authorize Cloud operations. `cloud-authenticated` is published only while the current OIDC user maps to a canonical Cloud User and the current Desktop Device is `ACTIVE`.

Provider challenge pairing remains a separate external-account verification path and does not replace, bootstrap, or inherit the OIDC Human Principal. The SciForge Cloud API and its persistence implementation remain an external deployment dependency governed by the shared API contract rather than code imported into this Desktop change.
