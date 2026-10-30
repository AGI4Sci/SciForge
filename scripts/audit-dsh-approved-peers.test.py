import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-dsh-approved-peers.py'))
assert spec is not None and spec.loader is not None
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class RuntimeImportsTest(unittest.TestCase):
    def test_reads_module_syntax_without_executing_source_or_scanning_prose(self):
        source = '''
// import "fake-comment"
const prose = `from 'fake-prose'; import '${previous}'`
import {
  Context
} from '@deepseek-ai/cordis'
export { value } from './relative.js'
const dynamic = import('actual-dynamic')
const required = require('node:fs')
throw new Error('must never execute this source')
'''
        self.assertEqual(audit.runtime_imports(source),
                         ['@deepseek-ai/cordis', 'actual-dynamic', 'node:fs'])


if __name__ == '__main__':
    unittest.main()
