"""Regression tests for bounded immutable Evidence Snapshot persistence."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest

from evidence_dag.snapshot_storage import (
    FORMAT,
    atomic_publish_latest,
    read_snapshot_text,
    write_snapshot,
)


def _large_document(lines: int, changed_line: int | None = None) -> str:
    values = []
    for index in range(lines):
        seed = f"evidence-node-{index:08d}"
        value = hashlib.sha256(seed.encode()).hexdigest() * 8
        if index == changed_line:
            value = "f" * len(value)
        values.append({"id": index, "evidence": value})
    return json.dumps({"nodes": values}, ensure_ascii=False, indent=2)


def _blob_bytes(root: str) -> int:
    directory = os.path.join(root, "snapshot-blobs")
    total = 0
    for current, _, files in os.walk(directory):
        total += sum(os.path.getsize(os.path.join(current, name)) for name in files)
    return total


class SnapshotStorageTests(unittest.TestCase):
    def test_tiny_update_reuses_large_immutable_snapshot_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as storage:
            directory = os.path.join(storage, "snapshots", "thread")
            os.makedirs(directory)
            first_path = os.path.join(directory, "00000001-a.prov.json")
            second_path = os.path.join(directory, "00000002-b.prov.json")
            first = _large_document(30000)
            second = _large_document(30000, changed_line=15000)

            write_snapshot(first_path, first, storage_dir=storage)
            first_blob_bytes = _blob_bytes(storage)
            write_snapshot(second_path, second, storage_dir=storage)
            incremental_blob_bytes = _blob_bytes(storage) - first_blob_bytes

            self.assertGreater(len(first.encode()), 15 * 1024 * 1024)
            # A local edit can replace the containing chunk and a bounded
            # resynchronisation window, not another graph-sized full copy.
            self.assertLess(incremental_blob_bytes, 8 * 1024 * 1024)
            self.assertEqual(read_snapshot_text(first_path, storage_dir=storage), first)
            self.assertEqual(read_snapshot_text(second_path, storage_dir=storage), second)
            with open(second_path, encoding="utf-8") as handle:
                self.assertEqual(json.load(handle)["format"], FORMAT)

    def test_latest_is_an_atomic_link_to_exact_immutable_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as storage:
            immutable = os.path.join(storage, "snapshots", "thread", "v1.prov.json")
            latest = os.path.join(storage, "thread.prov.json")
            content = '{"exact":"snapshot"}'
            write_snapshot(immutable, content, storage_dir=storage)

            atomic_publish_latest(immutable, latest)

            self.assertEqual(os.stat(latest).st_ino, os.stat(immutable).st_ino)
            self.assertEqual(read_snapshot_text(latest, storage_dir=storage), content)

    def test_legacy_full_snapshot_remains_readable(self) -> None:
        with tempfile.TemporaryDirectory() as storage:
            path = os.path.join(storage, "legacy.prov.json")
            content = '{"edag:meta":{"snapshot":{"status":"committed"}}}'
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)
            self.assertEqual(read_snapshot_text(path, storage_dir=storage), content)


if __name__ == "__main__":
    unittest.main()
