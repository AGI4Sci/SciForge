# Project Coordinator

`@sciforge/domain-project-coordinator` is the independently installable
Desktop domain package for Project coordination HCI. Its backend contract and
renderer surface ship at one package version through separate `./main` and
`./renderer` entrypoints. The standard SciForge domain manifest is its only
composition declaration; the application Host does not contain a
Project-Coordinator feature switch.

Its renderer owns the single top-level **Collaboration Center** shell. Overview,
Projects, and Reviews remain package-owned views. Independently installed domain
packages add navigation or settings surfaces only through the generic
`workbench.workspace-section` renderer-extension contract. The shell never
imports another domain renderer or maps domain IDs, and removing a contributor
removes only its declared section.

## Owned boundary

This package owns only the Human-facing coordination surfaces for:

- creating a Cloud-authoritative Project as the current OIDC User, while main
  resolves the already-bound Agent of that User's current Cloud Device as this
  Project's Coordinator;
- generating, editing, submitting, and confirming a Project Plan;
- browsing the Cloud-global online Worker directory, selecting Project members
  and Task recipients by User while keeping nested Agent facts as readiness
  evidence only;
- transferring Coordinator authority only to another exact active Agent owned
  by the same Project Owner, with durable old-authority fencing feedback;
- reviewing immutable Task results, asking/answering Project HumanNeeded, and
  completing a Project with its final summary;
- observing Project Tasks, ProjectRecord memory, and the independent Project
  Membership, Provider observation, Content Readiness, Task Authority and
  recovery facts;
- driving the one confirmed-Plan workflow through invitation acceptance, finite
  Team provisioning, all-member readiness, Project activation and initial Task
  dispatch, plus dynamic Team reconciliation and Owner root-loss recovery.

It does **not** own OIDC login, Device enrollment, Agent registration,
connection settings, Agent presence, Inbox delivery, local Worker execution,
Provider credentials, Provider ACL truth, or Cloud persistence. Identity and
Device prerequisites are shown only as non-secret readiness state. Coordinator
and Worker are contextual Project/Task relationships, never account types.

## Ports and authority

The main entrypoint acquires the token-free authenticated Cloud transport from
`@sciforge/domain-identity-access` through the Host's owner-scoped internal
service registry. The canonical `project.list` and
`project.coordination.read` commands are paginated through that closed service;
Project creation, Plan confirmation, Project activation, and Owner-authorized
Coordinator transfer use the same User-authorized path. The transfer renderer
chooses only a successor Agent identity; main derives fresh Project epoch,
revision, and exact availability CAS facts before Cloud atomically fences the
old Coordinator. It also acquires Identity's purpose-locked Device fact
attestation signer as a narrow main-process port. This package supplies only a
factual payload digest, provisioning revision and observation time; it never
receives a Device key, performs signing itself, or exposes signing to the
renderer.

Project creation never registers or chooses an account-wide Coordinator. The
Collaboration runtime owns the one canonical current Cloud Device-to-Agent
binding; this package freshly reads that exact active Agent and its Cloud
revision immediately before `project.create`. A Cloud Device ID is an Identity
authority fact and is never treated as the Host installation/execution node ID.
The creator Agent is Coordinator only for the created Project and may claim a
Worker offer in another Project.

Coordinator Agent Plan submission, HumanNeeded, result review, decision, and
final completion acquire Collaboration's versioned, main-only command service.
Collaboration binds the active local Agent and owns durable delivery plus the
single Coordinator Agent Inbox subscription. Project creation is announced on
that boundary with the direct `project.started` payload; this package cannot provide an
Agent identity, route, header, or credential. A `coordinator_project`
HumanAnswer is consumed here and becomes a Coordinator-authored decision with a
stable idempotency key. `coordinator.transferred` is durably consumed through
the same single Inbox owner and projected as default-visible transferred-in or
transferred-out feedback before ACK. HumanNeeded creation selects one exact
active Project member User, and only that target User may answer. The OIDC answer uses
Identity's token-free User transport and never becomes a second ProjectRecord
writer. OIDC material never enters this package. Local Plan drafts are
non-secret package settings guarded by revision compare-and-set. Plan generation
uses the Host-provided Agent Runtime only after the runtime lifecycle has
activated. It supplies a strict structured-output schema and returns only
package-owned bounded failure reasons to the renderer; provider diagnostics do
not cross the capability boundary. Missing Runtime, identity, Device, Cloud, or
exact Project facts fail closed.

Project launch is one package-owned workflow: the Owner confirms the immutable
Plan, each invited OIDC User accepts that exact Plan, the Owner prepares and
continues one digest-bound workflow, every required Team Membership becomes
ready, then the Project activates and initial Tasks dispatch. Provider work is
an internal finite batch within that workflow, never an independently exposed
Provider planning or execution capability. The runtime lifecycle requests only
`content-space.provisioning-batch`; one Host-confirmed immutable finite plan
authorizes its exact ordered authorize/create-or-reauthorize/observe/list/
add/remove/list operations. Continuation accepts only fresh Cloud CAS facts and
the Host-canonical workflow and finite-plan digests, never renderer-supplied
Provider operations.
Each Provider operation is surrounded by Cloud prepare/dispatch/observe journal
writes. A dispatched or outcome-unknown container create is reconciled by exact
live root discovery and is never issued a second time. The final complete member
observation is signed through Identity's purpose-locked current-Device service
and submitted to Cloud; the package retains no Provider credential, Connection,
endpoint, resource handle, Token, local path, or reusable authorization.

Every dynamic add first creates an `invited` OIDC User Membership with no Task
authority. Only that User may accept the exact current confirmed Plan;
content-required acceptance enters `pending_membership`, while content-free
acceptance becomes active. Removing an untouched invitation or any content-free
Membership is immediate. Removing an accepted content-required member—whether
still pending Team attestation or already active—first returns
`membership_removal_pending`, atomically fences Task authority and current
executions, and invalidates ResourceRefs before Provider reconciliation. Only a
fresh absence attestation finally records `removed`. If exact Owner root authorization or observation
returns unauthorized, the saga records the external failure, submits the
factual Owner observation, stops before all member writes, and exposes Cloud's
safe recovery action without deleting Provider content.

`./contract` contains the strict renderer-safe coordination read model. It
composes the Cloud-global online Worker directory and the canonical Project
Plan, Project-scoped Worker Availability, Membership,
Task Authority, User-level offers, execution, result/review, content readiness,
provisioning and recovery records; it adds only UI-specific grouping, User selection and focus
wrappers rather than redefining those state machines.
`./ports` contains the narrow package-owned workspace, Plan, workflow, and
action workflow ports used by the capability factory plus the closed
Collaboration Coordinator-Agent command port. The renderer invokes twenty-one
governed capabilities: workspace read, Project create, Plan-draft
read/generate/edit, Plan submit, Owner Plan confirmation, workflow
prepare/continue, three exact-output recovery actions, membership
invite/accept/remove,
Project HumanNeeded create/answer, Owner Coordinator transfer, result review,
artifact-review preparation, and atomic final completion. Pending confirmation, workflow, HumanNeeded,
review, completion, Coordinator fencing, membership fences, and root recovery
cards are default-visible. There is no renderer transport, HTTP client,
Provider adapter, or second Cloud DTO.

Plan generation exposes Worker identity only at User level while preserving
anonymous per-Runtime profiles that keep capability tags paired with the same
Runtime's planning scopes. It never unions facts across a User's devices. For a
`draft` or `paused` Project, an active member's authority row suspended solely
because of `project_paused` is prospective planning evidence: generation,
assignment edits, and pre-submit validation may use that scope without treating
it as execution authority. For an active Project, the same checks require an
actually `eligible` authority. Every other suspension or fence fails closed.
This separates Plan construction from the post-activation offer/claim gate and
prevents the Plan-confirmation lifecycle from depending on its own future
activation.

The Runtime must return the canonical seven Task fields under the supplied JSON
Schema. For file Tasks it may select only a bounded `sourceInputIndex`; main
binds the exact caller-provided portable locator and the current content binding
revision. The model cannot author a locator identity or Provider authority.

Owner confirmation changes only the immutable Plan state. Canonical workflow
continuation activates the Project and dispatches each dependency-free initial
Plan item through the Coordinator Agent command service only after every
invitation and Team-readiness gate has passed. Main
re-reads the selected User's current Project-scoped availability immediately
before every offer and requires at least one eligible Runtime. The Cloud command
contains only `workerUserId`; Cloud broadcasts the pending Offer to all eligible
Runtime Agents owned by that User, and the first Device claim creates the exact
Task Execution. No Agent identity or availability revision is supplied by the
renderer or persisted as a pre-claim assignment.

Renderer content-readiness labels remain separate from local Runtime
capability. A content-free Project is shown as not requiring shared files, while
a content-required member without a readiness fact is shown as pending; neither
state implies that the Device failed to publish Agent capabilities.
