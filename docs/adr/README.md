# Architecture Decision Records

This directory preserves architectural decisions together with their lifecycle. A decision being `accepted` means its boundary is current; it does not by itself claim that every dependent feature is implemented. `deferred` records a reviewed future direction that is not part of the current executable architecture. `superseded` is historical context only and must not drive new implementation.

## Status index

| ADR | Status | Current reading |
| --- | --- | --- |
| 0001–0013, 0016 | accepted | Migrated from the original design workspace; retained as current boundary decisions, with implementation readiness governed by active OpenSpec changes. |
| 0014 | accepted, amended by 0023 | Local Account selection remains non-authenticating; the OIDC Cloud path is separate and never silently promotes a local identity. |
| 0015 | accepted, amended by 0026 and 0023 | Main process still asserts the Principal; current assurances include local selection and the strictly verified OIDC plus ACTIVE Device path. |
| 0017 | superseded by 0025 | Keep one Connector, but Content Space precedes every Document port/provider milestone. |
| 0018–0019 | accepted | Portable references remain non-authorizing; Local Accounts remain attribution rather than local data tenants. |
| 0020 | superseded | Replaced by `unify-user-device-collaboration` and its implemented collaboration contracts. |
| 0021 | superseded by 0031 | Historical Keycloak baseline; the final OIDC-only collaboration boundary is ADR-0031. |
| 0022 | accepted | Exact provider-identity challenge verification binds only a communication endpoint and never creates a User. |
| 0023 | accepted | The identity-access package owns current system-browser OIDC with PKCE, Cloud User projection, Device state, and Cloud Principal transitions. |
| 0024 | accepted | Domain-specific Provider composition is implemented for Content Space and reserved separately for future Shared Documents. |
| 0025 | accepted | Current authority for OpenContent staging and Shared Documents deferral. |
| 0026 | accepted | External Provider access always uses the executing node owner's current Principal-owned connection. |
| 0027 | accepted | OpenContent owns one macOS/Windows sensitive enrollment path; credentials are one-use, and only the encrypted, Principal/Provider-bound Session Token persists through Host secure storage. |
| 0028 | accepted | Cloud Collaboration owns exclusive Project-to-shared-directory bindings; Provider ACL and content lifecycle remain external. |
| 0029 | accepted | Agent content access begins at a Human-confirmed Broker root resource and expands only through authorized directory descendants. |
| 0030 | accepted, amended by 0037 | Provider-native documents run through Content Space; the Provider owns semantic adapters, the Connector owns supplier transport, and the optional private overlay changes inventory without changing readiness or authority. |
| 0031 | accepted | OIDC JIT is the only Connected Mode User path; Identity owns Token/Device authority and exposes only token-free Cloud transport. |
| 0032 | accepted | Cloud owns provisioning intent/binding; the Owner Desktop orchestrates exact ordinary Content Space operations with no shared Provider credential. |
| 0033 | accepted | Device-signed provisioning attestation records observed facts and never becomes Provider ACL or persistent authorization scope. |
| 0034 | accepted | Metadata proves containment only; real Provider DownloadCheck/write operations are the content authorization oracle. |
| 0035 | accepted | Every Coordinator Agent belongs to the Project Owner; Run-0 initial content ownership also stays with that Owner, while any future transfer is a separate new-owner Desktop saga. |
| 0036 | accepted | The first live PoC upgrades the existing A test environment through a backed-up candidate migration and reversible edge cutover instead of waiting for new Run-0 DNS. |
| 0037 | accepted | Content Space authorizes PoC operations from the current Principal, Broker authority and live Provider binding; static verification profiles are removed, and optional Agent skills never gate Provider use. |

## Current authority order

The canonical full-collaboration target is `CONTEXT-MAP.md`, the context glossaries, ADR-0031 through ADR-0037, and `openspec/changes/add-full-multi-user-collaboration-loop/`. `docs/SciForge_New_Cloudcolab.md`, the same-named root document, meeting summaries and donor-branch reports are historical or supporting evidence only; they cannot override the current OpenSpec or delivery gates.

When documents disagree, use this order:

1. Repository `AGENTS.md` architecture and change policy.
2. Later accepted ADRs that explicitly supersede earlier scope.
3. Current OpenSpec specifications and implemented package contracts.
4. Accepted ADRs not superseded by the above.
5. Deferred or superseded records as historical context only.
