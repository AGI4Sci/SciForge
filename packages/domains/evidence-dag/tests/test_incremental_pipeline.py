from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest

from evidence_dag.llm import LLMCallError, StubLLM
from evidence_dag.graph import ThreadGraph
from evidence_dag.incremental import RECENT_ANCHOR_LIMIT, TraceStagingCache
from evidence_dag.service import Engine


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
