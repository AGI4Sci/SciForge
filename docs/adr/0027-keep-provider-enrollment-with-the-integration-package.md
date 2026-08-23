---
status: accepted
reviewed: 2026-08-20
---

# Keep Provider enrollment with the integration package

The OpenContent integration package owns its Human enrollment UI and main-process connection lifecycle in one package and version, while Tokens, credentials, endpoint policy, sessions, and transport remain main-process only. Content Space owns a provider-neutral renderer slot that mounts the integration-owned enrollment view only after the Human selects the matching Provider Instance; OpenContent has no standalone workbench or plugin-configuration surface. Content Space never imports the OpenContent UI or Connector, and the renderer receives no callable transport, Token, credential, or endpoint policy. When a trusted Provider Instance is replaced, removed, or temporarily unavailable, the integration retains the cleanup responsibility until the owning Human Principal can securely delete that credential. Its unavailable enrollment view exposes the same local unbind only behind explicit Human confirmation; cleanup performs no Provider business call and never rebinds or reuses the credential.
