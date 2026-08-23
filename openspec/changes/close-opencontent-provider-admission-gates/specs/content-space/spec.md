## ADDED Requirements

### Requirement: Shared-container membership uses Provider directory user references

Ordinary shared Content Container membership SHALL use one provider-neutral `Provider Directory Principal Reference` as the only add, list, and remove member identity. The reference SHALL contain only the exact Provider Instance, the closed `user` principal kind, and an opaque canonical Provider principal ID. Extended contract v2 SHALL give `searchUsers`, `searchDepartments`, `searchPositions`, and `searchGroups` distinct literal-kind summary/page/result schemas and SHALL reject an item whose kind does not match the requested search family. `searchUsers` SHALL therefore produce a statically and dynamically typed user reference, and `listMembers` SHALL return the same user shape so its result can be passed directly to the canonical remove operation. The reference SHALL NOT contain or imply a Host Principal, Cloud `contentUserId`, local Connection, external-account selector, endpoint, credential, root authority, or Project membership.

Member add/remove SHALL require an exact authorized shared root, current Principal, current Provider binding attestation, and a member reference for the same Provider Instance. Administration v3 member inputs, page items, and mutation receipts SHALL represent member identity only through that `member` field and SHALL expose no member role. Content Space SHALL expose no role-mutation or ownership-transfer operation. It SHALL reject legacy top-level `contentUserId` member payloads, non-user principals, cross-Provider references, retired role or revision fields, malformed Provider output, and output authority drift before treating the operation as successful. A Provider integration MAY translate the opaque principal ID only behind its package boundary and SHALL use its existing token-free Connector facade and current Principal-bound Connection; it SHALL NOT add an extended-operation invite path or Host identity-mapping fallback.

`updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, and `removeMember` SHALL accept no `expectedRevision` or other Administration compare-and-mutate field, and Administration summaries, pages, open results, and mutation receipts SHALL return no Administration, root, Team, or member revision. Their Agent capabilities SHALL declare `concurrency.revision: "none"` and SHALL each require fresh per-invocation Human confirmation. An ordinary content-root resource alone SHALL NOT satisfy that confirmation or reach Provider dispatch. This declaration SHALL mean that the public contract provides no optimistic-concurrency or CAS guarantee; a Provider observation, pre-read, or supplier value SHALL NOT be represented as an atomic precondition.

Every shared-container Administration operation that depends on current container or member state SHALL require the selected Provider to prove a complete, bounded, internally consistent enumeration before remote mutation. Container and member pages SHALL have stable pagination metadata, continuous progress, no repeated identity, and an exact terminal count. If completeness cannot be proven, the operation SHALL fail `provider_contract_violation` before mutation.

Content Space SHALL validate an exact request-and-authority-bound output for all ten Administration operations. `listSpaces` and `listMembers` SHALL return bounded pages with same-Provider unique identities, advancing cursors, and no `nextCursor` on an empty page; `listMembers` SHALL additionally echo the exact requested root. `createSpace` SHALL return the requested label and Broker-injected owner, `observeSpace` and `openRoot` SHALL return the exact requested root, `updateSpace` SHALL return that root and requested label, `pinSpace` and `unpinSpace` SHALL return that root and requested pinned state, and member mutation receipts SHALL return the exact root and member, with removal also returning `removed: true`. Any output-binding mismatch from a read SHALL fail `provider_unavailable`; a mismatch from an external write or destructive operation SHALL fail `outcome_unknown`. Neither classification SHALL authorize an automatic retry.

Content Space SHALL expose no Project provisioning operation, intent/report schema, or Provider port. Provider directory search and ordinary shared-container membership SHALL NOT create or reconcile Project authority.

#### Scenario: Searched Provider user is added, listed, and removed

- **WHEN** typed directory search returns a user reference for the same Provider Instance as an authorized shared root and the admitted caller passes it to `addMember`
- **THEN** the one Administration path SHALL add that Provider user, `listMembers` SHALL return the same canonical reference, and `removeMember` SHALL accept that listed reference without a Host cross-user mapping or exposed credential

#### Scenario: User search returns another principal kind

- **WHEN** Provider output for `searchUsers` contains a department, position, or group reference
- **THEN** extended result validation SHALL reject the output before it can become a Team member input

#### Scenario: Legacy or cross-Provider member identity is supplied

- **WHEN** a member mutation supplies a top-level `contentUserId`, a non-user directory principal, or a Provider Instance different from the authorized root
- **THEN** Content Space SHALL reject it before Provider binding or remote mutation and SHALL NOT reinterpret or map the identity

#### Scenario: Shared-container Administration enumeration cannot be proven complete

- **WHEN** a required container or member page is incomplete, drifts, repeats an identity, or does not advance consistently
- **THEN** Content Space SHALL return `provider_contract_violation` before the Administration mutation and SHALL issue no remote write

#### Scenario: Retired Administration concurrency or role fields are supplied

- **WHEN** a caller supplies `expectedRevision`, an Administration revision, or a member role to an Administration v3 request
- **THEN** Content Space SHALL reject the request before Provider dispatch and SHALL NOT reinterpret the field as a concurrency or membership contract

#### Scenario: Ordinary root is used for an Administration mutation without fresh confirmation

- **WHEN** an Agent invokes `updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, or `removeMember` with an ordinary root resource but no fresh confirmation for that exact invocation
- **THEN** the Broker SHALL deny the invocation before Provider binding or remote mutation

#### Scenario: Administration output drifts from the request

- **WHEN** a Provider returns an Administration root, member, label, pinned state, owner, removal flag, or page shape that is not exactly bound to the request and Broker authority
- **THEN** Content Space SHALL return `provider_unavailable` for a read or `outcome_unknown` for a write/destructive operation and SHALL NOT automatically retry

## MODIFIED Requirements

### Requirement: Writes are explicit, uniquely authorized, and never blindly retried

Every ordinary, native-document, extended, and administration write SHALL require the current authorized Principal, exact Broker authority for every target, a separately admitted operation, bounded typed input, cancellation, and one Broker-admitted logical invocation identity outside the business payload. Every Agent native-document or extended operation whose declared effect is `destructive` SHALL additionally require fresh per-invocation Human confirmation and SHALL carry no autonomous-write grant. An ordinary root, listed child, feature-selection, or Provider-administration resource alone SHALL NOT satisfy that confirmation. The Broker SHALL reject a missing confirmation before Provider binding or dispatch. Create-folder and upload-new SHALL additionally require one explicit container/parent target and bounded Human-approved name/input. The Provider and service SHALL not replace or manufacture the invocation identity, overwrite implicitly, choose another target, widen from one resource to a sibling, or retry after an uncertain result. Collision SHALL return a typed conflict and an indeterminate remote result SHALL return `outcome_unknown`.

#### Scenario: Name already exists

- **WHEN** create-folder or upload-new would collide
- **THEN** the service SHALL return the typed conflict without overwrite, rename, or target change

#### Scenario: Write outcome is uncertain

- **WHEN** cancellation, timeout, session supersession, or transport loss prevents proof of success or failure
- **THEN** the operation SHALL return `outcome_unknown` and SHALL NOT automatically retry

#### Scenario: Listed child is used for a destructive operation without fresh confirmation

- **WHEN** an Agent obtains an ordinary child resource through an authorized listing and invokes a native-document or extended destructive operation without fresh confirmation for that exact invocation
- **THEN** the Broker SHALL deny the invocation before Provider binding or dispatch

### Requirement: Readiness is explicit per operation

Every ordinary, native-document, extended, and administration operation SHALL declare exactly one descriptive readiness state: `poc_only`, `blocked_by_contract`, or `production_ready`. Content Space SHALL evaluate the current invocation's admission separately from that declaration using the trusted Provider contribution, Provider Instance policy, Broker authority, resource capability, platform Gate, audience, current Principal, and any installed verification profile. An admitted `poc_only` invocation SHALL continue to be reported as `poc_only`; admission SHALL NOT rewrite it as `production_ready`. `blocked_by_contract` SHALL never be admitted.

`poc_only` SHALL remain non-executable unless Content Space composition installs a separately reviewed trusted verification profile that exactly matches the Provider Instance, complete Host Principal snapshot and assurance, authority, operation, audience, bounded validity period, and transfer limits. The matched transfer limits SHALL be enforced as the actual maximum bytes accepted or emitted by that invocation, not merely compared with a global constant. Provider-instance authority without a Provider binding attestation MAY admit only the zero-transfer read-only `list-containers` bootstrap; exact Broker-authoritative content-root authority without such attestation MAY admit only zero-transfer reads. Mutation, administration, Provider-scoped operations, and non-zero transfers SHALL additionally require a current Provider binding attestation for the exact Provider Instance, opaque external subject reference, and opaque binding revision. Content Space SHALL obtain and match the current attestation only through the pinned Provider before admission. A Connector-backed Provider SHALL pass that exact expected attestation through its canonical Connector boundary, which SHALL re-attest the actual session immediately before business dispatch; rebind, unbind, or revision change SHALL invalidate admission.

Caller input, renderer state, Agent request, filename, extension/MIME, Task, prompt text, ordinary environment/configuration, package presence, or a successful sibling operation SHALL NOT install, select, widen, or promote a verification profile or readiness state. Host assurance SHALL NOT be treated as an external Provider account class.

#### Scenario: Operation is unavailable

- **WHEN** any effective Gate blocks it or no exact trusted verification profile matches a `poc_only` operation
- **THEN** discovery SHALL preserve the declared readiness while current admission is unavailable, and execution SHALL fail before the requested Provider business operation and any remote mutation with a bounded unavailable result

#### Scenario: Verification profile admits one exact operation

- **WHEN** a reviewed static profile and all trusted invocation facts match one `poc_only` operation
- **THEN** only that invocation MAY traverse the canonical path, its declared readiness SHALL remain `poc_only`, and every unmatched operation or caller SHALL remain blocked

#### Scenario: Connector binding changes after admission begins

- **WHEN** the pinned Provider or its current Connector session reports an external subject or opaque binding revision that no longer matches the attested profile facts
- **THEN** Content Space SHALL stop before Provider business dispatch and SHALL NOT reuse the prior account authority

### Requirement: Verification profiles compose as exact static package contributions

Content Space SHALL discover verification profiles only through generic package-owned `main.extension` composition at `main.content-space-verification-profile`. Each contribution SHALL contain one strict static profile whose manifest contract and runtime value are identical, and its manifest declaration SHALL explicitly set the generic contribution policy `publicRelease: "forbidden"`. A profile that omits that policy or declares `allowed` SHALL fail Content Space composition. Zero profiles SHALL leave PoC admission disabled; invalid metadata, contract/value drift, duplicate profile identity, unsafe authority, or a mutation/administration profile lacking the required Provider binding attestation SHALL fail composition. The Host SHALL contain no domain-ID switch, default profile, or caller/configuration profile loader.

Every official public release path SHALL use standard domain-package discovery to reject any active production contribution whose generic manifest policy forbids public release before build, signing, or upload and SHALL repeat that same check after packaging. Because every valid verification profile requires that policy, no release guard SHALL inspect a Content Space location, package name, domain ID, or profile contract value. Local internal acceptance MAY compose a reviewed disposable profile only outside public release mode.

#### Scenario: Verification contribution drifts

- **WHEN** a manifest profile differs from its runtime contribution, duplicates another profile identity, or lacks the required `publicRelease: "forbidden"` declaration
- **THEN** Content Space activation SHALL fail instead of ignoring, merging, or selecting one value

#### Scenario: Public release contains an acceptance profile

- **WHEN** standard discovery finds an active contribution, including a valid Content Space verification profile, whose generic policy forbids public release
- **THEN** release SHALL fail closed before signing or upload without logging Principal, root, or external-binding profile values

### Requirement: Project provisioning is outside the current Content Space contract

Content Space SHALL NOT expose a Project Content Space provisioning capability, administration operation, intent/report schema, or Provider port. A future Project-owning integration SHALL introduce its authoritative binding and identity contract through a separately reviewed change and SHALL NOT revive an unused compatibility surface or alias ordinary Provider administration. Project archival or deletion SHALL never trigger Provider deletion.

Ordinary Agent administration MAY create a non-Project shared Content Container, but its create request SHALL accept only the shared-container label. The logical invocation identity SHALL come solely from the Broker invocation envelope outside that request. The capability handler SHALL derive the owner from the Broker's current Principal, and the Provider SHALL map only that Principal's currently authenticated external binding. The create request SHALL NOT accept a caller-authored invocation identity, owner, initial member set, coordinator, Project, or external-account field; later ordinary member changes SHALL use only the separate Provider-directory member operations above.

#### Scenario: Ordinary Agent supplies Project membership

- **WHEN** an Agent attempts to provision or reconcile a Project content root from prompt or capability payload fields
- **THEN** no generic capability SHALL accept the request and no Provider administration operation SHALL occur

#### Scenario: Provider returns an extra Project provisioning port

- **WHEN** an administration feature binds an object containing any field beyond the exact ordinary Administration port
- **THEN** Content Space SHALL reject the binding before Provider dispatch and SHALL NOT silently retain or invoke the extra port

#### Scenario: Agent creates an ordinary shared container

- **WHEN** an admitted Agent requests shared-container creation with a label and the Broker envelope supplies the logical invocation identity
- **THEN** Content Space SHALL inject the current Principal as owner, reject caller-authored ownership or Project fields, and SHALL NOT treat the result as Project provisioning
