## Why

Content Space V1 is provider-neutral and cannot authenticate or speak OpenContent. Change 1 needs one independently owned integration that binds an existing OpenContent account to the current Local Account, protects its Token, and exposes only a narrow validated transport facade to the OpenContent ContentSpaceProvider.

## What Changes

- Add one optional trusted compile-time `opencontent-connector` package with separate main and renderer entrypoints in the same package/version.
- Add a Human-only enrollment panel for bind, connection status, reauthenticate, and unbind. SciForge never creates an OpenContent account.
- Bind at most one node-local Provider Connection to each `(current Human Principal, Provider Instance)`; the executing node owner's current connection is always authoritative and cannot be supplied by a requester, Task, prompt, or portable reference.
- Accept an existing username/password only for the bind transaction, validate the resulting Token with OpenContent, persist only the encrypted Token, and never persist or trace the password.
- Make the Connector the sole owner of OpenContent endpoint policy, authentication/session lifecycle, pinned schemas, redaction, and canonical two-stage transfer transport.
- Publish only a non-callable service descriptor and register the callable implementation through a generic Host-mediated owner-scoped internal-service contract. Only the separately composed OpenContent Content Space adapter receives its token-free facade.
- Contribute the reviewed OpenContent Provider Instance as a non-secret directory entry. The shared demonstration endpoint is admitted only by a trusted development profile; caller input cannot select an endpoint or promote readiness.
- Define no Document port/provider, Shared Documents behavior, ContentSpaceProvider factory, portable resolver, raw public client, or credential-bearing renderer/Agent capability.

## Capabilities

### New Capabilities

- `opencontent-connector`: Human enrollment plus main-process OpenContent connection, credential use, validated transport, and least-privilege Content Space adapter infrastructure.

### Modified Capabilities

None.

## Impact

- Depends on provider-neutral Content Space V1 and `add-secure-provider-credentials`.
- Uses standard manifest/generated composition and generic Host contracts; Host Core gains no OpenContent switch or feature map.
- The later `add-opencontent-content-space-provider-v1` change maps the facade into ContentSpaceProvider and admits the exact Change 1 operation set for trusted UI and Agent audiences.
- Shared Documents and every Document adapter/port remain deferred by ADR-0025.
