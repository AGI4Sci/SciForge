from __future__ import annotations

import hashlib
import json
import unittest

from evidence_dag.artifact_versions import ArtifactVersionRefV1
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Artifact,
    ArtifactVersion,
    NodeType,
    SourceAnchor,
    SourceSelector,
)
from evidence_dag.products import PRODUCT_ORDER, export_snapshot_products
from evidence_dag.service import Engine
from evidence_dag.snapshot import build_snapshot


NOW = "2026-08-06T08:00:00Z"
SOURCE = b"pinned source bytes"
SOURCE_DIGEST = hashlib.sha256(SOURCE).hexdigest()


def datacite_metadata() -> dict:
    return {
        "doi": "10.12345/sciforge.snapshot",
        "title": "Pinned SciForge Evidence Snapshot",
        "creators": [{
            "name": "Researcher, Ada",
            "nameType": "Personal",
            "givenName": "Ada",
            "familyName": "Researcher",
            "orcid": "0000-0002-1825-0097",
        }],
        "publisher": "SciForge Test Laboratory",
        "publicationYear": 2026,
        "projectId": "project:snapshot-products",
        "resourceType": "Evidence Snapshot",
        "language": "en",
    }


def graph_and_snapshot():
    graph = ThreadGraph("codex:thread-products")
    access_policy = {
        "visibility": "workspace", "principals": [], "allowExport": True,
    }
    artifact = Artifact(
        artifact_id="artifact:source", kind="paper", created_at=NOW,
        current_version_id="artifact-version:source-1", access_policy=access_policy,
    )
    version = ArtifactVersion(
        version_id="artifact-version:source-1", artifact_id=artifact.artifact_id,
        locator="workspace:source.txt", content_digest=f"sha256:{SOURCE_DIGEST}",
        version="1", size=len(SOURCE), media_type="text/plain", observed_at=NOW,
        availability="available", retention="snapshot",
    )
    ref = ArtifactVersionRefV1(
        artifact_id=artifact.artifact_id, version_id=version.version_id,
        content_digest=SOURCE_DIGEST, byte_length=len(SOURCE), media_type="text/plain",
        availability="available", retention="snapshot", access_policy=access_policy,
    )
    anchor = SourceAnchor(
        anchor_id="anchor:source-1", artifact_id=artifact.artifact_id,
        artifact_version_id=version.version_id,
        selector=SourceSelector(type="text", line_range="1:1"),
        anchor_digest=f"sha256:{hashlib.sha256(SOURCE).hexdigest()}", created_at=NOW,
    )
    graph.attach_registry_records(
        artifact=artifact, artifact_version=version, source_anchor=anchor,
        artifact_version_ref=ref,
    )
    graph.add_or_get_node(
        NodeType.SOURCE_ASSERTION, "Pinned source assertion.",
        artifact_id=artifact.artifact_id, artifact_version_id=version.version_id,
        source_anchor_id=anchor.anchor_id, trace_ref="trace:source",
    )
    # Deliberately incomplete: the export must explain breakpoints and must not
    # claim L4 merely because a run node exists.
    graph.add_or_get_node(
        NodeType.ANALYSIS_RUN, "Unpinned analysis run.",
        external_id="run:incomplete", identity_scope="run:incomplete",
        attributes={"parametersDeclared": False, "status": "completed"},
    )
    snapshot = build_snapshot(graph, version=1, input_watermark="1")
    graph.meta["snapshot"] = snapshot.to_dict()
    return graph, snapshot


class TestSnapshotProducts(unittest.TestCase):
    def test_all_products_are_deterministic_and_bound_to_exact_snapshot(self):
        graph, snapshot = graph_and_snapshot()
        first = export_snapshot_products(graph, snapshot, datacite_metadata())
        second = export_snapshot_products(graph, snapshot, datacite_metadata())

        self.assertEqual(first, second)
        self.assertEqual(first["threadId"], graph.thread_id)
        self.assertEqual(first["snapshotDigest"], snapshot.digest)
        self.assertEqual(
            tuple(item["product"] for item in first["products"]), PRODUCT_ORDER,
        )
        self.assertEqual(first["sourceArtifactVersionRefs"][0]["versionId"],
                         "artifact-version:source-1")
        for product in first["products"]:
            content = product["content"].encode("utf-8")
            self.assertEqual(product["byteLength"], len(content))
            self.assertEqual(product["contentDigest"], hashlib.sha256(content).hexdigest())

        audit = json.loads(next(
            item["content"] for item in first["products"]
            if item["product"] == "audit-report"
        ))
        self.assertEqual(audit["snapshotDigest"], snapshot.digest)
        self.assertEqual(audit["bindingStatus"], "generated-for-exact-snapshot")
        self.assertFalse(audit["stale"])

        reproduction = json.loads(next(
            item["content"] for item in first["products"]
            if item["product"] == "reproduction-report"
        ))
        self.assertEqual(reproduction["status"], "incomplete")
        self.assertFalse(reproduction["complete"])
        self.assertIsNone(reproduction["level"])
        self.assertTrue(reproduction["breakpoints"])

        datacite = json.loads(next(
            item["content"] for item in first["products"]
            if item["product"] == "datacite"
        ))
        relations = datacite["data"]["attributes"]["relatedIdentifiers"]
        self.assertTrue(any(
            item["relationType"] == "IsMetadataFor" and snapshot.digest.replace(":", "%3A")
            in item["relatedIdentifier"]
            for item in relations
        ))

    def test_engine_rejects_a_different_or_unknown_snapshot_digest(self):
        graph, snapshot = graph_and_snapshot()
        engine = Engine()
        engine._graphs[graph.thread_id] = graph
        engine._snapshots[graph.thread_id] = snapshot
        with self.assertRaises(KeyError):
            engine.export_snapshot_products(
                graph.thread_id,
                snapshot_digest="sha256:" + "0" * 64,
                datacite_metadata=datacite_metadata(),
            )

    def test_missing_exact_source_ref_fails_closed(self):
        graph, _ = graph_and_snapshot()
        graph.artifact_version_refs.clear()
        snapshot = build_snapshot(graph, version=2, input_watermark="2")
        graph.meta["snapshot"] = snapshot.to_dict()
        with self.assertRaisesRegex(ValueError, "pinned ArtifactVersionRef is missing"):
            export_snapshot_products(graph, snapshot, datacite_metadata())

    def test_datacite_required_metadata_is_never_inferred(self):
        graph, snapshot = graph_and_snapshot()
        metadata = datacite_metadata()
        metadata.pop("doi")
        with self.assertRaisesRegex(ValueError, "DOI is required"):
            export_snapshot_products(graph, snapshot, metadata)


if __name__ == "__main__":
    unittest.main()
