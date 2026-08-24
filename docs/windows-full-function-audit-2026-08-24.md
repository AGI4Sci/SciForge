# SciForge Windows full-function audit

Date: 2026-08-24

## Audit baseline

- Upstream: `AGI4Sci/SciForge:gui`
- Baseline commit: `941dafba5f9b94ecd2afedb4a50a804f10f35dd8`
- Isolated audit branch: `codex/windows-full-audit`
- Final packaged runtime source commit: `d6a15ec2f72854e57d6b9d36254dc45f238327c7`
- Windows target: Windows 11 x64
- Packaged runtime: Electron `42.7.0`, Node module ABI `146`
- Validation source manifest: 3,029 files, SHA-256 `5933a363471c3cd6ddd3b95a5cea331b193df0ec6fa97c6990ddd6cd8974face`
- `package-lock.json` SHA-256: `ceefee710593450ada218f697cce28014f4a93dd41bedc1f9ec8afc2617a5a36`
- Unpacked artifact: `D:\SciForge-windows-full-audit-941dafba-v2\dist-review-d6a15ec2\win-unpacked\SciForge.exe`
- Unpacked executable SHA-256: `95cd4ec165c43f88f3bc6ffcbd25ec3202d1dd7f2c08fdc2d4fc251845a72655`
- `app.asar` SHA-256: `9435ad346c6b6ee3658c85003f391ddc7385b178b911a3e7f70d262e79cb09e0`

The Windows artifact was rebuilt from the final merged runtime source after the
custom-profile isolation fix and the package metadata closure. It therefore
contains OpenContent connector `2.0.3`, its exact provider dependency `3.0.2`,
identity-access `1.1.3`, and the settings migration correction. Only this
evidence report changes after the packaged source commit; no production or
runtime source is modified by the hash update.

## Results summary

| Area | Result | Evidence |
| --- | --- | --- |
| Dependency tree | PASS | `npm ls --all --silent` |
| TypeScript | PASS | Support, SDK, 26 domain packages, Web and Node |
| Lint | PASS | 0 errors, 0 warnings after the image viewer dependency fix |
| Automated tests | PASS | Full `npm test` and the focused identity-access package suite passed after the capacity fixture was made deterministic |
| Collaboration suite | PASS | Contracts, identity, provider composition and secret audit |
| Keycloak contracts | PASS | 31/31 |
| Domain composition | PASS | 26 packages fresh; 266 governed actions |
| Windows production build | PASS | Main, preload and renderer bundles |
| Packaged native PTY | PASS | Electron 42.7.0, ABI 146, win32/x64, real PTY spawn |
| Packaged smoke | PASS | Readiness, domain composition, native tools and persistence |
| Manual Windows UI | PASS WITH EXTERNAL GAPS | Core screens and local tools tested; external services listed below |

## Windows function matrix

| Function group | Windows result | Notes |
| --- | --- | --- |
| First-run setup | PASS | Dialog renders; model-access validation remains fail-closed |
| Language and theme | PASS | Simplified Chinese applied immediately and persisted across a real process restart |
| Local account | PASS | Account creation and Principal transition worked in an isolated profile |
| Coding Plan connection | PASS | Existing official adapter reported connected; no token was read |
| Main workbench | PASS | Project tree, empty thread state, composer and status controls rendered without overlap |
| Settings | PASS | General, assistant, shortcuts, speech-to-text and remote-resource navigation rendered |
| Extensions | PASS | 22 extension cards rendered with status and ownership labels |
| Scheduled tasks | PASS | Filters, create entry, keep-awake control and empty state rendered |
| Files | PASS | Workspace file panel opened and handled an empty workspace correctly |
| Terminal | PASS | Real PowerShell prompt opened; Principal change retired the stale terminal and Restart recovered it |
| Content Space | PASS | Failed closed before account selection, then OpenContent loaded after a fresh Principal-scoped reopen |
| Identity | PASS | Local account and optional SciForge Cloud browser-login entry rendered |
| Collaboration | PASS | Setup, participant, Agent and session panels rendered in a controlled unconfigured state |
| Browser and preview entries | PASS / CONTEXT REQUIRED | Browser entry opened; Visual Review correctly requires a selected file |
| Commenting and review | PASS / CONTEXT REQUIRED | Comment entry and Visual Review entry are discoverable; document-specific actions need an artifact |
| Create Loop and Paper Radar | PASS | Entry panels opened; packaged smoke also proved two workflows and two radar profiles |
| Project DAG and Evidence DAG | PASS | Entry panels opened; packaged smoke covered evidence graph data |
| Git and research checkpoints | PASS | Entry points opened; persistence and version tests passed automatically |
| Plot provenance and scientific plotting | PASS | Entry opened; packaged scientific plotting and artifact checks passed |
| Artifact versions and dossier | PASS | Entry panels opened; artifact-version and dossier contracts passed |
| Remote targets | PASS / EXTERNAL GAP | Panel opened and configuration remained controlled; no real SSH host was used |
| Image workspace viewer | PASS | Focused tests 4/4; unnecessary memo dependencies removed |
| Native visual toolchain | PASS | Packaged smoke verified native visual process and image binding |
| Workspace edit persistence | PASS | Packaged smoke wrote and restored an isolated workspace edit |

## Defects fixed in this audit

| Severity | Problem | Fix | Verification |
| --- | --- | --- | --- |
| P1 | OpenContent deployment config could accept a pathname replaced after the secure open/read | Re-check pathname identity against the verified file descriptor after reading; reject symlinks and replacement | Connector tests 256/256, including 19 deployment-config tests |
| P1 | Settings migration could inspect a sibling standard profile when SciForge used an arbitrary custom `--user-data-dir` | Permit sibling migration only for the canonical `SciForge` directory and only from the explicit lowercase legacy `sciforge` directory; custom profiles never import sibling settings | Settings store tests 34/34, including canonical migration and custom-profile isolation |
| P2 | Root aggregate typecheck exhausted the default Node heap | Use bounded explicit heaps for Web and Node TypeScript checks | Full aggregate typecheck PASS |
| P2 | Default test parallelism caused timeout-only failures on the validation host | Bound root Vitest workers to four | Full `npm test` PASS |
| P2 | The identity account-capacity test seeded 1,024 records through repeated durable operations and exceeded the CI file budget under contention | Seed the valid capacity fixture in one real SQLite transaction with a prepared statement; retain the production `IdentityStore.open()` and overflow `createAccount()` path under test | identity-access 11 files / 95 tests PASS; capacity file completes in under one second locally; full `npm test` PASS |
| P2 | BGC discovery test hard-coded a macOS helper path on non-macOS hosts | Use the production platform resolver in the test | Focused test PASS |
| P3 | Image viewer memo dependencies caused needless recomputation and a lint warning | Keep only values actually read by the memo | Focused tests 4/4; full lint 0 warnings |
| Governance | Publishable package content changed without complete version closure | Bump connector to `2.0.3`, its exact provider dependency to `3.0.2`, and identity-access to `1.1.3`, then rebuild the Windows artifact from the final manifest closure | Version audit findings: none; domain tarball smoke 2/2; final packaged hashes recorded above |

## External or manual follow-ups

These are not product failures. They require credentials, hardware, a second
machine or a separately operated service and were deliberately not faked.

| Capability | Status | Required follow-up |
| --- | --- | --- |
| SciForge Cloud OIDC, Device and Agent | NOT RE-RUN | Use dedicated test accounts and the deployed test Cloud; never place credentials in automation logs |
| Multi-party meeting workflow | NOT RUN | Configure distinct roles on separate profiles/devices and run the agreed meeting scenario |
| Real remote SSH target | NOT RUN | Use the team Ubuntu host and verify connect, reconnect, terminal and file boundaries |
| Speech-to-text | CONTRACT PASS | Validate microphone permission, selected device and real transcription on target hardware |
| Browser automation | ENTRY PASS | Run a controlled page task in the chosen browser with its supported connector |
| Image generation | CONTRACT PASS | Validate the configured provider/model and local result import |
| Real OpenContent account | LOCAL FLOW PASS | Validate external enrollment and a real provider document without exposing credentials |
| Visual Review with a real artifact | ENTRY PASS | Open an image/PDF artifact and exercise annotations and persistence |

## Potentially redundant or overly prominent UI

No feature is deleted by this audit. These are product decisions for review.

| Candidate overlap | Assessment | Recommendation |
| --- | --- | --- |
| `New Agent` and empty-state `New thread` | Two labels lead users toward the same first action | Use one user-facing term and keep only one primary CTA per screen |
| Top toolbar icons and the pane switcher | The same tools can appear in two navigation surfaces | Keep both mechanisms but make the toolbar a configurable favorites strip |
| Comment on anything and Visual Review | Both begin an annotation/review workflow | Group them under a Review hub; preserve context-specific commands |
| Artifact Versions, Git Checkpoints and Research Checkpoints | Three history concepts with different scopes | Present them under a History group; do not merge their storage models |
| Project DAG and Evidence DAG | Similar graph interaction, different domain entities | Share a graph shell and visual language; keep separate domain views |
| Browser Preview and browser automation | Names can imply duplicate browser tools | Rename descriptions to distinguish preview/navigation from automated control |
| Remote Targets and Settings > Remote Resources | Operational and configuration views overlap conceptually | Cross-link them and open the relevant settings section from the panel |
| Extensions and Configure plugins | Similar language but distinct ownership | Retain both; clarify extensions are installed packages and toolbar configuration controls visibility |
| Files and Content Space | Both expose resources but have local vs provider-backed authority | Retain both and label the authority boundary clearly |
| Mock Content Space provider | Useful for smoke/testing, not a production user feature | Keep test-only and ensure it cannot be selected in public production composition |

## Residual quality notes

- Some renderer tests print React `act(...)` and missing i18next-instance warnings
  even though assertions pass. Cleaning the harness would make CI output more
  trustworthy.
- One dependency prints a Node legacy-build recommendation during tests. It is
  not a Windows runtime failure, but the import path should be reviewed during
  the next dependency maintenance cycle.
- The prior identity account-capacity CI timeout was a fixture-cost problem,
  not a product failure. The final fixture preserves the same real SQLite and
  production capacity-check boundary while completing within the test budget.
- A partial, unused first D-drive synchronization directory was superseded by
  the verified `-v2` directory. It is not part of Git or the packaged artifact.
