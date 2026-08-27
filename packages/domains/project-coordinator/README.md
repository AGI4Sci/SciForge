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
- previewing and applying the Owner-confirmed Content Space provisioning plan,
  reconciling dynamic membership, and presenting Owner root-loss recovery.

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
single Coordinator Agent Inbox subscription; this package cannot provide an
Agent identity, route, header, or credential. A `coordinator_project`
HumanAnswer is consumed here and becomes a Coordinator-authored decision with a
stable idempotency key. `coordinator.transferred` is durably consumed through
the same single Inbox owner and projected as default-visible transferred-in or
transferred-out feedback before ACK. The OIDC Owner answer itself uses
Identity's token-free User transport and never becomes a second ProjectRecord
writer. OIDC material never enters this package. Local Plan drafts are
non-secret package settings guarded by revision compare-and-set. Plan generation
uses the Host-provided Agent Runtime only after the runtime lifecycle has
activated; missing Runtime, identity, Device, Cloud, or exact Project facts fail
closed.

Project Content provisioning is a package-owned saga over existing ordinary
Content Space capabilities. The runtime lifecycle requests only
`content-space.provisioning-batch`; one Host-confirmed immutable finite plan
then authorizes its exact ordered authorize/create-or-reauthorize/observe/list/
add/remove/list operations. Apply accepts only fresh Cloud CAS facts and the
Host-canonical full-plan digest, never renderer-supplied Provider operations.
Each Provider operation is surrounded by Cloud prepare/dispatch/observe journal
writes. A dispatched or outcome-unknown container create is reconciled by exact
live root discovery and is never issued a second time. The final complete member
observation is signed through Identity's purpose-locked current-Device service
and submitted to Cloud; the package retains no Provider credential, Connection,
endpoint, resource handle, Token, local path, or reusable authorization.

Dynamic content-required adds must first return `pending_membership`; removals
must first return `membership_removal_pending`. The Owner Desktop then applies
the new provisioning intent and only Cloud's successful verification may
activate or finally remove the member. The renderer rejects an immediate-active
or immediate-removed compatibility response. Content-free membership continues
to activate/remove directly. If exact Owner root authorization or observation
returns unauthorized, the saga records the external failure, submits the
factual Owner observation, stops before all member writes, and exposes Cloud's
safe recovery action without deleting Provider content.

`./contract` contains the strict renderer-safe coordination read model. It
composes the Cloud-global online Worker directory and the canonical Project
Plan, Project-scoped Worker Availability, Membership,
Task Authority, User-level offers, execution, result/review, content readiness,
provisioning and recovery records; it adds only UI-specific grouping, User selection and focus
wrappers rather than redefining those state machines.
`./ports` contains the narrow package-owned workspace, Plan, provisioning, and
action workflow ports used by the capability factory plus the closed
Collaboration Coordinator-Agent command port. The renderer invokes nineteen
governed capabilities: workspace read, Project create, Plan-draft
read/generate/edit, Plan submit, Owner confirm-and-activate, provisioning
preview/apply, three exact-output recovery actions, membership add/remove,
Project HumanNeeded create/answer, Owner Coordinator transfer, result review,
and atomic final completion. Pending confirmation, provisioning, HumanNeeded,
review, completion, Coordinator fencing, membership fences, and root recovery
cards are default-visible. There is no renderer transport, HTTP client,
Provider adapter, or second Cloud DTO.

Owner confirmation activates the Project and dispatches each dependency-free
initial Plan item through the canonical Coordinator Agent command service. Main
re-reads the selected User's current Project-scoped availability immediately
before every offer and requires at least one eligible Runtime. The Cloud command
contains only `workerUserId`; Cloud broadcasts the pending Offer to all eligible
Runtime Agents owned by that User, and the first Device claim creates the exact
Task Execution. No Agent identity or availability revision is supplied by the
renderer or persisted as a pre-claim assignment.
