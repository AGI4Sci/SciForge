"""End-to-end tests for the canonical Project DAG workflow."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from evidence_dag import provjson, rerun as rerun_module
from evidence_dag.artifact_versions import ArtifactVersionProjectionClient
from evidence_dag.graph import ThreadGraph
from evidence_dag.lineage import ingest_trace_lineage
from evidence_dag.llm import LLMCallError
from evidence_dag.model import (
    Artifact, ArtifactVersion, EdgeRel, NodeStatus, NodeType, SourceAnchor, SourceSelector,
)
from evidence_dag.snapshot import build_snapshot, snapshot_filename, snapshot_storage_key

from project_dag.contracts import digest_json, remediation_candidate, select_a3_action
from project_dag.judge import Judge, ProjectJudgementError, StubJudge
from project_dag.service import Engine
from project_dag.store import Store, _upgrade_v2_to_v3


def make_judge() -> StubJudge:
    def distill(payload):
        goals = payload["active_goals"]
        return {
            "statement": payload["claim"], "claim_type": "finding",
            "mentioned_entities": ["pipeline"],
            "addresses_goal": goals[0]["id"] if goals else "none",
            "source_node_ids": [n["id"] for n in payload["subgraph"]["nodes"]],
            "confidence": 0.9,
        }

    def equiv(payload):
        new = payload["new"].lower().replace("again ", "")
        for claim in payload["pool"]:
            if claim["statement"].lower() == new:
                return {"relation": "equivalent", "target": claim["id"], "confidence": 0.95}
        return {"relation": "new", "target": None, "confidence": 0.9}

    return StubJudge({
        "distill": distill,
        "goal_match": lambda p: {
            "goal_id": p["active_goals"][-1]["id"] if p["active_goals"] else "none",
            "confidence": 0.92,
            "reason": "best active goal",
        },
        "entity_same": lambda p: {"same": p["name"].lower() == p["candidate"].lower(),
                                   "confidence": 0.95},
        "claim_equiv": equiv,
        "contradiction": lambda p: {"contradicts": False, "confidence": 0.9},
        "a1_verify": lambda p: {
            "entailment": {"result": "passed", "confidence": 0.91, "reason": "explicit support"},
            "applicability": {"result": "passed", "confidence": 0.86, "reason": "scope aligns"},
        },
        "a2_adversarial": lambda p: {
            "methodology": {"result": "uncertain", "confidence": 0.62,
                            "reason": "method metadata incomplete"},
            "reproducibility": {"result": "uncertain", "confidence": 0.6,
                                "reason": "not a local run"},
            "independence": {"result": "passed", "confidence": 0.88,
                             "reason": "stable artifact identity"},
        },
    })


class ExplodingJudge:
    """Fail the test if any Project model/Judge path is touched."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, *_args, **_kwargs) -> dict:
        self.calls += 1
        raise AssertionError("canonical Evidence promotion must not call Judge")

    def warm_many(self, *_args, **_kwargs) -> list[dict]:
        self.calls += 1
        raise AssertionError("canonical Evidence promotion must not warm Judge")


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def write_snapshot(directory: str, thread_id: str, claims: list[tuple[str, str]],
                   version: int = 1, node_type: NodeType = NodeType.CLAIM,
                   artifact_kind: str = "paper", artifact_locator: str | None = None,
                   node_status: NodeStatus = NodeStatus.SUPPORTED,
                   node_created_by: str | None = None,
                   node_attributes: dict | None = None) -> dict:
    graph = ThreadGraph(thread_id)
    for index, (claim_text, source_text) in enumerate(claims):
        artifact_id = f"artifact:{thread_id}:{index}"
        version_id = f"artifact-version:{thread_id}:{version}:{index}"
        anchor_id = f"anchor:{thread_id}:{version}:{index}"
        artifact = Artifact(
            artifact_id=artifact_id, kind=artifact_kind, created_at="2026-07-10T00:00:00Z",
            current_version_id=version_id, access_policy={"read": True},
        )
        artifact_version = ArtifactVersion(
            version_id=version_id, artifact_id=artifact_id,
            locator=artifact_locator or f"papers/{thread_id}-{index}.pdf",
            content_digest=_sha(source_text),
            version=str(version), size=len(source_text), media_type="application/pdf",
            observed_at="2026-07-10T00:00:00Z", availability="available",
            retention="reference",
        )
        anchor = SourceAnchor(
            anchor_id=anchor_id, artifact_id=artifact_id,
            artifact_version_id=version_id,
            selector=SourceSelector(type="pdf", page=index + 1, quote=source_text),
            anchor_digest=_sha(source_text), created_at="2026-07-10T00:00:00Z",
        )
        graph.attach_registry_records(artifact=artifact, artifact_version=artifact_version,
                                      source_anchor=anchor)
        source = graph.add_or_get_node(
            NodeType.SOURCE_ASSERTION, source_text, artifact_id=artifact_id,
            artifact_version_id=version_id, source_anchor_id=anchor_id,
            source_quality=0.9,
        )
        claim = graph.add_or_get_node(
            node_type, claim_text, created_by=node_created_by,
            attributes=dict(node_attributes or {}),
        )
        claim.status = node_status
        graph.add_edge(source.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.94)
    snapshot = build_snapshot(graph, version=version, input_watermark=f"turn:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    serialized = provjson.dumps(graph)
    with open(os.path.join(directory, snapshot_filename(thread_id)), "w", encoding="utf-8") as handle:
        handle.write(serialized)
    historical_dir = os.path.join(directory, "snapshots", snapshot_storage_key(thread_id))
    os.makedirs(historical_dir, exist_ok=True)
    historical_path = os.path.join(
        historical_dir, f"{version:08d}-{snapshot.digest[7:]}.prov.json",
    )
    with open(historical_path, "x", encoding="utf-8") as handle:
        handle.write(serialized)
    return snapshot.to_dict()


def write_execution_lineage_snapshot(
        directory: str, thread_id: str, *, version: int = 1) -> tuple[dict, str]:
    """Write one native Conclusion with the complete reproducibility closure."""
    graph = ThreadGraph(thread_id)
    workflow = {
        "id": "workflow:project-integration",
        "name": "Project integration workflow",
        "env": [{
            # The workflow records an environment-variable indirection, never
            # a credential value. It is safe to preserve byte-for-byte.
            "key": "API_TOKEN", "value": "${API_TOKEN}",
        }],
        "nodes": [],
        "connections": [],
    }
    executor_input = {"datasetDigest": _sha("dataset-v1")}
    executor_context = {
        "workspaceRoot": directory,
        "packageOwner": "sciforge.create-loop",
        "packageVersion": "1.0.0",
        "nodeVersion": "v24.0.0",
        "platform": "darwin",
        "architecture": "arm64",
        "environment": [],
    }
    baseline_output = {"resultDigest": _sha("result-v1")}
    workflow_fingerprint = rerun_module._digest(workflow)
    input_fingerprint = rerun_module._digest(executor_input)
    context_fingerprint = rerun_module._digest(executor_context)
    output_fingerprint = rerun_module._digest(baseline_output)
    comparator = {"kind": "exact-digest"}
    approval_requirements = [{
        "id": "approval:historical:project-integration",
        "kind": "workflow-human-approval",
        "subjectId": "tool:statistics:v4",
        "mode": "confirm",
        "freshDecisionRequired": True,
        "policyDigest": _sha("approval-policy-v1"),
    }]
    spec_fingerprint = rerun_module._digest({
        "workflowFingerprint": workflow_fingerprint,
        "inputFingerprint": input_fingerprint,
        "contextFingerprint": context_fingerprint,
        "approvalRequirements": approval_requirements,
        "comparator": comparator,
    })
    executor_payload = {
        "schemaVersion": "sciforge.create-loop.executor.v1",
        "workflow": workflow,
        "input": executor_input,
        "context": executor_context,
        "baseline": {
            "runId": "baseline-run:project-integration",
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
    envelope = {
        "workflowRun": {
            "id": "workflow-run:project-integration",
            "name": "Project integration workflow",
            "status": "completed",
            "parameters": {"alpha": 0.05},
            "stochastic": False,
            "inputFingerprint": input_fingerprint,
            "specFingerprint": spec_fingerprint,
            "contextFingerprint": context_fingerprint,
            "outputFingerprint": output_fingerprint,
            "executor": {
                "kind": "create-loop",
                "workflow": executor_payload,
                "workflowDigest": rerun_module._digest(executor_payload),
                "target": {"kind": "workflow", "id": "workflow:project-integration"},
            },
        },
        "inputs": [{
            "id": "input:dataset:v1",
            "type": "dataset_version",
            "name": "RAW_INPUT_CANARY",
            "contentDigest": _sha("dataset-v1"),
            "version": "1",
            "artifact": {
                "kind": "dataset", "locator": "inputs/data-v1.csv",
                "contentDigest": _sha("dataset-v1"), "version": "1",
                "mediaType": "text/csv",
            },
        }],
        "software": [{
            "id": "software:analysis:commit-1",
            "type": "software_version",
            "name": "RAW_CODE_CANARY",
            "contentDigest": _sha("commit-1"),
            "version": "commit-1",
            "artifact": {
                "kind": "code", "locator": "src/analysis.py",
                "contentDigest": _sha("commit-1"), "version": "commit-1",
                "mediaType": "text/x-python",
            },
        }],
        "environment": [{
            "id": "environment:oci:v1",
            "name": "RAW_ENVIRONMENT_CANARY",
            "containerDigest": _sha("oci-image-v1"),
            "platform": "linux", "architecture": "arm64",
            "runtimeVersions": {"python": "3.12.4"},
        }],
        "parameters": {
            "id": "parameters:project-integration",
            "name": "RAW_PARAMETERS_CANARY",
            "values": {"alpha": 0.05, "method": "welch"},
            "randomSeed": 73,
        },
        "tools": [{
            "id": "tool:statistics:v4",
            "name": "RAW_TOOL_CANARY",
            "providerId": "sciforge", "actionId": "statistics.run",
            "version": "4.2.0", "arguments": {"method": "welch"},
            "supportsSeed": True,
            "parentId": "workflow-run:project-integration",
        }],
        "approvals": [{
            "id": "approval:historical:project-integration",
            "name": "RAW_APPROVAL_CANARY",
            "kind": "workflow-human-approval", "mode": "confirm",
            "subjectId": "tool:statistics:v4", "status": "approved",
            "policyDigest": _sha("approval-policy-v1"),
        }],
        "outputs": [{
            "id": "artifact:result:v1",
            "type": "artifact",
            "name": "RAW_ARTIFACT_CANARY",
            "contentDigest": output_fingerprint,
            "comparator": comparator,
            "value": baseline_output,
            "artifact": {
                "kind": "other", "locator": "outputs/result-v1.json",
                "contentDigest": output_fingerprint, "version": "1",
                "mediaType": "application/json",
            },
        }],
        "evidence": [{
            "id": "evidence:finding:project-integration",
            "type": "finding",
            "name": "The deterministic output supports the conclusion.",
        }],
        "conclusion": {
            "id": "conclusion:project-integration",
            "name": "The recorded workflow supports the final conclusion.",
        },
        "relations": [
            {"src": "evidence:finding:project-integration",
             "dst": "workflow-run:project-integration", "rel": "generated_by"},
            {"src": "evidence:finding:project-integration",
             "dst": "conclusion:project-integration", "rel": "supports"},
        ],
    }
    def projection_record(
        *, artifact_id: str, version_id: str, kind: str, locator: str,
        content_digest: str, media_type: str,
    ) -> dict:
        return {
            "ref": {
                "artifactId": artifact_id,
                "versionId": version_id,
                "contentDigest": content_digest.removeprefix("sha256:"),
                "byteLength": 0,
                "mediaType": media_type,
                "availability": "available",
                "retention": "reference",
                "accessPolicy": {
                    "visibility": "workspace",
                    "principals": [],
                    "allowExport": True,
                },
            },
            "kind": kind,
            "locator": locator,
            "observedAt": "2026-08-05T10:00:00Z",
        }

    trace = [{
        "id": "execution-result:project-integration",
        "kind": "tool_result",
        "evidenceLineage": envelope,
        "evidenceArtifactVersions": {
            "status": "ready",
            "versions": [
                projection_record(
                    artifact_id="artifact:project-input",
                    version_id="artifact-version:project-input-v1",
                    kind="dataset",
                    locator="inputs/data-v1.csv",
                    content_digest=_sha("dataset-v1"),
                    media_type="text/csv",
                ),
                projection_record(
                    artifact_id="artifact:project-code",
                    version_id="artifact-version:project-code-v1",
                    kind="code",
                    locator="src/analysis.py",
                    content_digest=_sha("commit-1"),
                    media_type="text/x-python",
                ),
                projection_record(
                    artifact_id="artifact:project-output",
                    version_id="artifact-version:project-output-v1",
                    kind="other",
                    locator="outputs/result-v1.json",
                    content_digest=output_fingerprint,
                    media_type="application/json",
                ),
            ],
            "lifecycleEvents": [],
            "lastSequence": 0,
        },
    }]
    artifact_versions = ArtifactVersionProjectionClient(
        trace, workspace_roots=(directory,), locator_root=directory,
    )
    delta = ingest_trace_lineage(
        graph, trace, artifact_versions, created_by="sdk-execution-lineage",
    )
    if delta["envelopes"] != 1:
        raise AssertionError("execution lineage envelope was not ingested")
    finding = graph.nodes_of(NodeType.FINDING)[0]
    conclusion = graph.nodes_of(NodeType.CONCLUSION)[0]
    finding.status = NodeStatus.FRAGILE
    conclusion.status = NodeStatus.FRAGILE
    snapshot = build_snapshot(
        graph, version=version, input_watermark=f"execution:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    serialized = provjson.dumps(graph)
    with open(os.path.join(directory, snapshot_filename(thread_id)), "w",
              encoding="utf-8") as handle:
        handle.write(serialized)
    historical_dir = os.path.join(directory, "snapshots", snapshot_storage_key(thread_id))
    os.makedirs(historical_dir, exist_ok=True)
    with open(os.path.join(
        historical_dir, f"{snapshot.version:08d}-{snapshot.digest[7:]}.prov.json",
    ), "x", encoding="utf-8") as handle:
        handle.write(serialized)
    return snapshot.to_dict(), conclusion.id


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.engine = Engine(os.path.join(self.tmp.name, "project.db"), self.sessions,
                             judge=make_judge())
        self.project = "path:/workspace/a"
        self.goal = self.engine.create_goal(self.project, "Assess the pipeline")

    def tearDown(self):
        self.engine.store.close()
        self.tmp.cleanup()

    def enqueue(self, snapshots: list[dict], *, project: str | None = None,
                reason: str = "manual_immediate", mode: str = "autonomous") -> dict:
        vector = [{"threadId": s["threadId"], "digest": s["digest"]} for s in snapshots]
        return self.engine.enqueue_update({
            "projectKey": project or self.project,
            "evidenceVector": vector,
            "capturedScope": {"includedSessions": [s["threadId"] for s in snapshots],
                              "excludedSessions": [], "isolatedSessions": []},
            "reason": reason, "priority": 5, "autonomyMode": mode,
        })

    def drain(self, project: str | None = None, limit: int = 5) -> list[dict]:
        out = []
        for _ in range(limit):
            update = self.engine.process_updates(project or self.project)
            audit = self.engine.process_audits(project or self.project)
            if update is not None:
                out.append(update)
            if update is None and audit is None:
                break
        return out

    def test_committed_snapshot_compiles_with_immutable_vector_and_provenance(self):
        evidence = write_snapshot(self.sessions, "sciforge:thr/1",
                                  [("pipeline improves accuracy", "paper says so")])
        self.enqueue([evidence])
        runs = self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertIsNotNone(latest)
        self.assertEqual(latest["evidenceVector"],
                         [{"threadId": "sciforge:thr/1", "digest": evidence["digest"]}])
        self.assertEqual(latest["status"], "committed")
        self.assertEqual(len(latest["assessments"]), 2)
        self.assertEqual({item["level"] for item in latest["assessments"]}, {"A0"})
        persisted_levels = {
            item["level"] for item in self.engine.workflow.assessments(
                self.project, latest["digest"])
        }
        self.assertEqual(persisted_levels, {"A0", "A1", "A2"})
        claim = latest["graph"]["claims"][0]
        provenance = self.engine.resolve_provenance(self.project, claim["id"], latest["digest"])
        self.assertTrue(provenance["reachesArtifact"])
        self.assertEqual(provenance["provenanceLevel"], "L3")
        self.assertNotIn("distill", {a["actor"] for a in latest["assessments"]
                                     if a["level"] in {"A1", "A2"}})
        self.assertGreaterEqual(len(runs), 1)

    def test_native_conclusion_promotes_with_full_lineage_and_canonical_rerun_spec(self):
        exploding_judge = ExplodingJudge()
        self.engine.judge = exploding_judge
        self.engine._compiler.judge = exploding_judge
        evidence, evidence_conclusion_id = write_execution_lineage_snapshot(
            self.sessions, "execution-lineage-session",
        )
        self.enqueue([evidence], reason="execution_completed")
        self.engine.process_updates(self.project)

        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertIsNotNone(latest)
        claims = latest["graph"]["claims"]
        self.assertEqual(len(claims), 2)
        claim = next(item for item in claims if item["claim_type"] == "conclusion")
        finding_claim = next(item for item in claims if item["claim_type"] == "finding")
        self.assertEqual(
            claim["statement"], "The recorded workflow supports the final conclusion.")
        self.assertEqual(claim["claim_type"], "conclusion")
        self.assertEqual(
            finding_claim["statement"],
            "The deterministic output supports the conclusion.",
        )
        self.assertEqual({item["status"] for item in claims}, {"fragile"})
        self.assertEqual({item["confidence"] for item in claims}, {0.0})
        self.assertTrue(all(item["goal_id"] is None for item in claims))
        self.assertEqual(latest["graph"]["entities"], [])
        self.assertFalse(any(
            edge["edge_type"] in {"addresses", "mentions"}
            for edge in latest["graph"]["edges"]
        ))
        self.assertEqual(exploding_judge.calls, 0)
        self.assertFalse(any(item["claim_type"] == "decision" for item in claims))
        self.assertEqual(latest["graph"]["decisions"], [])
        self.assertIsNone(self.engine.store.q1(
            "SELECT id FROM decision_event WHERE project_key=? LIMIT 1", (self.project,),
        ))

        evidence_refs = latest["graph"]["evidence"]
        self.assertTrue(evidence_refs)
        self.assertTrue(all(set(item) == {
            "id", "project_key", "thread_id", "snapshot_digest", "node_id", "node_type",
        } for item in evidence_refs))
        expected_node_types = {
            "dataset_version", "software_version", "environment", "parameter_set",
            "tool_invocation", "approval_decision", "artifact", "finding",
            "workflow_run", "conclusion",
        }
        self.assertTrue(expected_node_types.issubset({
            item["node_type"] for item in evidence_refs
        }))
        self.assertTrue(any(
            item["node_type"] == "conclusion" and item["node_id"] == evidence_conclusion_id
            for item in evidence_refs
        ))
        attached_ref_ids = {
            endpoint
            for edge in latest["graph"]["edges"]
            if edge["edge_type"] in {"supports", "derived_from"}
            and claim["id"] in {edge["src"], edge["dst"]}
            for endpoint in (edge["src"], edge["dst"])
            if endpoint != claim["id"]
        }
        self.assertEqual(attached_ref_ids, {item["id"] for item in evidence_refs})

        orphan = self.engine.store.q1(
            "SELECT payload FROM review WHERE project_key=?"
            " AND review_type='orphan_claims'", (self.project,),
        )
        self.assertIsNotNone(orphan)
        candidates = json.loads(orphan["payload"])["candidates"]
        self.assertEqual({item["claim_type"] for item in candidates}, {
            "finding", "conclusion",
        })
        conclusion_candidate = next(
            item for item in candidates if item["claim_type"] == "conclusion"
        )
        finding_candidate = next(
            item for item in candidates if item["claim_type"] == "finding"
        )
        finding_node_id = next(
            item["node_id"] for item in evidence_refs if item["node_type"] == "finding"
        )
        self.assertEqual(
            set(conclusion_candidate["source_node_ids"]),
            {evidence_conclusion_id, finding_node_id},
        )
        self.assertEqual(finding_candidate["source_node_ids"], [finding_node_id])
        self.assertNotIn(
            "conclusion:project-integration", conclusion_candidate["source_node_ids"])

        stored_payload = self.engine.store.q1(
            "SELECT payload FROM project_snapshot WHERE digest=?", (latest["digest"],),
        )["payload"]
        for canary in (
            "RAW_INPUT_CANARY", "RAW_CODE_CANARY", "RAW_ENVIRONMENT_CANARY",
            "RAW_PARAMETERS_CANARY", "RAW_TOOL_CANARY", "RAW_APPROVAL_CANARY",
            "RAW_ARTIFACT_CANARY",
        ):
            self.assertNotIn(canary, stored_payload)

        provenance = self.engine.resolve_provenance(
            self.project, claim["id"], latest["digest"],
        )
        self.assertEqual(provenance["provenanceLevel"], "L4")
        lineage_nodes = {
            item["id"]: item for item in provenance["lineageGraph"]["nodes"]
        }
        self.assertTrue(expected_node_types.issubset({
            item["nodeType"] for item in lineage_nodes.values()
        }))
        self.assertTrue(any(
            edge["relation"] == "part_of"
            and lineage_nodes[edge["src"]]["nodeType"] == "tool_invocation"
            and lineage_nodes[edge["dst"]]["nodeType"] == "workflow_run"
            for edge in provenance["lineageGraph"]["edges"]
            if edge["src"] in lineage_nodes and edge["dst"] in lineage_nodes
        ))

        self.assertEqual(len(provenance["rerunSpecs"]), 1)
        spec = provenance["rerunSpecs"][0]
        self.assertEqual(set(spec), {
            "schemaVersion", "specId", "specDigest", "source", "target",
            "executionReady", "reproducibility", "activities", "dependencies",
            "secretSlots", "breakpoints", "createdAt",
        })
        self.assertEqual(spec["schemaVersion"], "sciforge.rerun.v1")
        self.assertTrue(spec["executionReady"])
        self.assertTrue(spec["activities"][0]["approvals"][0]["freshDecisionRequired"])
        self.assertEqual(spec["secretSlots"], [])
        self.assertEqual(
            spec["activities"][0]["executor"]["workflow"]["workflow"]["env"][0]["value"],
            "${API_TOKEN}",
        )
        self.assertEqual(len(provenance["rerunSpecReferences"]), 1)
        self.assertEqual(
            provenance["rerunSpecReferences"][0]["specDigest"], spec["specDigest"],
        )
        self.assertEqual(
            provenance["paths"][0]["rerunSpecReference"]["specDigest"],
            spec["specDigest"],
        )

    def test_incremental_declared_snapshot_bypasses_all_judgements_with_live_candidates(self):
        """A later canonical digest stays model-free with prior Project state.

        Two sessions intentionally declare the same Finding and Conclusion so
        the second compile has live semantic candidates from another session.
        Advancing one Evidence Snapshot also refreshes its earlier Project
        claims. Neither condition may re-enter distill, equivalence, entity,
        contradiction, or judgement warm-up.
        """
        advancing_v1, _ = write_execution_lineage_snapshot(
            self.sessions, "incremental-declared-advancing", version=1,
        )
        stable_v1, _ = write_execution_lineage_snapshot(
            self.sessions, "incremental-declared-stable", version=1,
        )
        self.enqueue([advancing_v1, stable_v1], reason="execution_completed")
        first = self.engine.process_updates(self.project)
        self.assertEqual(first["job"]["status"], "succeeded")
        first_snapshot = first["snapshot"]
        first_advancing_claim_ids = {
            row["claim_id"] for row in self.engine.store.q(
                "SELECT claim_id FROM claim_origin"
                " WHERE project_key=? AND session_id=? ORDER BY claim_id",
                (self.project, "incremental-declared-advancing"),
            )
        }
        self.assertEqual(len(first_advancing_claim_ids), 2)
        self.assertEqual(len(first_snapshot["graph"]["claims"]), 4)

        exploding_judge = ExplodingJudge()
        self.engine.judge = exploding_judge
        self.engine._compiler.judge = exploding_judge
        self.engine.workflow.compiler.judge = exploding_judge
        advancing_v2, _ = write_execution_lineage_snapshot(
            self.sessions, "incremental-declared-advancing", version=2,
        )
        self.enqueue([advancing_v2, stable_v1], reason="execution_completed")
        second = self.engine.process_updates(self.project)

        self.assertEqual(exploding_judge.calls, 0)
        self.assertEqual(second["job"]["status"], "succeeded")
        self.assertEqual(second["compile"]["stats"]["sessions_compiled"], 1)
        self.assertEqual(second["compile"]["stats"]["claims_added"], 2)
        self.assertEqual(second["compile"]["stats"]["claims_merged"], 0)
        self.assertEqual(second["compile"]["stats"]["conflicts"], 0)
        self.assertEqual(second["snapshot"]["evidenceVector"], [
            {"threadId": "incremental-declared-advancing",
             "digest": advancing_v2["digest"]},
            {"threadId": "incremental-declared-stable", "digest": stable_v1["digest"]},
        ])

        second_advancing_claim_ids = {
            row["claim_id"] for row in self.engine.store.q(
                "SELECT claim_id FROM claim_origin"
                " WHERE project_key=? AND session_id=? ORDER BY claim_id",
                (self.project, "incremental-declared-advancing"),
            )
        }
        self.assertEqual(len(second_advancing_claim_ids), 2)
        self.assertTrue(first_advancing_claim_ids.isdisjoint(second_advancing_claim_ids))
        self.assertEqual(
            self.engine.store.q1(
                "SELECT COUNT(*) AS n FROM claim WHERE project_key=?"
                " AND id IN (?,?) AND t_invalid IS NOT NULL",
                (self.project, *sorted(first_advancing_claim_ids)),
            )["n"],
            2,
        )
        live_claims = second["snapshot"]["graph"]["claims"]
        self.assertEqual(len(live_claims), 4)
        self.assertEqual(
            {claim["claim_type"] for claim in live_claims},
            {"finding", "conclusion"},
        )
        advancing_refs = [
            ref for ref in second["snapshot"]["graph"]["evidence"]
            if ref["thread_id"] == "incremental-declared-advancing"
        ]
        self.assertTrue(advancing_refs)
        self.assertEqual(
            {ref["snapshot_digest"] for ref in advancing_refs},
            {advancing_v2["digest"]},
        )

    def test_sdk_declared_finding_promotes_without_distill(self):
        statement = "The SDK-declared analysis found a measured effect."
        evidence = write_snapshot(
            self.sessions, "sdk-declared-finding",
            [(statement, "The recorded output contains the measured effect.")],
            node_type=NodeType.FINDING,
            node_status=NodeStatus.FRAGILE,
            node_created_by="sdk-execution-lineage",
            node_attributes={"lineageRole": "evidence", "semanticRole": "evidence"},
        )
        self.engine.judge.calls.clear()
        self.enqueue([evidence], reason="execution_completed")
        self.engine.process_updates(self.project)

        claim = self.engine.workflow.latest_snapshot(self.project)["graph"]["claims"][0]
        self.assertEqual(claim["statement"], statement)
        self.assertEqual(claim["claim_type"], "finding")
        self.assertEqual(claim["confidence"], 0.0)
        self.assertEqual(claim["status"], "fragile")
        self.assertIsNone(claim["goal_id"])
        self.assertEqual(self.engine.judge.calls, [])

    def test_mixed_declared_and_unknown_nodes_distill_only_the_unknown_node(self):
        declared, _ = write_execution_lineage_snapshot(
            self.sessions, "mixed-declared-session",
        )
        unknown_statement = "The legacy evidence node still requires interpretation."
        unknown = write_snapshot(
            self.sessions, "mixed-unknown-session",
            [(unknown_statement, "The legacy source supports its statement.")],
        )
        self.engine.judge.calls.clear()
        self.enqueue([declared, unknown], reason="execution_completed")
        self.engine.process_updates(self.project)

        distilled = [
            payload["claim"] for task, payload in self.engine.judge.calls
            if task == "distill"
        ]
        self.assertEqual(distilled, [unknown_statement])
        self.assertEqual(
            [task for task, _payload in self.engine.judge.calls], ["distill"])
        claims = self.engine.workflow.latest_snapshot(self.project)["graph"]["claims"]
        declared_claim = next(
            item for item in claims if item["claim_type"] == "conclusion"
        )
        self.assertEqual(
            declared_claim["statement"],
            "The recorded workflow supports the final conclusion.",
        )
        self.assertEqual(declared_claim["confidence"], 0.0)

    def test_projects_with_different_goals_reuse_the_same_evidence_reference(self):
        evidence = write_snapshot(
            self.sessions, "shared-evidence",
            [("The shared result supports either project view.",
              "The immutable source records the shared result.")],
        )
        other_project = "path:/workspace/other-view"
        other_goal = self.engine.create_goal(other_project, "Interpret the shared result")

        self.enqueue([evidence], project=self.project, reason="manual_immediate")
        self.drain(self.project)
        self.enqueue([evidence], project=other_project, reason="manual_immediate")
        self.drain(other_project)

        primary = self.engine.workflow.latest_snapshot(self.project)
        other = self.engine.workflow.latest_snapshot(other_project)
        shared_vector = [{"threadId": "shared-evidence", "digest": evidence["digest"]}]
        self.assertEqual(primary["evidenceVector"], shared_vector)
        self.assertEqual(other["evidenceVector"], shared_vector)
        self.assertEqual(primary["graph"]["goals"][0]["root_id"], self.goal["root_id"])
        self.assertEqual(other["graph"]["goals"][0]["root_id"], other_goal["root_id"])
        self.assertEqual(primary["graph"]["claims"][0]["goal_id"], self.goal["root_id"])
        self.assertEqual(other["graph"]["claims"][0]["goal_id"], other_goal["root_id"])
        self.assertEqual(primary["graph"]["entities"][0]["project_key"], self.project)
        self.assertEqual(other["graph"]["entities"][0]["project_key"], other_project)
        self.assertNotEqual(primary["graph"]["entities"][0]["id"],
                            other["graph"]["entities"][0]["id"])
        self.assertNotEqual(primary["digest"], other["digest"])

    def test_project_database_does_not_copy_evidence_snapshot_envelopes(self):
        table = self.engine.store.q1(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_snapshot'")
        self.assertIsNone(table)
        columns = {row["name"] for row in self.engine.store.q("PRAGMA table_info(evidence)")}
        self.assertEqual(columns, {
            "id", "project_key", "thread_id", "snapshot_digest", "node_id", "node_type",
        })
        canary = "RAW_SOURCE_CONTENT_MUST_NOT_ENTER_PROJECT_DB"
        evidence = write_snapshot(
            self.sessions, "reference-only",
            [("A derived project statement.", canary)],
        )
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        payload = self.engine.store.q1(
            "SELECT payload FROM project_snapshot WHERE project_key=?"
            " ORDER BY version DESC LIMIT 1", (self.project,))["payload"]
        self.assertNotIn(canary, payload)

    def test_entity_reconciliation_never_reads_or_mutates_another_project(self):
        def distill(payload):
            goals = payload["active_goals"]
            name = payload["claim"]
            return {
                "statement": f"Derived view for {name}.", "claim_type": "finding",
                "mentioned_entities": [name],
                "addresses_goal": goals[0]["id"] if goals else "none",
                "source_node_ids": [n["id"] for n in payload["subgraph"]["nodes"]],
                "confidence": 0.9,
            }

        self.engine.judge.handlers["distill"] = distill
        self.engine.judge.handlers["entity_same"] = lambda _p: {
            "same": True, "confidence": 0.95,
        }
        first = write_snapshot(self.sessions, "entity-a", [("pipeline", "source a")])
        self.enqueue([first], reason="manual_immediate"); self.drain()
        primary_entity = self.engine.workflow.latest_snapshot(
            self.project)["graph"]["entities"][0]

        other_project = "path:/workspace/entity-b"
        self.engine.create_goal(other_project, "Other entity view")
        self.engine.judge.calls.clear()
        second = write_snapshot(self.sessions, "entity-b", [("pipelines", "source b")])
        self.enqueue([second], project=other_project, reason="manual_immediate")
        self.drain(other_project)

        candidates = [payload.get("candidate") for task, payload in self.engine.judge.calls
                      if task == "entity_same"]
        self.assertNotIn("pipeline", candidates)
        other_entity = self.engine.workflow.latest_snapshot(
            other_project)["graph"]["entities"][0]
        self.assertNotEqual(primary_entity["id"], other_entity["id"])
        persisted_primary = self.engine.store.q1(
            "SELECT aliases FROM entity WHERE id=? AND project_key=?",
            (primary_entity["id"], self.project),
        )
        self.assertEqual(json.loads(persisted_primary["aliases"]), [])

    def test_supported_finding_uses_the_same_project_compile_path_as_claim(self):
        evidence = write_snapshot(
            self.sessions,
            "analysis-session",
            [("The analysis found a reproducible effect.", "The recorded output reports the effect.")],
            node_type=NodeType.FINDING,
        )
        self.enqueue([evidence], reason="manual_immediate")
        self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(len(latest["graph"]["claims"]), 1)
        self.assertEqual(latest["graph"]["claims"][0]["claim_type"], "finding")
        self.assertEqual(latest["graph"]["origins"][0]["session_id"], "analysis-session")

    def test_native_conclusion_never_merges_into_same_text_finding(self):
        statement = "The shared statement has distinct epistemic semantics."
        finding = write_snapshot(
            self.sessions, "finding-semantics", [(statement, "finding source")],
            node_type=NodeType.FINDING,
        )
        conclusion = write_snapshot(
            self.sessions, "conclusion-semantics", [(statement, "conclusion source")],
            node_type=NodeType.CONCLUSION,
        )
        self.enqueue([finding, conclusion], reason="manual_immediate")
        self.engine.process_updates(self.project)

        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(
            sorted(item["claim_type"] for item in latest["graph"]["claims"]),
            ["conclusion", "finding"],
        )
        self.assertEqual(latest["graph"]["decisions"], [])
        self.assertEqual(
            len([item for item in latest["graph"]["evidence"]
                 if item["node_type"] == "conclusion"]),
            1,
        )

    def test_no_goal_claims_remain_visible_and_are_rematched_after_goal_creation(self):
        project = "path:/workspace/no-goal"
        evidence = write_snapshot(
            self.sessions, "no-goal-session",
            [("The experiment produced a measurable effect.",
              "The recorded output contains the measured effect.")],
        )
        self.enqueue([evidence], project=project, reason="manual_immediate")
        self.drain(project)

        unassigned = self.engine.workflow.latest_snapshot(project)
        self.assertEqual(len(unassigned["graph"]["claims"]), 1)
        claim = unassigned["graph"]["claims"][0]
        self.assertIsNone(claim["goal_id"])
        self.assertEqual(len(unassigned["graph"]["evidence"]), 1)
        self.assertTrue(any(
            edge["edge_type"] == "supports" and edge["dst"] == claim["id"]
            for edge in unassigned["graph"]["edges"]
        ))
        orphan = self.engine.store.q1(
            "SELECT * FROM review WHERE project_key=? AND review_type='orphan_claims'",
            (project,),
        )
        self.assertIsNotNone(orphan)
        orphan_payload = json.loads(orphan["payload"])
        self.assertEqual(orphan_payload["candidates"][0]["project_claim_id"], claim["id"])

        goal = self.engine.create_goal(project, "Measure the experimental effect")
        self.drain(project)
        assigned = self.engine.workflow.latest_snapshot(project)
        self.assertEqual(assigned["graph"]["claims"][0]["id"], claim["id"])
        self.assertEqual(assigned["graph"]["claims"][0]["goal_id"], goal["root_id"])
        self.assertTrue(any(
            edge["edge_type"] == "addresses"
            and edge["src"] == claim["id"] and edge["dst"] == goal["root_id"]
            for edge in assigned["graph"]["edges"]
        ))
        resolved = self.engine.store.q1("SELECT status FROM review WHERE id=?", (orphan["id"],))
        self.assertEqual(resolved["status"], "resolved")

    def test_runtime_trace_artifact_remains_l0_across_project_provenance(self):
        evidence = write_snapshot(
            self.sessions,
            "runtime-session",
            [("The agent reported a result.", "Visible agent output")],
            artifact_kind="log",
            artifact_locator="runtime:sciforge:runtime-session:item-1",
        )
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        claim_id = latest["graph"]["claims"][0]["id"]
        provenance = self.engine.resolve_provenance(self.project, claim_id, latest["digest"])
        self.assertEqual(provenance["provenanceLevel"], "L0")
        self.assertTrue(any(
            item["reason"] == "external_artifact_not_identified"
            for item in provenance["breakpoints"]
        ))

    def test_rejects_unknown_update_fields(self):
        with self.assertRaisesRegex(ValueError, "unknown update fields"):
            self.engine.enqueue_update({
                "projectKey": self.project,
                "evidenceVector": [{"threadId": "s1", "digest": _sha("x")}],
                "embeddedInput": {"threadId": "s1", "status": "updating"},
                "capturedScope": {"includedSessions": ["s1"]},
                "reason": "manual_update",
            })

    def test_rejects_missing_committed_snapshot_reference(self):
        with self.assertRaisesRegex(ValueError, "committed Evidence Snapshot.*unavailable"):
            self.engine.enqueue_update({
                "projectKey": self.project,
                "evidenceVector": [{"threadId": "s1", "digest": _sha("missing")}],
                "capturedScope": {
                    "includedSessions": ["s1"],
                    "excludedSessions": [],
                    "isolatedSessions": [],
                },
                "reason": "manual_update",
            })

    def test_explicit_scope_keeps_project_membership_and_isolates_projects(self):
        s1 = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        s2 = write_snapshot(self.sessions, "s2", [("claim two", "source two")])
        self.enqueue([s1, s2]); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual({v["threadId"] for v in latest["evidenceVector"]}, {"s1", "s2"})

        other = "path:/workspace/b"
        self.engine.create_goal(other, "Other workspace")
        s3 = write_snapshot(self.sessions, "s3", [("other claim", "other source")])
        self.enqueue([s3], project=other); self.drain(other)
        other_latest = self.engine.workflow.latest_snapshot(other)
        self.assertEqual([v["threadId"] for v in other_latest["evidenceVector"]], ["s3"])
        self.assertNotIn("s3", {v["threadId"] for v in latest["evidenceVector"]})

    def test_cross_session_shared_artifact_is_one_independent_source(self):
        first = write_snapshot(
            self.sessions, "shared-source-a",
            [("shared result", "identical immutable source")],
        )
        second = write_snapshot(
            self.sessions, "shared-source-b",
            [("again shared result", "identical immutable source")],
        )
        self.enqueue([first, second], reason="manual_immediate")
        update = self.engine.process_updates(self.project)
        graph = update["snapshot"]["graph"]
        self.assertEqual(len(graph["claims"]), 1)
        self.assertEqual(len(graph["evidence"]), 2)
        self.assertEqual(graph["claims"][0]["status"], "fragile")

        self.engine.process_audits(self.project)
        findings = self.engine.workflow.findings(self.project)
        self.assertTrue(any(
            finding["finding_type"] == "hidden_shared_source" for finding in findings
        ))

    def test_changed_digest_refreshes_same_id_support_and_artifact_provenance(self):
        first = write_snapshot(
            self.sessions, "s1", [("stable claim", "first source assertion")], version=1)
        self.enqueue([first], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]

        second = write_snapshot(
            self.sessions, "s1", [("stable claim", "replacement source assertion")], version=2)
        self.enqueue([second]); self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        status = self.engine.update_status(self.project)
        self.assertEqual(status["committedSnapshot"]["digest"], after["digest"])
        self.assertIsNotNone(status["previousCommittedSnapshot"])
        self.assertNotEqual(
            status["previousCommittedSnapshot"]["digest"], after["digest"])
        self.assertEqual(after["graph"]["claims"][0]["id"], claim_id)
        self.assertEqual(len(after["graph"]["claims"]), 1)
        evidence_ref = after["graph"]["evidence"][0]
        self.assertEqual(evidence_ref["thread_id"], "s1")
        self.assertEqual(evidence_ref["snapshot_digest"], second["digest"])
        self.assertNotIn("content", evidence_ref)
        detail = self.engine.claim_detail(self.project, claim_id, after["digest"])
        self.assertEqual([item["content"] for item in detail["supports"]],
                         ["replacement source assertion"])
        provenance = self.engine.resolve_provenance(self.project, claim_id, after["digest"])
        version = provenance["paths"][0]["sourceAssertions"][0]["artifactVersion"]
        self.assertEqual(version["version"], "2")
        self.assertEqual(version["contentDigest"], _sha("replacement source assertion"))
        historical = self.engine.resolve_provenance(self.project, claim_id, before["digest"])
        historical_version = historical["paths"][0]["sourceAssertions"][0]["artifactVersion"]
        self.assertEqual(historical_version["version"], "1")
        self.assertEqual(historical_version["contentDigest"], _sha("first source assertion"))

    def test_changed_digest_removes_claim_that_is_no_longer_eligible(self):
        first = write_snapshot(
            self.sessions, "s1", [("status-sensitive claim", "source assertion")], version=1)
        self.enqueue([first], reason="manual_immediate"); self.drain()
        self.assertEqual(len(self.engine.workflow.latest_snapshot(self.project)["graph"]["claims"]), 1)

        second = write_snapshot(
            self.sessions, "s1", [("status-sensitive claim", "source assertion")], version=2,
            node_status=NodeStatus.UNDETERMINED,
        )
        self.enqueue([second]); self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(after["evidenceVector"], [{"threadId": "s1", "digest": second["digest"]}])
        self.assertEqual(after["graph"]["claims"], [])
        self.assertEqual(after["graph"]["origins"], [])

    def test_scope_dispositions_survive_auto_updates_and_support_reinclude(self):
        s1 = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        s2 = write_snapshot(self.sessions, "s2", [("claim two", "source two")])
        self.enqueue([s1, s2], reason="manual_immediate"); self.drain()

        self.engine.enqueue_update({
            "projectKey": self.project,
            "evidenceVector": [{"threadId": "s1", "digest": s1["digest"]}],
            "capturedScope": {
                "includedSessions": ["s1"],
                "excludedSessions": ["s2"],
                "isolatedSessions": [],
            },
            "reason": "manual_immediate",
        })
        self.drain()
        excluded = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(excluded["evidenceVector"],
                         [{"threadId": "s1", "digest": s1["digest"]}])
        self.assertEqual(excluded["excludedSessions"], ["s2"])
        self.assertEqual(len(excluded["graph"]["claims"]), 1)
        self.assertEqual({origin["session_id"] for origin in excluded["graph"]["origins"]},
                         {"s1"})
        self.assertTrue(all(
            all(origin["session"] == "s1" for origin in json.loads(edge["meta"])["origins"])
            for edge in excluded["graph"]["edges"] if edge["edge_type"] == "supports"
        ))

        changed_s2 = write_snapshot(
            self.sessions, "s2", [("changed claim", "changed source")], version=2)
        self.engine.mark_invalidation({
            "projectKey": self.project,
            "reason": "upstream_changed",
            "changedFields": ["evidenceVector"],
        })
        after_auto = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(after_auto["evidenceVector"],
                         [{"threadId": "s1", "digest": s1["digest"]}])
        self.assertEqual(after_auto["excludedSessions"], ["s2"])
        self.assertEqual(len(after_auto["graph"]["claims"]), 1)

        self.engine.enqueue_update({
            "projectKey": self.project,
            "evidenceVector": [
                {"threadId": "s1", "digest": s1["digest"]},
                {"threadId": "s2", "digest": changed_s2["digest"]},
            ],
            "capturedScope": {
                "includedSessions": ["s1", "s2"],
                "excludedSessions": [],
                "isolatedSessions": [],
            },
            "reason": "manual_immediate",
        })
        self.drain()
        re_included = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual({entry["threadId"] for entry in re_included["evidenceVector"]},
                         {"s1", "s2"})
        self.assertEqual(re_included["excludedSessions"], [])

    def test_goal_save_versions_and_agent_root_reframe_is_visible(self):
        updated = self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="human", actor_id="researcher",
            title="Assess pipeline rigorously")
        self.assertEqual(updated["version"], 2)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        proposal = self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="agent", actor_id="agent-1",
            title="A different research intent")
        self.assertTrue(proposal["proposal"])
        self.assertEqual(self.engine.goal_tree(self.project)[0]["title"],
                         "Assess pipeline rigorously")

    def test_goal_change_rematches_existing_claims_with_unchanged_evidence_vector(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([snapshot], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]

        child = self.engine.create_goal(
            self.project, "Focused follow-up", parent_root=self.goal["root_id"],
            actor_type="agent", actor_id="research-agent",
        )
        self.drain()
        after = self.engine.workflow.latest_snapshot(self.project)
        claim = next(item for item in after["graph"]["claims"] if item["id"] == claim_id)
        self.assertNotEqual(after["digest"], before["digest"])
        self.assertEqual(after["evidenceVector"], before["evidenceVector"])
        self.assertEqual(claim["goal_id"], child["root_id"])
        self.assertEqual(claim["needs_regoal"], 0)
        self.assertTrue(any(item["id"] == claim_id for item in after["compileDiff"]["regoaled_claims"]))

    def test_policy_change_recompiles_the_same_evidence_vector(self):
        evidence = write_snapshot(self.sessions, "policy", [("claim", "source")])
        self.enqueue([evidence], reason="manual_immediate"); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        self.assertEqual(before["policyVersion"], 1)

        policy = self.engine.configure_policy(self.project, {
            "autonomyMode": "supervised", "actorId": "researcher",
        })
        self.assertEqual(policy["policy_version"], 2)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        update = self.engine.process_updates(self.project)
        after = update["snapshot"]

        self.assertEqual(after["evidenceVector"], before["evidenceVector"])
        self.assertEqual(after["goalVersion"], before["goalVersion"])
        self.assertEqual(after["policyVersion"], 2)
        self.assertNotEqual(after["digest"], before["digest"])
        self.assertEqual(update["job"]["reason"], "policy_changed")

    def test_autonomy_modes_share_pipeline_but_only_checkpoints_block(self):
        self.engine.configure_policy(self.project, {
            "autonomyMode": "checkpointed", "checkpoints": ["claim_fragile"],
            "actorId": "researcher",
        })
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot], mode="checkpointed"); self.drain(limit=1)
        latest = self.engine.workflow.latest_snapshot(self.project)
        reviews = self.engine.workflow.reviews(self.project)
        self.assertTrue(reviews)
        self.assertEqual(reviews[0]["checkpoint"], "human")
        self.assertEqual(
            reviews[0]["payload"]["remediationCandidate"]["execution"], "record_only")
        self.assertFalse(self.engine.store.q(
            "SELECT id FROM decision_event WHERE project_key=?", (self.project,)))
        self.assertTrue(any(item["blocking"] for item in
                            self.engine.workflow.attention(self.project, latest["digest"])
                            if item["subject_type"] == "finding") is False)
        self.assertEqual(self.engine.update_status(self.project)["state"], "fresh")

    def test_autonomous_a3_decision_queues_new_snapshot_without_false_resolution(self):
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot]); first = self.engine.process_updates(self.project)
        self.assertEqual(first["job"]["status"], "succeeded")
        queued_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.assertEqual(queued_audit["status"], "queued")
        self.assertEqual(queued_audit["lane"], "P3")
        self.engine.process_audits(self.project)
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")
        decisions = self.engine.store.q("SELECT * FROM decision_event WHERE project_key=?",
                                        (self.project,))
        self.assertTrue(any(d["action"] == "request_evidence" for d in decisions))
        review = self.engine.store.q1(
            "SELECT r.* FROM review r JOIN decision_event d ON d.review_id=r.id"
            " WHERE d.project_key=? AND d.action='request_evidence'",
            (self.project,),
        )
        candidate = json.loads(review["payload"])["remediationCandidate"]
        self.assertEqual(candidate["operation"], "collect_or_reingest_evidence")
        self.assertTrue(candidate["externalAction"])
        self.assertTrue(candidate["runtimePermissionRequired"])
        self.assertEqual(candidate["execution"], "record_only")
        self.engine.process_updates(self.project)
        self.engine.process_audits(self.project)
        latest = self.engine.workflow.latest_snapshot(self.project)
        self.assertTrue(latest["graph"]["decisions"])
        output = latest["compileDiff"]["decision_outputs"][0]
        self.assertEqual(output["decisionId"], decisions[0]["id"])
        self.assertEqual(output["remediationCandidate"]["id"], candidate["id"])
        self.assertTrue(any(
            item["subject_type"] == "decision"
            for item in self.engine.workflow.attention(self.project, latest["digest"])
        ))
        self.assertTrue(any(f["status"] == "open" for f in
                            self.engine.workflow.findings(self.project)))
        self.assertIsNone(self.engine.process_updates(self.project))
        self.assertEqual(self.engine.store.q1(
            "SELECT COUNT(*) n FROM decision_event WHERE project_key=? AND action='request_evidence'",
            (self.project,))["n"], 1)

    def test_a3_action_contract_is_evidence_gated_and_never_executes_candidates(self):
        base = {
            "id": "finding:1", "finding_type": "claim_fragile",
            "subject_id": "claim:1", "target_digest": "project:1",
            "severity": "medium",
        }
        self.assertEqual(select_a3_action(base), "request_evidence")
        self.assertEqual(select_a3_action(
            {**base, "finding_type": "adversarial_methodology", "severity": "high"}),
            "challenge")
        self.assertEqual(select_a3_action(
            {**base, "finding_type": "stale_release_snapshot", "severity": "critical"}),
            "defer")
        self.assertEqual(select_a3_action(
            base, condition_cleared=True, evidence_supported=True), "resolve")
        override = {**base, "finding_type": "claim_conflicted", "severity": "critical"}
        self.assertEqual(select_a3_action(
            override, evidence_supported=False,
            allow_agent_critical_override=True), "challenge")
        self.assertEqual(select_a3_action(
            override, evidence_supported=True,
            allow_agent_critical_override=True), "override")
        candidate = remediation_candidate("request_evidence", base)
        self.assertEqual(candidate["execution"], "record_only")
        self.assertTrue(candidate["runtimePermissionRequired"])

    def test_autonomous_override_requires_assessments_and_is_carried_without_loop(self):
        self.engine.configure_policy(self.project, {
            "autonomyMode": "autonomous", "allowAgentCriticalOverride": True,
            "actorId": "researcher",
        })
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        committed = self.engine.workflow.latest_snapshot(self.project)
        self.engine.workflow._audit_l1(
            self.project, committed, self.engine.workflow.policy(self.project))
        claim_id = committed["graph"]["claims"][0]["id"]
        finding_id = self.engine.workflow._open_finding(
            self.project, committed["digest"], "claim_conflicted", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "critical",
            {"auditLevel": "L1", "reason": "test conflict"},
        )
        self.engine.store.conn.commit()
        self.engine.workflow._autonomous_review(
            self.project, committed["digest"], [finding_id], "autonomous", "L1")
        decision = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE finding_id=?", (finding_id,))
        self.assertEqual(decision["action"], "override")
        overridden = next(
            finding for finding in self.engine.workflow.findings(self.project)
            if finding["id"] == finding_id)
        self.assertEqual(overridden["status"], "overridden")
        self.assertIsNotNone(self.engine.store.q1(
            "SELECT id FROM risk_override WHERE decision_id=?", (decision["id"],)))
        self.engine.process_updates(self.project)
        newer = self.engine.workflow.latest_snapshot(self.project)
        inherited_id = self.engine.workflow._open_finding(
            self.project, newer["digest"], "claim_conflicted", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "critical",
            {"auditLevel": "L1", "reason": "same evidence conflict"},
        )
        self.engine.store.conn.commit()
        inherited = next(
            item for item in self.engine.workflow.findings(self.project)
            if item["id"] == inherited_id)
        self.assertEqual(inherited["status"], "overridden")
        self.assertEqual(inherited["details"]["inheritedDecisionId"], decision["id"])
        self.assertIsNotNone(self.engine.store.q1(
            "SELECT o.id FROM risk_override o JOIN finding f ON f.id=o.finding_id"
            " WHERE f.target_digest=? AND o.decision_id=?",
            (newer["digest"], decision["id"]),
        ))

    def test_new_evidence_can_auto_resolve_an_old_finding(self):
        first = write_snapshot(self.sessions, "s1", [("claim", "source")], version=1)
        self.enqueue([first]); self.engine.process_updates(self.project)
        before = self.engine.workflow.latest_snapshot(self.project)
        claim_id = before["graph"]["claims"][0]["id"]
        finding_id = self.engine.workflow._open_finding(
            self.project, before["digest"], "obsolete_condition", claim_id,
            self.engine.workflow.policy(self.project)["policy_version"], "medium",
            {"auditLevel": "L0"},
        )
        self.engine.store.conn.commit()
        second = write_snapshot(self.sessions, "s1", [("claim", "new source")], version=2)
        self.enqueue([second]); self.engine.process_updates(self.project)
        current = self.engine.workflow.latest_snapshot(self.project)
        self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": current["digest"], "level": "L1",
            "reason": "verify replacement evidence", "priority": 10,
        })
        self.engine.process_audits(self.project)
        resolved = next(
            item for item in self.engine.workflow.findings(self.project)
            if item["id"] == finding_id)
        self.assertEqual(resolved["status"], "auto_resolved")
        decision = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE finding_id=?", (finding_id,))
        self.assertEqual(decision["action"], "resolve")
        self.assertEqual(decision["decided_by"], "agent")

    def test_human_supersession_is_append_only_and_recompiled(self):
        snapshot = write_snapshot(self.sessions, "s1", [("fragile claim", "one source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        self.engine.process_audits(self.project)
        prior = self.engine.store.q1(
            "SELECT * FROM decision_event WHERE project_key=? ORDER BY created_at LIMIT 1",
            (self.project,))
        decision = self.engine.record_decision({
            "projectKey": self.project, "action": "supersede", "decidedBy": "human",
            "actorId": "researcher", "autonomyMode": "autonomous",
            "rationale": "new expert assessment", "alternatives": ["endorse"],
            "evidenceDigest": prior["evidence_digest"], "confidence": 0.95,
            "reversibility": "reversible", "supersedesId": prior["id"],
        })
        self.assertEqual(decision["supersedes_id"], prior["id"])
        self.assertEqual(self.engine.update_status(self.project)["state"], "pending")

    def test_compile_and_snapshot_commit_are_atomic_on_failure(self):
        first = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([first]); self.drain()
        before = self.engine.workflow.latest_snapshot(self.project)
        before_claims = self.engine.store.q("SELECT id FROM claim WHERE project_key=?",
                                            (self.project,))
        second = write_snapshot(self.sessions, "s1", [
            ("claim one", "source one"), ("claim two", "source two")], version=2)
        self.enqueue([second])
        with patch.object(self.engine.workflow, "_commit_project_snapshot",
                          side_effect=RuntimeError("injected snapshot failure")):
            with self.assertRaises(RuntimeError):
                self.engine.process_updates(self.project)
        after = self.engine.workflow.latest_snapshot(self.project)
        after_claims = self.engine.store.q("SELECT id FROM claim WHERE project_key=?",
                                           (self.project,))
        self.assertEqual(after["digest"], before["digest"])
        self.assertEqual(after_claims, before_claims)
        failed = self.engine.store.q1(
            "SELECT * FROM project_update_job"
            " WHERE project_key=? AND status='retry_scheduled'",
            (self.project,))
        self.assertIsNotNone(failed["next_attempt_at"])
        retry_status = self.engine.update_status(self.project)
        self.assertEqual(retry_status["state"], "retry_scheduled")
        self.assertEqual(retry_status["pending"], 1)
        with patch("project_dag.workflow.now_iso", return_value=failed["updated_at"]):
            self.assertIsNone(self.engine.process_updates(self.project))
        retried = self.engine.retry_update(failed["id"], actor="researcher")
        self.assertEqual(retried["status"], "queued")
        self.assertIsNone(retried["next_attempt_at"])

    def test_project_snapshot_reads_reject_payload_and_row_tampering(self):
        snapshot = write_snapshot(self.sessions, "integrity", [("claim", "source")])
        self.enqueue([snapshot]); self.drain()
        committed = self.engine.workflow.latest_snapshot(self.project)
        row = self.engine.store.q1(
            "SELECT * FROM project_snapshot WHERE digest=?", (committed["digest"],))

        tampered = json.loads(row["payload"])
        tampered["graph"]["claims"][0]["statement"] = "TAMPERED PROJECT CLAIM"
        self.engine.store.x(
            "UPDATE project_snapshot SET payload=? WHERE digest=?",
            (json.dumps(tampered), row["digest"]),
        )
        self.engine.store.conn.commit()
        with self.assertRaisesRegex(ValueError, "Project Snapshot digest mismatch"):
            self.engine.workflow.latest_snapshot(self.project)

        self.engine.store.x(
            "UPDATE project_snapshot SET payload=?,evidence_vector=? WHERE digest=?",
            (row["payload"], "[]", row["digest"]),
        )
        self.engine.store.conn.commit()
        with self.assertRaisesRegex(ValueError, "evidenceVector.*database row"):
            self.engine.graph(self.project)

        rebound = json.loads(row["payload"])
        rebound["version"] = int(rebound["version"]) + 1
        rebound.pop("digest", None)
        rebound_digest = digest_json(rebound, "project")
        rebound["digest"] = rebound_digest
        self.engine.store.x(
            "UPDATE project_snapshot SET digest=?,payload=?,evidence_vector=?"
            " WHERE project_key=? AND version=?",
            (rebound_digest, json.dumps(rebound), row["evidence_vector"],
             row["project_key"], row["version"]),
        )
        self.engine.store.conn.commit()
        with self.assertRaisesRegex(ValueError, "version.*database row"):
            self.engine.workflow.snapshot(rebound_digest)

    def test_active_update_receipt_is_idempotent_and_does_not_advance_generation(self):
        snapshot = write_snapshot(self.sessions, "receipt", [("claim", "source")])
        first = self.enqueue([snapshot])
        before_count = self.engine.store.q1(
            "SELECT COUNT(*) n FROM project_update_receipt WHERE job_id=?",
            (first["jobId"],),
        )["n"]
        for job_state, receipt_state in (
            ("queued", "queued"),
            ("running", "running"),
            ("retry_scheduled", "queued"),
        ):
            self.engine.store.x(
                "UPDATE project_update_job SET status=?,attempts=?,"
                "processing_version=?,next_attempt_at=? WHERE id=?",
                (
                    job_state,
                    1 if job_state != "queued" else 0,
                    first["acceptedRequestVersion"] if job_state == "running" else None,
                    "2099-01-01T00:00:00Z"
                    if job_state == "retry_scheduled" else None,
                    first["jobId"],
                ),
            )
            self.engine.store.x(
                "UPDATE project_update_receipt SET state=?"
                " WHERE job_id=? AND request_version=?",
                (receipt_state, first["jobId"], first["acceptedRequestVersion"]),
            )
            self.engine.store.conn.commit()

            duplicate = self.enqueue([snapshot])
            self.assertEqual(duplicate["jobId"], first["jobId"])
            self.assertEqual(
                duplicate["acceptedRequestVersion"], first["acceptedRequestVersion"])
            self.assertEqual(
                duplicate["desiredFingerprint"], first["desiredFingerprint"])
            self.assertEqual(self.engine.store.q1(
                "SELECT request_version FROM project_update_job WHERE id=?",
                (first["jobId"],),
            )["request_version"], first["acceptedRequestVersion"])
            self.assertEqual(self.engine.store.q1(
                "SELECT COUNT(*) n FROM project_update_receipt WHERE job_id=?",
                (first["jobId"],),
            )["n"], before_count)

    def test_terminal_failed_duplicate_creates_a_new_generation_and_commits(self):
        snapshot = write_snapshot(
            self.sessions, "terminal-reenqueue", [("claim", "source")])
        first = self.enqueue([snapshot])
        with patch("project_dag.workflow.UPDATE_MAX_ATTEMPTS", 1), \
                patch.object(self.engine.workflow, "_commit_project_snapshot",
                             side_effect=RuntimeError("terminal failure")):
            with self.assertRaisesRegex(RuntimeError, "terminal failure"):
                self.engine.process_updates(self.project)

        failed_receipt_before = self.engine.store.q1(
            "SELECT * FROM project_update_receipt"
            " WHERE job_id=? AND request_version=?",
            (first["jobId"], first["acceptedRequestVersion"]),
        )
        second = self.enqueue([snapshot])
        failed_receipt_after_enqueue = self.engine.store.q1(
            "SELECT * FROM project_update_receipt"
            " WHERE job_id=? AND request_version=?",
            (first["jobId"], first["acceptedRequestVersion"]),
        )
        lane = self.engine.workflow.job(first["jobId"])

        self.assertEqual(second["jobId"], first["jobId"])
        self.assertEqual(
            second["acceptedRequestVersion"],
            first["acceptedRequestVersion"] + 1)
        self.assertEqual(second["desiredFingerprint"], first["desiredFingerprint"])
        self.assertEqual(second["state"], "queued")
        self.assertEqual(failed_receipt_after_enqueue, failed_receipt_before)
        self.assertEqual(lane["status"], "queued")
        self.assertEqual(lane["attempts"], 0)
        self.assertIsNone(lane["last_error"])
        self.assertIsNone(lane["next_attempt_at"])

        result = self.engine.process_updates(self.project)
        self.assertIsNotNone(result)
        committed = self.engine.update_receipt_status(
            second["jobId"], second["acceptedRequestVersion"],
            second["desiredFingerprint"])
        failed_receipt_after_commit = self.engine.store.q1(
            "SELECT * FROM project_update_receipt"
            " WHERE job_id=? AND request_version=?",
            (first["jobId"], first["acceptedRequestVersion"]),
        )
        self.assertEqual(committed["state"], "committed")
        self.assertEqual(failed_receipt_after_commit, failed_receipt_before)
        self.assertEqual(self.engine.update_status(self.project)["state"], "fresh")

    def test_status_ignores_historical_failed_job_after_newer_job_commits(self):
        first_snapshot = write_snapshot(
            self.sessions, "status-history", [("claim", "source v1")], version=1)
        first = self.enqueue([first_snapshot])
        with patch("project_dag.workflow.UPDATE_MAX_ATTEMPTS", 1), \
                patch.object(self.engine.workflow, "_commit_project_snapshot",
                             side_effect=RuntimeError("historical failure")):
            with self.assertRaisesRegex(RuntimeError, "historical failure"):
                self.engine.process_updates(self.project)
        terminal_before = self.engine.store.q1(
            "SELECT status,attempts,last_error,updated_at,finished_at"
            " FROM project_update_job WHERE id=?",
            (first["jobId"],),
        )

        # Recreate a valid multi-job history from an older installation: the
        # failed lane remained terminal while a later lane committed.
        self.engine.store.x(
            "UPDATE project_update_job SET status='succeeded' WHERE id=?",
            (first["jobId"],),
        )
        self.engine.store.conn.commit()
        second_snapshot = write_snapshot(
            self.sessions, "status-history", [("claim", "source v2")], version=2)
        second = self.enqueue([second_snapshot])
        self.assertNotEqual(second["jobId"], first["jobId"])
        self.assertIsNotNone(self.engine.process_updates(self.project))
        self.engine.store.x(
            "UPDATE project_update_job SET status=?,attempts=?,last_error=?,"
            "updated_at=?,finished_at=? WHERE id=?",
            (
                terminal_before["status"],
                terminal_before["attempts"],
                terminal_before["last_error"],
                terminal_before["updated_at"],
                terminal_before["finished_at"],
                first["jobId"],
            ),
        )
        self.engine.store.conn.commit()

        status = self.engine.update_status(self.project)
        terminal_after = self.engine.store.q1(
            "SELECT status,attempts,last_error,updated_at,finished_at"
            " FROM project_update_job WHERE id=?",
            (first["jobId"],),
        )
        self.assertEqual(status["state"], "fresh")
        self.assertEqual(status["pending"], 0)
        self.assertIsNone(status["activeReceipt"])
        self.assertEqual(status["latestReceipt"]["jobId"], second["jobId"])
        self.assertEqual(status["latestReceipt"]["state"], "committed")
        self.assertIn(
            first["jobId"],
            {job["id"] for job in status["jobs"] if job["status"] == "failed"},
        )
        self.assertEqual(terminal_after, terminal_before)

    def test_newer_evidence_generation_covers_superseded_receipt_and_rejects_rollback(self):
        first_snapshot = write_snapshot(
            self.sessions, "receipt", [("claim", "source v1")], version=1)
        first = self.enqueue([first_snapshot])
        second_snapshot = write_snapshot(
            self.sessions, "receipt", [("claim", "source v2")], version=2)
        second = self.enqueue([second_snapshot])

        self.assertEqual(second["jobId"], first["jobId"])
        self.assertEqual(
            second["acceptedRequestVersion"],
            first["acceptedRequestVersion"] + 1)
        superseded = self.engine.update_receipt_status(
            first["jobId"], first["acceptedRequestVersion"],
            first["desiredFingerprint"])
        self.assertEqual(superseded["state"], "superseded")

        result = self.engine.process_updates(self.project)
        covered = self.engine.update_receipt_status(
            first["jobId"], first["acceptedRequestVersion"],
            first["desiredFingerprint"])
        committed = self.engine.update_receipt_status(
            second["jobId"], second["acceptedRequestVersion"],
            second["desiredFingerprint"])
        self.assertEqual(covered["state"], "covered")
        self.assertEqual(
            covered["committedSnapshotDigest"], result["snapshot"]["digest"])
        self.assertEqual(committed["state"], "committed")
        self.assertEqual(
            committed["committedSnapshotDigest"], result["snapshot"]["digest"])
        with self.assertRaisesRegex(ValueError, "would roll back accepted version 2"):
            self.enqueue([first_snapshot])

    def test_failed_running_generation_does_not_fail_newer_queued_receipt(self):
        first_snapshot = write_snapshot(
            self.sessions, "coalesced-failure", [("claim", "source v1")], version=1)
        first = self.enqueue([first_snapshot])
        second_snapshot = write_snapshot(
            self.sessions, "coalesced-failure", [("claim", "source v2")], version=2)
        accepted = {}

        def enqueue_newer(*args, **kwargs):
            accepted["receipt"] = self.enqueue([second_snapshot])

        with patch.object(
                self.engine._compiler, "_prepare_judgements",
                side_effect=enqueue_newer), patch.object(
                    self.engine.workflow, "_commit_project_snapshot",
                    side_effect=RuntimeError("old generation failed")):
            with self.assertRaisesRegex(RuntimeError, "old generation failed"):
                self.engine.process_updates(self.project)

        old_status = self.engine.update_receipt_status(
            first["jobId"], first["acceptedRequestVersion"],
            first["desiredFingerprint"])
        newer = accepted["receipt"]
        new_status = self.engine.update_receipt_status(
            newer["jobId"], newer["acceptedRequestVersion"],
            newer["desiredFingerprint"])
        lane = self.engine.workflow.job(first["jobId"])
        self.assertEqual(old_status["state"], "failed")
        self.assertEqual(old_status["lastError"], "old generation failed")
        self.assertEqual(new_status["state"], "queued")
        self.assertEqual(lane["status"], "queued")
        self.assertIsNone(lane["last_error"])
        self.assertEqual(
            self.engine.process_updates(self.project)["snapshot"]["evidenceVector"],
            [{"threadId": "coalesced-failure", "digest": second_snapshot["digest"]}],
        )

    def test_project_update_becomes_terminal_failed_after_retry_limit(self):
        snapshot = write_snapshot(self.sessions, "terminal", [("claim", "source")])
        receipt = self.enqueue([snapshot])
        with patch("project_dag.workflow.UPDATE_MAX_ATTEMPTS", 1), \
                patch.object(self.engine.workflow, "_commit_project_snapshot",
                             side_effect=RuntimeError("terminal failure")):
            with self.assertRaises(RuntimeError):
                self.engine.process_updates(self.project)
        failed = self.engine.store.q1(
            "SELECT * FROM project_update_job WHERE project_key=?", (self.project,))
        self.assertEqual(failed["status"], "failed")
        self.assertIsNone(failed["next_attempt_at"])
        status = self.engine.update_status(self.project)
        self.assertEqual(status["state"], "update_failed")
        self.assertEqual(status["pending"], 0)
        failed_receipt = self.engine.update_receipt_status(
            receipt["jobId"], receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"])
        self.assertEqual(failed_receipt["state"], "failed")
        self.assertEqual(failed_receipt["lastError"], "terminal failure")

    def test_invalid_judgement_is_terminal_after_one_generation_attempt(self):
        class InvalidJudgementLlm:
            def __init__(self):
                self.calls = 0

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                del messages, temperature, max_tokens
                self.calls += 1
                return '{"statement":"truncated"'

        llm = InvalidJudgementLlm()
        judge = Judge(llm, self.engine.store)
        self.engine.judge = judge
        self.engine.workflow.compiler.judge = judge
        snapshot = write_snapshot(
            self.sessions, "invalid-judgement", [("claim", "source")])
        receipt = self.enqueue([snapshot])

        with self.assertRaises(ProjectJudgementError):
            self.engine.process_updates(self.project)

        failed = self.engine.workflow.job(receipt["jobId"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["attempts"], 1)
        self.assertIsNone(failed["next_attempt_at"])
        self.assertEqual(llm.calls, 2)
        self.assertIsNone(self.engine.process_updates(self.project))
        self.assertEqual(llm.calls, 2)

    def test_retryable_model_error_preserves_the_existing_retry_schedule(self):
        class TransientLlm:
            def __init__(self):
                self.calls = 0

            def chat(self, messages, *, temperature=0.0, max_tokens=2048):
                del messages, temperature, max_tokens
                self.calls += 1
                raise LLMCallError(
                    "upstream_timeout",
                    "Upstream request timed out.",
                    attempts=1,
                    retryable=True,
                )

        llm = TransientLlm()
        judge = Judge(llm, self.engine.store)
        self.engine.judge = judge
        self.engine.workflow.compiler.judge = judge
        snapshot = write_snapshot(
            self.sessions, "retryable-judgement", [("claim", "source")])
        receipt = self.enqueue([snapshot])

        with self.assertRaises(LLMCallError):
            self.engine.process_updates(self.project)

        retrying = self.engine.workflow.job(receipt["jobId"])
        self.assertEqual(retrying["status"], "retry_scheduled")
        self.assertEqual(retrying["attempts"], 1)
        self.assertIsNotNone(retrying["next_attempt_at"])
        self.assertEqual(llm.calls, 1)

    def test_queries_never_expose_inflight_graph_before_snapshot_commit(self):
        first = write_snapshot(self.sessions, "s1", [("claim one", "source one")])
        self.enqueue([first]); self.drain()
        self.assertEqual(len(self.engine.claims(self.project)), 1)
        second = write_snapshot(self.sessions, "s1", [
            ("claim one", "source one"), ("claim two", "source two")], version=2)
        self.enqueue([second])
        entered, release = threading.Event(), threading.Event()
        original = self.engine.workflow._commit_project_snapshot

        def paused(*args, **kwargs):
            entered.set(); release.wait(2); return original(*args, **kwargs)

        errors = []
        with patch.object(self.engine.workflow, "_commit_project_snapshot", side_effect=paused):
            worker = threading.Thread(
                target=lambda: self._capture_error(errors, self.engine.process_updates, self.project))
            worker.start(); self.assertTrue(entered.wait(2))
            self.assertEqual(len(self.engine.claims(self.project)), 1)
            release.set(); worker.join(2)
        self.assertFalse(errors)
        self.assertEqual(len(self.engine.claims(self.project)), 2)

    def test_different_projects_prepare_models_concurrently_before_serial_commit(self):
        other_project = "path:/workspace/b"
        self.engine.create_goal(other_project, "Assess the other pipeline")
        first = write_snapshot(self.sessions, "parallel-a", [("claim a", "source a")])
        second = write_snapshot(self.sessions, "parallel-b", [("claim b", "source b")])
        self.enqueue([first], project=self.project)
        self.enqueue([second], project=other_project)

        barrier = threading.Barrier(2, timeout=2)
        transaction_states: list[bool] = []
        judge = self.engine.workflow.compiler.judge
        original_distill = judge.handlers["distill"]

        def concurrent_distill(payload):
            transaction_states.append(self.engine.store.conn.in_transaction)
            barrier.wait()
            return original_distill(payload)

        judge.handlers["distill"] = concurrent_distill
        errors: list[Exception] = []
        workers = [
            threading.Thread(
                target=self._capture_error,
                args=(errors, self.engine.process_updates, project),
            )
            for project in (self.project, other_project)
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(4)

        self.assertFalse(errors)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(transaction_states, [False, False])
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(self.project))
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(other_project))

    def test_dynamic_model_cache_misses_restart_outside_sqlite_transaction(self):
        engine = self.engine

        class TransactionCheckingLlm:
            def __init__(self):
                self.transaction_states: list[bool] = []

            def chat(self, messages, temperature=0.0):
                del temperature
                self.transaction_states.append(engine.store.conn.in_transaction)
                task = messages[0]["content"].splitlines()[0].split(":", 1)[1].strip()
                payload = json.loads(messages[1]["content"].split("\n(vote ", 1)[0])
                if task == "distill":
                    return json.dumps({
                        "statement": payload["claim"], "claim_type": "finding",
                        "mentioned_entities": [],
                        "addresses_goal": payload["active_goals"][0]["id"],
                        "source_node_ids": [
                            node["id"] for node in payload["subgraph"]["nodes"]
                        ],
                        "confidence": 0.9,
                    })
                if task == "claim_equiv":
                    return json.dumps({
                        "relation": "new", "target": None, "confidence": 0.9,
                    })
                if task == "contradiction":
                    return json.dumps({"contradicts": False, "confidence": 0.9})
                raise AssertionError(task)

        llm = TransactionCheckingLlm()
        judge = Judge(llm, engine.store)
        engine.judge = judge
        engine.workflow.compiler.judge = judge
        snapshot = write_snapshot(self.sessions, "dynamic-prepare", [
            ("first prepared claim", "first source"),
            ("second prepared claim", "second source"),
        ])
        self.enqueue([snapshot])

        result = engine.process_updates(self.project)

        self.assertIsNotNone(result)
        self.assertEqual(len(result["snapshot"]["graph"]["claims"]), 2)
        self.assertGreaterEqual(len(llm.transaction_states), 4)
        self.assertTrue(all(not state for state in llm.transaction_states))

    def test_same_project_compile_lock_is_scoped_by_project_key(self):
        compiler = self.engine.workflow.compiler
        held = compiler._project_lock(self.project)
        held.acquire()
        try:
            with compiler.compile_transaction(
                    "scheduled", [], project_key=self.project,
                    evidence_vector=[]) as same_project:
                self.assertTrue(same_project["skipped"])
                self.assertIn("for project", same_project["reason"])
            other_project = "path:/workspace/lock-b"
            with compiler.compile_transaction(
                    "scheduled", [], project_key=other_project,
                    evidence_vector=[]) as other:
                self.assertFalse(other.get("skipped", False))
                self.engine.store.conn.rollback()
        finally:
            held.release()

    def test_audit_sidechain_is_persistent_and_failure_does_not_fail_project_job(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot])
        with patch.object(self.engine.workflow, "_execute_audit") as execute:
            result = self.engine.process_updates(self.project)
            execute.assert_not_called()
        self.assertEqual(result["job"]["status"], "succeeded")
        self.assertIsNotNone(self.engine.workflow.latest_snapshot(self.project))
        queued = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["target_digest"], result["snapshot"]["digest"])
        with patch.object(self.engine.workflow, "_audit_l0",
                          side_effect=RuntimeError("audit offline")):
            with self.assertRaises(RuntimeError):
                self.engine.process_audits(self.project)
        failed = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=? AND status='failed'",
            (self.project,))
        self.assertIn("audit offline", failed["error"])
        self.assertIsNotNone(failed["next_attempt_at"])
        retried = self.engine.retry_audit(failed["id"], actor="researcher")
        self.assertEqual(retried["status"], "queued")
        self.assertIsNone(retried["next_attempt_at"])
        completed = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(completed["status"], "completed")

    def test_restart_recovers_running_audit_without_losing_digest_or_attempts(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE project_key=?", (self.project,))
        self.engine.store.x(
            "UPDATE audit_run SET status='running',attempts=2,started_at=? WHERE id=?",
            ("2026-07-10T00:00:00Z", audit["id"]),
        )
        self.engine.store.conn.commit()
        db_path = self.engine.store.db_path
        self.engine.store.close()
        self.engine = Engine(db_path, self.sessions, judge=make_judge())
        recovered = self.engine.workflow.audit(audit["id"])
        self.assertEqual(recovered["status"], "queued")
        self.assertEqual(recovered["target_digest"], audit["target_digest"])
        self.assertEqual(recovered["attempts"], 2)
        self.assertIsNotNone(self.engine.process_audits(self.project))

    def test_restart_requeues_running_compile_with_same_desired_vector(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        queued = self.enqueue([snapshot])
        self.engine.store.x(
            "UPDATE project_update_job SET status='running',attempts=3,processing_version=?"
            " WHERE id=?",
            (queued["acceptedRequestVersion"], queued["jobId"]),
        )
        self.engine.store.x(
            "UPDATE project_update_receipt SET state='running'"
            " WHERE job_id=? AND request_version=?",
            (queued["jobId"], queued["acceptedRequestVersion"]),
        )
        self.engine.store.conn.commit()
        db_path = self.engine.store.db_path
        self.engine.store.close()
        self.engine = Engine(db_path, self.sessions, judge=make_judge())
        recovered = self.engine.workflow.job(queued["jobId"])
        self.assertEqual(recovered["status"], "queued")
        self.assertEqual(recovered["desiredEvidenceVector"], [
            {"threadId": "s1", "digest": snapshot["digest"]},
        ])
        completed = self.engine.process_updates(self.project)
        self.assertEqual(completed["job"]["status"], "succeeded")

    def test_restart_finalizes_job_when_receipt_was_atomically_committed(self):
        snapshot = write_snapshot(self.sessions, "crash-window", [("claim", "source")])
        receipt = self.enqueue([snapshot])
        original = self.engine.workflow._commit_project_snapshot

        def interrupt_after_commit(*args, **kwargs):
            original(*args, **kwargs)
            raise KeyboardInterrupt("simulated process exit after snapshot commit")

        with patch.object(
                self.engine.workflow, "_commit_project_snapshot",
                side_effect=interrupt_after_commit):
            with self.assertRaises(KeyboardInterrupt):
                self.engine.process_updates(self.project)
        self.assertEqual(self.engine.store.q1(
            "SELECT status FROM project_update_job WHERE id=?",
            (receipt["jobId"],),
        )["status"], "running")
        self.assertEqual(self.engine.update_receipt_status(
            receipt["jobId"], receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"],
        )["state"], "committed")

        db_path = self.engine.store.db_path
        self.engine.store.close()
        self.engine = Engine(db_path, self.sessions, judge=make_judge())
        self.assertEqual(
            self.engine.workflow.job(receipt["jobId"])["status"], "succeeded")
        self.assertIsNone(self.engine.process_updates(self.project))
        self.assertEqual(self.engine.store.q1(
            "SELECT COUNT(*) n FROM project_snapshot WHERE project_key=?",
            (self.project,),
        )["n"], 1)

    def test_audit_enqueue_is_idempotent_for_digest_level_and_policy(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); result = self.engine.process_updates(self.project)
        first = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": result["snapshot"]["digest"],
            "level": "L1", "reason": "manual", "priority": 1,
        })
        duplicate = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": result["snapshot"]["digest"],
            "level": "L1", "reason": "release_gate", "priority": 10,
        })
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual(duplicate["priority"], 10)
        self.assertEqual(self.engine.store.q1(
            "SELECT COUNT(*) n FROM audit_run WHERE request_key=?",
            (first["request_key"],),
        )["n"], 1)

    def test_p3_audit_waits_while_p2_compile_is_eligible(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.engine.process_updates(self.project)
        queued_audit = self.engine.store.q1(
            "SELECT id FROM audit_run WHERE project_key=? AND status='queued'", (self.project,))
        self.engine.update_goal(
            self.project, self.goal["root_id"], actor_type="human", actor_id="researcher",
            description="updated goal context",
        )
        self.assertIsNone(self.engine.process_audits(self.project))
        self.assertEqual(self.engine.workflow.audit(queued_audit["id"])["status"], "queued")
        self.assertIsNotNone(self.engine.process_updates(self.project))

    def test_non_versioned_database_is_rejected_without_compatibility_path(self):
        db_path = os.path.join(self.tmp.name, "legacy-graph.db")
        connection = sqlite3.connect(db_path)
        connection.executescript("""
        CREATE TABLE goal (
          id TEXT PRIMARY KEY, root_id TEXT NOT NULL, title TEXT NOT NULL,
          version INTEGER NOT NULL, t_created TEXT NOT NULL
        );
        """)
        connection.commit(); connection.close()

        with self.assertRaisesRegex(RuntimeError, "requires a clean project-view database"):
            Store(db_path)

    def test_v2_to_v3_migration_is_atomic_and_preserves_graph_history(self):
        db_path = os.path.join(self.tmp.name, "v2-project.db")
        current = Store(db_path)
        current.x(
            "INSERT INTO claim"
            " (id,project_key,statement,claim_type,status,confidence,goal_id,t_valid,"
            "t_invalid,t_created,load_bearing,blast_radius,needs_regoal)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("claim:v2", self.project, "Preserved v2 claim", "finding", "invalidated",
             0.77, None, "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z",
             "2026-07-01T00:00:00Z", 0.4, 2, 0),
        )
        current.x(
            "INSERT INTO evidence"
            " (id,project_key,thread_id,snapshot_digest,node_id,node_type)"
            " VALUES (?,?,?,?,?,?)",
            ("evidence:v2", self.project, "thread:v2", _sha("snapshot-v2"),
             "source:v2", "source_assertion"),
        )
        current.x(
            "INSERT INTO edge (id,src,dst,edge_type,t_valid,t_invalid,meta)"
            " VALUES (?,?,?,?,?,?,?)",
            ("edge:v2", "evidence:v2", "claim:v2", "supports",
             "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z",
             '{"session":"thread:v2","claim_node":"source:v2"}'),
        )
        legacy_evidence_digest = _sha("snapshot-v2")
        legacy_payload = {
            "projectKey": self.project, "version": 1,
            "goalVersion": "goal:v2",
            "policyVersion": 1,
            "evidenceVector": [{
                "threadId": "thread:v2", "digest": legacy_evidence_digest,
            }],
            "excludedSessions": [], "isolatedSessions": [],
            "compilerVersion": "project-compiler.v2",
            "createdAt": "2026-07-03T00:00:00Z", "status": "committed",
            "autonomyMode": "checkpointed",
            "graph": {
                "goals": [], "claims": [{
                    "id": "claim:v2", "project_key": self.project,
                    "statement": "Preserved v2 claim", "claim_type": "finding",
                    "status": "invalidated",
                }],
                # Historical v2 payloads intentionally have no node_type.
                "evidence": [{
                    "id": "evidence:v2", "project_key": self.project,
                    "thread_id": "thread:v2", "snapshot_digest": legacy_evidence_digest,
                    "node_id": "source:v2",
                }],
                "entities": [], "edges": [], "origins": [], "decisions": [],
            },
            "assessments": [],
        }
        legacy_snapshot_digest = digest_json(legacy_payload, "project")
        legacy_payload["digest"] = legacy_snapshot_digest
        current.x(
            "INSERT INTO project_snapshot"
            " (project_key,version,digest,goal_version,policy_version,evidence_vector,"
            "excluded_sessions,isolated_sessions,compiler_version,created_at,status,payload)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (self.project, 1, legacy_snapshot_digest, "goal:v2", 1,
             json.dumps(legacy_payload["evidenceVector"]), "[]", "[]",
             "project-compiler.v2", "2026-07-03T00:00:00Z",
             json.dumps(legacy_payload)),
        )
        current.conn.commit()
        current.close()

        connection = sqlite3.connect(db_path)
        connection.executescript("""
        ALTER TABLE claim RENAME TO claim_v3;
        CREATE TABLE claim (
          id TEXT PRIMARY KEY, project_key TEXT NOT NULL, statement TEXT NOT NULL,
          claim_type TEXT CHECK(claim_type IN
            ('hypothesis','finding','method_result','negative_result','decision')),
          status TEXT NOT NULL CHECK(status IN
            ('supported','conflicted','invalidated','fragile','undetermined')),
          confidence REAL, goal_id TEXT, t_valid TEXT NOT NULL, t_invalid TEXT,
          t_created TEXT NOT NULL, load_bearing REAL NOT NULL DEFAULT 0,
          blast_radius INTEGER NOT NULL DEFAULT 0, needs_regoal INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO claim SELECT * FROM claim_v3;
        DROP TABLE claim_v3;

        DROP INDEX idx_evidence_ref;
        ALTER TABLE evidence RENAME TO evidence_v3;
        CREATE TABLE evidence (
          id TEXT PRIMARY KEY, project_key TEXT NOT NULL, thread_id TEXT NOT NULL,
          snapshot_digest TEXT NOT NULL, node_id TEXT NOT NULL,
          UNIQUE(project_key,thread_id,snapshot_digest,node_id)
        );
        INSERT INTO evidence (id,project_key,thread_id,snapshot_digest,node_id)
          SELECT id,project_key,thread_id,snapshot_digest,node_id FROM evidence_v3;
        DROP TABLE evidence_v3;
        CREATE INDEX idx_evidence_ref
          ON evidence(project_key,thread_id,snapshot_digest,node_id);

        DROP INDEX idx_edge_src;
        DROP INDEX idx_edge_dst;
        ALTER TABLE edge RENAME TO edge_v3;
        CREATE TABLE edge (
          id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL,
          edge_type TEXT NOT NULL CHECK(edge_type IN
            ('decomposes_to','addresses','supports','contradicts','derived_from',
             'same_as','mentions')),
          t_valid TEXT NOT NULL, t_invalid TEXT, meta TEXT
        );
        INSERT INTO edge SELECT * FROM edge_v3;
        DROP TABLE edge_v3;
        CREATE INDEX idx_edge_src ON edge(src, edge_type);
        CREATE INDEX idx_edge_dst ON edge(dst, edge_type);

        DROP TABLE project_schema;
        CREATE TABLE project_schema (version INTEGER PRIMARY KEY CHECK(version=2));
        INSERT INTO project_schema(version) VALUES (2);
        CREATE TABLE edge_v2 (sentinel TEXT);
        """)
        connection.commit()

        with self.assertRaises(sqlite3.OperationalError):
            _upgrade_v2_to_v3(connection)
        self.assertEqual(
            connection.execute("SELECT version FROM project_schema").fetchone()[0], 2,
        )
        self.assertNotIn(
            "node_type", {row[1] for row in connection.execute("PRAGMA table_info(evidence)")},
        )
        self.assertEqual(
            connection.execute("SELECT statement FROM claim WHERE id='claim:v2'").fetchone()[0],
            "Preserved v2 claim",
        )
        self.assertEqual(
            connection.execute("SELECT node_id FROM evidence WHERE id='evidence:v2'").fetchone()[0],
            "source:v2",
        )
        self.assertEqual(
            connection.execute("SELECT t_invalid FROM edge WHERE id='edge:v2'").fetchone()[0],
            "2026-07-03T00:00:00Z",
        )

        connection.execute("DROP TABLE edge_v2")
        connection.commit()
        _upgrade_v2_to_v3(connection)
        self.assertEqual(
            connection.execute("SELECT version FROM project_schema").fetchone()[0], 3,
        )
        claim_row = connection.execute(
            "SELECT statement,t_valid,t_invalid FROM claim WHERE id='claim:v2'",
        ).fetchone()
        self.assertEqual(claim_row, (
            "Preserved v2 claim", "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z",
        ))
        evidence_row = connection.execute(
            "SELECT thread_id,snapshot_digest,node_id,node_type"
            " FROM evidence WHERE id='evidence:v2'",
        ).fetchone()
        self.assertEqual(evidence_row, (
            "thread:v2", _sha("snapshot-v2"), "source:v2", "source_assertion",
        ))
        edge_row = connection.execute(
            "SELECT src,dst,edge_type,t_valid,t_invalid,meta FROM edge WHERE id='edge:v2'",
        ).fetchone()
        self.assertEqual(edge_row, (
            "evidence:v2", "claim:v2", "supports", "2026-07-01T00:00:00Z",
            "2026-07-03T00:00:00Z",
            '{"session":"thread:v2","claim_node":"source:v2"}',
        ))
        self.assertIn("idx_evidence_ref", {
            row[1] for row in connection.execute("PRAGMA index_list(evidence)")
        })
        self.assertTrue({"idx_edge_src", "idx_edge_dst"}.issubset({
            row[1] for row in connection.execute("PRAGMA index_list(edge)")
        }))
        connection.close()

        reopened = Engine(db_path, self.sessions, judge=make_judge())
        legacy_graph = reopened.graph(self.project)
        self.assertEqual(legacy_graph["snapshot"]["digest"], legacy_snapshot_digest)
        self.assertEqual(legacy_graph["evidence"][0]["node_id"], "source:v2")
        self.assertNotIn("node_type", legacy_graph["evidence"][0])
        reopened.store.close()

    def test_v1_database_is_transactionally_upgraded_without_losing_user_data(self):
        db_path = os.path.join(self.tmp.name, "v1-project.db")
        v2 = Store(db_path)
        goal = v2.create_goal(
            "Preserve this goal", project_key=self.project)
        timestamp = "2026-07-26T00:00:00Z"
        v2.x(
            "INSERT INTO project_policy"
            " (project_key,autonomy_mode,updated_at)"
            " VALUES (?,'checkpointed',?)",
            (self.project, timestamp),
        )
        v2.x(
            "INSERT INTO project_update_job"
            " (id,project_key,desired_vector,captured_scope,reason,priority,autonomy_mode,"
            "desired_fingerprint,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?,? ,?,?)",
            ("pjob_legacy", self.project, "[]",
             '{"excludedSessions":[],"includedSessions":[],"isolatedSessions":[]}',
             "goal_changed", 10, "checkpointed", "legacy", timestamp, timestamp),
        )
        v2.conn.commit()
        v2.close()

        connection = sqlite3.connect(db_path)
        connection.executescript("""
        DROP TABLE project_update_receipt;
        DROP INDEX idx_project_job_open;
        ALTER TABLE project_update_job RENAME TO project_update_job_v2;
        CREATE TABLE project_update_job (
          id TEXT PRIMARY KEY, project_key TEXT NOT NULL, desired_vector TEXT NOT NULL,
          captured_scope TEXT NOT NULL, reason TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0, autonomy_mode TEXT NOT NULL,
          request_version INTEGER NOT NULL DEFAULT 1, processing_version INTEGER,
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK(status IN ('queued','running','retry_scheduled','succeeded','failed')),
          attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          started_at TEXT, finished_at TEXT
        );
        INSERT INTO project_update_job
          (id,project_key,desired_vector,captured_scope,reason,priority,autonomy_mode,
           request_version,processing_version,status,attempts,last_error,next_attempt_at,
           created_at,updated_at,started_at,finished_at)
        SELECT id,project_key,desired_vector,captured_scope,reason,priority,autonomy_mode,
               request_version,processing_version,status,attempts,last_error,next_attempt_at,
               created_at,updated_at,started_at,finished_at
        FROM project_update_job_v2;
        DROP TABLE project_update_job_v2;
        CREATE UNIQUE INDEX idx_project_job_open ON project_update_job(project_key)
          WHERE status IN ('queued','running','retry_scheduled','failed');
        DROP TABLE project_schema;
        CREATE TABLE project_schema (version INTEGER PRIMARY KEY CHECK(version=1));
        INSERT INTO project_schema(version) VALUES (1);
        """)
        connection.commit()
        connection.close()

        upgraded = Store(db_path)
        self.assertEqual(
            upgraded.q1("SELECT version FROM project_schema")["version"], 3)
        self.assertEqual(
            upgraded.q1("SELECT title FROM goal WHERE id=?", (goal["id"],))["title"],
            "Preserve this goal")
        migrated_job = upgraded.q1(
            "SELECT * FROM project_update_job WHERE id='pjob_legacy'")
        self.assertTrue(migrated_job["desired_fingerprint"].startswith(
            "project-update-desired:"))
        self.assertEqual(upgraded.q1(
            "SELECT state FROM project_update_receipt WHERE job_id='pjob_legacy'",
        )["state"], "queued")
        upgraded.close()
        recovered = Engine(db_path, self.sessions, judge=make_judge())
        migrated_context = json.loads(recovered.store.q1(
            "SELECT desired_context FROM project_update_receipt"
            " WHERE job_id='pjob_legacy'",
        )["desired_context"])
        self.assertNotIn("migrationPending", migrated_context)
        self.assertEqual(
            recovered.workflow.job("pjob_legacy")["status"], "queued")
        recovered.store.close()

    def test_new_snapshot_marks_older_queued_audit_stale(self):
        first = write_snapshot(self.sessions, "s1", [("claim", "source")], version=1)
        self.enqueue([first]); first_run = self.engine.process_updates(self.project)
        first_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE target_digest=?", (first_run["snapshot"]["digest"],))
        self.assertEqual(first_audit["status"], "queued")
        second = write_snapshot(self.sessions, "s1", [("claim", "new source")], version=2)
        self.enqueue([second]); second_run = self.engine.process_updates(self.project)
        self.assertEqual(self.engine.workflow.audit(first_audit["id"])["status"], "stale")
        current_audit = self.engine.store.q1(
            "SELECT * FROM audit_run WHERE target_digest=?",
            (second_run["snapshot"]["digest"],),
        )
        self.assertEqual(current_audit["status"], "queued")
        self.assertEqual(current_audit["target_digest"], second_run["snapshot"]["digest"])

    def test_release_gate_requires_l2_and_runtime_permission_for_external_action(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        self.enqueue([snapshot]); self.drain()
        latest = self.engine.workflow.latest_snapshot(self.project)
        queued = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": latest["digest"], "level": "L2",
            "reason": "release_gate", "priority": 10,
        })
        audit = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(audit["id"], queued["id"])
        with self.assertRaises(PermissionError):
            self.engine.workflow.create_release(
                project_key=self.project, project_snapshot_digest=latest["digest"],
                audit_digest=audit["digest"], created_by="agent", output_artifacts=[],
                external_action=True)
        release = self.engine.workflow.create_release(
            project_key=self.project, project_snapshot_digest=latest["digest"],
            audit_digest=audit["digest"], created_by="agent", output_artifacts=[],
            requested_status="candidate", external_action=True,
            runtime_authorization={"granted": True, "permissionId": "runtime:permit:1"})
        self.assertEqual(release["certification_status"], "candidate")

    def test_l1_audit_uses_assessment_ledger(self):
        snapshot = write_snapshot(self.sessions, "s1", [("claim", "source")])
        calls: list[str] = []
        real_judge = self.engine.workflow.compiler.judge

        def tracked_judge(task, payload):
            calls.append(task)
            return real_judge(task, payload)

        with patch.object(self.engine.workflow.compiler, "judge", side_effect=tracked_judge):
            self.enqueue([snapshot])
            update = self.engine.process_updates(self.project)
            latest = update["snapshot"]
            self.assertFalse({"a1_verify", "a2_adversarial"} & set(calls))
            self.assertEqual({item["level"] for item in latest["assessments"]}, {"A0"})
            self.assertEqual(self.engine.store.q1(
                "SELECT COUNT(*) n FROM assessment WHERE target_digest=?"
                " AND level IN ('A1','A2')", (latest["digest"],))["n"], 0)

            queued = self.engine.enqueue_audit({
                "projectKey": self.project, "targetDigest": latest["digest"],
                "level": "L1", "reason": "test semantic verification", "priority": 10,
            })
            self.assertEqual(queued["level"], "L1")
            result = self.engine.process_audits(self.project)
            audit = result["audit"]

        self.assertEqual(audit["id"], queued["id"])
        self.assertEqual(audit["level"], "L1")
        self.assertEqual(calls.count("a1_verify"), 1)
        self.assertEqual(calls.count("a2_adversarial"), 1)
        self.assertEqual({
            row["level"] for row in self.engine.store.q(
                "SELECT level FROM assessment WHERE target_digest=?",
                (latest["digest"],),
            )
            if row["level"] in {"A0", "A1", "A2"}
        }, {"A0", "A1", "A2"})
        self.assertTrue(any(f["finding_type"].startswith("adversarial_")
                            for f in self.engine.workflow.findings(self.project)))

    def test_default_checkpointed_policy_queues_and_records_human_review_packet(self):
        self.assertEqual(self.engine.workflow.policy(self.project)["autonomy_mode"],
                         "checkpointed")
        self.engine.configure_policy(self.project, {
            "autonomyMode": "checkpointed", "checkpoints": ["claim_fragile"],
            "actorId": "research-lead",
        })
        snapshot = write_snapshot(
            self.sessions, "review-session", [("fragile conclusion", "single source")],
            node_status=NodeStatus.FRAGILE,
        )
        vector = [{"threadId": snapshot["threadId"], "digest": snapshot["digest"]}]
        self.engine.enqueue_update({
            "projectKey": self.project, "evidenceVector": vector,
            "capturedScope": {"includedSessions": [snapshot["threadId"]],
                              "excludedSessions": [], "isolatedSessions": []},
            "reason": "manual_immediate", "priority": 5,
        })
        self.engine.process_updates(self.project)

        graph_view = self.engine.graph(self.project)
        packet = graph_view["reviewPackets"][0]
        claim = graph_view["claims"][0]
        self.assertEqual(packet["status"], "pending")
        self.assertEqual(packet["recommendedAction"], "request_evidence")
        self.assertEqual(claim["humanReview"]["reviewPacketId"], packet["id"])
        self.assertEqual(graph_view["humanReview"]["pendingCount"], 1)
        self.assertIn(packet["id"], {
            review["id"] for review in self.engine.workflow.reviews(self.project)
        })
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            self.engine.record_review_result(self.project, packet["id"], {
                "action": "approve", "actorId": "research-lead",
                "rationale": "This UI is displaying an obsolete snapshot.",
                "expectedSnapshotDigest": "project:stale",
            })

        audit_job = self.engine.enqueue_audit({
            "projectKey": self.project, "targetDigest": graph_view["snapshot"]["digest"],
            "level": "L2", "reason": "review_gate_test", "priority": 20,
        })
        audit = self.engine.process_audits(self.project)["audit"]
        self.assertEqual(audit["id"], audit_job["id"])
        blocked_release = self.engine.workflow.create_release(
            project_key=self.project,
            project_snapshot_digest=graph_view["snapshot"]["digest"],
            audit_digest=audit["digest"], created_by="research-lead",
            output_artifacts=[], requested_status="certified",
        )
        self.assertEqual(blocked_release["certification_status"], "blocked")

        requested = self.engine.record_review_result(self.project, packet["id"], {
            "action": "request_evidence", "actorId": "research-lead",
            "rationale": "Collect an independent source before final approval.",
        })
        self.assertEqual(requested["status"], "pending")
        self.assertEqual(self.engine.graph(self.project)["humanReview"]["gateStatus"], "pending")

        approved = self.engine.record_review_result(self.project, packet["id"], {
            "action": "approve", "actorId": "research-lead",
            "rationale": "The limitation is understood and accepted.",
        })
        self.assertEqual(approved["status"], "approved")
        updated = self.engine.graph(self.project)
        self.assertEqual(updated["reviewPackets"][0]["status"], "approved")
        self.assertEqual(updated["claims"][0]["humanReview"]["status"], "approved")
        self.assertEqual(updated["humanReview"]["gateStatus"], "approved")
        decisions = self.engine.store.q(
            "SELECT * FROM decision_event WHERE review_id=? ORDER BY created_at,id",
            (packet["id"],))
        self.assertEqual({decision["action"] for decision in decisions},
                         {"request_evidence", "endorse"})
        self.assertTrue(all(decision["decided_by"] == "human" for decision in decisions))
        event = self.engine.store.q1(
            "SELECT * FROM domain_event WHERE project_key=?"
            " AND event_type='HumanReviewResultRecorded'", (self.project,))
        self.assertIsNotNone(event)
        certified_release = self.engine.workflow.create_release(
            project_key=self.project,
            project_snapshot_digest=graph_view["snapshot"]["digest"],
            audit_digest=audit["digest"], created_by="research-lead",
            output_artifacts=[], requested_status="certified",
        )
        self.assertEqual(certified_release["certification_status"], "certified")

        for action, expected in (("reject", "rejected"), ("defer", "deferred")):
            review_id = f"review_packet_test_{action}"
            review_payload = {
                **packet, "id": review_id, "status": "pending",
                "snapshotDigest": graph_view["snapshot"]["digest"],
            }
            self.engine.store.x(
                "INSERT INTO review (id,project_key,subject_id,review_type,checkpoint,status,"
                "payload,created_at) VALUES (?,?,?,'human_review_packet','human','open',?,?)",
                (review_id, self.project, review_id, json.dumps(review_payload),
                 "2026-07-13T00:00:00Z"),
            )
            self.engine.store.conn.commit()
            result = self.engine.record_review_result(self.project, review_id, {
                "action": action, "actorId": "research-lead",
                "rationale": f"Human chose to {action} this packet.",
            })
            self.assertEqual(result["status"], expected)

    @staticmethod
    def _capture_error(errors, fn, *args):
        try:
            fn(*args)
        except Exception as exc:  # pragma: no cover - assertion aid
            errors.append(exc)


if __name__ == "__main__":
    unittest.main(verbosity=2)
