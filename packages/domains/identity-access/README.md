# Identity and Access

Package-owned V1 local account selection for SciForge. Local Accounts provide
stable attribution with `local-selection` assurance; they are not security
authentication and do not isolate installation-local data.

The package contributes the generic `main.principal-provider` contract under
authority `sciforge.identity-access`. Each immutable local account UUID is the
opaque Principal subject; display-name and first-run preference edits do not
change the authorization `identityVersion`.
