# Capability Eval

SciForge's capability evaluation runner has separate unit, workflow, and
evaluator self-test inputs. All use the existing Registry/Broker contract.
Simulation mode does not call providers; workflow mode can execute a real Agent
through the existing Agent Runtime and score the resulting full trace.

## Data sets

`eval-cases/capability/golden.jsonl` is the golden regression set. Its
`expected` and `simulation` describe behavior we consider correct, so its
results are the product capability metrics: pass rate, routing accuracy,
discovery recall, action selection, authorization, invocation success, task
success, retries, and latency. A case can still represent an expected provider
failure, such as `provider_unavailable`; it should pass when the error and retry
behavior match the ground truth.

`eval-cases/capability/evaluator-self-test.jsonl` contains deliberately broken
simulations. Its subject result is expected to fail, and the evaluator test
passes when the evaluator reports at least one failure. A self-test subject
failure does not represent a SciForge regression failure and is never included
in golden performance metrics.

`eval-cases/capability/workflow-golden.jsonl` contains natural-language tasks
for Agent Capability Workflow Eval. These cases intentionally have no
`simulation.calls`: the Agent must decide which capabilities to discover and
invoke. The first batch contains 13 tasks: 2 single-action capability sanity tasks, 7
same-domain multi-step tasks, 3 cross-domain tasks, and 1 no-call boundary
task. The workflow cases use real IDs from the generated Registry reference.

The golden set also includes a small number of explicit expected provider
failure cases. These use `expectedFailure` to say whether the failure should be
reported or recovered by retry. The contract result can therefore be `PASS`
even when the raw provider invocation is unsuccessful.

## Run

HTML reports and terminal summaries default to Chinese. Metric labels, filters,
status labels, and failure categories are localized; action/domain IDs, error
codes, case queries, and raw JSON diagnostics retain their original text for
trace auditing. JSON report keys and metric calculations are unchanged.

Every case has a Query and tool-comparison section, including passing cases.
Required, allowed, and forbidden actions come from the case contract; lists
do not imply a fixed trajectory. Runtime tool details are grouped by call ID
and shown in first-observed order, including discovery and unresolved calls.
Unresolved calls retain their tool name, operationRef, arguments, and error
code; they are not silently counted as a known capability or assumed absent.
These display details do not change the scored invocation metrics.

Run the default golden regression set:

```sh
npm run eval:capability
```

Run the same mode with an explicit case file or baseline:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/golden.jsonl \
  --baseline eval-cases/capability/golden-baseline.json
```

Run evaluator self-tests:

```sh
npm run eval:capability:self-test
```

The equivalent explicit command is:

```sh
npm run eval:capability -- \
  --self-test \
  --cases eval-cases/capability/evaluator-self-test.jsonl \
  --allow-failures
```

Golden reports are written to `eval-results/latest.json` and
`eval-results/latest.html`. Self-test reports use
`eval-results/self-test/latest.json` and `eval-results/self-test/latest.html`.
Both keep timestamped copies in their `history` directory. The HTML heading
identifies a golden run as either `Capability Golden Regression` or `Agent
Capability Workflow Eval`, and identifies self-tests as `Evaluator Self-Test`.

`eval-cases/capability/golden-baseline.json` is a small versioned baseline
manifest containing the deterministic run metadata and metrics. It is intended
for explicit `--baseline` comparisons; it does not replace the full report.

Self-test output uses separate semantics:

```text
Evaluator Self-Test (deterministic-simulation)
Total Cases: 3
Expected Failures Detected: 3
Missed Failures: 0
Detection Rate: 100.0%
```

The current self-test contract records `subjectResult` and
`evaluatorTestResult` in the report and declares exact
`selfTest.expectedFailureTypes` per case. A self-test passes only when all and
only those `wrong_domain`, `forbidden_action`, `argument_mismatch`, or other
declared failure types are detected.

## Metric semantics

Golden regression is the product-capability scorecard. `Contract Pass Rate`
means that routing, discovery, selection, arguments, authorization, invocation
outcome, expected-failure handling, final state, rubric, and task outcome match
the case contract. `Routing Accuracy`, `Discovery Recall`, `Action Selection
Accuracy`, and `Authorization Accuracy` use the same golden cases.

`Raw Invocation Success Rate` and `Raw Task Success Rate` deliberately retain
the observed success booleans, so an expected provider outage remains visible.
`Unexpected Invocation Failure Rate` counts failures that were not declared as
an expected failure. `Expected Failure Handling Accuracy` checks declared
provider failures. `Retry Recovery Rate` uses provider attempts when the trace
exposes complete attempt evidence. A logical invocation with a failed first
attempt followed by a successful later attempt counts as recovered. `Task
Outcome Accuracy` compares an explicitly reported task result with the
expected task result and is distinct from raw task success.

`Invocation Success Rate` is the Capability action-level rate. `Runtime Tool
Success Rate` is the rate across all terminal Runtime Tool records, including
discovery and non-capability tools. `averageToolCalls` counts all Runtime Tool
records, while `averageCapabilityToolCalls` counts only calls resolved to a
Capability action. Runtime Tool allow-list checks are opt-in: when
`expected.tools.allowed` is empty, observed non-protocol tools are retained for
diagnostics and are not automatically marked as unexpected. Use
`expected.tools.allowed` to close the allow-list, or `forbidden`/`unnecessary`
to assert a specific constraint. A no-call boundary uses
`expected.noCapabilityCalls: true`; an empty `allowedActions` list alone does
not mean “no calls”.

Workflow metrics include `Multi-step Completion Rate`, `Final State Accuracy`,
`Forbidden Action Rate`, `Unnecessary Tool Call Rate`, `First-attempt Success
Rate`, `Eventual Invocation Success Rate`, approval count, task latency, and
unnecessary calls per task. `Task Success Rate` is based on the task result and
final-state contract; a completed Agent turn alone is not task success. Metric
coverage is included in the JSON report. Metrics whose evidence denominator is
zero are shown as `N/A` in the terminal or HTML report.

The runner writes `eval-results/coverage.json` and `eval-results/coverage.md`
on golden runs. The coverage matrix is based on the generated Registry
reference and reports covered domains/actions, case-type dimensions,
uncovered actions, actions with only happy-path coverage, confirmation actions
without authorization coverage, and actions without expected-failure coverage.

The current deterministic baseline covers 49 of 211 registered actions (49 of
151 agent-visible actions) across 10 of 21 domains. This is a regression
baseline, not a claim that the entire Registry has been evaluated.

The first live workflow batch is a separate scope: it covers 13 natural-language
tasks, 6 domains, and 27 Registry action references (27 of 151 Agent-visible
actions). Those numbers describe the workflow contract coverage; they are not a
claim that every action was discovered or called by the Agent. The live report
separately records actual trace calls and successful invocations.

`eval-cases/capability/workflow-scenarios.jsonl` is the next controlled
scenario set. It adds six natural-language tasks covering empty results,
retry recovery, persistent provider failure, denied authorization, a rational
alternative path, and a cross-domain Paper Radar → Scientific Plotting data
dependency. These cases intentionally have no `simulation`: they are valid
only when a live Agent run or a previously captured full trace is supplied.
The failure and authorization cases require a controlled provider fault or
approval decision; without that harness control, an absent failure is a test
setup gap, not evidence that the Agent handled the scenario correctly.

Run the controlled scenario set with:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/workflow-scenarios.jsonl \
  --trace-dir /absolute/path/to/workflow-scenario-traces \
  --output eval-results/workflow-scenarios \
  --allow-failures
```

Self-test failures have different semantics: “failed capability behavior” is
intentional in those simulations. It does not mean a SciForge regression
failure; it means the evaluator is being asked to detect an anomaly. Each
self-test case now declares the exact `selfTest.expectedFailureTypes`. The
self-test report keeps `subjectResult` (the simulated behavior) separate from
`evaluatorTestResult` (whether exactly those failure types were detected).

## JSONL case format

Each non-empty line is one case. Action IDs must exist in the generated
`docs/generated/capabilities.md` Registry reference.

```json
{
  "id": "paper-search-happy-path",
  "query": "Search Paper Radar for AlphaFold 3",
  "tags": ["paper-radar", "happy-path"],
  "expected": {
    "domain": "paper-radar",
    "mustDiscover": ["paper-radar.search"],
    "requiredActions": ["paper-radar.search"],
    "allowedActions": ["paper-radar.search", "paper-radar.rank"],
    "forbiddenActions": [],
    "authorization": {"paper-radar.search": "allow"},
    "invocation": {"paper-radar.search": {"success": true}},
    "arguments": {
      "paper-radar.search": {
        "required": ["query"],
        "types": {"query": "string"}
      }
    },
    "taskSuccess": true
  },
  "simulation": {
    "domain": "paper-radar",
    "discoveries": [{"actions": ["paper-radar.search"]}],
    "calls": [{
      "actionId": "paper-radar.search",
      "args": {"query": "AlphaFold 3"},
      "outcome": "success",
      "latencyMs": 20
    }],
    "taskSuccess": true
  }
}
```

`expectedFinalState.assertions` supports deterministic `equals`, `exists`,
and `includes` checks. Rubrics support deterministic assertions. `llm_judge`
items are reported as `unsupported` until an existing project judge is wired
in; they do not become a scored pass and leave the case `INCONCLUSIVE` unless
another decisive failure is present.

When a workflow has a genuine choice of equivalent next steps, use
`expected.alternativeActionGroups`. Each inner array means “at least one of
these actions must be selected”; it does not impose an order or require every
alternative. This keeps rational alternative paths distinct from a fixed
trajectory.

For workflow cases, add `workflowType` with `single-action`, `multi-step`, or
`cross-domain`. Use `expected.requiredDomains` for the set of domains that must
be represented by the observed trajectory. Use `expected.ordering` only for a
business constraint that really requires an order; an ordinary multi-step
workflow should leave it empty. `expected.unnecessaryActions` is deliberately
explicit so optional exploration is not automatically labeled wasteful.

Example shape:

```json
{
  "id": "workflow-cross-domain-paper-statistics",
  "query": "以 2026-09-15 为截止日，在当前 Paper Radar 索引中查找最近三年关于 AlphaFold 3 的论文，统计年度数量，并准备趋势图数据。",
  "workflowType": "cross-domain",
  "expected": {
    "requiredDomains": ["paper-radar", "scientific-plotting"],
    "mustDiscover": ["paper-radar.search", "scientific-plotting.map-data"],
    "requiredActions": ["paper-radar.search", "scientific-plotting.map-data"],
    "allowedActions": ["paper-radar.search", "scientific-plotting.map-data"],
    "forbiddenActions": [],
    "unnecessaryActions": [],
    "ordering": [],
    "taskSuccess": true
  },
  "expectedFinalState": {
    "assertions": [
      {"path": "statisticsProduced", "operator": "equals", "value": true},
      {"path": "trendData", "operator": "exists"}
    ]
  }
}
```

The query is the only task instruction sent to the Agent. The evaluator keeps
the expected action sets and final-state assertions outside the Agent prompt.

## Trace mode

Evaluate one full-trace JSONL export with:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/golden.jsonl \
  --trace /absolute/path/to/trace.jsonl \
  --case-id paper-search-happy-path
```

The trace adapter reads durable `agent_event` tool and approval events. For
`sciforge_invoke`, the Host records a private `meta.capabilityIdentity` on both
the success and failure terminal fact after resolving the opaque
`operationRef` through the caller's operation cache. This exact
`operationRef → capabilityId` mapping is authoritative; it never changes the
Broker request or its invocation semantics. The adapter also accepts the
capability ID from a structured success receipt and correlates it back to the
same opaque reference for older traces. It never treats an opaque reference,
title, or tag as an action ID. If a trace has neither the Host identity nor a
validated receipt mapping, the action remains unresolved instead of being
guessed. Missing approval ordering, final state, or other fields are also not
invented; the corresponding metric can therefore be incomplete until the trace
contains the required evidence.

For a batch of live workflow exports, store one full-trace JSONL export per
case as `<case-id>.jsonl` and run:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/workflow-golden.jsonl \
  --trace-dir /absolute/path/to/workflow-traces \
  --output eval-results/workflow
```

The CLI does not execute a simulation for cases without `simulation`; it
requires these real trace exports. To generate them inside SciForge, the main
process integration should construct `createLiveWorkflowExecutor` with the
existing `AgentRuntimeHost`, then call the existing `runEvalCases` entry point.
That executor creates an isolated evaluation thread, submits only the natural
language query, waits for the real turn to finish, collects its events, and
optionally calls a final-state inspector. The inspector is where a test
provider, filesystem, artifact store, or domain database supplies authoritative
task evidence.

The trace adapter keeps one `callId` as one logical invocation. A new call ID is
a new Agent invocation. Runtime lifecycle transitions and explicit `attempt`
fields are retained as `providerAttempts`. If the provider retries internally
without emitting those events, the evaluator cannot infer them; the report
marks attempt metrics as unavailable or partial instead of counting a guessed
attempt.

Assistant output from the same turn is retained as `assistantMessages` and
`finalAnswer` in the normalized trace. This is evidence for later deterministic
inspection or an external LLM Judge; it is not itself treated as proof that the
task succeeded.

The existing `turn_lifecycle: completed` event is reported as
`executionStatus: completed`. It does not set `taskSuccess`. A live workflow
must provide task success through its final-state inspector or another
authoritative task contract. This prevents an Agent that simply stops after a
failed plot from being counted as a successful task.

The current runner creates a temporary workspace directory and writes the
case's initial-state manifest. Normal `--live` connects to an existing Host
and therefore shares its global Paper Radar index. For stateful live cases,
`--isolate-global-state` starts one disposable development Host per case with
an explicit temporary Electron `userDataDir`; this isolates the local Paper
Radar DB, profiles, and Host process caches before deleting them after the
case. External services, provider databases, remote rate limits, and other
state outside that Host still require a provider-owned harness.

Live trace persistence writes two files per case: `<case-id>.jsonl` contains
the raw full-trace events, and `<case-id>.trace.json` contains the normalized
trace metadata captured after final-state inspection. The latter preserves
`taskSuccess`, `finalState`, inspector `evidence`, execution status, and any
runner error. If a live turn fails after it has started, the executor still
saves the events collected so far and returns the same partial trace semantics
to the live report; replay reads the sidecar automatically. Supplying
`--final-state-dir` during replay explicitly overlays the external oracle.

Case outcomes are explicit: `PASS` means every declared check passed, `FAIL`
means the trace contains decisive behavioral evidence against the contract,
and `INCONCLUSIVE` means required evidence was unavailable (for example, no
task outcome or final state). The aggregate report shows all three counts;
the displayed pass rate uses only decisive PASS/FAIL cases, while task and
final-state metrics also expose their evidence coverage.

## Live Agent run

The CLI can now perform the integration step itself through the existing
localhost development bridge. Start SciForge in one terminal:

```sh
npm run dev
```

Then, in a second terminal, submit the natural-language workflow cases to the
running Agent Host:

```sh
npm run eval:capability -- \
  --live \
  --cases eval-cases/capability/workflow-golden.jsonl \
  --output eval-results/workflow-live \
  --allow-failures
```

`--live` sends only each case's `query` to the Agent. It does not send
`requiredActions`, `allowedActions`, `forbiddenActions`, or the final-state
contract. The Agent therefore performs its own routing, discovery, selection,
authorization, and consecutive tool calls through the real Host/Broker path.
The bridge instance ID is discovered from the dev bootstrap lock. If needed,
it can be supplied explicitly with `--dev-instance-id`; `--bridge-url` changes
the bridge endpoint, and `--runtime-id codex|claude|sciforge` selects the Agent
runtime.

The command writes the scored HTML/JSON report to the requested output
directory and writes one durable full-trace export per case to its `traces`
subdirectory. Use `--trace-output-dir` to choose another trace directory. A
later replay with `--trace-dir` scores those saved traces without calling the
Agent again. If the dev app is not running, the live command fails with a
bridge connectivity error; it never silently falls back to simulation.
The report identifies this execution mode as `live-agent`; replaying the same
files later identifies the mode as `trace`.

Task success and final-state assertions are intentionally not inferred from a
completed turn or successful tool calls. To provide authoritative evidence,
pass `--final-state-dir` containing one `<case-id>.json` file per case:

```json
{
  "taskSuccess": true,
  "finalState": {
    "statisticsProduced": true,
    "trendData": [{"year": 2026, "count": 3}]
  },
  "evidence": ["verified against the test workspace artifact"]
}
```

For one fresh Host and local global state per case, add `--isolate-global-state`
to the live command. It requires the default `--concurrency 1` and no other
development instance may hold the project lock or bridge port. The evaluator
starts a disposable Host with a temporary `userDataDir` for each case and
persists the trace before shutting that Host down. The Agent still receives
only the case query.

The final-state files are an external test oracle; they are not shown to the
Agent. Without them, the live report still measures the observed trajectory
and invocation behavior, but task-success/final-state metrics remain
unsupported or fail the workflow contract when those fields are required.
The oracle JSON is strict: it may contain only `taskSuccess`, `finalState`, and
an optional string-array `evidence`. `finalState` is the structured DTO used by
the deterministic `expectedFinalState.assertions`; an integration inspector
should populate it from verified files, data tables, artifacts, or lineage
records rather than from the Agent's prose.
