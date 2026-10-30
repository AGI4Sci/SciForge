import json
import unittest

from evidence_dag.artifact_versions import (
    ArtifactVersionProjectionClient,
    ArtifactVersionProjectionError,
    ArtifactVersionRefV1,
)
from evidence_dag.extractor import extract_dag
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import NodeType
from evidence_dag.provjson import dumps, loads
from evidence_dag.service import Engine
from evidence_dag.snapshot import compute_snapshot_digest


NOW = "2026-08-06T08:00:00Z"
ACCESS = {"visibility": "workspace", "principals": [], "allowExport": True}


def ref(version="one", digest="a", availability="available"):
    return {
        "artifactId": f"artifact:{version}",
        "versionId": f"artifact-version:{version}-1",
        "contentDigest": digest * 64,
        "byteLength": 12,
        "mediaType": "text/csv",
        "availability": availability,
        "retention": "reference",
        "accessPolicy": ACCESS,
    }


def ready_item(trace_id, version="one", digest="a", events=None):
    pinned = ref(version, digest)
    return {
        "id": trace_id,
        "type": "tool_result",
        "output": "estimate,value\nmean,4.2",
        "evidenceArtifactVersions": {
            "status": "ready",
            "versions": [{
                "ref": pinned,
                "kind": "dataset",
                "locator": f"workspace:data/{version}.csv",
                "observedAt": NOW,
            }],
            "lifecycleEvents": events or [],
            "lastSequence": max([event["sequence"] for event in events or []], default=0),
        },
    }


class StaticLLM:
    def __init__(self, payload):
        self.payload = payload

    def chat(self, *_args, **_kwargs):
        return json.dumps(self.payload)


def extracted_graph(trace, thread_id="thread:projection"):
    payload = {
        "nodes": [{
            "tmp_id": "source",
            "type": "source_assertion",
            "content": "The reported mean is 4.2.",
            "trace_ref": trace[0]["id"],
            "source_type": "dataset",
            "credibility": "high",
        }],
        "edges": [],
    }
    projection = ArtifactVersionProjectionClient(trace)
    return extract_dag(
        trace, StaticLLM(payload), thread_id, artifact_versions=projection,
    ), projection


class TestArtifactVersionProjection(unittest.TestCase):
    def test_two_pinned_fixture_refs_round_trip_without_identity_rewrite(self):
        trace = [ready_item("fixture:a", "one", "a"), ready_item("fixture:b", "two", "b")]
        projection = ArtifactVersionProjectionClient(trace)
        self.assertEqual(set(projection.refs), {
            "artifact-version:one-1", "artifact-version:two-1",
        })

        graph, _ = extracted_graph(trace[:1])
        restored = loads(dumps(graph))
        self.assertEqual(
            restored.artifact_version_refs["artifact-version:one-1"].to_dict(),
            ref("one", "a"),
        )
        source = next(iter(restored.nodes.values()))
        self.assertEqual(source.artifact_version_id, "artifact-version:one-1")

    def test_ref_validation_is_strict_and_requires_access_policy(self):
        self.assertEqual(ArtifactVersionRefV1.from_dict(ref()).content_digest, "a" * 64)
        with self.assertRaises(ArtifactVersionProjectionError):
            ArtifactVersionRefV1.from_dict({**ref(), "contentDigest": f"sha256:{'a' * 64}"})
        without_policy = ref()
        without_policy.pop("accessPolicy")
        with self.assertRaises(ArtifactVersionProjectionError):
            ArtifactVersionRefV1.from_dict(without_policy)

    def test_lifecycle_events_mark_pins_stale_or_needing_review(self):
        graph, _ = extracted_graph([ready_item("fixture:a")])
        source = next(iter(graph.nodes.values()))
        event_only = [{
            "id": "lifecycle:1",
            "evidenceArtifactVersions": {
                "status": "ready",
                "versions": [],
                "lastSequence": 8,
                "lifecycleEvents": [{
                    "schemaVersion": 1,
                    "eventId": "artifact-event:changed",
                    "sequence": 8,
                    "type": "artifact-content-changed",
                    "artifactId": "artifact:one",
                    "versionId": "artifact-version:one-1",
                    "createdAt": NOW,
                    "detail": {
                        "previousContentDigest": "a" * 64,
                        "contentDigest": "c" * 64,
                    },
                }],
            },
        }]
        Engine()._sync_artifact_versions(
            graph, ArtifactVersionProjectionClient(event_only),
        )
        self.assertEqual(source.freshness, "stale")
        self.assertTrue(source.attributes["artifactVersionReviewRequired"])
        self.assertEqual(graph.meta["artifactVersionLifecycleWatermark"], 8)
        self.assertEqual(source.artifact_version_id, "artifact-version:one-1")
        self.assertEqual(
            graph.artifact_version_refs[source.artifact_version_id].content_digest,
            "a" * 64,
        )
        # A later compile with no lifecycle observation cannot silently clear
        # a previously proven stale state.
        Engine()._sync_artifact_versions(graph, ArtifactVersionProjectionClient([]))
        self.assertEqual(source.freshness, "stale")

    def test_lifecycle_backlog_is_explicit_and_fails_closed(self):
        graph, _ = extracted_graph([ready_item("fixture:a")])
        source = next(iter(graph.nodes.values()))
        backlog = [{
            "id": "lifecycle:backlog",
            "evidenceArtifactVersions": {
                "status": "ready",
                "versions": [],
                "lifecycleEvents": [],
                "lastSequence": 512,
                "lifecyclePending": True,
            },
        }]
        Engine()._sync_artifact_versions(
            graph, ArtifactVersionProjectionClient(backlog),
        )
        self.assertEqual(source.freshness, "stale")
        self.assertEqual(source.attributes["artifactVersionReviewReason"], "lifecycle-backlog")

    def test_pending_projection_fails_closed_at_l0(self):
        trace = [{
            "id": "fixture:pending",
            "type": "tool_result",
            "output": "The reported mean is 4.2.",
            "evidenceArtifactVersions": {
                "status": "pending",
                "reason": "Producer has not supplied digest and byte length.",
                "lifecycleEvents": [],
                "lastSequence": 0,
            },
        }]
        graph, _ = extracted_graph(trace)
        source = next(iter(graph.nodes.values()))
        path = graph.provenance_path(source.id)
        self.assertEqual(path["provenanceLevel"], "L0")
        self.assertEqual(source.attributes["artifactVersionProvenanceStatus"], "pending")
        self.assertIn("artifact_version_pending", {
            item["reason"] for item in path["breakpoints"]
        })

    def test_old_snapshot_without_public_refs_keeps_its_digest(self):
        graph = ThreadGraph("thread:legacy")
        graph.add_or_get_node(NodeType.CLAIM, "Legacy claim", trace_ref="legacy:1")
        before = compute_snapshot_digest(graph, input_watermark="1")
        restored = loads(dumps(graph))
        self.assertFalse(restored.artifact_version_refs)
        self.assertEqual(compute_snapshot_digest(restored, input_watermark="1"), before)


if __name__ == "__main__":
    unittest.main()
