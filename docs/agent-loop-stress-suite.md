# Agent Loop Stress Suite

This suite separates deterministic loop correctness from model-quality evaluation.
Committed tests are self-authored and run without a network model. Public benchmark
tasks remain external so their repositories and task-level licenses can be audited at
run time.

## Deterministic Scenarios

| ID | Adversarial behavior | Required result | Current coverage |
| --- | --- | --- | --- |
| S1 | Read the same unchanged file through relative, absolute, `./`, and covered line ranges. | Normalize paths/ranges, tolerate at most one redundant read per file version, and stop before a fourth model request. | `trajectory-stuck-detector.test.ts`, `agent-loop-policy.test.ts` |
| S2 | Alternate two successful action/observation pairs indefinitely. | Stop after six persisted pairs with `agent_stuck`. | `trajectory-stuck-detector.test.ts`, `agent-loop-policy.test.ts` |
| S3 | Repeat one failing action with changing error text. | Stop after three failures; changing error strings must not evade detection. | `trajectory-stuck-detector.test.ts` |
| S4 | Consume the whole tool allowance using unique, successful calls. | Execute 16 calls, remove tools, and request one final synthesis. | `agent-loop-policy.test.ts` |
| S5 | Steer a running turn after its first investigation step. | Put steering in the next model request and reset the trajectory boundary. | `loop.test.ts`, `trajectory-stuck-detector.test.ts` |
| S6 | Deny or interrupt an untrusted mutation, and interrupt a structured-input pause. | Register before publishing the gate event, settle promptly, execute no mutation, and leave no pending item. | `agent-loop-multiturn-stress.test.ts` |
| S7 | Receive a recoverable 502 before output, then perform a mutation. | Retry the model step and perform the mutation exactly once. | `agent-loop-multiturn-stress.test.ts` |
| S8 | Run simultaneous turns with independent steering queues. | No message loss or cross-turn state leakage. | `steering-queue.test.ts` |
| S9 | Compact a long evolving conversation, then receive a new user correction. | Preserve active constraints and treat the correction as a new trajectory. | Existing compaction suites plus `trajectory-stuck-detector.test.ts` |
| S10 | Recreate policy state from persisted items. | Reproduce stuck and budget decisions without hidden detector messages. | Pure detector tests and history-derived breaker/budget reconstruction |

Run the deterministic slice:

```bash
cd kun
npm test -- --run tests/event-driven-agent-runner.test.ts \
  tests/trajectory-stuck-detector.test.ts \
  tests/agent-loop-policy.test.ts \
  tests/agent-loop-multiturn-stress.test.ts \
  tests/steering-queue.test.ts
```

## External Model-Quality Evaluation

Use the same DeepSeek V4 Pro router profile, task checkout, tool catalog, approval
policy, and budgets for the old-loop baseline and the replacement. Run at least three
replicates per task.

Recommended upstream suites:

- [SWE-Together](https://github.com/Togetherbench/SWE-Together): reconstructed
  multi-turn software-engineering sessions with user corrections. Start with its
  parallel-tool-stall, tool-write-error, and foreign-tool-call-fix task families.
- [FeatureBench](https://github.com/LiberCoders/FeatureBench): difficult feature-level
  repository changes and a smaller fast evaluation split.
- [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1):
  deterministic terminal, process, and debugging recovery.
- [CodeScaleBench](https://github.com/sourcegraph/CodeScaleBench): large and multi-repo
  tasks with tool traces, useful for retrieval and tool-efficiency analysis.
- [StaminaBench](https://github.com/amazon-science/StaminaBench): evolving REST
  requirements over long conversations. Its non-commercial dataset license means the
  pattern should be reimplemented for committed SciForge fixtures rather than vendored.

Do not copy upstream user transcripts or issue bodies into this repository without a
task-level license audit.

## Metrics and Gate

Compare two persisted event logs with:

```bash
cd kun
npm run transcript:diff -- <old-events.jsonl> <new-events.jsonl>
```

The report includes terminal states, model steps, total/executed/suppressed tool calls,
stuck stops, tool-budget exhaustions, steering corrections, approvals, compactions,
tokens, cache utilization, and cost.

Migration gate:

- all deterministic scenarios pass;
- no unauthorized or duplicated mutation;
- no approval, input, or interruption hang;
- same-model functional success is no worse than the baseline;
- median tool calls per successful task falls by at least 25%;
- steering corrections and cost do not worsen unless functional success improves.

Public leaderboard scores are not loop-isolated evidence because scaffolds use different
models, prompts, budgets, and test-time strategies. The same-model A/B result is the
release decision.
