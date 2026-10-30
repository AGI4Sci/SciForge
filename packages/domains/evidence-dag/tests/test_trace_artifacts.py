"""Boundary tests for trace provenance after Artifact Versions extraction."""
from __future__ import annotations

import json
import unittest

from evidence_dag.artifact_versions import ArtifactVersionProjectionClient
from evidence_dag.extractor import extract_dag
from evidence_dag.model import NodeType


NOW = "2026-08-06T08:00:00Z"
ACCESS = {"visibility": "workspace", "principals": [], "allowExport": True}


class StaticLLM:
    def __init__(self, locator=None):
        artifact = {"kind": "dataset", "locator": locator} if locator else None
        node = {
            "tmp_id": "source", "type": "source_assertion",
            "content": "The dataset reports 4.2.", "trace_ref": "tool-1",
            "source_type": "dataset", "credibility": "high",
        }
        if artifact:
            node["artifact"] = artifact
        self.response = json.dumps({"nodes": [node], "edges": []})

    def chat(self, *_args, **_kwargs):
        return self.response


def pinned_trace():
    return [{
        "id": "tool-1",
        "type": "tool_result",
        "output": {"content": "The dataset reports 4.2.", "path": "data.csv"},
        "evidenceArtifactVersions": {
            "status": "ready",
            "versions": [{
                "ref": {
                    "artifactId": "artifact:trace-data",
                    "versionId": "artifact-version:trace-data-1",
                    "contentDigest": "a" * 64,
                    "byteLength": 25,
                    "mediaType": "text/csv",
                    "availability": "available",
                    "retention": "reference",
                    "accessPolicy": ACCESS,
                },
                "kind": "dataset",
                "locator": "workspace:data.csv",
                "observedAt": NOW,
            }],
            "lifecycleEvents": [],
            "lastSequence": 0,
        },
    }]


class TestTraceArtifactVersionBoundary(unittest.TestCase):
    def test_raw_locator_is_not_hashed_or_registered_by_evidence(self):
        trace = [{
            "id": "tool-1", "type": "tool_result",
            "output": {"content": "The dataset reports 4.2.", "path": "data.csv"},
        }]
        graph = extract_dag(
            trace, StaticLLM("data.csv"), "thread:raw",
            artifact_versions=ArtifactVersionProjectionClient(trace),
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        self.assertIsNone(source.artifact_id)
        self.assertEqual(graph.provenance_path(source.id)["provenanceLevel"], "L0")

    def test_exact_pinned_ref_is_attached_without_rewriting_digest_or_identity(self):
        trace = pinned_trace()
        graph = extract_dag(
            trace, StaticLLM("workspace:data.csv"), "thread:pinned",
            artifact_versions=ArtifactVersionProjectionClient(trace),
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        self.assertEqual(source.artifact_id, "artifact:trace-data")
        self.assertEqual(source.artifact_version_id, "artifact-version:trace-data-1")
        self.assertEqual(
            graph.artifact_version_refs[source.artifact_version_id].content_digest,
            "a" * 64,
        )
        self.assertEqual(
            graph.artifact_versions[source.artifact_version_id].content_digest,
            "sha256:" + "a" * 64,
        )

    def test_ambiguous_trace_projection_fails_closed(self):
        trace = pinned_trace()
        second = json.loads(json.dumps(trace[0]["evidenceArtifactVersions"]["versions"][0]))
        second["ref"]["artifactId"] = "artifact:other"
        second["ref"]["versionId"] = "artifact-version:other-1"
        second["locator"] = "workspace:other.csv"
        trace[0]["evidenceArtifactVersions"]["versions"].append(second)
        graph = extract_dag(
            trace, StaticLLM(), "thread:ambiguous",
            artifact_versions=ArtifactVersionProjectionClient(trace),
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        self.assertEqual(source.freshness, "stale")
        self.assertEqual(source.attributes["artifactVersionProvenanceStatus"], "failed")
        self.assertEqual(graph.provenance_path(source.id)["provenanceLevel"], "L0")


if __name__ == "__main__":
    unittest.main()
