"""Real historical files, not literal equality mutations, guard the reader."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import test_reader_integrity as fixtures
from evidence_dag.snapshot import snapshot_filename
from project_dag.reader import SessionReader

class ExactHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = str(Path(self.tmp.name).resolve())
        self.reader = SessionReader(self.root)
        self.thread = 'codex:formal-history'
        self.doc, self.snapshot = fixtures._snapshot_document(self.thread, version=1, source_text='Original evidence')
    def tearDown(self):
        self.tmp.cleanup()
    _write_historical = fixtures.SessionReaderIntegrityTests._write_historical
    _write_current = fixtures.SessionReaderIntegrityTests._write_current
    def history(self, document=None):
        self._write_historical(self.thread, self.snapshot['digest'], document or self.doc)
    def load(self):
        return self.reader.load(self.thread, self.snapshot['digest'])
    def test_exact_history_without_latest(self):
        self.history()
        graph, loaded, actual = self.load()
        self.assertTrue(graph.nodes)
        self.assertEqual(loaded.digest, self.snapshot['digest'])
        self.assertEqual(actual, self.doc)
        self.assertFalse(Path(self.root, snapshot_filename(self.thread)).exists())
    def test_exact_history_ignores_invalid_latest_bytes(self):
        self.history()
        path = Path(self.root, snapshot_filename(self.thread))
        path.write_text('{invalid latest')
        self.assertEqual(self.load()[1].digest, self.snapshot['digest'])
        self.assertEqual(path.read_text(), '{invalid latest')
    def test_pending_history_is_rejected_even_with_valid_current(self):
        self._write_current(self.thread, self.doc)
        pending = copy.deepcopy(self.doc); pending['edag:meta']['snapshot']['status'] = 'pending'
        self.history(pending)
        with self.assertRaisesRegex(ValueError, 'only consumes committed'): self.load()
    def test_tampered_history_is_rejected_even_with_same_valid_current(self):
        self._write_current(self.thread, self.doc)
        tampered = copy.deepcopy(self.doc)
        claim = next(x for x in tampered['entity'].values() if x.get('prov:type') == 'edag:claim')
        claim['edag:content'] = 'Actually mutated historical bytes'
        self.history(tampered)
        with self.assertRaisesRegex(ValueError, 'digest mismatch'): self.load()
    def test_history_with_wrong_thread_is_rejected(self):
        wrong = copy.deepcopy(self.doc); wrong['edag:meta']['snapshot']['threadId'] = 'codex:other'
        self.history(wrong)
        with self.assertRaisesRegex(ValueError, 'threadId mismatch'): self.load()
    def test_duplicate_exact_history_is_rejected(self):
        self.history()
        original = next(Path(self.root, 'snapshots').rglob('*.prov.json'))
        original.with_name('00000002-' + self.snapshot['digest'][7:] + '.prov.json').write_bytes(original.read_bytes())
        with self.assertRaisesRegex(ValueError, '2 matching historical'): self.load()
    def test_invalid_exact_digest_is_rejected_before_read(self):
        self._write_current(self.thread, self.doc)
        with self.assertRaisesRegex(ValueError, 'invalid Evidence Snapshot digest'):
            self.reader.load(self.thread, '../bad')
