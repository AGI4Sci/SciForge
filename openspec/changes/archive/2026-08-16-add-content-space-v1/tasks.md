## 1. Package and Dependency Contracts

- [x] 1.1 Complete the Principal, Portable Resource References, and Provider Composition prerequisites on the latest generic main-extension/lifecycle architecture.
- [x] 1.2 Add trusted compile-time Content Space and mock Provider packages with standard manifests, separate definition/main/renderer entrypoints as applicable, lazy activation, tests, and no sidecar.
- [x] 1.3 Define bounded errors/results/readiness, Content Container/File references, gated Artifact Reference, ContentSpaceProvider, and exact domain catalog/service contracts.

## 2. Canonical Service and Provider Path

- [x] 2.1 Compose Provider Instance directory, Content Space catalog, service, codecs, resolver, and capabilities through the package runtime lifecycle.
- [x] 2.2 Route UI/Agent/system only through Broker → handler → service → directory → catalog → pinned Provider → operation.
- [x] 2.3 Validate Provider outputs remain bound to the exact instance, target, logical invocation, reference, and immutable proof.
- [x] 2.4 Test missing/duplicate/incompatible/unavailable Provider, unknown authority, cross-instance output, and zero fallback.
- [x] 2.5 Keep `poc_only` non-executable without a separately reviewed trusted Content Space service policy/audience Gate.

## 3. Provider-Neutral Renderer and Host Safety

- [x] 3.1 Add current generic command/workbench renderer contributions for Provider/container selection, bounded listing, create-folder, upload-new, download, references, progress, cancellation, readiness, and bounded errors.
- [x] 3.2 Propagate renderer cancellation through generic capability transport and Broker AbortSignal; cancel stale selection and destroyed-renderer requests.
- [x] 3.3 Download only through a Host-owned destination handle and open portal only through a short-lived current-Principal-bound opaque grant.

## 4. Reference and Write Governance

- [x] 4.1 Require current authorized Principal, explicit target, bounds, cancellation, and one Broker-admitted invocation identity outside every write's business payload.
- [x] 4.2 Return typed conflict or `outcome_unknown`; never overwrite, silently retarget, blindly retry, choose a default, or fall back.
- [x] 4.3 Reauthorize portable materialization/observation/export and issue ArtifactReference only with exact immutable version, retention, retrieval, instance/file binding, and optional-digest matching.

## 5. Verification

- [x] 5.1 Run domain/SDK tests and typecheck, mock/catalog/codec/materialization tests, generator tests/freshness, governance, package boundaries, lint, and diff checks.
- [x] 5.2 Run full regression and source/packaged application smoke using isolated HOME/config paths where required.
- [x] 5.3 Audit no Shared Documents/OpenContent imports, Host-private domain imports, vendor/domain switches, MIME/extension routing, default/fallback, duplicate paths, or dead legacy entrypoints.
