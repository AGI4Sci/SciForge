"""Explicit submitted claims survive the canonical immutable closure boundary."""
import unittest
import os
import tempfile
from test_incremental_pipeline import _delta_envelope
from evidence_dag.graph import ThreadGraph
from evidence_dag import service


def submitted_item(claim):
    ref = claim['sources'][0]['ref']
    return {'kind': 'sciforge.claim-submission.v1', 'claims': [claim],
            'evidenceArtifactVersions': {'status': 'ready', 'lifecycleEvents': [], 'versions': [
                {'ref': ref, 'kind': 'dataset', 'locator': '/original/source.txt',
                 'observedAt': '2026-11-20T00:00:00Z'}]}}


class ClaimSubmissionTests(unittest.TestCase):
    def test_unrelated_or_malformed_projection_cannot_supply_submission_source(self):
        ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
               'contentDigest': 'a' * 64, 'byteLength': 4, 'mediaType': 'text/plain',
               'availability': 'available', 'retention': 'snapshot',
               'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
        claim = {'id': 'claim:explicit', 'text': 'Observation.', 'reviewStatus': 'pending',
                 'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
        for projection in [None, [], {'status': 'pending', 'reason': 'not ready'},
                           {'status': 'ready', 'versions': {}, 'lifecycleEvents': []}]:
            with self.subTest(projection=projection):
                unrelated = submitted_item(claim)
                unrelated['kind'] = 'unrelated-event'
                submission = submitted_item(claim)
                submission['evidenceArtifactVersions'] = projection
                with self.assertRaisesRegex(ValueError, 'authoritative source projection'):
                    service._replay_submitted_claims(ThreadGraph('thread'), [{'delta': {
                        'createdAt': '2026-11-20T00:00:00Z',
                        'payload': {'trace': [unrelated, submission]}}}])

    def test_conflicting_projection_identity_metadata_is_rejected(self):
        ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
               'contentDigest': 'a' * 64, 'byteLength': 4, 'mediaType': 'text/plain',
               'availability': 'available', 'retention': 'snapshot',
               'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
        claim = {'id': 'claim:explicit', 'text': 'Observation.', 'reviewStatus': 'pending',
                 'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
        for field, value in [('kind', 'image'), ('locator', '/different/source.txt')]:
            with self.subTest(field=field):
                first, second = submitted_item(claim), submitted_item(claim)
                second['evidenceArtifactVersions']['versions'][0][field] = value
                with self.assertRaisesRegex(ValueError, 'source projection metadata conflict'):
                    service._replay_submitted_claims(ThreadGraph('thread'), [{'delta': {
                        'createdAt': '2026-11-20T00:00:00Z', 'payload': {'trace': [first, second]}}}])

    def test_submission_without_authoritative_source_metadata_is_rejected(self):
        graph = ThreadGraph('thread')
        ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
               'contentDigest': 'a' * 64, 'byteLength': 4, 'mediaType': 'text/plain',
               'availability': 'available', 'retention': 'snapshot',
               'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
        claim = {'id': 'claim:explicit', 'text': 'Observation.', 'reviewStatus': 'pending',
                 'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
        envelopes = [{'delta': {'createdAt': '2026-11-20T00:00:00Z', 'payload': {'trace': [
            {'kind': 'sciforge.claim-submission.v1', 'claims': [claim]}]}}}]
        with self.assertRaisesRegex(ValueError, 'authoritative source projection'):
            service._replay_submitted_claims(graph, envelopes)

    def test_actual_engine_commits_explicit_claim_without_model_and_restores_exact_anchor(self):
        class NoModel:
            def chat(self, *_args, **_kwargs):
                raise AssertionError('explicit submission must not call model')

        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
                   'contentDigest': 'a' * 64, 'byteLength': 4, 'mediaType': 'text/plain',
                   'availability': 'available', 'retention': 'snapshot',
                   'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
            claim = {'id': 'claim:explicit', 'text': 'Unresolved observation.', 'reviewStatus': 'pending',
                     'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
            envelope = _delta_envelope(digest_fields={
                'sequence': 1, 'scope': {'runtimeId': 'codex', 'threadId': 'thread',
                    'operationId': 'claims:test', 'kind': 'manual', 'workspaceRoot': root},
                'requestedWatermark': '7', 'committedWatermark': '7',
                'schemaVersion': 'evidence.delta.v1', 'extractorVersion': 'extractor.v3',
                'verifierVersion': 'verifier.v3', 'idempotencyKey': 'claims:test',
                'sourceRefs': [], 'artifactRefs': [ref['versionId']], 'runRefs': [],
                'payload': {'trace': [submitted_item(claim)]},
                'createdAt': '2026-11-20T00:00:00Z',
            }, predecessor=None)
            storage = os.path.join(root, 'threads')
            engine = service.Engine(NoModel(), storage_dir=storage)
            result = engine.update(thread_id='thread', target_watermark='7', reason='seal_closure',
                priority='immediate', trace=[envelope], workspace_root=root,
                project_root=root, idempotency_key='seal-explicit')
            self.assertEqual(result['update']['graphState'], 'committed', result)
            restored = service.Engine(NoModel(), storage_dir=storage)
            graph, snapshot = restored.snapshot_graph('thread', result['snapshot']['digest'])
            self.assertEqual(snapshot.digest, result['snapshot']['digest'])
            self.assertEqual(graph.nodes[claim['id']].content, claim['text'])
            self.assertEqual(graph.nodes[claim['id']].attributes['reviewStatus'], 'pending')
            self.assertEqual(graph.artifact_version_refs[ref['versionId']].to_dict(), ref)
            self.assertEqual(next(iter(graph.source_anchors.values())).selector.quote, 'data')
            self.assertEqual(graph.artifacts[ref['artifactId']].kind, 'dataset')
            self.assertEqual(graph.artifact_versions[ref['versionId']].locator, '/original/source.txt')

    def test_replay_preserves_claim_identity_exact_ref_anchor_and_pending_review(self):
        graph = ThreadGraph('codex:thread-1')
        ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
               'contentDigest': 'a' * 64, 'byteLength': 12, 'mediaType': 'text/plain',
               'availability': 'available', 'retention': 'snapshot',
               'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
        claim = {'id': 'claim:explicit', 'text': 'An unresolved observation.', 'reviewStatus': 'pending',
                 'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
        envelopes = [{'delta': {'createdAt': '2026-11-20T00:00:00Z', 'payload': {'trace': [
            submitted_item(claim)]}}}]
        self.assertTrue(hasattr(service, '_replay_submitted_claims'), 'closure must preserve explicit claims without model reinterpretation')
        result = service._replay_submitted_claims(graph, envelopes)
        self.assertIn('claim:explicit', result['new_nodes'])
        self.assertEqual(graph.nodes['claim:explicit'].content, claim['text'])
        self.assertEqual(graph.nodes['claim:explicit'].attributes['reviewStatus'], 'pending')
        self.assertEqual(graph.artifact_version_refs[ref['versionId']].to_dict(), ref)
        anchor = next(iter(graph.source_anchors.values()))
        self.assertEqual(anchor.selector.query, {'unit': 'utf8-byte', 'start': 0, 'end': 4})
        self.assertEqual(anchor.selector.quote, 'data')
        self.assertEqual(len(graph.edges), 1)
        graph.artifacts[ref['artifactId']].kind = 'dataset'
        graph.artifact_versions[ref['versionId']].locator = '/original/source.txt'
        service._replay_submitted_claims(graph, envelopes)
        self.assertEqual(len(graph.nodes), 2)
        self.assertEqual(graph.artifacts[ref['artifactId']].kind, 'dataset')
        self.assertEqual(graph.artifact_versions[ref['versionId']].locator, '/original/source.txt')

    def test_closure_reuses_authoritative_projection_for_exact_ref_in_earlier_submission(self):
        ref = {'artifactId': 'artifact:source', 'versionId': 'artifact-version:source',
               'contentDigest': 'a' * 64, 'byteLength': 4, 'mediaType': 'text/plain',
               'availability': 'available', 'retention': 'snapshot',
               'accessPolicy': {'visibility': 'workspace', 'principals': [], 'allowExport': True}}
        claim = {'id': 'claim:earlier', 'text': 'Observation.', 'reviewStatus': 'pending',
                 'sources': [{'ref': ref, 'startByte': 0, 'endByte': 4, 'quote': 'data'}]}
        trace = [{'kind': 'sciforge.claim-submission.v1', 'claims': [claim]},
                 submitted_item({**claim, 'id': 'claim:later'})]
        graph = ThreadGraph('thread')
        service._replay_submitted_claims(graph, [{'delta': {
            'createdAt': '2026-11-20T00:00:00Z', 'payload': {'trace': trace}}}])
        self.assertIn('claim:earlier', graph.nodes)
        self.assertIn('claim:later', graph.nodes)
        self.assertEqual(graph.artifacts[ref['artifactId']].kind, 'dataset')


if __name__ == '__main__':
    unittest.main()
