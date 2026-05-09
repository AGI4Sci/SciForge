# Domain Skills

`packages/skills/domain_skills` contains domain methods, scientific protocols, and analysis playbooks.

Use this directory for reusable domain reasoning patterns that are agent-facing but not themselves low-level tools or fixed execution providers.

Examples include assay interpretation methods, literature review protocols, ADMET analysis playbooks, or omics analysis guidance.

Rules:

- Keep domain assumptions, required inputs, output expectations, and verification expectations explicit.
- Delegate execution to observe/action/verifier packages where needed.
- Avoid hard-coding scenario-specific prompts or one-off workspace paths.
