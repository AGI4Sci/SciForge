---
name: research-memory
description: Draft, confirm, and synchronize research status, evidence, blockers, and review-ready GitHub summaries using the Research Memory skill, GitHub conventions, and file templates.
license: MIT
compatibility: No MCP required.
metadata:
  author: SciForge Contributors
  version: "1.1"
---

Coordinate research memory updates through this skill, GitHub conventions, and repository templates.

Use this skill when the user asks to record, update, summarize, or synchronize:
- Experiment outcomes, metrics, artifacts, or validation state
- Blockers, risks, failed runs, open questions, or next actions
- GitHub issue or PR summaries for research work
- Collaborator feedback that should be preserved as research evidence
- Status updates derived from confirmed project memory

Do not use this skill for ordinary code edits, local-only notes, or GitHub actions that do not involve research memory.

**Core Rule**

The agent MUST follow this order for every Research Memory update:

1. Draft the proposed memory update, GitHub summary, status update, or artifact record.
2. Ask the user to confirm the draft.
3. Only after explicit confirmation, apply the file change or post/synchronize it to GitHub.

If the user asks to "just sync it" without seeing a draft, still produce a draft first and request confirmation.

**No MCP**

Research Memory is intentionally a skill plus conventions now. Do not call, configure, install, or recreate a project-memory MCP server or worker. Use normal file edits and GitHub issue/PR/comment workflows after confirmation.

**Templates**

Prefer the repository templates in `docs/templates/research-memory/`:
- `artifact-record.md`
- `github-issue.md`
- `github-pr.md`
- `status-update.md`

Fill only fields supported by the user's confirmed facts. Leave unknown fields as `TBD` or ask a short follow-up question when the field is required for GitHub output.

**Hard Limits**

The agent MUST NOT use GitHub or any connected workflow to:
- Automatically merge a pull request
- Close a major issue without explicit user approval
- Mark any result, experiment, or artifact as `validated`
- Publish a public claim about research results

When a user asks for one of these actions, draft the proposed wording or action and ask for explicit confirmation. Treat `validated` and public claims as high-risk labels requiring clear user authorization and supporting evidence.

**GitHub Requirements**

All GitHub-facing summaries created from Research Memory MUST include:
- Artifact ID
- Evidence level

Use concise labels such as:
- `Artifact ID: EXP-2026-06-25-rerank-a17`
- `Evidence level: preliminary`

If either value is missing, ask for it before posting or preparing a PR.

GitHub PRs carry review. Use PR comments, PR descriptions, or review threads for critique, questions, and reviewer decisions. Do not treat a status page as the review channel.

**Evidence Levels**

Prefer one of these evidence levels unless the project defines a stricter vocabulary:
- `observation`: seen in a run, log, issue, or collaborator report
- `preliminary`: supported by an artifact but not independently checked
- `reproduced`: repeated with matching outcome
- `validated`: explicitly approved by the user as validated

Never infer `validated` from passing tests, a successful run, or a collaborator comment.

**Workflow**

1. Identify the research event and whether GitHub output is requested.
2. Gather required fields:
   - Artifact ID
   - Evidence level
   - Summary
   - Source evidence, such as logs, PR, issue, run ID, file path, or collaborator comment
   - Requested target, such as local artifact record, GitHub issue, GitHub PR, PR comment, or status update
3. Draft the exact update using the matching template.
4. Ask the user to confirm.
5. After confirmation, apply local file edits or post/synchronize to GitHub.
6. Report what changed and where.

**Minimum Examples**

Experiment completed:

```text
Draft memory update:
Artifact ID: EXP-2026-06-25-rerank-a17
Evidence level: preliminary
Summary: Reranker A17 completed on the held-out query set. It improved top-3 recall from 0.71 to 0.76, with latency increasing from 84 ms to 109 ms.
Evidence: run run-4821, metrics artifact metrics/rerank-a17.json
Target: Local artifact record and GitHub PR summary

Please confirm before I update files or prepare GitHub output.
```

Blocker update:

```text
Draft memory update:
Artifact ID: RUN-2026-06-25-cuda-repro
Evidence level: observation
Summary: CUDA reproduction is blocked because the available runner has driver 555.42, while the failing environment used 560.31. Reproduction should wait for a matching runner or a containerized driver matrix.
Evidence: issue #214, CI log cuda-repro-993
Target: Local artifact record only

Please confirm before I update the record.
```

Collaborator issue feedback:

```text
Draft GitHub issue response:
Artifact ID: DOC-2026-06-25-eval-feedback
Evidence level: observation
Summary: Collaborator feedback notes that the current eval excludes multi-hop retrieval failures. Proposed follow-up is to add a multi-hop slice before treating the reranker result as validated.
Evidence: collaborator comment on issue #219
Target: GitHub issue comment and local artifact record

Please confirm before I update files or post the issue response.
```

**Output After Synchronization**

Report what changed and where:

```text
Research Memory update synchronized.
- Artifact ID: <id>
- Evidence level: <level>
- Targets updated: <local file | GitHub issue | GitHub PR | PR comment | status update>
```
