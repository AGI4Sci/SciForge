"""Packet receipts exercise the production writer and authorized event read path."""
import os
import tempfile
import unittest
from dataclasses import replace

from evidence_dag.events import EventStore
from evidence_dag.model import HumanReviewStatus
from evidence_dag.service import Engine, ReviewDecisionConflict
from test_human_review import committed_engine


class ReviewReceiptTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.storage = os.path.realpath(self.workspace.name)
        self.engine, self.digest, self.packet_id = committed_engine(self.storage)

    def decide(self, action="approve", key="first", **changes):
        args = dict(action=action, expected_snapshot_digest=self.digest,
                    actor="human:ui-label", rationale="Original evidence only.",
                    idempotency_key=key)
        args.update(changes)
        return self.engine.record_review_decision("thread", self.packet_id, **args)

    def decisions(self):
        return self.engine.events(thread_id="thread", event_types=("HumanReviewDecisionRecorded",),
                                  limit=5000)

    def test_scope_is_server_packet_and_identity_and_timing_are_unknown(self):
        packet = self.engine.require("thread").review_packets[0]
        result = self.decide()
        receipt = result["reviewReceipt"]
        self.assertEqual(receipt["scope"], {
            "kind": "review-packet", "snapshotDigest": self.digest,
            "reviewPacketId": self.packet_id, "targetIds": list(packet.target_ids),
            "assessmentIds": list(packet.assessment_ids),
        })
        self.assertEqual(receipt["identity"], {
            "status": "unverified", "source": "caller-label", "principal": None,
        })
        self.assertEqual(receipt["timing"], {
            "status": "unknown", "elapsedMs": None, "activeMs": None,
        })
        self.assertIsNone(receipt["previousDecisionEventId"])
        self.assertEqual(self.decisions()[0]["payload"]["reviewReceipt"], receipt)
        with self.assertRaises(TypeError):
            self.decide(scope={"targetIds": ["client-forgery"]})
        self.assertEqual(len(self.decisions()), 1)

    def test_replay_does_not_self_link_or_roll_back_later_reject(self):
        for key in ("first", None):
            with self.subTest(key=key):
                approved = self.decide(key=key)
                self.assertEqual(self.decide(key=key)["event"], approved["event"])
                rejected = self.decide("reject", key="reject-" + str(key))
                self.assertEqual(rejected["reviewReceipt"]["previousDecisionEventId"],
                                 approved["event"]["eventId"])
                count = len(self.decisions())
                self.engine = Engine(storage_dir=self.storage)
                replay = self.decide(key=key)
                self.assertEqual(replay["event"], approved["event"])
                self.assertEqual(replay["reviewReceipt"], approved["reviewReceipt"])
                self.assertEqual(replay["reviewPacket"]["status"], "rejected")
                self.assertEqual(len(self.decisions()), count)

    def test_conflicting_request_and_stale_cas_never_append(self):
        self.decide()
        for changes in ({"action": "reject"}, {"actor": "another"},
                        {"rationale": "Different reason"},
                        {"expected_snapshot_digest": "sha256:" + "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(ReviewDecisionConflict):
                self.decide(**changes)
        self.assertEqual(len(self.decisions()), 1)

    def test_receipt_follows_existing_event_access_projection(self):
        result = self.decide()
        graph = self.engine.require("thread")
        graph.meta["scope"] = {"accessPolicy": {"read": False}}
        projected = self.decisions()[0]
        self.assertTrue(projected["accessRestricted"])
        self.assertNotIn("payload", projected)
        self.assertNotIn("eventId", projected)
        with self.assertRaises(PermissionError):
            self.decide("reject", key="restricted")
        self.assertEqual(self.engine._event_store.read(
            event_types=("HumanReviewDecisionRecorded",)), [result["event"]])

    def test_previous_link_is_scoped_to_thread_snapshot_and_packet(self):
        first = self.decide()
        original = first["decision"]
        for index, changes in enumerate((
            {"threadId": "other-thread"}, {"snapshotDigest": "other-snapshot"},
            {"reviewPacketId": "other-packet"},
        )):
            self.engine._event_store.append(
                "HumanReviewDecisionRecorded", aggregate_type="EvidenceThread",
                aggregate_id=changes.get("threadId", "thread"),
                idempotency_key=f"unrelated-{index}", payload={**original, **changes},
            )
        second = self.decide("reject", key="second")
        self.assertEqual(second["reviewReceipt"]["previousDecisionEventId"], first["event"]["eventId"])
        graph = self.engine.require("thread")
        graph.review_packets.append(replace(graph.review_packets[0], review_packet_id="another-packet"))
        result = self.engine.record_review_decision(
            "thread", "another-packet", action="approve", expected_snapshot_digest=self.digest,
            actor="label", rationale="Another packet.",
        )
        self.assertIsNone(result["reviewReceipt"]["previousDecisionEventId"])

    def test_legacy_event_bytes_and_snapshot_are_preserved_without_backfill(self):
        payload = {
            "threadId": "thread", "snapshotDigest": self.digest,
            "reviewPacketId": self.packet_id, "action": "approve",
            "actor": "human:ui-label", "rationale": "Original evidence only.",
            "checker": {"actorType": "human", "actor": "human:ui-label",
                        "method": "review-decision-api-v1", "authority": "override"},
        }
        legacy = self.engine._event_store.append(
            "HumanReviewDecisionRecorded", aggregate_type="EvidenceThread", aggregate_id="thread",
            idempotency_key="legacy", payload=payload,
        )
        event_path = self.engine._event_store.path
        snapshot_path = self.engine._path("thread")
        with open(event_path, "rb") as handle:
            before_events = handle.read()
        with open(snapshot_path, "rb") as handle:
            before_snapshot = handle.read()
        self.engine = Engine(storage_dir=self.storage)
        replay = self.decide(key="legacy")
        self.assertEqual(replay["reviewReceipt"]["scope"], {"kind": "unknown"})
        self.assertEqual(replay["event"], legacy)
        self.assertNotIn("reviewReceipt", self.decisions()[0]["payload"])
        with open(event_path, "rb") as handle:
            self.assertEqual(handle.read(), before_events)
        rejected = self.decide("reject", key="later")
        self.assertEqual(rejected["reviewReceipt"]["previousDecisionEventId"], legacy["eventId"])
        with open(event_path, "rb") as handle:
            self.assertTrue(handle.read().startswith(before_events))
        with open(snapshot_path, "rb") as handle:
            self.assertEqual(handle.read(), before_snapshot)

    def test_pagination_finds_previous_and_replay_and_restores_latest_decision(self):
        # Use the same EventStore without disk fsync costs for the large stream.
        self.engine._event_store = EventStore(None)
        for index in range(5001):
            self.engine._event_store.append(
                "HumanReviewDecisionRecorded", aggregate_type="EvidenceThread", aggregate_id="thread",
                idempotency_key=f"filler-{index}", payload={
                    "threadId": "thread", "snapshotDigest": "other", "reviewPacketId": "other",
                },
            )
        approved = self.decide()
        rejected = self.decide("reject", key="reject")
        self.assertEqual(rejected["reviewReceipt"]["previousDecisionEventId"], approved["event"]["eventId"])
        graph = self.engine.require("thread")
        graph.review_packets[0] = replace(graph.review_packets[0], status=HumanReviewStatus.PENDING)
        replay = self.decide()
        self.assertEqual(replay["event"], approved["event"])
        self.assertEqual(replay["reviewPacket"]["status"], "rejected")
        tail = self.engine.events(thread_id="thread", after_sequence=5001)
        self.assertEqual([event["eventId"] for event in tail],
                         [approved["event"]["eventId"], rejected["event"]["eventId"]])
        with self.assertRaises(ReviewDecisionConflict):
            self.decide(rationale="Conflict beyond first page")

    def test_filtered_events_scan_past_other_threads(self):
        self.engine._event_store = EventStore(None)
        for index in range(5001):
            self.engine._event_store.append(
                "HumanReviewDecisionRecorded", aggregate_type="EvidenceThread", aggregate_id="elsewhere",
                idempotency_key=f"filler-{index}", payload={"threadId": "elsewhere"},
            )
        result = self.decide()
        self.assertEqual(self.decisions(), [result["event"]])
        self.assertIsNone(result["reviewReceipt"]["previousDecisionEventId"])


if __name__ == "__main__":
    unittest.main()
