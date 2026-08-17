## Why

The OpenContent Connector owns authentication and transport but intentionally knows no Content Space business semantics. Change 1 needs a separate adapter that maps one bound OpenContent account's personal library and Team libraries into the existing provider-neutral ContentSpaceProvider path for trusted Human UI and Agent operations.

## What Changes

- Add an optional trusted compile-time, main-only `opencontent-content-space-provider` package.
- Register exactly one `main.content-space-provider-factory` contribution for Provider Kind `opencontent` and acquire only the Host-issued token-free Connector facade.
- Map the personal root to one `personal` Content Container and each accessible Team root to one `shared` Content Container. Prefer stable `folderGuid` as portable container identity; keep numeric folder IDs inside the integration.
- Implement the strict Change 1 operation set: list containers, browse directories, create folder, upload-new up to 16 MiB, and download up to 1 GiB.
- Preserve OpenContent ACL as the only permission truth. Unauthorized is returned directly with Human guidance; the adapter never creates accounts, invites members, changes ACLs, or borrows owner/coordinator/admin credentials.
- Enforce Agent scope with confirmed, caller-bound Broker root resources and descendant resources issued only by authorized directory listing. Personal Session can authorize an enumerated personal or Team root; Project Task will use only the Change 2 binding directory and descendants. Every transfer uses a separate explicit approved one-shot Host Workspace grant.
- Keep overwrite, rename, move, delete, share, ACL administration, automatic sync, Artifact issuance without immutable proof, Project binding, and Shared Documents outside this change.

## Capabilities

### New Capabilities

- `opencontent-content-space-provider`: OpenContent implementation of ContentSpaceProvider for bound-account personal/team file access.

### Modified Capabilities

- `content-space`: adds provider-neutral `ContentContainerSummary.scope` and Agent Workspace transfer admission needed by the real provider.

## Impact

- Depends on Content Space V1, Secure Provider Credentials, and the OpenContent Connector.
- Uses the one canonical Content Space capability/service/provider path for both renderer and Agent; no OpenContent-specific IPC/MCP or Host switch is added.
- Change 2 later adds Cloud Collaboration-owned `ProjectContentSpaceBinding`; this adapter never imports Project models.
- Shared Documents remains deferred by ADR-0025.
