# Capability Eval

SciForge's capability evaluation runner has two intentionally separate data
sets. Both use the existing Registry/Broker contract and deterministic
simulation or durable full-trace input; simulation mode does not call providers.

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

## Run

Run the default golden regression set:

```sh
npm run eval:capability
```

Run the same mode with an explicit case file or baseline:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/golden.jsonl \
  --baseline eval-results/latest.json
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
identifies the run as either `Capability Golden Regression` or
`Evaluator Self-Test`.

Self-test output uses separate semantics:

```text
Evaluator Self-Test (deterministic-simulation)
Total Cases: 3
Expected Failures Detected: 3
Missed Failures: 0
Detection Rate: 100.0%
```

The current self-test contract records `subjectResult` and
`evaluatorTestResult` in the report, but does not yet declare exact expected
failure types per case. It treats any evaluator failure as detection. A future
schema extension such as `selfTest.expectedFailureTypes` can make the check
assert exact `wrong_domain`, `forbidden_action`, or `argument_mismatch` types.

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
in; they do not become a scored pass.

## Trace mode

Evaluate one full-trace JSONL export with:

```sh
npm run eval:capability -- \
  --cases eval-cases/capability/golden.jsonl \
  --trace /absolute/path/to/trace.jsonl \
  --case-id paper-search-happy-path
```

The trace adapter reads durable `agent_event` tool and approval events. It
resolves capability IDs from `sciforge_invoke` structured output and keeps
opaque `op_...` references opaque. Missing discovery arguments, approval
ordering, final state, or other fields are surfaced as unsupported rather than
invented.
