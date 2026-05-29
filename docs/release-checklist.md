# SciForge Manual Release Checklist

## Computer Use Complex Matrix Opt-In Report

- Run the manual GitHub workflow `Computer Use complex matrix release report` with `workflow_dispatch`.
- Keep `regenerate_aggregate=true` for the normal release pass. This only rebuilds `aggregate-manifest.json` from committed split live manifests and then writes the release report.
- Confirm the workflow uploads the `release-report` artifact containing:
  - `docs/test-artifacts/computer-use-chat-live-complex-matrix/release-report.json`
  - `docs/test-artifacts/computer-use-chat-live-complex-matrix/aggregate-manifest.json`
- Local equivalent: `npm run release:computer-use-chat-live-complex-matrix-report --silent`.
- Do not use this checklist step to run the live long matrix. The live gate remains explicit opt-in via `npm run smoke:computer-use-chat-live-complex-matrix:opt-in --silent` and is not part of default release gates.
