# Capability live evidence index

This index contains all 152 Agent-visible actions. Current live evidence is no-live-evidence=152. Only `outcome-verified` means an accepted action result; invocation success alone is not outcome verification.

| Batch | Actions | Design-ready | Outcome-verified | Invocation-succeeded | Invoked | No live evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| batch-b | 44 | 21 | 0 | 0 | 0 | 44 |
| batch-c | 24 | 8 | 0 | 0 | 0 | 24 |
| batch-d | 14 | 0 | 0 | 0 | 0 | 14 |
| batch-e | 18 | 0 | 0 | 0 | 0 | 18 |
| batch-f | 43 | 0 | 0 | 0 | 0 | 43 |
| unassigned | 9 | 0 | 0 | 0 | 0 | 9 |

| Action | Owner | Batch | Effect | Approval | Live status | Passed cases | Representative runs | Failure types |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `artifact-versions.bundle.export` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `artifact-versions.bundle.export-v2` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `artifact-versions.bundle.import` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `artifact-versions.bundle.verify` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.bundle.verify-v2` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.commit` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `artifact-versions.compare` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.content.read-range-v2` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.describe-v2` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.events.list` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.lifecycle.refresh` | artifact-versions | batch-b | compute | none | no-live-evidence | — | — | — |
| `artifact-versions.list` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.list-v2` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.materialize` | artifact-versions | batch-b | workspace-write | confirmation | no-live-evidence | — | — | — |
| `artifact-versions.observe` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `artifact-versions.read` | artifact-versions | batch-b | read | none | no-live-evidence | — | — | — |
| `artifact-versions.restore-as-new` | artifact-versions | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `biology-room.apply` | biology-room | batch-c | workspace-write | none | no-live-evidence | — | — | — |
| `biology-room.create` | biology-room | batch-c | workspace-write | none | no-live-evidence | — | — | — |
| `biology-room.history` | biology-room | batch-c | read | none | no-live-evidence | — | — | — |
| `biology-room.list` | biology-room | batch-c | read | none | no-live-evidence | — | — | — |
| `biology-room.load` | biology-room | batch-c | read | none | no-live-evidence | — | — | — |
| `biology-room.open` | biology-room | batch-c | read | none | no-live-evidence | — | — | — |
| `biology-room.open-or-create` | biology-room | batch-c | workspace-write | none | no-live-evidence | — | — | — |
| `biology-room.refresh` | biology-room | batch-c | workspace-write | none | no-live-evidence | — | — | — |
| `browser-preview.back` | browser-preview | batch-d | external-write | confirmation | no-live-evidence | — | — | — |
| `browser-preview.click` | browser-preview | batch-d | destructive | none | no-live-evidence | — | — | — |
| `browser-preview.download` | browser-preview | batch-d | external-write | none | no-live-evidence | — | — | — |
| `browser-preview.drag` | browser-preview | batch-d | destructive | none | no-live-evidence | — | — | — |
| `browser-preview.fill` | browser-preview | batch-d | external-write | none | no-live-evidence | — | — | — |
| `browser-preview.forward` | browser-preview | batch-d | external-write | confirmation | no-live-evidence | — | — | — |
| `browser-preview.hover` | browser-preview | batch-d | external-write | none | no-live-evidence | — | — | — |
| `browser-preview.navigate` | browser-preview | batch-d | external-write | confirmation | no-live-evidence | — | — | — |
| `browser-preview.press` | browser-preview | batch-d | destructive | none | no-live-evidence | — | — | — |
| `browser-preview.read` | browser-preview | batch-d | read | none | no-live-evidence | — | — | — |
| `browser-preview.read-url` | browser-preview | batch-d | read | none | no-live-evidence | — | — | — |
| `browser-preview.reload` | browser-preview | batch-d | external-write | confirmation | no-live-evidence | — | — | — |
| `browser-preview.scroll` | browser-preview | batch-d | external-write | none | no-live-evidence | — | — | — |
| `browser-preview.select` | browser-preview | batch-d | external-write | none | no-live-evidence | — | — | — |
| `collaboration.coordinator.transfer` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.human-needed.answer` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.human-needed.create` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.membership.accept` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.membership.add` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.membership.remove` | collaboration | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `collaboration.project.create` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.project.delete` | collaboration | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `collaboration.requirements.complete` | collaboration | batch-f | workspace-write | none | no-live-evidence | — | — | — |
| `collaboration.session-projection.read` | collaboration | batch-f | read | none | no-live-evidence | — | — | — |
| `collaboration.task-offer.extend` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.task-offer.reassign` | collaboration | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.task-offer.withdraw` | collaboration | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `collaboration.task.checkpoint.append` | collaboration | batch-f | workspace-write | confirmation | no-live-evidence | — | — | — |
| `collaboration.task.interaction.read` | collaboration | batch-f | read | none | no-live-evidence | — | — | — |
| `collaboration.workspace.read` | collaboration | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-add-member` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-admin-create-space` | content-space | batch-f | external-write | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-list-members` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-list-spaces` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-observe-space` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-open-root` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-admin-pin-space` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-admin-remove-member` | content-space | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-admin-unpin-space` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-admin-update-space` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-create-folder` | content-space | batch-f | external-write | none | no-live-evidence | — | — | — |
| `content-space.agent-download` | content-space | batch-f | workspace-write | none | no-live-evidence | — | — | — |
| `content-space.agent-extended-destructive` | content-space | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-extended-read` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-extended-write` | content-space | batch-f | external-write | none | no-live-evidence | — | — | — |
| `content-space.agent-list-entries` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-native-document-destructive` | content-space | batch-f | destructive | confirmation | no-live-evidence | — | — | — |
| `content-space.agent-native-document-read` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.agent-native-document-workspace-write` | content-space | batch-f | workspace-write | none | no-live-evidence | — | — | — |
| `content-space.agent-native-document-write` | content-space | batch-f | external-write | none | no-live-evidence | — | — | — |
| `content-space.agent-upload-new` | content-space | batch-f | external-write | none | no-live-evidence | — | — | — |
| `content-space.authorize-agent-root` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.authorize-feature-selection` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.authorize-provider-administration` | content-space | batch-f | external-write | confirmation | no-live-evidence | — | — | — |
| `content-space.describe-capabilities` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.list-agent-root-candidates` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `content-space.list-provider-instances` | content-space | batch-f | read | none | no-live-evidence | — | — | — |
| `create-loop.check-code` | create-loop | batch-e | compute | none | no-live-evidence | — | — | — |
| `create-loop.export-dsl` | create-loop | batch-e | read | none | no-live-evidence | — | — | — |
| `create-loop.export-rerun` | create-loop | batch-e | read | none | no-live-evidence | — | — | — |
| `create-loop.import-dsl` | create-loop | batch-e | compute | none | no-live-evidence | — | — | — |
| `create-loop.read` | create-loop | batch-e | read | none | no-live-evidence | — | — | — |
| `create-loop.resolve-approval` | create-loop | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `create-loop.run` | create-loop | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `create-loop.run-node` | create-loop | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `create-loop.save` | create-loop | batch-e | workspace-write | none | no-live-evidence | — | — | — |
| `create-loop.status` | create-loop | batch-e | read | none | no-live-evidence | — | — | — |
| `create-loop.stop` | create-loop | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `create-loop.test-node` | create-loop | batch-e | compute | none | no-live-evidence | — | — | — |
| `evidence-dag.audit-query` | evidence-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `evidence-dag.export-snapshot-products` | evidence-dag | batch-c | workspace-write | none | no-live-evidence | — | — | — |
| `evidence-dag.priority` | evidence-dag | batch-c | compute | none | no-live-evidence | — | — | — |
| `evidence-dag.resolve-evidence-preview` | evidence-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `evidence-dag.seal-closure` | evidence-dag | batch-c | compute | none | no-live-evidence | — | — | — |
| `evidence-dag.update` | evidence-dag | batch-c | compute | none | no-live-evidence | — | — | — |
| `evidence-dag.view` | evidence-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `extensions.candidate.apply` | extensions | unassigned | workspace-write | confirmation | no-live-evidence | — | — | — |
| `extensions.candidate.cancel` | extensions | unassigned | workspace-write | none | no-live-evidence | — | — | — |
| `extensions.candidate.check` | extensions | unassigned | workspace-write | none | no-live-evidence | — | — | — |
| `extensions.list` | extensions | unassigned | read | none | no-live-evidence | — | — | — |
| `extensions.status` | extensions | unassigned | read | none | no-live-evidence | — | — | — |
| `git-checkpoints.create` | git-checkpoints | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `git-checkpoints.list` | git-checkpoints | batch-b | read | none | no-live-evidence | — | — | — |
| `git-checkpoints.preview` | git-checkpoints | batch-b | read | none | no-live-evidence | — | — | — |
| `git-checkpoints.restore` | git-checkpoints | batch-b | destructive | confirmation | no-live-evidence | — | — | — |
| `project-dag.evidence-preview.resolve` | project-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `project-dag.goal.save` | project-dag | batch-c | compute | none | no-live-evidence | — | — | — |
| `project-dag.read-records` | project-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `project-dag.update` | project-dag | batch-c | compute | none | no-live-evidence | — | — | — |
| `project-dag.view` | project-dag | batch-c | read | none | no-live-evidence | — | — | — |
| `remote-ssh.command.cancel` | remote-ssh | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `remote-ssh.command.execute` | remote-ssh | batch-e | destructive | confirmation | no-live-evidence | — | — | — |
| `remote-ssh.file.download` | remote-ssh | batch-e | workspace-write | confirmation | no-live-evidence | — | — | — |
| `remote-ssh.file.upload` | remote-ssh | batch-e | external-write | confirmation | no-live-evidence | — | — | — |
| `remote-ssh.target.probe` | remote-ssh | batch-e | read | none | no-live-evidence | — | — | — |
| `remote-ssh.targets.list` | remote-ssh | batch-e | read | none | no-live-evidence | — | — | — |
| `research-checkpoints.list` | research-checkpoints | batch-c | read | none | no-live-evidence | — | — | — |
| `research-checkpoints.read` | research-checkpoints | batch-c | read | none | no-live-evidence | — | — | — |
| `research-checkpoints.status` | research-checkpoints | batch-c | read | none | no-live-evidence | — | — | — |
| `research-checkpoints.turn-status` | research-checkpoints | batch-c | read | none | no-live-evidence | — | — | — |
| `siyuan.document.compose` | siyuan | unassigned | external-write | confirmation | no-live-evidence | — | — | — |
| `siyuan.document.read` | siyuan | unassigned | read | none | no-live-evidence | — | — | — |
| `siyuan.document.search` | siyuan | unassigned | read | none | no-live-evidence | — | — | — |
| `surface.current` | surface | batch-b | read | none | no-live-evidence | — | — | — |
| `user-decisions.request` | user-decisions | unassigned | read | none | no-live-evidence | — | — | — |
| `version-control.create-reference` | version-control | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `version-control.create-snapshot` | version-control | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `version-control.diff` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `version-control.list-snapshots` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `version-control.open-workspace` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `version-control.preview-restore` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `version-control.read-file` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `version-control.restore` | version-control | batch-b | destructive | confirmation | no-live-evidence | — | — | — |
| `version-control.status` | version-control | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.annotations.delete` | workspace-preview | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `workspace-preview.annotations.list` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.annotations.resolve` | workspace-preview | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `workspace-preview.annotations.update` | workspace-preview | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `workspace-preview.apply-edit` | workspace-preview | batch-b | workspace-write | none | no-live-evidence | — | — | — |
| `workspace-preview.describe-asset` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.export` | workspace-preview | batch-b | external-write | confirmation | no-live-evidence | — | — | — |
| `workspace-preview.list` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.open` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.prepare-artifact` | workspace-preview | batch-b | compute | none | no-live-evidence | — | — | — |
| `workspace-preview.read-artifact-range` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.read-range` | workspace-preview | batch-b | read | none | no-live-evidence | — | — | — |
| `workspace-preview.release` | workspace-preview | batch-b | compute | none | no-live-evidence | — | — | — |

Accepted outcome-verified actions (0): none.

This is an evidence index, not a readiness report. Planned, blocked, failed and unobserved actions remain in the 152-action denominator.
