"""Formal closures must project their exact historical Snapshot, not latest."""
import json
import os
import tempfile
import unittest
from evidence_dag.llm import StubLLM
from evidence_dag.service import Engine

class FormalClosureProjectionTests(unittest.TestCase):
    def test_first_formal_closure_projects_without_publishing_latest(self):
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            llm = StubLLM(extract_response=json.dumps({
                'nodes': [{'tmp_id': 'claim', 'type': 'claim', 'content': 'Synthetic.', 'trace_ref': 't1'}],
                'edges': [],
            }), nli_handler=lambda _p, _h: 0.9)
            engine = Engine(llm, storage_dir=os.path.join(root, 'threads'))
            result = engine.update(thread_id='codex:thread-1', target_watermark='7',
                reason='seal_closure', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic.'}],
                workspace_root=root, idempotency_key='seal-1')
            self.assertIsNone(engine.latest_snapshot('codex:thread-1'))
            projected = engine.update_result_view('codex:thread-1', result)
            self.assertEqual(projected['snapshot']['digest'], result['snapshot']['digest'])
            self.assertIsNone(engine.latest_snapshot('codex:thread-1'))

    def test_versions_count_all_immutable_commits_without_publishing_latest(self):
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            llm = StubLLM(extract_response=json.dumps({
                'nodes': [{'tmp_id': 'claim', 'type': 'claim', 'content': 'Synthetic.', 'trace_ref': 't1'}],
                'edges': [],
            }), nli_handler=lambda _p, _h: 0.9)
            for thread in ('codex:alpha', 'research:beta'):
                engine = Engine(llm, storage_dir=os.path.join(root, 'threads'))
                for expected in (1, 2, 3):
                    if expected == 3:
                        engine = Engine(llm, storage_dir=os.path.join(root, 'threads'))
                    result = engine.update(thread_id=thread, target_watermark=str(expected),
                        reason='seal_closure', priority='immediate',
                        trace=[{'id': 't1', 'content': 'Synthetic.'}],
                        workspace_root=root, idempotency_key=f'{thread}:seal:{expected}')
                    self.assertEqual(result['snapshot']['version'], expected)
                    self.assertIsNone(engine.latest_snapshot(thread))

if __name__ == '__main__':
    unittest.main()
