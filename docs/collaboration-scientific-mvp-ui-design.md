# Collaboration scientific MVP UI design

**Status:** proposed UI design, grounded in the existing renderer code. No renderer code has been changed by this document.

The current UI already has the two right surfaces needed for this MVP: `domain-collaboration` owns the participant/device and personal task surface, while `domain-project-coordinator` owns the Project plan, review and recovery surface. The design keeps those surfaces and changes their state presentation; it does not add a new Host route, chat surface or second collaboration panel.

## Worker surface

The existing `CollaborationPanel` remains the entry point. `ProjectsSection` becomes a clear “My Work” surface with three visual groups:

```text
My Work
├─ Offers waiting for your decision
├─ My active executions
└─ Results waiting for my review / attestation
```

The current compact project cards and `StatusPill` styling remain. A task row becomes a Task Offer card with:

- project and task title;
- Contract revision and a short, read-only acceptance criterion summary;
- `Assigned to you` as the User responsibility, with `This Desktop` shown only after this device claims;
- a small “All your active Devices see this Offer” note while pending;
- one primary **Accept on this Desktop** action, one explicit **Reject Offer** action and one low-emphasis **Ignore on this Desktop** action;
- a durable state line after the click: `Claiming on this Desktop`, `Claimed on another Desktop`, `Offer rejected`, or `Offer withdrawn`.

`Accept` is one human click. It does not open a second acceptance-intent dialog. `Reject` is a shared User decision and should use the existing confirmation pattern because it closes the Offer on every Device. `Ignore` only removes the card from the current Device. A stale or losing click changes the card to the server state and never displays a local success claim.

The current “Worker offer policy” label and automatic/manual selector are removed from `ParticipantSection` and `AgentRow`. The Agent card keeps Device, Agent, online/readiness and Provider readiness facts, but these facts explain whether the current Desktop can execute; they do not imply that an offline User cannot receive an Offer.

### Worker result review card

When the local Agent has produced a draft, the task card opens a focused result review card instead of showing the raw `resultSummary` as if it were an accepted result:

```text
Result draft · Contract 3 · Result 1
Worker responsibility: You

Summary                         [editable]
Claims (3)                      [expand each]
  quantitative                  claim text · evidence status
  method                        claim text · evidence status
EvidenceRefs (2)                [open Team Library / show blocked reason]
Interventions (optional)        [add / edit / remove]

[Save draft locally]  [Review and attest]
```

The Contract is displayed beside the editor as a read-only reference. Editing the summary, Claims or interventions never edits the Contract. `Review and attest` is disabled until every material Claim has a valid EvidenceRef and the Bundle digest can be computed. If OpenContent immutable evidence is still blocked, the card shows the exact reason and allows local draft editing but not Attestation.

After Attestation, the Worker sees `Waiting for Coordinator review`. A revision request returns the same card with the prior Bundle shown as history and a new editable result revision. The card never presents a revision-requested Bundle as approved.

### Worker status states

| Cloud state | Worker presentation | Available action |
| --- | --- | --- |
| `offered` | Offer waiting for your decision | Accept, Reject, Ignore |
| local `accept-pending-sync` | 接受待同步; Cloud has not confirmed | Wait for durable replay |
| accepted / local `waiting-runtime` | 已领取 · 等待 Runtime | Restore the original Device Runtime |
| `in_progress` / local `running` | Running on “This Desktop” | View progress, send message |
| `timed_out` / local `expired` | 已过期 | View history |
| `needs_human` / local draft | Review your result draft | Save draft, Attest |
| `result_submitted` | Waiting for Coordinator review | View immutable Bundle |
| `revision_requested` | Revision requested | Edit and submit next result revision |
| `completed` | Approved and complete | Read Bundle and Approved status |
| claimed elsewhere / withdrawn | Closed on another Device or by Coordinator | View history |

Progress and task messages appear in a separate activity foldout. They are visibly labelled `Progress` or `Message`, never `Claim` or `Evidence`, and never share the approval badge.

## Coordinator surface

The existing `ProjectCoordinatorPanel` keeps its current Plan, Dispatch, Execute, Review and Complete stages. The result-review article currently displaying a summary, output locators, next Worker, expiry and next output filename becomes a scientific Bundle review card.

```text
Review
├─ Needs Worker attestation
├─ Needs Coordinator decision
├─ Approved Claims
└─ Historical Bundles
```

The **Needs Coordinator decision** card shows:

- Task Contract revision and material-field digest;
- Worker User, claimed Device and Execution;
- Result revision and Bundle digest;
- summary, expandable Claims grouped by type;
- each EvidenceRef's verification status and Team Library label;
- interventions and output references;
- Worker Attestation identity, timestamp and digest match.

The only decision controls are **Approve Bundle** and **Request Result Revision**. Request Revision asks for an instruction; it does not ask for another Worker, a new Offer expiry or a replacement output filename. Those are reassignment controls and stay in the separate explicit recovery/reassignment flow. Approve changes Claims to synthesis-eligible; it does not let the Coordinator Agent silently approve on the User's behalf.

The **Approved Claims** view is read-only and shows exactly what the Coordinator Agent may consume. A **Synthesize from Approved Claims** action opens the existing Agent work surface with an explicit approved-claims context. It does not attach the raw review feed, progress feed, task messages or prior draft text. Historical Bundles remain accessible under a collapsed history section and carry a clear `Not synthesis-eligible` label.

### Team Library readiness card

Project review should include a compact Team Library status block:

```text
Team Library · [Ready | Provisioning | Degraded | Evidence blocked]
Provider membership     Project ACL
Owner Desktop           Last observation
Evidence version proof  [Verified | Blocked by Provider contract]
```

When the OpenContent evidence gate is blocked, the card explains that ordinary file work may continue but that file versions cannot be used for scientific Attestation or synthesis. It offers the existing Owner Desktop provisioning/reconcile action; it does not offer a fake “mark immutable” override.

## Multi-device and offline feedback

Every Device renders the same User Offer identity and Contract revision. After one Device wins, the other cards change to `Claimed on <Device label>` through the existing durable Inbox event. The losing Device never shows a second execution or a retry button for the closed Offer.

If a Device is offline when the Offer is created, no error banner is shown. On reconnect, the Inbox card appears with the original Offer timestamp and Contract revision. If the Device is online but its Runtime or Provider readiness is unavailable, manual acceptance remains available. Cloud-confirmed claims show “等待 Runtime” until local execution checks pass; identity, membership and content permissions still apply.

## Component-level change map

- `packages/domains/collaboration/src/renderer/CollaborationPanel.tsx`: adapt `TaskRow`, `ProjectsSection`, `ParticipantSection` and `AgentRow`; remove the acceptance-mode selector; add the Worker result review card and explicit Offer state labels.
- `packages/domains/collaboration/src/renderer/collaboration-messages.ts`: add Offer, Bundle, Claim, EvidenceRef, Attestation, device-claim and evidence-blocked strings; remove automatic acceptance copy from the scientific path.
- `packages/domains/project-coordinator/src/renderer/ProjectCoordinatorPanel.tsx`: replace the current summary/output review form with Bundle/Claim/EvidenceRef sections, Human Attestation status, Approve/Request Revision controls and Approved Claims view.
- `packages/domains/project-coordinator/src/contract.ts` and the shared collaboration contracts: expose bounded UI projections rather than passing raw database rows to the renderer.
- Existing `StatusPill`, `SectionTitle`, `ExplicitError`, compact cards and current focus/keyboard patterns remain the visual primitives.

New UI state should be driven by Cloud projections and local durable drafts. Renderer code should not infer approval from a button click, online status, filename, current Provider path or an Agent prompt.

## UI verification

Renderer tests should cover: one-click Accept on the current Device; global Reject versus local Ignore; a competing Device claim; offline Offer recovery; no automatic acceptance control; draft editing with Attestation disabled by a blocked EvidenceRef; Attestation-to-Coordinator review transition; result revision history; and an Approved Claims synthesis context that excludes draft summaries, progress, messages and raw review data.
