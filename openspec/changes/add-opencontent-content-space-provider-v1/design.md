## Context

Content Space already owns references, capabilities, confirmation policy, service routing, transfer handles, UI, and the ContentSpaceProvider SPI. The Connector contributes the reviewed OpenContent instance and owns binding, Token use, API schemas, and two-stage transport behind a Host-mediated token-free facade. This adapter only maps between those contracts.

## Goals / Non-Goals

**Goals:**

- Show the bound account's personal library and accessible Team libraries through provider-neutral containers.
- Browse, create folders, upload new files, and download files through one canonical UI/Agent path.
- Preserve exact Principal/connection, scope, target ancestry, confirmation, Workspace, limits, cancellation, conflict, and uncertainty boundaries.

**Non-Goals:**

- Login/Token/HTTP behavior, endpoint selection, Provider ACL/member management, Project lifecycle, Shared Documents, collaborative editing, or automatic synchronization.
- Overwrite/update, automatic rename, delete, move, share, search, or immutable ArtifactReference claims.

## Decisions

### Map OpenContent libraries without importing vendor terms into the domain

`GetTopPersonalFolderId` becomes one container with `scope: personal`. Each `GetMyTeamList` item becomes one container with `scope: shared`. Team is a provider DTO, not a SciForge Project. The adapter resolves the Team root and uses `folderGuid` as the stable portable `containerId`; numeric `folderId` remains an internal lookup detail. Folder/file child identity is validated and bounded before mapping.

### Keep one service path with audience-specific Broker admission

Both audiences converge on the same Content Space service, pinned Provider, and Connector facade. Human UI capabilities remain global only for the current renderer Principal. Agent content capabilities are resource-scoped: the Agent must first request a confirmed `authorize-agent-root` operation for an exact personal or Team root currently returned by `listContainers`. The Broker returns only an opaque, caller/Principal/Workspace-bound resource; listing a directory issues descendant resources, and later Agent operations derive their target from those resources instead of accepting raw parent/file references. Writes retain a separate confirmation for every create, upload, and download. The adapter receives no caller-selected connection and can neither widen the current execution authorization nor choose an account.

Personal Session authorization contains an explicit personal or Team library root approved by the Human and expires with its bounded Broker resources. The Agent cannot call the Human global browse/write actions. Project Task authorization, once Change 2 exists, will disable ad-hoc root authorization and issue only the current Project Content Directory resource. Descendants arise only from listing an already-authorized directory, so a raw sibling GUID cannot widen scope; OpenContent ACL then independently authorizes the account.

### Keep Workspace bytes behind Host one-shot grants

Agent upload input is only a relative path inside its currently authorized Workspace. Host resolves and validates the real path, regular-file status, symlink escape, size, and access, then creates one upload handle after Human confirmation. Agent download names a new relative path in that Workspace; Host rejects an existing destination, downloads to a temporary file, and atomically commits it. The provider and renderer never receive arbitrary filesystem paths. Each transfer is independent; there is no sync/mirror/mount/delete coupling.

### Admit an exact development profile, not caller-controlled readiness

The compile-time development profile pins the shared demonstration Provider Instance, Change 1 operations, UI/Agent audiences, 16 MiB upload and 1 GiB download limits. Production remains blocked. A successful operation cannot promote another operation, account class, instance, or audience.

### Preserve conflicts and ambiguous writes

Create-folder/upload-new send exact names. Existing names return typed conflict; no overwrite or automatic rename occurs. If the Connector cannot prove whether a write committed, the adapter returns `outcome_unknown` and never retries. Download never overwrites a local file and commits only after complete validated transfer.

## Risks / Trade-offs

- A Team name is display-only and may change; stable folder identity anchors the reference.
- Folder ancestry checks may require provider metadata calls. Failure or ambiguity denies access rather than assuming containment.
- A shared demo instance cannot prove production isolation. The trusted profile is intentionally development-only.
- The current 16 MiB upload limit is lower than OpenContent's chunking capacity; raising it is a later contract change after two-stage transfer evidence.

## Migration Plan

1. Extend the provider-neutral container summary with `scope` and add contract tests.
2. Add the adapter package/factory and strict mappings with a mocked Connector facade.
3. Add Host-governed Agent Workspace transfer grants and scope enforcement through the canonical Content Space capability path.
4. Admit read operations after exact schema tests, then create/upload/download independently after write probes.
5. Verify UI and Agent flows against `test3` in the development profile and run source/packaged composition tests.
6. Build `ProjectContentSpaceBinding` only in the separate Change 2.
