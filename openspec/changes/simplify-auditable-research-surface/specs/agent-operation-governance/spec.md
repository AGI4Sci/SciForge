## ADDED Requirements

### Requirement: Explicit scientific-plot provenance intent is route-locked

Agent operation governance SHALL persist a generic governed operation containing `operationId`, `lockedIntent`, selected route-contribution ID, required output contract, terminal state, and any user-authorized downgrade. It SHALL recognize explicit requests for Scientific Plotting, plot provenance, or governed plot reproducibility and bind that operation to the installed Scientific Plotting routing contribution. Request hygiene, context compression, retries, and handoffs SHALL preserve the route lock until the operation commits, fails, is cancelled, or the user explicitly changes intent.

#### Scenario: Long context is compressed before rendering

- **WHEN** a route-locked plot-provenance request crosses context compression or a structured handoff
- **THEN** the effective Agent request still requires Scientific Plotting and its exact output contract
- **AND** an arbitrary terminal image or generic model image does not satisfy completion.

#### Scenario: A retry follows a partial failure

- **WHEN** a locked operation retries after a worker or renderer failure
- **THEN** the retry preserves the same required output contract and route-contribution identity
- **AND** cannot mark the operation committed from an output that fails that contract.

#### Scenario: Required route is unavailable

- **WHEN** explicit code-reproducible provenance is required but Scientific Plotting is unavailable
- **THEN** the operation fails or asks for a permitted scope change according to policy
- **AND** does not silently downgrade to an untracked image.

### Requirement: Scientific decisions do not grant execution authority

Agent operation governance SHALL treat scientific Decision/Approval and Runtime execution authorization as separate prerequisites. A Decision Packet or Approval SHALL NOT grant reusable capability authority, and Runtime authorization SHALL NOT mark scientific Evidence sufficient.

#### Scenario: Publication is scientifically approved but export is unauthorized

- **WHEN** an exact Release has the required scientific Approval but Runtime denies the external target or current access
- **THEN** no export occurs and the Release records the blocked execution outcome without changing the scientific Decision.

#### Scenario: Runtime permits an export with unresolved scientific gate

- **WHEN** Runtime policy permits network/file output but the certified Release lacks its required accountable-human Approval
- **THEN** governance blocks the Release before external execution
- **AND** the Runtime permission remains a separate record rather than a scientific override.
