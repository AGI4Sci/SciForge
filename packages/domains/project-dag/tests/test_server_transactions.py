"""Regression tests for Project DAG sidecar connection ownership."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from evidence_dag import provjson
from evidence_dag.snapshot import compute_snapshot_digest, snapshot_filename

from project_dag.contracts import digest_json
from project_dag.server import Handler, RuntimeActors


def _update_payload(project_key: str) -> dict:
    return {
        "projectKey": project_key,
        "evidenceVector": [],
        "capturedScope": {
            "includedSessions": [],
            "excludedSessions": [],
            "isolatedSessions": [],
        },
        "reason": "manual_immediate",
    }


def _restricted_http_snapshot(project_key: str) -> dict:
    payload = {
        "projectKey": project_key,
        "version": 1,
        "goalVersion": "goal:http-restricted",
        "policyVersion": 1,
        "evidenceVector": [],
        "excludedSessions": ["TOP-SECRET-EXCLUDED-SESSION"],
        "isolatedSessions": ["TOP-SECRET-ISOLATED-SESSION"],
        "compilerVersion": "project-compiler.v2",
        "createdAt": "2026-08-07T00:00:00Z",
        "status": "committed",
        "scope": {
            "accessPolicy": {"read": False},
            "workspace": "TOP-SECRET-PROJECT-SCOPE",
        },
        "graph": {
            "accessPolicy": {"classification": "restricted"},
            "scope": {
                "accessPolicy": {"visibility": "confidential"},
                "session": "TOP-SECRET-GRAPH-SCOPE",
            },
            "goals": [{
                "root_id": "goal:TOP-SECRET-GOAL-ID",
                "title": "TOP-SECRET-GOAL-TITLE",
                "description": "TOP-SECRET-GOAL-DESCRIPTION",
                "status": "active",
            }],
            "claims": [], "evidence": [], "entities": [], "edges": [], "origins": [],
            "humanReviews": [{
                "id": "review:TOP-SECRET-REVIEW-ID",
                "status": "pending",
                "rationale": "TOP-SECRET-REVIEW-RATIONALE",
            }],
            "reviewPackets": [{
                "id": "review-packet:TOP-SECRET-PACKET-ID",
                "status": "pending",
                "summary": "TOP-SECRET-REVIEW-PACKET",
            }],
            "decisions": [{
                "id": "decision:TOP-SECRET-DECISION-ID",
                "status": "approved",
                "rationale": "TOP-SECRET-DECISION-RATIONALE",
            }],
            "meta": {"debug": "TOP-SECRET-GRAPH-META"},
        },
        "assessments": [{
            "id": "assessment:TOP-SECRET-ASSESSMENT-ID",
            "status": "completed",
            "details": "TOP-SECRET-ASSESSMENT-DETAIL",
        }],
        "humanReview": {
            "gateStatus": "pending", "summary": "TOP-SECRET-HUMAN-REVIEW-SUMMARY",
        },
    }
    payload["digest"] = digest_json(payload, "project")
    return payload


def _downstream_restricted_http_snapshot(project_key: str) -> dict:
    payload = _restricted_http_snapshot(project_key)
    payload.pop("scope", None)
    payload["graph"].pop("accessPolicy", None)
    payload["graph"].pop("scope", None)
    payload["graph"]["claims"] = [{
        "id": "claim:TOP-SECRET-HTTP-DOWNSTREAM-CLAIM",
        "project_key": project_key,
        "statement": "TOP-SECRET-HTTP-DOWNSTREAM-STATEMENT",
        "status": "supported",
        "accessPolicy": {"read": False, "tenantAcl": ["TOP-SECRET-HTTP-TENANT"]},
    }]
    payload.pop("digest", None)
    payload["digest"] = digest_json(payload, "project")
    return payload


def _public_historical_http_snapshot(project_key: str, claim_id: str) -> dict:
    payload = {
        "projectKey": project_key,
        "version": 1,
        "goalVersion": "goal:http-public-history",
        "policyVersion": 1,
        "evidenceVector": [],
        "excludedSessions": [], "isolatedSessions": [],
        "compilerVersion": "project-compiler.v2",
        "createdAt": "2026-08-07T00:00:00Z",
        "status": "committed",
        "graph": {
            "goals": [],
            "claims": [{
                "id": claim_id, "project_key": project_key,
                "statement": "HTTP-REVOKED-HISTORICAL-CONTENT",
                "status": "supported",
            }],
            "evidence": [], "entities": [], "edges": [], "origins": [],
            "decisions": [], "humanReviews": [], "reviewPackets": [],
        },
        "assessments": [],
    }
    payload["digest"] = digest_json(payload, "project")
    return payload


def _write_restricted_http_evidence(session_dir: str, thread_id: str) -> str:
    header = {
        "threadId": thread_id,
        "version": 1,
        "digest": "sha256:" + "0" * 64,
        "inputWatermark": "TOP-SECRET-HTTP-PENDING-WATERMARK",
        "schemaVersion": "evidence.v2",
        "extractorVersion": "extractor.v2",
        "verifierVersion": "verifier.v2",
        "artifactDigests": [],
        "createdAt": "2026-08-07T00:00:00Z",
        "status": "committed",
    }
    document = {
        "prefix": {}, "entity": {}, "activity": {}, "agent": {},
        "used": {}, "wasGeneratedBy": {}, "wasDerivedFrom": {},
        "wasAssociatedWith": {}, "wasAttributedTo": {}, "wasInfluencedBy": {},
        "edag:meta": {
            "thread_id": thread_id,
            "scope": {
                "accessPolicy": {
                    "read": False,
                    "principals": ["TOP-SECRET-HTTP-PENDING-PRINCIPAL"],
                },
                "workspace": "TOP-SECRET-HTTP-PENDING-WORKSPACE",
            },
            "snapshot": header,
        },
        "edag:artifactRegistry": {
            "artifacts": [], "artifactVersions": [], "sourceAnchors": [],
        },
        "edag:assessments": [],
    }
    graph = provjson.from_prov_json(document)
    digest = compute_snapshot_digest(
        graph,
        input_watermark=header["inputWatermark"],
        schema_version=header["schemaVersion"],
        extractor_version=header["extractorVersion"],
        verifier_version=header["verifierVersion"],
    )
    header["digest"] = digest
    with open(os.path.join(session_dir, snapshot_filename(thread_id)), "w",
              encoding="utf-8") as handle:
        json.dump(document, handle)
    return digest


def _install_http_read_canaries(engine, project_key: str,
                                snapshot_digest: str) -> tuple[dict, str]:
    receipt = engine.workflow.enqueue_update(
        project_key=project_key,
        evidence_vector=[],
        captured_scope={
            "includedSessions": [],
            "excludedSessions": ["TOP-SECRET-HTTP-EXCLUDED"],
            "isolatedSessions": ["TOP-SECRET-HTTP-ISOLATED"],
        },
        reason="TOP-SECRET-HTTP-JOB-REASON",
    )
    timestamp = "2026-08-07T00:00:00Z"
    audit_id = "audit:TOP-SECRET-HTTP-AUDIT-ID"
    statements = [
        (
            "UPDATE project_update_job SET last_error=? WHERE id=?",
            ("TOP-SECRET-HTTP-JOB-ERROR", receipt["jobId"]),
        ),
        (
            "UPDATE project_update_receipt SET last_error=? WHERE job_id=?",
            ("TOP-SECRET-HTTP-RECEIPT-ERROR", receipt["jobId"]),
        ),
        (
            "INSERT INTO goal"
            " (id,root_id,parent_id,title,description,status,version,project_key,t_created)"
            " VALUES (?,?,?,?,?,'open',1,?,?)",
            (
                "goal-version:TOP-SECRET-HTTP-GOAL-VERSION",
                "goal:TOP-SECRET-HTTP-DATABASE-GOAL", None,
                "TOP-SECRET-HTTP-DATABASE-GOAL-TITLE",
                "TOP-SECRET-HTTP-DATABASE-GOAL-DESCRIPTION", project_key, timestamp,
            ),
        ),
        (
            "INSERT INTO finding"
            " (id,project_key,target_digest,finding_type,subject_id,policy_version,severity,"
            "status,details,created_at) VALUES (?,?,?,?,?,1,'critical','open',?,?)",
            (
                "finding:TOP-SECRET-HTTP-FINDING-ID", project_key, snapshot_digest,
                "TOP-SECRET-HTTP-FINDING-TYPE", "claim:TOP-SECRET-HTTP-SUBJECT",
                json.dumps({"reason": "TOP-SECRET-HTTP-FINDING-DETAIL"}), timestamp,
            ),
        ),
        (
            "INSERT INTO review"
            " (id,project_key,finding_id,subject_id,review_type,checkpoint,status,payload,"
            "created_at) VALUES (?,?,?,?,?,?,'open',?,?)",
            (
                "review:TOP-SECRET-HTTP-DATABASE-REVIEW", project_key,
                "finding:TOP-SECRET-HTTP-FINDING-ID", "claim:TOP-SECRET-HTTP-REVIEW-SUBJECT",
                "human_review_packet", "human",
                json.dumps({
                    "id": "review:TOP-SECRET-HTTP-DATABASE-REVIEW",
                    "snapshotDigest": snapshot_digest,
                    "status": "pending", "blocking": True,
                    "rationale": "TOP-SECRET-HTTP-REVIEW-PAYLOAD",
                }), timestamp,
            ),
        ),
        (
            "INSERT INTO assessment"
            " (id,project_key,target_id,dimension,level,result,actor,method,details,confidence,"
            "target_digest,created_at)"
            " VALUES (?,?,?,'integrity','A2','failed',?,?,?,0.1,?,?)",
            (
                "assessment:TOP-SECRET-HTTP-DATABASE-ASSESSMENT", project_key,
                "claim:TOP-SECRET-HTTP-ASSESSMENT-SUBJECT",
                "TOP-SECRET-HTTP-ASSESSMENT-ACTOR", "TOP-SECRET-HTTP-ASSESSMENT-METHOD",
                json.dumps({"reason": "TOP-SECRET-HTTP-ASSESSMENT-DETAIL"}),
                snapshot_digest, timestamp,
            ),
        ),
        (
            "INSERT INTO audit_run"
            " (id,request_key,project_key,target_digest,level,policy_version,reason,priority,lane,"
            "autonomy_mode,status,attempts,digest,created_at,updated_at,error)"
            " VALUES (?,?,?,?, 'L2',1,?,7,'P3','checkpointed','failed',2,?,?,?,?)",
            (
                audit_id, "request:TOP-SECRET-HTTP-AUDIT-REQUEST", project_key,
                snapshot_digest, "TOP-SECRET-HTTP-AUDIT-REASON",
                "audit-digest:TOP-SECRET-HTTP-AUDIT-DIGEST", timestamp, timestamp,
                "TOP-SECRET-HTTP-AUDIT-ERROR",
            ),
        ),
        (
            "INSERT INTO attention_frontier"
            " (project_key,snapshot_digest,subject_id,subject_type,score,factors,blocking,created_at)"
            " VALUES (?,?,?,?,0.99,?,1,?)",
            (
                project_key, snapshot_digest, "finding:TOP-SECRET-HTTP-ATTENTION-SUBJECT",
                "finding", json.dumps({"reason": "TOP-SECRET-HTTP-ATTENTION-FACTORS"}),
                timestamp,
            ),
        ),
    ]
    for statement, parameters in statements:
        engine.store.x(statement, parameters)
    engine.store.conn.commit()
    return receipt, audit_id


class RuntimeActorTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.actors = RuntimeActors.create(
            os.path.join(self.tmp.name, "project.db"), self.sessions)

    def tearDown(self) -> None:
        for engine in (self.actors.api, self.actors.update, self.actors.audit):
            engine.store.close()
        self.tmp.cleanup()

    def test_concurrent_runtime_actors_own_distinct_sqlite_connections(self) -> None:
        connections = {
            id(self.actors.api.store.conn),
            id(self.actors.update.store.conn),
            id(self.actors.audit.store.conn),
        }
        self.assertEqual(len(connections), 3)

        receipt = self.actors.api.enqueue_update(_update_payload("path:/workspace/a"))
        result = self.actors.update.process_updates("path:/workspace/a")

        self.assertIsNotNone(result)
        status = self.actors.api.update_receipt_status(
            receipt["jobId"],
            receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"],
        )
        self.assertEqual(status["state"], "committed")

    def test_enqueue_cannot_commit_the_update_workers_open_transaction(self) -> None:
        first_project = "path:/workspace/first"
        second_project = "path:/workspace/second"
        self.actors.api.enqueue_update(_update_payload(first_project))
        entered_commit = threading.Event()
        release_commit = threading.Event()
        enqueue_started = threading.Event()
        original_commit = self.actors.update.workflow._commit_project_snapshot
        errors: list[BaseException] = []

        def paused_commit(*args, **kwargs):
            self.assertTrue(self.actors.update.store.conn.in_transaction)
            entered_commit.set()
            self.assertTrue(release_commit.wait(2))
            return original_commit(*args, **kwargs)

        def capture(callable_, *args):
            try:
                callable_(*args)
            except BaseException as exc:  # noqa: BLE001 - test captures worker failures
                errors.append(exc)

        def enqueue_second_project():
            enqueue_started.set()
            self.actors.api.enqueue_update(_update_payload(second_project))

        with patch.object(
                self.actors.update.workflow,
                "_commit_project_snapshot",
                side_effect=paused_commit):
            worker = threading.Thread(
                target=capture,
                args=(self.actors.update.process_updates, first_project))
            worker.start()
            self.assertTrue(entered_commit.wait(2))
            enqueue = threading.Thread(
                target=capture,
                args=(enqueue_second_project,))
            enqueue.start()
            self.assertTrue(enqueue_started.wait(2))
            self.assertTrue(self.actors.update.store.conn.in_transaction)
            release_commit.set()
            worker.join(3)
            enqueue.join(3)

        self.assertFalse(worker.is_alive())
        self.assertFalse(enqueue.is_alive())
        self.assertEqual(errors, [])
        self.assertIsNotNone(
            self.actors.update.workflow.latest_snapshot(first_project))
        self.assertEqual(
            self.actors.api.update_status(second_project)["state"], "pending")

    def test_enqueue_during_atomic_claim_preserves_both_receipt_generations(self) -> None:
        project = "path:/workspace/generation-race"
        first = self.actors.api.enqueue_update(_update_payload(project))
        selected = threading.Event()
        release_claim = threading.Event()
        enqueue_started = threading.Event()
        enqueue_finished = threading.Event()
        original_q1 = self.actors.update.store.q1
        compiler = self.actors.update.workflow.compiler
        original_compile = compiler.compile_transaction
        paused = False
        errors: list[BaseException] = []
        second_receipts: list[dict] = []

        def pause_after_select(sql, args=()):
            nonlocal paused
            row = original_q1(sql, args)
            if not paused and "SELECT * FROM project_update_job WHERE" in sql:
                paused = True
                self.assertTrue(self.actors.update.store.conn.in_transaction)
                selected.set()
                self.assertTrue(release_claim.wait(2))
            return row

        @contextmanager
        def compile_after_enqueue(*args, **kwargs):
            self.assertTrue(enqueue_finished.wait(2))
            with original_compile(*args, **kwargs) as result:
                yield result

        def process() -> None:
            try:
                self.actors.update.process_updates(project)
            except BaseException as exc:  # noqa: BLE001 - test captures worker failures
                errors.append(exc)

        def enqueue_new_generation() -> None:
            enqueue_started.set()
            try:
                payload = {**_update_payload(project), "autonomyMode": "autonomous"}
                second_receipts.append(self.actors.api.enqueue_update(payload))
            except BaseException as exc:  # noqa: BLE001 - test captures API failures
                errors.append(exc)
            finally:
                enqueue_finished.set()

        with patch.object(self.actors.update.store, "q1", side_effect=pause_after_select), \
                patch.object(
                    compiler, "compile_transaction", side_effect=compile_after_enqueue):
            worker = threading.Thread(target=process)
            worker.start()
            self.assertTrue(selected.wait(2))
            enqueue = threading.Thread(target=enqueue_new_generation)
            enqueue.start()
            self.assertTrue(enqueue_started.wait(2))
            release_claim.set()
            enqueue.join(3)
            worker.join(3)

        self.assertEqual(errors, [])
        self.assertEqual(len(second_receipts), 1)
        second = second_receipts[0]
        self.assertEqual(second["jobId"], first["jobId"])
        self.assertEqual(
            second["acceptedRequestVersion"],
            first["acceptedRequestVersion"] + 1,
        )
        first_status = self.actors.api.update_receipt_status(
            first["jobId"],
            first["acceptedRequestVersion"],
            first["desiredFingerprint"],
        )
        second_status = self.actors.api.update_receipt_status(
            second["jobId"],
            second["acceptedRequestVersion"],
            second["desiredFingerprint"],
        )
        self.assertEqual(first_status["state"], "committed")
        self.assertEqual(second_status["state"], "queued")
        self.assertEqual(
            self.actors.api.workflow.job(first["jobId"])["processing_version"],
            first["acceptedRequestVersion"],
        )

    def test_audit_selection_and_claim_share_one_explicit_transaction(self) -> None:
        project = "path:/workspace/audit-claim"
        self.actors.api.enqueue_update(_update_payload(project))
        self.assertIsNotNone(self.actors.update.process_updates(project))
        original_q1 = self.actors.audit.store.q1
        observed_claim_transaction: list[bool] = []

        def observe_claim(sql, args=()):
            if "SELECT id FROM project_update_job WHERE" in sql:
                observed_claim_transaction.append(
                    self.actors.audit.store.conn.in_transaction)
            return original_q1(sql, args)

        with patch.object(self.actors.audit.store, "q1", side_effect=observe_claim):
            result = self.actors.audit.process_audits(project)

        self.assertIsNotNone(result)
        self.assertEqual(observed_claim_transaction, [True, True])


class HttpActorSerializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.actors = RuntimeActors.create(
            os.path.join(self.tmp.name, "project.db"), self.sessions)
        self.previous_engine = Handler.engine
        self.previous_token = Handler.api_token
        Handler.engine = self.actors.api
        Handler.api_token = "test-token"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server_thread = threading.Thread(
            target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(2)
        Handler.engine = self.previous_engine
        Handler.api_token = self.previous_token
        for engine in (self.actors.api, self.actors.update, self.actors.audit):
            engine.store.close()
        self.tmp.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        # Project routing is workspace-bound. Keep the historical fixtures
        # readable while sending the explicit canonical root required by the
        # HTTP contract.
        if body is not None and isinstance(body.get("projectKey"), str):
            key = body["projectKey"]
            if key.startswith("path:") and "workspaceRoot" not in body:
                body = {**body, "workspaceRoot": key[5:]}
        if "projectKey=path:" in path and "workspaceRoot=" not in path:
            marker = "projectKey=path:"
            start = path.index(marker) + len(marker)
            end = len(path)
            for separator in ("&", "#"):
                if separator in path[start:]:
                    end = min(end, start + path[start:].index(separator))
            root = path[start:end]
            path = path.replace("?", f"?workspaceRoot=/{root.lstrip('/')}&", 1)
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            method=method,
            data=data,
            headers={
                "Authorization": "Bearer test-token",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read())

    def _request_raw(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            method=method,
            data=data,
            headers={
                "Authorization": "Bearer test-token",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_http_project_identity_requires_workspace_and_rejects_forgery(self) -> None:
        status, response = self._request_raw(
            "GET", "/updates/status?projectKey=project:another-workspace")
        self.assertEqual(status, 400)
        self.assertEqual(response["error"]["code"], "BAD_REQUEST")

        status, response = self._request_raw(
            "GET", "/updates/status?workspaceRoot=/workspace/a&projectRoot=/workspace/b")
        self.assertEqual(status, 400)
        self.assertIn("same workspace", response["error"]["message"])

        status, response = self._request_raw(
            "GET", "/updates/status?workspaceRoot=/workspace/a&projectKey=path:/workspace/b")
        self.assertEqual(status, 400)
        self.assertIn("does not match", response["error"]["message"])

        status, response = self._request_raw(
            "GET", "/updates/status?workspaceRoot=/workspace/a&projectKey=/workspace/a")
        self.assertEqual(status, 400)
        self.assertIn("canonical path", response["error"]["message"])

        status, response = self._request_raw(
            "GET", "/updates/status?projectKey=path:/workspace/a")
        self.assertEqual(status, 400)
        self.assertIn("canonical workspaceRoot", response["error"]["message"])

    def test_threaded_http_enqueue_and_status_are_serialized_on_api_connection(self) -> None:
        project = "path:/workspace/http"
        entered_enqueue = threading.Event()
        release_enqueue = threading.Event()
        entered_status = threading.Event()
        original_enqueue = self.actors.api.enqueue_update
        original_status = self.actors.api.update_status
        responses: list[dict] = []
        errors: list[BaseException] = []
        status_request_started = threading.Event()

        def paused_enqueue(payload, *, actor="runtime"):
            entered_enqueue.set()
            self.assertTrue(release_enqueue.wait(2))
            return original_enqueue(payload, actor=actor)

        def observed_status(project_key):
            entered_status.set()
            return original_status(project_key)

        def capture(callable_, *args):
            try:
                responses.append(callable_(*args))
            except BaseException as exc:  # noqa: BLE001 - test captures request failures
                errors.append(exc)

        def request_status():
            status_request_started.set()
            return self._request(
                "GET", f"/updates/status?projectKey={project}")

        with patch.object(self.actors.api, "enqueue_update", side_effect=paused_enqueue), \
                patch.object(self.actors.api, "update_status", side_effect=observed_status):
            enqueue = threading.Thread(
                target=capture,
                args=(self._request, "POST", "/updates", _update_payload(project)))
            enqueue.start()
            self.assertTrue(entered_enqueue.wait(2))
            status = threading.Thread(
                target=capture,
                args=(request_status,))
            status.start()
            self.assertTrue(status_request_started.wait(2))
            self.assertFalse(entered_status.wait(0.05))
            self.assertFalse(entered_status.is_set())
            release_enqueue.set()
            enqueue.join(3)
            status.join(3)

        self.assertFalse(enqueue.is_alive())
        self.assertFalse(status.is_alive())
        self.assertTrue(entered_status.is_set())
        self.assertEqual(errors, [])
        self.assertEqual(len(responses), 2)
        self.assertTrue(all(response["ok"] for response in responses))

    def test_http_project_reads_fail_closed_for_globally_restricted_empty_graph(self) -> None:
        project = "path:/workspace/http-restricted"
        snapshot = _restricted_http_snapshot(project)
        self.actors.api.store.x(
            "INSERT INTO project_snapshot"
            " (project_key,version,digest,goal_version,policy_version,evidence_vector,"
            "excluded_sessions,isolated_sessions,compiler_version,created_at,status,payload)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (
                project, 1, snapshot["digest"], snapshot["goalVersion"],
                snapshot["policyVersion"], json.dumps(snapshot["evidenceVector"]),
                json.dumps(snapshot["excludedSessions"]),
                json.dumps(snapshot["isolatedSessions"]), snapshot["compilerVersion"],
                snapshot["createdAt"], json.dumps(snapshot),
            ),
        )
        packet = {
            "id": "review-packet:TOP-SECRET-HTTP-PACKET-ID",
            "snapshotDigest": snapshot["digest"],
            "status": "pending",
            "blocking": True,
            "summary": "TOP-SECRET-HTTP-REVIEW-PACKET",
        }
        self.actors.api.store.x(
            "INSERT INTO review"
            " (id,project_key,subject_id,review_type,checkpoint,status,payload,created_at)"
            " VALUES (?,?,?,'human_review_packet','release','open',?,?)",
            (
                packet["id"], project, "project:TOP-SECRET-HTTP-SUBJECT",
                json.dumps(packet), snapshot["createdAt"],
            ),
        )
        self.actors.api.store.conn.commit()
        receipt, audit_id = _install_http_read_canaries(
            self.actors.api, project, snapshot["digest"])

        suffix = f"?projectKey={project}"
        receipt_suffix = (
            "?workspaceRoot=/workspace/http-restricted"
            f"&acceptedRequestVersion={receipt['acceptedRequestVersion']}"
            f"&desiredFingerprint={receipt['desiredFingerprint']}"
        )
        responses = {
            "graph": self._request("GET", f"/graph{suffix}"),
            "claims": self._request("GET", f"/claims{suffix}"),
            "latest": self._request("GET", f"/snapshots/latest{suffix}"),
            "snapshot": self._request(
                "GET", f"/snapshots/{snapshot['digest']}{suffix}"),
            "status": self._request("GET", f"/updates/status{suffix}"),
            "history": self._request("GET", f"/updates/history{suffix}"),
            "receipt": self._request(
                "GET", f"/updates/{receipt['jobId']}/status{receipt_suffix}"),
            "goals": self._request("GET", f"/goals{suffix}"),
            "analysis": self._request("GET", f"/analysis{suffix}"),
            "findings": self._request("GET", f"/findings{suffix}"),
            "reviews": self._request("GET", f"/reviews{suffix}"),
            "attention": self._request(
                "GET", f"/attention{suffix}&snapshotDigest={snapshot['digest']}"),
            "assessments": self._request(
                "GET", f"/assessments{suffix}&snapshotDigest={snapshot['digest']}"),
            "audits": self._request("GET", f"/audits{suffix}"),
            "audit": self._request(
                "GET", f"/audits/{audit_id}?workspaceRoot=/workspace/http-restricted"),
        }
        serialized = json.dumps(responses, ensure_ascii=False)
        self.assertNotIn("TOP-SECRET", serialized)
        self.assertNotIn("title", serialized)
        self.assertNotIn("description", serialized)
        self.assertEqual(responses["claims"]["data"], [])
        self.assertTrue(responses["graph"]["data"]["access"]["redacted"])
        self.assertTrue(responses["latest"]["data"]["access"]["redacted"])
        self.assertTrue(responses["snapshot"]["data"]["access"]["redacted"])
        self.assertTrue(responses["status"]["data"]["access"]["redacted"])
        self.assertTrue(responses["analysis"]["data"]["access"]["redacted"])
        self.assertNotIn(
            "projectKey", responses["status"]["data"]["committedSnapshot"])
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for name in (
            "history", "goals", "findings", "reviews", "attention",
            "assessments", "audits",
        ):
            self.assertTrue(responses[name]["data"])
            for item in responses[name]["data"]:
                self.assertTrue(set(item).issubset(safe_ref_fields))
                self.assertEqual(item["accessLevel"], "restricted")
        for name in ("receipt", "audit"):
            item = responses[name]["data"]
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")
        for item in responses["status"]["data"]["jobs"]:
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")

    def test_http_current_restriction_revokes_three_historical_routes(self) -> None:
        project = "path:/workspace/http-revoked-history"
        claim_id = "claim:http-revoked-history"
        old = _public_historical_http_snapshot(project, claim_id)
        latest = _restricted_http_snapshot(project)
        latest["version"] = 2
        latest["createdAt"] = "2026-08-07T00:00:01Z"
        latest.pop("digest", None)
        latest["digest"] = digest_json(latest, "project")
        for snapshot in (old, latest):
            self.actors.api.store.x(
                "INSERT INTO project_snapshot"
                " (project_key,version,digest,goal_version,policy_version,evidence_vector,"
                "excluded_sessions,isolated_sessions,compiler_version,created_at,status,payload)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
                (
                    project, snapshot["version"], snapshot["digest"],
                    snapshot["goalVersion"], snapshot["policyVersion"],
                    json.dumps(snapshot["evidenceVector"]),
                    json.dumps(snapshot["excludedSessions"]),
                    json.dumps(snapshot["isolatedSessions"]),
                    snapshot["compilerVersion"], snapshot["createdAt"],
                    json.dumps(snapshot),
                ),
            )
        self.actors.api.store.conn.commit()
        suffix = f"projectKey={project}"
        responses = {
            "snapshot": self._request(
                "GET", f"/snapshots/{old['digest']}?{suffix}"),
            "claim": self._request(
                "GET", f"/claims/{claim_id}?{suffix}&snapshot={old['digest']}"),
            "provenance": self._request(
                "GET", f"/provenance/{claim_id}?{suffix}&snapshotDigest={old['digest']}"),
        }
        serialized = json.dumps(responses, ensure_ascii=False)
        self.assertNotIn("HTTP-REVOKED-HISTORICAL-CONTENT", serialized)
        self.assertNotIn("TOP-SECRET", serialized)
        self.assertTrue(responses["snapshot"]["data"]["access"]["redacted"])
        self.assertTrue(
            responses["claim"]["data"]["provenance"]["access"]["redacted"])
        self.assertTrue(responses["provenance"]["data"]["access"]["redacted"])

    def test_http_first_restricted_update_projects_precommit_readbacks(self) -> None:
        project = "path:/workspace/http-pending-restricted"
        thread_id = "TOP-SECRET-HTTP-PENDING-THREAD"
        evidence_digest = _write_restricted_http_evidence(self.sessions, thread_id)
        enqueue = self._request("POST", "/updates", {
            "projectKey": project,
            "evidenceVector": [{"threadId": thread_id, "digest": evidence_digest}],
            "capturedScope": {
                "includedSessions": [thread_id],
                "excludedSessions": ["TOP-SECRET-HTTP-PENDING-EXCLUDED"],
                "isolatedSessions": ["TOP-SECRET-HTTP-PENDING-ISOLATED"],
            },
            "reason": "TOP-SECRET-HTTP-PENDING-REASON",
        })
        receipt_row = self.actors.api.store.q1(
            "SELECT job_id,request_version,desired_fingerprint"
            " FROM project_update_receipt WHERE project_key=?",
            (project,),
        )
        suffix = f"?projectKey={project}"
        responses = {
            "enqueue": enqueue,
            "status": self._request("GET", f"/updates/status{suffix}"),
            "history": self._request("GET", f"/updates/history{suffix}"),
            "graph": self._request("GET", f"/graph{suffix}"),
            "analysis": self._request("GET", f"/analysis{suffix}"),
            "receipt": self._request(
                "GET", f"/updates/{receipt_row['job_id']}/status"
                f"?acceptedRequestVersion={receipt_row['request_version']}"
                f"&desiredFingerprint={receipt_row['desired_fingerprint']}"
                "&workspaceRoot=/workspace/http-pending-restricted"),
            "mutation": self._request("POST", "/goals/draft", {
                "projectKey": project,
                "title": "TOP-SECRET-HTTP-PENDING-GOAL",
                "description": "TOP-SECRET-HTTP-PENDING-GOAL-DESCRIPTION",
            }),
        }
        serialized = json.dumps(responses, ensure_ascii=False)
        self.assertNotIn("TOP-SECRET-HTTP-PENDING", serialized)
        self.assertTrue(responses["status"]["data"]["access"]["redacted"])
        self.assertTrue(responses["graph"]["data"]["access"]["redacted"])
        self.assertTrue(responses["analysis"]["data"]["access"]["redacted"])
        self.assertNotIn(
            "threadId", responses["status"]["data"]["desiredEvidenceVector"][0])
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for name in ("enqueue", "receipt", "mutation"):
            item = responses[name]["data"]
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")
        for item in responses["history"]["data"]:
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")

    def test_http_side_reads_close_over_downstream_restricted_claims(self) -> None:
        project = "path:/workspace/http-downstream-restricted"
        snapshot = _downstream_restricted_http_snapshot(project)
        self.actors.api.store.x(
            "INSERT INTO project_snapshot"
            " (project_key,version,digest,goal_version,policy_version,evidence_vector,"
            "excluded_sessions,isolated_sessions,compiler_version,created_at,status,payload)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (
                project, 1, snapshot["digest"], snapshot["goalVersion"],
                snapshot["policyVersion"], json.dumps(snapshot["evidenceVector"]),
                json.dumps(snapshot["excludedSessions"]),
                json.dumps(snapshot["isolatedSessions"]), snapshot["compilerVersion"],
                snapshot["createdAt"], json.dumps(snapshot),
            ),
        )
        self.actors.api.store.conn.commit()
        receipt, audit_id = _install_http_read_canaries(
            self.actors.api, project, snapshot["digest"])
        suffix = f"?projectKey={project}"
        receipt_suffix = (
            "?workspaceRoot=/workspace/http-downstream-restricted"
            f"&acceptedRequestVersion={receipt['acceptedRequestVersion']}"
            f"&desiredFingerprint={receipt['desiredFingerprint']}"
        )
        responses = {
            "status": self._request("GET", f"/updates/status{suffix}"),
            "history": self._request("GET", f"/updates/history{suffix}"),
            "receipt": self._request(
                "GET", f"/updates/{receipt['jobId']}/status{receipt_suffix}"),
            "goals": self._request("GET", f"/goals{suffix}"),
            "analysis": self._request("GET", f"/analysis{suffix}"),
            "findings": self._request("GET", f"/findings{suffix}"),
            "reviews": self._request("GET", f"/reviews{suffix}"),
            "attention": self._request(
                "GET", f"/attention{suffix}&snapshotDigest={snapshot['digest']}"),
            "assessments": self._request(
                "GET", f"/assessments{suffix}&snapshotDigest={snapshot['digest']}"),
            "audits": self._request("GET", f"/audits{suffix}"),
            "audit": self._request(
                "GET", f"/audits/{audit_id}?workspaceRoot=/workspace/http-downstream-restricted"),
        }
        serialized = json.dumps(responses, ensure_ascii=False)
        self.assertNotIn("TOP-SECRET", serialized)
        self.assertNotIn(project, serialized)
        self.assertTrue(responses["status"]["data"]["access"]["redacted"])
        self.assertTrue(responses["analysis"]["data"]["access"]["redacted"])
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for name in (
            "history", "goals", "findings", "reviews", "attention",
            "assessments", "audits",
        ):
            self.assertTrue(responses[name]["data"])
            for item in responses[name]["data"]:
                self.assertTrue(set(item).issubset(safe_ref_fields))
        for name in ("receipt", "audit"):
            item = responses[name]["data"]
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
