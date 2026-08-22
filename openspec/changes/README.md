# OpenSpec change queue

OpenSpec reports any change with unchecked tasks as `in-progress`; this repository also preserves reviewed deferred designs. The CLI status alone is therefore not an implementation-order signal.

## Current provider-integration order

Change 1 is one product milestone implemented through three ordered OpenSpec changes:

1. `add-secure-provider-credentials`
2. `add-opencontent-connector` — existing-account enrollment plus private authentication/transport
3. `add-opencontent-content-space-provider-v1` — personal/team browsing, create-folder, upload-new, download, and trusted development-profile admission for UI and Agent

Then:

4. Change 2: Cloud Collaboration-owned `ProjectContentSpaceBinding` and Project UI selection of an exclusive Team directory
5. `add-shared-documents-v1` — deferred until the preceding sequence is complete and explicitly reopened
6. A future Connector Document-port change
7. `add-opencontent-document-provider-v1` — deferred behind Shared Documents and the Document port

ADRs 0025–0028 are authoritative for this order and its identity/connection/Project boundaries. Package presence, an unchecked task list, external evidence, or a successful sibling operation does not promote a deferred change or operation.

## Collaboration authority

`unify-user-device-collaboration` and the implemented collaboration packages supersede the historical all-in-one Keycloak-based Cloud Collaboration PoC baseline. The current boundaries are separate and explicit: provider challenge pairing verifies external communication endpoints, while the `identity-access` domain package owns Desktop system-browser OIDC Authorization Code with PKCE, canonical `/v1/me` projection, and Device-backed Principal transitions. The SciForge Cloud API remains an external deployment dependency and is not imported into the Desktop package.
