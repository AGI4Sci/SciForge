## ADDED Requirements

### Requirement: Minimal generic API configuration
SciForge SHALL configure a model API member using only Base URL, API key, and model name, and SHALL NOT require a provider identity or wire-protocol choice.

#### Scenario: User configures an API member
- **WHEN** the user enters a valid Base URL, API key, and model name
- **THEN** SciForge stores the generic member and can start Model Router without any additional provider or protocol setting

#### Scenario: Legacy shape is encountered
- **WHEN** SciForge reads a configuration that lacks the new generic member shape
- **THEN** SciForge reports setup is required and does not run a compatibility migration

### Requirement: Automatic protocol negotiation
Model Router SHALL adapt canonical requests to OpenAI Responses, OpenAI Chat Completions, or Anthropic Messages and SHALL cache the working wire protocol without provider-specific rules.

#### Scenario: Upstream supports the preferred protocol
- **WHEN** the first model request succeeds through the driver matching the incoming wire shape
- **THEN** Model Router caches that driver for subsequent requests with the same Base URL and model

#### Scenario: Upstream definitively rejects a protocol
- **WHEN** an upstream returns a definitive endpoint or schema incompatibility before generation
- **THEN** Model Router tries the next generic driver and caches the first successful driver

#### Scenario: Upstream returns an ambiguous or billable failure
- **WHEN** an upstream returns an auth, quota, rate-limit, timeout, or ambiguous server failure
- **THEN** Model Router stops negotiation and reports the failure without sending the prompt through another driver

### Requirement: Capability-preserving adaptation
Protocol adaptation SHALL preserve model input, tools, tool results, reasoning controls, ordered streaming events, usage, and stop reasons that are representable by the target protocol, and SHALL fail explicitly when a required capability cannot be represented. For Model Router adaptation, streaming semantics mean a wire-compatible ordered event stream with correct terminal metadata; progressive per-token latency is not required. Plan Gateway transparent forwarding remains progressively streamed.

#### Scenario: Required tool semantics cannot be represented
- **WHEN** a canonical request requires a tool behavior unsupported by the selected upstream driver
- **THEN** Model Router returns a protocol-capability error instead of dropping or rewriting that behavior silently

### Requirement: Explicit billing access mode
SciForge SHALL require the user to choose API access or coding-plan access and SHALL NOT silently fall back between them.

#### Scenario: Selected API path fails
- **WHEN** Model Router cannot authenticate or reach the configured API
- **THEN** SciForge reports the API-path failure and does not start or use Plan Gateway

#### Scenario: Selected coding-plan path fails
- **WHEN** Plan Gateway or plan authentication is unavailable
- **THEN** SciForge reports the plan-path failure and does not consume a configured API key

### Requirement: Simple setup diagnostics
SciForge SHALL present one setup and diagnostics flow appropriate to the selected access mode.

#### Scenario: API setup is shown
- **WHEN** the user chooses API access
- **THEN** the UI shows exactly Base URL, API key, and model name plus a connection/status action

#### Scenario: Plan setup is shown
- **WHEN** the user chooses coding-plan access
- **THEN** the UI shows the available plan adapters, official authentication action, and gateway status without API fields
