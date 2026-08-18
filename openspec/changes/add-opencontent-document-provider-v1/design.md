## Context

ADR 0025 defers Shared Documents and all OpenContent Document work. The active Connector proposal intentionally defines no Document port. Before this adapter can begin, Shared Documents must be completed and a separate change must add an independently declared, authorized, readiness-gated Document facade to the same Connector.

OpenContent SDK/verification evidence identifies candidate search/metadata/create/link endpoints and a vendor-announced `.mdoc` editing Skill, but does not prove safe structured snapshots, deterministic operations, AuthoritativeRevision, conditional apply, durable idempotency, safe deep links, full Token lifecycle, session coexistence, or metadata authorization.

See `docs/opencontent-api-verification-context.md`, `docs/opencontent-partner-meeting-evidence-2026-08-13.md`, and `add-opencontent-connector`.

## Goals / Non-Goals

**Goals:**

- Register an OpenContent DocumentProvider adapter with per-operation readiness.
- Map only proven OpenContent behavior into strict Shared Documents schemas.
- Preserve one Broker/domain/Provider/Connector path and provider-native browser UI.

**Non-Goals:**

- Implementing or accepting the undelivered Skill in this change.
- Provider-specific Agent tools, editor panels, Browser Preview, private APIs, raw CRDT, whole-file semantic editing, or Office structured edit.
- Claiming production readiness from SDK endpoint existence, oral statements, demos, or PoC success.

## Decisions

### Contribute only DocumentProvider

The package imports the public DocumentProvider contract and its Connector port, maps bounded results, and registers Provider Kind `opencontent`. It has no renderer, public Broker capability, credential ownership, ContentSpaceProvider, or file-transfer semantics.

### Gate each operation separately

Search, reference/metadata, capability query, document launch, structured read, create, and change have separate readiness. Formats do not imply capability. Current incomplete evidence leaves production blocked; exact dedicated-tenant PoC operations may be admitted only after their identity/authorization/schema Gates pass.

### Treat Skill as future acceptance artifact

The announced editing Skill contributes no capability until a separate change verifies supply chain, callable typed boundary, structured snapshot, frozen operations, revision/conflict, durable idempotency/status, audit, permission/errors, data handling, and no apply-time replanning.

### Keep launch independent of collaboration/share links

Only an official credential-free document route with exact origin/path/redirect and browser/API subject/session alignment may produce DocumentLaunchTarget. Provider portal, share/collaboration link, raw URL, or Token-bearing URL is not document launch.

## Risks / Trade-offs

- **[Endpoint existence is mistaken for contract]** → Runtime-validate complete selected schemas and maintain blocked readiness until proof.
- **[Natural-language Skill changes after confirmation]** → Accept only frozen typed plan/apply; otherwise keep write blocked.
- **[Browser/API login supersedes Token]** → Require formal session coexistence for production; no auto-login/credential forwarding.
- **[Adapter pause breaks Shared Documents]** → Catalog reports unavailable; mocks/other Providers/launcher contracts continue without fallback.

## Migration Plan

1. Complete Provider composition, Shared Documents domain, Connector, principal/credential/trace/confirmation prerequisites.
2. Add adapter package/factory/mappers with every operation blocked.
3. Promote discovery/reference/capability/launch independently as exact Gates pass.
4. Handle delivered Skill in a separate acceptance change; enable structured read/write only after full contract verification.
5. Remove/pause package cleanly through generated composition.
