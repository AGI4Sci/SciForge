"""Offline contract tests. All HTTP/cluster executables are local stdlib fakes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/alphafold3_submit.sh'
CONFIG = {
    'ALPHAFOLD3_AUTH_URL': 'https://auth.example.invalid/login',
    'ALPHAFOLD3_TASKS_URL': 'https://tasks.example.invalid/tasks',
    'ALPHAFOLD3_USERNAME': 'test-user',
    'ALPHAFOLD3_PASSWORD': 'test-password',
    'ALPHAFOLD3_NAMESPACE': 'test-namespace',
    'ALPHAFOLD3_MODEL_DIR': '/test/models',
    'ALPHAFOLD3_INPUT_BASE': '/test/input',
    'ALPHAFOLD3_OUTPUT_BASE': '/test/output',
}
FAKE = '''#!{python}
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['FAKE_CALLS'], 'a') as out:
    out.write(json.dumps({{'tool': name, 'args': args}}) + '\\n')
if name == 'curl':
    if os.environ.get('FAKE_AUTH_FAIL') == '1':
        print('private-diagnostic-marker', file=sys.stderr)
        sys.exit(1)
    if 'POST' in args and args[args.index('POST') + 1].endswith('/login'):
        print(json.dumps({{'token': 'test-token'}}))
    elif 'POST' in args:
        print(json.dumps({{'task_id': 'test-task'}}))
    else:
        print(json.dumps({{'status': 'completed', 'outputs': {{}} if os.environ.get('FAKE_NO_OUTPUT') else {{'output_path': '/test/output/test-task.cif'}}}}))
elif name == 'kubectl':
    if 'current-context' in args:
        print('test-context')
    elif 'get' in args:
        print('test-pod')
    elif 'cp' in args and ':' in args[-2]:
        pathlib.Path(args[-1]).write_text('data_test\\nATOM 1 C CA A 1 0 0 0\\n')
    elif 'test' in args and os.environ.get('FAKE_MISSING_CIF'):
        sys.exit(1)
'''


class SubmitBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='af3-boundary-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.script = self.root / 'skill/scripts/alphafold3_submit.sh'
        self.script.parent.mkdir(parents=True)
        shutil.copy2(SCRIPT, self.script)
        for tool in ('curl', 'kubectl', 'sleep'):
            path = self.bin / tool
            path.write_text(FAKE.format(python=sys.executable))
            path.chmod(0o755)
        (self.bin / 'python3').symlink_to(sys.executable)
        self.calls = self.root / 'calls.jsonl'
        self.network_attempts = self.root / 'network-attempts'
        # Defense in depth: no Python child (including a fake) may resolve/connect.
        (self.root / 'sitecustomize.py').write_text(
            'import os, pathlib, sys\n'
            'def guard(event, args):\n'
            '    if event in ("socket.connect", "socket.getaddrinfo", "socket.sendto"):\n'
            '        pathlib.Path(os.environ["NETWORK_ATTEMPTS"]).write_text(event)\n'
            '        raise RuntimeError("network forbidden in offline contract tests")\n'
            'sys.addaudithook(guard)\n')
        self.kubeconfig = self.root / 'explicit-kubeconfig'
        self.kubeconfig.write_text('test only; never opened by a real client\n')
        self.env = {
            'PATH': f'{self.bin}:/usr/bin:/bin',
            'HOME': str(self.root), 'TMPDIR': str(self.root),
            'FAKE_CALLS': str(self.calls),
            'PYTHONPATH': str(self.root), 'PYTHONDONTWRITEBYTECODE': '1',
            'NETWORK_ATTEMPTS': str(self.network_attempts),
            **CONFIG, 'ALPHAFOLD3_KUBECONFIG': str(self.kubeconfig),
        }

    def run_script(self, args, env=None):
        self.calls.unlink(missing_ok=True)
        result = subprocess.run(['/bin/bash', str(self.script), *args],
                                env=self.env if env is None else env,
                                cwd=self.root, text=True, capture_output=True, timeout=15)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        self.assertFalse(self.network_attempts.exists(), 'a Python child attempted real networking')
        return result, calls

    def test_missing_configuration_refuses_before_any_network_attempt(self):
        cases = [
            (['--remote-json', '/test/input/input.json', '--no-wait'],
             ['AUTH_URL', 'TASKS_URL', 'USERNAME', 'PASSWORD', 'MODEL_DIR']),
            (['--sequence', 'MQIF', '--no-wait'],
             ['NAMESPACE', 'KUBECONFIG', 'INPUT_BASE']),
            (['--remote-json', '/test/input/input.json', '--output-dir', './output'],
             ['NAMESPACE', 'KUBECONFIG', 'OUTPUT_BASE']),
            (['--preflight'], ['AUTH_URL', 'TASKS_URL', 'USERNAME', 'PASSWORD', 'NAMESPACE', 'KUBECONFIG']),
        ]
        for args, names in cases:
            for name in names:
                key = 'ALPHAFOLD3_' + name
                with self.subTest(mode=args[0], missing=key):
                    env = dict(self.env)
                    del env[key]
                    result, calls = self.run_script(args, env)
                    self.assertEqual(len(calls), 0, 'unconfigured execution reached a network executable')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(key, result.stdout + result.stderr)

    def test_explicit_configuration_preserves_all_submission_modes(self):
        local = self.root / "local'input.json"
        local.write_text('{"name":"test","sequences":[]}')
        self.env['ALPHAFOLD3_USERNAME'] = 'test-"user'
        self.env['ALPHAFOLD3_PASSWORD'] = 'test-"password\\with-newline\n'
        self.env['ALPHAFOLD3_MODEL_DIR'] = "/test/model's"
        cases = [
            ['--remote-json', "/test/input/file's.json"],
            ['--json-path', '/test/input/alias.json'],
            ['--input-dir', "/test/input/batch's"],
            ['--sequence', 'MQIF', '--name', 'Test Fold'],
            ['--json', str(local)],
            ['--json-input', str(local)],
        ]
        for args in cases:
            with self.subTest(mode=args[0]):
                result, calls = self.run_script([*args, '--no-wait'])
                self.assertEqual(result.returncode, 0, 'explicit configuration failed')
                http = [c['args'] for c in calls if c['tool'] == 'curl']
                self.assertEqual(len(http), 2)
                self.assertIn(self.env['ALPHAFOLD3_AUTH_URL'], http[0])
                auth = json.loads(http[0][http[0].index('-d') + 1])
                self.assertEqual(auth, {'username': self.env['ALPHAFOLD3_USERNAME'],
                                        'password': self.env['ALPHAFOLD3_PASSWORD']})
                self.assertIn(self.env['ALPHAFOLD3_TASKS_URL'], http[1])
                self.assertIn('Authorization: Bearer test-token', http[1])
                self.assertIn('x-original-model: alphafold3', http[1])
                payload = json.loads(http[1][http[1].index('-d') + 1])
                self.assertEqual(payload['inputs']['model_dir'], self.env['ALPHAFOLD3_MODEL_DIR'])
                if args[0] in ('--remote-json', '--json-path'):
                    self.assertEqual(payload['inputs']['input_json'], args[1])
                elif args[0] == '--input-dir':
                    self.assertEqual(payload['inputs']['input_dir'], args[1])
                else:
                    self.assertTrue(payload['inputs']['input_dir'].startswith('/test/input/'))
                for call in [c['args'] for c in calls if c['tool'] == 'kubectl']:
                    self.assertEqual(call[:2], ['--kubeconfig', str(self.kubeconfig)])
                    self.assertIn('test-namespace', call)
                self.assertNotIn('test-token', result.stdout + result.stderr)
                self.assertNotIn(self.env['ALPHAFOLD3_PASSWORD'], result.stdout + result.stderr)

    def test_invalid_configuration_is_rejected_without_network(self):
        for key, value in [
            ('ALPHAFOLD3_AUTH_URL', 'not-a-url'),
            ('ALPHAFOLD3_TASKS_URL', 'file:///test/tasks'),
            ('ALPHAFOLD3_AUTH_URL', 'https://user:password@example.invalid/login'),
            ('ALPHAFOLD3_USERNAME', '  '),
            ('ALPHAFOLD3_MODEL_DIR', 'relative/models'),
            ('ALPHAFOLD3_INPUT_BASE', 'relative/input'),
            ('ALPHAFOLD3_OUTPUT_BASE', 'relative/output'),
            ('ALPHAFOLD3_KUBECONFIG', str(self.root / 'missing')),
        ]:
            with self.subTest(key=key):
                env = dict(self.env)
                env[key] = value
                result, calls = self.run_script(['--sequence', 'MQIF', '--output-dir', './out'], env)
                self.assertEqual(len(calls), 0, 'invalid config reached network executable')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(key, result.stdout + result.stderr)

    def test_http_only_submission_does_not_require_cluster_configuration(self):
        env = {key: value for key, value in self.env.items() if key not in (
            'ALPHAFOLD3_KUBECONFIG', 'ALPHAFOLD3_NAMESPACE',
            'ALPHAFOLD3_INPUT_BASE', 'ALPHAFOLD3_OUTPUT_BASE')}
        result, calls = self.run_script(['--remote-json', '/test/in.json', '--no-wait'], env)
        self.assertEqual(result.returncode, 0)
        self.assertEqual([c['tool'] for c in calls], ['curl', 'curl'])
        self.assertNotIn('kubectl -n  ', result.stdout)

    def test_download_uses_explicit_cluster_and_poll_token(self):
        result, calls = self.run_script(['--remote-json', '/test/in.json', '--output-dir', './out'])
        self.assertEqual(result.returncode, 0)
        self.assertTrue((self.root / 'out/test-task.cif').is_file())
        self.assertEqual((self.root / 'out/test-task.cif').read_text(), 'data_test\nATOM 1 C CA A 1 0 0 0\n')
        http = [c['args'] for c in calls if c['tool'] == 'curl']
        self.assertEqual(len(http), 3)
        self.assertIn('Authorization: Bearer test-token', http[-1])
        for call in [c['args'] for c in calls if c['tool'] == 'kubectl']:
            self.assertEqual(call[:2], ['--kubeconfig', str(self.kubeconfig)])
            self.assertIn('test-namespace', call)
        self.assertNotIn('test-token', result.stdout + result.stderr)

    def test_public_guides_have_no_private_deployment_defaults(self):
        import ipaddress
        import re
        skill = SCRIPT.parents[1]
        for path in [skill / 'SKILL.md', skill.parent / 'AlphaFold3 C550 推理平台 API 调用指南.md']:
            with self.subTest(document=path.name):
                text = path.read_text().replace('\\.', '.').replace('\\-', '-')
                private_ips = [ip for ip in re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
                               if ipaddress.ip_address(ip).is_private]
                self.assertEqual(len(private_ips), 0, 'guide embeds private endpoint')
                for name in CONFIG:
                    self.assertIn(name, text)
                self.assertIn('ALPHAFOLD3_KUBECONFIG', text)
                self.assertNotRegex(text, r'kubectl -n [a-zA-Z0-9]')
                self.assertNotRegex(text, r'(?:~/code/|/Users/|/home/)[^\s]+')

    def test_help_and_cli_overrides_are_offline_safe(self):
        env = {key: value for key, value in self.env.items() if not key.startswith('ALPHAFOLD3_')}
        result, calls = self.run_script(['--help'], env)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, [])
        env = dict(self.env)
        del env['ALPHAFOLD3_MODEL_DIR']
        del env['ALPHAFOLD3_KUBECONFIG']
        result, calls = self.run_script(['--sequence', 'MQIF', '--model-dir', '/test/override',
                                         '--kubeconfig', str(self.kubeconfig), '--no-wait'], env)
        self.assertEqual(result.returncode, 0)
        submit = [c['args'] for c in calls if c['tool'] == 'curl'][-1]
        payload = json.loads(submit[submit.index('-d') + 1])
        self.assertEqual(payload['inputs']['model_dir'], '/test/override')


    def test_preflight_reports_failure_without_private_diagnostics(self):
        result, calls = self.run_script(['--preflight'])
        self.assertEqual(result.returncode, 0)
        self.assertEqual([c['tool'] for c in calls], ['curl', 'kubectl', 'kubectl'])
        for value in ('test-token', 'test-context', 'test-pod', self.env['ALPHAFOLD3_TASKS_URL']):
            self.assertNotIn(value, result.stdout + result.stderr)
        env = dict(self.env, FAKE_AUTH_FAIL='1')
        result, calls = self.run_script(['--preflight'], env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('AF3_HTTP_AUTH\tFAIL', result.stdout)
        self.assertNotIn('private-diagnostic-marker', result.stdout + result.stderr)

    def test_download_never_probes_unconfigured_output_root(self):
        env = dict(self.env, FAKE_NO_OUTPUT='1', FAKE_MISSING_CIF='1')
        result, calls = self.run_script(['--remote-json', '/test/in.json', '--output-dir', './out'], env)
        self.assertNotEqual(result.returncode, 0)
        cluster = [c['args'] for c in calls if c['tool'] == 'kubectl']
        probes = [c[-1] for c in cluster if 'test' in c or 'ls' in c]
        self.assertTrue(probes)
        self.assertTrue(all(path.startswith('/test/output/') for path in probes),
                        'download probed an unconfigured remote output root')


if __name__ == '__main__':
    unittest.main()
