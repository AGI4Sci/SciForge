## 0. ADR 0025 Deferral Gate

- [ ] 0.1 Complete the Content Space/OpenContent cloud-space sequence, complete Shared Documents, and approve a separate Connector Document-port change before starting this adapter.

## 1. Package and Dependencies

- [ ] 1.1 Complete/archive Provider Composition, Portable Resource References, `add-shared-documents-v1`, Secure Provider Credentials, the Content Space Connector work, and the later separately reviewed Connector Document port plus required Broker/trace/principal/confirmation baselines.
- [ ] 1.2 Scaffold main-only trusted compile-time adapter package with strict manifest, exact exports, tests/typecheck, lazy factory, and no renderer/Workspace Server/Agent/MCP/IPC.
- [ ] 1.3 Register one `main.document-provider-factory` for Provider Kind `opencontent`; add no ContentSpaceProvider contribution.
- [ ] 1.4 Bind only the composition-authorized Connector document port and expose no raw Client/Token/DTO/Skill.

## 2. Discovery, Reference, Capability, and Launch Gates

- [ ] 2.1 Pin complete selected search/metadata/capability schemas for `mdoc`, `docx`, `xlsx`, and `pptx`; map only bounded provider-neutral summaries and errors.
- [ ] 2.2 Keep production metadata/reference materialization blocked until BOLA fix/oracle and formal identity/auth/session contracts pass.
- [ ] 2.3 Keep `open-document` blocked until official credential-free route, exact origin/path/redirect, stable identity mapping, browser/API subject alignment, and session coexistence pass.
- [ ] 2.4 Reject portal/share/collaboration link, raw URL, Token URL, extension inference, arbitrary known-ID expansion, and fallback as substitutes.

## 3. Structured Body and Skill Gates

- [ ] 3.1 Keep `.mdoc` structured read/create/change `blocked_by_contract` and perform no Skill integration in this change.
- [ ] 3.2 On Skill delivery, open a separate acceptance change for artifact provenance/license/runtime/network/model/data handling, typed snapshot/stable IDs/revision, frozen plan/apply, atomic conflict, durable idempotency/status, audit, permission, and errors.
- [ ] 3.3 Keep Office structured editing unsupported; reject download-modify-upload, exported Markdown/PDF/Office, HTML, screenshot/OCR, private DTO, raw CRDT, and whole-file replacement as semantic operations.
- [ ] 3.4 Test no vendor Skill/Agent tool/approval/credential path and no apply-time replanning.

## 4. Readiness and Failure

- [ ] 4.1 Project every operation independently as `poc_only`, `blocked_by_contract`, or `production_ready`; package presence/demo/extension/caller data cannot promote.
- [ ] 4.2 Require dedicated non-production tenant and least-privilege users for any product PoC; shared tenant remains fixed external harness only.
- [ ] 4.3 Require API/API, API/browser, and API/Skill same-Human coexistence for production; PoC permits one active API node and no remote Task.
- [ ] 4.4 Test adapter pause/removal, missing Connector, superseded Token, revoked access, malformed DTO, unsafe launch, restricted trace, and no Provider fallback.

## 5. Verification

- [ ] 5.1 Run adapter tests/typecheck, Connector contract tests, Provider catalog tests, generated composition freshness, boundary/governance checks, and changed-file lint.
- [ ] 5.2 Run full regression plus source and packaged smoke/security tests before any readiness promotion.
