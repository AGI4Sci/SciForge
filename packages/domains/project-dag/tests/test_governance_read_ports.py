"""Read-only governance record ports: decisions, approvals, releases."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from project_dag.contracts import digest_json
from project_dag.server import Handler, RuntimeActors

TIMESTAMP = "2026-10-26T00:00:00Z"


def _insert_snapshot(engine, project: str, *,
                     restricted: bool = False) -> str:
    payload = {
        "projectKey": project,
        "version": 1,
        "goalVersion": "goal:governance-read-ports",
        "policyVersion": 1,
        "evidenceVector": [],
        "excludedSessions": [],
        "isolatedSessions": [],
        "compilerVersion": "project-compiler.v2",
        "createdAt": TIMESTAMP,
        "status": "committed",
        "graph": {"goals": [], "claims": [], "evidence": [], "entities": [],
                  "edges": [], "origins": [], "humanReviews": [],
                  "reviewPackets": [], "decisions": []},
        "assessments": [],
        "humanReview": {"gateStatus": "not_needed"},
    }
    if restricted:
        payload["scope"] = {"accessPolicy": {"read": False},
                            "workspace": "RESTRICTED-WORKSPACE"}
    payload["digest"] = digest_json(payload, "project")
    engine.store.x(
        "INSERT INTO project_snapshot"
        " (project_key,version,digest,goal_version,policy_version,evidence_vector,"
        "excluded_sessions,isolated_sessions,compiler_version,created_at,status,payload)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
        (project, 1, payload["digest"], payload["goalVersion"],
         payload["policyVersion"], json.dumps(payload["evidenceVector"]),
         json.dumps(payload["excludedSessions"]),
         json.dumps(payload["isolatedSessions"]), payload["compilerVersion"],
         TIMESTAMP, json.dumps(payload)),
    )
    engine.store.conn.commit()
    return payload["digest"]


def _insert_decision(engine, project: str, decision_id: str, created_at: str,
                     *, target: str = "", supersedes_id: str | None = None) -> None:
    engine.store.x(
        "INSERT INTO decision_event"
        " (id,project_key,review_id,finding_id,action,decided_by,agent_id,"
        "autonomy_mode,rationale,alternatives,evidence_digest,confidence,reversibility,"
        "supersedes_id,action_class,target,policy_ref,created_at)"
        " VALUES (?,?,NULL,NULL,'endorse','agent','agent-1','checkpointed',?,?,?,0.9,"
        "'reversible',?,?,?,?,?)",
        (decision_id, project,
         f"rationale for {decision_id}",
         json.dumps([f"alternative for {decision_id}"]),
         f"sha256:{decision_id.removeprefix('decision:').zfill(64)[:64]}",
         supersedes_id, "draft_internal_reversible", target,
         "decision-policy/v1", created_at),
    )
    engine.store.conn.commit()


def _insert_approval(engine, project: str, approval_id: str, decision_id: str,
                     snapshot_digest: str, created_at: str, *,
                     expires_at: str | None = None,
                     revokes_approval_id: str | None = None) -> None:
    engine.store.x(
        "INSERT INTO approval_record"
        " (id,project_key,decision_id,project_snapshot_digest,attestor,"
        "trusted_role_assertion_ref,attestation,policy_ref,created_at,expires_at,"
        "revokes_approval_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (approval_id, project, decision_id, snapshot_digest, "reviewer-1",
         None, f"attestation for {approval_id}", "decision-policy/v1",
         created_at, expires_at, revokes_approval_id),
    )
    engine.store.conn.commit()


def _insert_release(engine, project: str, release_id: str, snapshot_digest: str,
                    created_at: str) -> None:
    engine.store.x(
        "INSERT INTO release_record"
        " (id,project_key,project_snapshot_digest,evidence_vector,audit_run_digest,"
        "policy_version,critical_findings,overrides,created_by,created_at,"
        "output_artifacts,certification_status,classification,target,attempt_outcome,"
        "audit_refs,decision_refs,approval_refs)"
        " VALUES (?,?,?,'[]',?,1,'[]','[]','creator-1',?,?,'candidate','internal',"
        "'manuscript','accepted',?,?,?)",
        (release_id, project, snapshot_digest,
         f"audit-digest:{release_id}", created_at,
         json.dumps([{"versionId": f"artifact-version:{release_id}",
                      "contentDigest": f"sha256:{'ab12' * 16}",
                      "artifactId": f"artifact:{release_id}",
                      "mediaType": "application/pdf"}]),
         json.dumps([f"audit-digest:{release_id}"]),
         json.dumps([f"decision:{release_id}"]),
         json.dumps([f"approval:{release_id}"])),
    )
    engine.store.conn.commit()


class GovernanceReadPortTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.sessions = os.path.join(self.root, "threads")
        os.makedirs(self.sessions)
        self.actors = RuntimeActors.create(
            os.path.join(self.root, "project.db"), self.sessions)
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

    def _request(self, path: str) -> dict:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            headers={"Authorization": "Bearer test-token"},
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read())

    def _request_raw(self, path: str) -> tuple[int, dict]:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            headers={"Authorization": "Bearer test-token"},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_decisions_page_newest_first_with_stable_cursor_walk(self) -> None:
        project = "path:/workspace/decisions"
        _insert_snapshot(self.actors.api, project)
        for index in range(5):
            _insert_decision(
                self.actors.api, project, f"decision:{index}",
                f"2026-10-26T00:00:0{index}Z",
                target=f"target-{index}" if index % 2 == 0 else "",
                supersedes_id=f"decision:{index - 1}" if index else None)

        first = self._request(
            f"/decisions?workspaceRoot=/workspace/decisions&limit=2")
        self.assertTrue(first["ok"])
        self.assertEqual(
            [r["decisionId"] for r in first["data"]["records"]],
            ["decision:4", "decision:3"])
        self.assertEqual(first["data"]["nextCursor"], "decision:3")
        newest = first["data"]["records"][0]
        self.assertEqual(newest["projectSnapshot"], f"sha256:{'4'.zfill(64)}")
        self.assertEqual(newest["actionClass"], "draft_internal_reversible")
        self.assertEqual(newest["actor"], {"type": "agent", "id": "agent-1"})
        self.assertEqual(newest["alternatives"], ["alternative for decision:4"])
        self.assertEqual(newest["reversibility"], "reversible")
        self.assertEqual(newest["policyRef"], "decision-policy/v1")
        self.assertEqual(newest["createdAt"], "2026-10-26T00:00:04Z")
        self.assertNotIn("project_key", newest)
        self.assertNotIn("created_at", newest)

        second = self._request(
            f"/decisions?workspaceRoot=/workspace/decisions&limit=2"
            f"&cursor={first['data']['nextCursor']}")
        self.assertEqual(
            [r["decisionId"] for r in second["data"]["records"]],
            ["decision:2", "decision:1"])
        self.assertEqual(second["data"]["nextCursor"], "decision:1")

        third = self._request(
            f"/decisions?workspaceRoot=/workspace/decisions&limit=2"
            f"&cursor={second['data']['nextCursor']}")
        self.assertEqual([r["decisionId"] for r in third["data"]["records"]],
                         ["decision:0"])
        self.assertIsNone(third["data"]["nextCursor"])
        self.assertNotIn("supersedesDecisionId", third["data"]["records"][0])

    def test_decision_target_and_supersession_fields_are_optional(self) -> None:
        project = "path:/workspace/decision-shape"
        _insert_snapshot(self.actors.api, project)
        _insert_decision(self.actors.api, project, "decision:plain",
                         "2026-10-26T00:00:00Z")
        _insert_decision(self.actors.api, project, "decision:rich",
                         "2026-10-26T00:00:01Z", target="manuscript",
                         supersedes_id="decision:plain")
        page = self._request(
            "/decisions?workspaceRoot=/workspace/decision-shape&limit=1")
        self.assertEqual(page["data"]["records"][0]["decisionId"], "decision:rich")
        self.assertEqual(page["data"]["records"][0]["target"], "manuscript")
        self.assertEqual(page["data"]["records"][0]["supersedesDecisionId"],
                         "decision:plain")
        tail = self._request(
            "/decisions?workspaceRoot=/workspace/decision-shape&limit=1"
            f"&cursor={page['data']['nextCursor']}")
        plain = tail["data"]["records"][0]
        self.assertNotIn("target", plain)
        self.assertNotIn("supersedesDecisionId", plain)

    def test_limit_is_capped_at_five_hundred(self) -> None:
        project = "path:/workspace/decision-cap"
        _insert_snapshot(self.actors.api, project)
        for index in range(505):
            _insert_decision(self.actors.api, project, f"decision:{index:04d}",
                             f"2026-10-26T00:{index // 60:02d}:{index % 60:02d}Z")
        page = self._request(
            "/decisions?workspaceRoot=/workspace/decision-cap&limit=1000")
        self.assertEqual(len(page["data"]["records"]), 500)
        self.assertIsNotNone(page["data"]["nextCursor"])

    def test_unknown_cursor_is_a_bad_request(self) -> None:
        project = "path:/workspace/decision-cursor"
        _insert_snapshot(self.actors.api, project)
        status, body = self._request_raw(
            "/decisions?workspaceRoot=/workspace/decision-cursor"
            "&cursor=decision:missing")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "BAD_REQUEST")

    def test_empty_project_returns_one_empty_page(self) -> None:
        project = "path:/workspace/empty-ports"
        _insert_snapshot(self.actors.api, project)
        for route in ("decisions", "approvals", "releases"):
            page = self._request(f"/{route}?workspaceRoot=/workspace/empty-ports")
            self.assertEqual(page["data"], {"records": [], "nextCursor": None})

    def test_approvals_expose_canonical_status(self) -> None:
        project = "path:/workspace/approvals"
        snapshot_digest = _insert_snapshot(self.actors.api, project)
        _insert_decision(self.actors.api, project, "decision:base",
                         "2026-10-26T00:00:00Z")
        _insert_approval(self.actors.api, project, "approval:one",
                         "decision:base", snapshot_digest,
                         "2026-10-26T00:00:01Z")
        _insert_approval(self.actors.api, project, "approval:two",
                         "decision:base", snapshot_digest,
                         "2026-10-26T00:00:02Z",
                         revokes_approval_id="approval:one")

        page = self._request(
            "/approvals?workspaceRoot=/workspace/approvals&limit=1")
        self.assertEqual(page["data"]["records"][0]["approvalId"], "approval:two")
        self.assertEqual(page["data"]["records"][0]["status"], "effective")
        self.assertEqual(page["data"]["records"][0]["decisionRef"], "decision:base")
        self.assertEqual(page["data"]["records"][0]["projectSnapshot"],
                         snapshot_digest)
        self.assertNotIn("project_key", page["data"]["records"][0])

        tail = self._request(
            "/approvals?workspaceRoot=/workspace/approvals&limit=1"
            f"&cursor={page['data']['nextCursor']}")
        revoked = tail["data"]["records"][0]
        self.assertEqual(revoked["approvalId"], "approval:one")
        self.assertEqual(revoked["status"], "revoked")
        self.assertNotIn("revokesApprovalId", revoked)
        self.assertIsNone(tail["data"]["nextCursor"])

    def test_releases_normalize_output_artifact_refs(self) -> None:
        project = "path:/workspace/releases"
        snapshot_digest = _insert_snapshot(self.actors.api, project)
        _insert_release(self.actors.api, project, "release:one",
                        snapshot_digest, "2026-10-26T00:00:01Z")
        page = self._request("/releases?workspaceRoot=/workspace/releases")
        record = page["data"]["records"][0]
        self.assertEqual(record["releaseId"], "release:one")
        self.assertEqual(record["projectSnapshot"], snapshot_digest)
        self.assertEqual(record["classification"], "internal")
        self.assertEqual(record["attemptOutcome"], "accepted")
        self.assertEqual(record["outputArtifactVersions"], [{
            "artifactVersionId": "artifact-version:release:one",
            "contentDigest": f"sha256:{'ab12' * 16}",
            "artifactId": "artifact:release:one",
            "mediaType": "application/pdf",
        }])
        self.assertEqual(record["auditRefs"], ["audit-digest:release:one"])
        self.assertEqual(record["decisionRefs"], ["decision:release:one"])
        self.assertEqual(record["approvalRefs"], ["approval:release:one"])
        self.assertNotIn("output_artifacts", record)
        self.assertNotIn("project_key", record)

    def test_restricted_project_pages_fail_closed(self) -> None:
        project = "path:/workspace/restricted-ports"
        _insert_snapshot(self.actors.api, project, restricted=True)
        _insert_decision(self.actors.api, project, "decision:secret",
                         "2026-10-26T00:00:00Z")
        page = self._request(
            "/decisions?workspaceRoot=/workspace/restricted-ports")
        record = page["data"]["records"][0]
        self.assertEqual(set(record), {"idHash", "exists", "accessLevel"})
        self.assertEqual(record["accessLevel"], "restricted")
        self.assertNotIn("rationale", json.dumps(page["data"]))

    def test_routes_require_bearer_token(self) -> None:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}"
            "/decisions?workspaceRoot=/workspace/approvals")
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class GovernanceReadPortIsolationTests(unittest.TestCase):
    """Negative pack: cross-project boundaries and zero-write guarantees."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.sessions = os.path.join(self.root, "threads")
        os.makedirs(self.sessions)
        # macOS: tempfile yields /var/folders/... which is a symlink into
        # /private/var/folders/...; realpath above pins one canonical spelling
        # so before/after file-byte hashes compare the same inode and path.
        self.db_path = os.path.realpath(
            os.path.join(self.root, "project.db"))
        self.actors = RuntimeActors.create(self.db_path, self.sessions)
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

    def _request(self, path: str) -> dict:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            headers={"Authorization": "Bearer test-token"},
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read())

    def _request_raw(self, path: str) -> tuple[int, dict]:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            headers={"Authorization": "Bearer test-token"},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    @staticmethod
    def _db_fingerprint(db_path: str) -> str:
        digest = hashlib.sha256()
        for candidate in (db_path, f"{db_path}-wal"):
            digest.update(candidate.encode("utf-8"))
            if os.path.exists(candidate):
                with open(candidate, "rb") as handle:
                    digest.update(handle.read())
        return digest.hexdigest()

    def test_two_project_isolation_pages_never_leak_across_workspaces(self) -> None:
        project_a = "path:/workspace/iso-a"
        project_b = "path:/workspace/iso-b"
        _insert_snapshot(self.actors.api, project_a)
        _insert_snapshot(self.actors.api, project_b)
        for index in range(3):
            _insert_decision(self.actors.api, project_a, f"decision:a-{index}",
                             f"2026-10-26T00:00:0{index}Z")
            _insert_decision(self.actors.api, project_b, f"decision:b-{index}",
                             f"2026-10-26T00:00:0{index}Z")

        for workspace, expected in (
                ("/workspace/iso-a", [f"decision:a-{i}" for i in (2, 1, 0)]),
                ("/workspace/iso-b", [f"decision:b-{i}" for i in (2, 1, 0)])):
            page = self._request(
                f"/decisions?workspaceRoot={workspace}&limit=10")
            self.assertEqual(
                [r["decisionId"] for r in page["data"]["records"]], expected)
            self.assertIsNone(page["data"]["nextCursor"])
            serialized = json.dumps(page["data"])
            foreign = "iso-b" if workspace.endswith("iso-a") else "iso-a"
            self.assertNotIn(f"decision:{foreign[-1]}-", serialized)

    def test_well_formed_other_project_cursor_is_a_bad_request(self) -> None:
        project_a = "path:/workspace/cursor-a"
        project_b = "path:/workspace/cursor-b"
        _insert_snapshot(self.actors.api, project_a)
        _insert_snapshot(self.actors.api, project_b)
        _insert_decision(self.actors.api, project_b, "decision:b-owned",
                         "2026-10-26T00:00:00Z")
        status, body = self._request_raw(
            "/decisions?workspaceRoot=/workspace/cursor-a"
            "&cursor=decision:b-owned")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "BAD_REQUEST")
        self.assertIn("cursor", body["error"]["message"])

    def test_read_ports_leave_the_database_file_bytes_unchanged(self) -> None:
        project = "path:/workspace/zero-write"
        _insert_snapshot(self.actors.api, project)
        for index in range(3):
            _insert_decision(self.actors.api, project, f"decision:{index}",
                             f"2026-10-26T00:00:0{index}Z")
        _insert_release(self.actors.api, project, "release:one",
                        self.actors.api.workflow.latest_snapshot(project)["digest"],
                        "2026-10-26T00:00:03Z")
        # Fold any committed frames into the main database file so the WAL
        # cannot mask writes during the read trio.
        for engine in (self.actors.api, self.actors.update, self.actors.audit):
            engine.store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

        before = self._db_fingerprint(self.db_path)
        for route in ("decisions", "approvals", "releases"):
            response = self._request(
                f"/{route}?workspaceRoot=/workspace/zero-write&limit=10")
            self.assertTrue(response["ok"])
        after = self._db_fingerprint(self.db_path)
        self.assertEqual(before, after)
