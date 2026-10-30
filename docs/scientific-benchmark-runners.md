# Scientific benchmark development runners

These scripts adapt prepared ScienceAgentBench verified tasks and ResearchClawBench
workspaces to SciForge's existing development bridge and Live Workflow Executor.
They do not start another Agent runtime, silently switch providers, or grant Full
Access. The selected runtime's permissions and approval policy remain in effect.

## Scope and safety

- These are **local development pilots**, not a formal, independently isolated
  benchmark harness. Every run records `isolation.osEnforced: false`.
- ScienceAgentBench copies only the task's datasets into a fresh Agent workspace.
  No evaluator, gold result, reference program, or benchmark-cache symlink is
  placed there. Scoring happens afterward in a separate temporary directory;
  reference material is removed after scoring.
- This staging is **not an OS security boundary**: the Agent and scorer can run as
  the same user, and Agent tools may have access outside the workspace. Prompt
  restrictions alone do not prevent reference leakage. Use a dedicated account
  or externally enforced sandbox/container with no reference-material mount for
  formal evaluation, and independently verify that enforcement before publishing
  comparable scores. These runners cannot attest to that enforcement.
- Dataset/artifact symlinks and path traversal are rejected. Benchmark sources,
  output roots, and Agent workspaces must not overlap.
- Run only trusted upstream evaluator code. Evaluators may interpret untrusted
  output formats; separate staging is not a sandbox for that code either.
- Running the live adapters consumes the selected model's normal usage. Visual
  graders may also consume API usage. Unit tests do neither.
- `eval-results/` is Git-ignored. Do not commit datasets, results, full traces,
  logs, API credentials, or local environment files. Traces may contain sensitive
  task/model output; inspect/redact them before sharing.
- Do not run multiple processes against the same output directory concurrently.

## Prerequisites

1. Build supporting packages with `npm run build:agent-support` and start SciForge
   using `npm run dev` with the development bridge enabled.
2. Prepare local benchmark inputs using the upstream project's instructions.
   Pin and record their dataset/artifact version and the Python environment.
3. Use Node with `--import tsx` for the live runners, which import the canonical
   TypeScript runtime adapter. Offline rescore/summary commands need only Node
   and, for scoring, Python.

The bridge uses its normal instance discovery under the project's temporary
instance registry. No hard-coded instance ID is needed. Shared optional settings:

| Variable | Meaning |
| --- | --- |
| `SCIFORGE_RUNTIME_ID` | `codex` (default) or `claude`; no cross-runtime fallback |
| `SCIFORGE_DEV_BRIDGE_URL` | Development bridge URL; default `http://127.0.0.1:5174` |
| `SCIFORGE_DEV_INSTANCE_ID` | Explicit instance ID when automatic discovery is unsuitable |

## ScienceAgentBench verified

Required:

| Variable | Meaning |
| --- | --- |
| `SAB_ROWS` | JSON file containing `rows: [{ row: { instance_id, task_inst, dataset_folder_tree, output_fname, eval_script_name, ... } }]` |
| `SAB_BENCHMARK` | Prepared root containing `datasets/` and `eval_programs/`, including upstream gold results |
| `SAB_MODEL` | Explicit model alias supported by the selected runtime |

Optional:

| Variable | Default / meaning |
| --- | --- |
| `SAB_OUTPUT` | Repository `eval-results/scienceagentbench-verified`; choose a distinct directory per configuration |
| `SAB_INSTANCE_IDS` | Comma-separated task IDs; unknown IDs are errors |
| `SAB_LIMIT` | Positive integer limiting the selected tasks |
| `SAB_TIMEOUT_MS` | Agent deadline, default 300000 ms |
| `SAB_PYTHON` | Python executable or absolute path to a prepared venv's Python; default `python3` |
| `SAB_VISUAL_JUDGE` | Optional explicit path to the upstream visual-judge helper; otherwise use the prepared evaluator tree |
| `SAB_SCORER_TIMEOUT_MS` | Scorer deadline, default 120000 ms |

```bash
export SAB_ROWS="$HOME/benchmarks/scienceagentbench/verified.rows.json"
export SAB_BENCHMARK="$HOME/benchmarks/scienceagentbench/benchmark"
export SAB_MODEL="your-configured-model-alias"
export SAB_OUTPUT="$PWD/eval-results/sab-pilot"
# Optional: export SAB_PYTHON="$HOME/venvs/sab/bin/python"

SAB_INSTANCE_IDS=1 SAB_LIMIT=1 \
  node --import tsx scripts/run-scienceagentbench-verified.mjs

# Offline re-score; does not create an Agent thread or contact the model.
node scripts/rescore-scienceagentbench-verified.mjs 1

# Offline summary; task count/model come from the run manifest.
node scripts/summarize-scienceagentbench-verified.mjs
```

The manifest records selected task IDs, model/runtime, budgets, scorer configuration,
input-row digest, and isolation limits. Reusing its directory with a different
configuration is rejected. The row digest does not attest to the contents of all
benchmark artifacts or installed Python packages: keep the prepared source and
Python environment immutable and record their version separately. Re-score attempts
record their Python version and configuration, and retain separate stdout/stderr logs.
Do not mix differently versioned sources into one report.

Results distinguish:

- `agent.executionStatus`: Agent completion, failure, or timeout.
- `score.executionStatus`: Scorer completion, failure, timeout, or `not-run`.
- `score.metric`: the actual upstream result, or explicitly unavailable/unparsed.

The scorer executes the upstream program's `__main__` path. Its final standard
Python `(0|1, reason)` tuple is decoded with `ast.literal_eval`, not `eval`.
A successfully exiting scorer returning `(0, reason)` is a **failed task**.
Unknown output formats are **unparsed**, never assumed to pass. Raw diagnostic
output is retained in `scorer-logs/`. Reference programs are not retained there.

Only completed Agent turns with an existing artifact are scored. A timed-out turn with a known turn ID
is cancelled through the canonical executor before thread cleanup and is not
scored. A turn whose start could not be confirmed is also not scored. Retry it or independently verify termination before any external scoring.
A completed scorer attempt can be resumed without another Agent run; use the
rescore command to change/retry scoring rather than regenerate an artifact.

Summary coverage compares task IDs, not just file counts; missing, unexpected,
malformed, or configuration-mismatched records are reported. It shows measured
pass/fail counts, unmeasured tasks, and the denominator of the measured pass rate.
A full-run pass rate is available only when every selected task has a valid score
and there are no unexpected/invalid records. A subset's coverage is coverage of
that manifest's selected IDs, not of the entire upstream benchmark.

## ResearchClawBench

Prepare a dedicated task workspace containing `INSTRUCTIONS.md`. Required settings
are `RCB_TASK_ID`, `RCB_WORKSPACE`, and `RCB_MODEL`; an omitted workspace is an error,
not an implicit request to use the repository directory.

```bash
RCB_TASK_ID="task-01" \
RCB_WORKSPACE="$HOME/benchmarks/researchclaw/task-01" \
RCB_MODEL="your-configured-model-alias" \
RCB_OUTPUT="$PWD/eval-results/researchclaw-pilot" \
  node --import tsx scripts/researchclawbench-run.mjs
```

`RCB_OUTPUT` defaults to repository `eval-results/researchclawbench`.
`RCB_TIMEOUT_MS` defaults to 1800000 ms and must be a positive integer.

This adapter uses the same Live Workflow Executor for subscriptions, polling,
trace capture, cancellation, and cleanup. Traces and metadata use per-run IDs and
are stored outside the task workspace. Success requires a completed turn and a
new or updated nonempty `report/report.md`; an unchanged report from an earlier
run does not establish delivery. **Report delivery is not a benchmark score**:
`benchmarkScore` remains null. Run the upstream grading procedure separately.

## Validation

```bash
npm run eval:scientific:test
```

The deterministic tests use the real Live Workflow Executor with a simulated
external runtime, and execute tiny local Python graders via the production scorer.
They cover required settings, selection, manifests, traversal/symlinks, staging,
pass/fail parsing, crashes/timeouts, canonical turn cancellation and cleanup,
offline rescore, coverage reporting, and ResearchClawBench report delivery.
Python 3 is required for these tests; set `SAB_PYTHON` when its executable is not
`python3`. The tests are also included in `npm test`'s pretest chain. `--help` works on all
four entrypoints without connecting to a runtime or starting a benchmark.
