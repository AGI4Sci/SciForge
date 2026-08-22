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
| 0021 | superseded | Keycloak is not the current Collaboration PoC authentication path. |
| 0022 | accepted | Exact provider-identity challenge verification is implemented; it no longer depends on Keycloak. |
| 0023 | accepted | The identity-access package owns current system-browser OIDC with PKCE, Cloud User projection, Device state, and Cloud Principal transitions. |
| 0024 | accepted | Domain-specific Provider composition is implemented for Content Space and reserved separately for future Shared Documents. |
| 0025 | accepted | Current authority for OpenContent staging and Shared Documents deferral. |
| 0026 | accepted | External Provider access always uses the executing node owner's current Principal-owned connection. |
| 0027 | accepted | Provider integration owns Human enrollment UI while credentials and transport stay main-process only. |
| 0028 | accepted | Cloud Collaboration owns exclusive Project-to-shared-directory bindings; Provider ACL and content lifecycle remain external. |
| 0029 | accepted | Agent content access begins at a Human-confirmed Broker root resource and expands only through authorized directory descendants. |

## Current authority order

The current collaboration product narrative is `docs/SciForge_New_Cloudcolab.md`, aligned with the implemented `unify-user-device-collaboration` change. The root-level `SciForge_New_Cloudcolab.md` is the older Keycloak-era baseline retained only for the ADR-0020 audit. Likewise, architecture/design reports are supporting explanations and cannot override ADR-0025's delivery Gates.

When documents disagree, use this order:

1. Repository `AGENTS.md` architecture and change policy.
2. Later accepted ADRs that explicitly supersede earlier scope.
3. Current OpenSpec specifications and implemented package contracts.
4. Accepted ADRs not superseded by the above.
5. Deferred or superseded records as historical context only.
