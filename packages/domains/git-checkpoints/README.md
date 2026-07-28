# `@sciforge/domain-git-checkpoints`

Official Git turn-checkpoint domain package for SciForge.

The package owns checkpoint metadata, before/after-turn policy, rescue-checkpoint
policy, capabilities, and renderer UI. Repository authority stays behind the
generic VCS capability contracts exposed by `@sciforge/domain-sdk`; this package
does not spawn Git or import application-private source.

Restore is always a destructive capability requiring explicit confirmation.
Before restoring any target, the package captures a rescue checkpoint through
the generic version-control capability and aborts the restore if that rescue
capture fails. The package cannot force or bypass provider policy.
