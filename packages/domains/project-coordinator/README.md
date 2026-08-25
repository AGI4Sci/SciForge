# Project Coordinator

`@sciforge/domain-project-coordinator` is the independently installable
Desktop domain package for Project coordination HCI. Its backend contract and
renderer surface ship at one package version through separate `./main` and
`./renderer` entrypoints. The standard SciForge domain manifest is its only
composition declaration; the application Host does not contain a
Project-Coordinator feature switch.

## Owned boundary

This package owns only the Human-facing coordination surfaces for:

- creating a Cloud-authoritative Project as the current OIDC User;
- generating, editing, submitting, and confirming a Project Plan;
- grouping Worker candidates by User while selecting an exact Agent;
- observing Project Tasks, result review, and Project Content provisioning facts.

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
Project creation, Plan confirmation, and Project activation use the same
User-authorized path. It also acquires Identity's purpose-locked Device fact
attestation signer as a narrow main-process port. This package supplies only a
factual payload digest, provisioning revision and observation time; it never
receives a Device key, performs signing itself, or exposes signing to the
renderer.

Coordinator Agent Plan submission acquires Collaboration's versioned,
main-only command service. Collaboration binds the active local Agent and owns
durable delivery; this package cannot provide an Agent identity, route, header,
or credential. OIDC material never enters this package. Local Plan drafts are
non-secret package settings guarded by revision compare-and-set. Plan generation
uses the Host-provided Agent Runtime only after the runtime lifecycle has
activated; missing Runtime, identity, Device, Cloud, or exact Project facts fail
closed.

`./contract` contains the strict renderer-safe coordination read model. It
composes the canonical Cloud Project Plan, Worker Availability, Membership,
Task Authority, execution, result/review, content readiness, provisioning and
recovery records; it adds only UI-specific grouping, exact selection and focus
wrappers rather than redefining those state machines.
`./ports` contains the narrow package-owned workspace and Plan workflow ports
used by the capability factory plus the closed Collaboration
Coordinator-Agent command port. The renderer invokes seven governed
capabilities: workspace read, Project create, Plan-draft read/generate/edit,
Plan submit, and Owner confirm-and-activate. There is no renderer transport,
HTTP client, Provider adapter, or second Cloud DTO.
