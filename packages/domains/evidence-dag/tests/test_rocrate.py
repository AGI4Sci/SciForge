from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest

from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Artifact,
    ArtifactVersion,
    Assessment,
    AssessmentDimension,
    AssessmentLevel,
    AssessmentResult,
    EdgeRel,
    NodeType,
    SourceAnchor,
    SourceSelector,
)
from evidence_dag.rocrate import (
    CRATE_SCHEMA_VERSION,
    METADATA_FILE,
    RO_CRATE_CONTEXT,
    dumps_ro_crate,
    export_ro_crate,
    import_ro_crate,
    loads_ro_crate,
    read_ro_crate,
    write_ro_crate,
)
from evidence_dag.snapshot import build_snapshot


SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
SHA_C = "sha256:" + "c" * 64
SHA_D = "sha256:" + "d" * 64
SHA_E = "sha256:" + "e" * 64
NOW = "2026-07-10T01:00:00Z"


def _artifact_pair(token, kind, locator, digest, *, version=None, media_type=None,
                   current_version_id=None, supersedes=None):
    version_id = f"artifact-version:{token}-{version or '1'}"
    artifact = Artifact(
        artifact_id=f"artifact:{token}", kind=kind, created_at=NOW,
        current_version_id=current_version_id or version_id,
    )
    artifact_version = ArtifactVersion(
        version_id=version_id, artifact_id=artifact.artifact_id, locator=locator,
        content_digest=digest, version=version, size=0, media_type=media_type,
        observed_at=NOW, availability="available", retention="reference",
        supersedes=supersedes,
    )
    return artifact, artifact_version


def _record_of_type(document: dict, type_name: str) -> list[dict]:
    result = []
    for record in document["@graph"]:
        raw = record.get("@type")
        types = {raw} if isinstance(raw, str) else set(raw or [])
        if type_name in types:
            result.append(record)
    return result


def build_crate_graph(workspace: str):
    graph = ThreadGraph("runtime:ro-crate-thread", {"scope": {
        "workspaceRoot": workspace,
        "projectRoot": workspace,
    }})

    paper, paper_v1 = _artifact_pair(
        "paper", "paper", "https://example.test/paper-v2.pdf", SHA_A, version="1",
        media_type="application/pdf", current_version_id="artifact-version:paper-2",
    )
    paper, paper_version = _artifact_pair(
        "paper", "paper", "https://example.test/paper-v2.pdf", SHA_E, version="2",
        media_type="application/pdf", supersedes=paper_v1.version_id,
    )
    anchor = SourceAnchor(
        anchor_id="anchor:paper-results", artifact_id=paper.artifact_id,
        artifact_version_id=paper_version.version_id,
        selector=SourceSelector.from_dict({
            "type": "pdf", "page": 7, "section": "Results", "quote": "Exact result.",
        }),
        anchor_digest=f"sha256:{hashlib.sha256(b'Exact result.').hexdigest()}",
        created_at=NOW,
    )
    graph.attach_registry_records(
        artifact=paper, artifact_version=paper_version, source_anchor=anchor,
    )
    graph.artifact_versions[paper_v1.version_id] = paper_v1
    assertion = graph.add_or_get_node(
        NodeType.SOURCE_ASSERTION, "The paper reports a positive effect.",
        artifact_id=paper.artifact_id, artifact_version_id=paper_version.version_id,
        source_anchor_id=anchor.anchor_id, external_id="doi:10.0000/example.v2",
        trace_ref="paper-read", created_at="2026-07-10T01:00:00Z",
    )
    finding = graph.add_or_get_node(
        NodeType.FINDING, "The primary analysis found a positive effect.",
        external_id="finding:primary", trace_ref="analysis-output",
    )
    graph.add_edge(assertion.id, finding.id, EdgeRel.SUPPORTS, nli_score=0.94)

    dataset_artifact, dataset_version = _artifact_pair(
        "dataset", "dataset", "runtime:crate/data-v3", SHA_B,
        version="3", media_type="text/csv",
    )
    graph.attach_registry_records(
        artifact=dataset_artifact, artifact_version=dataset_version,
    )
    dataset = graph.add_or_get_node(
        NodeType.DATASET_VERSION, "Measurements release 3",
        external_id="dataset:measurements:v3", identity_scope="dataset:measurements:v3",
        artifact_id=dataset_artifact.artifact_id,
        artifact_version_id=dataset_version.version_id,
        attributes={"version": "3"},
    )
    software = graph.add_or_get_node(
        NodeType.SOFTWARE_VERSION, "analysis-package 4.2.0",
        external_id="software:analysis-package:4.2.0",
        identity_scope="software:analysis-package:4.2.0",
        attributes={"version": "4.2.0", "commit": "4ef7b3ac"},
    )
    environment = graph.add_or_get_node(
        NodeType.ENVIRONMENT, "OCI environment",
        external_id="environment:oci:sha256-b", identity_scope="environment:oci:sha256-b",
        attributes={"containerDigest": SHA_C, "specification": {"python": "3.12"}},
    )
    run = graph.add_or_get_node(
        NodeType.ANALYSIS_RUN, "Primary statistical analysis",
        external_id="analysis-run:42", identity_scope="analysis-run:42",
        attributes={
            "parametersDeclared": True, "parameters": {"alpha": 0.05},
            "stochastic": True, "randomSeed": 734,
        },
    )
    graph.add_edge(run.id, dataset.id, EdgeRel.USED)
    graph.add_edge(run.id, software.id, EdgeRel.USED)
    graph.add_edge(run.id, environment.id, EdgeRel.USED)

    log_artifact, log_version = _artifact_pair(
        "log", "log", "runtime:crate/run-42.log", SHA_C, media_type="text/plain",
    )
    graph.attach_registry_records(artifact=log_artifact, artifact_version=log_version)
    log = graph.add_or_get_node(
        NodeType.ARTIFACT, "Analysis log", external_id="artifact:run-42-log",
        identity_scope="artifact:run-42-log", artifact_id=log_artifact.artifact_id,
        artifact_version_id=log_version.version_id, attributes={"lineageRole": "log"},
    )
    result_artifact, result_version = _artifact_pair(
        "results", "dataset", "runtime:crate/results-v1", SHA_D,
        version="1", media_type="text/csv",
    )
    graph.attach_registry_records(artifact=result_artifact, artifact_version=result_version)
    result = graph.add_or_get_node(
        NodeType.ARTIFACT, "Result table", external_id="artifact:results-v1",
        identity_scope="artifact:results-v1", artifact_id=result_artifact.artifact_id,
        artifact_version_id=result_version.version_id, attributes={"lineageRole": "output"},
    )
    graph.add_edge(log.id, run.id, EdgeRel.GENERATED_BY)
    graph.add_edge(result.id, run.id, EdgeRel.GENERATED_BY)
    graph.add_edge(result.id, dataset.id, EdgeRel.DERIVED_FROM)
    graph.add_edge(finding.id, run.id, EdgeRel.GENERATED_BY)

    agent = graph.add_or_get_node(
        NodeType.AGENT, "Statistics worker", external_id="agent:stats-worker",
        identity_scope="agent:stats-worker", attributes={"agentType": "software_agent"},
    )
    graph.add_edge(run.id, agent.id, EdgeRel.ASSOCIATED_WITH)
    graph.add_edge(finding.id, agent.id, EdgeRel.ATTRIBUTED_TO)

    experiment = graph.add_or_get_node(
        NodeType.EXPERIMENT_RUN, "Independent instrument run",
        external_id="experiment-run:7", identity_scope="experiment-run:7",
        attributes={"parametersDeclared": True, "parameters": {"temperatureC": 23}},
    )
    observation = graph.add_or_get_node(
        NodeType.OBSERVATION, "Instrument observation 7",
        external_id="observation:7", identity_scope="observation:7",
    )
    graph.add_edge(experiment.id, observation.id, EdgeRel.USED)
    graph.add_edge(experiment.id, agent.id, EdgeRel.ASSOCIATED_WITH)

    graph.assessments.append(Assessment(
        assessment_id="assessment:crate-a0",
        target_id=run.id,
        dimension=AssessmentDimension.REPRODUCIBILITY,
        level=AssessmentLevel.A0,
        result=AssessmentResult.PASSED,
        actor="deterministic-lineage-checker",
        method="manifest-completeness",
        confidence=1.0,
        target_digest="pending",
        created_at="2026-07-10T02:00:00Z",
    ))
    snapshot = build_snapshot(graph, version=4, input_watermark="runtime-item-88")
    graph.assessments[0] = Assessment(
        **{
            **graph.assessments[0].__dict__,
            "target_digest": snapshot.digest,
        }
    )
    graph.meta["snapshot"] = snapshot.to_dict()
    return graph, snapshot


class TestRoCrateExchange(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.graph, self.snapshot = build_crate_graph(self.temp.name)

    def test_export_is_ro_crate_and_exposes_prov_and_registry_records(self):
        document = export_ro_crate(self.graph, self.snapshot)
        self.assertIn(RO_CRATE_CONTEXT, document["@context"])
        root = next(item for item in document["@graph"] if item["@id"] == "./")
        self.assertEqual(root["edagSchemaVersion"], CRATE_SCHEMA_VERSION)
        self.assertEqual(root["identifier"], self.snapshot.digest)
        self.assertEqual(len(_record_of_type(document, "edag:Artifact")), 4)
        self.assertEqual(len(_record_of_type(document, "edag:ArtifactVersion")), 5)
        self.assertEqual(len(_record_of_type(document, "edag:SourceAnchor")), 1)

        activities = _record_of_type(document, "prov:Activity")
        self.assertEqual(len(activities), 2)
        self.assertEqual(
            {item["edagNodeType"] for item in activities},
            {"analysis_run", "experiment_run"},
        )
        self.assertEqual(len(_record_of_type(document, "prov:Agent")), 1)
        self.assertTrue(_record_of_type(document, "prov:Usage"))
        self.assertTrue(_record_of_type(document, "prov:Generation"))
        self.assertTrue(_record_of_type(document, "prov:Derivation"))
        self.assertTrue(_record_of_type(document, "prov:Association"))
        self.assertTrue(_record_of_type(document, "prov:Attribution"))
        run = next(item for item in activities if item["edagNodeType"] == "analysis_run")
        self.assertEqual(len(run["prov:used"]), 3)
        revised = next(
            item for item in _record_of_type(document, "edag:ArtifactVersion")
            if "prov:wasRevisionOf" in item
        )
        self.assertEqual(revised["contentUrl"], "https://example.test/paper-v2.pdf")

    def test_json_round_trip_is_lossless_and_keeps_snapshot_identity(self):
        imported = loads_ro_crate(
            dumps_ro_crate(self.graph, self.snapshot),
            expected_snapshot_digest=self.snapshot.digest,
        )
        self.assertEqual(imported.snapshot.to_dict(), self.snapshot.to_dict())
        self.assertEqual(imported.graph.to_dict(), self.graph.to_dict())
        self.assertEqual(
            imported.graph.source_anchors[next(iter(imported.graph.source_anchors))]
            .selector.to_dict()["page"],
            7,
        )

    def test_directory_export_is_reference_only_idempotent_and_importable(self):
        directory = self.temp.name + "/crate"
        target = write_ro_crate(directory, self.graph, self.snapshot)
        self.assertEqual(target.name, METADATA_FILE)
        self.assertEqual(write_ro_crate(directory, self.graph, self.snapshot), target)
        imported = read_ro_crate(directory, expected_snapshot_digest=self.snapshot.digest)
        self.assertEqual(imported.graph.to_dict(), self.graph.to_dict())
        self.assertEqual({item.name for item in target.parent.iterdir()}, {METADATA_FILE})

        changed = copy.deepcopy(self.graph)
        changed.meta.pop("snapshot")
        changed.add_or_get_node(NodeType.CLAIM, "A later claim")
        later = build_snapshot(changed, version=self.snapshot.version + 1, input_watermark="later")
        changed.meta["snapshot"] = later.to_dict()
        with self.assertRaises(FileExistsError):
            write_ro_crate(directory, changed, later)

    def test_export_rejects_graph_mutation_after_snapshot(self):
        self.graph.meta.pop("snapshot")
        self.graph.add_or_get_node(NodeType.CLAIM, "Mutation after commit")
        with self.assertRaisesRegex(ValueError, "digest"):
            export_ro_crate(self.graph, self.snapshot)

    def test_import_rejects_tampering_and_no_legacy_fallback_exists(self):
        document = export_ro_crate(self.graph, self.snapshot)
        node = _record_of_type(document, "edag:EvidenceNode")[0]
        node["edagRecord"]["content"] = "tampered"
        with self.assertRaisesRegex(ValueError, "identity|digest"):
            import_ro_crate(document)

        document = export_ro_crate(self.graph, self.snapshot)
        document["@graph"] = [
            item for item in document["@graph"]
            if "edag:Artifact" not in (
                {item.get("@type")} if isinstance(item.get("@type"), str)
                else set(item.get("@type") or [])
            )
        ]
        with self.assertRaisesRegex(ValueError, "Artifact"):
            import_ro_crate(document)

        document = export_ro_crate(self.graph, self.snapshot)
        next(item for item in document["@graph"] if item["@id"] == "./").pop(
            "edagSchemaVersion"
        )
        with self.assertRaisesRegex(ValueError, "schema"):
            import_ro_crate(document)

    def test_import_validates_w3c_prov_relation_shape_and_expected_digest(self):
        document = export_ro_crate(self.graph, self.snapshot)
        usage = _record_of_type(document, "prov:Usage")[0]
        usage["prov:entity"] = {"@id": "urn:incorrect"}
        with self.assertRaisesRegex(ValueError, "prov:entity"):
            import_ro_crate(document)

        document = export_ro_crate(self.graph, self.snapshot)
        with self.assertRaisesRegex(ValueError, "requested Evidence Snapshot"):
            import_ro_crate(document, expected_snapshot_digest="sha256:" + "0" * 64)


if __name__ == "__main__":
    unittest.main()
