# Client Development Workflow

[简体中文](./DEVELOPMENT.zh-CN.md) · [Installation](../INSTALL.md)

## Repository and branch baseline

This source candidate contains the desktop client, local workers, domains/plugins,
and shared collaboration contracts. Cloud server code, database migrations,
Zulip server adapters, deployment operations and remote-ssh are not included.
Do not restore private monorepo material to make a client checkout work.

The existing `AGI4Sci/SciForge-client` repository is private. The future public
source destination has not been created; no public clone URL is promised here.
Use an authorized checkout, or replace the URL variable below with the destination
approved by the maintainer once available. Do not make the existing repository
and its old history public as a substitute for a reviewed clean source export.

```bash
# Set SCIFORGE_CLIENT_REPOSITORY_URL to an approved URL you can access first.
: "${SCIFORGE_CLIENT_REPOSITORY_URL:?Set an authorized client repository URL}"
git clone "$SCIFORGE_CLIENT_REPOSITORY_URL" SciForge-client
cd SciForge-client
```

The current client integration branch is `main`. Start a short-lived branch from
it, submit a PR to `main`, and merge only after review and required checks. If a
future destination selects another default branch, follow that repository's rules.

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/short-description
```

Push only to a repository where you have contribution permission:

```bash
git push origin feat/short-description
```

## Local setup and validation

Use Node.js 22.12+ and the platform's native build tools; see
[INSTALL.md](../INSTALL.md). Run commands from the client repository root.
Cloud credentials and access to the closed-source repository are not prerequisites
for local client development. Model execution separately requires a supported,
user-configured runtime/provider. Use a new empty workspace for manual checks.

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

These are real root package scripts, not a claim that this candidate has passed
installation, compilation or runtime acceptance. Installation and lifecycle hooks
may download artifacts or build native modules; `test`, `typecheck` and `build`
also invoke prerequisite builds. Review their full script chains before execution.
For an authorized offline build, `SCIFORGE_WORKSPACE_HOST_ARTIFACT_OFFLINE=1`
disables the Workspace Host artifact builder's downloads only; it is not a general
network sandbox. Missing approved artifacts must be reported, not fetched silently.

After permission to launch the app, manually verify affected UI/runtime workflows:

```bash
npm run dev
```

For a documentation-only/no-install review, check local links and resolve npm
commands against package scripts without executing the lifecycle/build/app commands.
Report unrun checks explicitly rather than marking them passed.

## Collaboration boundary

The [client collaboration domain](../packages/domains/collaboration/) consumes the
[shared contracts](../packages/collaboration-contracts/). Client and closed-source
cloud releases have separate commits and versions, not a shared monorepo commit.
Contract changes require the retained client checks below and separately authorized
cloud validation using pinned client contracts/inputs:

```bash
npm run contracts:test
```

See [collaboration test setup](../COLLABORATION_TEST_SETUP_GUIDE.md) and the
[issue/evidence template](../COLLABORATION_TEST_ISSUE_TEMPLATE.md). Cloud operators
provide their own current private operations guide, isolated test service and
accounts; no cloud deployment guide or server command is supplied by this candidate.
Do not use production databases, bots or credentials for development. Keep optional
cloud configuration empty until an authorized test service is available; this does
not count as real cloud acceptance.

## PR quality

Keep one purpose per PR and avoid unrelated formatting or refactors. Include:

- what changed and why;
- exact validation commands, results and any skipped/blocked checks;
- regression tests for changed logic;
- sanitized UI evidence where useful, with permission for any visible content;
- matching English/Chinese documentation and user-facing strings.

Update setup, commands, boundaries and release documentation with behavior changes.
Suggested branches include `feat/runtime-settings`, `fix/connection-probe`,
`docs/bilingual-readme` and `refactor/chat-store`.

## Release boundary

The retained workflows are [client CI](../.github/workflows/client-ci.yml) and
[collaboration CI](../.github/workflows/collaboration-ci.yml). This candidate does
not contain the former automatic cross-platform publication workflow. CI success
is not publication permission, signing/notarization acceptance or legal clearance.
Do not configure deployment secrets or run upload/promote/release commands as part
of local setup.

Source-only publication, website deployment and installer distribution have
separate manifests and obligations; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
The unused tldraw dependency has been removed, so no tldraw code ships with the
source or the installers; remaining source/media rights evidence is still
pending. Technical artifact/license gaps require technical fixes, not owner
sign-off in their place.
Record the exact client commit, contract version, delivery manifest and validation
results; cloud compatibility is a separate acceptance result.
