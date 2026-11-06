"""Approval cannot silently cross a scientific-input change."""
from dataclasses import replace
import json
import os
import tempfile
import unittest

from evidence_dag.human_review import attach_human_reviews, human_review_summary
from evidence_dag.model import EdgeRel, HumanReviewStatus, NodeType
from evidence_dag.service import Engine
from test_human_review import committed_engine, assessment
from test_incremental_pipeline import RecordingLLM, _command


class ReviewMaterialTests(unittest.TestCase):
    def test_material_change_reopens_review_but_unchanged_recompute_preserves_it(self):
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            engine, digest, packet_id = committed_engine(root)
            engine.record_review_decision('thread', packet_id, action='approve',
                expected_snapshot_digest=digest, actor='human:reviewer', rationale='Original evidence only.')
            graph = engine.require('thread')
            _, unchanged = attach_human_reviews(graph, [], delta={}, computed_at='later')
            self.assertEqual(next(p for p in unchanged if p.review_packet_id == packet_id).status,
                             HumanReviewStatus.APPROVED)
            target = next(iter(graph.nodes.values()))
            source = graph.add_or_get_node(NodeType.SOURCE_ASSERTION, 'New contradictory evidence')
            edge = graph.add_edge(source.id, target.id, EdgeRel.CONTRADICTS)
            check = replace(assessment(target.id), assessment_id='new-check', rationale='New material.')
            _, packets = attach_human_reviews(graph, [check],
                delta={'new_nodes': [source.id], 'new_edges': [edge.id]}, computed_at='later-again')
            current = [p for p in packets if p.status == HumanReviewStatus.PENDING]
            self.assertTrue(current)
            self.assertTrue(any(p.blocking for p in current))
            self.assertNotIn(packet_id, [p.review_packet_id for p in current])
            self.assertEqual(next(p for p in packets if p.review_packet_id == packet_id).status,
                             HumanReviewStatus.APPROVED)  # old audit record retained

    def test_incremental_update_reopens_even_when_no_new_assessment_is_appended(self):
        # Full extraction -> verification -> commit -> human approval -> update.
        # The second input adds material without changing the source's A0 verdict.
        first = json.dumps({'nodes': [{'tmp_id': 's', 'type': 'source_assertion',
                                      'content': 'Original evidence', 'trace_ref': 'one'}], 'edges': []})
        second = json.dumps({'nodes': [{'tmp_id': 'e', 'type': 'reasoning',
                                       'content': 'New assay context', 'trace_ref': 'two'}], 'edges': []})
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            storage = os.path.join(root, '.edag')
            engine = Engine(RecordingLLM([first, second]), storage_dir=storage)
            initial = engine.update(**_command(root, watermark='1',
                trace=[{'id': 'one', 'type': 'message', 'content': 'Original evidence'}]))
            graph = engine.require('thread')
            packet = next(p for p in graph.review_packets if p.blocking)
            engine.record_review_decision('thread', packet.review_packet_id, action='approve',
                expected_snapshot_digest=initial['snapshot']['digest'], actor='human:reviewer', rationale='Only original material.')
            checks_before = len(graph.assessments)
            updated = engine.update(**_command(root, watermark='2',
                trace=[{'id': 'two', 'type': 'message', 'content': 'New assay context'}]))
            graph = engine.require('thread')
            self.assertNotEqual(initial['snapshot']['digest'], updated['snapshot']['digest'])
            self.assertEqual(len(graph.assessments), checks_before)
            self.assertEqual(human_review_summary(graph)['gateStatus'], 'blocked')
            new_packet = next(p for p in graph.review_packets if p.blocking)
            self.assertNotEqual(new_packet.review_packet_id, packet.review_packet_id)
            self.assertEqual(new_packet.status, HumanReviewStatus.PENDING)
            restarted = Engine(storage_dir=storage)
            self.assertEqual(human_review_summary(restarted.require('thread'))['gateStatus'], 'blocked')
