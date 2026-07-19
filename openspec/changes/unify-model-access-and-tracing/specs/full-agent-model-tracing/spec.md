## ADDED Requirements

### Requirement: Complete client-visible model trace
SciForge SHALL persist every model request body and every returned response event observable at Model Router or Plan Gateway, including timing, status, usage, retry, and error information.

#### Scenario: Streaming model call completes
- **WHEN** a model call returns a streaming response
- **THEN** the trace contains the complete sanitized request body, ordered response chunks, response completion, usage, and timing records

#### Scenario: Provider withholds hidden reasoning
- **WHEN** a provider returns only a reasoning summary or no reasoning data
- **THEN** the trace records exactly the returned data and does not claim to contain hidden chain-of-thought

### Requirement: Correlated Agent trajectory
SciForge SHALL append normalized Agent runtime lifecycle, assistant, reasoning, tool, approval, usage, and error events to the same trace store and correlate them with model calls.

#### Scenario: Agent turn makes multiple model calls
- **WHEN** one runtime turn causes multiple model requests and tool calls
- **THEN** all records share runtime, thread, and turn identifiers while each model call has its own request identifier and parent relationship where applicable

### Requirement: One capture chain
Model Router, Plan Gateway, runtime adapters, diagnostics, and export SHALL use one trace contract and store; summaries SHALL be derived views rather than separately captured records.

#### Scenario: Diagnostics display a trace summary
- **WHEN** the UI requests recent trace diagnostics
- **THEN** the summary is computed from the durable trace store and no in-memory summary audit is consulted

### Requirement: Mandatory secret exclusion
SciForge SHALL remove authorization, cookies, API keys, credential fields, and recognized inline secrets before trace persistence or export while preserving non-secret model and Agent content.

#### Scenario: Request contains authorization headers
- **WHEN** Model Router or Plan Gateway receives a request with credential headers
- **THEN** those credential values are absent from every persisted event and export

#### Scenario: Prompt contains an inline credential pattern
- **WHEN** a captured body contains a recognized inline secret
- **THEN** the stored and exported representation contains a redaction marker in place of the credential

### Requirement: Local retention and control
Full traces SHALL remain outside workspaces in application user data, use owner-only permissions, expire after 30 days by default, and support user-initiated export and clearing.

#### Scenario: Retention cleanup runs
- **WHEN** trace data is older than the configured retention period
- **THEN** SciForge removes the expired trace data without touching workspace files

#### Scenario: User exports traces
- **WHEN** the user exports a selected trace
- **THEN** SciForge creates a portable bundle from the same store after mandatory secret filtering

#### Scenario: User clears traces
- **WHEN** the user confirms clearing trace history
- **THEN** SciForge removes the stored trace data and updates diagnostics to show no retained records
