# Deep Test Automation

`tests/deep/` is for deep acceptance infrastructure and future browser E2E runners. These tests are separate from `tests/smoke/` because deep runs are allowed to be slower, artifact-heavy, and scenario-specific.

Current status:

- `smoke-deep-report.ts` validates the manifest/report automation only.
- It does not execute T054-T059 browser workflows.
- Real deep browser runners should write `docs/test-artifacts/deep-scenarios/<scenario-id>/manifest.json` after they finish.

Run the current framework check with:

```sh
npm run verify:deep
npm run verify:deep -- --scenario literature-kras-g12d
```
