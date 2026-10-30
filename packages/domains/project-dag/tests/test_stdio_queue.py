"""Wheel-only queue lifecycle checks: no POST/poll is required to make progress."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.snapshot import build_snapshot, snapshot_filename
from project_dag.service import Engine
from project_dag.runtime_stdio import NoModel

class StdioQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.evidence = self.root / 'evidence'; self.evidence.mkdir()
        self.db = self.root / 'project.db'
        graph = ThreadGraph('codex:queue')
        snapshot = build_snapshot(graph, version=1, input_watermark='queue:1')
        graph.meta['snapshot'] = snapshot.to_dict()
        self.path = self.evidence / snapshot_filename(graph.thread_id)
        self.document = provjson.dumps(graph); self.path.write_text(self.document)
        self.engine = Engine(str(self.db), str(self.evidence), judge=NoModel())
        self.key = self.engine.project_key(str(self.root))
        self.payload = {'projectKey': self.key, 'reason': 'manual_immediate', 'priority': 3,
                        'evidenceVector': [{'threadId': graph.thread_id, 'digest': snapshot.digest}],
                        'capturedScope': {'includedSessions': [graph.thread_id], 'excludedSessions': [], 'isolatedSessions': []}}
        self.process = None
    def tearDown(self):
        if self.process:
            if self.process.stdin and not self.process.stdin.closed: self.process.stdin.close()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired: self.process.kill(); self.process.wait(timeout=5)
            self.process.stdout.close(); self.process.stderr.close()
        try: self.engine.store.conn.close()
        except Exception: pass
        self.tmp.cleanup()
    def start(self):
        self.engine.store.conn.close()
        python_path = os.pathsep.join([
            str(Path(__file__).resolve().parents[1] / 'python'),
            str(Path(__file__).resolve().parents[2] / 'evidence-dag' / 'python'),
        ])
        env = {key: os.environ[key] for key in ('HOME', 'TMPDIR', 'TEMP', 'TMP') if key in os.environ}
        env['PYTHONPATH'] = python_path
        self.process = subprocess.Popen([sys.executable, '-s', '-u', '-m', 'project_dag.runtime_stdio',
            '--db', str(self.db), '--evidence', str(self.evidence), '--workspace', str(self.root)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=env)
    def states(self):
        with closing(sqlite3.connect(self.db)) as db:
            return [r[0] for r in db.execute('SELECT status FROM project_update_job ORDER BY id')]
    def wait_success(self):
        end = time.monotonic() + 4
        while time.monotonic() < end:
            if all(state == 'succeeded' for state in self.states()): return
            time.sleep(0.05)
        self.assertTrue(all(state == 'succeeded' for state in self.states()), self.states())
    def test_startup_recovers_queued_work_without_input(self):
        self.engine.enqueue_update(self.payload)
        self.start()
        self.wait_success()
        self.assertIsNone(self.process.poll())

    def test_startup_recovers_running_work_without_input(self):
        receipt = self.engine.enqueue_update(self.payload)
        self.engine.store.x("UPDATE project_update_job SET status='running',processing_version=request_version WHERE id=?", (receipt['jobId'],))
        self.engine.store.x("UPDATE project_update_receipt SET state='running' WHERE job_id=?", (receipt['jobId'],))
        self.engine.store.conn.commit()
        self.start(); self.wait_success()

    def seed_retry(self):
        receipt = self.engine.enqueue_update(self.payload)
        self.path.unlink()
        with self.assertRaises(Exception): self.engine.process_updates()
        self.assertEqual(self.states(), ['retry_scheduled'])
        self.assertTrue(self.engine.workflow.job(receipt['jobId'])['last_error'])
        self.path.write_text(self.document)
        due = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time()+2))
        self.engine.store.x('UPDATE project_update_job SET next_attempt_at=?', (due,))
        self.engine.store.conn.commit()

    def test_idle_retries_due_work_without_post_or_poll(self):
        self.seed_retry(); self.start(); self.wait_success()
        self.assertIsNone(self.process.poll())

    def test_eof_drains_due_retry_before_actual_pid_exit(self):
        self.seed_retry(); self.start()
        self.process.stdin.close()
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertEqual(self.states(), ['succeeded'])
        with self.assertRaises(ProcessLookupError): os.kill(self.process.pid, 0)

    def test_eof_drains_all_queued_projects(self):
        self.engine.enqueue_update(self.payload)
        self.engine.enqueue_update({**self.payload, 'projectKey': self.key+'/other'})
        self.start(); self.process.stdin.close()
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertEqual(self.states(), ['succeeded', 'succeeded'])

    def test_buffered_commands_keep_ids_and_unicode_while_pump_runs(self):
        self.engine.enqueue_update(self.payload)
        self.start()
        commands = [{'id': 0, 'route': '/goals/draft', 'method': 'POST', 'body': {'workspaceRoot': str(self.root), 'title': '合成 Goal'}}]
        commands += [{'id': n, 'route': '/updates/status?workspaceRoot='+str(self.root), 'method': 'GET'} for n in range(1, 21)]
        out, err = self.process.communicate(''.join(json.dumps(c, ensure_ascii=False)+'\n' for c in commands), timeout=5)
        responses = [json.loads(line) for line in out.splitlines()]
        self.assertEqual([r['id'] for r in responses], list(range(21)), err)
        self.assertTrue(all(r['ok'] for r in responses), responses)
        self.assertEqual(responses[0]['data']['title'], '合成 Goal')
        self.assertEqual(self.states(), ['succeeded'])
