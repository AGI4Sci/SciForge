import os
import tempfile
import unittest
from unittest.mock import patch
from evidence_dag.historical_read import EVENT_LIMIT
from test_human_review import committed_engine
from test_audit_read_binding import publish, REF


class ReviewReadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.engine, self.digest, self.packet = committed_engine(os.path.realpath(self.tmp.name))

    def decide(self, action="approve", key="one"):
        return self.engine.record_review_decision("thread", self.packet, action=action,
            expected_snapshot_digest=self.digest, actor="fixture-label", rationale="Only this scope.", idempotency_key=key)

    def read(self, **kwargs):
        return self.engine.human_review_read("thread", snapshot_digest=self.digest, **kwargs)

    def test_order_cutoff_receipt_and_idempotent_read_without_writes(self):
        first = self.decide()
        second = self.decide("reject", "two")
        self.decide()
        before = self.engine._event_store.read()
        full = self.read()
        self.assertEqual(full["status"], "available")
        self.assertNotIn("asOf", full)
        self.assertEqual([r["eventId"] for r in full["records"]], [first["event"]["eventId"], second["event"]["eventId"]])
        self.assertEqual(full["records"][1]["reviewReceipt"], second["reviewReceipt"])
        self.assertEqual(len(self.read(as_of=first["event"]["occurredAt"])["records"]), 1)
        self.assertEqual(self.read(as_of="2000-01-01T00:00:00Z")["records"], [])
        self.assertEqual(before, self.engine._event_store.read())
        with self.assertRaises(ValueError):
            self.read(as_of="2026-01-01")

    def test_later_opinions_remain_bound_after_new_publication(self):
        self.decide()
        publish(self.engine, 2, "Later claim")
        result = self.read()
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["records"][0]["snapshotDigest"], self.digest)

    def test_legacy_receipt_stays_unknown_and_partial(self):
        payload = {"threadId": "thread", "snapshotDigest": self.digest, "reviewPacketId": self.packet,
                   "action": "defer", "actor": "old-label", "rationale": "No stored scope"}
        event = self.engine._event_store.append("HumanReviewDecisionRecorded", aggregate_type="EvidenceThread",
            aggregate_id="thread", idempotency_key="legacy", payload=payload)
        result = self.read()
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["records"][0]["reviewReceipt"]["scope"], {"kind": "unknown"})
        self.assertEqual(self.engine._event_store.read()[-1], event)

    def test_exact_material_scope_never_reconstructed_from_current_packet(self):
        self.digest = publish(self.engine, 2, "Pinned material", REF)
        self.decide()
        result = self.read(artifact_ref=REF)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["records"][0]["reviewReceipt"]["scope"]["targetIds"], list(self.engine.require("thread").review_packets[0].target_ids))
        with self.assertRaises(ValueError):
            self.read(artifact_ref={**REF, "versionId": "artifact-version:other"})

    def test_duplicates_and_bounded_events_are_explicit(self):
        event = self.decide()["event"]
        with patch.object(self.engine._event_store, "read", return_value=[event, event]):
            self.assertEqual(len(self.read()["records"]), 1)
        with patch.object(self.engine._event_store, "read", return_value=[event] * (EVENT_LIMIT + 1)):
            result = self.read()
        self.assertEqual(len(result["records"]), 1)
        self.assertIn("event_scan_bounded", result["reasons"])
