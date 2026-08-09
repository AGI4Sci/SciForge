# Institution Site Node Requirements

## Requirement: Site Node is the institution boundary

Each institution SHALL operate a Site Node that owns local resource discovery, local policy
enforcement, execution placement, private Evidence access, and result egress decisions.

### Scenario: Cloud offers a task

- **WHEN** the Site Node receives a WorkOrder
- **THEN** it SHALL evaluate current project membership, purpose, data access, runtime, resource,
  budget, network, and egress policy before accepting
- **AND** it MAY accept, reject, or require an institution approval without exposing private policy
  internals.

### Scenario: Cloud requests a forbidden operation

- **WHEN** a requested action exceeds Site policy or the lease scope
- **THEN** the Site Node SHALL reject it with a stable error
- **AND** SHALL NOT reinterpret it as a lower-risk action or route it through another local service.

## Requirement: Outbound-only federated connectivity

The production Site Node SHALL initiate an authenticated outbound connection to the Cloud
Coordinator and SHALL NOT require Cloud possession of institution VPN, SSH, scheduler, or storage
credentials.

### Scenario: Institution permits outbound HTTPS only

- **WHEN** the Site can reach the Coordinator through an approved outbound route
- **THEN** it SHALL establish a mutually authenticated, reconnectable control stream over that route
- **AND** internal cluster addresses and credentials SHALL remain inside the Site trust boundary.

### Scenario: Researcher opens an interactive workspace

- **WHEN** a researcher connects their Desktop through the institution VPN and Remote SSH
- **THEN** Remote SSH SHALL remain the canonical owner of VPN, host-key, target, and interactive
  Workspace Host access
- **AND** the personal connection SHALL NOT become the production federated task channel.

## Requirement: Truthful persistent and degraded modes

SciForge SHALL distinguish a persistent institution Site Node from a Desktop relay and SHALL expose
their actual availability semantics.

### Scenario: Persistent Site Node is available

- **WHEN** a WorkOrder is accepted by a persistent Site Node
- **THEN** Desktop shutdown or user VPN loss SHALL NOT terminate the Site task.

### Scenario: Desktop acts as temporary Site Node

- **WHEN** an institution has not deployed a persistent node and a Desktop relay is selected
- **THEN** SciForge SHALL label the Site `client-online-required`
- **AND** SHALL pause or fail with a stable availability error after relay loss
- **AND** SHALL NOT claim unattended execution.

## Requirement: Durable Site inbox, outbox, and local receipts

The Site Node SHALL persist accepted commands, emitted events, local scheduler receipts, lease
state, and result-publication state before acknowledging them.

### Scenario: Process restarts after scheduler submission

- **WHEN** the Site Node restarts after submitting a local job but before reporting the receipt
- **THEN** it SHALL recover the durable local scheduler identity and resume observation
- **AND** SHALL NOT submit another job for the same WorkOrder idempotency key.

### Scenario: Cloud is temporarily unavailable

- **WHEN** a task has a valid lease and requires no new external approval
- **THEN** Site policy MAY allow it to continue locally and queue events in the durable outbox
- **AND** any operation requiring new authority SHALL wait or fail closed.

## Requirement: Local secrets and private locators never cross the boundary

Site Node contracts SHALL expose opaque resource identities and bounded public metadata, not raw
credentials, unrestricted endpoints, local paths, or full internal policy documents.

### Scenario: Site advertises a GPU capability

- **WHEN** the Site publishes a ResourceOffer
- **THEN** it MAY expose GPU class, memory, supported environments, quota, availability window, and
  policy summary
- **AND** SHALL NOT expose SSH private keys, login names, private scheduler endpoints, or unrestricted
  network routes.

### Scenario: Result references a local file

- **WHEN** a ResultManifest includes an output retained at the Site
- **THEN** it SHALL use a stable opaque ArtifactRef and digest
- **AND** SHALL NOT publish the institution filesystem path.
