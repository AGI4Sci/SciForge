from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
import unittest

from evidence_dag.llm import LLMCallError, StubLLM
from evidence_dag.graph import ThreadGraph
from evidence_dag.incremental import (
    RECENT_ANCHOR_LIMIT,
    TraceStagingCache,
    compare_watermarks,
    watermark_regresses,
)
from evidence_dag.service import Engine, _is_canonical_execution_bundle


def _extract(trace_ref: str, suffix: str) -> str:
    return json.dumps({
        "nodes": [
            {
                "tmp_id": "source", "type": "source_assertion",
                "content": f"Source {suffix}.", "trace_ref": trace_ref,
            },
            {
                "tmp_id": "claim", "type": "claim",
                "content": f"Claim {suffix}.", "trace_ref": trace_ref,
            },
        ],
        "edges": [{"src": "source", "dst": "claim", "rel": "supports"}],
    })


class RecordingLLM:
    def __init__(self, extracts: list[str]) -> None:
        self.extracts = list(extracts)
        self.extract_prompts: list[str] = []

    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        system = next((item["content"] for item in messages if item["role"] == "system"), "")
        if "EDAG-TASK: nli" in system:
            return '{"entailment":0.9,"label":"entailment"}'
        if "EDAG-TASK: adversarial" in system:
            return '{"result":"passed","confidence":0.9,"rationale":"reviewed"}'
        prompt = next(item["content"] for item in messages if item["role"] == "user")
        self.extract_prompts.append(prompt)
        return self.extracts.pop(0)


def _command(workspace: str, *, watermark: str, trace: list[dict]) -> dict:
    return {
        "thread_id": "thread",
        "target_watermark": watermark,
        "reason": "turn_committed",
        "priority": "P2",
        "trace": trace,
        "workspace_root": workspace,
        "project_root": workspace,
    }


class IncrementalTracePipelineTests(unittest.TestCase):
    def test_composite_and_batch_watermarks_are_monotonic_under_reordering(self) -> None:
        self.assertEqual(compare_watermarks("20:event-new", "19:event-old"), 1)
        self.assertTrue(watermark_regresses("20:event-new", "19:event-old"))
        self.assertFalse(watermark_regresses("19:event-old", "20:event-new"))
        self.assertEqual(
            compare_watermarks(
                "20:event-new:batch:3/4", "20:event-new:batch:1/4",
            ),
            1,
        )
        self.assertEqual(
            compare_watermarks("20:event-new:batch:4/4", "20:event-new"),
            0,
        )

    def test_canonical_execution_bundle_commits_without_model_access(self) -> None:
        lineage_envelope = {
            "activity": {
                "id": "analysis:run-1",
                "type": "analysis_run",
                "name": "Deterministic analysis",
                "status": "completed",
                "parameters": {"score": 100},
            },
            "evidence": [{
                "id": "evidence:score-100",
                "type": "source_assertion",
                "name": "Observed score is 100",
            }],
            "conclusions": [{
                "id": "conclusion:score-controlled",
                "type": "conclusion",
                "name": "The controlled run reproduced the score",
            }],
            "relations": [{
                "src": "evidence:score-100",
                "dst": "conclusion:score-controlled",
                "rel": "supports",
            }],
        }
        digest = "sha256:" + "a" * 64
        manifest = {
            "schema": "sciforge.create-loop.run.v2",
            "source": "workflow",
            "workflow": {"id": "workflow-1", "name": "Workflow 1", "nodes": []},
            "input": {"score": 100},
            "context": {"platform": "darwin", "architecture": "arm64"},
            "comparator": {"kind": "exact-digest"},
            "determinism": {
                "control": "controlled", "reasonCodes": [], "stochasticNodeIds": [],
            },
            "workflowFingerprint": digest,
            "inputFingerprint": digest,
            "specFingerprint": digest,
            "contextFingerprint": digest,
            "outputFingerprint": digest,
            "outputJson": json.dumps({"evidenceLineage": lineage_envelope}),
            "approvalFingerprint": digest,
            "artifactRefs": [],
            "approvals": [],
        }
        event = {
            "id": "execution:run-1",
            "schemaVersion": "sciforge.execution-event.v1",
            "eventId": "event:run-1",
            "phase": "run_completed",
            "producer": {"moduleId": "sciforge.create-loop", "moduleVersion": "1.0.0"},
            "executionId": "execution-1",
            "runId": "run-1",
            "occurredAt": "2026-08-05T00:00:00Z",
            "artifacts": [{
                "kind": "sciforge.create-loop.run-manifest",
                "runId": "run-1",
                "workflowId": "workflow-1",
                "manifest": manifest,
            }],
        }
        marker = {
            "trustedBoundary": "sciforge.host.execution-completed.v1",
            "eventKind": "execution-completed",
            "hostBinding": {
                "contractVersion": 1,
                "acceptanceSequence": 1,
                "workspaceBinding": "unbound",
            },
            "producer": event["producer"],
            "executionId": "execution-1",
            "runId": "run-1",
            "runtimeId": "domain:sciforge.create-loop",
            "threadId": "execution:execution-1",
            "occurredAt": event["occurredAt"],
            "targetWatermark": "1:event:run-1",
        }
        event["sciforgeEvidenceEvent"] = marker
        canonical_trace = [
            event,
            {
                **event["artifacts"][0],
                "id": "execution:run-1:manifest",
                "sciforgeEvidenceEvent": marker,
            },
        ]
        self.assertTrue(_is_canonical_execution_bundle(canonical_trace))
        for mutate in (
            lambda trace: trace[0].update({
                "scope": {"runtimeId": "runtime:other", "threadId": "thread:other"},
            }),
            lambda trace: trace[0].update({
                "scope": {"runtimeId": "runtime-without-thread"},
            }),
            lambda trace: trace[0]["sciforgeEvidenceEvent"].update({"unknown": True}),
            lambda trace: trace[0]["sciforgeEvidenceEvent"]["hostBinding"].update({
                "unknown": True,
            }),
        ):
            hostile = copy.deepcopy(canonical_trace)
            mutate(hostile)
            self.assertFalse(_is_canonical_execution_bundle(hostile))

        for marker_field, hostile_value in (
            ("runtimeId", "runtime:ATTACKER"),
            ("threadId", "thread:ATTACKER"),
            ("turnId", "turn:ATTACKER"),
            ("activityId", "activity:ATTACKER"),
        ):
            hostile = copy.deepcopy(canonical_trace)
            hostile[1]["sciforgeEvidenceEvent"][marker_field] = hostile_value
            self.assertFalse(
                _is_canonical_execution_bundle(hostile),
                f"flattened artifact marker changed {marker_field}",
            )

        hostile = copy.deepcopy(canonical_trace)
        hostile[0]["artifacts"][0]["workflowId"] = "workflow-ATTACKER"
        self.assertFalse(_is_canonical_execution_bundle(hostile))
        hostile = copy.deepcopy(canonical_trace)
        hostile[1]["workflowId"] = "workflow-ATTACKER"
        self.assertFalse(_is_canonical_execution_bundle(hostile))
        self.assertFalse(_is_canonical_execution_bundle(canonical_trace[:1]))
        self.assertFalse(_is_canonical_execution_bundle([
            *canonical_trace,
            copy.deepcopy(canonical_trace[1]),
        ]))

        workspace_bound = copy.deepcopy(canonical_trace)
        for item in workspace_bound:
            item["sciforgeEvidenceEvent"]["hostBinding"] = {
                "contractVersion": 1,
                "acceptanceSequence": 1,
                "workspaceBinding": "capability-caller",
                "workspaceRoot": "/trusted/workspace",
            }
            item["sciforgeEvidenceEvent"]["workspaceRoot"] = "/trusted/workspace"
        workspace_bound[0]["workspaceRoot"] = "/trusted/workspace"
        self.assertTrue(_is_canonical_execution_bundle(workspace_bound))
        workspace_bound[0]["workspaceRoot"] = "/different/workspace"
        self.assertFalse(_is_canonical_execution_bundle(workspace_bound))

        class ExplodingLLM:
            calls = 0

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                self.calls += 1
                raise AssertionError("canonical execution bundles must not call the model")

        with tempfile.TemporaryDirectory() as workspace:
            llm = ExplodingLLM()
            engine = Engine(llm, storage_dir=os.path.join(workspace, ".edag"))
            result = engine.update(**_command(
                workspace,
                watermark="1:event:run-1",
                trace=canonical_trace,
            ))

            self.assertEqual(llm.calls, 0)
            self.assertEqual(result["update"]["graphState"], "committed")
            self.assertEqual(result["verification"]["mode"], "declared-execution-lineage")
            graph = engine.require("thread")
            self.assertEqual(graph.meta["extractionMode"], "declared-execution-lineage")
            conclusion = next(
                node for node in graph.nodes.values()
                if node.external_id == "conclusion:score-controlled"
            )
            self.assertEqual(conclusion.status.value, "fragile")
            lineage = graph.conclusion_lineage(conclusion.id)
            self.assertIn(
                "evidence:score-100",
                {node.get("external_id") for node in lineage["nodes"]},
            )
            self.assertEqual(sum(
                node.external_id == "conclusion:score-controlled"
                for node in graph.nodes.values()
            ), 1)

    def test_mixed_execution_and_semantic_trace_does_not_bypass_model(self) -> None:
        class ExplodingLLM:
            calls = 0

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                self.calls += 1
                raise AssertionError("mixed traces require semantic extraction")

        llm = ExplodingLLM()
        event = {
            "id": "execution:run-1",
            "schemaVersion": "sciforge.execution-event.v1",
            "phase": "run_completed",
            "executionId": "execution-1",
            "runId": "run-1",
            "evidenceLineage": {
                "activity": {
                    "id": "analysis:run-1", "type": "analysis_run",
                    "name": "Run 1", "parameters": {},
                },
            },
        }
        with tempfile.TemporaryDirectory() as workspace:
            engine = Engine(llm, storage_dir=os.path.join(workspace, ".edag"))
            with self.assertRaisesRegex(AssertionError, "mixed traces require"):
                engine.update(**_command(
                    workspace,
                    watermark="1",
                    trace=[event, {
                        "id": "message-1",
                        "type": "message",
                        "content": "A semantic claim that still requires extraction.",
                    }],
                ))
        self.assertEqual(llm.calls, 1)

    def test_typed_llm_failure_persists_diagnostics_and_keeps_committed_snapshot(self) -> None:
        class FailedResponseLLM:
            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                raise LLMCallError(
                    "router_response_incomplete",
                    "Model Router response was incomplete (reason=content_filter).",
                    attempts=2,
                    retryable=False,
                    response_status="incomplete",
                    incomplete_reason="content_filter",
                )

        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine = Engine(
                StubLLM(
                    extract_response=_extract("old", "committed"),
                    nli_handler=lambda _p, _h: 0.9,
                ),
                storage_dir=storage,
            )
            first = engine.update(**_command(
                workspace,
                watermark="1",
                trace=[{"id": "old", "type": "message", "content": "old"}],
            ))
            engine.llm = FailedResponseLLM()

            with self.assertRaises(LLMCallError):
                engine.update(**_command(
                    workspace,
                    watermark="2",
                    trace=[
                        {"id": "old", "type": "message", "content": "old"},
                        {"id": "new", "type": "message", "content": "new"},
                    ],
                ))

            error = {
                "type": "LLMCallError",
                "code": "router_response_incomplete",
                "message": (
                    "LLM call failed after 2 attempts: router_response_incomplete: "
                    "Model Router response was incomplete (reason=content_filter)."
                ),
                "retryable": False,
                "attempts": 2,
                "incompleteReason": "content_filter",
                "responseStatus": "incomplete",
            }
            status = engine.update_status("thread")
            self.assertEqual(status["error"], error)
            self.assertEqual(status["staging"]["error"], error)
            self.assertEqual(status["snapshot"]["digest"], first["snapshot"]["digest"])

            restarted = Engine(storage_dir=storage)
            reloaded = restarted.update_status("thread")
            self.assertEqual(reloaded["error"], error)
            self.assertEqual(reloaded["staging"]["error"], error)
            self.assertEqual(reloaded["snapshot"]["digest"], first["snapshot"]["digest"])

    def test_extraction_output_failure_is_typed_and_not_retryable(self) -> None:
        class EmptyOutputLLM:
            def __init__(self) -> None:
                self.calls = 0

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                self.calls += 1
                return ""

        with tempfile.TemporaryDirectory() as workspace:
            llm = EmptyOutputLLM()
            engine = Engine(llm, storage_dir=os.path.join(workspace, ".edag"))
            with self.assertRaisesRegex(
                RuntimeError,
                "extractor_empty_output",
            ):
                engine.update(**_command(
                    workspace,
                    watermark="1",
                    trace=[{"id": "new", "type": "message", "content": "new"}],
                ))

            status = engine.update_status("thread")
            self.assertEqual(llm.calls, 2)
            self.assertEqual(status["error"]["code"], "extractor_empty_output")
            self.assertEqual(status["error"]["attempts"], 2)
            self.assertFalse(status["error"]["retryable"])
            self.assertIsNone(status["error"]["incompleteReason"])

    def test_history_is_content_addressed_while_committed_anchors_stay_small(self) -> None:
        with tempfile.TemporaryDirectory() as storage:
            cache = TraceStagingCache(storage)
            trace = [
                {"id": f"item-{index}", "type": "message", "content": f"value {index}"}
                for index in range(RECENT_ANCHOR_LIMIT + 20)
            ]
            first = cache.begin(
                thread_id="thread", target_watermark="100", trace=trace,
                committed_graph=None, rebuild=False,
            )
            metadata = cache.committed_metadata(first)
            self.assertEqual(len(metadata["recentAnchors"]), RECENT_ANCHOR_LIMIT)
            self.assertEqual(metadata["processedTraceCount"], len(trace))
            history_path = os.path.join(
                storage, "staging", "cache",
                f"{metadata['historyDigest'].removeprefix('sha256:')}.json",
            )
            self.assertTrue(os.path.exists(history_path))

            committed = ThreadGraph("thread", {"traceIngestion": metadata})
            appended = [*trace, {"id": "latest", "type": "message", "content": "latest"}]
            second = cache.begin(
                thread_id="thread", target_watermark="101", trace=appended,
                committed_graph=committed, rebuild=False,
            )
            retried = cache.begin(
                thread_id="thread", target_watermark="101", trace=appended,
                committed_graph=committed, rebuild=False,
            )
            self.assertEqual([item["id"] for item in second.trace], ["latest"])
            self.assertEqual(retried.batch_digest, second.batch_digest)

    def test_cumulative_trace_only_extracts_items_after_committed_history(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            llm = RecordingLLM([_extract("old", "old"), _extract("new", "new")])
            engine = Engine(llm, storage_dir=storage)
            old = {"id": "old", "type": "message", "content": "old turn"}
            new = {"id": "new", "type": "message", "content": "new turn"}

            engine.update(**_command(workspace, watermark="10", trace=[old]))
            result = engine.update(**_command(workspace, watermark="20", trace=[old, new]))

            self.assertEqual(len(llm.extract_prompts), 2)
            self.assertIn("[new]", llm.extract_prompts[1])
            self.assertNotIn("[old]", llm.extract_prompts[1])
            self.assertEqual(result["update"]["traceStaging"]["inputTraceCount"], 2)
            self.assertEqual(result["update"]["traceStaging"]["newTraceCount"], 1)
            self.assertEqual(result["update"]["traceStaging"]["skippedTraceCount"], 1)
            metadata = engine.require("thread").meta["traceIngestion"]
            self.assertEqual(metadata["watermark"], "20")
            self.assertEqual(metadata["processedTraceCount"], 2)
            self.assertTrue(metadata["historyDigest"].startswith("sha256:"))
            self.assertEqual(engine.update_status("thread")["graphState"], "committed")
            self.assertIsNone(engine.update_status("thread")["staging"])

            # A fresh process resolves the content-addressed history index and
            # still excludes both old records from a cumulative feed.
            restarted_llm = RecordingLLM([_extract("latest", "latest")])
            restarted = Engine(restarted_llm, storage_dir=storage)
            latest = {"id": "latest", "type": "message", "content": "latest turn"}
            restarted.update(**_command(
                workspace, watermark="30", trace=[old, new, latest],
            ))
            self.assertIn("[latest]", restarted_llm.extract_prompts[0])
            self.assertNotIn("[old]", restarted_llm.extract_prompts[0])
            self.assertNotIn("[new]", restarted_llm.extract_prompts[0])

    def test_same_item_id_is_reprocessed_only_when_content_changes(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            llm = RecordingLLM([_extract("item", "v1"), _extract("item", "v2")])
            engine = Engine(llm, storage_dir=os.path.join(workspace, ".edag"))
            original = {"id": "item", "type": "message", "content": "version one"}
            changed = {"id": "item", "type": "message", "content": "version two"}
            engine.update(**_command(workspace, watermark="1", trace=[original]))
            result = engine.update(**_command(workspace, watermark="2", trace=[changed]))

            self.assertEqual(result["update"]["traceStaging"]["newTraceCount"], 1)
            self.assertIn("version two", llm.extract_prompts[1])
            self.assertEqual(engine.require("thread").meta["traceIngestion"]["processedTraceCount"], 1)

    def test_numeric_watermark_regression_is_rejected_before_staging(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine = Engine(
                StubLLM(extract_response=_extract("old", "old"), nli_handler=lambda _p, _h: 0.9),
                storage_dir=os.path.join(workspace, ".edag"),
            )
            first = engine.update(**_command(
                workspace, watermark="20",
                trace=[{"id": "old", "type": "message", "content": "old"}],
            ))
            with self.assertRaisesRegex(ValueError, "must not precede"):
                engine.update(**_command(
                    workspace, watermark="19",
                    trace=[{"id": "late", "type": "message", "content": "late"}],
                ))
            self.assertEqual(engine.latest_snapshot("thread").digest, first["snapshot"]["digest"])
            self.assertIsNone(engine.update_status("thread")["staging"])

    def test_failed_provisional_graph_never_replaces_committed_snapshot(self) -> None:
        class BlockingFailure:
            def __init__(self) -> None:
                self.entered = threading.Event()
                self.release = threading.Event()

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                system = next(
                    (item["content"] for item in messages if item["role"] == "system"), "",
                )
                if "EDAG-TASK: extract" in system:
                    return _extract("new", "provisional")
                if "EDAG-TASK: nli" in system:
                    self.entered.set()
                    self.release.wait(timeout=5)
                    raise RuntimeError("injected verifier failure")
                return '{"result":"passed","confidence":0.9,"rationale":"reviewed"}'

        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine = Engine(
                StubLLM(extract_response=_extract("old", "committed"), nli_handler=lambda _p, _h: 0.9),
                storage_dir=storage,
            )
            first = engine.update(**_command(
                workspace, watermark="1",
                trace=[{"id": "old", "type": "message", "content": "old"}],
            ))
            committed_before = engine.require("thread").to_dict()
            blocker = BlockingFailure()
            engine.llm = blocker
            errors: list[Exception] = []

            def compile_update() -> None:
                try:
                    engine.update(**_command(
                        workspace, watermark="2",
                        trace=[
                            {"id": "old", "type": "message", "content": "old"},
                            {"id": "new", "type": "message", "content": "new"},
                        ],
                    ))
                except Exception as error:
                    errors.append(error)

            worker = threading.Thread(target=compile_update)
            worker.start()
            self.assertTrue(blocker.entered.wait(timeout=2))
            status = engine.update_status("thread")
            self.assertEqual(status["graphState"], "provisional")
            self.assertEqual(status["snapshot"]["digest"], first["snapshot"]["digest"])
            provisional = engine.provisional_graph("thread")
            self.assertIsNotNone(provisional)
            self.assertEqual(provisional.meta["compileState"]["status"], "provisional")
            self.assertNotIn("snapshot", provisional.meta)
            self.assertTrue(any(node.content == "Claim provisional." for node in provisional.nodes.values()))
            self.assertEqual(engine.require("thread").to_dict(), committed_before)

            blocker.release.set()
            worker.join(timeout=5)
            self.assertEqual(len(errors), 1)
            self.assertEqual(engine.latest_snapshot("thread").digest, first["snapshot"]["digest"])
            self.assertEqual(engine.require("thread").to_dict(), committed_before)
            failed_status = engine.update_status("thread")
            self.assertEqual(failed_status["graphState"], "failed")
            self.assertEqual(failed_status["staging"]["status"], "failed")
            self.assertEqual(failed_status["staging"]["newTraceCount"], 1)


if __name__ == "__main__":
    unittest.main()
