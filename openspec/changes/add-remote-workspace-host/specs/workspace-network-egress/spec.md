# Workspace Network Egress Requirements

## Requirement: Explicit egress selection

SciForge SHALL require each remote Workspace Host session to select `none`, the user's local
SciForge process, or another authorized Remote SSH target as its network egress.

### Scenario: Offline GPU uses local egress

- **WHEN** the workspace server cannot reach external services and the user selects local egress
- **THEN** model and approved network operations SHALL use a scoped loopback relay carried through
  the managed SSH connection.

### Scenario: Offline GPU uses CPU target

- **WHEN** the user selects an authorized network-capable CPU target and the GPU and CPU topology is
  reachable through the configured SSH environment
- **THEN** SciForge SHALL route the workspace's approved outbound operations through a scoped relay
  on that CPU target
- **AND** the GPU server SHALL receive no CPU SSH alias or credential.

### Scenario: No egress

- **WHEN** the session selects `none`
- **THEN** network-dependent capabilities SHALL report unavailable while local workspace
  operations remain usable.

## Requirement: Opaque, loopback-only leased routes

Network routes SHALL bind only to private loopback endpoints, use short-lived workspace-scoped
leases, and remain opaque outside the owning transport.

### Scenario: Route established

- **WHEN** a route becomes ready
- **THEN** the server SHALL receive only a loopback proxy/model endpoint and scoped lease material
- **AND** logs, observations, and UI SHALL redact endpoint secrets and tunnel arguments.

### Scenario: Cross-workspace use

- **WHEN** another workspace or expired session attempts to reuse a lease
- **THEN** the relay SHALL reject the request before opening an outbound connection.

## Requirement: Fail-closed route lifecycle

SciForge SHALL not silently replace a selected egress when it fails.

### Scenario: VPN or CPU route drops

- **WHEN** the selected route becomes unavailable or its target revision changes
- **THEN** new network operations SHALL wait or fail with a stable egress-unavailable state
- **AND** SHALL NOT fall back to direct GPU internet or another configured target.

### Scenario: Route revoked

- **WHEN** the user revokes or changes egress
- **THEN** the previous relay and forwards SHALL close, its lease SHALL become invalid, and the
  workspace session SHALL publish a sequenced state event.

## Requirement: Minimal secret propagation

SciForge SHALL not copy desktop SSH keys, complete environments, or upstream provider secrets to a
Workspace Host.

### Scenario: Remote Model Router access

- **WHEN** remote Codex uses the desktop Model Router
- **THEN** SciForge SHALL expose a scoped routed endpoint and runtime credential only
- **AND** SHALL keep provider credentials and private Router configuration on the selected egress.
