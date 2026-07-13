from __future__ import annotations

import os
import tempfile
import http.client
import json
import threading
import unittest
from dataclasses import replace
from http.server import ThreadingHTTPServer
from urllib.parse import quote

from evidence_dag.assessment import bind_target_digest, run_a0, run_a1, run_a2
from evidence_dag.graph import ThreadGraph
from evidence_dag.human_review import (
    DEFAULT_POLICY,
    attach_human_reviews,
    human_review_summary,
    remap_review_packet_assessment_ids,
    select_a2_targets,
)
from evidence_dag.model import (
    Assessment,
    AssessmentDimension,
    AssessmentLevel,
    AssessmentResult,
    EdgeRel,
    HumanReviewStatus,
    NodeStatus,
    NodeType,
)
from evidence_dag.service import Engine, ReviewDecisionConflict
from evidence_dag.server import Handler
from evidence_dag.snapshot import build_snapshot, compute_snapshot_digest


class AdversarialLLM:
    def __init__(self) -> None:
        self.calls = 0

    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        self.calls += 1
        return '{"result":"uncertain","confidence":0.65,"rationale":"Visible evidence conflicts."}'


def assessment(
    target_id: str,
    *,
    level: AssessmentLevel = AssessmentLevel.A0,
    result: AssessmentResult = AssessmentResult.FAILED,
    dimension: AssessmentDimension = AssessmentDimension.PROVENANCE,
    assessment_id: str = "assessment:provisional",
) -> Assessment:
    return Assessment(
        assessment_id=assessment_id,
        target_id=target_id,
        dimension=dimension,
        level=level,
        result=result,
        actor="test-checker",
        method="test-method-v1",
        confidence=0.95,
        target_digest="pending",
        created_at="2026-01-01T00:00:00Z",
    )


def committed_engine(storage: str) -> tuple[Engine, str, str]:
    engine = Engine(storage_dir=storage)
    graph = ThreadGraph("thread")
    target = graph.add_or_get_node(NodeType.CLAIM, "A decision-critical claim")
    pending, packets = attach_human_reviews(
        graph,
        [assessment(target.id)],
        delta={"new_nodes": [target.id], "new_edges": []},
        computed_at="2026-01-01T00:00:00Z",
    )
    graph.assessments = pending
    graph.review_policy_version = DEFAULT_POLICY.version
    graph.review_packets = packets
    snapshot = build_snapshot(graph, version=1, input_watermark="turn:1")
    bound = bind_target_digest(pending, snapshot.digest)
    graph.assessments = bound
    graph.review_packets = remap_review_packet_assessment_ids(
        graph.review_packets,
        {before.assessment_id: after.assessment_id for before, after in zip(pending, bound)},
    )
    graph.meta["snapshot"] = snapshot.to_dict()
    engine._commit_snapshot(graph, snapshot)
    engine._graphs[graph.thread_id] = graph
    engine._snapshots[graph.thread_id] = snapshot
    return engine, snapshot.digest, graph.review_packets[0].review_packet_id


class HumanReviewPolicyTests(unittest.TestCase):
    def test_old_graph_and_assessment_without_human_review_still_load(self) -> None:
        graph = ThreadGraph("legacy")
        node = graph.add_or_get_node(NodeType.CLAIM, "Legacy claim")
        graph.assessments = [assessment(node.id)]
        payload = graph.to_dict()
        self.assertNotIn("humanReview", payload)
        loaded = ThreadGraph.from_dict(payload)
        self.assertIsNone(loaded.assessments[0].human_review)
        self.assertEqual(loaded.review_packets, [])

    def test_a0_is_full_and_failed_safety_check_opens_required_packet(self) -> None:
        graph = ThreadGraph("thread")
        first = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, "Source one")
        second = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, "Source two")
        checks = run_a0(graph)
        self.assertEqual(
            {item.target_id for item in checks if item.result == AssessmentResult.FAILED},
            {first.id, second.id},
        )
        reviewed, packets = attach_human_reviews(
            graph, checks,
            delta={"new_nodes": [first.id, second.id], "new_edges": []},
            computed_at="2026-01-01T00:00:00Z",
        )
        required = [item for item in reviewed if item.human_review.blocking]
        self.assertEqual(len(required), 2)
        self.assertEqual(len([item for item in packets if item.blocking]), 1)
        packet = next(item for item in packets if item.blocking)
        self.assertEqual(set(packet.target_ids), {first.id, second.id})
        self.assertEqual(packet.checker.to_dict(), {
            "actorType": "rule",
            "actor": "evidence-human-review-checker",
            "method": "risk-score-policy-v1",
            "authority": "blocking",
        })
        self.assertTrue(all(reason.code for reason in packet.reasons))

    def test_a1_only_checks_requested_semantic_delta(self) -> None:
        graph = ThreadGraph("thread")
        source = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, "Source")
        first = graph.add_or_get_node(NodeType.CLAIM, "First")
        second = graph.add_or_get_node(NodeType.CLAIM, "Second")
        old_edge = graph.add_edge(source.id, first.id, EdgeRel.SUPPORTS, nli_score=0.9)
        new_edge = graph.add_edge(source.id, second.id, EdgeRel.SUPPORTS, nli_score=0.8)
        checks = run_a1(
            graph, threshold=0.7, verifier_version="v1",
            target_edge_ids={new_edge.id},
        )
        self.assertEqual([item.target_id for item in checks], [new_edge.id])
        self.assertNotEqual(old_edge.id, checks[0].target_id)

    def test_a2_selects_critical_or_disputed_targets_not_ordinary_claims(self) -> None:
        graph = ThreadGraph("thread")
        source = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, "Source")
        ordinary = graph.add_or_get_node(NodeType.CLAIM, "Ordinary")
        critical = graph.add_or_get_node(
            NodeType.CLAIM, "Critical", attributes={"decisionCritical": True},
        )
        disputed = graph.add_or_get_node(NodeType.FINDING, "Disputed")
        disputed.status = NodeStatus.CONFLICTED
        graph.add_edge(source.id, ordinary.id, EdgeRel.SUPPORTS)
        graph.add_edge(source.id, critical.id, EdgeRel.SUPPORTS)
        graph.add_edge(source.id, disputed.id, EdgeRel.CONTRADICTS)
        selected = select_a2_targets(
            graph,
            changed_node_ids=[ordinary.id, critical.id, disputed.id],
            changed_edge_ids=list(graph.edges),
        )
        self.assertNotIn(ordinary.id, selected)
        self.assertIn(critical.id, selected)
        self.assertIn(disputed.id, selected)
        llm = AdversarialLLM()
        checks = run_a2(
            graph, llm, reviewer_version="v1", target_ids=set(selected),
        )
        self.assertEqual({item.target_id for item in checks}, {critical.id, disputed.id})
        self.assertEqual(llm.calls, 2)

    def test_packets_are_aggregated_and_snapshot_digest_ignores_audit_timestamps(self) -> None:
        graph = ThreadGraph("thread")
        targets = [graph.add_or_get_node(NodeType.CLAIM, f"Claim {index}") for index in range(12)]
        checks = [assessment(node.id, assessment_id=f"assessment:{index}") for index, node in enumerate(targets)]
        reviewed, packets = attach_human_reviews(
            graph, checks,
            delta={"new_nodes": [node.id for node in targets], "new_edges": []},
            computed_at="2026-01-01T00:00:00Z",
        )
        graph.assessments = reviewed
        graph.review_policy_version = DEFAULT_POLICY.version
        graph.review_packets = packets
        self.assertLessEqual(len([item for item in packets if item.status == HumanReviewStatus.PENDING]), 3)
        before = compute_snapshot_digest(graph, input_watermark="turn:1")
        graph.assessments = [replace(
            item,
            created_at="2026-02-02T00:00:00Z",
            human_review=replace(item.human_review, computed_at="2026-02-02T00:00:00Z"),
        ) for item in graph.assessments]
        graph.review_packets = [replace(
            item, computed_at="2026-02-02T00:00:00Z",
        ) for item in graph.review_packets]
        self.assertEqual(before, compute_snapshot_digest(graph, input_watermark="turn:1"))

    def test_review_decision_is_cas_bound_audited_and_survives_restart(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine, digest, packet_id = committed_engine(storage)
            current_path = engine._path("thread")
            with open(current_path, "rb") as handle:
                before = handle.read()
            result = engine.record_review_decision(
                "thread", packet_id,
                action="approve",
                expected_snapshot_digest=digest,
                actor="human:reviewer",
                rationale="Validated against the original source.",
            )
            self.assertEqual(result["reviewPacket"]["status"], "approved")
            self.assertEqual(result["decision"]["checker"]["authority"], "override")
            self.assertEqual(result["event"]["type"], "HumanReviewDecisionRecorded")
            with open(current_path, "rb") as handle:
                self.assertEqual(before, handle.read(), "decision must not rewrite immutable snapshot")
            reloaded = Engine(storage_dir=storage)
            graph = reloaded.require("thread")
            packet = next(item for item in graph.review_packets if item.review_packet_id == packet_id)
            self.assertEqual(packet.status, HumanReviewStatus.APPROVED)
            self.assertEqual(packet.reviewed_by, "human:reviewer")
            self.assertEqual(
                compute_snapshot_digest(graph, input_watermark="turn:1"), digest,
            )
            with self.assertRaises(ReviewDecisionConflict):
                reloaded.record_review_decision(
                    "thread", packet_id,
                    action="reject",
                    expected_snapshot_digest="sha256:" + "0" * 64,
                    actor="human:reviewer",
                    rationale="This is deliberately stale.",
                )

    def test_human_review_summary_blocks_only_unresolved_required_packets(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine, digest, packet_id = committed_engine(os.path.join(workspace, ".edag"))
            summary = human_review_summary(engine.require("thread"))
            self.assertEqual(summary["gateStatus"], "blocked")
            # This flat projection is the cross-DAG envelope contract consumed
            # by Project DAG; aggregate queue fields remain available beside it.
            for key in (
                "level", "score", "status", "reasons", "blocking",
                "reviewPacketId", "checker", "machineChecks", "blastRadius",
            ):
                self.assertIn(key, summary)
            self.assertEqual(summary["level"], "required")
            self.assertEqual(summary["status"], "pending")
            self.assertTrue(summary["blocking"])
            self.assertEqual(summary["reviewPacketId"], packet_id)
            self.assertIsInstance(summary["reasons"], list)
            self.assertTrue(all(isinstance(reason, dict) for reason in summary["reasons"]))
            self.assertEqual(summary["checker"]["authority"], "blocking")
            self.assertGreaterEqual(summary["blastRadius"], 0.0)
            self.assertLessEqual(summary["blastRadius"], 1.0)
            snapshot_review = engine.latest_snapshot("thread").to_dict()["humanReview"]
            self.assertNotIn("reviewPackets", snapshot_review)
            self.assertEqual(snapshot_review["reviewPacketId"], packet_id)
            engine.record_review_decision(
                "thread", packet_id,
                action="approve", expected_snapshot_digest=digest,
                actor="human:reviewer", rationale="Approved.",
            )
            summary = human_review_summary(engine.require("thread"))
            self.assertEqual(summary["gateStatus"], "clear")
            self.assertEqual(summary["blockingCount"], 0)
            self.assertEqual(summary["level"], "none")
            self.assertEqual(summary["status"], "not_needed")

    def test_http_decision_route_returns_conflict_for_stale_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine, digest, packet_id = committed_engine(os.path.join(workspace, ".edag"))
            previous_engine, previous_token = Handler.engine, Handler.api_token
            Handler.engine = engine
            Handler.api_token = "review-test-token"
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                path = (
                    f"/threads/{quote('thread', safe='')}/reviews/"
                    f"{quote(packet_id, safe='')}/decision"
                )

                def post(expected_digest: str) -> tuple[int, dict]:
                    connection = http.client.HTTPConnection(
                        "127.0.0.1", server.server_address[1], timeout=2,
                    )
                    connection.request(
                        "POST", path,
                        body=json.dumps({
                            "action": "approve",
                            "expectedSnapshotDigest": expected_digest,
                            "actor": "human:http-test",
                            "rationale": "HTTP contract verification.",
                        }),
                        headers={
                            "Authorization": "Bearer review-test-token",
                            "Content-Type": "application/json",
                        },
                    )
                    response = connection.getresponse()
                    payload = json.loads(response.read().decode("utf-8"))
                    connection.close()
                    return response.status, payload

                status, payload = post(digest)
                self.assertEqual(status, 200)
                self.assertEqual(payload["data"]["reviewPacket"]["status"], "approved")
                stale_status, stale = post("sha256:" + "0" * 64)
                self.assertEqual(stale_status, 409)
                self.assertEqual(stale["error"]["code"], "SNAPSHOT_CONFLICT")
            finally:
                server.shutdown()
                server.server_close()
                Handler.engine, Handler.api_token = previous_engine, previous_token

    def test_idempotency_key_cannot_silently_overwrite_a_decision(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine, digest, packet_id = committed_engine(os.path.join(workspace, ".edag"))
            common = {
                "expected_snapshot_digest": digest,
                "actor": "human:reviewer",
                "rationale": "First disposition.",
                "idempotency_key": "same-request-key",
            }
            engine.record_review_decision("thread", packet_id, action="approve", **common)
            with self.assertRaises(ReviewDecisionConflict):
                engine.record_review_decision(
                    "thread", packet_id, action="reject",
                    **{**common, "rationale": "Conflicting disposition."},
                )
            packet = next(
                item for item in engine.require("thread").review_packets
                if item.review_packet_id == packet_id
            )
            self.assertEqual(packet.status, HumanReviewStatus.APPROVED)


if __name__ == "__main__":
    unittest.main()
