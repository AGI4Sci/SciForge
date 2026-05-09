# SciForge Observe Packages

`packages/observe` is the home for observe-layer packages.

Observe packages turn an instruction plus referenced modality data into bounded, auditable observations. They may read images, screenshots, documents, telemetry, GUI state, web pages, artifacts, or instrument state, but they must not mutate the workspace or external environment.

Rules:

- Output observations, traces, confidence, and failure diagnostics.
- Keep raw modality payloads out of prompt context unless a contract explicitly allows bounded inline data.
- Put shared observe contracts in `packages/runtime-contract/observe.ts`.
- Put runtime provider selection and invocation orchestration in `src/runtime/observe`.
- Put side-effecting execution in `packages/actions`, not here.

`packages/senses` is a migration-era alias/name. New observe capabilities should land here.
