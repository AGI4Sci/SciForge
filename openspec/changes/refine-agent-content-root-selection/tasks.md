## 1. Regression and Public Contract

- [x] 1.1 Add failing runtime, discovery, and Content Space package regressions for missing safe Agent root candidates and Provider-label substitution guidance.
- [x] 1.2 Add strict Agent root-candidate input/output schemas and the public capability ID, with `libraryLabel` as display data and no Provider resource identity fields.
- [x] 1.3 Extend package regression coverage for the Provider Instance discovery flow, scope filtering, pagination, raw-identity rejection, fresh exact authorization, and create → re-list → child-resource → upload continuity.

## 2. Canonical Capability Path

- [x] 2.1 Implement the Agent-only global candidate read through the existing Content Space service and pinned Provider path, projecting labels without references.
- [x] 2.2 Refine package-owned capability descriptions/tags so external Team-library intents discover Provider Instance listing, candidate listing, exact authorization, and the resource-safe create/upload continuation.
- [x] 2.3 Refine generic canonical runtime guidance so missing Human-visible selectors use safe native candidate reads when available, Provider labels are never substituted, and unavailable/ambiguous values are asked of the Human.
- [x] 2.4 Restrict raw-reference immutable-observation and portal operations to the Human UI audience and audit the Agent global-operation allowlist.

## 3. Governance and Verification

- [x] 3.1 Regenerate capability governance documentation and validate the OpenSpec change strictly.
- [x] 3.2 Run focused Host/runtime discovery and Content Space package tests, OpenContent Connector/adapter package tests and typechecks, root typecheck, capability governance, changed-file lint, and diff checks.
- [x] 3.3 Run the non-packaging source regression and prove the development application starts from current source; keep installed-package verification out of scope.
- [x] 3.4 Audit final diffs for Host/domain hard-coding, raw-identity inputs, parallel Provider paths, protected user files, and unrequested Change 2/Shared Documents/install work.
