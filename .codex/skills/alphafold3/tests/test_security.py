"""Desired security contracts, using only local stdlib HTTP/cluster substitutes."""
import json
from pathlib import Path
import sys
import unittest

import test_submit as boundary


class SubmitSecurityTests(unittest.TestCase):
    root: Path
    bin: Path
    env: dict
    setUp = boundary.SubmitBoundaryTests.setUp
    run_script = boundary.SubmitBoundaryTests.run_script

    def test_invalid_sequence_never_executes_code_or_external_tools(self):
        marker = self.root / 'injection-marker'
        payload = ("MQ'''; __import__('pathlib').Path(" + repr(str(marker)) +
                   ").write_text('synthetic-regression-marker'); #")
        cases = [payload, 'MQ"IF', "MQ'IF", 'MQ\nIF', 'MQ`touch injection-marker`',
                 'MQ$(touch injection-marker)', 'MQ;touch injection-marker',
                 'MQ/IF', 'MQ123', '', ' \n\t', 'MQé']
        for sequence in cases:
            for extra in ([], ['--remote-json', '/test/in.json'], ['--preflight']):
                with self.subTest(sequence=sequence, extra=extra):
                    marker.unlink(missing_ok=True)
                    result, calls = self.run_script(['--sequence', sequence, '--no-wait', *extra])
                    self.assertFalse(marker.exists(), 'sequence executed injected Python or shell code')
                    self.assertEqual(calls, [], 'invalid sequence reached an external executable')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('sequence', result.stderr.lower())

    def test_valid_sequence_and_unusual_paths_preserve_json_data(self):
        capture = self.root / 'uploaded.json'
        self.env['CAPTURE_JSON'] = str(capture)
        fake = boundary.FAKE.format(python=sys.executable) + '''
if name == 'kubectl' and 'cp' in args and ':' not in args[-2]:
    pathlib.Path(os.environ['CAPTURE_JSON']).write_bytes(pathlib.Path(args[-2]).read_bytes())
'''
        (self.bin / 'kubectl').write_text(fake)
        weird = "quote'\"line\nbreak`literal`$(literal)"
        tmpdir = self.root / weird
        tmpdir.mkdir()
        self.env['TMPDIR'] = str(tmpdir)
        self.env['ALPHAFOLD3_INPUT_BASE'] = '/test/' + weird
        self.env['ALPHAFOLD3_MODEL_DIR'] = '/models/' + weird
        kubeconfig = self.root / (weird + '-kubeconfig')
        kubeconfig.write_text('synthetic config')
        self.env['ALPHAFOLD3_KUBECONFIG'] = str(kubeconfig)
        for sequence in ['MQIFVK', 'abcdefghijklmnopqrstuvwxyz', ' \tMQIF\r\n']:
            with self.subTest(sequence=sequence):
                result, calls = self.run_script(['--sequence', sequence, '--name', weird, '--no-wait'])
                self.assertEqual(result.returncode, 0, result.stderr)
                doc = json.loads(capture.read_text())
                self.assertEqual(doc, {
                    'name': 'quotelinebreakliteralliteral', 'dialect': 'alphafold3',
                    'version': 1, 'modelSeeds': [1], 'sequences': [{'protein': {
                        'id': 'A', 'sequence': sequence.strip(), 'unpairedMsa': '',
                        'pairedMsa': '', 'templates': []}}]})
                submit = [c['args'] for c in calls if c['tool'] == 'curl'][-1]
                inputs = json.loads(submit[submit.index('-d') + 1])['inputs']
                self.assertEqual(inputs['model_dir'], self.env['ALPHAFOLD3_MODEL_DIR'])
                self.assertTrue(inputs['input_dir'].startswith(self.env['ALPHAFOLD3_INPUT_BASE'] + '/'))
                self.assertEqual(list(tmpdir.iterdir()), [], 'generated input was not cleaned up')
                for c in calls:
                    if c['tool'] == 'kubectl':
                        self.assertEqual(c['args'][:2], ['--kubeconfig', str(kubeconfig)])

    def test_remote_paths_and_credentials_remain_literal_json(self):
        weird = "quote'\"line\nbreak`touch parameter-marker`$(touch parameter-marker)"
        self.env['ALPHAFOLD3_USERNAME'] = weird
        self.env['ALPHAFOLD3_PASSWORD'] = weird
        for mode in ['--remote-json', '--json-path', '--input-dir']:
            with self.subTest(mode=mode):
                value = '/test/' + weird + '.json'
                result, calls = self.run_script([mode, value, '--model-dir', '/model/' + weird, '--no-wait'])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse((self.root / 'parameter-marker').exists())
                http = [c['args'] for c in calls if c['tool'] == 'curl']
                auth = json.loads(http[0][http[0].index('-d') + 1])
                self.assertEqual(auth, {'username': weird, 'password': weird})
                inputs = json.loads(http[1][http[1].index('-d') + 1])['inputs']
                self.assertEqual(inputs, {'input_dir' if mode == '--input-dir' else 'input_json': value,
                                          'model_dir': '/model/' + weird})

    def test_download_summary_treats_output_path_as_data(self):
        (self.root / 'safe').write_text('synthetic input for harmless injection probe')
        marker = self.root / 'download-marker'
        injection = ("./safe') as f:\n    pass\n"
                     "__import__('pathlib').Path('download-marker').write_text('synthetic')\n"
                     "with open('unused")
        for output in [injection, "./quote'and\"double", './line\nbreak',
                       './back`touch download-marker`tick', './$(touch download-marker)']:
            with self.subTest(output=output):
                marker.unlink(missing_ok=True)
                result, calls = self.run_script(['--remote-json', '/test/in.json', '--output-dir', output])
                self.assertFalse(marker.exists(), 'download path executed Python or shell code')
                self.assertEqual(result.returncode, 0, result.stderr)
                content = (self.root / output / 'test-task.cif').read_text()
                self.assertEqual(content, 'data_test\nATOM 1 C CA A 1 0 0 0\n')
                self.assertIn('Atoms: 1 (ATOM) + 0 (HETATM)', result.stdout)
                self.assertIn(f'File: {len(content):,} bytes', result.stdout)
                self.assertTrue(any(c['tool'] == 'kubectl' and 'cp' in c['args'] for c in calls))


class AssetProvenanceTests(unittest.TestCase):
    def test_excluded_gif_and_new_runtime_icons_have_current_provenance(self):
        root = Path(__file__).resolve().parents[4]
        self.assertFalse((root / 'src/asset/img/code.gif').exists())
        for asset in ('sciforge.png', 'sciforge_tray.png'):
            self.assertTrue((root / 'src/asset/img' / asset).is_file())
        for relative in ('THIRD_PARTY_NOTICES.md', 'src/asset/img/README.md'):
            with self.subTest(document=relative):
                text = (root / relative).read_text()
                self.assertIn('nested-square', text)
                self.assertIn('Apache-2.0', text)
                self.assertIn('scripts/generate-source-assets.py', text)
                self.assertIn('excluded', text)
                self.assertNotIn('rights review pending', text)
                self.assertNotIn('demo restored', text)


if __name__ == '__main__':
    unittest.main()
