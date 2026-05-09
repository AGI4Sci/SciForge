# Pipeline Skills

`packages/skills/pipeline_skills` contains multi-step `SKILL.md` workflows.

Pipeline skills coordinate observe packages, action providers, verifiers, presentation components, and runtime contracts to complete a larger task.

Rules:

- Keep the workflow description, decision points, required evidence, and recovery strategy in `SKILL.md`.
- Do not embed side-effecting provider implementations here.
- Reference action, observe, verifier, and presentation package contracts instead of duplicating them.
- Persist stable reusable execution logic into the appropriate package layer once it graduates from workspace-local task code.
