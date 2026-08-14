## 1. Domain contracts and composition

- [ ] 1.1 Add strict pairing, projection, provider locator, message receipt, lifecycle, status, and redacted error schemas to a public domain contract entrypoint.
- [ ] 1.2 Create `@sciforge/domain-remote-client` with separate main/renderer entrypoints and `sciforge.domain.json`; register it only through generated composition.
- [ ] 1.3 Add the minimal generic domain SDK contributions for AgentRuntime thread events, secret references, settings UI, and provider adapters without provider IDs in Host code.
- [ ] 1.4 Add architecture tests forbidding Host-private imports, central provider maps, provider-specific Host configuration, and duplicate mirror IPC paths.

## 2. Client pairing

- [ ] 2.1 Implement installation-owned pairing persistence with stable opaque IDs, state, access scope, owner lease, and redacted status.
- [ ] 2.2 Store credentials exclusively through the local secret store and audit settings, logs, QR payloads, diagnostics, tests, and exports for secret leakage.
- [ ] 2.3 Implement the provider adapter contract and migrate Zulip authentication, event queue, stream/topic lookup, send, retry, and self-event filtering into the domain package.
- [ ] 2.4 Add explicit ownership conflict/takeover, pause/resume, revoke, and unauthorized-sender behavior.

## 3. Session projection

- [ ] 3.1 Implement stable Session projection persistence keyed by projection ID with runtime/thread/workspace and provider locator metadata.
- [ ] 3.2 Implement share/link existing Session, create Session, rename, pause/resume, close, relink, and status operations through one canonical service.
- [ ] 3.3 Make new remote Sessions create a new local thread and new topic/projection rather than retargeting an existing topic.
- [ ] 3.4 Reconcile topic rename/move events without changing projection identity; handle missing or ambiguous locators as explicit errors.
- [ ] 3.5 Preserve one topic = one Session and allow multiple topic projections for the same Project.

## 4. Bidirectional synchronization

- [ ] 4.1 Implement the durable receipt ledger and one ordered queue per projection, including startup recovery and bounded provider history catch-up.
- [ ] 4.2 Route remote text messages once into the linked thread with origin/sender metadata and mirror the final assistant reply.
- [ ] 4.3 Mirror desktop user messages and final assistant replies through the same receipt service; remove renderer-specific duplicate tracking once the canonical path is live.
- [ ] 4.4 Add idempotent retry, provider replay handling, Bot self-event filtering, missing-thread failure, and redacted diagnostics.
- [ ] 4.5 Ensure remote messages use the existing runtime model/mode and capability broker approval/audit path with no remote approval bypass.

## 5. Pairing and Session UI

- [ ] 5.1 Replace provider/workspace-first Connect Phone UI with client-level pairing that succeeds without a focused Project.
- [ ] 5.2 Add a Session sharing surface that lists local Projects/Sessions, creates or links topics, shows message-sync health, and never follows desktop focus implicitly.
- [ ] 5.3 Display shared-topic semantics, authorized users, queue state, last delivery, failures, pause/close actions, and sensitive-data guidance.
- [ ] 5.4 Add mobile command/help responses for listing Projects/Sessions, creating a new Session projection, status, and explicit close/relink.

## 6. Remove the legacy path

- [ ] 6.1 Remove legacy workspace-channel binding reads/writes, topic-derived config IDs, `/use project` retargeting, and `/new` retargeting behavior.
- [ ] 6.2 Delete Host-owned Zulip/remote-channel runtime implementations, provider IPC handlers, renderer provider branches, stale settings fields, unused exports, tests, and dependencies after auditing references.
- [ ] 6.3 Provide a single upgrade notice requiring re-pair and re-link; do not add a runtime compatibility facade or dual registration.
- [ ] 6.4 Regenerate domain composition and verify source and packaged application resolution.

## 7. Verification and documentation

- [ ] 7.1 Add contract and unit tests for stable IDs, non-ASCII titles, strict redaction, access scope, lifecycle, ordering, dedupe, retries, restart recovery, and governance.
- [ ] 7.2 Add fake-provider/fake-runtime integration tests plus live Zulip acceptance coverage for two users, two topics, rename, reconnect, offline recovery, and self-event filtering.
- [ ] 7.3 Add renderer tests for pairing without workspace, Session sharing, explicit lifecycle, sync status, and absence of legacy workspace binding UI.
- [ ] 7.4 Run package-boundary checks, generated-composition freshness, typecheck, focused tests, full regression tests, changed-file lint, and packaged-app smoke tests.
- [ ] 7.5 Update user and operator documentation to distinguish client pairing, Session projection, message synchronization, provider credentials, local-online requirements, mobile push, and recovery.
