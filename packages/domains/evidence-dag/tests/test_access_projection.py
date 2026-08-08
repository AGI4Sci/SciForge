from __future__ import annotations

import json
import unittest

from evidence_dag.access import project_graph, project_lineage, project_prov_json
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Assessment,
    Artifact,
    ArtifactVersion,
    EdgeRel,
    NodeType,
    ReviewPacket,
    SourceAnchor,
    SourceSelector,
)
from evidence_dag.provjson import to_prov_json


SHA = "sha256:" + "a" * 64


def restricted_graph(*, scope_restricted: bool) -> tuple[ThreadGraph, str]:
    graph = ThreadGraph("restricted-thread", {
        "scope": {
            "workspaceRoot": "/CANARY/workspace/root",
            "projectRoot": "/CANARY/project/root",
            "accessPolicy": {"read": False} if scope_restricted else {"read": True},
        },
    })
    artifact_id = "artifact:restricted"
    version_id = "artifact-version:restricted"
    anchor_id = "anchor:restricted"
    graph.attach_registry_records(
        artifact=Artifact(
            artifact_id=artifact_id,
            kind="dataset",
            created_at="CANARY private artifact timestamp",
            current_version_id=version_id,
            access_policy={} if scope_restricted else {"restricted": True},
        ),
        artifact_version=ArtifactVersion(
            version_id=version_id,
            artifact_id=artifact_id,
            locator="https://example.test/CANARY-private-dataset.csv",
            content_digest=SHA,
            version="CANARY private version",
            size=1,
            media_type="CANARY/private-media-type",
            observed_at="CANARY private observation timestamp",
            availability="restricted",
            retention="CANARY private retention",
        ),
        source_anchor=SourceAnchor(
            anchor_id=anchor_id,
            artifact_id=artifact_id,
            artifact_version_id=version_id,
            selector=SourceSelector(
                type="text", line_range="1:1", quote="CANARY selector quote",
            ),
            anchor_digest=SHA,
            created_at="CANARY private anchor timestamp",
            access_policy={"restricted": True},
        ),
    )
    source = graph.add_or_get_node(
        NodeType.SOURCE_ASSERTION,
        "CANARY restricted scientific statement",
        created_by="TOP-SECRET-ACTOR",
        source_type="TOP-SECRET-SOURCE-TYPE",
        atms_label=[{"secret": "TOP-SECRET-ATMS-LABEL"}],
        artifact_id=artifact_id,
        artifact_version_id=version_id,
        source_anchor_id=anchor_id,
    )
    run = graph.add_or_get_node(
        NodeType.ANALYSIS_RUN,
        "CANARY private analysis",
        external_id="run:restricted",
        attributes={"command": "CANARY private command"},
    )
    parameters = graph.add_or_get_node(
        NodeType.PARAMETER_SET,
        "CANARY private parameters",
        external_id="parameters:restricted",
        attributes={"values": {"token": "CANARY parameter value"}},
    )
    environment = graph.add_or_get_node(
        NodeType.ENVIRONMENT,
        "CANARY private environment",
        external_id="environment:restricted",
        attributes={"env": {"PRIVATE": "CANARY environment value"}},
    )
    conclusion = graph.add_or_get_node(
        NodeType.CONCLUSION,
        "CANARY private conclusion",
        external_id="TOP-SECRET-EXTERNAL-ID",
        created_by="TOP-SECRET-ACTOR",
        attributes={"semanticRole": "conclusion", "note": "CANARY conclusion note"},
    )
    private_edge = graph.add_edge(source.id, conclusion.id, EdgeRel.SUPPORTS)
    graph.edges.pop(private_edge.id)
    private_edge.id = "CANARY-private-edge-id"
    private_edge.created_at = "CANARY private edge timestamp"
    private_edge.assessment_ids = ["TOP-SECRET-EDGE-ASSESSMENT-ID"]
    graph.edges[private_edge.id] = private_edge
    graph.add_edge(source.id, run.id, EdgeRel.GENERATED_BY)
    graph.add_edge(run.id, parameters.id, EdgeRel.USED)
    graph.add_edge(run.id, environment.id, EdgeRel.USED)
    assessment_id = "assessment:" + "b" * 24
    review_packet_id = "review-packet:" + "c" * 24
    graph.assessments.append(Assessment.from_dict({
        "assessmentId": assessment_id,
        "targetId": conclusion.id,
        "dimension": "methodology",
        "level": "A2",
        "result": "uncertain",
        "actor": "TOP-SECRET-ASSESSMENT-ACTOR",
        "method": "TOP-SECRET-ASSESSMENT-METHOD",
        "confidence": 0.9,
        "targetDigest": SHA,
        "createdAt": "2026-08-07T00:00:00Z",
        "rationale": "TOP-SECRET assessment rationale",
        "humanReview": {
            "level": "required",
            "score": 0.9,
            "status": "pending",
            "reasons": [{
                "code": "secret_reason",
                "message": "TOP-SECRET nested review reason",
            }],
            "blocking": True,
            "policyVersion": "TOP-SECRET-POLICY",
            "computedAt": "2026-08-07T00:00:00Z",
            "checker": {
                "actorType": "rule",
                "actor": "TOP-SECRET-CHECKER-ACTOR",
                "method": "TOP-SECRET-CHECKER-METHOD",
                "authority": "blocking",
            },
            "reviewPacketId": review_packet_id,
        },
    }))
    graph.review_policy_version = "TOP-SECRET-POLICY"
    graph.review_packets = [ReviewPacket.from_dict({
        "reviewPacketId": review_packet_id,
        "level": "required",
        "score": 0.9,
        "status": "pending",
        "reasons": [{
            "code": "secret_reason",
            "message": "TOP-SECRET packet reason",
        }],
        "blocking": True,
        "policyVersion": "TOP-SECRET-POLICY",
        "computedAt": "2026-08-07T00:00:00Z",
        "targetIds": [conclusion.id],
        "assessmentIds": [assessment_id],
        "checker": {
            "actorType": "rule",
            "actor": "TOP-SECRET-PACKET-ACTOR",
            "method": "TOP-SECRET-PACKET-METHOD",
            "authority": "blocking",
        },
        "question": "TOP-SECRET review question",
        "machineChecks": [{
            "assessmentId": assessment_id,
            "targetId": conclusion.id,
            "message": "TOP-SECRET machine check",
        }],
        "delta": {"secret": "TOP-SECRET delta"},
        "blastRadius": {"secret": "TOP-SECRET blast radius"},
        "recommendedAction": "TOP-SECRET action",
        "options": [{"label": "TOP-SECRET option"}],
        "reviewedBy": "TOP-SECRET HUMAN ACTOR",
    })]
    return graph, conclusion.id


class AccessProjectionTests(unittest.TestCase):
    def assert_canaries_absent(self, value: object) -> None:
        rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
        self.assertNotIn("CANARY", rendered)
        self.assertNotIn("TOP-SECRET", rendered)
        self.assertNotIn("private-dataset", rendered)
        self.assertNotIn("/workspace/root", rendered)
        self.assertNotIn("/project/root", rendered)

    def test_scope_restriction_redacts_graph_lineage_and_prov_before_serialization(self):
        graph, conclusion_id = restricted_graph(scope_restricted=True)
        graph_view = project_graph(graph)
        lineage_view = project_lineage(
            graph, graph.conclusion_lineage(conclusion_id),
        )
        prov_view = project_prov_json(graph, to_prov_json(graph))
        self.assert_canaries_absent(graph_view)
        self.assert_canaries_absent(lineage_view)
        self.assert_canaries_absent(prov_view)
        allowed_node_keys = {"id", "type", "content", "status", "attributes"}
        self.assertTrue(all(set(node) <= allowed_node_keys for node in graph_view["nodes"]))
        self.assertTrue(all(set(node) <= allowed_node_keys for node in lineage_view["nodes"]))
        allowed_prov_keys = {
            "prov:type", "edag:content", "edag:status", "edag:attributes",
        }
        prov_nodes = [
            node
            for section in ("entity", "activity", "agent")
            for node in prov_view[section].values()
        ]
        self.assertTrue(all(set(node) <= allowed_prov_keys for node in prov_nodes))
        allowed_registry_keys = {
            "artifacts": {
                "artifactId", "currentVersionId", "kind", "exists", "accessRestricted",
            },
            "artifactVersions": {
                "versionId", "artifactId", "supersedes", "contentDigest",
                "availability", "exists", "accessRestricted",
            },
            "sourceAnchors": {
                "anchorId", "artifactId", "artifactVersionId", "anchorDigest",
                "exists", "accessRestricted",
            },
        }
        for document, registry_key in (
            (graph_view, "artifact_registry"),
            (lineage_view, "artifactRegistry"),
            (prov_view, "edag:artifactRegistry"),
        ):
            registry = document[registry_key]
            for collection, allowed in allowed_registry_keys.items():
                self.assertTrue(all(
                    set(item) <= allowed for item in registry[collection]
                ))
        allowed_assessment_keys = {
            "assessmentId", "targetId", "result", "humanReview", "accessRestricted",
        }
        self.assertTrue(all(
            set(item) <= allowed_assessment_keys and item["accessRestricted"] is True
            for item in graph_view["assessments"]
        ))
        self.assertTrue(all(
            set(item) <= allowed_assessment_keys and item["accessRestricted"] is True
            for item in prov_view["edag:assessments"]
        ))
        review = graph_view["humanReview"]
        self.assertEqual(review["accessRestricted"], True)
        self.assertNotIn("checker", review)
        self.assertNotIn("reasons", review)
        self.assertNotIn("options", review["reviewPackets"][0])
        self.assertNotIn("question", review["reviewPackets"][0])
        self.assertNotIn("reviewedBy", review["reviewPackets"][0])
        self.assertEqual(review, prov_view["edag:humanReview"])

    def test_restricted_artifact_redacts_its_connected_derived_context(self):
        graph, conclusion_id = restricted_graph(scope_restricted=False)
        projected = project_lineage(graph, graph.conclusion_lineage(conclusion_id))
        graph_view = project_graph(graph)
        prov_view = project_prov_json(graph, to_prov_json(graph))
        self.assert_canaries_absent(projected)
        for view in (graph_view, prov_view):
            rendered = json.dumps(view, ensure_ascii=False, sort_keys=True)
            self.assertNotIn("TOP-SECRET", rendered)
            self.assertNotIn("private-dataset", rendered)
        self.assertTrue(all(
            node["attributes"].get("accessRestricted") is True
            for node in projected["nodes"]
        ))
        self.assertTrue(all(
            assessment.get("accessRestricted") is True
            for assessment in projected["assessments"]
        ))
        self.assertTrue(graph_view["humanReview"]["accessRestricted"])
        self.assertEqual(
            graph_view["humanReview"], prov_view["edag:humanReview"],
        )


if __name__ == "__main__":
    unittest.main()
