"""Real fixed-HEAD publisher compatibility, not a hand-built hardlink layout."""
import json
import os
from pathlib import Path
import hashlib
import tempfile
import types
import unittest

from evidence_dag.llm import StubLLM
from evidence_dag.service import Engine
from evidence_dag.snapshot import snapshot_filename

BASELINE = '376fc34e301b05a3abf5846d9196795ef15c191d'


def old_publisher():
    source = (Path(__file__).parent / 'fixtures' / 'legacy_snapshot_storage.py').read_bytes()
    if hashlib.sha256(source).hexdigest() != '40e2ca4992850333a4f6acebf89446de98c273d5cdc1b71b00350659ef940e23':
        raise ValueError('Fixed publisher fixture integrity mismatch')
    module = types.ModuleType('fixed_head_snapshot_storage')
    exec(compile(source, BASELINE + '/snapshot_storage.py', 'exec'), module.__dict__)
    return module.atomic_publish_latest


class LegacySnapshotAliases(unittest.TestCase):
    def test_fixed_head_publish_restarts_and_migrates_exact_pair(self):
        for full_prov in (False, True):
            with self.subTest(full_prov=full_prov), tempfile.TemporaryDirectory() as root:
                root = os.path.realpath(root)
                storage = Path(root) / 'threads'
                llm = StubLLM(extract_response=json.dumps({'nodes': [{'tmp_id': 'claim', 'type': 'claim', 'content': 'Synthetic', 'trace_ref': 't1'}], 'edges': []}), nli_handler=lambda *_: 0.9)
                engine = Engine(llm, storage_dir=str(storage))
                result = engine.update(thread_id='codex:legacy', target_watermark='1', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic'}], workspace_root=root, idempotency_key='legacy-1')
                latest = storage / snapshot_filename('codex:legacy')
                immutable = next((storage / 'snapshots').rglob('*.prov.json'))
                if full_prov:
                    from evidence_dag.snapshot_storage import read_snapshot_bytes
                    immutable.write_bytes(read_snapshot_bytes(str(immutable), storage_dir=str(storage)))
                old_publisher()(str(immutable), str(latest))
                self.assertEqual(latest.stat().st_ino, immutable.stat().st_ino)
                self.assertEqual(latest.stat().st_nlink, 2)
                raw = latest.read_bytes()
                restored = Engine(StubLLM(), storage_dir=str(storage)).latest_snapshot('codex:legacy')
                self.assertEqual(restored.to_dict(), result['snapshot'])
                self.assertNotEqual(latest.stat().st_ino, immutable.stat().st_ino)
                for path in (latest, immutable):
                    self.assertEqual(path.stat().st_nlink, 1)
                    if os.name != 'nt':
                        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(Engine(StubLLM(), storage_dir=str(storage)).latest_snapshot('codex:legacy'), restored)


    def test_unproven_aliases_are_rejected_without_mutating_files(self):
        from evidence_dag import provjson
        from evidence_dag.graph import ThreadGraph
        from evidence_dag.snapshot import build_snapshot, snapshot_storage_key
        from evidence_dag.snapshot_storage import read_snapshot_text
        for kind in ('external', 'unknown', 'extra', 'malformed', 'wrong_identity', 'symlink', 'wrong_history', 'tampered'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as root:
                root = os.path.realpath(root)
                storage = Path(root) / 'owned'
                storage.mkdir()
                graph = ThreadGraph(thread_id='codex:legacy')
                snapshot = build_snapshot(graph, version=1, input_watermark='1')
                graph.meta['snapshot'] = snapshot.to_dict()
                latest = storage / snapshot_filename(graph.thread_id)
                immutable = storage / 'snapshots' / snapshot_storage_key(graph.thread_id) / f'{snapshot.version:08d}-{snapshot.digest[7:]}.prov.json'
                immutable.parent.mkdir(parents=True)
                raw = provjson.dumps(graph).encode()
                if kind == 'malformed':
                    raw = b'{broken'
                if kind == 'wrong_identity':
                    graph.meta['snapshot']['threadId'] = 'different'
                    raw = provjson.dumps(graph).encode()
                if kind == 'tampered':
                    graph.meta['snapshot']['digest'] = 'sha256:' + '0' * 64
                    raw = provjson.dumps(graph).encode()
                immutable.write_bytes(raw)
                os.chmod(immutable, 0o644)
                old_publisher()(str(immutable), str(latest))
                if kind in ('external', 'unknown'):
                    latest.unlink()
                    immutable.rename(Path(root) / 'outside' if kind == 'external' else storage / 'unknown')
                    os.link(Path(root) / 'outside' if kind == 'external' else storage / 'unknown', latest)
                if kind == 'extra':
                    os.link(immutable, Path(root) / 'outside')
                if kind == 'symlink':
                    immutable.unlink()
                    immutable.symlink_to(latest)
                    os.link(latest, storage / 'unknown')
                if kind == 'wrong_history':
                    immutable.rename(immutable.with_name('wrong.prov.json'))
                before = {str(p): (p.read_bytes(), p.stat().st_mode, p.stat().st_nlink) for p in Path(root).rglob('*') if p.is_file() and not p.is_symlink()}
                with self.assertRaises((OSError, ValueError, TypeError, KeyError)):
                    read_snapshot_text(str(latest), storage_dir=str(storage))
                for name, expected in before.items():
                    p = Path(name)
                    self.assertEqual((p.read_bytes(), p.stat().st_mode, p.stat().st_nlink), expected)

    def test_torn_legacy_publish_residue_is_recovered_not_permanent(self):
        import uuid
        from evidence_dag.snapshot_storage import read_snapshot_bytes
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            storage = Path(root) / 'threads'
            llm = StubLLM(extract_response=json.dumps({'nodes': [{'tmp_id': 'claim', 'type': 'claim', 'content': 'Synthetic', 'trace_ref': 't1'}], 'edges': []}), nli_handler=lambda *_: 0.9)
            engine = Engine(llm, storage_dir=str(storage))
            first = engine.update(thread_id='codex:torn', target_watermark='1', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic'}], workspace_root=root, idempotency_key='torn-1')
            second = engine.update(thread_id='codex:torn', target_watermark='2', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic v2'}], workspace_root=root, idempotency_key='torn-2')
            snap_dir = next((storage / 'snapshots').rglob('00000001-*.prov.json')).parent
            im1 = snap_dir / ('%08d-%s.prov.json' % (first['snapshot']['version'], first['snapshot']['digest'][7:]))
            im2 = snap_dir / ('%08d-%s.prov.json' % (second['snapshot']['version'], second['snapshot']['digest'][7:]))
            latest = storage / snapshot_filename('codex:torn')
            # Rebuild the pre-PR crash: latest still aliases im1 while a torn
            # publish left im2 hardlinked to an orphan <latest>.<hex>.tmp name.
            latest.unlink()
            os.link(im1, latest)
            orphan = storage / (latest.name + '.' + uuid.uuid4().hex + '.tmp')
            os.link(im2, orphan)
            self.assertEqual(os.stat(im2).st_nlink, 2)
            # The torn residue must be cleaned and the verified immutable readable,
            # not a permanent PermissionError that blocks every later update.
            read_snapshot_bytes(str(im2), storage_dir=str(storage))
            self.assertFalse(orphan.exists())
            self.assertEqual(os.stat(im2).st_nlink, 1)
            engine2 = Engine(llm, storage_dir=str(storage))
            third = engine2.update(thread_id='codex:torn', target_watermark='3', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic v3'}], workspace_root=root, idempotency_key='torn-3')
            self.assertEqual(third['snapshot']['version'], 3)

    def test_fake_residue_with_foreign_inode_still_fails_closed(self):
        import uuid
        from evidence_dag.snapshot_storage import read_snapshot_bytes
        with tempfile.TemporaryDirectory() as root:
            root = os.path.realpath(root)
            storage = Path(root) / 'threads'
            llm = StubLLM(extract_response=json.dumps({'nodes': [{'tmp_id': 'claim', 'type': 'claim', 'content': 'Synthetic', 'trace_ref': 't1'}], 'edges': []}), nli_handler=lambda *_: 0.9)
            engine = Engine(llm, storage_dir=str(storage))
            first = engine.update(thread_id='codex:fake', target_watermark='1', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic'}], workspace_root=root, idempotency_key='fake-1')
            second = engine.update(thread_id='codex:fake', target_watermark='2', reason='manual', priority='immediate', trace=[{'id': 't1', 'content': 'Synthetic v2'}], workspace_root=root, idempotency_key='fake-2')
            snap_dir = next((storage / 'snapshots').rglob('00000001-*.prov.json')).parent
            im1 = snap_dir / ('%08d-%s.prov.json' % (first['snapshot']['version'], first['snapshot']['digest'][7:]))
            im2 = snap_dir / ('%08d-%s.prov.json' % (second['snapshot']['version'], second['snapshot']['digest'][7:]))
            latest = storage / snapshot_filename('codex:fake')
            latest.unlink()
            os.link(im1, latest)
            # im2's second link is a noncanonical name, and the tmp-looking name
            # is foreign content: nothing may be deleted or "recovered".
            os.link(im2, storage / 'unknown')
            forged = storage / (latest.name + '.' + uuid.uuid4().hex + '.tmp')
            forged.write_text('forged')
            with self.assertRaises(PermissionError):
                read_snapshot_bytes(str(im2), storage_dir=str(storage))
            self.assertTrue(forged.exists())
            self.assertTrue((storage / 'unknown').exists())


if __name__ == '__main__':
    unittest.main()
