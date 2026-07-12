# SciForge Runtime Inspector

Read-only MCP worker for Git previews, runtime diagnostics, saved-file completion checks, and TypeScript/JavaScript LSP navigation.

This package intentionally does not start or control long-lived runtimes. It can inspect:

- Git status, branches, bounded diff previews, and read-only checkpoint metadata/previews.
- Runtime ports, health, dependency report, Model Router status, and local runtime status.
- TypeScript/JavaScript LSP status and saved-file navigation queries backed by per-workspace language server sessions.
- Configurable completion gates for documents, experiment reports, release artifacts, and other long-running scientific tasks.

## Completion Checks

`gui_completion_check` evaluates saved files without running shell commands or modifying the workspace. It returns structured `findings`, a blocking `passed` status, a stricter `clean` status, counts, and the enforced read-only boundaries.

Supported checks:

- Required or forbidden literal text and bounded regular expressions.
- Equality of regex capture values within or across files, with exact, trimmed, case-insensitive, or numeric normalization.
- Required regular-file existence.
- LaTeX log thresholds for TeX error lines, undefined references/citations, and overfull boxes.

Example agent call arguments:

```json
{
  "workspace_root": "/path/to/project",
  "files": [
    {
      "path": "paper/report.tex",
      "required": [
        { "pattern": "Evidence DAG", "label": "scientific provenance is discussed" },
        { "pattern": "\\\\title\\{[^}]+\\}", "mode": "regex", "label": "title exists" }
      ],
      "forbidden": [
        { "pattern": "PLACEHOLDER", "blocking": true }
      ]
    }
  ],
  "capture_equalities": [
    {
      "label": "commit count is consistent",
      "sources": [
        { "path": "paper/report.tex", "pattern": "(\\d+) commits", "group": 1 }
      ],
      "normalize": "number"
    }
  ],
  "file_exists": [
    { "path": "paper/report.pdf", "label": "compiled paper" }
  ],
  "latex_logs": [
    {
      "path": "paper/report.log",
      "errors": { "max": 0 },
      "undefined_references": { "max": 0 },
      "overfull_boxes": { "max": 4, "blocking": false }
    }
  ]
}
```

`passed` is false only when at least one blocking finding exists; `clean` is false for either blocking or non-blocking findings. LaTeX errors and undefined references are blocking by default. Overfull boxes are non-blocking by default.

Paths are confined to the resolved workspace, including symlink targets. Each file is limited to 512 KiB by default (configurable up to 1 MiB), and a request can read at most 4 MiB total. Check arrays, patterns, captures, and regex matches are bounded. Regexes with backreferences, high-risk nested quantifiers, or ambiguous repeated alternatives are rejected. Every accepted regex is compiled and executed in an isolated worker with a 500 ms hard timeout, so an unrecognized backtracking pattern cannot block the inspector's main event loop.

## Local Use

```sh
npm --prefix packages/workers/runtime-inspector run test
npm --prefix packages/workers/runtime-inspector run typecheck
npm --prefix packages/workers/runtime-inspector run start -- --workspace-root /path/to/workspace
```

Useful environment variables:

- `SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT`
- `SCIFORGE_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR`
- `SCIFORGE_RUNTIME_INSPECTOR_MODEL_ROUTER_BASE_URL`
- `SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_BASE_URL`
- `SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN`
- `SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS`
