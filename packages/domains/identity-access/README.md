# Identity and Access

Package-owned V1 local account selection for SciForge. Local Accounts provide
stable attribution with `local-selection` assurance; they are not security
authentication and do not isolate installation-local data.

The package is the single contributor of the generic `main.principal-provider`
contract. It publishes `sciforge.identity-access` with `local-selection` by
default. A selected account is promoted to `sciforge-cloud` with
`cloud-authenticated` only while the current OIDC user matches its cloud link
and the current login session has freshly confirmed an active cloud Device.
Logout or Device revocation advances `identityVersion` and immediately falls
back to local selection.

Each immutable local account UUID is the opaque local Principal subject;
display-name and first-run preference edits do not change the authorization
`identityVersion`.
