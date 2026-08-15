# Development Workflow

[Simplified Chinese](./DEVELOPMENT.zh-CN.md)

This document defines how developers should work in this repository, especially around the default branch, pull requests, and contribution quality standards.

## Development Baseline

- `gui` is the only long-lived branch and the shared source of truth for desktop, cloud, and phone collaboration
- Start routine feature and fix work from the latest `gui` on a short-lived branch
- Separate deployment targets by directory and package, not by permanent desktop/cloud/mobile source branches
- Build, test, tag, and release each target independently from the same exact commit

## Recommended Workflow

1. Update your local repository.
2. Switch to `gui`.
3. Pull the latest changes from `gui`.
4. Create a short-lived feature branch from `gui` for your work.
5. Implement and validate your changes locally.
6. Open a PR back into `gui`.
7. Merge after review and passing checks.

## Example Commands

### Sync `gui`

```bash
git checkout gui
git pull --ff-only origin gui
```

### Create a feature branch from `gui`

```bash
git checkout gui
git pull --ff-only origin gui
git checkout -b feat/short-description
```

### Push your branch

```bash
git push origin feat/short-description
```

## Pull Request Flow

Default target branch:

- `gui`

Typical PR path:

1. Develop on a short-lived feature branch created from `gui`
2. Push the branch to the remote
3. Open a PR into `gui`
4. Address review feedback
5. Merge after approval and passing checks

## Required Validation Before PR

At minimum, run:

```bash
npm run typecheck
npm run build
npm run test
```

If your change affects runtime behavior or UI, also run:

```bash
npm run dev
```

Manually verify the affected workflow before opening the PR.

## PR Quality Standard

Code is easy. Good taste is rare. Review should protect the product experience, not only the implementation.

A PR should be:

- focused on one main purpose
- easy to review
- supported by validation results
- documented when behavior changes

Your PR description should include:

- what changed
- why it changed
- how you verified it
- a video or GIF if UI behavior changed
- unit tests added or updated if project logic changed

## Change Scope Standard

Prefer:

- one topic per PR
- minimal unrelated formatting churn
- no opportunistic refactors unless they are necessary for the change

Avoid:

- mixing docs, refactors, and feature work without explanation
- large undocumented behavior changes
- bypassing normal review for risky changes

## Localization Standard

If you change user-facing text:

- update English and Chinese strings together when possible
- keep wording consistent across docs and UI

## Documentation Standard

Update documentation when changes affect:

- setup
- commands
- runtime requirements
- branch strategy
- release behavior
- contributor workflow

## Multi-target source and release boundaries

Every target integrates at one `gui` commit: `src/` and `packages/domains/collaboration/` are desktop code;
`packages/collaboration-server/` and `packages/collaboration-provider-zulip/` are cloud deployment code;
`packages/collaboration-contracts/` is shared protocol. Phones currently use the official Zulip app. A future native
app should live in its own directory while continuing to integrate through `gui`, not a permanent mobile branch.

Keep artifacts isolated: Electron releases never contain cloud secrets; ECS installs only version-matched contracts,
provider, and server tarballs; mobile clients use public APIs. Record the target version, Git commit, and contract
version for every release. Shared-contract changes require `npm run collaboration:test` plus desktop and packed-server
validation.

## Merge Guidance

Merge contribution changes into `gui` only after:

- review feedback is addressed
- checks pass
- the change is considered stable enough for the only integration branch

Do not represent release state with permanent desktop/cloud/mobile branches. Use target-specific tags, GitHub Releases, and immutable artifacts.

## Suggested Branch Naming

Examples:

- `feat/runtime-settings`
- `fix/connection-probe`
- `docs/bilingual-readme`
- `refactor/chat-store`

## Maintainer Notes

If maintainers later adjust protected branches, required reviewers, or stricter automated gates, this document should be updated to match the repository rules.
