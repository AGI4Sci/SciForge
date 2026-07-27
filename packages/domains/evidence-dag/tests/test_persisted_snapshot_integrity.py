"""Fail-closed integrity checks for persisted Evidence Snapshot reads."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest

from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Artifact,
    ArtifactVersion,
    EdgeRel,
    NodeStatus,
    NodeType,
    SourceAnchor,
    SourceSelector,
)
from evidence_dag.service import Engine
from evidence_dag.snapshot import build_snapshot, snapshot_filename, snapshot_storage_key


def _sha(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _snapshot(thread_id: str, version: int, source_text: str) -> tuple[dict, dict]:
    graph = ThreadGraph(thread_id)
    artifact_id = "artifact:test"
    version_id = "artifact-version:test-v1"
    anchor_id = "anchor:test-lines"
    graph.attach_registry_records(
        artifact=Artifact(
            artifact_id=artifact_id,
            kind="other",
            created_at="2026-07-11T00:00:00Z",
            current_version_id=version_id,
        ),
        artifact_version=ArtifactVersion(
            version_id=version_id,
            artifact_id=artifact_id,
            locator="evidence/source.txt",
            content_digest=_sha("immutable bytes"),
            version="v1",
            size=15,
            media_type="text/plain",
            observed_at="2026-07-11T00:00:00Z",
            availability="available",
            retention="reference",
        ),
        source_anchor=SourceAnchor(
            anchor_id=anchor_id,
            artifact_id=artifact_id,
            artifact_version_id=version_id,
            selector=SourceSelector(type="text", line_range="1:2", quote=source_text),
            anchor_digest=_sha(source_text),
            created_at="2026-07-11T00:00:00Z",
        ),
    )
    source = graph.add_or_get_node(
        NodeType.SOURCE_ASSERTION,
        source_text,
        artifact_id=artifact_id,
        artifact_version_id=version_id,
        source_anchor_id=anchor_id,
        status=NodeStatus.SUPPORTED,
    )
    claim = graph.add_or_get_node(
        NodeType.CLAIM, "The result is supported.", status=NodeStatus.SUPPORTED,
    )
    graph.add_edge(source.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.95)
    snapshot = build_snapshot(graph, version=version, input_watermark=f"turn:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    return json.loads(provjson.dumps(graph)), snapshot.to_dict()


class PersistedSnapshotIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_current(self, thread_id: str, document: dict) -> None:
        with open(
            os.path.join(self.tmp.name, snapshot_filename(thread_id)), "w", encoding="utf-8",
        ) as handle:
            json.dump(document, handle, ensure_ascii=False)

    def _write_historical(self, thread_id: str, digest: str, document: dict) -> None:
        directory = os.path.join(self.tmp.name, "snapshots", snapshot_storage_key(thread_id))
        os.makedirs(directory, exist_ok=True)
        with open(
            os.path.join(directory, f"00000001-{digest[7:]}.prov.json"),
            "w",
            encoding="utf-8",
        ) as handle:
            json.dump(document, handle, ensure_ascii=False)

    def test_valid_current_snapshot_loads(self) -> None:
        thread_id = "sciforge:valid"
        document, snapshot = _snapshot(thread_id, 1, "Measured effect")
        self._write_current(thread_id, document)

        graph = Engine(storage_dir=self.tmp.name).require(thread_id)

        self.assertEqual(graph.meta["snapshot"]["digest"], snapshot["digest"])

    def test_current_graph_and_registry_tampering_are_rejected(self) -> None:
        thread_id = "sciforge:tampered"
        document, _ = _snapshot(thread_id, 1, "Measured effect")
        claim = next(
            item for item in document["entity"].values()
            if item.get("prov:type") == "edag:claim"
        )
        claim["edag:content"] = "Tampered conclusion"
        self._write_current(thread_id, document)
        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            Engine(storage_dir=self.tmp.name).require(thread_id)

        document, _ = _snapshot(thread_id, 1, "Measured effect")
        document["edag:artifactRegistry"]["artifactVersions"][0]["locator"] = "../secret.txt"
        self._write_current(thread_id, document)
        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            Engine(storage_dir=self.tmp.name).require(thread_id)

    def test_artifact_digest_envelope_tampering_is_rejected(self) -> None:
        thread_id = "sciforge:artifact-envelope"
        document, _ = _snapshot(thread_id, 1, "Measured effect")
        document["edag:meta"]["snapshot"]["artifactDigests"] = [_sha("other bytes")]
        self._write_current(thread_id, document)

        with self.assertRaisesRegex(ValueError, "artifactDigests mismatch"):
            Engine(storage_dir=self.tmp.name).require(thread_id)

    def test_historical_snapshot_tampering_is_rejected(self) -> None:
        thread_id = "sciforge:history"
        historical, first = _snapshot(thread_id, 1, "Original evidence")
        current, second = _snapshot(thread_id, 2, "Updated evidence")
        source = next(
            item for item in historical["entity"].values()
            if item.get("prov:type") == "edag:source_assertion"
        )
        source["edag:content"] = "Tampered historical evidence"
        self._write_historical(thread_id, first["digest"], historical)
        self._write_current(thread_id, current)

        engine = Engine(storage_dir=self.tmp.name)
        self.assertEqual(engine.latest_snapshot(thread_id).digest, second["digest"])
        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            engine.snapshot_graph(thread_id, first["digest"])


if __name__ == "__main__":
    unittest.main()
