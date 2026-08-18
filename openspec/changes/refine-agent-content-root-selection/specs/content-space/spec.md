## ADDED Requirements

### Requirement: Agent root candidates are bounded redacted discovery data

Content Space SHALL expose an Agent-only global native read operation that accepts one trusted Provider Instance reference, one `personal | shared` scope, and one bounded page request. It SHALL use the canonical Content Space service and pinned Provider path, filter the returned roots to the requested scope, and return only the Provider Instance reference, requested scope, Human-visible `libraryLabel` values, and an opaque next-page cursor. The operation SHALL NOT return or accept a container/file reference, Provider resource ID, folder ID/GUID, Team ID, path, handle, revision, endpoint, connection, account, credential, or token. Candidate data SHALL be non-authorizing and SHALL NOT replace the separate confirmed root-authorization operation or its fresh exact live match.

#### Scenario: Team library label is absent from the natural-language request

- **WHEN** an Agent has an explicit external Content Space request, a Provider Instance returned by native discovery, and `shared` scope but no exact library label
- **THEN** the Agent can page through the redacted root-candidate operation and use only its `libraryLabel` output to request an exact root authorization

#### Scenario: A Provider page contains another scope

- **WHEN** a requested `shared` candidate page contains only personal roots and a next-page cursor
- **THEN** the result contains no candidate items, preserves the opaque next-page cursor, and exposes no root reference

#### Scenario: Candidate state changes before authorization

- **WHEN** a previously listed candidate is missing or has multiple canonical matches during the later confirmed authorization
- **THEN** authorization re-enumerates live state, fails closed, and issues no Agent root resource

### Requirement: Agent descendant operations continue only through Broker resources

An Agent SHALL use only the opaque resource returned by root authorization or by listing an already-authorized directory as authority for descendant operations. A create-folder or upload receipt and any provider-neutral reference included in descriptive output SHALL NOT authorize a subsequent operation. To upload into a newly created folder, the Agent SHALL re-list the authorized parent, select the exact newly created child by Human-visible name, and invoke upload with that child's Broker resource. Agent operation inputs SHALL NOT accept a caller-supplied parent/reference or raw Provider resource identity.

#### Scenario: Create a folder and upload into it

- **WHEN** an Agent creates a uniquely named folder beneath an authorized root and then needs to upload a Workspace file into that folder
- **THEN** it re-lists the authorized root, obtains the exact child Broker resource, and uses that resource for the separately confirmed upload without supplying a folder ID/GUID

#### Scenario: Human raw-reference helpers are not Agent operations

- **WHEN** immutable-version observation or portal resolution requires a Provider file/container reference
- **THEN** the global raw-reference operation is limited to the Human UI audience and Agent discovery does not expose it
