from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from project_dag.service import Engine
from test_compile import make_judge, write_snapshot


class FingerprintFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.realpath(self.tmp.name)
        self.db = os.path.join(self.path, "project.db")
        self.engine = Engine(self.db, self.path, judge=make_judge())
        self.addCleanup(self.engine.store.close)
        self.project = "path:" + self.path
        self.engine.create_goal(self.project, "Goal")
        self.engine.process_updates(self.project)
        self.v1 = write_snapshot(self.path, "session-freshness", [("Finding one", "Source one")])
        self._enqueue(self.engine, self.v1)
        self.engine.process_updates(self.project)
        self.old = self.engine.workflow.latest_snapshot(self.project)

    def _enqueue(self, engine, snapshot):
        return engine.enqueue_update({
            "projectKey": self.project,
            "evidenceVector": [{"threadId": snapshot["threadId"], "digest": snapshot["digest"]}],
            "capturedScope": {
                "includedSessions": [snapshot["threadId"]],
                "excludedSessions": [], "isolatedSessions": [],
            },
            "reason": "manual_immediate",
        })

    def _invalidate(self, **extra):
        return self.engine.mark_invalidation({
            "projectKey": self.project,
            "reason": "upstream_changed",
            "changedFields": ["evidenceVector"],
            **extra,
        })

    def test_unchanged_notification_is_deduped(self):
        self._invalidate()
        self.assertIsNone(self.engine.derive_on_open(self.project))
        self.assertFalse(self.engine.invalidation(self.project)["stale"])

    def test_sealed_accepted_vector_wins_over_older_live_pointer(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        self._enqueue(self.engine, v2)
        self.engine.process_updates(self.project)
        accepted = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(accepted["evidenceVector"][0]["digest"], v2["digest"])

        # The live/latest pointer can lag a formally accepted immutable
        # Evidence Snapshot because seal_closure deliberately does not publish
        # it. Freshness must resolve the accepted digest, not re-select live.
        from evidence_dag.snapshot_storage import atomic_publish_latest
        atomic_publish_latest(
            self.engine.reader._historical_path(v2["threadId"], self.v1["digest"]),
            self.engine.reader._path(v2["threadId"]),
        )
        self._invalidate()
        self.engine.derive_on_open(self.project)
        self.assertFalse(self.engine.invalidation(self.project)["stale"])

    def test_true_v3_change_with_explicit_desired_stays_stale(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        self._enqueue(self.engine, v2)
        self.engine.process_updates(self.project)
        v3 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed again", "Source changed again")], version=3)
        vector = [{"threadId": v3["threadId"], "digest": v3["digest"]}]
        _, desired = self.engine.workflow._desired_identity(
            self.project, vector, self.old["capturedScope"], self.old["autonomyMode"])
        self._invalidate(desiredFingerprint=desired)
        self.engine.derive_on_open(self.project)
        invalidation = self.engine.invalidation(self.project)
        self.assertTrue(invalidation["stale"])
        self.assertEqual(invalidation["desiredFingerprint"], desired)

    def test_new_evidence_head_remains_stale(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        self._invalidate()
        self.engine.derive_on_open(self.project)
        self.assertTrue(self.engine.invalidation(self.project)["stale"])

    def test_explicit_desired_fingerprint_is_not_erased(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        vector = [{"threadId": v2["threadId"], "digest": v2["digest"]}]
        _, desired = self.engine.workflow._desired_identity(
            self.project, vector, self.old["capturedScope"], self.old["autonomyMode"])
        self._invalidate(desiredFingerprint=desired)
        self.engine.derive_on_open(self.project)
        invalidation = self.engine.invalidation(self.project)
        self.assertTrue(invalidation["stale"])
        self.assertEqual(invalidation["desiredFingerprint"], desired)

    def test_accepted_new_vector_is_not_replaced_on_open(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        receipt = self._enqueue(self.engine, v2)
        self.engine.derive_on_open(self.project)
        invalidation = self.engine.invalidation(self.project)
        self.assertTrue(invalidation["stale"])
        self.assertEqual(invalidation["desiredFingerprint"], receipt["desiredFingerprint"])

    def test_concurrent_accept_wins_cas(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        self._invalidate()
        other = Engine(self.db, self.path, judge=make_judge())
        self.addCleanup(other.store.close)
        real = self.engine.workflow._desired_identity
        accepted = []

        def interleave(*args, **kwargs):
            result = real(*args, **kwargs)
            accepted.append(self._enqueue(other, v2))
            return result

        with patch.object(self.engine.workflow, "_desired_identity", side_effect=interleave):
            self.engine.derive_on_open(self.project)
        invalidation = self.engine.invalidation(self.project)
        self.assertTrue(invalidation["stale"])
        self.assertEqual(invalidation["desiredFingerprint"], accepted[0]["desiredFingerprint"])

    def test_open_preserves_latest_accepted_receipt_over_older_job(self):
        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        receipt = self._enqueue(self.engine, v2)
        result = self.engine.derive_on_open(self.project)
        self.assertIsNotNone(result)
        job = self.engine.workflow.job(receipt["jobId"])
        self.assertEqual(
            job["desiredEvidenceVector"],
            [{"threadId": v2["threadId"], "digest": v2["digest"]}],
        )
        self.assertEqual(result["desiredFingerprint"], receipt["desiredFingerprint"])

    def _publish_during_head_read(self, notification_order):
        from evidence_dag.snapshot_storage import atomic_publish_latest

        v2 = write_snapshot(self.path, "session-freshness",
                            [("Finding changed", "Source changed")], version=2)
        current_path = self.engine.reader._path(v2["threadId"])
        old_path = self.engine.reader._historical_path(v2["threadId"], self.v1["digest"])
        new_path = self.engine.reader._historical_path(v2["threadId"], v2["digest"])
        atomic_publish_latest(old_path, current_path)
        self._invalidate()
        real_load = self.engine.reader.load
        events = []

        def interleave(*args, **kwargs):
            result = real_load(*args, **kwargs)
            if kwargs.get("expected_digest") is None and len(args) == 1 and not events:
                events.append("read_v1")
                if notification_order == "before_publish":
                    self._invalidate()
                    events.append("invalidate")
                atomic_publish_latest(new_path, current_path)
                events.append("publish_v2")
                if notification_order == "after_publish":
                    self._invalidate()
                    events.append("invalidate")
            return result

        with patch.object(self.engine.reader, "load", side_effect=interleave):
            self.assertIsNone(self.engine.derive_on_open(self.project))
        self.assertEqual(real_load(v2["threadId"])[1].digest, v2["digest"])
        self.assertEqual(self.engine.workflow.latest_snapshot(self.project)["digest"], self.old["digest"])
        self.assertTrue(events, "real current-head reader must be reached")
        self.assertTrue(self.engine.invalidation(self.project)["stale"], events)
        return events

    def test_atomic_publish_after_head_read_preserves_stale(self):
        self.assertEqual(self._publish_during_head_read(None), ["read_v1", "publish_v2"])

    def test_invalidation_before_publish_after_head_read_preserves_stale(self):
        self.assertEqual(self._publish_during_head_read("before_publish"),
                         ["read_v1", "invalidate", "publish_v2"])

    def test_invalidation_after_publish_after_head_read_preserves_stale(self):
        self.assertEqual(self._publish_during_head_read("after_publish"),
                         ["read_v1", "publish_v2", "invalidate"])

    def test_publish_before_transaction_revalidation_rolls_back_exact_invalidation(self):
        from evidence_dag.snapshot_storage import atomic_publish_latest
        v2 = write_snapshot(self.path, "session-freshness", [("Changed", "Changed")], version=2)
        current_path = self.engine.reader._path(v2["threadId"])
        atomic_publish_latest(self.engine.reader._historical_path(v2["threadId"], self.v1["digest"]), current_path)
        self._invalidate()
        before = self.engine.invalidation(self.project)
        real_load = self.engine.reader.load
        reads = []

        def interleave(*args, **kwargs):
            if len(args) == 1 and kwargs.get("expected_digest") is None:
                reads.append(self.engine.store.conn.in_transaction)
                if len(reads) == 2:
                    atomic_publish_latest(self.engine.reader._historical_path(v2["threadId"], v2["digest"]), current_path)
            return real_load(*args, **kwargs)

        with patch.object(self.engine.reader, "load", side_effect=interleave):
            self.engine.derive_on_open(self.project)
        self.assertEqual(reads, [False, True])
        self.assertEqual(self.engine.invalidation(self.project), before)
        self.assertFalse(self.engine.store.conn.in_transaction)

    def test_revalidation_failure_rolls_back_clear(self):
        self._invalidate()
        before = self.engine.invalidation(self.project)
        real_load = self.engine.reader.load
        reads = []

        def interleave(*args, **kwargs):
            if len(args) == 1 and kwargs.get("expected_digest") is None:
                reads.append(True)
                if len(reads) == 2:
                    raise OSError("head became unavailable during validation")
            return real_load(*args, **kwargs)

        with patch.object(self.engine.reader, "load", side_effect=interleave):
            self.engine.derive_on_open(self.project)
        self.assertEqual(len(reads), 2)
        self.assertEqual(self.engine.invalidation(self.project), before)
        self.assertFalse(self.engine.store.conn.in_transaction)

    def test_publish_after_final_read_requires_and_preserves_later_notification(self):
        from evidence_dag.snapshot_storage import atomic_publish_latest
        v2 = write_snapshot(self.path, "session-freshness", [("Changed", "Changed")], version=2)
        current_path = self.engine.reader._path(v2["threadId"])
        atomic_publish_latest(self.engine.reader._historical_path(v2["threadId"], self.v1["digest"]), current_path)
        self._invalidate()
        real_load = self.engine.reader.load
        reads = []

        def interleave(*args, **kwargs):
            result = real_load(*args, **kwargs)
            if len(args) == 1 and kwargs.get("expected_digest") is None:
                reads.append(True)
                if len(reads) == 2:
                    atomic_publish_latest(self.engine.reader._historical_path(v2["threadId"], v2["digest"]), current_path)
            return result

        with patch.object(self.engine.reader, "load", side_effect=interleave):
            self.engine.derive_on_open(self.project)
        self.assertEqual(len(reads), 2, "bounded two-pass validation, no retry")
        # Document the non-atomic limit instead of claiming all TOCTOU is gone.
        self.assertFalse(self.engine.invalidation(self.project)["stale"])
        self.assertEqual(real_load(v2["threadId"])[1].digest, v2["digest"])
        other = Engine(self.db, self.path, judge=make_judge())
        self.addCleanup(other.store.close)
        other.mark_invalidation({"projectKey": self.project, "reason": "upstream_changed",
                                 "changedFields": ["evidenceVector"]})
        self.assertTrue(self.engine.invalidation(self.project)["stale"])
        self.engine.derive_on_open(self.project)
        self.assertTrue(self.engine.invalidation(self.project)["stale"])

    def test_unreadable_current_head_fails_closed(self):
        self._invalidate()
        current_file = next(
            os.path.join(self.path, name) for name in os.listdir(self.path)
            if name.endswith(".prov.json")
        )
        os.remove(current_file)
        self.engine.derive_on_open(self.project)
        self.assertTrue(self.engine.invalidation(self.project)["stale"])


if __name__ == "__main__":
    unittest.main()
