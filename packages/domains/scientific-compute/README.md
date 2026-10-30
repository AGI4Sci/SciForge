# @sciforge/domain-scientific-compute

Scientific compute job-loop domain package for SciForge.

The package owns the local deterministic Job Manager, Scheduler, Monitor,
Result Collector, and baseline Scientific Trace helpers. Its main entrypoint
contributes governed `scientific-compute.status` and
`scientific-compute.run-baseline` capabilities.

The current provider is intentionally `local-fixture`: it performs no external
submission and does not claim Slurm, PBS, Kubernetes, or cloud scheduler
support. Future real schedulers belong behind the package-owned scheduler
contract and must declare their external effects and approval policy.
