"""Windows pathname and handle identity checks use the same representation."""
import os
import tempfile
import unittest
from unittest.mock import patch


@unittest.skipUnless(os.name == 'nt', 'Win32 file handles')
class WindowsStorageIdentityTests(unittest.TestCase):
    def test_actual_file_is_accepted_and_a_different_identity_is_rejected(self):
        from evidence_dag.windows_secure_storage import WindowsEvidenceStorage
        with tempfile.TemporaryDirectory() as root:
            storage = WindowsEvidenceStorage(root)
            for name in ('one', 'two'):
                storage.atomic_write(os.path.join(root, name), name)
            with storage.directory(root) as parent:
                info = storage.stat_at(parent, 'one')
                expected = os.stat(os.path.join(root, 'one'))
                self.assertEqual((info.st_dev, info.st_ino), (expected.st_dev, expected.st_ino))
                other = os.stat(os.path.join(root, 'two'))
                with patch('evidence_dag.windows_secure_storage.os.stat', return_value=other):
                    with self.assertRaisesRegex(PermissionError, 'identity changed'):
                        storage.stat_at(parent, 'one')
