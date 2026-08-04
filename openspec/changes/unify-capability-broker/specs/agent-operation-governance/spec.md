## ADDED Requirements

### Requirement: Runtime-independent governance
SciForge SHALL use one execution governor for all owned agent runtimes and SHALL normalize attempts and results before making recovery decisions.

#### Scenario: Equivalent failures in different runtimes
- **WHEN** KUN and Codex receive equivalent failed operation receipts
- **THEN** the shared governor produces the same recovery classification and escalation stage

### Requirement: Semantic failure streaks
The governor SHALL escalate consecutive failures that share a stable objective, resource identity, failure class, and error code even when incidental arguments or tokens differ.

#### Scenario: Expiring token variants
- **WHEN** repeated attempts fail with the same stale-resource error while token-shaped arguments change
- **THEN** the governor treats them as one semantic failure streak

#### Scenario: Legitimate multi-step reads
- **WHEN** operations in the same family return new evidence, advance pagination, or change state
- **THEN** the governor clears or advances the streak without blocking the workflow

### Requirement: Structured result normalization
Dynamic MCP and native tool failures SHALL reach governance as structured receipts containing stable failure class and error code.

#### Scenario: Managed tool returns structured error content
- **WHEN** a tool transport succeeds but its payload reports a domain failure
- **THEN** the adapter records a failed normalized receipt rather than a successful generic tool result

#### Scenario: Native visual failure
- **WHEN** the visual runtime cannot access the bound layout, resolve a target, or refresh a still-visible surface
- **THEN** the native tool returns a stable code, failure class, retryability, and recovery action instead of a plain error string

#### Scenario: Visual provider cause crosses runtime boundaries
- **WHEN** strict native visual inspection fails in Model Router or Workspace Intel
- **THEN** the provider stage, stable error code, failure class, retryability, and recovery action reach the shared governor without being replaced by a generic `visual_look_failed`

### Requirement: Evidence-aware retry budget
The shared governor SHALL stop semantic retry storms without blocking recovery
that produces new evidence or state.

#### Scenario: Required native capability is unavailable before dispatch
- **WHEN** a typed execution intent requires native visual receipts and the Host
  has determined that the native visual tool surface is unavailable
- **THEN** turn preflight fails with a stable non-retryable capability error
  before an agent runtime starts

#### Scenario: Non-retryable failure repeats
- **WHEN** an objective receives a non-retryable failure and the runtime submits an argument variant for the same objective and resource
- **THEN** the governor denies it immediately with the original structured recovery guidance

#### Scenario: Retryable failure without evidence
- **WHEN** an objective receives a retryable failure and one retry produces no new evidence or state change
- **THEN** later variants are denied for the remainder of the turn and the denial states that no retry remains while preserving the original recovery action

#### Scenario: Recovery produces evidence
- **WHEN** a recovery action refreshes layout, renews a resource, changes state, or returns new evidence
- **THEN** the governor clears or advances the circuit and permits the canonical operation

#### Scenario: Strict visual inspection cannot degrade to text success
- **WHEN** a native visual proof request has no verified vision evidence
- **THEN** the operation fails with a typed cause and the text reasoner is not allowed to turn the missing evidence into a nominally successful inspection

### Requirement: Capability-aware policy denial
SciForge SHALL deny shell-based OS capture and window automation when an authorized owned visual source can satisfy the objective through Agent Visual Runtime.

#### Scenario: Agent falls back to a shell screenshot
- **WHEN** the runtime proposes a shell screenshot or window-enumeration command for an owned SciForge surface
- **THEN** policy denies execution and returns structured guidance to invoke `sciforge_look` or `sciforge_capture`

#### Scenario: Trusted computer-use flow
- **WHEN** a trusted computer-use operation captures a permitted external application and returns new evidence
- **THEN** family similarity alone does not block it
