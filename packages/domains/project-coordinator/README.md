# Project Coordinator

`@sciforge/domain-project-coordinator` is the independently installable
Desktop domain package for Project coordination HCI. Its backend contract and
renderer surface ship at one package version through separate `./main` and
`./renderer` entrypoints. The standard SciForge domain manifest is its only
composition declaration; the application Host does not contain a
Project-Coordinator feature switch.

## Owned boundary

This package owns only the Human-facing coordination surfaces for:

- inspecting and confirming a Project Plan;
- grouping Worker candidates by User while selecting an exact Agent;
- dispatching and observing Project Tasks;
- accepting a result or requesting a bounded revision;
- advancing and recovering the Project Content provisioning saga.

It does **not** own OIDC login, Device enrollment, Agent registration,
connection settings, Agent presence, Inbox delivery, local Worker execution,
Provider credentials, Provider ACL truth, or Cloud persistence. Identity and
Device prerequisites are shown only as non-secret readiness state. Coordinator
and Worker are contextual Project/Task relationships, never account types.

## Ports and authority

The main entrypoint acquires the token-free authenticated Cloud transport from
`@sciforge/domain-identity-access` through the Host's owner-scoped internal
service registry. It also acquires Identity's purpose-locked Device fact
attestation signer as a narrow main-process port. This package supplies only a
factual payload digest, provisioning revision and observation time; it never
receives a Device key, performs signing itself, or exposes signing to the
renderer. Coordinator Agent writes acquire Collaboration's versioned,
main-only command service. That service accepts only Plan submit and Task offer
create/withdraw/reassign, binds the active local Agent, and owns durable
delivery; this package cannot provide an Agent identity, route, header, or
credential. Owner/User commands continue to use Identity's User transport.
OIDC material never enters this package. Until the versioned
Cloud coordination read model is available, the default port fails closed with
`coordination_protocol_unavailable`; it does not invent Project data or add a
parallel REST path.

`./contract` contains the strict renderer-safe coordination read model. It
composes the canonical Cloud Project Plan, Worker Availability, Membership,
Task Authority, execution, result/review, content readiness, provisioning and
recovery records; it adds only UI-specific grouping, exact selection and focus
wrappers rather than redefining those state machines.
`./ports` contains the narrow package-owned read port used by the capability
factory plus the closed Collaboration Coordinator-Agent command port. Future
Plan, dispatch, review, and provisioning writes must be added as explicit
governed capabilities backed by their canonical User or Agent authority ports;
they must not add a generic transport, HTTP client, or renderer write path.
