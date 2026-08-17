## Why

After provider-neutral Content Space and a separately reviewed Secure Provider Credentials capability exist, an OpenContent ContentSpaceProvider needs one independently owned authentication and transport implementation. That integration must not move vendor infrastructure into Content Space or Host Core, and it must not pull deferred Shared Documents work into the cloud-space delivery path.

## What Changes

- Add one optional trusted compile-time, main-only `opencontent-connector` package through the standard manifest/generated composition path.
- Make it the sole owner of OpenContent node-local per-Principal connections, authentication/Token lifecycle, owner-scoped credential use, pinned schemas, redaction, and canonical transport.
- Add or reuse a generic Host-mediated owner-scoped internal-service contract. The Connector SHALL publish only a non-callable service descriptor through `main.extension` and register its callable internal-service implementation only through the private generic mediator on its trusted main-entry Host facade; Host SHALL issue the narrow token-free facade only to the allowlisted adapter owner. This is a facade implementation registration, not `main.document-provider-factory` or `main.content-space-provider-factory`.
- Contribute each reviewed OpenContent Provider Instance as a non-secret `main.provider-instance-directory-entry`, and bind Connector-private endpoint/tenant policy to the same reference without exposing it in the directory.
- Define no Document port, optional Document method, universal client, UI/Agent capability, renderer, provider factory, or portable-reference resolver.
- Fail session supersession and uncertain writes closed; never silently log in, retry, choose another connection, or fall back.
- Keep all network operations blocked until Secure Provider Credentials and exact identity/session/schema/authorization/tenant Gates pass.
- Permit the Connector and all OpenContent packages to be absent or paused without affecting Content Space, its mock Provider, or other Providers.

## Capabilities

### New Capabilities

- `opencontent-connector`: Future main-only OpenContent connection, credential use, validated transport, and least-privilege Content Space adapter-port infrastructure.

### Modified Capabilities

None.

## Impact

- This is a future change after Content Space V1 and `add-secure-provider-credentials`; the current Content Space change implements neither credentials nor OpenContent network access.
- Uses generic main-extension/runtime-lifecycle composition, with no Host OpenContent feature map or Provider/vendor switch.
- The Connector itself registers neither DocumentProvider nor ContentSpaceProvider; the later adapter owns the Content Space factory.
- Content Space already owns portable reference codecs/resolution. The Connector does not compete for those kinds.
- After the adapter is complete, a separate OpenContent cloud-space PoC milestone must add a trusted Content Space service policy/audience Gate before any `poc_only` operation can execute. Shared Documents stays deferred.
