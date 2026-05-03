# @bioagent-skill/packages

## Agent quick contract
- A skill is the agent-selectable work strategy: when to act, what inputs matter, what outputs to produce, and what failure modes to handle.
- Runtime discovery recursively reads every `packages/skills/**/SKILL.md`; nested directory depth is irrelevant.
- Read only the selected skill's `SKILL.md` before planning execution unless the user explicitly asks for broader package research.
- Skill `source` is `package`; provider-specific origins such as SCP are metadata/tags, not separate source classes.
- A skill may call tools, but should not bundle a tool's implementation details beyond the minimal invocation contract it needs.

## Human notes
Skills and tools are deliberately separate. A skill is the strategy an agent chooses for a user goal. A tool is an execution resource a skill can call, such as an MCP server, database connector, CLI runner, model backend, or visual runtime.

This package root is intentionally Markdown-first. Add or replace skills by placing a `SKILL.md` anywhere under `packages/skills`; the catalog generator derives the app-facing index from those files.
