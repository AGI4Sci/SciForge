from __future__ import annotations

import json
import tempfile
import unittest

from evidence_dag import provjson
from evidence_dag.artifacts import ArtifactRegistry
from evidence_dag.assessment import run_a0
from evidence_dag.graph import ThreadGraph
from evidence_dag.lineage import ingest_trace_lineage, reproducibility_report
from evidence_dag.llm import StubLLM
from evidence_dag.model import EDGE_FAMILY, EdgeFamily, EdgeRel, NodeType, make_node_id
from evidence_dag.service import Engine


SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
SHA_C = "sha256:" + "c" * 64


def complete_lineage(finding_id: str) -> dict:
    return {
        "evidenceLineage": {
            "activity": {
                "id": "analysis-2026-07-10-001",
                "type": "analysis_run",
                "name": "Primary statistical analysis",
                "status": "completed",
                "parameters": {"alpha": 0.05, "method": "welch"},
                "stochastic": True,
                "randomSeed": 734,
                "startedAt": "2026-07-10T01:00:00Z",
                "endedAt": "2026-07-10T01:02:00Z",
            },
            "inputs": [{
                "id": "dataset:measurements:v2",
                "type": "dataset_version",
                "name": "Measurements release 2",
                "version": "2",
                "artifact": {
                    "kind": "dataset", "locator": "runtime:thread/data-v2",
                    "contentDigest": SHA_A, "version": "2", "mediaType": "text/csv",
                },
            }],
            "software": [{
                "id": "software:analysis-package",
                "name": "analysis-package",
                "version": "3.4.1",
                "commit": "15b34a2c46bd9f78",
            }],
            "environment": {
                "id": "environment:container-1",
                "name": "OCI analysis environment",
                "containerDigest": SHA_B,
                "specification": {"os": "linux", "python": "3.12.4"},
            },
            "logs": [{
                "id": "artifact:analysis-log",
                "name": "analysis stdout",
                "artifact": {
                    "kind": "log", "locator": "runtime:thread/analysis-log",
                    "contentDigest": SHA_B, "mediaType": "text/plain",
                },
            }],
            "outputs": [{
                "id": "artifact:result-table",
                "type": "artifact",
                "name": "result table",
                "artifact": {
                    "kind": "dataset", "locator": "runtime:thread/result-table",
                    "contentDigest": SHA_C, "mediaType": "text/csv",
                },
            }],
            "agents": [{
                "id": "agent:stats-worker",
                "name": "Statistics worker",
                "agentType": "software_agent",
            }],
            "relations": [
                {"src": finding_id, "dst": "analysis-2026-07-10-001", "rel": "generated_by"},
                {"src": "artifact:result-table", "dst": "dataset:measurements:v2",
                 "rel": "derived_from"},
            ],
        },
    }


class TestStructuredRunLineage(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.registry = ArtifactRegistry(
            workspace_roots=(self.temp.name,), locator_root=self.temp.name,
        )
        self.graph = ThreadGraph("thread")
        self.finding = self.graph.add_or_get_node(
            NodeType.FINDING, "Treatment changed the measured endpoint.", trace_ref="finding-item",
        )

    def ingest(self, payload: dict) -> dict[str, int]:
        return ingest_trace_lineage(self.graph, [{
            "id": "tool-result-1",
            "kind": "tool_result",
            "output": json.dumps(payload),
        }], self.registry)

    def test_complete_manifest_reaches_strict_l4_and_full_provenance(self):
        delta = self.ingest(complete_lineage(self.finding.id))
        self.assertEqual(delta["envelopes"], 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.ANALYSIS_RUN)), 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.DATASET_VERSION)), 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.SOFTWARE_VERSION)), 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.ENVIRONMENT)), 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.AGENT)), 1)

        report = reproducibility_report(self.graph, self.finding.id)
        self.assertTrue(report["complete"])
        self.assertEqual(report["level"], "L4")
        self.assertEqual(report["breakpoints"], [])

        path = self.graph.provenance_path(self.finding.id)
        self.assertEqual(path["provenanceLevel"], "L4")
        self.assertTrue(path["reachesArtifact"])
        self.assertEqual(path["reproducibility"]["runIds"], report["runIds"])
        path_types = {node["type"] for node in path["nodes"]}
        self.assertTrue({
            "finding", "analysis_run", "dataset_version", "software_version",
            "environment", "artifact", "agent",
        }.issubset(path_types))

    def test_missing_components_are_not_inferred_or_promoted(self):
        payload = complete_lineage(self.finding.id)
        lineage = payload["evidenceLineage"]
        lineage["activity"].pop("parameters")
        lineage["logs"] = []
        lineage["environment"].pop("containerDigest")
        self.ingest(payload)

        report = reproducibility_report(self.graph, self.finding.id)
        self.assertFalse(report["complete"])
        self.assertIsNone(report["level"])
        reasons = {item["reason"] for item in report["breakpoints"]}
        self.assertTrue({
            "parameters_not_declared", "logs_missing_or_unverifiable",
            "environment_missing_or_unverifiable",
        }.issubset(reasons))
        self.assertNotEqual(self.graph.provenance_path(self.finding.id)["provenanceLevel"], "L4")

    def test_unstructured_run_like_text_is_ignored(self):
        delta = ingest_trace_lineage(self.graph, [{
            "id": "message-1", "type": "message",
            "content": "Run 1 used data.csv with seed 4 and generated output.csv",
        }, {
            "id": "tool-result-1", "type": "tool_result",
            "content": {"run": {"id": "looks-explicit-but-is-not-the-contract"}},
        }], self.registry)
        self.assertEqual(delta, {"envelopes": 0, "nodes": 0, "edges": 0})
        self.assertEqual(len(self.graph.nodes), 1)

    def test_explicit_item_metadata_envelope_is_ingested(self):
        delta = ingest_trace_lineage(self.graph, [{
            "id": "tool-result-1", "type": "tool_result", "content": "completed",
            "metadata": complete_lineage(self.finding.id),
        }], self.registry)
        self.assertEqual(delta["envelopes"], 1)
        self.assertTrue(reproducibility_report(self.graph, self.finding.id)["complete"])

    def test_experiment_run_accepts_explicit_raw_observation_input(self):
        payload = complete_lineage(self.finding.id)
        lineage = payload["evidenceLineage"]
        lineage["activity"]["id"] = "experiment-run-9"
        lineage["activity"]["type"] = "experiment_run"
        lineage["inputs"] = [{
            "id": "observation:instrument-9",
            "type": "observation",
            "name": "Instrument reading",
            "value": 1.25,
            "unit": "mV",
            "observedAt": "2026-07-10T01:01:00Z",
        }]
        lineage["relations"][0]["dst"] = "experiment-run-9"
        lineage["relations"] = lineage["relations"][:1]
        self.ingest(payload)
        self.assertEqual(len(self.graph.nodes_of(NodeType.EXPERIMENT_RUN)), 1)
        self.assertEqual(len(self.graph.nodes_of(NodeType.OBSERVATION)), 1)
        self.assertTrue(reproducibility_report(self.graph, self.finding.id)["complete"])

    def test_stochastic_run_without_seed_has_explicit_breakpoint(self):
        payload = complete_lineage(self.finding.id)
        payload["evidenceLineage"]["activity"].pop("randomSeed")
        self.ingest(payload)
        reasons = {item["reason"] for item in
                   reproducibility_report(self.graph, self.finding.id)["breakpoints"]}
        self.assertIn("stochastic_run_seed_missing", reasons)

    def test_a0_records_reproducibility_result(self):
        self.ingest(complete_lineage(self.finding.id))
        run = self.graph.nodes_of(NodeType.ANALYSIS_RUN)[0]
        assessments = [a for a in run_a0(self.graph) if a.target_id == run.id]
        self.assertEqual(len(assessments), 1)
        self.assertEqual(assessments[0].dimension.value, "reproducibility")
        self.assertEqual(assessments[0].result.value, "passed")

    def test_prov_json_uses_entity_activity_agent_and_is_lossless(self):
        self.ingest(complete_lineage(self.finding.id))
        document = provjson.to_prov_json(self.graph)
        run_id = self.graph.nodes_of(NodeType.ANALYSIS_RUN)[0].id
        agent_id = self.graph.nodes_of(NodeType.AGENT)[0].id
        self.assertIn(run_id, document["activity"])
        self.assertIn(agent_id, document["agent"])
        self.assertTrue(document["used"])
        self.assertTrue(document["wasGeneratedBy"])
        self.assertTrue(document["wasDerivedFrom"])
        self.assertTrue(document["wasAssociatedWith"])
        restored = provjson.loads(provjson.dumps(self.graph))
        self.assertEqual(restored.to_dict(), self.graph.to_dict())

    def test_relation_families_and_cycle_policy_are_explicit(self):
        self.assertEqual(EDGE_FAMILY[EdgeRel.USED], EdgeFamily.PROVENANCE)
        self.assertEqual(EDGE_FAMILY[EdgeRel.SUPERSEDES], EdgeFamily.VERSION)
        self.assertEqual(EDGE_FAMILY[EdgeRel.REPLICATES], EdgeFamily.REPLICATION)
        first = self.graph.add_or_get_node(
            NodeType.DATASET_VERSION, "v1", external_id="dataset:v1", identity_scope="dataset:v1",
        )
        second = self.graph.add_or_get_node(
            NodeType.DATASET_VERSION, "v2", external_id="dataset:v2", identity_scope="dataset:v2",
        )
        self.assertIsNotNone(self.graph.add_edge(second.id, first.id, EdgeRel.SUPERSEDES))
        self.assertIsNone(self.graph.add_edge(first.id, second.id, EdgeRel.SUPERSEDES))
        self.assertIsNotNone(self.graph.add_edge(first.id, second.id, EdgeRel.REPLICATES))
        self.assertIsNotNone(self.graph.add_edge(second.id, first.id, EdgeRel.REPLICATES))
        later = ThreadGraph("thread")
        later_first = later.add_or_get_node(
            NodeType.DATASET_VERSION, "v1", external_id="dataset:v1", identity_scope="dataset:v1",
        )
        later_second = later.add_or_get_node(
            NodeType.DATASET_VERSION, "v2", external_id="dataset:v2", identity_scope="dataset:v2",
        )
        self.assertIsNotNone(later.add_edge(later_first.id, later_second.id, EdgeRel.SUPERSEDES))
        self.assertEqual(self.graph.merge_from(later)["new_edges"], [])


class TestLineageEngineEndToEnd(unittest.TestCase):
    def test_update_compiles_lineage_into_immutable_reloadable_l4_snapshot(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = workspace + "/evidence-store"
            finding_content = "Treatment changed the measured endpoint."
            finding_id = make_node_id(NodeType.FINDING, finding_content)
            extract_response = json.dumps({
                "nodes": [{
                    "tmp_id": "finding", "type": "finding", "content": finding_content,
                    "trace_ref": "tool-result-1",
                }],
                "edges": [],
            })
            engine = Engine(
                StubLLM(extract_response=extract_response, nli_handler=lambda _p, _h: 0.9),
                storage_dir=storage,
            )
            trace = [{
                "id": "tool-result-1", "kind": "tool_result", "toolName": "run_analysis",
                "output": complete_lineage(finding_id),
            }]
            result = engine.update(
                thread_id="runtime:lineage-thread", target_watermark="tool-result-1",
                reason="turn_committed", priority="P2", trace=trace,
                workspace_root=workspace, project_root=workspace,
            )
            self.assertEqual(result["snapshot"]["status"], "committed")
            self.assertEqual(
                engine.provenance("runtime:lineage-thread", finding_id)["provenanceLevel"], "L4",
            )
            run = engine.require("runtime:lineage-thread").nodes_of(NodeType.ANALYSIS_RUN)[0]
            reproducibility = [
                item for item in engine.export_prov_json("runtime:lineage-thread")["edag:assessments"]
                if item["targetId"] == run.id and item["dimension"] == "reproducibility"
            ]
            self.assertEqual(len(reproducibility), 1)
            self.assertEqual(reproducibility[0]["result"], "passed")
            self.assertEqual(reproducibility[0]["targetDigest"], result["snapshot"]["digest"])

            reloaded = Engine(
                StubLLM(extract_response=extract_response, nli_handler=lambda _p, _h: 0.9),
                storage_dir=storage,
            )
            self.assertEqual(
                reloaded.latest_snapshot("runtime:lineage-thread").digest,
                result["snapshot"]["digest"],
            )
            self.assertEqual(
                reloaded.provenance("runtime:lineage-thread", finding_id)["provenanceLevel"], "L4",
            )


if __name__ == "__main__":
    unittest.main()
