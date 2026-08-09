from __future__ import annotations

import json
import os
import tempfile
import unittest

from evidence_dag.events import EventStore
from evidence_dag.graph import ThreadGraph
from evidence_dag.llm import StubLLM
from evidence_dag.metrics import all_metrics
from evidence_dag.model import Artifact, ArtifactVersion, EdgeRel, NodeType
from evidence_dag.service import Engine


EXTRACT = json.dumps({
    "nodes": [
        {
            "tmp_id": "s", "type": "source_assertion", "content": "Exact source result.",
            "trace_ref": "item-1", "artifact": {"kind": "paper", "locator": "doi:10.1/events"},
            "selector": {"type": "web", "url": "https://example.test/result", "quote": "Exact source result."},
        },
        {"tmp_id": "c", "type": "claim", "content": "The result holds.", "trace_ref": "item-1"},
    ],
    "edges": [{"src": "s", "dst": "c", "rel": "supports"}],
})


def _engine(storage: str) -> Engine:
    return Engine(
        StubLLM(extract_response=EXTRACT, nli_handler=lambda _p, _h: 0.9),
        storage_dir=storage,
    )


class TestEventStore(unittest.TestCase):
    def test_append_is_idempotent_and_read_reloads_durable_file(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "events.json")
            store = EventStore(path)
            first = store.append(
                "EvidenceUpdateQueued", aggregate_type="EvidenceThread", aggregate_id="t",
                idempotency_key="job-1", occurred_at="2026-07-10T00:00:00Z",
                payload={"threadId": "t", "targetWatermark": "w1"},
            )
            repeated = store.append(
                "EvidenceUpdateQueued", aggregate_type="EvidenceThread", aggregate_id="t",
                idempotency_key="job-1", occurred_at="2026-07-11T00:00:00Z",
                payload={"threadId": "t", "targetWatermark": "w1"},
            )
            self.assertEqual(repeated, first)
            self.assertEqual(first["sequence"], 1)
            self.assertTrue(first["persistent"])
            self.assertEqual(len(EventStore(path).read()), 1)

    def test_legacy_document_file_is_read_and_migrated_on_next_append(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "events.json")
            legacy_event = {
                "schemaVersion": "evidence-domain-events.v1", "eventId": "evidence-event:legacy",
                "sequence": 1, "type": "EvidenceUpdateQueued", "aggregateType": "EvidenceThread",
                "aggregateId": "t", "idempotencyKey": "job-legacy",
                "occurredAt": "2026-07-10T00:00:00Z", "correlationId": None,
                "causationId": None, "persistent": True, "payload": {"threadId": "t"},
            }
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"schemaVersion": "evidence-domain-events.v1", "events": [legacy_event]}, fh)
            store = EventStore(path)
            self.assertEqual(len(store.read()), 1)
            store.append(
                "EvidenceSnapshotCommitted", aggregate_type="EvidenceThread", aggregate_id="t",
                idempotency_key="snap-1", payload={"threadId": "t"},
            )
            with open(path, encoding="utf-8") as fh:
                lines = [line for line in fh.read().splitlines() if line.strip()]
            self.assertEqual(len(lines), 2)  # migrated to one JSON line per event
            self.assertEqual([e["sequence"] for e in EventStore(path).read()], [1, 2])

    def test_torn_trailing_line_from_crash_is_dropped(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "events.json")
            store = EventStore(path)
            store.append(
                "EvidenceUpdateQueued", aggregate_type="EvidenceThread", aggregate_id="t",
                idempotency_key="job-1", payload={"threadId": "t"},
            )
            with open(path, "a", encoding="utf-8") as fh:
                fh.write('{"schemaVersion": "evidence-domain-ev')  # simulated torn write
            recovered = EventStore(path)
            self.assertEqual(len(recovered.read()), 1)
            recovered.append(
                "EvidenceSnapshotCommitted", aggregate_type="EvidenceThread", aggregate_id="t",
                idempotency_key="snap-1", payload={"threadId": "t"},
            )
            restarted = EventStore(path).read()
            self.assertEqual([event["sequence"] for event in restarted], [1, 2])
            self.assertEqual([event["type"] for event in restarted], [
                "EvidenceUpdateQueued", "EvidenceSnapshotCommitted",
            ])

    def test_contiguous_tail_survives_storage_reset_and_keeps_monotonic_sequence(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "events.json")
            tail_event = {
                "schemaVersion": "evidence-domain-events.v1",
                "eventId": "evidence-event:tail",
                "sequence": 7501,
                "type": "EvidenceUpdateQueued",
                "aggregateType": "EvidenceThread",
                "aggregateId": "t",
                "idempotencyKey": "job-tail",
                "occurredAt": "2026-08-09T07:15:11Z",
                "correlationId": None,
                "causationId": None,
                "persistent": True,
                "payload": {"threadId": "t"},
            }
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(tail_event) + "\n")

            store = EventStore(path)
            appended = store.append(
                "EvidenceSnapshotCommitted",
                aggregate_type="EvidenceThread",
                aggregate_id="t",
                idempotency_key="snapshot-tail",
                payload={"threadId": "t"},
            )

            self.assertEqual(appended["sequence"], 7502)
            self.assertEqual(
                [event["sequence"] for event in EventStore(path).read()],
                [7501, 7502],
            )

    def test_update_and_snapshot_events_survive_restart_without_duplicates(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine = _engine(storage)
            command = dict(
                thread_id="runtime:t", target_watermark="w1", reason="turn_committed",
                priority="P2", trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace,
                queued_at="2026-07-10T00:00:00Z",
            )
            result = engine.update(**command)
            engine.update(**command)
            events = Engine(StubLLM(), storage_dir=storage).events(thread_id="runtime:t")
            self.assertEqual([event["type"] for event in events], [
                "EvidenceUpdateQueued", "EvidenceSnapshotCommitted",
            ])
            self.assertEqual(events[1]["payload"]["snapshotDigest"], result["snapshot"]["digest"])
            self.assertEqual(events[1]["causationId"], events[0]["eventId"])

    def test_audit_and_findings_are_persisted_before_they_are_read(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            engine = _engine(storage)
            result = engine.update(
                thread_id="t", target_watermark="w1", reason="turn_committed", priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace,
                idempotency_key="job-1",
            )
            audit = engine.audit(
                "t", target_digest=result["snapshot"]["digest"], level="L0", trigger="auto",
            )
            self.assertGreater(len(audit["findings"]), 0)
            engine.audit(
                "t", target_digest=result["snapshot"]["digest"], level="L0", trigger="auto",
            )
            reloaded = Engine(StubLLM(), storage_dir=storage)
            events = reloaded.events(thread_id="t")
            self.assertEqual(sum(event["type"] == "AuditCompleted" for event in events), 1)
            self.assertEqual(
                sum(event["type"] == "FindingOpened" for event in events),
                len({finding["fingerprint"] for finding in audit["findings"]}),
            )

    def test_evidence_outbox_rejects_new_artifact_lifecycle_writes(self):
        store = EventStore(None)
        with self.assertRaisesRegex(ValueError, "unsupported Evidence event type"):
            store.append(
                "ArtifactContentChanged",
                aggregate_type="Artifact",
                aggregate_id="artifact:one",
                idempotency_key="artifact-event:one",
                payload={"versionId": "artifact-version:one"},
            )


class TestOperationalMetrics(unittest.TestCase):
    def test_latencies_staleness_and_break_rate_use_only_explicit_metadata(self):
        graph = ThreadGraph("t")
        graph.add_or_get_node(NodeType.CLAIM, "Ungrounded claim")
        events = [
            {
                "eventId": "queued", "sequence": 1, "type": "EvidenceUpdateQueued",
                "occurredAt": "2026-07-10T00:00:00Z", "payload": {"threadId": "t"},
            },
            {
                "eventId": "committed", "sequence": 2, "type": "EvidenceSnapshotCommitted",
                "occurredAt": "2026-07-10T00:00:04Z",
                "payload": {
                    "threadId": "t", "queuedEventId": "queued",
                    "startedAt": "2026-07-10T00:00:01Z",
                    "completedAt": "2026-07-10T00:00:04Z",
                },
            },
        ]
        metrics = all_metrics(
            graph, events=events,
            snapshot={"version": 2, "digest": "sha256:new"},
            snapshot_history=[
                {"version": 1, "digest": "sha256:old"},
                {"version": 2, "digest": "sha256:new"},
            ],
            audits=[{
                "id": "audit:1", "status": "completed", "target_digest": "sha256:old",
                "completed_at": "2026-07-10T00:00:05Z",
            }],
        )
        self.assertEqual(metrics["queue_latency_ms"], 1000.0)
        self.assertEqual(metrics["commit_latency_ms"], 3000.0)
        self.assertEqual(metrics["audit_staleness"], 1)
        self.assertEqual(metrics["provenance_break_rate"], 1.0)
        self.assertIsNone(metrics["reproducible_finding_rate"])
        self.assertEqual(
            metrics["metric_evidence"]["reproducible_finding_rate"]["reason"],
            "no_finding_with_explicit_run",
        )

    def test_reproducible_finding_rate_counts_only_findings_with_explicit_runs(self):
        with tempfile.TemporaryDirectory() as workspace:
            graph = ThreadGraph("lineage")
            finding = graph.add_or_get_node(NodeType.FINDING, "Computed finding")
            graph.add_or_get_node(NodeType.FINDING, "Literature-only finding")
            run = graph.add_or_get_node(
                NodeType.ANALYSIS_RUN, "Analysis", identity_scope="run-1", external_id="run-1",
                trace_ref="trace-1", attributes={
                    "status": "completed", "parameters": {}, "parametersDeclared": True,
                },
            )
            observation = graph.add_or_get_node(
                NodeType.OBSERVATION, "Measurement", identity_scope="obs-1", external_id="obs-1",
                attributes={"value": 3.0, "unit": "mM", "observedAt": "2026-07-10T00:00:00Z"},
            )
            software = graph.add_or_get_node(
                NodeType.SOFTWARE_VERSION, "Tool", identity_scope="software-1", external_id="software-1",
                attributes={"version": "1.2.3"},
            )
            environment = graph.add_or_get_node(
                NodeType.ENVIRONMENT, "Container", identity_scope="env-1", external_id="env-1",
                attributes={"containerDigest": f"sha256:{'a' * 64}"},
            )
            log_artifact = Artifact(
                "artifact:log", "log", "2026-07-10T00:00:00Z",
                "artifact-version:log-1",
            )
            log_version = ArtifactVersion(
                "artifact-version:log-1", log_artifact.artifact_id, "doi:log",
                f"sha256:{'b' * 64}", "1", 0, None, "2026-07-10T00:00:00Z",
                "available", "reference",
            )
            output_artifact = Artifact(
                "artifact:output", "dataset", "2026-07-10T00:00:00Z",
                "artifact-version:output-1",
            )
            output_version = ArtifactVersion(
                "artifact-version:output-1", output_artifact.artifact_id, "doi:output",
                f"sha256:{'c' * 64}", "1", 0, None, "2026-07-10T00:00:00Z",
                "available", "reference",
            )
            log = graph.add_or_get_node(
                NodeType.ARTIFACT, "Run log", identity_scope="log-1", external_id="log-1",
                artifact_id=log_artifact.artifact_id, artifact_version_id=log_version.version_id,
                attributes={"lineageRole": "log"},
            )
            output = graph.add_or_get_node(
                NodeType.ARTIFACT, "Output", identity_scope="output-1", external_id="output-1",
                artifact_id=output_artifact.artifact_id, artifact_version_id=output_version.version_id,
                attributes={"lineageRole": "output"},
            )
            graph.attach_registry_records(artifact=log_artifact, artifact_version=log_version)
            graph.attach_registry_records(artifact=output_artifact, artifact_version=output_version)
            for used in (observation, software, environment):
                graph.add_edge(run.id, used.id, EdgeRel.USED)
            for generated in (finding, log, output):
                graph.add_edge(generated.id, run.id, EdgeRel.GENERATED_BY)

            metrics = all_metrics(graph)
            self.assertEqual(metrics["reproducible_finding_rate"], 1.0)
            self.assertEqual(
                metrics["metric_evidence"]["reproducible_finding_rate"],
                {"status": "available", "numerator": 1, "denominator": 1},
            )


if __name__ == "__main__":
    unittest.main()
