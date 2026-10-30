#!/usr/bin/env python3
import base64
import hashlib
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-dsh-storage.py'))
assert spec is not None and spec.loader is not None
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class IntegrityTests(unittest.TestCase):
    def test_accepts_matching_sri_and_rejects_tampering(self):
        data = b'synthetic package bytes'
        sri = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        sha1 = hashlib.sha1(data).hexdigest()
        self.assertTrue(audit.verify_integrity(data, sri, sha1))
        with self.assertRaises(ValueError):
            audit.verify_integrity(data + b'tampered', sri, sha1)

    def test_local_exports_are_not_dynamic_loads(self):
        parsed = audit.runtime_imports({'index.js': "export { local }; import x from '@vendor/pkg'; export * from 'node:fs'; import(name);"})
        self.assertEqual(parsed[0]['external'], ['@vendor/pkg', 'node:fs'])
        self.assertEqual(parsed[0]['nonLiteralModuleLoads'], ['name'])

    def test_optional_edges_are_not_required(self):
        parsed = audit.edges({'dependencies': {'required': '^1', 'optional': '^1'},
            'optionalDependencies': {'optional': '^2'}, 'peerDependencies': {'peer': '1', 'maybe': '1'},
            'peerDependenciesMeta': {'maybe': {'optional': True}}})
        self.assertEqual({e['name'] for e in parsed if not e['optional']}, {'required', 'peer'})
        self.assertEqual({e['name'] for e in parsed if e['optional']}, {'optional', 'maybe'})

if __name__ == '__main__':
    unittest.main()
