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

### Requirement: Capability-aware policy denial
SciForge SHALL deny shell-based OS capture and window automation when an owned broker surface-inspection capability can satisfy the objective.

#### Scenario: Agent falls back to a shell screenshot
- **WHEN** the runtime proposes a shell screenshot or window-enumeration command for an owned SciForge surface
- **THEN** policy denies execution and returns structured guidance to rediscover and invoke `surface.inspect`

#### Scenario: Trusted computer-use flow
- **WHEN** a trusted computer-use operation captures a permitted external application and returns new evidence
- **THEN** family similarity alone does not block it
