## ADDED Requirements

### Requirement: Local transparent plan forwarding
Plan Gateway SHALL bind only to loopback and SHALL forward the selected adapter's request method, path, query, body bytes, response status, response headers, and streaming body without protocol translation.

#### Scenario: Streaming plan request succeeds
- **WHEN** an authenticated coding runtime sends a streaming request to Plan Gateway
- **THEN** Plan Gateway forwards it to the adapter-owned HTTPS upstream and relays the stream while recording trace events

#### Scenario: Non-loopback binding is requested
- **WHEN** Plan Gateway is configured with a non-loopback host
- **THEN** startup fails before opening a listening socket

### Requirement: Generic plan adapter boundary
Plan-specific upstream, runtime configuration, request validation, and forwarded-header policy SHALL live behind a generic adapter contract rather than branches in the gateway core.

#### Scenario: Adapter is selected
- **WHEN** Plan Gateway starts with a registered adapter identifier
- **THEN** the forwarding core obtains all plan-specific behavior from that adapter

#### Scenario: Unknown adapter is selected
- **WHEN** Plan Gateway starts with an unregistered adapter identifier
- **THEN** startup fails with an unsupported-adapter diagnostic

### Requirement: Codex-managed ChatGPT authentication
The Codex plan adapter SHALL use Codex app-server's ChatGPT authentication lifecycle and SHALL NOT copy, parse, or directly persist ChatGPT tokens.

#### Scenario: User signs in from SciForge
- **WHEN** the user starts ChatGPT browser or device authentication
- **THEN** SciForge relays the official app-server auth URL/status and displays the resulting account plan type

#### Scenario: Codex sends an authenticated request
- **WHEN** Codex uses the Plan Gateway provider configured with OpenAI authentication required
- **THEN** the gateway forwards the runtime-supplied authorization and required account identity upstream without storing those secret headers

### Requirement: Isolated managed Codex state
SciForge SHALL keep its Codex configuration and authentication state in its managed Codex home and SHALL NOT modify or copy the user's default Codex home.

#### Scenario: Existing external Codex login is present
- **WHEN** the user's default Codex home contains an authenticated session
- **THEN** SciForge leaves it untouched and requires or reuses only authentication performed within the SciForge-managed Codex home

### Requirement: Fail-closed forwarding policy
Plan Gateway SHALL accept only adapter-approved routes and a fixed adapter-owned HTTPS upstream, remove hop-by-hop headers, and never expose a public generic model endpoint.

#### Scenario: Disallowed route is requested
- **WHEN** a client requests a path outside the adapter allowlist
- **THEN** Plan Gateway rejects the request without forwarding it

#### Scenario: Upstream cannot be reached
- **WHEN** the fixed plan upstream fails
- **THEN** Plan Gateway returns an actionable plan-path error and does not route to Model Router
