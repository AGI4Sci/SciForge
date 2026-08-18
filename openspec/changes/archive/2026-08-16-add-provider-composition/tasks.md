## 1. Public Composition Contracts

- [x] 1.1 Define exact generic main-extension contracts for DocumentProvider factory, ContentSpaceProvider factory, and Provider Instance directory entries.
- [x] 1.2 Bind declaration/runtime location, contract version, manifest version, Provider Kind, and trusted package/module/contribution owner.
- [x] 1.3 Add strict parsing and independent validation for a package contributing either or both domain factories.

## 2. Domain Catalogs and Directory

- [x] 2.1 Provide separate domain-owned catalogs and filter exact factory location before runtime validation.
- [x] 2.2 Reject duplicate Provider Kind, unsupported version, mismatched location/value/owner, missing implementation, and caller-selected owner.
- [x] 2.3 Compose bounded non-secret Provider Instance entries and reject unknown, duplicate, invalid, or conflicting references.
- [x] 2.4 Prove catalog construction, listing, and selection perform no network, authentication, credential access, content read, or remote mutation.

## 3. Instance-Pinned Routing

- [x] 3.1 Resolve directory entry before domain catalog selection and create/use only the exact pinned Provider lazily.
- [x] 3.2 Reject arbitrary defaults, load-order selection, extension/MIME routing, automatic fallback, blind retry, and silent copy/migration.
- [x] 3.3 Activate domain composition through the standard runtime lifecycle after all generic main extensions are projected.

## 4. Verification

- [x] 4.1 Test declaration/runtime mismatch, missing/duplicate/incompatible contribution, distinct same-kind instances, unavailable Provider, and zero-side-effect construction.
- [x] 4.2 Prove adding/removing a package changes only standard manifest/generated composition, not a Host feature map or domain/vendor switch.
- [x] 4.3 Run SDK/domain tests and typecheck, generator freshness, governance/boundary checks, changed-file lint, regression, and source/packaged smoke.
