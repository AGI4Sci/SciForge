from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from evidence_dag.artifact_versions import ArtifactVersionProjectionClient
from evidence_dag.analysis import analyze
from evidence_dag.audit import run_audit
from evidence_dag.graph import ThreadGraph
from evidence_dag.lineage import ingest_trace_lineage
from evidence_dag.model import EdgeRel, NodeType
from evidence_dag.metrics import provenance_coverage
from evidence_dag.provjson import from_prov_json, to_prov_json
from evidence_dag.rocrate import export_ro_crate, import_ro_crate
from evidence_dag.reconcile import reconcile
from evidence_dag.service import Engine
from evidence_dag.rerun import (
    RERUN_SCHEMA_VERSION,
    build_rerun_spec,
    compare_rerun_specs,
    output_values_for_spec,
    validate_rerun_spec,
)
from evidence_dag import rerun as rerun_module
from evidence_dag.snapshot import build_snapshot


SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
SHA_C = "sha256:" + "c" * 64
SHA_D = "sha256:" + "d" * 64
SHA_E = "sha256:" + "e" * 64
PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def artifact_version_projection(
    *, workspace_roots=(), locator_root=None,
) -> ArtifactVersionProjectionClient:
    """Build an empty read-only owner projection for DAG-only unit fixtures."""
    return ArtifactVersionProjectionClient(
        [], workspace_roots=workspace_roots, locator_root=locator_root,
    )


def rehash_rerun_body(spec: dict) -> None:
    for activity in spec["activities"]:
        activity.update(rerun_module._generic_activity_fingerprints(activity))
    spec["specDigest"] = rerun_module._digest({
        key: value for key, value in spec.items() if key != "specDigest"
    })


def create_loop_executor_payload(
    *, output_digest: str = SHA_D, output_value=None, comparator: dict | None = None,
    include_approval: bool = False,
) -> dict:
    """A complete producer-owned payload accepted by Create Loop itself.

    The test intentionally builds this from the public JSON contract rather
    than importing Create Loop's private implementation.
    """
    approval_node = {
        "id": "workflow-run:42", "name": "Release approval",
        "type": "human-approval",
        "position": {"x": 400, "y": 0}, "disabled": False,
        "config": {
            "title": "Approve rerun result",
            "instruction": "Review the reproduced result before release.",
            "timeoutMs": 0,
            "onTimeout": "rejected",
        },
    }
    approval_requirement = {
        "id": "approval:workflow-run:42",
        "kind": "workflow-human-approval",
        "subjectId": "workflow-run:42",
        "mode": "human-decision",
        "freshDecisionRequired": True,
        "policyDigest": rerun_module._digest({
            "title": approval_node["config"]["title"],
            "instruction": approval_node["config"]["instruction"],
            "timeoutMs": approval_node["config"]["timeoutMs"],
            "onTimeout": approval_node["config"]["onTimeout"],
        }),
    }
    workflow = {
        "id": "workflow:primary",
        "name": "Primary workflow",
        "env": [],
        "nodes": [
            {
                "id": "trigger", "name": "Manual", "type": "manual-trigger",
                "position": {"x": 0, "y": 0}, "disabled": False,
                "config": {"workspaceRoot": "", "inputSchema": []},
            },
            {
                "id": "template", "name": "Template", "type": "template",
                "position": {"x": 200, "y": 0}, "disabled": False,
                "config": {"template": "{{text}}", "outputMode": "text"},
            },
            *([approval_node] if include_approval else []),
            {
                "id": "output", "name": "Output", "type": "output",
                "position": {"x": 600 if include_approval else 400, "y": 0},
                "disabled": False,
                "config": {"mode": "auto", "textTemplate": "", "jsonPath": ""},
            },
        ],
        "connections": [
            {
                "id": "edge-1", "source": "trigger", "sourceHandle": "",
                "target": "template", "targetHandle": "",
            },
            {
                "id": "edge-2", "source": "template", "sourceHandle": "",
                "target": "workflow-run:42" if include_approval else "output",
                "targetHandle": "",
            },
            *([{
                "id": "edge-3", "source": "workflow-run:42", "sourceHandle": "",
                "target": "output", "targetHandle": "",
            }] if include_approval else []),
        ],
    }
    run_input = {"records": [1, 2, 3]}
    context = {
        "workspaceRoot": "/workspace",
        "packageOwner": "sciforge.create-loop",
        "packageVersion": "1.0.0",
        "nodeVersion": "v24.0.0",
        "platform": "darwin",
        "architecture": "arm64",
        "environment": [],
    }
    baseline_output = (
        output_value if output_value is not None
        else {"fixtureOutput": output_digest}
    )
    workflow_fingerprint = rerun_module._digest(workflow)
    input_fingerprint = rerun_module._digest(run_input)
    context_fingerprint = rerun_module._digest(context)
    output_fingerprint = rerun_module._digest(baseline_output)
    output_comparator = comparator or {"kind": "exact-digest"}
    spec_fingerprint = rerun_module._digest({
        "workflowFingerprint": workflow_fingerprint,
        "inputFingerprint": input_fingerprint,
        "contextFingerprint": context_fingerprint,
        "approvalRequirements": [approval_requirement] if include_approval else [],
        "comparator": output_comparator,
    })
    return {
        "schemaVersion": "sciforge.create-loop.executor.v1",
        "workflow": workflow,
        "input": run_input,
        "context": context,
        "baseline": {
            "runId": "baseline-run",
            "workflowFingerprint": workflow_fingerprint,
            "inputFingerprint": input_fingerprint,
            "specFingerprint": spec_fingerprint,
            "contextFingerprint": context_fingerprint,
            "outputFingerprint": output_fingerprint,
            "outputJson": rerun_module._canonical_json(baseline_output),
            "approvalFingerprint": rerun_module._digest([]),
            "nodeResults": [],
        },
    }


def lineage_envelope(
    *,
    output_digest: str = SHA_D,
    stochastic: bool = False,
    comparator: dict | None = None,
    output_value=None,
    include_approval: bool = True,
) -> dict:
    executor_payload = create_loop_executor_payload(
        output_digest=output_digest, output_value=output_value, comparator=comparator,
        include_approval=include_approval,
    )
    return {
        "workflowRun": {
            "id": "workflow-run:42",
            "name": "Primary workflow",
            "status": "completed",
            "parameters": {"alpha": 0.05},
            "stochastic": stochastic,
            "inputFingerprint": executor_payload["baseline"]["inputFingerprint"],
            "specFingerprint": executor_payload["baseline"]["specFingerprint"],
            "contextFingerprint": executor_payload["baseline"]["contextFingerprint"],
            "outputFingerprint": executor_payload["baseline"]["outputFingerprint"],
            "executor": {
                "kind": "create-loop",
                "workflow": executor_payload,
                "workflowDigest": rerun_module._digest(executor_payload),
                "target": {"kind": "workflow", "id": "workflow:primary"},
            },
        },
        "inputs": [{
            "id": "input:data:v1",
            "type": "dataset_version",
            "name": "Input data v1",
            "contentDigest": SHA_A,
            "version": "1",
        }],
        "code": [{
            "id": "software:analysis:v1",
            "type": "software_version",
            "name": "Analysis source v1",
            "contentDigest": SHA_C,
            "language": "python",
            "repository": "https://example.test/analysis.git",
            "commit": "0123456789abcdef",
        }],
        "environment": [{
            "id": "environment:oci",
            "name": "OCI environment",
            "containerDigest": SHA_B,
            "platform": "linux",
            "architecture": "arm64",
            "runtimeVersions": {"python": "3.12.4"},
        }],
        "parameters": {
            "id": "parameters:primary",
            "name": "Primary parameters",
            "values": {"alpha": 0.05},
            **({} if stochastic else {"randomSeed": 73}),
        },
        "tools": [{
            "id": "tool:statistics",
            "name": "Statistics tool",
            "providerId": "sciforge",
            "actionId": "statistics.run",
            "version": "4.2.0",
            "arguments": {"method": "welch"},
            "stochastic": stochastic,
            "supportsSeed": not stochastic,
            "parentId": "workflow-run:42",
        }],
        "approvals": ([{
            "id": "approval:workflow-run:42",
            "name": "Historical approval",
            "kind": "workflow-human-approval",
            "mode": "human-decision",
            "subjectId": "workflow-run:42",
            "status": "approved",
            "policyDigest": rerun_module._digest({
                "title": "Approve rerun result",
                "instruction": "Review the reproduced result before release.",
                "timeoutMs": 0,
                "onTimeout": "rejected",
            }),
        }] if include_approval else []),
        "outputs": [{
            "id": "artifact:result",
            "type": "artifact",
            "name": "Result table",
            "contentDigest": executor_payload["baseline"]["outputFingerprint"],
            "comparator": comparator or {"kind": "exact-digest"},
            "value": json.loads(executor_payload["baseline"]["outputJson"]),
        }],
        "evidence": [{
            "id": "evidence:finding:42",
            "type": "finding",
            "name": "The analysis supports the primary conclusion.",
        }],
        "conclusion": {
            "id": "conclusion:42",
            "name": "The treatment changes the measured endpoint.",
        },
        "relations": [
            {"src": "evidence:finding:42", "dst": "workflow-run:42", "rel": "generated_by"},
            {"src": "evidence:finding:42", "dst": "conclusion:42", "rel": "supports"},
        ],
    }


def build_graph(
    *,
    output_digest: str = SHA_D,
    stochastic: bool = False,
    comparator: dict | None = None,
    output_value=None,
    include_approval: bool = True,
):
    temp = tempfile.TemporaryDirectory()
    registry = artifact_version_projection(
        workspace_roots=(temp.name,), locator_root=temp.name,
    )
    graph = ThreadGraph("runtime:thread-42")
    delta = ingest_trace_lineage(graph, [{
        "id": "execution-result:42",
        "kind": "tool_result",
        "evidenceLineage": lineage_envelope(
            output_digest=output_digest,
            stochastic=stochastic,
            comparator=comparator,
            output_value=output_value,
            include_approval=include_approval,
        ),
    }], registry)
    conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
    snapshot = build_snapshot(graph, version=1, input_watermark="event-42")
    return temp, graph, conclusion, snapshot, delta


def create_loop_manifest_event(
    run_id: str,
    *,
    acceptance_sequence: int = 1,
    rerun_of: str | None = None,
    replication_status: str | None = None,
    control: str = "controlled",
    output_json: str = "{}",
    same_input: bool = True,
    same_spec: bool = True,
    same_context: bool = True,
    comparison_verifiable: bool = True,
) -> dict:
    payload = create_loop_executor_payload(output_digest=SHA_D)
    manifest = {
        "schema": "sciforge.create-loop.run.v2",
        "source": "rerun" if rerun_of else "workflow",
        "workflow": payload["workflow"],
        "input": payload["input"],
        "context": payload["context"],
        "comparator": {"kind": "exact-digest"},
        "determinism": {
            "control": control,
            "reasonCodes": [] if control == "controlled" else ["external_state_activity"],
            "stochasticNodeIds": [],
        },
        "workflowFingerprint": payload["baseline"]["workflowFingerprint"],
        "inputFingerprint": payload["baseline"]["inputFingerprint"],
        "specFingerprint": payload["baseline"]["specFingerprint"],
        "contextFingerprint": payload["baseline"]["contextFingerprint"],
        "outputFingerprint": SHA_D,
        "outputJson": output_json,
        "approvalFingerprint": payload["baseline"]["approvalFingerprint"],
        "artifactRefs": [],
        "approvals": [],
    }
    if rerun_of:
        manifest["rerunOfRunId"] = rerun_of
    if replication_status:
        manifest["comparison"] = {
            "classification": "match" if replication_status == "matched" else "output_changed",
            "matches": replication_status == "matched",
            "resultMatch": replication_status == "matched",
            "replicationStatus": replication_status,
            "sameInput": same_input,
            "sameSpec": same_spec,
            "sameExecutionContext": same_context,
            "comparisonVerifiable": comparison_verifiable,
            "comparator": {"kind": "exact-digest"},
            "reasonCodes": [],
            "differences": [],
        }
    event = {
        "schemaVersion": "sciforge.execution-event.v1",
        "eventId": f"event:{run_id}",
        "phase": "run_completed",
        "producer": {"moduleId": "sciforge.create-loop", "moduleVersion": "1.0.0"},
        "executionId": "workflow:primary",
        "runId": run_id,
        **({"rerunOfRunId": rerun_of} if rerun_of else {}),
        "occurredAt": "2026-08-05T10:00:00Z",
        "payload": {},
        "artifacts": [{
            "kind": "sciforge.create-loop.run-manifest",
            "runId": run_id,
            "workflowId": "workflow:primary",
            "manifest": manifest,
        }],
    }
    event["sciforgeEvidenceEvent"] = {
        "trustedBoundary": "sciforge.host.execution-completed.v1",
        "eventKind": "execution-completed",
        "hostBinding": {
            "contractVersion": 1,
            "acceptanceSequence": acceptance_sequence,
            "workspaceBinding": "unbound",
        },
        "producer": event["producer"],
        "executionId": event["executionId"],
        "runId": event["runId"],
        "runtimeId": "domain:sciforge.create-loop",
        "threadId": f"execution:{event['executionId']}",
        "occurredAt": event["occurredAt"],
        "targetWatermark": f"{acceptance_sequence}:{event['eventId']}",
    }
    return event


class TestEvidenceV3RerunSpec(unittest.TestCase):
    def test_native_conclusion_participates_in_analysis_audit_metrics_and_reconcile(self):
        graph = ThreadGraph("runtime:native-conclusion-consumers")
        source = graph.add_or_get_node(
            NodeType.SOURCE_ASSERTION, "A verifiable source assertion.",
            external_id="source:native", identity_scope="source:native",
        )
        conclusion = graph.add_or_get_node(
            NodeType.CONCLUSION, "A native v3 conclusion.",
            external_id="conclusion:native", identity_scope="conclusion:native",
            attributes={"semanticRole": "conclusion"},
        )
        graph.add_edge(source.id, conclusion.id, EdgeRel.SUPPORTS, nli_score=0.9)

        analysis = analyze(graph)
        self.assertIn(conclusion.id, {item["id"] for item in analysis["fragile"]})
        audit = run_audit(graph, run_id="audit:native")
        self.assertIn(conclusion.id, {item["target_id"] for item in audit["findings"]})
        self.assertEqual(provenance_coverage(graph), 1.0)
        impact = reconcile(graph, remove_nodes=[source.id])
        self.assertIn(conclusion.id, {item["id"] for item in impact["invalidated"]})

    def test_jcs_vectors_match_the_sdk_utf16_and_ecmascript_contract(self):
        self.assertEqual(
            rerun_module._canonical_json({
                "2": 2, "10": 10, "\ue000": 1, "😀": 2,
            }),
            '{"10":10,"2":2,"😀":2,"":1}',
        )
        self.assertEqual(
            rerun_module._canonical_json([-0.0, 1e-6, 1e-7, 1e20, 1e21]),
            '[0,0.000001,1e-7,100000000000000000000,1e+21]',
        )
        self.assertEqual(rerun_module._canonical_json(9007199254740991),
                         "9007199254740991")
        self.assertEqual(rerun_module._canonical_json(9007199254740992),
                         "9007199254740992")
        self.assertEqual(rerun_module._canonical_json(9007199254740993),
                         "9007199254740992")
        with self.assertRaisesRegex(ValueError, "binary64"):
            rerun_module._canonical_json(10 ** 400)
        with self.assertRaisesRegex(ValueError, "surrogate"):
            rerun_module._canonical_json("\ud800")

    def test_native_conclusion_lineage_reaches_all_declared_components(self):
        temp, graph, conclusion, snapshot, delta = build_graph()
        self.addCleanup(temp.cleanup)
        self.assertEqual(delta["envelopes"], 1)
        lineage = graph.conclusion_lineage(conclusion.id)
        components = lineage["coverage"]["components"]
        self.assertTrue(lineage["coverage"]["complete"])
        self.assertEqual(lineage["coverage"]["evidenceCount"], 1)
        self.assertEqual(len(components["inputs"]), 1)
        self.assertEqual(len(components["code"]), 1)
        self.assertEqual(len(components["environment"]), 1)
        self.assertEqual(len(components["parameters"]), 2)  # run + tool parameter sets
        self.assertEqual(len(components["tools"]), 1)
        self.assertEqual(len(components["approvals"]), 1)
        self.assertEqual(len(components["conclusions"]), 1)
        self.assertEqual(snapshot.schema_version, "evidence.v3")

    def test_explicit_execution_alias_links_complex_declared_lineage_without_run_id_leak(self):
        with tempfile.TemporaryDirectory() as workspace:
            graph = ThreadGraph("runtime:explicit-execution-alias")
            envelope = lineage_envelope()
            envelope["workflowRun"]["id"] = "runtime-allocated-run:one"
            envelope["evidence"] = [
                {
                    "id": "evidence:score", "type": "finding",
                    "name": "The fixed input produced the observed score.",
                    "contentDigest": SHA_A,
                },
                {
                    "id": "evidence:comparison", "type": "observation",
                    "name": "The result is inside the declared tolerance.",
                    "contentDigest": SHA_B,
                },
                {
                    "id": "evidence:artifact", "type": "artifact",
                    "name": "The immutable comparison report.",
                    "artifact": {
                        "kind": "other",
                        "locator": "runtime:sciforge.create-loop/report-v2",
                        "contentDigest": SHA_D,
                        "version": "2",
                        "retention": "reference",
                    },
                },
                {
                    "id": "evidence:environment", "type": "observation",
                    "name": "The runtime environment was locked.",
                    "contentDigest": SHA_C,
                },
            ]
            envelope.pop("conclusion")
            envelope["conclusions"] = [
                {
                    "id": "conclusion:rerun",
                    "name": "The conclusion is traceable and rerunnable.",
                },
                {
                    "id": "conclusion:package",
                    "name": "The declared evidence package is complete.",
                },
            ]
            evidence_ids = [item["id"] for item in envelope["evidence"]]
            envelope["relations"] = [
                *(
                    {"src": item, "dst": "$execution", "rel": "generated_by"}
                    for item in evidence_ids
                ),
                {"src": "evidence:score", "dst": "conclusion:rerun", "rel": "supports"},
                {"src": "evidence:comparison", "dst": "conclusion:rerun", "rel": "supports"},
                {"src": "evidence:artifact", "dst": "conclusion:package", "rel": "supports"},
                {"src": "evidence:environment", "dst": "conclusion:package", "rel": "supports"},
                {"src": "conclusion:package", "dst": "conclusion:rerun", "rel": "prerequisite"},
                {"src": "evidence:comparison", "dst": "evidence:score", "rel": "refines"},
                {"src": "evidence:artifact", "dst": "evidence:comparison", "rel": "derived_from"},
            ]

            trace = [{
                "id": "execution-result:alias",
                "kind": "tool_result",
                "evidenceLineage": envelope,
                "evidenceArtifactVersions": {
                    "status": "ready",
                    "versions": [{
                        "ref": {
                            "artifactId": "artifact:comparison-report",
                            "versionId": "artifact-version:comparison-report-v2",
                            "contentDigest": SHA_D.removeprefix("sha256:"),
                            "byteLength": 0,
                            "mediaType": "application/json",
                            "availability": "available",
                            "retention": "reference",
                            "accessPolicy": {
                                "visibility": "workspace",
                                "principals": [],
                                "allowExport": True,
                            },
                        },
                        "kind": "other",
                        "locator": "runtime:sciforge.create-loop/report-v2",
                        "observedAt": "2026-08-05T10:00:00Z",
                    }],
                    "lifecycleEvents": [],
                    "lastSequence": 0,
                },
            }]
            registry = ArtifactVersionProjectionClient(
                trace, workspace_roots=(workspace,), locator_root=workspace,
            )
            ingest_trace_lineage(graph, trace, registry)

            run = graph.nodes_of(NodeType.WORKFLOW_RUN)[0]
            self.assertEqual(run.external_id, "runtime-allocated-run:one")
            evidence = {
                node.external_id: node
                for node in graph.nodes.values()
                if node.attributes.get("semanticRole") == "evidence"
            }
            self.assertEqual(set(evidence), set(evidence_ids))
            self.assertEqual({
                edge.src for edge in graph.edges.values()
                if edge.rel == EdgeRel.GENERATED_BY and edge.dst == run.id
                and edge.src in {node.id for node in evidence.values()}
            }, {node.id for node in evidence.values()})
            artifact = evidence["evidence:artifact"]
            self.assertIsNotNone(artifact.artifact_id)
            self.assertIsNotNone(artifact.artifact_version_id)

            conclusion = next(
                node for node in graph.nodes_of(NodeType.CONCLUSION)
                if node.external_id == "conclusion:rerun"
            )
            lineage = graph.conclusion_lineage(conclusion.id)
            coverage = lineage["coverage"]
            self.assertTrue(coverage["complete"])
            self.assertEqual(coverage["evidenceCount"], 4)
            self.assertEqual(coverage["groundedEvidenceCount"], 4)
            self.assertIn(run.id, coverage["components"]["activities"])
            self.assertEqual(coverage["breakpoints"], [])

            snapshot = build_snapshot(
                graph, version=1, input_watermark="event:alias",
            )
            spec = build_rerun_spec(graph, snapshot, conclusion.id)
            self.assertTrue(spec["executionReady"])
            self.assertEqual(spec["reproducibility"], "controlled")
            self.assertEqual(
                spec["source"]["activityId"], "runtime-allocated-run:one",
            )
            self.assertNotIn("runtime-allocated-run:one", json.dumps(envelope["evidence"]))

    def test_workflow_approval_requirement_is_checked_and_then_observed(self):
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:workflow-approval")
            envelope = lineage_envelope(include_approval=False)
            envelope["workflowRun"]["approvalRequired"] = True
            ingest_trace_lineage(graph, [{
                "id": "execution-result:workflow-approval",
                "kind": "tool_result",
                "evidenceLineage": envelope,
            }], registry)
            conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
            workflow = graph.nodes_of(NodeType.WORKFLOW_RUN)[0]
            missing = graph.conclusion_lineage(conclusion.id)["coverage"]
            self.assertTrue(any(
                point["reason"] == "required_approval_not_linked"
                and workflow.id in point["nodeIds"]
                for point in missing["breakpoints"]
            ))

            decision = graph.add_or_get_node(
                NodeType.APPROVAL_DECISION, "Observed workflow approval",
                external_id="approval:workflow-observed",
                identity_scope="approval:workflow-observed",
                attributes={"observedStatus": "approved", "observedDecision": "approve"},
            )
            graph.add_edge(workflow.id, decision.id, EdgeRel.AUTHORIZED_BY)
            observed = graph.conclusion_lineage(conclusion.id)["coverage"]
            self.assertFalse(any(
                point["reason"] in {
                    "required_approval_not_linked", "required_approval_not_observed",
                }
                for point in observed["breakpoints"]
            ))
            self.assertIn(decision.id, observed["components"]["approvals"])
            self.assertTrue(observed["complete"])

    def test_conclusion_lineage_keeps_extracted_artifact_and_replication_edges(self):
        graph = ThreadGraph("runtime:replication-lineage")
        artifact = graph.add_or_get_node(
            NodeType.ARTIFACT, "Digest-only evidence artifact",
            external_id="artifact:digest-only", identity_scope="artifact:digest-only",
            attributes={"contentDigest": SHA_A, "semanticRole": "artifact"},
        )
        finding = graph.add_or_get_node(
            NodeType.FINDING, "Finding extracted from the digest-only artifact.",
            external_id="finding:replication", identity_scope="finding:replication",
            attributes={"semanticRole": "evidence"},
        )
        conclusion = graph.add_or_get_node(
            NodeType.CONCLUSION, "Conclusion backed by rerun evidence.",
            external_id="conclusion:replication", identity_scope="conclusion:replication",
            attributes={"semanticRole": "conclusion"},
        )
        baseline = graph.add_or_get_node(
            NodeType.WORKFLOW_RUN, "Baseline run",
            external_id="run:baseline", identity_scope="run:baseline",
        )
        matched = graph.add_or_get_node(
            NodeType.WORKFLOW_RUN, "Matched rerun",
            external_id="run:matched", identity_scope="run:matched",
        )
        failed = graph.add_or_get_node(
            NodeType.WORKFLOW_RUN, "Failed rerun",
            external_id="run:failed", identity_scope="run:failed",
        )
        inconclusive = graph.add_or_get_node(
            NodeType.WORKFLOW_RUN, "Inconclusive rerun",
            external_id="run:inconclusive", identity_scope="run:inconclusive",
        )
        unrelated = graph.add_or_get_node(
            NodeType.WORKFLOW_RUN, "Unrelated rerun",
            external_id="run:unrelated", identity_scope="run:unrelated",
        )
        graph.add_edge(finding.id, conclusion.id, EdgeRel.SUPPORTS)
        graph.add_edge(finding.id, artifact.id, EdgeRel.EXTRACTED_FROM)
        graph.add_edge(finding.id, baseline.id, EdgeRel.GENERATED_BY)
        graph.add_edge(matched.id, baseline.id, EdgeRel.REPLICATES)
        graph.add_edge(failed.id, baseline.id, EdgeRel.FAILS_TO_REPLICATE)
        graph.add_edge(inconclusive.id, baseline.id, EdgeRel.RERUN_OF)

        lineage = graph.conclusion_lineage(conclusion.id)
        node_ids = {node["id"] for node in lineage["nodes"]}
        relations = {edge["rel"] for edge in lineage["edges"]}
        attempt_node_ids = {
            node["id"] for node in lineage["attemptHistory"]["nodes"]
        }
        attempt_relations = {
            edge["rel"] for edge in lineage["attemptHistory"]["edges"]
        }
        self.assertIn(artifact.id, node_ids)
        self.assertIn(artifact.id, lineage["coverage"]["components"]["artifacts"])
        self.assertIn(matched.id, node_ids)
        self.assertNotIn(failed.id, node_ids)
        self.assertNotIn(inconclusive.id, node_ids)
        self.assertTrue({matched.id, failed.id, inconclusive.id}.issubset(attempt_node_ids))
        self.assertNotIn(unrelated.id, node_ids)
        self.assertTrue({"extracted_from", "replicates"}.issubset(relations))
        self.assertTrue({
            "rerun_of", "replicates", "fails_to_replicate",
        }.issubset(attempt_relations))
        self.assertTrue(lineage["coverage"]["complete"])

    def test_v3_nodes_and_edges_round_trip_through_prov_and_ro_crate(self):
        temp, graph, _conclusion, snapshot, _ = build_graph()
        self.addCleanup(temp.cleanup)
        prov = to_prov_json(graph)
        self.assertEqual(
            {record["prov:type"] for record in prov["activity"].values()},
            {"edag:workflow_run", "edag:tool_invocation"},
        )
        self.assertTrue(prov["wasInfluencedBy"])
        self.assertEqual(from_prov_json(prov).to_dict(), graph.to_dict())

        crate = export_ro_crate(graph, snapshot)
        imported = import_ro_crate(crate, expected_snapshot_digest=snapshot.digest)
        self.assertEqual(imported.snapshot.to_dict(), snapshot.to_dict())
        self.assertEqual(imported.graph.to_dict(), graph.to_dict())

    def test_export_matches_shared_sdk_shape_and_never_reuses_approval(self):
        temp, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temp.cleanup)
        spec = build_rerun_spec(graph, snapshot, conclusion.id)
        validate_rerun_spec(spec)
        self.assertEqual(spec["schemaVersion"], RERUN_SCHEMA_VERSION)
        self.assertEqual(set(spec), {
            "schemaVersion", "specId", "specDigest", "source", "target",
            "executionReady", "reproducibility", "activities", "dependencies",
            "secretSlots", "breakpoints", "createdAt",
        })
        self.assertTrue(spec["executionReady"])
        self.assertEqual(spec["reproducibility"], "controlled")
        activity = spec["activities"][0]
        self.assertEqual(activity["executor"]["kind"], "create-loop")
        self.assertEqual(activity["outputs"][0]["comparator"], {"kind": "exact-digest"})
        self.assertTrue(activity["approvals"][0]["freshDecisionRequired"])
        self.assertEqual(activity["approvals"][0]["historicalDecisionId"],
                         "approval:workflow-run:42")
        rendered = str(spec)
        self.assertNotIn("must-not-leak", rendered)
        self.assertEqual(spec["secretSlots"], [])

    def test_approval_decision_change_is_inconclusive_but_fresh_request_id_is_not(self):
        temporary, graph, conclusion, _snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        baseline_graph = ThreadGraph.from_dict(graph.to_dict())
        baseline_approval = baseline_graph.nodes_of(NodeType.APPROVAL_DECISION)[0]
        baseline_approval.attributes.update({
            "status": "approved",
            "decision": "approved",
            "actor": "reviewer:alice",
            "rationale": "The evidence is sufficient.",
            "historicalDecisionId": "request:baseline",
        })
        baseline_snapshot = build_snapshot(
            baseline_graph, version=1, input_watermark="approval:baseline",
        )
        baseline = build_rerun_spec(
            baseline_graph, baseline_snapshot, conclusion.id,
        )
        baseline_requirement = baseline["activities"][0]["approvals"][0]
        self.assertEqual(
            baseline_requirement["historicalDecisionFingerprint"],
            rerun_module._digest({
                "nodeId": "workflow-run:42",
                "status": "approved",
                "decision": "approved",
                "actor": "reviewer:alice",
                "rationale": "The evidence is sufficient.",
            }),
        )

        request_only_graph = ThreadGraph.from_dict(baseline_graph.to_dict())
        request_only_graph.nodes_of(NodeType.APPROVAL_DECISION)[0].attributes[
            "historicalDecisionId"
        ] = "request:fresh"
        request_only_snapshot = build_snapshot(
            request_only_graph, version=2, input_watermark="approval:fresh-request",
        )
        request_only = build_rerun_spec(
            request_only_graph, request_only_snapshot, conclusion.id,
        )
        self.assertNotEqual(
            baseline_requirement["historicalDecisionId"],
            request_only["activities"][0]["approvals"][0]["historicalDecisionId"],
        )
        unchanged = compare_rerun_specs(baseline, request_only)
        self.assertEqual(unchanged["replicationStatus"], "matched")
        self.assertEqual(unchanged["replicationRelation"], "replicates")
        self.assertNotIn("approval_decision_changed", unchanged["reasonCodes"])

        mutations = {
            "status": "rejected",
            "decision": "rejected",
            "actor": "reviewer:bob",
            "rationale": "The evidence needs another check.",
        }
        for field, value in mutations.items():
            with self.subTest(decision_field=field):
                candidate_graph = ThreadGraph.from_dict(baseline_graph.to_dict())
                candidate_approval = candidate_graph.nodes_of(
                    NodeType.APPROVAL_DECISION,
                )[0]
                candidate_approval.attributes[field] = value
                candidate_approval.attributes["historicalDecisionId"] = \
                    f"request:fresh:{field}"
                candidate_snapshot = build_snapshot(
                    candidate_graph, version=2,
                    input_watermark=f"approval:changed:{field}",
                )
                candidate = build_rerun_spec(
                    candidate_graph, candidate_snapshot, conclusion.id,
                )
                comparison = compare_rerun_specs(baseline, candidate)
                self.assertTrue(comparison["sameInput"])
                self.assertTrue(comparison["sameSpec"])
                self.assertTrue(comparison["sameExecutionContext"])
                self.assertEqual(comparison["replicationStatus"], "inconclusive")
                self.assertIsNone(comparison["replicationRelation"])
                self.assertIn(
                    "approval_decision_changed", comparison["reasonCodes"],
                )

    def test_required_secret_slot_is_redacted_and_blocks_evidence_owned_export(self):
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:required-secret")
            envelope = lineage_envelope()
            envelope["parameters"]["values"]["apiToken"] = "must-not-leak"
            ingest_trace_lineage(graph, [{
                "id": "execution-result:secret",
                "kind": "tool_result",
                "evidenceLineage": envelope,
            }], registry)
            conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
            snapshot = build_snapshot(graph, version=1, input_watermark="event:secret")
            spec = build_rerun_spec(graph, snapshot, conclusion.id)

            self.assertFalse(spec["executionReady"])
            self.assertTrue(spec["secretSlots"])
            self.assertTrue(any(
                item["code"] == "secret_slot_unresolved" and item["blocking"]
                for item in spec["breakpoints"]
            ))
            self.assertNotIn("must-not-leak", json.dumps(spec, sort_keys=True))

    def test_structured_credentials_are_redacted_across_executor_tool_and_environment(self):
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:structured-secrets")
            envelope = lineage_envelope()
            executor_payload = envelope["workflowRun"]["executor"]["workflow"]
            executor_payload["workflow"]["nodes"][1]["config"].update({
                "maxTokens": 256,
                "headers": [{"key": "Authorization", "value": "Bearer CANARY_EXEC"}],
                "fields": [{
                    "name": "apiKey", "defaultValue": "CANARY_EXEC_DEFAULT",
                }],
            })
            envelope["workflowRun"]["executor"]["workflowDigest"] = rerun_module._digest(
                executor_payload
            )
            envelope["tools"][0]["arguments"] = {
                "maxTokens": 128,
                "headers": [{"key": "X-API-Key", "value": "CANARY_TOOL"}],
            }
            envelope["environment"][0]["request"] = {
                "headers": [{"key": "Cookie", "value": "CANARY_ENV"}],
            }
            envelope["parameters"]["values"]["credentialFields"] = [{
                "name": "clientSecret", "defaultValue": "CANARY_PARAMETERS",
            }]

            ingest_trace_lineage(graph, [{
                "id": "execution-result:structured-secret",
                "kind": "tool_result",
                "evidenceLineage": envelope,
            }], registry)
            conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
            snapshot = build_snapshot(graph, version=1, input_watermark="structured-secret")
            spec = build_rerun_spec(graph, snapshot, conclusion.id)
            rendered = json.dumps(spec, sort_keys=True)

            self.assertNotIn("CANARY_", rendered)
            self.assertFalse(spec["executionReady"])
            self.assertTrue(spec["secretSlots"])
            self.assertEqual(spec["activities"][0]["executor"]["kind"], "unavailable")
            self.assertTrue(any(
                point["code"] == "executor_secret_redacted" and point["blocking"]
                for point in spec["breakpoints"]
            ))
            self.assertTrue(any(
                point["code"] == "secret_slot_unresolved" and point["blocking"]
                for point in spec["breakpoints"]
            ))
            self.assertEqual(spec["activities"][0]["tools"][0]["arguments"]["maxTokens"], 128)

    def test_same_input_exact_mismatch_is_explainable_replication_failure(self):
        first_temp, first_graph, first_conclusion, first_snapshot, _ = build_graph()
        second_temp, second_graph, second_conclusion, second_snapshot, _ = build_graph(
            output_digest=SHA_E,
        )
        self.addCleanup(first_temp.cleanup)
        self.addCleanup(second_temp.cleanup)
        comparison = compare_rerun_specs(
            build_rerun_spec(first_graph, first_snapshot, first_conclusion.id),
            build_rerun_spec(second_graph, second_snapshot, second_conclusion.id),
        )
        self.assertTrue(comparison["sameInput"])
        self.assertFalse(comparison["resultMatch"])
        self.assertEqual(comparison["classification"], "output_changed")
        self.assertEqual(comparison["replicationRelation"], "fails_to_replicate")
        self.assertTrue(any(
            difference["reasonCode"] == "output_digest_changed"
            for difference in comparison["differences"]
        ))

    def test_matching_output_with_changed_spec_or_context_is_inconclusive(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        baseline = build_rerun_spec(graph, snapshot, conclusion.id)
        cases = (
            ("spec", lambda activity: activity.update({
                "stochastic": True,
            }), "spec_changed"),
            ("context", lambda activity: activity["parameterSets"][0]["values"].update({
                "alpha": 0.01,
            }), "context_changed"),
        )
        for field, mutate, classification in cases:
            with self.subTest(field=field):
                candidate = copy.deepcopy(baseline)
                mutate(candidate["activities"][0])
                rehash_rerun_body(candidate)
                comparison = compare_rerun_specs(baseline, candidate)
                self.assertTrue(comparison["sameInput"])
                self.assertTrue(comparison["resultMatch"])
                self.assertEqual(comparison["classification"], classification)
                self.assertEqual(comparison["replicationStatus"], "inconclusive")
                self.assertIsNone(comparison["replicationRelation"])

    def test_changed_input_uses_the_shared_inconclusive_status(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        baseline = build_rerun_spec(graph, snapshot, conclusion.id)
        candidate = copy.deepcopy(baseline)
        candidate["activities"][0]["inputs"][0]["contentDigest"] = SHA_B
        rehash_rerun_body(candidate)

        comparison = compare_rerun_specs(baseline, candidate)
        self.assertFalse(comparison["sameInput"])
        self.assertTrue(comparison["resultMatch"])
        self.assertEqual(comparison["classification"], "input_changed")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])

    def test_incomplete_mismatch_is_never_a_replication_failure(self):
        baseline_result = build_graph(output_digest=SHA_D)
        candidate_result = build_graph(output_digest=SHA_E)
        self.addCleanup(baseline_result[0].cleanup)
        self.addCleanup(candidate_result[0].cleanup)
        baseline = build_rerun_spec(
            baseline_result[1], baseline_result[3], baseline_result[2].id,
        )
        candidate = build_rerun_spec(
            candidate_result[1], candidate_result[3], candidate_result[2].id,
        )
        candidate["executionReady"] = False
        candidate["reproducibility"] = "incomplete"
        candidate["breakpoints"].append({
            "code": "candidate_metadata_incomplete",
            "component": "artifact",
            "message": "Candidate metadata is incomplete.",
            "blocking": True,
        })
        candidate["specDigest"] = rerun_module._digest({
            key: value for key, value in candidate.items() if key != "specDigest"
        })

        comparison = compare_rerun_specs(baseline, candidate)
        self.assertFalse(comparison["resultMatch"])
        self.assertEqual(comparison["classification"], "output_changed")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])
        self.assertIn("incomplete_reproducibility", comparison["reasonCodes"])

    def test_incomplete_matching_output_is_never_a_replication_match(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        baseline = build_rerun_spec(graph, snapshot, conclusion.id)
        candidate = copy.deepcopy(baseline)
        candidate["executionReady"] = False
        candidate["reproducibility"] = "incomplete"
        candidate["breakpoints"].append({
            "code": "candidate_metadata_incomplete",
            "component": "artifact",
            "message": "Candidate metadata is incomplete.",
            "blocking": True,
        })
        candidate["specDigest"] = rerun_module._digest({
            key: value for key, value in candidate.items() if key != "specDigest"
        })

        comparison = compare_rerun_specs(baseline, candidate)
        self.assertTrue(comparison["resultMatch"])
        self.assertEqual(comparison["classification"], "unverifiable")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])
        self.assertIn("incomplete_reproducibility", comparison["reasonCodes"])

    def test_multi_activity_outputs_are_paired_by_owning_activity(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        source = build_rerun_spec(graph, snapshot, conclusion.id)
        first = copy.deepcopy(source["activities"][0])
        first.update({"id": "activity:a", "name": "Activity A", "specFingerprint": SHA_A})
        first["outputs"] = [{
            "id": "output:shared", "role": "output", "kind": "artifact",
            "name": "Same-named output", "required": True,
            "contentDigest": SHA_C, "baselineDigest": SHA_C,
            "comparator": {"kind": "exact-digest"},
        }]
        second = copy.deepcopy(first)
        second.update({"id": "activity:b", "name": "Activity B", "specFingerprint": SHA_B})
        second["outputs"][0].update({
            "contentDigest": SHA_D, "baselineDigest": SHA_D,
        })
        baseline = copy.deepcopy(source)
        baseline["activities"] = [first, second]
        baseline["source"]["activityId"] = "activity:a"
        baseline["dependencies"] = []
        rehash_rerun_body(baseline)
        candidate = copy.deepcopy(baseline)
        candidate["activities"] = list(reversed(candidate["activities"]))
        for activity in candidate["activities"]:
            activity["id"] = f"candidate:{activity['id']}"
        candidate["source"]["activityId"] = "candidate:activity:a"
        rehash_rerun_body(candidate)

        comparison = compare_rerun_specs(baseline, candidate)
        self.assertTrue(comparison["sameSpec"])
        self.assertTrue(comparison["resultMatch"])
        self.assertEqual(comparison["replicationStatus"], "matched")
        self.assertEqual(comparison["replicationRelation"], "replicates")

    def test_dependency_graph_and_activity_ownership_are_comparison_dimensions(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        source = build_rerun_spec(graph, snapshot, conclusion.id)

        first = copy.deepcopy(source["activities"][0])
        first.update({"id": "activity:a", "name": "Activity A"})
        first["inputs"][0].update({"id": "input:a", "contentDigest": SHA_A})
        first["outputs"] = [{
            "id": "output:a", "role": "output", "kind": "artifact",
            "name": "Output A", "required": True,
            "contentDigest": SHA_C, "baselineDigest": SHA_C,
            "comparator": {"kind": "exact-digest"},
        }]
        second = copy.deepcopy(first)
        second.update({"id": "activity:b", "name": "Activity B"})
        second["inputs"][0].update({"id": "input:b", "contentDigest": SHA_B})
        second["outputs"][0].update({
            "id": "output:b", "name": "Output B",
            "contentDigest": SHA_D, "baselineDigest": SHA_D,
        })

        baseline = copy.deepcopy(source)
        baseline["activities"] = [first, second]
        baseline["source"]["activityId"] = "activity:a"
        baseline["dependencies"] = [{
            "src": "activity:a", "dst": "activity:b", "relation": "part_of",
        }]
        rehash_rerun_body(baseline)

        candidate = copy.deepcopy(baseline)
        candidate["activities"] = list(reversed(candidate["activities"]))
        for activity in candidate["activities"]:
            activity["id"] = f"candidate:{activity['id']}"
        candidate["source"]["activityId"] = "candidate:activity:a"
        candidate["dependencies"] = [{
            "src": "candidate:activity:a", "dst": "candidate:activity:b",
            "relation": "part_of",
        }]
        rehash_rerun_body(candidate)

        unchanged = compare_rerun_specs(baseline, candidate)
        self.assertTrue(unchanged["sameSpec"])
        self.assertEqual(unchanged["replicationStatus"], "matched")

        mutations = {
            "deleted": lambda spec: spec.update({"dependencies": []}),
            "reversed": lambda spec: spec.update({"dependencies": [{
                "src": "candidate:activity:b", "dst": "candidate:activity:a",
                "relation": "part_of",
            }]}),
            "relation": lambda spec: spec["dependencies"][0].update({
                "relation": "used",
            }),
        }
        for label, mutate in mutations.items():
            with self.subTest(change=label):
                changed = copy.deepcopy(candidate)
                mutate(changed)
                rehash_rerun_body(changed)
                comparison = compare_rerun_specs(baseline, changed)
                self.assertFalse(comparison["sameSpec"])
                self.assertEqual(comparison["classification"], "spec_changed")
                self.assertEqual(comparison["replicationStatus"], "inconclusive")
                self.assertIsNone(comparison["replicationRelation"])
                self.assertIn("dependency_graph_changed", comparison["reasonCodes"])

        swapped = copy.deepcopy(candidate)
        by_name = {activity["name"]: activity for activity in swapped["activities"]}
        first_inputs = copy.deepcopy(by_name["Activity A"]["inputs"])
        by_name["Activity A"]["inputs"] = copy.deepcopy(
            by_name["Activity B"]["inputs"],
        )
        by_name["Activity B"]["inputs"] = first_inputs
        rehash_rerun_body(swapped)
        swapped_comparison = compare_rerun_specs(baseline, swapped)
        self.assertFalse(swapped_comparison["sameInput"])
        self.assertEqual(swapped_comparison["classification"], "input_changed")
        self.assertEqual(swapped_comparison["replicationStatus"], "inconclusive")

        ambiguous_baseline = copy.deepcopy(baseline)
        for activity in ambiguous_baseline["activities"]:
            activity["name"] = "Ambiguous activity owner"
            activity["outputs"][0].update({"name": "Shared output contract"})
        rehash_rerun_body(ambiguous_baseline)
        ambiguous_candidate = copy.deepcopy(ambiguous_baseline)
        for activity in ambiguous_candidate["activities"]:
            original_id = activity["id"]
            activity["id"] = f"candidate:{original_id}"
        ambiguous_candidate["source"]["activityId"] = "candidate:activity:a"
        ambiguous_candidate["dependencies"] = [{
            "src": "candidate:activity:a", "dst": "candidate:activity:b",
            "relation": "part_of",
        }]
        rehash_rerun_body(ambiguous_candidate)
        ambiguous = compare_rerun_specs(
            ambiguous_baseline, ambiguous_candidate,
        )
        self.assertFalse(ambiguous["sameSpec"])
        self.assertFalse(ambiguous["comparisonVerifiable"])
        self.assertEqual(ambiguous["replicationStatus"], "inconclusive")
        self.assertIn("dependency_graph_changed", ambiguous["reasonCodes"])

    def test_ambiguous_multi_activity_output_owners_fail_closed(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        source = build_rerun_spec(graph, snapshot, conclusion.id)
        first = copy.deepcopy(source["activities"][0])
        first.update({"id": "activity:a", "name": "Identical owner"})
        first["outputs"] = [{
            "id": "output:a", "role": "output", "kind": "artifact",
            "name": "Shared contract", "required": True,
            "contentDigest": SHA_C, "baselineDigest": SHA_C,
            "comparator": {"kind": "exact-digest"},
        }]
        second = copy.deepcopy(first)
        second["id"] = "activity:b"
        second["outputs"][0].update({
            "id": "output:b", "contentDigest": SHA_D, "baselineDigest": SHA_D,
        })
        baseline = copy.deepcopy(source)
        baseline["activities"] = [first, second]
        baseline["source"]["activityId"] = "activity:a"
        baseline["dependencies"] = []
        rehash_rerun_body(baseline)
        candidate = copy.deepcopy(baseline)
        candidate["activities"] = list(reversed(candidate["activities"]))
        for activity in candidate["activities"]:
            activity["id"] = f"candidate:{activity['id']}"
        candidate["source"]["activityId"] = "candidate:activity:a"
        rehash_rerun_body(candidate)

        with self.assertRaisesRegex(ValueError, "globally unambiguous"):
            validate_rerun_spec(baseline)
        with self.assertRaisesRegex(ValueError, "globally unambiguous"):
            compare_rerun_specs(baseline, candidate)

    def test_absent_required_outputs_can_never_be_reported_as_a_match(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        baseline = build_rerun_spec(graph, snapshot, conclusion.id)
        candidate = copy.deepcopy(baseline)
        for spec in (baseline, candidate):
            spec["activities"][0]["outputs"] = []
            rehash_rerun_body(spec)

        comparison = compare_rerun_specs(baseline, candidate)
        self.assertFalse(comparison["resultMatch"])
        self.assertFalse(comparison["comparisonVerifiable"])
        self.assertEqual(comparison["classification"], "unverifiable")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])
        self.assertIn("required_output_unverifiable", comparison["reasonCodes"])

    def test_fingerprint_field_tampering_is_rejected_even_with_new_spec_digest(self):
        temporary, graph, conclusion, snapshot, _ = build_graph()
        self.addCleanup(temporary.cleanup)
        spec = build_rerun_spec(graph, snapshot, conclusion.id)
        spec["activities"][0]["inputFingerprint"] = SHA_E
        spec["specDigest"] = rerun_module._digest({
            key: value for key, value in spec.items() if key != "specDigest"
        })
        with self.assertRaisesRegex(ValueError, "does not match canonical body"):
            validate_rerun_spec(spec)

    def test_unseeded_stochastic_mismatch_is_uncontrolled_not_failure(self):
        first_temp, first_graph, first_conclusion, first_snapshot, _ = build_graph(
            stochastic=True,
        )
        second_temp, second_graph, second_conclusion, second_snapshot, _ = build_graph(
            output_digest=SHA_E, stochastic=True,
        )
        self.addCleanup(first_temp.cleanup)
        self.addCleanup(second_temp.cleanup)
        baseline = build_rerun_spec(first_graph, first_snapshot, first_conclusion.id)
        candidate = build_rerun_spec(second_graph, second_snapshot, second_conclusion.id)
        self.assertTrue(baseline["executionReady"])
        self.assertEqual(baseline["reproducibility"], "uncontrolled")
        self.assertTrue(any(
            item["component"] == "randomness" and not item["blocking"]
            for item in baseline["breakpoints"]
        ))
        comparison = compare_rerun_specs(baseline, candidate)
        self.assertEqual(comparison["classification"], "uncontrolled_output_changed")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])

    def test_missing_activity_exports_blocked_shared_spec(self):
        graph = ThreadGraph("runtime:missing-run")
        conclusion = graph.add_or_get_node(
            NodeType.CONCLUSION, "A conclusion without execution metadata.",
            external_id="conclusion:missing", identity_scope="conclusion:missing",
            attributes={"semanticRole": "conclusion"},
        )
        snapshot = build_snapshot(graph, version=1, input_watermark="1")
        spec = build_rerun_spec(graph, snapshot, conclusion.id)
        self.assertFalse(spec["executionReady"])
        self.assertEqual(spec["reproducibility"], "incomplete")
        self.assertEqual(spec["activities"][0]["executor"]["kind"], "unavailable")
        self.assertTrue(any(
            item["blocking"] and item["component"] == "executor"
            and item.get("activityId") == spec["activities"][0]["id"]
            for item in spec["breakpoints"]
        ))

    def test_non_exact_comparator_is_never_applied_without_output_values(self):
        comparator = {"kind": "numeric", "absoluteTolerance": 0.1}
        first = build_graph(output_digest=SHA_D, comparator=comparator)
        second = build_graph(output_digest=SHA_E, comparator=comparator)
        self.addCleanup(first[0].cleanup)
        self.addCleanup(second[0].cleanup)
        comparison = compare_rerun_specs(
            build_rerun_spec(first[1], first[3], first[2].id),
            build_rerun_spec(second[1], second[3], second[2].id),
        )
        self.assertFalse(comparison["resultMatch"])
        self.assertFalse(comparison["comparisonVerifiable"])
        self.assertEqual(comparison["classification"], "unverifiable")
        self.assertEqual(comparison["replicationStatus"], "inconclusive")
        self.assertIsNone(comparison["replicationRelation"])

    def test_numeric_comparator_reads_graph_values_within_and_outside_tolerance(self):
        comparator = {"kind": "numeric", "absoluteTolerance": 0.1}
        baseline = build_graph(
            output_digest=SHA_D, comparator=comparator, output_value=100,
        )
        within = build_graph(
            output_digest=SHA_E, comparator=comparator, output_value=100.05,
        )
        outside = build_graph(
            output_digest=SHA_A, comparator=comparator, output_value=100.2,
        )
        for result in (baseline, within, outside):
            self.addCleanup(result[0].cleanup)
        baseline_spec = build_rerun_spec(baseline[1], baseline[3], baseline[2].id)
        within_spec = build_rerun_spec(within[1], within[3], within[2].id)
        outside_spec = build_rerun_spec(outside[1], outside[3], outside[2].id)
        matched = compare_rerun_specs(
            baseline_spec, within_spec,
            baseline_output_values=output_values_for_spec(baseline[1], baseline_spec),
            candidate_output_values=output_values_for_spec(within[1], within_spec),
        )
        failed = compare_rerun_specs(
            baseline_spec, outside_spec,
            baseline_output_values=output_values_for_spec(baseline[1], baseline_spec),
            candidate_output_values=output_values_for_spec(outside[1], outside_spec),
        )
        self.assertTrue(matched["comparisonVerifiable"])
        self.assertTrue(matched["resultMatch"])
        self.assertEqual(matched["replicationRelation"], "replicates")
        self.assertTrue(any(
            difference["reasonCode"] == "explicit_comparator_match_with_observed_change"
            and difference["baselineValueDigest"] != difference["candidateValueDigest"]
            for difference in matched["differences"]
        ))
        self.assertFalse(failed["resultMatch"])
        self.assertEqual(failed["replicationRelation"], "fails_to_replicate")

    def test_table_and_json_comparators_apply_only_declared_semantics(self):
        cases = (
            (
                {
                    "kind": "table", "keyColumns": ["id"],
                    "valueColumns": ["value"], "absoluteTolerance": 0.1,
                },
                [{"id": "a", "value": 1, "ignored": "left"},
                 {"id": "b", "value": 2, "ignored": "left"}],
                [{"id": "b", "value": 2.05, "ignored": "right"},
                 {"id": "a", "value": 1.05, "ignored": "right"}],
                [{"id": "c", "value": 2.05, "ignored": "right"},
                 {"id": "a", "value": 1.05, "ignored": "right"}],
            ),
            (
                {
                    "kind": "json-structural", "absoluteTolerance": 0.01,
                    "relativeTolerance": 0,
                },
                {"score": 1, "nested": {"count": 2}},
                {"score": 1.005, "nested": {"count": 2}},
                {"score": 1.02, "nested": {"count": 2}},
            ),
        )
        for comparator, baseline_value, within_value, outside_value in cases:
            with self.subTest(kind=comparator["kind"]):
                results = (
                    build_graph(output_digest=SHA_D, comparator=comparator,
                                output_value=baseline_value),
                    build_graph(output_digest=SHA_E, comparator=comparator,
                                output_value=within_value),
                    build_graph(output_digest=SHA_A, comparator=comparator,
                                output_value=outside_value),
                )
                for result in results:
                    self.addCleanup(result[0].cleanup)
                specs = [
                    build_rerun_spec(result[1], result[3], result[2].id)
                    for result in results
                ]
                values = [
                    output_values_for_spec(result[1], spec)
                    for result, spec in zip(results, specs)
                ]
                matched = compare_rerun_specs(
                    specs[0], specs[1], baseline_output_values=values[0],
                    candidate_output_values=values[1],
                )
                failed = compare_rerun_specs(
                    specs[0], specs[2], baseline_output_values=values[0],
                    candidate_output_values=values[2],
                )
                self.assertEqual(matched["replicationStatus"], "matched")
                self.assertTrue(any(
                    difference["reasonCode"]
                    == "explicit_comparator_match_with_observed_change"
                    for difference in matched["differences"]
                ))
                self.assertEqual(failed["replicationStatus"], "failed")

    def test_unsafe_integer_is_string_normalized_and_blocks_execution(self):
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:unsafe-integer")
            envelope = lineage_envelope()
            envelope["parameters"]["values"]["largeInteger"] = 9007199254740992
            ingest_trace_lineage(graph, [{
                "id": "unsafe", "kind": "tool_result", "evidenceLineage": envelope,
            }], registry)
            conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
            snapshot = build_snapshot(graph, version=1, input_watermark="unsafe")
            spec = build_rerun_spec(graph, snapshot, conclusion.id)
            parameter = next(
                item for item in spec["activities"][0]["parameterSets"]
                if item["id"] == "parameters:primary"
            )
            self.assertEqual(parameter["values"]["largeInteger"], "9007199254740992")
            self.assertFalse(spec["executionReady"])
            self.assertTrue(any(
                point["code"] == "unsafe_integer_normalized" and point["blocking"]
                for point in spec["breakpoints"]
            ))

    def test_hashed_executor_is_never_rewritten_after_secret_redaction(self):
        for raw_secret in (True, False):
            with self.subTest(raw_secret=raw_secret), tempfile.TemporaryDirectory() as workspace:
                registry = artifact_version_projection(
                    workspace_roots=(workspace,), locator_root=workspace,
                )
                graph = ThreadGraph(f"runtime:executor-integrity:{raw_secret}")
                envelope = lineage_envelope()
                payload = create_loop_executor_payload()
                if raw_secret:
                    payload["workflow"]["env"] = [{
                        "key": "API_TOKEN", "type": "secret", "value": "raw-credential",
                    }]
                else:
                    # "maxTokens" is ordinary model configuration, not a
                    # credential field, and an exact ${ENV_VAR} indirection
                    # carries no credential bytes. Neither may be rewritten.
                    payload["workflow"]["nodes"][1]["config"]["maxTokens"] = 256
                    payload["workflow"]["env"] = [{
                        "key": "API_TOKEN", "value": "${API_TOKEN}",
                    }]
                payload["baseline"]["workflowFingerprint"] = rerun_module._digest(
                    payload["workflow"]
                )
                envelope["workflowRun"]["executor"]["workflow"] = payload
                envelope["workflowRun"]["executor"]["workflowDigest"] = rerun_module._digest(
                    payload
                )
                ingest_trace_lineage(graph, [{
                    "id": "executor-integrity", "kind": "tool_result",
                    "evidenceLineage": envelope,
                }], registry)
                conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
                snapshot = build_snapshot(graph, version=1, input_watermark="integrity")
                spec = build_rerun_spec(graph, snapshot, conclusion.id)
                executor = spec["activities"][0]["executor"]
                if raw_secret:
                    self.assertEqual(executor["kind"], "unavailable")
                    self.assertFalse(spec["executionReady"])
                    self.assertTrue(any(
                        point["code"] == "executor_secret_redacted" and point["blocking"]
                        for point in spec["breakpoints"]
                    ))
                    self.assertNotIn("raw-credential", str(spec))
                else:
                    self.assertEqual(executor["kind"], "create-loop")
                    self.assertTrue(spec["executionReady"])
                    self.assertEqual(
                        executor["workflow"]["workflow"]["nodes"][1]["config"]["maxTokens"],
                        256,
                    )
                    self.assertEqual(
                        executor["workflow"]["workflow"]["env"][0]["value"],
                        "${API_TOKEN}",
                    )

    def test_invalid_nested_shared_specs_never_receive_trusted_passthrough(self):
        source = build_graph()
        self.addCleanup(source[0].cleanup)
        valid_spec = build_rerun_spec(source[1], source[3], source[2].id)
        mutations = {
            "executor unknown field": lambda spec: spec["activities"][0]["executor"].update(
                {"unknown": True}
            ),
            "activity unknown field": lambda spec: spec["activities"][0].update(
                {"unknown": True}
            ),
            "tool argumentsDigest missing": lambda spec: spec["activities"][0]["tools"][0].pop(
                "argumentsDigest"
            ),
            "secret slot malformed": lambda spec: spec["secretSlots"].append({
                "id": "secret:malformed", "name": "Malformed secret", "required": "yes",
            }),
            "timestamp malformed": lambda spec: spec.update({"createdAt": "not-a-time"}),
            "table comparator malformed": lambda spec: spec["activities"][0]["outputs"][0].update({
                "comparator": {
                    "kind": "table", "keyColumns": [" "], "valueColumns": [],
                },
            }),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as workspace:
                malformed = copy.deepcopy(valid_spec)
                mutate(malformed)
                malformed["specDigest"] = rerun_module._digest({
                    key: value for key, value in malformed.items() if key != "specDigest"
                })
                with self.assertRaisesRegex(
                    ValueError,
                    "shared SDK contract|argumentsDigest|required|RFC 3339|comparator",
                ):
                    validate_rerun_spec(malformed)

                event = create_loop_manifest_event(f"run:invalid:{label}")
                event["artifacts"].insert(0, {
                    "kind": "sciforge.repro-spec", "spec": malformed,
                })
                registry = artifact_version_projection(
                    workspace_roots=(workspace,), locator_root=workspace,
                )
                graph = ThreadGraph(f"runtime:invalid:{label}")
                ingest_trace_lineage(graph, [event], registry)
                run = graph.nodes_of(NodeType.WORKFLOW_RUN)[0]
                self.assertEqual(run.attributes["executor"]["kind"], "unavailable")
                self.assertNotIn("sharedReproResource", run.attributes)


class TestExecutionEventIngestion(unittest.TestCase):
    def test_real_create_loop_terminal_events_drive_replication_relations(self):
        emitted = subprocess.run(
            [
                "node", "--import", "tsx",
                str(PACKAGE_ROOT / "tests" / "emit_create_loop_execution_events.ts"),
            ],
            cwd=PACKAGE_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        bundles = json.loads(emitted.stdout)
        cases = (
            ("matched", {EdgeRel.RERUN_OF, EdgeRel.REPLICATES}),
            ("changed", {EdgeRel.RERUN_OF}),
        )
        for label, expected in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as workspace:
                events = bundles[label]
                baseline_run_id = events[0]["runId"]
                candidate_run_id = events[1]["runId"]
                registry = artifact_version_projection(
                    workspace_roots=(workspace,), locator_root=workspace,
                )
                graph = ThreadGraph(f"runtime:create-loop-contract:{label}")
                ingest_trace_lineage(
                    graph, events, registry,
                    allowed_historical_rerun_refs=frozenset({baseline_run_id}),
                )
                runs = {
                    node.external_id: node
                    for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                }
                between = {
                    edge.rel for edge in graph.edges.values()
                    if edge.src == runs[candidate_run_id].id
                    and edge.dst == runs[baseline_run_id].id
                }
                self.assertEqual(between, expected)
                comparison = runs[candidate_run_id].attributes["comparison"]
                if label == "matched":
                    self.assertTrue(comparison["comparisonVerifiable"])
                    self.assertTrue(comparison["resultMatch"])
                    self.assertTrue(comparison["sameInput"])
                else:
                    self.assertFalse(comparison["sameInput"])
                    self.assertEqual(
                        comparison["replicationStatus"], "inconclusive",
                    )

    def test_manifest_comparison_creates_only_semantically_valid_replication_edges(self):
        cases = (
            ("matched", "uncontrolled", {EdgeRel.RERUN_OF, EdgeRel.REPLICATES}),
            ("failed", "controlled", {EdgeRel.RERUN_OF, EdgeRel.FAILS_TO_REPLICATE}),
            ("failed", "uncontrolled", {EdgeRel.RERUN_OF}),
            ("inconclusive", "controlled", {EdgeRel.RERUN_OF}),
        )
        for status, control, expected in cases:
            with self.subTest(status=status, control=control):
                with tempfile.TemporaryDirectory() as workspace:
                    registry = artifact_version_projection(
                        workspace_roots=(workspace,), locator_root=workspace,
                    )
                    graph = ThreadGraph(f"runtime:comparison:{status}:{control}")
                    ingest_trace_lineage(graph, [
                        create_loop_manifest_event("run:baseline"),
                        create_loop_manifest_event(
                            "run:candidate", rerun_of="run:baseline",
                            replication_status=status, control=control,
                        ),
                    ], registry, allowed_historical_rerun_refs=frozenset({
                        "run:baseline",
                    }))
                    baseline = next(
                        node for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                        if node.external_id == "run:baseline"
                    )
                    candidate = next(
                        node for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                        if node.external_id == "run:candidate"
                    )
                    between = {
                        edge.rel for edge in graph.edges.values()
                        if edge.src == candidate.id and edge.dst == baseline.id
                    }
                    self.assertEqual(between, expected)
                    self.assertEqual(
                        candidate.attributes["comparison"]["replicationStatus"], status,
                    )

    def test_replication_edges_require_an_explicit_verifiable_same_run_basis(self):
        cases = (
            ("input_changed", {"same_input": False}),
            ("spec_changed", {"same_spec": False}),
            ("context_changed", {"same_context": False}),
            ("unverifiable", {"comparison_verifiable": False}),
        )
        for label, options in cases:
            with self.subTest(case=label):
                with tempfile.TemporaryDirectory() as workspace:
                    registry = artifact_version_projection(
                        workspace_roots=(workspace,), locator_root=workspace,
                    )
                    graph = ThreadGraph(f"runtime:comparison-basis:{label}")
                    ingest_trace_lineage(graph, [
                        create_loop_manifest_event("run:baseline"),
                        create_loop_manifest_event(
                            "run:candidate", rerun_of="run:baseline",
                            replication_status="failed", **options,
                        ),
                    ], registry, allowed_historical_rerun_refs=frozenset({
                        "run:baseline",
                    }))
                    runs = {
                        node.external_id: node
                        for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                    }
                    between = {
                        edge.rel for edge in graph.edges.values()
                        if edge.src == runs["run:candidate"].id
                        and edge.dst == runs["run:baseline"].id
                    }
                    self.assertEqual(between, {EdgeRel.RERUN_OF})

        missing_basis = create_loop_manifest_event(
            "run:candidate", rerun_of="run:baseline",
            replication_status="failed",
        )
        del missing_basis["artifacts"][0]["manifest"]["comparison"]["sameInput"]
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:comparison-basis:missing")
            ingest_trace_lineage(graph, [
                create_loop_manifest_event("run:baseline"), missing_basis,
            ], registry, allowed_historical_rerun_refs=frozenset({"run:baseline"}))
            runs = {
                node.external_id: node
                for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
            }
            between = {
                edge.rel for edge in graph.edges.values()
                if edge.src == runs["run:candidate"].id
                and edge.dst == runs["run:baseline"].id
            }
            self.assertEqual(between, {EdgeRel.RERUN_OF})

        invalid_result_bases = {
            "missing_result_match": lambda comparison: comparison.pop("resultMatch"),
            "contradictory_matches": lambda comparison: comparison.update({
                "matches": not comparison["resultMatch"],
            }),
            "non_boolean_result_match": lambda comparison: comparison.update({
                "resultMatch": 1,
            }),
        }
        for replication_status in ("matched", "failed"):
            for label, mutate in invalid_result_bases.items():
                with self.subTest(
                    result_basis=label, replication_status=replication_status,
                ), tempfile.TemporaryDirectory() as workspace:
                    candidate = create_loop_manifest_event(
                        "run:candidate", rerun_of="run:baseline",
                        replication_status=replication_status,
                    )
                    mutate(candidate["artifacts"][0]["manifest"]["comparison"])
                    registry = artifact_version_projection(
                        workspace_roots=(workspace,), locator_root=workspace,
                    )
                    graph = ThreadGraph(
                        f"runtime:comparison-result-basis:{label}:{replication_status}"
                    )
                    ingest_trace_lineage(graph, [
                        create_loop_manifest_event("run:baseline"), candidate,
                    ], registry, allowed_historical_rerun_refs=frozenset({
                        "run:baseline",
                    }))
                    runs = {
                        node.external_id: node
                        for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                    }
                    between = {
                        edge.rel for edge in graph.edges.values()
                        if edge.src == runs["run:candidate"].id
                        and edge.dst == runs["run:baseline"].id
                    }
                    self.assertEqual(between, {EdgeRel.RERUN_OF})

    def test_manifest_relations_resolve_persisted_baseline_across_updates(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = workspace + "/evidence-store"
            baseline_event = create_loop_manifest_event(
                "run:baseline", acceptance_sequence=1,
            )
            candidate_event = create_loop_manifest_event(
                "run:candidate", acceptance_sequence=2, rerun_of="run:baseline",
                replication_status="matched",
            )
            command = {
                "thread_id": "runtime:incremental-rerun",
                "reason": "turn_committed",
                "priority": "P2",
                "workspace_root": workspace,
                "project_root": workspace,
            }

            def host_bundle(event: dict) -> list[dict]:
                return [event, {
                    **copy.deepcopy(event["artifacts"][0]),
                    "id": f"{event['eventId']}:artifact:0",
                    "source_item_id": f"{event['eventId']}:artifact:0",
                    "sciforgeEvidenceEvent": copy.deepcopy(
                        event["sciforgeEvidenceEvent"]
                    ),
                }]

            Engine(None, storage_dir=storage).update(
                target_watermark="1:event:run:baseline",
                trace=host_bundle(baseline_event), **command,
            )
            engine = Engine(None, storage_dir=storage)
            result = engine.update(
                target_watermark="2:event:run:candidate",
                trace=[*host_bundle(baseline_event), *host_bundle(candidate_event)],
                **command,
            )

            graph = engine.require("runtime:incremental-rerun")
            runs = {
                node.external_id: node
                for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
            }
            baseline = runs["run:baseline"]
            candidate = runs["run:candidate"]
            between = {
                edge.rel for edge in graph.edges.values()
                if edge.src == candidate.id and edge.dst == baseline.id
            }
            self.assertEqual(between, {EdgeRel.RERUN_OF, EdgeRel.REPLICATES})
            self.assertTrue({
                edge.id for edge in graph.edges.values()
                if edge.src == candidate.id and edge.dst == baseline.id
            }.issubset(result["delta"]["new_edges"]))

            document = to_prov_json(graph)
            self.assertIn(
                "rerun_of",
                {relation["edag:rel"] for relation in document["wasInformedBy"].values()},
            )
            self.assertIn(
                "replicates",
                {relation["edag:rel"] for relation in document["wasInfluencedBy"].values()},
            )

    def test_manifest_output_merges_only_explicit_evidence_lineage(self):
        declared = {
            "evidenceLineage": {
                "evidence": [{
                    "id": "evidence:explicit", "type": "finding",
                    "name": "The recorded output supports the explicit conclusion.",
                }],
                "conclusion": {
                    "id": "conclusion:explicit",
                    "name": "The explicit conclusion is supported.",
                },
                "relations": [
                    {
                        "src": "evidence:explicit", "dst": "run:explicit",
                        "rel": "generated_by",
                    },
                    {
                        "src": "evidence:explicit", "dst": "conclusion:explicit",
                        "rel": "supports",
                    },
                ],
            }
        }
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("runtime:explicit-lineage")
            ingest_trace_lineage(graph, [create_loop_manifest_event(
                "run:explicit", output_json=json.dumps(declared),
            )], registry)
            conclusion = next(
                node for node in graph.nodes_of(NodeType.CONCLUSION)
                if node.external_id == "conclusion:explicit"
            )
            lineage = graph.conclusion_lineage(conclusion.id)
            self.assertEqual(lineage["coverage"]["evidenceCount"], 1)
            run = next(
                node for node in graph.nodes_of(NodeType.WORKFLOW_RUN)
                if node.external_id == "run:explicit"
            )
            self.assertIn(run.id, lineage["coverage"]["components"]["activities"])

            unrelated = ThreadGraph("runtime:no-inference")
            ingest_trace_lineage(unrelated, [create_loop_manifest_event(
                "run:plain",
                output_json=json.dumps({"conclusion": "Do not infer me."}),
            )], registry)
            self.assertEqual(unrelated.nodes_of(NodeType.CONCLUSION), [])

    def test_create_loop_completion_event_projects_manifest_without_private_imports(self):
        with tempfile.TemporaryDirectory() as workspace:
            registry = artifact_version_projection(
                workspace_roots=(workspace,), locator_root=workspace,
            )
            graph = ThreadGraph("domain:sciforge.create-loop:execution:run-9")
            executor_payload = create_loop_executor_payload(output_digest=SHA_E)
            safe_placeholder = "__SCIFORGE_SECRET_REF__:secret:api-token"
            executor_payload["workflow"]["env"] = [{
                "key": "API_TOKEN", "type": "secret", "value": safe_placeholder,
            }]
            executor_payload["baseline"]["workflowFingerprint"] = rerun_module._digest(
                executor_payload["workflow"]
            )
            executor_payload["baseline"]["specFingerprint"] = rerun_module._digest({
                "workflowFingerprint": executor_payload["baseline"]["workflowFingerprint"],
                "inputFingerprint": executor_payload["baseline"]["inputFingerprint"],
                "contextFingerprint": executor_payload["baseline"]["contextFingerprint"],
                "approvalRequirements": [],
                "comparator": {"kind": "exact-digest"},
            })
            manifest = {
                "schema": "sciforge.create-loop.run.v2",
                "source": "workflow",
                "workflow": executor_payload["workflow"],
                "input": executor_payload["input"],
                "context": executor_payload["context"],
                "comparator": {"kind": "exact-digest"},
                "determinism": {
                    "control": "controlled", "reasonCodes": [], "stochasticNodeIds": [],
                },
                "workflowFingerprint": executor_payload["baseline"]["workflowFingerprint"],
                "inputFingerprint": executor_payload["baseline"]["inputFingerprint"],
                "specFingerprint": executor_payload["baseline"]["specFingerprint"],
                "contextFingerprint": executor_payload["baseline"]["contextFingerprint"],
                "outputFingerprint": SHA_E,
                "outputJson": json.dumps({
                    "evidenceLineage": {
                        "evidence": [{
                            "id": "evidence:alias-run-9",
                            "type": "finding",
                            "name": "Workflow 9 produced the declared result.",
                        }],
                        "conclusions": [{
                            "id": "conclusion:alias-run-9",
                            "name": "Workflow 9 completed with traceable evidence.",
                        }],
                        "relations": [
                            {
                                "src": "evidence:alias-run-9",
                                "dst": "$execution",
                                "rel": "generated_by",
                            },
                            {
                                "src": "evidence:alias-run-9",
                                "dst": "conclusion:alias-run-9",
                                "rel": "supports",
                            },
                        ],
                    },
                }),
                "approvalFingerprint": executor_payload["baseline"]["approvalFingerprint"],
                "artifactRefs": [],
                "approvals": [],
            }
            shared_spec = {
                "schemaVersion": "sciforge.rerun.v1",
                "specId": "spec:workflow-9",
                "specDigest": SHA_A,
                "source": {"snapshotDigest": SHA_A, "activityId": "workflow:9"},
                "target": {"kind": "activity", "id": "workflow:9"},
                "executionReady": True,
                "reproducibility": "controlled",
                "activities": [{
                    "id": "workflow:9",
                    "type": "workflow_run",
                    "name": "Workflow 9",
                    "executor": {
                        "kind": "create-loop",
                        "workflow": executor_payload,
                        "workflowDigest": rerun_module._digest(executor_payload),
                        "target": {"kind": "workflow", "id": "workflow:primary"},
                    },
                    "inputs": [{
                        "id": "workflow:9:input", "role": "input", "kind": "artifact",
                        "name": "Workflow input", "contentDigest": SHA_B, "required": True,
                    }],
                    "code": [],
                    "environments": [{
                        "id": "workflow:9:environment", "name": "Workflow environment",
                        "platform": "darwin", "architecture": "arm64",
                        "runtimeVersions": {"node": "24.0.0"}, "lockDigests": [],
                        "contentDigest": SHA_D,
                    }],
                    "parameterSets": [{
                        "id": "workflow:9:parameters", "values": {"mode": "normal"},
                        "digest": SHA_C,
                    }],
                    "tools": [{
                        "id": "node:1", "name": "Transform",
                        "providerId": "sciforge.create-loop", "actionId": "code",
                        "arguments": {"language": "python"},
                        "argumentsDigest": SHA_C, "stochastic": False,
                        "supportsSeed": False,
                    }],
                    "approvals": [{
                        "id": "approval:workflow-gate",
                        "kind": "workflow-human-approval",
                        "subjectId": "human-approval-node",
                        "mode": "fresh-decision",
                        "freshDecisionRequired": True,
                    }],
                    "outputs": [{
                        "id": "workflow:9:result", "role": "output", "kind": "artifact",
                        "name": "Workflow result", "contentDigest": SHA_E,
                        "required": True, "comparator": {"kind": "exact-digest"},
                        "baselineDigest": SHA_E,
                    }],
                    "stochastic": False,
                    "inputFingerprint": SHA_B,
                    "specFingerprint": SHA_C,
                    "executionContextFingerprint": SHA_D,
                    "baselineOutputFingerprint": SHA_E,
                }],
                "dependencies": [],
                "secretSlots": [{
                    "id": "secret:api-token", "name": "API token", "required": False,
                }],
                "breakpoints": [],
                "createdAt": "2026-08-05T10:00:00Z",
            }
            rehash_rerun_body(shared_spec)
            event = {
                "schemaVersion": "sciforge.execution-event.v1",
                "eventId": "event:run-9",
                "phase": "run_completed",
                "producer": {"moduleId": "sciforge.create-loop", "moduleVersion": "1.0.0"},
                "executionId": "workflow:9",
                "runId": "run:9",
                "occurredAt": "2026-08-05T10:00:00Z",
                "payload": {},
                "artifacts": [
                    {"kind": "sciforge.repro-spec", "spec": shared_spec},
                    {
                        "kind": "sciforge.create-loop.run-manifest",
                        "runId": "run:9",
                        "workflowId": "workflow:9",
                        "manifest": manifest,
                    },
                ],
            }
            delta = ingest_trace_lineage(graph, [event], registry)
            self.assertEqual(delta["envelopes"], 1)
            self.assertEqual(len(graph.nodes_of(NodeType.WORKFLOW_RUN)), 1)
            self.assertEqual(len(graph.nodes_of(NodeType.TOOL_INVOCATION)), 1)
            run = graph.nodes_of(NodeType.WORKFLOW_RUN)[0]
            self.assertEqual(run.attributes["executor"]["kind"], "create-loop")
            alias_conclusion = next(
                node for node in graph.nodes_of(NodeType.CONCLUSION)
                if node.external_id == "conclusion:alias-run-9"
            )
            alias_lineage = graph.conclusion_lineage(alias_conclusion.id)
            self.assertFalse(any(
                point.get("blocking", True)
                for point in alias_lineage["coverage"]["breakpoints"]
            ))
            self.assertEqual(alias_lineage["coverage"]["groundedEvidenceCount"], 1)
            self.assertIn(
                run.id, alias_lineage["coverage"]["components"]["activities"],
            )
            alias_snapshot = build_snapshot(
                graph, version=1, input_watermark="event:run-9:alias",
            )
            alias_spec = build_rerun_spec(graph, alias_snapshot, alias_conclusion.id)
            self.assertTrue(alias_spec["executionReady"])
            self.assertEqual(
                alias_spec["activities"][0]["executor"],
                shared_spec["activities"][0]["executor"],
            )
            approval = graph.nodes_of(NodeType.APPROVAL_DECISION)[0]
            self.assertEqual(
                approval.attributes["declaredSubjectId"], "human-approval-node",
            )
            self.assertTrue(any(
                edge.rel == EdgeRel.PART_OF and edge.dst == run.id
                for edge in graph.edges.values()
            ))
            self.assertTrue(any(
                edge.rel == EdgeRel.AUTHORIZED_BY
                and edge.src == run.id and edge.dst == approval.id
                for edge in graph.edges.values()
            ))
            finding = graph.add_or_get_node(
                NodeType.FINDING, "Workflow 9 produced the recorded result.",
                external_id="evidence:run-9", identity_scope="evidence:run-9",
                attributes={"semanticRole": "evidence"},
            )
            conclusion = graph.add_or_get_node(
                NodeType.CONCLUSION, "Workflow 9 completed with the recorded result.",
                external_id="conclusion:run-9", identity_scope="conclusion:run-9",
                attributes={"semanticRole": "conclusion"},
            )
            graph.add_edge(finding.id, run.id, EdgeRel.GENERATED_BY)
            graph.add_edge(finding.id, conclusion.id, EdgeRel.SUPPORTS)
            self.assertIn(
                approval.id,
                graph.conclusion_lineage(conclusion.id)["coverage"]["components"]["approvals"],
            )
            snapshot = build_snapshot(graph, version=1, input_watermark="event:run-9")
            spec = build_rerun_spec(graph, snapshot, conclusion.id)
            self.assertEqual(spec["activities"][0]["executor"]["kind"], "create-loop")
            self.assertEqual(spec["activities"][0]["executor"],
                             shared_spec["activities"][0]["executor"])
            self.assertEqual(
                spec["activities"][0]["executor"]["workflow"]["workflow"]["env"][0]["value"],
                safe_placeholder,
            )
            self.assertNotIn("version", spec["activities"][0]["tools"][0])
            self.assertTrue(spec["executionReady"])
            self.assertEqual(spec["secretSlots"], shared_spec["secretSlots"])
            self.assertTrue(any(
                point["code"] == "required_approval_not_observed"
                and point["component"] == "approval" and not point["blocking"]
                for point in spec["breakpoints"]
            ))
            self.assertEqual(spec["reproducibility"], "uncontrolled")
            self.assertEqual(spec["activities"][0]["inputs"][0]["contentDigest"], SHA_B)
            self.assertEqual(spec["activities"][0]["environments"][0]["contentDigest"], SHA_D)


if __name__ == "__main__":
    unittest.main()
