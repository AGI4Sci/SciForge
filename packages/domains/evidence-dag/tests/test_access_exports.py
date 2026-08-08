from __future__ import annotations

import hashlib
import http.client
import json
import os
import tempfile
import threading
import unittest
from dataclasses import replace
from http.server import ThreadingHTTPServer
from urllib.parse import quote

from evidence_dag.access import policy_restricted
from evidence_dag.server import Handler
from evidence_dag.service import Engine
from evidence_dag.snapshot import build_snapshot

from tests.test_access_projection import restricted_graph


TOKEN = "access-export-test-token"
SECRET_MARKERS = (
    "CANARY", "TOP-SECRET", "artifact:restricted",
    "artifact-version:restricted", "anchor:restricted", "restricted-thread",
)


def commit(engine: Engine, graph):
    snapshot = build_snapshot(graph, version=1, input_watermark="CANARY-watermark")
    graph.meta["snapshot"] = snapshot.to_dict()
    engine._graphs[graph.thread_id] = graph
    engine._snapshots[graph.thread_id] = snapshot
    engine._last_delta[graph.thread_id] = {
        "new_nodes": ["TOP-SECRET-NODE-ID"],
        "new_edges": ["TOP-SECRET-EDGE-ID"],
    }
    raw_scope = graph.meta.get("scope")
    raw_policy = raw_scope.get("accessPolicy") \
        if isinstance(raw_scope, dict) else raw_scope
    engine._updates[graph.thread_id] = {
        "id": "TOP-SECRET-UPDATE-ID",
        "state": "error",
        "reason": "CANARY private update reason",
        "priority": "P1",
        "desiredWatermark": "CANARY desired watermark",
        "error": {"message": "CANARY private compiler error"},
        "graphState": "failed",
        "accessPolicy": dict(raw_policy) if isinstance(raw_policy, dict) else raw_policy,
    }
    engine._event_store.append(
        "HumanReviewDecisionRecorded",
        aggregate_type="EvidenceThread",
        aggregate_id=graph.thread_id,
        idempotency_key=f"decision-{graph.thread_id}",
        payload={
            "threadId": graph.thread_id,
            "actor": "TOP-SECRET EVENT ACTOR",
            "rationale": "CANARY private event rationale",
            "reviewPacketId": "TOP-SECRET-REVIEW-ID",
        },
    )
    return snapshot


def make_public_graph():
    graph, conclusion_id = restricted_graph(scope_restricted=False)
    graph.thread_id = "public-thread"
    graph.meta["scope"]["accessPolicy"] = {"read": True}
    for artifact in graph.artifacts.values():
        artifact.access_policy = {"read": True}
    for version in graph.artifact_versions.values():
        version.availability = "available"
    graph.source_anchors = {
        anchor_id: replace(anchor, access_policy={"read": True})
        for anchor_id, anchor in graph.source_anchors.items()
    }
    return graph, conclusion_id


class PolicyMatrixTests(unittest.TestCase):
    def test_policy_parser_is_fail_closed_except_explicit_public_shapes(self):
        public = (
            None, "", {}, [], "public", "open", "unrestricted",
            {"read": True}, {"public": True}, {"visibility": "public"},
            {"read": {"allowed": True}},
            {
                "visibility": "workspace", "principals": [],
                "allowExport": False,
            },
            {
                "visibility": "public", "principals": [],
                "allowExport": True,
            },
        )
        restricted = (
            True, False, 1, ["alice"], "secret", {"unknown": "value"},
            {"allowedActors": ["alice"]}, {"allowedPrincipals": ["alice"]},
            {"roles": ["reviewer"]}, {"allowlist": ["alice"]},
            {"read": {"allowed": False}}, {"sensitivity": "secret"},
            {"read": True, "tenantAcl": ["alice"]},
            {"public": True, "roles": ["reviewer"]},
            {"read": {"allowed": True, "tenant": "private"}},
            {"public": True, "read": "allow"},
            {"public": True, "authorized": "yes"},
            {"read": {"allowed": True, "granted": "yes"}},
            {"read": True, "Read": False},
            {"visibility": 1},
            {"read": True, "tenantAcl": []},
            {"read": True, "roles": []},
            {"read": True, "unknown": None},
            {"public": True, "denied": None},
            {"public": True, "read": {}},
            {
                "visibility": "restricted", "principals": ["user:alice"],
                "allowExport": False,
            },
            {
                "visibility": "workspace", "principals": "user:alice",
                "allowExport": True,
            },
        )
        for value in public:
            with self.subTest(public=value):
                self.assertFalse(policy_restricted(value))
        for value in restricted:
            with self.subTest(restricted=value):
                self.assertTrue(policy_restricted(value))

    def test_invalid_scope_policy_types_restrict_graph_analysis_and_rerun(self):
        for policy in (True, 1, ["alice"], {"read": True, "tenantAcl": ["alice"]}):
            with self.subTest(policy=policy):
                engine = Engine()
                graph, conclusion_id = make_public_graph()
                graph.thread_id = f"invalid-policy-{type(policy).__name__}"
                graph.meta["scope"]["accessPolicy"] = policy
                snapshot = commit(engine, graph)
                rendered = json.dumps(engine.graph_view(graph.thread_id), ensure_ascii=False)
                self.assertNotIn("CANARY", rendered)
                with self.assertRaises(PermissionError):
                    engine.analysis(graph.thread_id)
                with self.assertRaises(PermissionError):
                    engine.rerun_spec(
                        graph.thread_id,
                        target_digest=snapshot.digest,
                        conclusion_id=conclusion_id,
                    )

    def test_unknown_artifact_availability_is_fail_closed(self):
        engine = Engine()
        graph, conclusion_id = make_public_graph()
        graph.thread_id = "invalid-artifact-availability"
        next(iter(graph.artifact_versions.values())).availability = \
            "CANARY-future-private-state"
        snapshot = commit(engine, graph)

        rendered = json.dumps(engine.graph_view(graph.thread_id), ensure_ascii=False)
        self.assertNotIn("CANARY", rendered)
        with self.assertRaises(PermissionError):
            engine.analysis(graph.thread_id)
        with self.assertRaises(PermissionError):
            engine.rerun_spec(
                graph.thread_id,
                target_digest=snapshot.digest,
                conclusion_id=conclusion_id,
            )

    def test_malformed_scope_and_legacy_status_policy_fail_closed(self):
        engine = Engine()
        graph, _conclusion_id = make_public_graph()
        graph.thread_id = "malformed-scope-thread"
        graph.meta["scope"] = ["CANARY invalid scope"]
        commit(engine, graph)
        rendered = json.dumps(engine.graph_view(graph.thread_id), ensure_ascii=False)
        self.assertNotIn("CANARY", rendered)
        with self.assertRaises(PermissionError):
            engine.analysis(graph.thread_id)

        status_only = Engine()
        status_only._updates["legacy-restricted-status"] = {
            "state": "error",
            "accessPolicy": ["CANARY legacy ACL"],
            "reason": "CANARY legacy reason",
            "error": {"message": "CANARY legacy failure"},
        }
        projected = status_only.update_status("legacy-restricted-status")
        self.assertTrue(projected["accessRestricted"])
        self.assertNotIn("CANARY", json.dumps(projected, ensure_ascii=False))


class EngineAccessExportTests(unittest.TestCase):
    def assert_clean(self, value) -> None:
        rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
        for marker in SECRET_MARKERS:
            self.assertNotIn(marker, rendered)

    def test_scope_and_component_restrictions_cover_every_read_model(self):
        for scope_restricted in (True, False):
            with self.subTest(scope_restricted=scope_restricted):
                engine = Engine()
                graph, conclusion_id = restricted_graph(scope_restricted=scope_restricted)
                graph.thread_id = (
                    "restricted-thread" if scope_restricted else "component-restricted-thread"
                )
                snapshot = commit(engine, graph)

                for operation in (
                    lambda: engine.analysis(graph.thread_id),
                    lambda: engine.reconcile(graph.thread_id),
                    lambda: engine.audit(
                        graph.thread_id, target_digest=snapshot.digest,
                    ),
                    lambda: engine.audit_runs(graph.thread_id),
                    lambda: engine.rerun_spec(
                        graph.thread_id, target_digest=snapshot.digest,
                        conclusion_id=conclusion_id,
                    ),
                    lambda: engine.compare_reruns(
                        graph.thread_id,
                        baseline_digest=snapshot.digest,
                        baseline_conclusion_id=conclusion_id,
                        candidate_digest=snapshot.digest,
                        candidate_conclusion_id=conclusion_id,
                    ),
                ):
                    with self.assertRaises(PermissionError):
                        operation()

                source = next(iter(graph.nodes.values()))
                safe_values = (
                    engine.graph_view(graph.thread_id),
                    engine.graph_summary(graph.thread_id),
                    engine.snapshot_view(graph.thread_id),
                    engine.provenance(graph.thread_id, conclusion_id),
                    engine.conclusion_lineage(
                        graph.thread_id, target_digest=snapshot.digest,
                        conclusion_id=conclusion_id,
                    ),
                    engine.export_prov_json(graph.thread_id),
                    engine.metrics(graph.thread_id),
                    engine.events(thread_id=graph.thread_id),
                    engine.update_status(graph.thread_id),
                    engine.last_delta(graph.thread_id),
                    engine.update_result_view(graph.thread_id, {
                        "snapshot": snapshot.to_dict(),
                        "delta": {
                            "new_nodes": ["TOP-SECRET-NODE-ID"],
                            "new_edges": ["TOP-SECRET-EDGE-ID"],
                        },
                        "verification": {
                            "status_changes": [{"node": "TOP-SECRET-NODE-ID"}],
                        },
                        "events": [{"payload": {"actor": "TOP-SECRET"}}],
                        "idempotent": False,
                    }),
                    engine.trusted_evidence_preview(
                        graph.thread_id,
                        snapshot_digest=snapshot.digest,
                        source_assertion_id=source.id,
                        artifact_version_id=source.artifact_version_id or "missing",
                        source_anchor_id=source.source_anchor_id or "missing",
                    ),
                )
                for value in safe_values:
                    self.assert_clean(value)
                self.assertNotIn(graph.thread_id, engine.list_threads_for_read())

    def test_public_graph_and_events_remain_unprojected(self):
        engine = Engine()
        graph, _conclusion_id = make_public_graph()
        snapshot = commit(engine, graph)
        self.assertEqual(engine.graph_view(graph.thread_id), graph.to_dict())
        self.assertEqual(engine.graph_summary(graph.thread_id), graph.summary())
        self.assertEqual(engine.snapshot_view(graph.thread_id), snapshot.to_dict())
        self.assertIn("CANARY", json.dumps(engine.analysis(graph.thread_id)))
        event = engine.events(thread_id=graph.thread_id)[0]
        self.assertEqual(event["payload"]["actor"], "TOP-SECRET EVENT ACTOR")
        self.assertEqual(
            engine.update_status(graph.thread_id)["reason"],
            "CANARY private update reason",
        )
        self.assertIn(graph.thread_id, engine.list_threads_for_read())

    def test_unowned_event_payload_is_fail_closed(self):
        engine = Engine()
        engine._event_store.append(
            "EvidenceUpdateQueued",
            aggregate_type="FutureAggregate",
            aggregate_id="CANARY-future-aggregate",
            idempotency_key="CANARY-future-event",
            payload={
                "actor": "TOP-SECRET EVENT ACTOR",
                "locator": "/CANARY/private/system/path",
            },
        )
        event = engine.events(event_types=["EvidenceUpdateQueued"])[0]
        self.assert_clean(event)
        self.assertTrue(event["accessRestricted"])
        self.assertNotIn("payload", event)

    def test_pending_restricted_update_overrides_a_public_committed_graph(self):
        engine = Engine()
        graph, _conclusion_id = make_public_graph()
        snapshot = commit(engine, graph)
        engine._updates[graph.thread_id].update({
            "accessPolicy": {"read": True, "tenantAcl": []},
            "reason": "CANARY restricted transition reason",
            "error": {"message": "TOP-SECRET restricted transition error"},
        })
        self.assert_clean(engine.update_status(graph.thread_id))

        projected = engine.update_result_view(graph.thread_id, {
            "update": {
                "accessPolicy": {"allowedActors": ["CANARY-private-actor"]},
                "reason": "CANARY restricted command reason",
            },
            "snapshot": snapshot.to_dict(),
            "delta": {
                "new_nodes": ["TOP-SECRET-NODE-ID"],
                "new_edges": ["TOP-SECRET-EDGE-ID"],
            },
            "idempotent": False,
        })
        self.assert_clean(projected)
        self.assertTrue(projected["accessRestricted"])

    def test_mutable_artifact_registry_commands_are_not_owned_by_evidence(self):
        engine = Engine()
        for command in (
            "register_artifact",
            "resolve_artifact",
            "resolve_artifacts",
            "confirm_artifact_rebind",
            "_registry",
        ):
            with self.subTest(command=command):
                self.assertFalse(hasattr(engine, command))


class HttpAccessExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.previous_engine = Handler.engine
        cls.previous_token = Handler.api_token
        cls.engine = Engine()
        cls.restricted: list[tuple[str, str, object]] = []
        for restricted_scope in (True, False):
            graph, conclusion_id = restricted_graph(scope_restricted=restricted_scope)
            graph.thread_id = "restricted-thread" if restricted_scope else "component-restricted-thread"
            snapshot = commit(cls.engine, graph)
            cls.restricted.append((graph.thread_id, conclusion_id, snapshot))
        public_graph, cls.public_conclusion = make_public_graph()
        cls.public_snapshot = commit(cls.engine, public_graph)
        Handler.engine = cls.engine
        Handler.api_token = TOKEN
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        Handler.engine = cls.previous_engine
        Handler.api_token = cls.previous_token

    def request(self, method: str, path: str, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
        connection.request(
            method, path,
            body=json.dumps(body) if body is not None else None,
            headers=headers,
        )
        response = connection.getresponse()
        value = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, value

    def assert_clean(self, value) -> None:
        rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
        for marker in SECRET_MARKERS:
            self.assertNotIn(marker, rendered)

    def test_restricted_http_reads_are_projected_or_denied(self):
        status, index = self.request("GET", "/threads")
        self.assertEqual(status, 200)
        self.assertEqual(index["data"]["threads"], ["public-thread"])
        for thread_id, conclusion_id, snapshot in self.restricted:
            encoded = quote(thread_id, safe="")
            graph = self.engine.require(thread_id)
            source = next(node for node in graph.nodes.values() if node.artifact_id)
            safe_paths = (
                f"/threads/{encoded}/graph",
                f"/threads/{encoded}/metrics",
                f"/threads/{encoded}/snapshot",
                f"/threads/{encoded}/provenance?node={quote(conclusion_id, safe='')}",
                f"/threads/{encoded}/conclusion-lineage?snapshotDigest={snapshot.digest}&conclusionId={quote(conclusion_id, safe='')}",
                f"/threads/{encoded}/prov-json",
                f"/events?threadId={quote(thread_id, safe='')}",
                f"/updates/status?threadId={quote(thread_id, safe='')}",
                f"/threads/{encoded}/evidence-preview?snapshotDigest={snapshot.digest}&sourceAssertionId={quote(source.id, safe='')}&artifactVersionId={quote(source.artifact_version_id or '', safe='')}&sourceAnchorId={quote(source.source_anchor_id or '', safe='')}",
            )
            for path in safe_paths:
                with self.subTest(path=path):
                    status, value = self.request("GET", path)
                    self.assertEqual(status, 200)
                    self.assert_clean(value)
            denied_paths = (
                f"/threads/{encoded}/analysis",
                f"/audits?threadId={quote(thread_id, safe='')}",
                f"/threads/{encoded}/rerun-spec?snapshotDigest={snapshot.digest}&conclusionId={quote(conclusion_id, safe='')}",
                f"/threads/{encoded}/rerun-compare?baselineDigest={snapshot.digest}&baselineConclusionId={quote(conclusion_id, safe='')}&candidateDigest={snapshot.digest}&candidateConclusionId={quote(conclusion_id, safe='')}",
            )
            for path in denied_paths:
                with self.subTest(path=path):
                    status, value = self.request("GET", path)
                    self.assertEqual(status, 403)
                    self.assert_clean(value)
            status, value = self.request("POST", f"/threads/{encoded}/reconcile", {})
            self.assertEqual(status, 403)
            self.assert_clean(value)
            status, value = self.request("POST", "/audits", {
                "threadId": thread_id,
                "targetDigest": snapshot.digest,
                "level": "L0",
            })
            self.assertEqual(status, 403)
            self.assert_clean(value)

    def test_public_http_analysis_preserves_content_and_identity(self):
        status, value = self.request("GET", "/threads/public-thread/analysis")
        self.assertEqual(status, 200)
        self.assertIn("CANARY", json.dumps(value))
        status, value = self.request("GET", "/threads/public-thread/graph")
        self.assertEqual(status, 200)
        self.assertEqual(value["data"]["summary"]["thread_id"], "public-thread")

    def test_mutable_artifact_registry_http_commands_are_retired(self):
        for path in (
            "/artifacts",
            "/artifacts/resolve",
            "/artifacts/artifact%3Alegacy/resolve",
            "/artifacts/artifact%3Alegacy/confirm-rebind",
        ):
            with self.subTest(path=path):
                status, value = self.request("POST", path, {})
                self.assertEqual(status, 404)
                self.assert_clean(value)


if __name__ == "__main__":
    unittest.main()
