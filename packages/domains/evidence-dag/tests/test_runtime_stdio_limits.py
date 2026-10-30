"""An oversized protocol frame yields exactly one error and never desynchronises pairing."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

MAX_LINE = 64 * 1024 * 1024


class RuntimeStdioLimits(unittest.TestCase):
    def spawn_worker(self, storage):
        env = dict(os.environ)
        env['PYTHONPATH'] = os.pathsep.join(sys.path)
        return subprocess.Popen(
            [sys.executable, '-u', '-c',
             'from evidence_dag.runtime_stdio import main; main()', 'worker', storage],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)

    def test_oversized_frame_emits_one_error_and_pairing_survives(self):
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            worker = self.spawn_worker(root)
            try:
                oversized = json.dumps({'type': 'request', 'id': 'big', 'operation': 'nope',
                                        'input': {'pad': 'x' * (MAX_LINE + 5)}})
                worker.stdin.write(oversized + '\n')
                worker.stdin.write(json.dumps({'type': 'request', 'id': 'p1',
                                               'operation': 'nope', 'input': {}}) + '\n')
                worker.stdin.flush()
                responses = [json.loads(worker.stdout.readline()) for _ in range(2)]
                self.assertIsNone(responses[0]['id'])
                self.assertFalse(responses[0]['ok'])
                self.assertIn('protocol limit', responses[0]['error']['message'])
                # The very next response belongs to the next request: no duplicate
                # error from the drained remainder and no lost pairing.
                self.assertEqual(responses[1]['id'], 'p1')
                self.assertFalse(responses[1]['ok'])
                self.assertIn('Unsupported', responses[1]['error']['message'])
                # The worker is still paired and responsive afterwards.
                worker.stdin.write(json.dumps({'type': 'request', 'id': 'p2',
                                               'operation': 'nope', 'input': {}}) + '\n')
                worker.stdin.flush()
                third = json.loads(worker.stdout.readline())
                self.assertEqual(third['id'], 'p2')
            finally:
                worker.stdin.close()
                worker.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
