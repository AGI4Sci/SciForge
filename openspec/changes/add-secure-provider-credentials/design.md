## Context

`DomainMainHost` already exposes owner-scoped `packageSecrets`, and generated composition derives each installed package owner before issuing that facade. The Host persists encrypted package records through Electron `safeStorage`, atomically replaces the encrypted file, and fails when OS encryption is unavailable. This is the canonical storage primitive, but its current key/value API lacks provider-specific binding, assurance, bounded-use, rotation/redaction, and packaged-platform acceptance semantics. ADR 0006 requires those guarantees. ADR-0026 further establishes that `local-selection` may scope a separately authenticated external Provider Connection without becoming proof of the external identity.

## Goals / Non-Goals

**Goals:**

- Harden the existing provider-neutral package-storage boundary instead of adding another secret path.
- Bind owner identity and current Human Principal outside package-controlled input.
- Make lifecycle and failure behavior testable in source and packaged builds.
- Keep secret values out of every public or durable application surface.

**Non-Goals:**

- Defining OpenContent login, Token refresh, logout, or revocation semantics.
- Creating a renderer credential form or Agent capability.
- Treating Local Account selection as authenticated external identity; it only owns the separately authenticated node-local connection.
- Adding a general-purpose password vault or shared cross-node credential service.

## Decisions

### Reuse the existing per-entry Host facade

Generated main composition already derives installed package identity and supplies owner-bound `packageSecrets`. This change SHALL preserve that canonical path and add only the exact binding and bounded-use semantics required for provider credentials. Package code never passes a namespace string, and no second storage root, vault, provider-specific IPC, or Host OpenContent branch is introduced.

Alternative rejected: accept `ownerId` on every call. A trusted package could then impersonate another integration accidentally or deliberately.

Alternative rejected: keep `packageSecrets` and introduce a separate secure-provider vault. Two stores would create ambiguous rotation, deletion, redaction, recovery, and packaged behavior.

### Keep non-secret metadata outside secure records

Connection labels, state, instance reference, and local connection ID live in the owning integration's non-secret store. The OS record contains only versioned secret material and binding identifiers needed to detect mismatches. This avoids turning OS storage into a searchable connection database.

Alternative rejected: store the entire Provider Connection object as one opaque secret. It would make migration, diagnostics, and strict public projections harder while obscuring which fields need confidentiality.

### Expose bounded secret use, not general retrieval

The facade provides owner-only operations that deliver the decrypted value inside a short main-process callback/lease and zeroize or release references promptly. Exact mechanics remain platform-specific behind the Host port.

Alternative rejected: return a long-lived string to package services. JavaScript cannot guarantee zeroization, but the Host can still minimize scope and prevent accidental transport through public APIs.

### Separate local deletion from provider revocation

This change guarantees atomic local deletion and reports secure-store outcomes. Provider logout/revocation attempts and their remote confirmation belong to the connector that understands the provider contract.

## Risks / Trade-offs

- **[OS secure-storage guarantees differ]** → Define an approved guarantee per supported OS and fail closed where it cannot be met.
- **[Generated composition currently shares one Host object]** → Introduce generic per-entry Host binding and architecture tests; do not special-case OpenContent.
- **[Secrets may survive in third-party error text]** → Register active/recent values with canonical redaction and use canary tests across logs/traces.
- **[Provider policy and Principal assurance diverge]** → Make the accepted assurances an explicit trusted policy and require the connector to prove the external account independently.

## Migration Plan

1. Audit the existing `packageSecrets` contract, storage files, generated owner binding, encryption and callers.
2. Extend that canonical contract with exact provider-credential record bindings and bounded use.
3. Harden and verify supported OS behavior without insecure fallback or a second store.
4. Integrate the canonical redaction registry.
5. Enable no provider connection until its connector separately satisfies identity and authentication Gates.
