from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest

from evidence_dag import provjson
from evidence_dag.artifacts import ArtifactRegistry, digest_bytes
from evidence_dag.llm import StubLLM
from evidence_dag.model import NodeType, SourceSelector, make_node_id
from evidence_dag.service import Engine


def _extract_payload(locator: str, *, quote: str = "Exact result text.") -> str:
    return json.dumps({
        "nodes": [
            {
                "tmp_id": "s", "type": "source_assertion", "content": "The paper reports a result.",
                "trace_ref": "item-1", "source_type": "paper", "credibility": "high",
                "artifact": {"kind": "paper", "locator": locator},
                "selector": {"type": "pdf", "page": 3, "section": "Results", "quote": quote},
            },
            {"tmp_id": "c", "type": "claim", "content": "The result supports the claim.",
             "trace_ref": "item-1"},
        ],
        "edges": [{"src": "s", "dst": "c", "rel": "supports"}],
    })


class TestArtifactRegistry(unittest.TestCase):
    def test_structured_selector_rejects_free_form_and_hashes_exact_quote(self):
        with self.assertRaises(ValueError):
            SourceSelector.from_dict({"type": "pdf", "location": "somewhere around the results"})
        with tempfile.TemporaryDirectory() as workspace:
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, version, _ = registry.register(
                kind="paper", locator="doi:10.1000/test", content_digest="a" * 64,
            )
            anchor = registry.create_anchor(
                artifact.artifact_id, {"type": "pdf", "page": 2, "quote": "bounded quote"},
                artifact_version_id=version.version_id,
            )
            self.assertEqual(anchor.anchor_digest, digest_bytes(b"bounded quote"))

    def test_unique_move_rebinds_without_changing_artifact_or_version_identity(self):
        with tempfile.TemporaryDirectory() as workspace:
            original = os.path.join(workspace, "paper.txt")
            moved = os.path.join(workspace, "archive", "paper.txt")
            os.makedirs(os.path.dirname(moved))
            with open(original, "wb") as fh:
                fh.write(b"same bytes")
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, version, _ = registry.register(kind="paper", locator=original)
            os.rename(original, moved)
            result = registry.resolve(artifact.artifact_id)
            self.assertEqual(result["outcome"], "moved")
            self.assertEqual(result["artifact"]["artifactId"], artifact.artifact_id)
            self.assertEqual(result["artifactVersion"]["versionId"] if "artifactVersion" in result else
                             result["versions"][0]["versionId"], version.version_id)
            self.assertEqual(result["versions"][0]["historicalLocators"], ["paper.txt"])

    def test_multiple_move_candidates_are_ambiguous_and_never_arbitrarily_selected(self):
        with tempfile.TemporaryDirectory() as workspace:
            original = os.path.join(workspace, "paper.txt")
            with open(original, "wb") as fh:
                fh.write(b"same bytes")
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, version, _ = registry.register(kind="paper", locator=original)
            os.unlink(original)
            for name in ("candidate-a.txt", "candidate-b.txt"):
                with open(os.path.join(workspace, name), "wb") as fh:
                    fh.write(b"same bytes")
            result = registry.resolve(artifact.artifact_id)
            self.assertEqual(result["outcome"], "ambiguous")
            self.assertEqual(result["versions"][0]["locator"], "paper.txt")
            self.assertEqual(result["versions"][0]["versionId"], version.version_id)
            self.assertEqual(len(result["candidates"]), 2)

    def test_same_path_content_change_appends_version(self):
        with tempfile.TemporaryDirectory() as workspace:
            path = os.path.join(workspace, "dataset.csv")
            with open(path, "wb") as fh:
                fh.write(b"x\n1\n")
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, first, _ = registry.register(kind="dataset", locator=path)
            with open(path, "wb") as fh:
                fh.write(b"x\n2\n")
            result = registry.resolve(artifact.artifact_id)
            self.assertEqual(result["outcome"], "content_changed")
            self.assertNotEqual(result["newVersionId"], first.version_id)
            self.assertEqual(len(result["versions"]), 2)
            old = next(v for v in result["versions"] if v["versionId"] == first.version_id)
            self.assertEqual(old["contentDigest"], first.content_digest)
            self.assertEqual(old["availability"], "missing")

    def test_registering_changed_bytes_emits_the_same_durable_lifecycle_event(self):
        with tempfile.TemporaryDirectory() as workspace:
            path = os.path.join(workspace, "dataset.csv")
            with open(path, "wb") as fh:
                fh.write(b"x\n1\n")
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, first, _ = registry.register(kind="dataset", locator=path)
            with open(path, "wb") as fh:
                fh.write(b"x\n2\n")

            same, second, outcome = registry.register(kind="dataset", locator=path)
            self.assertEqual(outcome, "content_changed")
            self.assertEqual(same.artifact_id, artifact.artifact_id)
            self.assertNotEqual(second.version_id, first.version_id)
            events = registry.resolve_all()
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["type"], "ArtifactContentChanged")

    def test_scoped_lifecycle_scan_emits_stable_events_once(self):
        with tempfile.TemporaryDirectory() as workspace:
            path = os.path.join(workspace, "dataset.csv")
            with open(path, "wb") as fh:
                fh.write(b"value\n1\n")
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            artifact, first, _ = registry.register(kind="dataset", locator=path)
            with open(path, "wb") as fh:
                fh.write(b"value\n2\n")

            events = registry.resolve_all()
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["type"], "ArtifactContentChanged")
            self.assertEqual(events[0]["artifactId"], artifact.artifact_id)
            self.assertEqual(events[0]["previousVersionId"], first.version_id)
            self.assertNotEqual(events[0]["artifactVersionId"], first.version_id)
            self.assertEqual(registry.resolve_all(), events)
            self.assertEqual(registry.acknowledge_events([events[0]["eventId"]]),
                             [events[0]["eventId"]])
            self.assertEqual(registry.resolve_all(), [])

    def test_lifecycle_event_survives_restart_until_durable_queue_ack(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = os.path.join(root, "workspace")
            os.makedirs(workspace)
            registry_path = os.path.join(root, "state", "registry.json")
            path = os.path.join(workspace, "paper.txt")
            with open(path, "wb") as fh:
                fh.write(b"first")
            registry = ArtifactRegistry(
                registry_path, workspace_roots=(workspace,), locator_root=workspace,
            )
            registry.register(kind="paper", locator=path)
            with open(path, "wb") as fh:
                fh.write(b"second")
            pending = registry.resolve_all()
            self.assertEqual(len(pending), 1)

            recovered = ArtifactRegistry(
                registry_path, workspace_roots=(workspace,), locator_root=workspace,
            )
            self.assertEqual(recovered.resolve_all(), pending)
            recovered.acknowledge_events([pending[0]["eventId"]])
            final = ArtifactRegistry(
                registry_path, workspace_roots=(workspace,), locator_root=workspace,
            )
            self.assertEqual(final.resolve_all(), [])


class TestEvidenceSnapshots(unittest.TestCase):
    def test_update_commits_canonical_snapshot_registry_and_incremental_ledger(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine = Engine(
                StubLLM(extract_response=_extract_payload("doi:10.1000/test"),
                        nli_handler=lambda _p, _h: 0.9),
                storage_dir=os.path.join(workspace, ".edag"),
            )
            result = engine.update(
                thread_id="runtime:thread", target_watermark="item-1", reason="turn_committed",
                priority="P2", trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="project",
            )
            snapshot = result["snapshot"]
            self.assertEqual(snapshot["status"], "committed")
            self.assertEqual(set(snapshot), {
                "threadId", "version", "digest", "inputWatermark", "schemaVersion",
                "extractorVersion", "verifierVersion", "artifactDigests", "createdAt", "status",
                "humanReview",
            })
            self.assertEqual(snapshot["humanReview"]["policyVersion"], "human-review.v1")
            document = engine.export_prov_json("runtime:thread")
            self.assertEqual(document["edag:meta"]["snapshot"], snapshot)
            self.assertEqual(set(document["edag:artifactRegistry"]), {
                "artifacts", "artifactVersions", "sourceAnchors",
            })
            source = next(value for value in document["entity"].values()
                          if value["prov:type"] == "edag:source_assertion")
            for field in ("edag:artifact_id", "edag:artifact_version_id", "edag:source_anchor_id"):
                self.assertTrue(source[field])
            ledger = document["edag:assessments"]
            # This fixture is an ordinary low-impact claim. A0 is complete and
            # A1 covers its new semantic edge; A2 is intentionally reserved for
            # critical, disputed, or high-impact targets.
            self.assertTrue({"A0", "A1"}.issubset({item["level"] for item in ledger}))
            self.assertNotIn("A2", {item["level"] for item in ledger})
            self.assertTrue(all(item["targetDigest"] == snapshot["digest"] for item in ledger))
            self.assertTrue(all("humanReview" in item for item in ledger))

    def test_semantic_id_never_reuses_artifact_digest(self):
        semantic_id = make_node_id(NodeType.CLAIM, "A normalized scientific claim")
        artifact_digest = digest_bytes(b"A normalized scientific claim")
        self.assertNotEqual(semantic_id, artifact_digest)
        self.assertTrue(semantic_id.startswith("claim:"))
        self.assertTrue(artifact_digest.startswith("sha256:"))

    def test_identical_update_payload_short_circuits_before_any_llm_call(self):
        with tempfile.TemporaryDirectory() as workspace:
            llm = StubLLM(extract_response=_extract_payload("doi:10.1000/test"),
                          nli_handler=lambda _p, _h: 0.9)
            engine = Engine(llm, storage_dir=os.path.join(workspace, ".edag"))
            command = dict(
                thread_id="t", target_watermark="w1", reason="turn_committed", priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="p",
            )
            first = engine.update(**command)
            calls_after_first = len(llm.calls)
            second = engine.update(**command)
            self.assertGreater(calls_after_first, 0)
            self.assertEqual(len(llm.calls), calls_after_first)
            self.assertTrue(second["idempotent"])
            self.assertEqual(second["snapshot"]["digest"], first["snapshot"]["digest"])

    def test_snapshots_are_immutable_idempotent_and_historical_audit_is_read_only(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine = Engine(StubLLM(extract_response=_extract_payload("doi:10.1000/test"),
                                    nli_handler=lambda _p, _h: 0.9), storage_dir=storage)
            first = engine.update(
                thread_id="t", target_watermark="w1", reason="turn_committed", priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="p",
            )
            immutable = os.path.join(
                engine._snapshot_dir("t"),
                f"00000001-{first['snapshot']['digest'][7:]}.prov.json",
            )
            with open(immutable, encoding="utf-8") as fh:
                original_bytes = fh.read()
            repeated = engine.update(
                thread_id="t", target_watermark="w1", reason="manual_update", priority="P2",
                trace=None, workspace_root=workspace, project_root=workspace, project_key="p",
            )
            self.assertTrue(repeated["idempotent"])
            self.assertEqual(repeated["snapshot"]["version"], 1)
            second = engine.update(
                thread_id="t", target_watermark="w2", reason="turn_committed", priority="P2",
                trace=None, workspace_root=workspace, project_root=workspace, project_key="p",
            )
            self.assertEqual(second["snapshot"]["version"], 2)
            audit = engine.audit("t", target_digest=first["snapshot"]["digest"], trigger="manual")
            self.assertEqual(audit["target_digest"], first["snapshot"]["digest"])
            self.assertTrue(engine.audit_runs("t")[0]["stale"])
            with open(immutable, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), original_bytes)

    def test_content_change_keeps_assertion_identity_and_marks_old_path_stale(self):
        with tempfile.TemporaryDirectory() as workspace:
            path = os.path.join(workspace, "paper.txt")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("version one")
            engine = Engine(StubLLM(extract_response=_extract_payload("paper.txt"),
                                    nli_handler=lambda _p, _h: 0.9),
                            storage_dir=os.path.join(workspace, ".edag"))
            first = engine.update(
                thread_id="t", target_watermark="w1", reason="turn_committed", priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="p",
            )
            source_before = engine.require("t").nodes_of(NodeType.SOURCE_ASSERTION)[0]
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("version two")
            resolved = engine.resolve_artifact(
                source_before.artifact_id or "", project_key="p", workspace_root=workspace,
                project_root=workspace, candidate_locators=[],
            )
            self.assertEqual(resolved["outcome"], "content_changed")
            engine.update(
                thread_id="t", target_watermark="w2", reason="artifact_content_changed", priority="P2",
                trace=None, workspace_root=workspace, project_root=workspace, project_key="p",
            )
            source_after = engine.require("t").nodes_of(NodeType.SOURCE_ASSERTION)[0]
            self.assertEqual(source_after.id, source_before.id)
            self.assertEqual(source_after.artifact_version_id, source_before.artifact_version_id)
            self.assertEqual(source_after.freshness, "stale")
            claim = engine.require("t").nodes_of(NodeType.CLAIM)[0]
            self.assertEqual(claim.freshness, "stale")
            self.assertEqual(first["snapshot"]["version"], 1)

    def test_artifact_scan_returns_only_affected_evidence_threads(self):
        with tempfile.TemporaryDirectory() as workspace:
            path = os.path.join(workspace, "paper.txt")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("version one")
            engine = Engine(StubLLM(extract_response=_extract_payload("paper.txt"),
                                    nli_handler=lambda _p, _h: 0.9),
                            storage_dir=os.path.join(workspace, ".edag"))
            first = engine.update(
                thread_id="sciforge:affected", target_watermark="w1", reason="turn_committed",
                priority="P2", trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="p",
            )
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("version two")

            scan = engine.resolve_artifacts(
                project_key="p", workspace_root=workspace, project_root=workspace,
            )
            self.assertEqual([event["type"] for event in scan["events"]],
                             ["ArtifactContentChanged"])
            self.assertEqual(scan["affectedThreads"], [{
                "threadId": "sciforge:affected",
                "targetWatermark": first["snapshot"]["inputWatermark"],
                "artifactIds": [scan["events"][0]["artifactId"]],
            }])

    def test_failed_concurrent_update_never_exposes_partial_graph(self):
        class BlockingFailure:
            def __init__(self):
                self.entered = threading.Event()
                self.release = threading.Event()

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                self.entered.set()
                self.release.wait(timeout=5)
                raise RuntimeError("injected compiler failure")

        with tempfile.TemporaryDirectory() as workspace:
            engine = Engine(StubLLM(extract_response=_extract_payload("doi:10.1000/test"),
                                    nli_handler=lambda _p, _h: 0.9),
                            storage_dir=os.path.join(workspace, ".edag"))
            first = engine.update(
                thread_id="t", target_watermark="w1", reason="turn_committed", priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace, project_key="p",
            )
            old_graph = engine.require("t").to_dict()
            blocker = BlockingFailure()
            engine.llm = blocker
            errors: list[Exception] = []

            def compile_update():
                try:
                    engine.update(
                        thread_id="t", target_watermark="w2", reason="turn_committed", priority="P2",
                        trace=[{"id": "item-2", "type": "message", "content": "new"}],
                        workspace_root=workspace, project_root=workspace, project_key="p",
                    )
                except Exception as exc:  # expected injected failure
                    errors.append(exc)

            worker = threading.Thread(target=compile_update)
            worker.start()
            self.assertTrue(blocker.entered.wait(timeout=2))
            self.assertEqual(engine.latest_snapshot("t").digest, first["snapshot"]["digest"])
            self.assertEqual(engine.require("t").to_dict(), old_graph)
            blocker.release.set()
            worker.join(timeout=5)
            self.assertEqual(len(errors), 1)
            self.assertEqual(engine.latest_snapshot("t").digest, first["snapshot"]["digest"])
            self.assertEqual(engine.require("t").to_dict(), old_graph)
            self.assertEqual(engine.update_status("t")["status"], "error")


if __name__ == "__main__":
    unittest.main()
