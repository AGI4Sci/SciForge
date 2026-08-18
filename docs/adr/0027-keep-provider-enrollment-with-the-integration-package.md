---
status: accepted
reviewed: 2026-08-17
---

# Keep Provider enrollment with the integration package

The OpenContent integration package owns its Human enrollment UI and main-process connection lifecycle in one package and version, while Tokens, credentials, endpoint policy, sessions, and transport remain main-process only. Content Space consumes only provider-neutral readiness and Provider contracts and never imports the enrollment UI or Connector; this relaxes the older “package has no renderer” assumption without exposing callable transport to renderer or Agent code.
