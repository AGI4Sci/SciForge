"""Offline regressions for the real verifier's refusal contract."""
import importlib.util
import io
import json
import urllib.error
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('market_verifier', Path(__file__).with_name('dsh-market-app-verify.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class RefusalContractTests(unittest.TestCase):
    def test_expected_unregistered_capability_is_refused(self):
        error = verifier.Refused('Capability probe.ping is not registered.', code='unknown_capability', category='rejected')
        with patch.object(verifier, 'call_capability', side_effect=error):
            self.assertEqual(verifier.Runner('test').refusal_text('probe.ping', {}, 'still callable'), str(error))

    def test_transport_and_unrelated_refusals_fail(self):
        for error in [RuntimeError('IPC transport failed'), verifier.Refused('schema invalid'),
                      verifier.Refused('wrong identity', code='unknown_capability', category='rejected')]:
            with self.subTest(error=str(error)), patch.object(verifier, 'call_capability', side_effect=error):
                with self.assertRaises((SystemExit, RuntimeError)):
                    verifier.Runner('test').refusal_text('probe.ping', {}, 'still callable')

    def test_plugin_error_is_not_host_refusal(self):
        with patch.object(verifier, 'call_capability', return_value={'output': {'ok': False, 'error': {'code': 'failed'}}}):
            with self.assertRaises(SystemExit):
                verifier.Runner('test').refusal_text('probe.ping', {}, 'still callable')

    def test_bridge_unknown_capability_requires_exact_http_contract(self):
        expected = {'ok': False, 'message': 'Dev browser capability transport could not resolve the requested capability.'}
        for message, accepted in [(expected, True), ({'ok': False, 'message': 'Origin is not allowed.'}, False)]:
            error = urllib.error.HTTPError('http://localhost', 403, 'Forbidden', {}, io.BytesIO(json.dumps(message).encode()))
            with self.subTest(message=message), patch.object(verifier.urllib.request, 'urlopen', side_effect=error):
                with self.assertRaises(verifier.Refused if accepted else RuntimeError):
                    verifier.invoke('capability:invoke', {'request': {'actionId': 'probe.ping'}}, 'test')

    def test_structured_capability_error_is_preserved(self):
        with patch.object(verifier, 'invoke', return_value={'ok': False, 'error': {
                'code': 'unknown_capability', 'category': 'rejected', 'message': 'Capability probe.ping is not registered.'}}):
            with self.assertRaises(verifier.Refused) as raised:
                verifier.call_capability('probe.ping', {}, 'test')
            self.assertEqual(raised.exception.code, 'unknown_capability')
            self.assertEqual(raised.exception.category, 'rejected')


if __name__ == '__main__':
    unittest.main()
