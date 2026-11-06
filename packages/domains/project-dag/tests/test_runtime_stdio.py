"""The process protocol is a Project-owned sidecar, not a DSH host."""
import json
from contextlib import closing
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class RuntimeStdioTests(unittest.TestCase):
    def test_large_utf8_frame_and_eof_without_newline_after_bad_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.realpath(tmp)
            evidence = os.path.join(root, 'evidence')
            os.mkdir(evidence)
            request = {'id': 12, 'method': 'POST', 'route': '/goals/draft',
                       'body': {'workspaceRoot': root, 'title': '合成 Goal'}}
            # Force more than one raw read; EOF, rather than newline, ends the
            # last frame. Malformed input must not consume the following ID.
            wire = b'not-json\n' + b' ' * 65535 + json.dumps(request, ensure_ascii=False).encode('utf-8')
            result = subprocess.run([sys.executable, '-m', 'project_dag.runtime_stdio',
                                     '--db', os.path.join(root, 'project.db'),
                                     '--evidence', evidence, '--workspace', root],
                                    input=wire, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(len(responses), 2)
            self.assertFalse(responses[0]['ok'])
            self.assertEqual(responses[1]['id'], 12)
            self.assertTrue(responses[1]['ok'], responses[1])
            self.assertEqual(responses[1]['data']['title'], '合成 Goal')

    def test_missing_id_is_rejected_before_any_durable_write(self):
        # A write request without the required envelope id must be refused
        # fail-closed, never executed-and-then-reported-as-failed.
        from evidence_dag import provjson
        from evidence_dag.graph import ThreadGraph
        from evidence_dag.snapshot import build_snapshot, snapshot_filename
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.realpath(tmp)
            evidence = os.path.join(root, 'evidence')
            os.mkdir(evidence)
            graph = ThreadGraph('codex:envelope')
            snapshot = build_snapshot(graph, version=1, input_watermark='turn:1')
            graph.meta['snapshot'] = snapshot.to_dict()
            with open(os.path.join(evidence, snapshot_filename(graph.thread_id)), 'w') as handle:
                handle.write(provjson.dumps(graph))
            args = [sys.executable, '-m', 'project_dag.runtime_stdio', '--db',
                    os.path.join(root, 'project.db'), '--evidence', evidence,
                    '--workspace', root]
            process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                process.stdin.write(json.dumps({'route': '/updates', 'method': 'POST', 'body': {
                    'workspaceRoot': root, 'reason': 'manual_immediate', 'priority': 1,
                    'evidenceVector': [{'threadId': graph.thread_id, 'digest': snapshot.digest}],
                    'capturedScope': {'includedSessions': [graph.thread_id],
                                      'excludedSessions': [], 'isolatedSessions': []}}}) + '\n')
                process.stdin.flush()
                rejected = json.loads(process.stdout.readline())
                self.assertFalse(rejected['ok'], rejected)
                with closing(sqlite3.connect(os.path.join(root, 'project.db'))) as db:
                    jobs = list(db.execute('SELECT status FROM project_update_job'))
                self.assertEqual(jobs, [])
                # A well-formed request afterwards still works: the envelope
                # failure did not kill or desynchronise the sidecar.
                process.stdin.write(json.dumps({'id': 9, 'route': '/goals/draft', 'method': 'POST',
                                                'body': {'workspaceRoot': root, 'title': 'Later'}}) + '\n')
                process.stdin.flush()
                accepted = json.loads(process.stdout.readline())
                self.assertEqual(accepted['id'], 9)
                self.assertTrue(accepted['ok'], accepted)
            finally:
                process.stdin.close()
                process.wait(timeout=10)
                process.stdout.close()


    def test_status_reads_old_durable_receipt_after_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.realpath(tmp)
            evidence = os.path.join(root, 'evidence')
            os.mkdir(evidence)
            args = [sys.executable, '-m', 'project_dag.runtime_stdio', '--db',
                    os.path.join(root, 'project.db'), '--evidence', evidence,
                    '--workspace', root]
            def run(request):
                result = subprocess.run(args, input=json.dumps(request)+'\n',
                                        text=True, capture_output=True, check=True)
                return json.loads(result.stdout.splitlines()[0])
            first = run({'id': 1, 'route': '/goals/draft', 'method': 'POST',
                         'body': {'workspaceRoot': root, 'title': 'Durable goal'}})
            self.assertTrue(first['ok'], first)
            second = run({'id': 2, 'route': '/goals/draft?workspaceRoot='+root,
                          'method': 'GET'})
            self.assertTrue(second['ok'], second)
            self.assertEqual(second['data']['title'], 'Durable goal')


if __name__ == '__main__':
    unittest.main()
