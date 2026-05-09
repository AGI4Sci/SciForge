# Tool Skills

`packages/skills/tool_skills` contains single-purpose skills exposed through `SKILL.md`.

Use this directory when the agent-facing entry point is a narrow capability such as a lookup, conversion, extraction, calculation, or bounded local operation.

Rules:

- The `SKILL.md` describes when to use the capability, required inputs, expected outputs, failure modes, and evidence requirements.
- If the skill needs to mutate files, drive a browser, control a desktop, call a costly external service, or trigger any other side effect, the actual execution provider belongs in `packages/actions`.
- If the skill only observes external state or modality data, the provider belongs in `packages/observe`.
- Do not hide approval, trace, sandbox, or rollback logic inside a skill directory.

Top-level `packages/tools` is deprecated as a new landing zone and should migrate here when it is SKILL.md-facing.
