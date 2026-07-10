from __future__ import annotations

import json
import os
import tempfile
import unittest

from evidence_dag.artifacts import ArtifactRegistry, digest_file
from evidence_dag.extractor import extract_dag, render_trace
from evidence_dag.llm import StubLLM
from evidence_dag.model import NodeType
from evidence_dag.service import Engine


def _payload(*, source_ref: str, source_content: str = "The source reports a measured result.") -> str:
    return json.dumps({
        "nodes": [
            {
                "tmp_id": "source", "type": "source_assertion",
                "content": source_content, "trace_ref": source_ref,
                "source_type": "dataset", "credibility": "high",
            },
            {
                "tmp_id": "claim", "type": "claim",
                "content": "The measured result supports the conclusion.",
                "trace_ref": source_ref,
            },
        ],
        "edges": [{"src": "source", "dst": "claim", "rel": "supports"}],
    })


class TestNativeTraceArtifactHarvesting(unittest.TestCase):
    def test_desktop_canonical_json_tool_result_preserves_file_artifact_and_anchor(self):
        with tempfile.TemporaryDirectory() as workspace:
            relative_path = "data/input.csv"
            absolute_path = os.path.join(workspace, relative_path)
            os.makedirs(os.path.dirname(absolute_path))
            with open(absolute_path, "w", encoding="utf-8") as fh:
                fh.write("x,y")
            # Exact output shape of toEvidenceDagTraceItems: the original
            # result object is canonicalized into content and source_refs.
            trace = [{
                "id": "tool_call-1", "type": "tool_result", "tool_name": "read",
                "call_id": "call-1", "source_item_id": "raw-result",
                "content": '{"content":"x,y","relative_path":"data/input.csv"}',
                "source_refs": [{"kind": "file", "value": relative_path}],
            }]
            graph = extract_dag(
                trace, StubLLM(extract_response=_payload(source_ref="tool_call-1")),
                "runtime:canonical", artifact_registry=ArtifactRegistry(
                    workspace_roots=(workspace,), locator_root=workspace,
                ),
            )
            source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
            version = graph.artifact_versions[source.artifact_version_id or ""]
            anchor = graph.source_anchors[source.source_anchor_id or ""]
            self.assertEqual(version.locator, relative_path)
            self.assertEqual(version.content_digest, digest_file(absolute_path))
            self.assertEqual(anchor.selector.quote, "x,y")
            claim = graph.nodes_of(NodeType.CLAIM)[0]
            self.assertEqual(graph.provenance_path(claim.id)["provenanceLevel"], "L3")

    def test_desktop_write_receipt_registers_locator_but_never_quotes_tool_json_as_file_content(self):
        with tempfile.TemporaryDirectory() as workspace:
            relative_path = "results/output.json"
            absolute_path = os.path.join(workspace, relative_path)
            os.makedirs(os.path.dirname(absolute_path))
            with open(absolute_path, "w", encoding="utf-8") as fh:
                fh.write('{"result":42}')
            trace = [{
                "id": "write-1", "type": "tool_result", "tool_name": "write",
                "content": "saved\nVISIBLE_SOURCE_REFERENCES "
                           '[{"kind":"file","value":"results/output.json"}]',
                "source_refs": [{"kind": "file", "value": relative_path}],
            }]
            graph = extract_dag(
                trace, StubLLM(extract_response=_payload(source_ref="write-1")),
                "runtime:write", artifact_registry=ArtifactRegistry(
                    workspace_roots=(workspace,), locator_root=workspace,
                ),
            )
            source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
            version = graph.artifact_versions[source.artifact_version_id or ""]
            self.assertEqual(version.locator, relative_path)
            self.assertEqual(version.content_digest, digest_file(absolute_path))
            self.assertIsNone(source.source_anchor_id)
            self.assertFalse(graph.source_anchors)
            claim = graph.nodes_of(NodeType.CLAIM)[0]
            provenance = graph.provenance_path(claim.id)
            self.assertEqual(provenance["provenanceLevel"], "L1")
            self.assertIn("source_anchor_missing", {item["reason"] for item in provenance["breakpoints"]})

    def test_same_assertion_from_two_files_retains_two_independent_source_nodes(self):
        with tempfile.TemporaryDirectory() as workspace:
            trace = []
            nodes = []
            for index, relative_path in enumerate(("sources/a.txt", "sources/b.txt"), start=1):
                absolute_path = os.path.join(workspace, relative_path)
                os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
                with open(absolute_path, "w", encoding="utf-8") as fh:
                    fh.write("The source reports a measured result.\n")
                trace.extend([
                    {
                        "id": f"call-{index}", "kind": "tool_call", "toolName": "read",
                        "callId": f"read-{index}", "arguments": {"path": relative_path},
                    },
                    {
                        "id": f"result-{index}", "kind": "tool_result", "toolName": "read",
                        "callId": f"read-{index}",
                        "output": {
                            "path": absolute_path, "relative_path": relative_path,
                            "content": "The source reports a measured result.\n",
                        },
                    },
                ])
                nodes.append({
                    "tmp_id": f"source-{index}", "type": "source_assertion",
                    "content": "The source reports a measured result.",
                    "trace_ref": f"result-{index}", "source_type": "unknown",
                })
            nodes.append({
                "tmp_id": "claim", "type": "claim", "content": "The result is independently observed.",
                "trace_ref": "result-2",
            })
            response = json.dumps({
                "nodes": nodes,
                "edges": [
                    {"src": "source-1", "dst": "claim", "rel": "supports"},
                    {"src": "source-2", "dst": "claim", "rel": "supports"},
                ],
            })
            graph = extract_dag(
                trace, StubLLM(extract_response=response), "runtime:independent",
                artifact_registry=ArtifactRegistry(
                    workspace_roots=(workspace,), locator_root=workspace,
                ),
            )
            sources = graph.nodes_of(NodeType.SOURCE_ASSERTION)
            self.assertEqual(len(sources), 2)
            self.assertEqual(len({source.id for source in sources}), 2)
            self.assertEqual(len({source.artifact_id for source in sources}), 2)
            self.assertEqual(
                {graph.artifact_versions[source.artifact_version_id or ""].locator for source in sources},
                {"sources/a.txt", "sources/b.txt"},
            )

    def test_engine_update_commits_harvested_artifact_in_immutable_snapshot(self):
        with tempfile.TemporaryDirectory() as workspace:
            relative_path = "data/observations.csv"
            absolute_path = os.path.join(workspace, relative_path)
            os.makedirs(os.path.dirname(absolute_path))
            content = "measurement\n42\n"
            with open(absolute_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            trace = [
                {
                    "id": "call-data", "kind": "tool_call", "toolName": "read", "callId": "data1",
                    "arguments": {"path": relative_path},
                },
                {
                    "id": "result-data", "kind": "tool_result", "toolName": "read", "callId": "data1",
                    "output": {
                        "path": absolute_path, "relative_path": relative_path,
                        "content": content, "start_line": 1, "end_line": 2,
                    },
                },
            ]
            storage = os.path.join(workspace, ".edag")
            engine = Engine(
                StubLLM(
                    extract_response=_payload(source_ref="result-data"),
                    nli_handler=lambda _premise, _hypothesis: 0.9,
                ),
                storage_dir=storage,
            )
            result = engine.update(
                thread_id="runtime:thread", target_watermark="result-data",
                reason="turn_committed", priority="P2", trace=trace,
                workspace_root=workspace, project_root=workspace, project_key="project",
            )
            self.assertEqual(result["snapshot"]["status"], "committed")
            self.assertEqual(result["snapshot"]["artifactDigests"], [digest_file(absolute_path)])
            exported = engine.export_prov_json("runtime:thread")
            registry = exported["edag:artifactRegistry"]
            self.assertEqual(len(registry["artifacts"]), 1)
            self.assertEqual(len(registry["artifactVersions"]), 1)
            self.assertEqual(len(registry["sourceAnchors"]), 1)

            restarted = Engine(storage_dir=storage)
            reloaded = restarted.export_prov_json("runtime:thread")
            self.assertEqual(reloaded["edag:meta"]["snapshot"], result["snapshot"])
            self.assertEqual(reloaded["edag:artifactRegistry"], registry)

    def test_native_runtime_read_result_registers_file_version_and_exact_anchor(self):
        with tempfile.TemporaryDirectory() as workspace:
            relative_path = "results/measurements.txt"
            absolute_path = os.path.join(workspace, relative_path)
            os.makedirs(os.path.dirname(absolute_path))
            content = "header\nThe source reports a measured result.\nfooter\n"
            with open(absolute_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            trace = [
                {
                    "id": "call-1", "kind": "tool_call", "toolName": "read", "callId": "c1",
                    "arguments": {"path": relative_path},
                },
                {
                    "id": "result-1", "kind": "tool_result", "toolName": "read", "callId": "c1",
                    "isError": False,
                    "output": {
                        "path": absolute_path, "relative_path": relative_path, "content": content,
                        "start_line": 1, "end_line": 3, "total_lines": 3, "truncated": False,
                    },
                },
            ]
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            graph = extract_dag(
                trace, StubLLM(extract_response=_payload(source_ref="result-1")), "runtime:thread",
                artifact_registry=registry,
            )

            source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
            artifact = graph.artifacts[source.artifact_id or ""]
            version = graph.artifact_versions[source.artifact_version_id or ""]
            anchor = graph.source_anchors[source.source_anchor_id or ""]
            self.assertEqual(artifact.kind, "other")
            self.assertEqual(version.locator, relative_path)
            self.assertEqual(version.content_digest, digest_file(absolute_path))
            self.assertEqual(version.availability, "available")
            self.assertEqual(anchor.selector.type, "text")
            self.assertEqual(anchor.selector.line_range, "1:3")
            self.assertIn(anchor.selector.quote or "", content)
            rendered = render_trace(trace)
            self.assertIn("[call-1] tool_call: call read", rendered)
            self.assertIn("[result-1] tool_result: result of read", rendered)
            self.assertIn("measurements.txt", rendered)

    def test_native_web_result_reaches_l2_but_not_l3_without_source_bytes_digest(self):
        trace = [
            {
                "id": "call-web", "kind": "tool_call", "toolName": "fetch", "callId": "web1",
                "arguments": {"url": "https://example.org/paper"},
            },
            {
                "id": "result-web", "kind": "tool_result", "toolName": "fetch", "callId": "web1",
                "output": {
                    "url": "https://example.org/paper",
                    "content": "The source reports a measured result.",
                },
            },
        ]
        registry = ArtifactRegistry()
        graph = extract_dag(
            trace, StubLLM(extract_response=_payload(source_ref="result-web")), "runtime:web",
            artifact_registry=registry,
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        version = graph.artifact_versions[source.artifact_version_id or ""]
        anchor = graph.source_anchors[source.source_anchor_id or ""]
        self.assertEqual(version.locator, "https://example.org/paper")
        self.assertEqual(version.availability, "remote")
        self.assertIsNone(version.content_digest)
        self.assertEqual(anchor.selector.type, "web")
        claim = graph.nodes_of(NodeType.CLAIM)[0]
        provenance = graph.provenance_path(claim.id)
        self.assertEqual(provenance["provenanceLevel"], "L2")
        self.assertIn("artifact_digest_missing", {item["reason"] for item in provenance["breakpoints"]})

    def test_canonical_raw_tool_result_is_log_artifact_but_remains_l0(self):
        trace = [{
            "id": "result-analysis", "kind": "tool_result", "toolName": "bash", "callId": "b1",
            "output": {"command": "analysis", "output": "The source reports a measured result."},
        }]
        registry = ArtifactRegistry()
        graph = extract_dag(
            trace, StubLLM(extract_response=_payload(source_ref="result-analysis")), "runtime:analysis",
            artifact_registry=registry,
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        artifact = graph.artifacts[source.artifact_id or ""]
        version = graph.artifact_versions[source.artifact_version_id or ""]
        self.assertEqual(artifact.kind, "log")
        self.assertTrue(version.locator.startswith("runtime:"))
        self.assertIsNotNone(version.content_digest)
        self.assertEqual(registry.resolve(artifact.artifact_id)["outcome"], "available")
        claim = graph.nodes_of(NodeType.CLAIM)[0]
        provenance = graph.provenance_path(claim.id)
        self.assertEqual(provenance["provenanceLevel"], "L0")
        self.assertIn(
            "external_artifact_not_identified",
            {item["reason"] for item in provenance["breakpoints"]},
        )

    def test_deterministic_read_overrides_model_generated_weak_citation(self):
        with tempfile.TemporaryDirectory() as workspace:
            relative_path = "results/source.md"
            absolute_path = os.path.join(workspace, relative_path)
            os.makedirs(os.path.dirname(absolute_path))
            content = "The source reports a measured result.\n"
            with open(absolute_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            trace = [{
                "id": "tool_read1", "type": "tool_result", "tool_name": "read",
                "content": json.dumps({
                    "relative_path": relative_path, "path": absolute_path,
                    "content": content, "start_line": 1, "end_line": 1,
                }, sort_keys=True),
                "call_id": "read1",
                "source_refs": [
                    {"kind": "file", "value": relative_path},
                    {"kind": "file", "value": absolute_path},
                ],
            }]
            payload = json.loads(_payload(source_ref="tool_read1"))
            payload["nodes"][0]["ref"] = {"citation": "source.md"}
            payload["nodes"][0]["artifact"] = {
                "kind": "paper", "locator": "citation:source.md",
            }
            payload["nodes"][0]["selector"] = {
                "type": "text", "quote": "model-generated selector",
            }
            registry = ArtifactRegistry(workspace_roots=(workspace,), locator_root=workspace)
            graph = extract_dag(
                trace, StubLLM(extract_response=json.dumps(payload)), "runtime:canonical",
                artifact_registry=registry,
            )
            source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
            version = graph.artifact_versions[source.artifact_version_id or ""]
            anchor = graph.source_anchors[source.source_anchor_id or ""]
            self.assertEqual(version.locator, relative_path)
            self.assertEqual(version.content_digest, digest_file(absolute_path))
            self.assertEqual(anchor.selector.quote, content.strip())
            self.assertNotEqual(anchor.selector.quote, "model-generated selector")

    def test_chat_summary_without_provable_locator_stays_unregistered_l0(self):
        trace = [{
            "id": "assistant-1", "kind": "assistant_text", "role": "assistant",
            "text": "The source reports a measured result.",
        }]
        registry = ArtifactRegistry()
        graph = extract_dag(
            trace, StubLLM(extract_response=_payload(source_ref="assistant-1")), "runtime:chat",
            artifact_registry=registry,
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        self.assertIsNone(source.artifact_id)
        self.assertFalse(graph.artifacts)
        self.assertFalse(graph.source_anchors)
        claim = graph.nodes_of(NodeType.CLAIM)[0]
        provenance = graph.provenance_path(claim.id)
        self.assertEqual(provenance["provenanceLevel"], "L0")
        self.assertIn("artifact_not_linked", {item["reason"] for item in provenance["breakpoints"]})

    def test_multiple_external_candidates_never_choose_arbitrarily(self):
        trace = [{
            "id": "search-result", "kind": "tool_result", "toolName": "web_search",
            "output": "https://a.example/result says A; https://b.example/result says B.",
        }]
        registry = ArtifactRegistry()
        graph = extract_dag(
            trace, StubLLM(extract_response=_payload(source_ref="search-result")), "runtime:search",
            artifact_registry=registry,
        )
        source = graph.nodes_of(NodeType.SOURCE_ASSERTION)[0]
        version = graph.artifact_versions[source.artifact_version_id or ""]
        self.assertTrue(version.locator.startswith("runtime:"))
        self.assertNotIn(version.locator, {"https://a.example/result", "https://b.example/result"})
        claim = graph.nodes_of(NodeType.CLAIM)[0]
        self.assertEqual(graph.provenance_path(claim.id)["provenanceLevel"], "L0")


if __name__ == "__main__":
    unittest.main()
