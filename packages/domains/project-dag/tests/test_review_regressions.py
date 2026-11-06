"""Review lifecycle and durable retries through the canonical Engine."""
from concurrent.futures import ThreadPoolExecutor
import json
import unittest
from unittest.mock import patch

from evidence_dag.model import NodeStatus
from project_dag.judge import StubJudge
from project_dag.service import Engine
import test_compile as fixture


class ReviewRegressionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.WorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.engine, self.project = self.fixture.engine, self.fixture.project
        self.engine.configure_policy(self.project, {'autonomyMode': 'checkpointed',
            'checkpoints': ['claim_fragile'], 'actorId': 'human:reviewer'})
        snap = fixture.write_snapshot(self.fixture.sessions, 'review-regression',
                              [('Uncertain result', 'Single source')], node_status=NodeStatus.FRAGILE)
        self.engine.enqueue_update({'projectKey': self.project,
            'evidenceVector': [{'threadId': snap['threadId'], 'digest': snap['digest']}],
            'capturedScope': {'includedSessions': [snap['threadId']], 'excludedSessions': [], 'isolatedSessions': []},
            'reason': 'manual_immediate', 'priority': 5})
        self.engine.process_updates(self.project)
        view = self.engine.graph(self.project)
        self.digest, self.packet = view['snapshot']['digest'], view['reviewPackets'][0]
        self.engine.workflow.seal_snapshot(self.project, expected_head_digest=self.digest)

    def decide(self, action, key, **changes):
        return self.engine.record_review_result(self.project, self.packet['id'], {
            'action': action, 'actorId': 'human:reviewer', 'rationale': 'Reviewed original source and limitations.',
            'expectedSnapshotDigest': self.digest, 'idempotencyKey': key, **changes})

    def test_deferred_review_can_continue_and_preserves_decision_history(self):
        deferred = self.decide('defer', 'defer-1')
        approved = self.decide('approve', 'approve-1')
        decision = self.engine.workflow.decision(approved['humanResult']['decisionId'])
        self.assertEqual(approved['status'], 'approved')
        self.assertEqual(decision['supersedesDecisionId'], deferred['humanResult']['decisionId'])
        self.assertEqual(len(self.engine.store.q('SELECT * FROM decision_event WHERE review_id=?',
                                               (self.packet['id'],))), 2)
        self.assertEqual(self.engine.workflow.human_review_summary(self.project)['blockingPacketIds'], [])

    def test_request_evidence_retry_returns_original_receipt_and_conflict_rejects(self):
        first = self.decide('request_evidence', 'retry-1')
        self.assertEqual(self.decide('request_evidence', 'retry-1'), first)
        with self.assertRaisesRegex(ValueError, 'idempotencyKey'):
            self.decide('defer', 'retry-1')
        self.assertEqual(len(self.engine.store.q('SELECT * FROM decision_event WHERE review_id=?',
                                               (self.packet['id'],))), 1)
        self.assertFalse(self.engine.store.conn.in_transaction)

    def test_same_key_serializes_across_two_connections_and_survives_restart(self):
        other = Engine(self.engine.store.db_path, self.fixture.sessions, judge=StubJudge({}))
        payload = {'action': 'approve', 'actorId': 'human:reviewer', 'rationale': 'Independent review.',
                   'expectedSnapshotDigest': self.digest, 'idempotencyKey': 'parallel-1'}
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda engine: engine.record_review_result(
                    self.project, self.packet['id'], payload), [self.engine, other]))
            self.assertEqual(results[0], results[1])
            self.assertEqual(len(self.engine.store.q('SELECT * FROM approval_record')), 1)
        finally:
            other.store.close()
        restarted = Engine(self.engine.store.db_path, self.fixture.sessions, judge=StubJudge({}))
        try:
            replay = restarted.record_review_result(self.project, self.packet['id'], payload)
            self.assertEqual(replay, results[0])
        finally:
            restarted.store.close()

    def test_failed_approval_rolls_back_decision_approval_and_receipt(self):
        with patch.object(self.engine.workflow, '_append_review_event', side_effect=RuntimeError('injected failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected failure'):
                self.decide('approve', 'atomic-1')
        for table in ('decision_event', 'approval_record', 'review_decision_receipt'):
            self.assertEqual(self.engine.store.q1(f'SELECT COUNT(*) n FROM {table}')['n'], 0)
        self.assertEqual(self.engine.workflow.review_packets(self.project, self.digest)[0]['status'], 'pending')
        self.assertEqual(self.decide('approve', 'atomic-1')['status'], 'approved')

    def test_packet_refresh_retains_human_result_but_cannot_rebind_snapshot(self):
        requested = self.decide('request_evidence', 'projection-1')
        self.engine.workflow._persist_review_packet(self.project, self.digest, self.packet, '2026-10-31T00:00:00Z')
        self.engine.store.conn.commit()
        persisted = self.engine.workflow.review_packets(self.project, self.digest)[0]
        self.assertEqual(persisted['humanResult'], requested['humanResult'])
        persisted.pop('humanResult')
        self.engine.store.x('UPDATE review SET payload=? WHERE id=?', (json.dumps(persisted), self.packet['id']))
        self.engine.store.conn.commit()
        self.engine.workflow._persist_review_packet(self.project, self.digest, self.packet, '2026-10-31T00:00:01Z')
        self.engine.store.conn.commit()
        repaired = self.engine.workflow.review_packets(self.project, self.digest)[0]
        # A repaired projection uses the durable decision timestamp; the old UI
        # projection timestamp may have been captured just before that insert.
        self.assertTrue(repaired['humanResult']['recordedAt'])
        self.assertEqual({k: v for k, v in repaired['humanResult'].items() if k != 'recordedAt'},
                         {k: v for k, v in requested['humanResult'].items() if k != 'recordedAt'})
        with self.assertRaisesRegex(ValueError, 'another snapshot'):
            self.engine.workflow._persist_review_packet(self.project, 'project:changed', self.packet, 'later')
        self.engine.store.conn.rollback()

    def test_deferred_and_rejected_summary_agrees_with_actual_release_gate(self):
        self.engine.enqueue_audit({'projectKey': self.project, 'targetDigest': self.digest,
                                   'level': 'L2', 'reason': 'release_gate', 'priority': 20})
        audit = self.engine.process_audits(self.project)['audit']
        for action in ('defer', 'reject'):
            self.decide(action, action)
            summary = self.engine.workflow.human_review_summary(self.project)
            self.assertEqual(summary['pendingCount'], 0)
            self.assertEqual(summary['blockingPacketIds'], [self.packet['id']])
            release = self.engine.workflow.create_release(project_key=self.project,
                project_snapshot_digest=self.digest, expected_head_digest=self.digest,
                audit_digest=audit['digest'], created_by='human:reviewer', output_artifacts=[], requested_status='certified')
            self.assertEqual(release['certification_status'], 'blocked')
