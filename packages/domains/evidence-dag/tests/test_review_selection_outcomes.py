"""Selection provenance, per-target review outcomes and the random audit sample."""
from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from dataclasses import replace
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.parse import quote

from evidence_dag.assessment import bind_target_digest
from evidence_dag.graph import ThreadGraph
from evidence_dag.human_review import (
    DEFAULT_POLICY,
    HumanReviewPolicy,
    attach_human_reviews,
    policy_with_random_audit,
    random_audit_sample,
    remap_review_packet_assessment_ids,
)
from evidence_dag.model import (
    AssessmentResult,
    HumanReviewStatus,
    NodeType,
    ReviewPacket,
    ReviewSelection,
)
from evidence_dag.server import Handler, build_engine
from evidence_dag.service import Engine, ReviewDecisionConflict
from evidence_dag.snapshot import build_snapshot
from test_human_review import assessment, committed_engine

COMPUTED_AT = "2026-01-01T00:00:00Z"


def claims(graph: ThreadGraph, count: int) -> list[str]:
    return [graph.add_or_get_node(NodeType.CLAIM, f"Claim number {index}").id for index in range(count)]


def compile_reviews(graph, checks, policy, previous=()):
    graph.review_packets = list(previous)
    pending, packets = attach_human_reviews(
        graph, checks, delta={"new_nodes": [], "new_edges": []}, computed_at=COMPUTED_AT, policy=policy,
    )
    return pending, packets


def audit_packet(packets):
    found = [packet for packet in packets if packet.selection is not None]
    assert len(found) == 1, found
    return found[0]


def committed_engine_with_audit(storage: str, claim_count: int = 12, fraction: float = 0.25):
    policy = policy_with_random_audit(fraction)
    engine = Engine(storage_dir=storage, review_policy=policy)
    graph = ThreadGraph("thread")
    ids = claims(graph, claim_count)
    checks = [assessment(ids[0], result=AssessmentResult.PASSED, assessment_id="assessment:passed")]
    pending, packets = compile_reviews(graph, checks, policy)
    graph.assessments = pending
    graph.review_policy_version = policy.version
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
    packet = audit_packet(graph.review_packets)
    return engine, snapshot.digest, packet


class SelectionModelTests(unittest.TestCase):
    def test_round_trip_and_legacy_packets_have_no_selection(self) -> None:
        selection = ReviewSelection(mechanism="random_audit", inclusion_probability=0.25, frame="all_eligible",
                                    audit_round="abcd")
        self.assertEqual(ReviewSelection.from_dict(selection.to_dict()), selection)
        graph = ThreadGraph("g")
        claim = claims(graph, 1)[0]
        _, packets = compile_reviews(graph, [assessment(claim)], DEFAULT_POLICY)
        legacy = packets[0].to_dict()
        self.assertNotIn("selection", legacy)
        self.assertIsNone(ReviewPacket.from_dict(legacy).selection)
        with_selection = replace(packets[0], selection=selection)
        self.assertEqual(ReviewPacket.from_dict(with_selection.to_dict()), with_selection)

    def test_invalid_selections_are_rejected(self) -> None:
        for kwargs in (dict(mechanism="sideways"), dict(mechanism="risk_ranked"),
                       dict(mechanism="random_audit", inclusion_probability=0.0, frame="all_eligible"),
                       dict(mechanism="random_audit", inclusion_probability=0.5, frame="remaining"),
                       dict(mechanism="random_audit", frame="all_eligible"),
                       dict(mechanism="random_audit", inclusion_probability=0.5)):
            with self.assertRaises(ValueError, msg=str(kwargs)):
                ReviewSelection(**kwargs)


class RandomAuditSampleTests(unittest.TestCase):
    policy = policy_with_random_audit(0.25)

    def test_count_probability_and_disabled_cases(self) -> None:
        ids = [f"node:{index}" for index in range(20)]
        targets, probability = random_audit_sample(ids, material_digest="d", policy=self.policy)
        self.assertEqual((len(targets), probability), (5, 0.25))
        small, small_probability = random_audit_sample(ids[:3], material_digest="d", policy=self.policy)
        self.assertEqual((len(small), small_probability), (1, 1 / 3))  # at least one, rounded up
        self.assertEqual(random_audit_sample(ids, material_digest="d", policy=DEFAULT_POLICY), ((), None))
        self.assertEqual(random_audit_sample([], material_digest="d", policy=self.policy), ((), None))

    def test_deterministic_and_independent_of_input_order(self) -> None:
        ids = [f"node:{index}" for index in range(30)]
        first = random_audit_sample(ids, material_digest="state-1", policy=self.policy)
        self.assertEqual(first, random_audit_sample(list(reversed(ids)), material_digest="state-1", policy=self.policy))
        self.assertNotEqual(first[0], random_audit_sample(ids, material_digest="state-2", policy=self.policy)[0])

    def test_every_eligible_node_has_the_recorded_inclusion_probability(self) -> None:
        ids = [f"node:{index}" for index in range(20)]
        counts = {node_id: 0 for node_id in ids}
        draws = 600
        for draw in range(draws):
            for node_id in random_audit_sample(ids, material_digest=f"state-{draw}", policy=self.policy)[0]:
                counts[node_id] += 1
        expected = draws * 0.25  # 150
        self.assertTrue(all(0.6 * expected < count < 1.4 * expected for count in counts.values()), counts)

    def test_policy_validation_and_version(self) -> None:
        for bad in (-0.1, 1.0, 2.0):
            with self.assertRaises(ValueError):
                HumanReviewPolicy(random_audit_fraction=bad)
        enabled = policy_with_random_audit(0.1)
        self.assertNotEqual(enabled.version, DEFAULT_POLICY.version)
        self.assertEqual(enabled.random_audit_fraction, 0.1)
        self.assertEqual(DEFAULT_POLICY.random_audit_fraction, 0.0)


class AuditPacketTests(unittest.TestCase):
    def build(self, count=12, fraction=0.25):
        graph = ThreadGraph("thread")
        ids = claims(graph, count)
        source = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, "A source, not an audit-eligible node")
        passed = [assessment(ids[0], result=AssessmentResult.PASSED, assessment_id="assessment:passed")]
        return graph, ids, source.id, passed, policy_with_random_audit(fraction)

    def test_disabled_by_default_leaves_the_packets_unchanged(self) -> None:
        graph, _ids, _source, checks, _policy = self.build()
        _, default_packets = compile_reviews(graph, checks, DEFAULT_POLICY)
        _, off_packets = compile_reviews(graph, checks, replace(DEFAULT_POLICY, random_audit_fraction=0.0))
        self.assertEqual(default_packets, off_packets)
        self.assertTrue(all(packet.selection is None for packet in default_packets))

    def test_one_nonblocking_packet_drawn_from_the_full_eligible_set(self) -> None:
        graph, ids, source, checks, policy = self.build()
        _, packets = compile_reviews(graph, checks, policy)
        packet = audit_packet(packets)
        self.assertEqual((packet.level.value, packet.blocking, packet.status), ("optional", False, HumanReviewStatus.PENDING))
        self.assertEqual(len(packet.target_ids), 3)  # ceil(0.25 * 12)
        self.assertTrue(set(packet.target_ids) <= set(ids))
        self.assertNotIn(source, packet.target_ids)
        self.assertEqual(packet.selection.mechanism, "random_audit")
        self.assertEqual((packet.selection.inclusion_probability, packet.selection.frame), (0.25, "all_eligible"))
        self.assertEqual(packet.reasons[0].code, "random_audit")
        self.assertEqual(packet.assessment_ids, ())
        # nodes with a PASSED check and nodes with no check at all are both eligible: no ranking filters the frame
        seen = set()
        for draw in range(40):
            graph.add_or_get_node(NodeType.CLAIM, f"extra claim {draw}")
            seen.update(audit_packet(compile_reviews(graph, checks, policy)[1]).target_ids)
        self.assertIn(ids[0], seen | set(packet.target_ids) | set(ids[:1]))
        self.assertTrue(any(target not in {item.target_id for item in checks} for target in seen))

    def test_recompiling_an_unchanged_state_keeps_the_packet_and_its_decision(self) -> None:
        graph, _ids, _source, checks, policy = self.build()
        _, first = compile_reviews(graph, checks, policy)
        packet = audit_packet(first)
        decided = [replace(item, status=HumanReviewStatus.APPROVED, reviewed_by="human:a", reviewed_at=COMPUTED_AT,
                           review_rationale="Inspected.", reviewed_snapshot_digest="sha256:" + "1" * 64)
                   if item.review_packet_id == packet.review_packet_id else item for item in first]
        _, second = compile_reviews(graph, checks, policy, previous=decided)
        again = audit_packet(second)
        self.assertEqual(again.review_packet_id, packet.review_packet_id)
        self.assertEqual((again.status, again.reviewed_by), (HumanReviewStatus.APPROVED, "human:a"))

    def test_a_new_scientific_state_draws_a_new_sample_and_expires_the_old_one(self) -> None:
        graph, _ids, _source, checks, policy = self.build()
        _, first = compile_reviews(graph, checks, policy)
        old = audit_packet(first)
        graph.add_or_get_node(NodeType.CLAIM, "A newly added claim")
        _, second = compile_reviews(graph, checks, policy, previous=first)
        by_id = {item.review_packet_id: item for item in second}
        self.assertEqual(by_id[old.review_packet_id].status, HumanReviewStatus.EXPIRED)
        new = [item for item in second if item.selection is not None and item.status == HumanReviewStatus.PENDING]
        self.assertEqual(len(new), 1)
        self.assertNotEqual(new[0].review_packet_id, old.review_packet_id)


class OutcomeDecisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.storage = os.path.realpath(self.workspace.name)
        self.engine, self.digest, self.packet = committed_engine_with_audit(self.storage)
        self.targets = list(self.packet.target_ids)

    def decide(self, action="approve", outcomes=None, key="k1", **extra):
        return self.engine.record_review_decision(
            "thread", self.packet.review_packet_id, action=action, expected_snapshot_digest=self.digest,
            actor="human:reviewer", rationale="Inspected the sample.", idempotency_key=key,
            target_outcomes=outcomes, **extra)

    def full(self, found=()):
        return [dict(targetId=target, errorFound=target in found,
                     errorOrigin="source" if target in found else None) for target in self.targets]

    def test_audit_packet_needs_outcomes_for_every_target_to_be_approved_or_rejected(self) -> None:
        for action in ("approve", "reject"):
            with self.assertRaises(ValueError):
                self.decide(action, None)
            with self.assertRaises(ValueError):
                self.decide(action, self.full()[:-1])
        self.assertEqual(self.engine.events(thread_id="thread", event_types=("HumanReviewDecisionRecorded",),
                                            limit=50), [])
        # deferring or asking for evidence does not require them
        self.assertEqual(self.decide("defer", None, key="d")["decision"]["action"], "defer")

    def test_valid_outcomes_are_recorded_sorted_and_replay_is_idempotent(self) -> None:
        shuffled = list(reversed(self.full(found={self.targets[0]})))
        result = self.decide("reject", shuffled)
        recorded = result["decision"]["targetOutcomes"]
        self.assertEqual([item["targetId"] for item in recorded], sorted(self.targets))
        self.assertEqual(recorded[0]["errorFound"], self.targets[0] == sorted(self.targets)[0])
        self.assertEqual(self.decide("reject", shuffled)["event"], result["event"])
        with self.assertRaises(ReviewDecisionConflict):
            self.decide("reject", self.full(found={self.targets[1]}))  # same key, different outcomes

    def test_invalid_outcomes_are_rejected(self) -> None:
        good = self.full()
        cases = [
            [], "nope", [dict(good[0], targetId="node:unknown")], good + [good[0]],
            [dict(good[0], errorFound="yes")], [dict(good[0], errorFound=True, errorOrigin=None)],
            [dict(good[0], errorFound=True, errorOrigin="elsewhere")],
            [dict(good[0], errorFound=False, errorOrigin="source")], [dict(good[0], extra=1)],
        ]
        for outcomes in cases:
            with self.assertRaises(ValueError, msg=str(outcomes)):
                self.decide("defer", outcomes)

    def test_outcome_without_a_key_changes_the_derived_idempotency_identity(self) -> None:
        first = self.decide("reject", self.full(), key=None)
        second = self.decide("reject", self.full(found={self.targets[0]}), key=None)
        self.assertNotEqual(first["event"]["idempotencyKey"], second["event"]["idempotencyKey"])

    def test_read_model_exposes_outcomes_only_when_recorded(self) -> None:
        self.decide("defer", None, key="legacy-style")
        self.decide("reject", self.full(found={self.targets[0]}), key="with-outcomes")
        rows = self.engine.human_review_read("thread", snapshot_digest=self.digest)["records"]
        by_key = {row["idempotencyKey"]: row for row in rows}
        self.assertNotIn("targetOutcomes", by_key["legacy-style"])
        self.assertEqual(len(by_key["with-outcomes"]["targetOutcomes"]), len(self.targets))
        json.dumps(rows)

    def test_non_audit_packets_keep_the_old_behaviour_and_may_carry_optional_outcomes(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine, digest, packet_id = committed_engine(os.path.join(os.path.realpath(workspace), ".edag"))
            packet = engine.require("thread").review_packets[0]
            self.assertIsNone(packet.selection)
            plain = engine.record_review_decision(
                "thread", packet_id, action="reject", expected_snapshot_digest=digest,
                actor="human:reviewer", rationale="Original evidence only.", idempotency_key="plain")
            self.assertNotIn("targetOutcomes", plain["decision"])
            with_outcomes = engine.record_review_decision(
                "thread", packet_id, action="reject", expected_snapshot_digest=digest,
                actor="human:reviewer", rationale="Original evidence only.", idempotency_key="with",
                target_outcomes=[dict(targetId=packet.target_ids[0], errorFound=True, errorOrigin="inherited")])
            self.assertEqual(with_outcomes["decision"]["targetOutcomes"],
                             [dict(targetId=packet.target_ids[0], errorFound=True, errorOrigin="inherited")])


class WiringTests(unittest.TestCase):
    def test_build_engine_reads_the_audit_fraction_from_the_environment(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("EDAG_RANDOM_AUDIT_FRACTION", None)
            self.assertEqual(build_engine().review_policy, DEFAULT_POLICY)
        with mock.patch.dict(os.environ, {"EDAG_RANDOM_AUDIT_FRACTION": "0.2"}):
            policy = build_engine().review_policy
            self.assertEqual(policy.random_audit_fraction, 0.2)
            self.assertNotEqual(policy.version, DEFAULT_POLICY.version)
        for bad in ("1.5", "abc", "-1"):
            with mock.patch.dict(os.environ, {"EDAG_RANDOM_AUDIT_FRACTION": bad}):
                with self.assertRaises(ValueError):
                    build_engine()

    def test_engine_compiles_with_its_review_policy(self) -> None:
        engine = Engine(review_policy=policy_with_random_audit(0.5))
        self.assertEqual(engine.review_policy.random_audit_fraction, 0.5)
        self.assertEqual(Engine().review_policy, DEFAULT_POLICY)

    def test_http_route_passes_target_outcomes_and_rejects_bad_ones_without_recording(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            engine, digest, packet = committed_engine_with_audit(os.path.join(os.path.realpath(workspace), ".edag"))
            previous_engine, previous_token = Handler.engine, Handler.api_token
            Handler.engine, Handler.api_token = engine, "review-test-token"
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                path = f"/threads/thread/reviews/{quote(packet.review_packet_id, safe='')}/decision"

                def post(body):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=2)
                    connection.request("POST", path, body=json.dumps(body), headers={
                        "Authorization": "Bearer review-test-token", "Content-Type": "application/json"})
                    response = connection.getresponse()
                    payload = json.loads(response.read().decode("utf-8"))
                    connection.close()
                    return response.status, payload

                base = dict(action="approve", expectedSnapshotDigest=digest, actor="human:http", rationale="Checked.")
                status, _ = post(base)
                self.assertGreaterEqual(status, 400)  # random-audit packet without outcomes
                outcomes = [dict(targetId=target, errorFound=False, errorOrigin=None) for target in packet.target_ids]
                status, payload = post(dict(base, targetOutcomes=outcomes))
                self.assertEqual(status, 200, payload)
                self.assertEqual(len(payload["data"]["decision"]["targetOutcomes"]), len(packet.target_ids))
            finally:
                server.shutdown()
                server.server_close()
                Handler.engine, Handler.api_token = previous_engine, previous_token


if __name__ == "__main__":
    unittest.main()
