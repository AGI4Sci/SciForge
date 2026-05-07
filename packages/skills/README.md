# @sciforge-skill/packages

Skill 是 agent 可选择的工作策略：何时行动、哪些输入重要、可以调用哪些 tools/senses/actions、应该产出什么 artifact，以及失败时如何恢复。

## Agent 使用契约

- Runtime discovery 会递归读取 `packages/skills/**/SKILL.md`；目录深度不重要。
- 规划执行前，只读取被选中的 skill 的 `SKILL.md`，除非用户明确要求研究整个 package 目录。
- Skill `source` 统一视为 `package`；SCP 等来源只作为 metadata/tags。
- Skill 可以调用 tool，但不应该复制 tool 的实现细节，只保留必要调用 contract。

## 新增 Skill

在 `packages/skills` 下任意目录放置 `SKILL.md`。Catalog generator 会生成 app-facing index。稳定 workspace task 经用户确认后，也可以沉淀成 skill proposal，再进入 skill package。
