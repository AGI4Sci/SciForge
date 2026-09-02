# Identity and Access

Package-owned installation-local account selection for SciForge. Local Accounts
provide stable attribution with `local-selection` assurance; they are optional,
are not security authentication, and do not isolate installation-local data.

The package is the single contributor of the generic `main.principal-provider`
contract. It publishes `sciforge.identity-access` with local-selection
assurance and keeps all account state inside the current installation.

Each immutable local account UUID is the opaque local Principal subject;
display-name and first-run preference edits do not change the authorization
`identityVersion`. The renderer can create, select, rename, and exit local
accounts through the package-owned capability contract.

No network login, cloud account, remote provider, credential transport, or
server-side identity protocol is part of this package. Secret storage and
external authentication are intentionally outside the public local-only
distribution.
