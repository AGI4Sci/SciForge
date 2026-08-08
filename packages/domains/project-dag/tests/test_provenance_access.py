"""Access-policy regression tests for the cross-layer provenance resolver."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

from evidence_dag import provjson
from evidence_dag.snapshot import compute_snapshot_digest, snapshot_filename

from project_dag.provenance import ProvenanceResolver, _is_restricted_policy, _restriction
from project_dag.reader import SessionReader
from project_dag.service import Engine
from project_dag.contracts import digest_json


EVIDENCE_DIGEST = "sha256:" + "b" * 64
CONTENT_DIGEST = "sha256:" + "c" * 64
ANCHOR_DIGEST = "sha256:" + "d" * 64
PROJECT_KEY = "path:/caller-provided-project"
CLAIM_ID = "claim:" + "1" * 24
SESSION_CLAIM_ID = "claim:" + "2" * 24
ASSERTION_ID = "source_assertion:" + "3" * 24
THREAD_ID = "restricted-session-name"
ARTIFACT_ID = "artifact:restricted-original"
VERSION_ID = "artifact-version:restricted-v7"
ANCHOR_ID = "anchor:restricted-table"
RUN_ID = "workflow-run:mixed-access"
TOOL_ID = "tool-invocation:mixed-access"


def _evidence_doc(*, artifact_policy=None, anchor_policy=None,
                  assertion_policy=None) -> dict:
    assertion_attributes = {}
    if assertion_policy is not None:
        assertion_attributes["accessPolicy"] = assertion_policy
    return {
        "prefix": {},
        "entity": {
            ASSERTION_ID: {
                "prov:type": "edag:source_assertion",
                "edag:content": "SENSITIVE SOURCE EXCERPT",
                "edag:status": "supported",
                "edag:artifact_id": ARTIFACT_ID,
                "edag:artifact_version_id": VERSION_ID,
                "edag:source_anchor_id": ANCHOR_ID,
                "edag:attributes": assertion_attributes,
                "edag:run": {
                    "inputs": ["SENSITIVE INPUT DATASET"],
                    "software": "SENSITIVE GIT COMMIT",
                    "parameters": {"secret_seed": 947},
                    "environment": "SENSITIVE CLUSTER",
                    "outputs": ["SENSITIVE RESULT FILE"],
                    "accessPolicy": {"read": False, "principals": ["private-runner"]},
                },
            },
            SESSION_CLAIM_ID: {
                "prov:type": "edag:claim",
                "edag:content": "SENSITIVE SESSION CLAIM",
                "edag:status": "supported",
            },
        },
        "wasInfluencedBy": {
            "edge:private-support": {
                "prov:influencee": SESSION_CLAIM_ID,
                "prov:influencer": ASSERTION_ID,
                "edag:rel": "supports",
            },
        },
        "activity": {}, "agent": {}, "used": {}, "wasGeneratedBy": {},
        "wasDerivedFrom": {}, "wasAssociatedWith": {}, "wasAttributedTo": {},
        "edag:meta": {
            "thread_id": THREAD_ID,
            "snapshot": {
                "threadId": THREAD_ID,
                "version": 7,
                "digest": EVIDENCE_DIGEST,
                "inputWatermark": "turn:secret-77",
                "schemaVersion": "evidence.v2",
                "extractorVersion": "extractor.v2",
                "verifierVersion": "verifier.v2",
                "artifactDigests": [CONTENT_DIGEST],
                "createdAt": "2026-07-10T00:00:00Z",
                "status": "committed",
            },
        },
        "edag:artifactRegistry": {
            "artifacts": [{
                "artifactId": ARTIFACT_ID,
                "kind": "dataset",
                "createdAt": "2026-07-10T00:00:00Z",
                "currentVersionId": VERSION_ID,
                "accessPolicy": artifact_policy or {"read": True},
            }],
            "artifactVersions": [{
                "versionId": VERSION_ID,
                "artifactId": ARTIFACT_ID,
                "locator": "private/data/participant-identifiers.csv",
                "contentDigest": CONTENT_DIGEST,
                "version": "SENSITIVE RELEASE LABEL",
                "size": 1042,
                "mediaType": "text/csv",
                "observedAt": "2026-07-10T00:00:00Z",
                "availability": "restricted" if artifact_policy else "available",
                "retention": "reference",
                "historicalLocators": ["private/old-participant-identifiers.csv"],
                "rebindCandidates": ["private/candidate-participant-identifiers.csv"],
                "supersedes": None,
            }],
            "sourceAnchors": [{
                "anchorId": ANCHOR_ID,
                "artifactId": ARTIFACT_ID,
                "artifactVersionId": VERSION_ID,
                "selector": {
                    "type": "dataset",
                    "rowRange": "120:180",
                    "columnNames": ["participant_name", "diagnosis"],
                    "quote": "SENSITIVE PARTICIPANT ROW",
                    "query": {"patient": "SENSITIVE PERSON"},
                },
                "anchorDigest": ANCHOR_DIGEST,
                "createdAt": "2026-07-10T00:00:00Z",
                "accessPolicy": anchor_policy or {"read": True},
            }],
        },
        "edag:assessments": [],
    }


def _project_payload(*, graph_policy=None, claim_policy=None) -> dict:
    claim = {
        "id": CLAIM_ID,
        "project_key": PROJECT_KEY,
        "statement": "SENSITIVE PROJECT CLAIM",
        "status": "supported",
        "scope": "SENSITIVE COHORT",
    }
    if claim_policy is not None:
        claim["accessPolicy"] = claim_policy
    graph = {
        "claims": [claim],
        "evidence": [{
            "id": "evidence:restricted-project-support",
            "project_key": PROJECT_KEY,
            "thread_id": THREAD_ID,
            "snapshot_digest": EVIDENCE_DIGEST,
            "node_id": ASSERTION_ID,
        }],
        "origins": [{
            "claim_id": CLAIM_ID,
            "session_id": THREAD_ID,
            "node_id": SESSION_CLAIM_ID,
        }],
        "edges": [{
            "id": "edge:restricted-project-support",
            "src": "evidence:restricted-project-support",
            "dst": CLAIM_ID,
            "edge_type": "supports",
            "meta": json.dumps({
                "session": THREAD_ID,
                "privateRun": "SENSITIVE PROJECT RUN ID",
            }),
            "t_invalid": None,
        }, {
            "id": "edge:SENSITIVE CONTRADICTION ID",
            "src": CLAIM_ID,
            "dst": "claim:other",
            "edge_type": "contradicts",
            "meta": "{}",
            "t_invalid": None,
        }],
        "goals": [], "entities": [], "decisions": [],
    }
    if graph_policy is not None:
        graph["accessPolicy"] = graph_policy
    return {
        "projectKey": PROJECT_KEY,
        "version": 1,
        "digest": "",
        "goalVersion": "goal:test",
        "policyVersion": 1,
        "evidenceVector": [{"threadId": THREAD_ID, "digest": EVIDENCE_DIGEST}],
        "excludedSessions": [], "isolatedSessions": [],
        "compilerVersion": "project-compiler.v2",
        "createdAt": "2026-07-10T00:00:00Z",
        "status": "committed",
        "graph": graph,
        "assessments": [{
            "target_id": CLAIM_ID,
            "level": "A2",
            "details": {"rationale": "SENSITIVE ASSESSMENT RATIONALE"},
        }],
    }


def _with_global_project_canaries(project: dict, *, empty_claims: bool = False) -> dict:
    graph = project["graph"]
    graph["accessPolicy"] = {
        "classification": "restricted", "allowedRoles": ["TOP-SECRET-GRAPH-ROLE"],
    }
    graph["scope"] = {
        "accessPolicy": {"read": False},
        "includedSessions": ["TOP-SECRET-SCOPE-SESSION"],
    }
    graph["goals"] = [{
        "root_id": "goal:TOP-SECRET-GOAL-ID",
        "title": "TOP-SECRET-GOAL-TITLE",
        "description": "TOP-SECRET-GOAL-DESCRIPTION",
        "status": "active",
    }]
    graph["humanReviews"] = [{
        "id": "review:TOP-SECRET-REVIEW-ID",
        "status": "pending",
        "rationale": "TOP-SECRET-REVIEW-RATIONALE",
    }]
    graph["reviewPackets"] = [{
        "id": "review-packet:TOP-SECRET-PACKET-ID",
        "status": "pending",
        "summary": "TOP-SECRET-REVIEW-PACKET",
    }]
    graph["decisions"] = [{
        "id": "decision:TOP-SECRET-DECISION-ID",
        "status": "approved",
        "rationale": "TOP-SECRET-DECISION-RATIONALE",
    }]
    graph["meta"] = {"debug": "TOP-SECRET-GRAPH-META"}
    project["scope"] = {
        "accessPolicy": {"visibility": "confidential"},
        "workspace": "TOP-SECRET-PROJECT-SCOPE",
    }
    project["humanReview"] = {
        "gateStatus": "pending", "reviewPackets": graph["reviewPackets"],
    }
    if empty_claims:
        graph["claims"] = []
        graph["origins"] = []
    return project


class ProvenanceAccessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.engine = Engine(
            os.path.join(self.tmp.name, "project.db"), self.sessions,
            judge=lambda *_args, **_kwargs: {},
        )
        self.store = self.engine.store

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def _install(self, evidence: dict, project: dict) -> None:
        evidence_digest = self._install_evidence_only(evidence)
        project["evidenceVector"][0]["digest"] = evidence_digest
        project["graph"]["evidence"][0]["snapshot_digest"] = evidence_digest
        unsigned_project = dict(project)
        unsigned_project.pop("digest", None)
        project_digest = digest_json(unsigned_project, "project")
        project["digest"] = project_digest
        self.project_digest = project_digest
        self.store.x(
            "INSERT INTO project_snapshot (project_key,version,digest,goal_version,policy_version,"
            "evidence_vector,excluded_sessions,isolated_sessions,compiler_version,created_at,"
            "status,payload) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (PROJECT_KEY, 1, project_digest, "goal:test", 1,
             json.dumps(project["evidenceVector"]), "[]", "[]", "project-compiler.v2",
             "2026-07-10T00:00:00Z", json.dumps(project)),
        )
        self.store.conn.commit()

    def _install_evidence_only(self, evidence: dict) -> str:
        header = evidence["edag:meta"]["snapshot"]
        graph = provjson.from_prov_json(evidence)
        evidence_digest = compute_snapshot_digest(
            graph,
            input_watermark=header["inputWatermark"],
            schema_version=header["schemaVersion"],
            extractor_version=header["extractorVersion"],
            verifier_version=header["verifierVersion"],
        )
        header["digest"] = evidence_digest
        with open(os.path.join(self.sessions, snapshot_filename(THREAD_ID)), "w",
                  encoding="utf-8") as handle:
            json.dump(evidence, handle)
        return evidence_digest

    def _resolve(self, authorizer=None) -> dict:
        return ProvenanceResolver(
            self.store, SessionReader(self.sessions), authorizer=authorizer,
        ).resolve(CLAIM_ID, self.project_digest)

    def test_access_policy_matrix_is_explicit_and_fail_closed(self):
        public = [
            None, "", {}, [], "public", "open", "unrestricted",
            {"read": True}, {"public": True}, {"visibility": "public"},
            {"classification": "open"},
            {"read": True, "public": True, "restricted": False},
        ]
        restricted = [
            True, False, 1, 0, ["public"], [True],
            {"read": False}, {"public": False}, {"restricted": True},
            {"read": {"allowed": True}}, {"classification": "tenant"},
            {"read": True, "tenantAcl": ["alice"]},
            {"read": True, "principals": []},
            {"read": True, "allowed_roles": ["researcher"]},
            {"restricted": False}, {"unknown": None},
            {"read": True, "r_e-a_d": False},
        ]
        for policy in public:
            with self.subTest(public=policy):
                self.assertFalse(_is_restricted_policy(policy))
        for policy in restricted:
            with self.subTest(restricted=policy):
                self.assertTrue(_is_restricted_policy(policy))
        for value in (
            {
                "accessPolicy": None,
                "edag:attributes": {"accessPolicy": {"read": False}},
            },
            {
                "accessPolicy": {"read": True},
                "attributes": {"accessPolicy": {"tenantAcl": ["alice"]}},
            },
            {
                "attributes": {"accessPolicy": {"read": True}},
                "edag:attributes": {"accessPolicy": {"read": False}},
            },
        ):
            with self.subTest(shadowed=value):
                self.assertIsNotNone(_restriction("test", "subject", value))

    def _install_restricted_read_canaries(self) -> tuple[dict, str]:
        receipt = self.engine.workflow.enqueue_update(
            project_key=PROJECT_KEY,
            evidence_vector=[{
                "threadId": THREAD_ID,
                "digest": self.engine.workflow.latest_snapshot(
                    PROJECT_KEY)["evidenceVector"][0]["digest"],
            }],
            captured_scope={
                "includedSessions": [THREAD_ID],
                "excludedSessions": ["TOP-SECRET-JOB-EXCLUDED"],
                "isolatedSessions": ["TOP-SECRET-JOB-ISOLATED"],
            },
            reason="TOP-SECRET-JOB-REASON",
        )
        timestamp = "2026-08-07T00:00:00Z"
        audit_id = "audit:TOP-SECRET-AUDIT-ID"
        self.store.x(
            "UPDATE project_update_job SET last_error=? WHERE id=?",
            ("TOP-SECRET-JOB-ERROR", receipt["jobId"]),
        )
        self.store.x(
            "UPDATE project_update_receipt SET last_error=? WHERE job_id=?",
            ("TOP-SECRET-RECEIPT-ERROR", receipt["jobId"]),
        )
        self.store.x(
            "INSERT INTO goal"
            " (id,root_id,parent_id,title,description,status,version,project_key,t_created)"
            " VALUES (?,?,?,?,?,'open',1,?,?)",
            (
                "goal-version:TOP-SECRET-GOAL-VERSION",
                "goal:TOP-SECRET-DATABASE-GOAL", None,
                "TOP-SECRET-DATABASE-GOAL-TITLE",
                "TOP-SECRET-DATABASE-GOAL-DESCRIPTION", PROJECT_KEY, timestamp,
            ),
        )
        self.store.x(
            "INSERT INTO finding"
            " (id,project_key,target_digest,finding_type,subject_id,policy_version,severity,"
            "status,details,created_at) VALUES (?,?,?,?,?,1,'critical','open',?,?)",
            (
                "finding:TOP-SECRET-FINDING-ID", PROJECT_KEY, self.project_digest,
                "TOP-SECRET-FINDING-TYPE", "claim:TOP-SECRET-FINDING-SUBJECT",
                json.dumps({"reason": "TOP-SECRET-FINDING-DETAIL"}), timestamp,
            ),
        )
        self.store.x(
            "INSERT INTO review"
            " (id,project_key,finding_id,subject_id,review_type,checkpoint,status,payload,"
            "created_at) VALUES (?,?,?,?,?,?,'open',?,?)",
            (
                "review:TOP-SECRET-DATABASE-REVIEW", PROJECT_KEY,
                "finding:TOP-SECRET-FINDING-ID", "claim:TOP-SECRET-REVIEW-SUBJECT",
                "human_review_packet", "human",
                json.dumps({
                    "id": "review:TOP-SECRET-DATABASE-REVIEW",
                    "snapshotDigest": self.project_digest,
                    "status": "pending", "blocking": True,
                    "rationale": "TOP-SECRET-REVIEW-PAYLOAD",
                }), timestamp,
            ),
        )
        self.store.x(
            "INSERT INTO assessment"
            " (id,project_key,target_id,dimension,level,result,actor,method,details,confidence,"
            "target_digest,created_at)"
            " VALUES (?,?,?,'integrity','A2','failed',?,?,?,0.1,?,?)",
            (
                "assessment:TOP-SECRET-DATABASE-ASSESSMENT", PROJECT_KEY,
                "claim:TOP-SECRET-ASSESSMENT-SUBJECT", "TOP-SECRET-ASSESSMENT-ACTOR",
                "TOP-SECRET-ASSESSMENT-METHOD",
                json.dumps({"rationale": "TOP-SECRET-ASSESSMENT-DETAIL"}),
                self.project_digest, timestamp,
            ),
        )
        self.store.x(
            "INSERT INTO audit_run"
            " (id,request_key,project_key,target_digest,level,policy_version,reason,priority,lane,"
            "autonomy_mode,status,attempts,digest,created_at,updated_at,error)"
            " VALUES (?,?,?,?, 'L2',1,?,7,'P3','checkpointed','failed',2,?,?,?,?)",
            (
                audit_id, "request:TOP-SECRET-AUDIT-REQUEST", PROJECT_KEY,
                self.project_digest, "TOP-SECRET-AUDIT-REASON",
                "audit-digest:TOP-SECRET-AUDIT-DIGEST", timestamp, timestamp,
                "TOP-SECRET-AUDIT-ERROR",
            ),
        )
        self.store.x(
            "INSERT INTO attention_frontier"
            " (project_key,snapshot_digest,subject_id,subject_type,score,factors,blocking,created_at)"
            " VALUES (?,?,?,?,0.99,?,1,?)",
            (
                PROJECT_KEY, self.project_digest,
                "finding:TOP-SECRET-ATTENTION-SUBJECT", "finding",
                json.dumps({"reason": "TOP-SECRET-ATTENTION-FACTORS"}), timestamp,
            ),
        )
        self.store.conn.commit()
        return receipt, audit_id

    def test_restricted_graph_claim_anchor_artifact_and_run_are_fail_closed(self):
        self._install(
            _evidence_doc(
                artifact_policy={"read": False, "principals": ["SENSITIVE ARTIFACT ACL"]},
                # Unknown non-public policy shapes are deliberately fail-closed.
                anchor_policy={"datasetConsent": "SENSITIVE CONSENT TOKEN"},
                assertion_policy={"visibility": "confidential"},
            ),
            _project_payload(
                graph_policy={"classification": "restricted",
                              "allowedRoles": ["SENSITIVE GRAPH ROLE"]},
                claim_policy={"read": False, "principals": ["SENSITIVE CLAIM ACL"]},
            ),
        )

        result = self._resolve()
        serialized = json.dumps(result, ensure_ascii=False)
        for secret in (
            "SENSITIVE PROJECT CLAIM", "SENSITIVE COHORT", THREAD_ID,
            "SENSITIVE SESSION CLAIM", "SENSITIVE SOURCE EXCERPT", ARTIFACT_ID,
            VERSION_ID, ANCHOR_ID, "participant-identifiers.csv", "SENSITIVE RELEASE LABEL",
            "participant_name", "SENSITIVE PARTICIPANT ROW", "SENSITIVE PERSON",
            "SENSITIVE INPUT DATASET", "SENSITIVE GIT COMMIT", "secret_seed",
            "SENSITIVE CLUSTER", "SENSITIVE RESULT FILE", "SENSITIVE ARTIFACT ACL",
            "SENSITIVE CONSENT TOKEN", "SENSITIVE GRAPH ROLE", "SENSITIVE CLAIM ACL",
        ):
            self.assertNotIn(secret, serialized)

        self.assertEqual(result["provenanceLevel"], "L4")
        self.assertTrue(result["reachesArtifact"])
        self.assertEqual(result["access"], {
            "level": "restricted", "redacted": True, "authorized": False,
        })
        self.assertEqual(
            set(result["claim"]),
            {"id", "project_key", "contentDigest", "exists", "accessLevel"},
        )
        self.assertNotIn("threadId", result["evidenceVector"][0])
        path = result["paths"][0]
        self.assertNotIn("threadId", path)
        assertion = path["sourceAssertions"][0]
        self.assertNotIn("content", assertion)
        self.assertEqual(assertion["artifact"]["contentDigest"], CONTENT_DIGEST)
        self.assertEqual(assertion["sourceAnchor"]["contentDigest"], ANCHOR_DIGEST)
        self.assertTrue(assertion["artifact"]["exists"])
        self.assertEqual(assertion["level"], "L4")
        restricted_types = {
            item["subjectType"] for item in result["breakpoints"]
            if item["reason"] == "access_restricted"
        }
        self.assertTrue({
            "project_graph", "project_claim", "source_assertion", "artifact",
            "source_anchor", "run",
        }.issubset(restricted_types))
        self.assertEqual(result["rerunSpecs"], [])
        self.assertEqual(len(result["rerunSpecReferences"]), 1)
        rerun_ref = result["rerunSpecReferences"][0]
        self.assertEqual(set(rerun_ref), {
            "threadHash", "snapshotDigest", "conclusionHash", "specDigest", "accessLevel",
        })
        self.assertEqual(rerun_ref["accessLevel"], "restricted")
        self.assertNotIn("executionReady", rerun_ref)

    def test_restricted_artifact_redacts_the_entire_assertion_path_only(self):
        self._install(
            _evidence_doc(artifact_policy={"read": False}),
            _project_payload(),
        )
        result = self._resolve()

        self.assertEqual(result["claim"]["statement"], "SENSITIVE PROJECT CLAIM")
        self.assertEqual(result["access"], {
            "level": "restricted", "redacted": True, "authorized": False,
        })
        assertion = result["paths"][0]["sourceAssertions"][0]
        self.assertNotIn("content", assertion)
        self.assertNotIn("locator", json.dumps(assertion))
        self.assertNotIn("selector", json.dumps(assertion))
        self.assertNotIn("inputs", json.dumps(assertion))
        self.assertEqual(assertion["artifact"]["contentDigest"], CONTENT_DIGEST)
        self.assertTrue(any(
            item.get("reason") == "access_restricted"
            and item.get("subjectType") == "artifact"
            for item in result["breakpoints"]
        ))

    def test_restricted_execution_closure_replaces_previously_public_source_path(self):
        evidence = _evidence_doc()
        assertion = evidence["entity"][ASSERTION_ID]
        assertion["edag:run"] = {
            "inputs": ["PUBLIC SOURCE INPUT"],
            "software": "PUBLIC SOURCE SOFTWARE",
            "parameters": {"parameterCanary": "SOURCE_PATH_PARAMETER_CANARY"},
            "environment": "PUBLIC SOURCE ENVIRONMENT",
            "outputs": ["PUBLIC SOURCE OUTPUT"],
            "executor": {"target": "SOURCE_PATH_EXECUTOR_CANARY"},
        }
        # This creates a source-resolution breakpoint while the path is still
        # public. The later restricted execution closure must replace both.
        evidence["edag:artifactRegistry"]["sourceAnchors"][0].pop("anchorDigest")
        evidence["activity"] = {
            RUN_ID: {
                "prov:type": "edag:workflow_run",
                "edag:content": "RESTRICTED RUN CANARY",
                "edag:status": "supported",
                "edag:attributes": {
                    "accessPolicy": {"read": False, "principals": ["PRIVATE RUNNER"]},
                    "executor": {"target": "RESTRICTED_EXECUTOR_CANARY"},
                    "parameters": {"value": "RESTRICTED_PARAMETER_CANARY"},
                },
            },
            TOOL_ID: {
                "prov:type": "edag:tool_invocation",
                "edag:content": "RESTRICTED TOOL CANARY",
                "edag:status": "supported",
                "edag:attributes": {
                    "accessPolicy": {"classification": "restricted"},
                    "arguments": {"value": "RESTRICTED_TOOL_ARGUMENT_CANARY"},
                },
            },
        }
        evidence["wasInfluencedBy"].update({
            "edge:mixed-generated-by": {
                "prov:influencee": RUN_ID,
                "prov:influencer": ASSERTION_ID,
                "edag:rel": "generated_by",
            },
            "edge:mixed-tool-part-of": {
                "prov:influencee": RUN_ID,
                "prov:influencer": TOOL_ID,
                "edag:rel": "part_of",
            },
        })
        self._install(evidence, _project_payload())

        result = self._resolve()
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertEqual(result["access"], {
            "level": "restricted", "redacted": True, "authorized": False,
        })
        self.assertEqual(result["rerunSpecs"], [])
        path = result["paths"][0]
        self.assertEqual(path["accessLevel"], "restricted")
        self.assertEqual(set(path), {
            "originHash", "evidenceSnapshot", "sessionClaimHash",
            "sourceAssertions", "level", "exists", "accessLevel",
        })
        self.assertNotIn("threadId", path)
        self.assertNotIn("sessionClaimId", path)
        self.assertNotIn("rerunSpecReference", path)
        safe_assertion = path["sourceAssertions"][0]
        self.assertEqual(safe_assertion["accessLevel"], "restricted")
        self.assertEqual(set(safe_assertion), {
            "sourceAssertionHash", "artifact", "artifactVersion", "sourceAnchor",
            "run", "level", "sessionPath", "exists", "accessLevel",
        })
        restricted_projection = json.dumps({
            "paths": result["paths"],
            "breakpoints": result["breakpoints"],
            "lineageGraph": result["lineageGraph"],
            "rerunSpecReferences": result["rerunSpecReferences"],
        }, ensure_ascii=False)
        for canary in (
            THREAD_ID, ASSERTION_ID, RUN_ID, TOOL_ID,
            "private/data/participant-identifiers.csv",
            "SOURCE_PATH_EXECUTOR_CANARY", "SOURCE_PATH_PARAMETER_CANARY",
            "RESTRICTED_EXECUTOR_CANARY", "RESTRICTED_PARAMETER_CANARY",
            "RESTRICTED_TOOL_ARGUMENT_CANARY", "RESTRICTED RUN CANARY",
            "RESTRICTED TOOL CANARY", "PRIVATE RUNNER",
        ):
            self.assertNotIn(canary, restricted_projection)
        self.assertNotIn("private/data/participant-identifiers.csv", serialized)
        source_breakpoint = next(
            item for item in result["breakpoints"]
            if item["reason"] == "artifact_or_anchor_digest_missing"
        )
        self.assertEqual(set(source_breakpoint), {
            "reason", "subjectHash", "accessLevel",
        })
        self.assertEqual(source_breakpoint["accessLevel"], "restricted")
        for breakpoint in result["breakpoints"]:
            self.assertFalse({
                "threadId", "nodeId", "detail", "message", "activityId",
            }.intersection(breakpoint))

    def test_trusted_authorizer_can_explicitly_release_restricted_objects(self):
        evidence = _evidence_doc(
            artifact_policy={"read": False},
            anchor_policy={"classification": "sensitive"},
            assertion_policy={"visibility": "confidential"},
        )
        # Keep the run restriction, but authorize every evaluated scope.
        self._install(
            evidence,
            _project_payload(
                graph_policy={"classification": "restricted"},
                claim_policy={"read": False},
            ),
        )
        requests = []

        def authorize(request):
            requests.append(request)
            return True

        result = self._resolve(authorizer=authorize)
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertEqual(result["access"], {
            "level": "restricted", "redacted": False, "authorized": True,
        })
        self.assertIn("SENSITIVE PROJECT CLAIM", serialized)
        self.assertIn("private/data/participant-identifiers.csv", serialized)
        self.assertIn("SENSITIVE PARTICIPANT ROW", serialized)
        self.assertIn("SENSITIVE INPUT DATASET", serialized)
        self.assertFalse(any(
            item.get("reason") == "access_restricted" for item in result["breakpoints"]
        ))
        self.assertTrue({
            "project_graph", "project_claim", "source_assertion", "artifact",
            "source_anchor", "run",
        }.issubset({request["subjectType"] for request in requests}))
        self.assertEqual(result["rerunSpecs"][0]["schemaVersion"], "sciforge.rerun.v1")
        self.assertEqual(
            result["rerunSpecReferences"][0]["specDigest"],
            result["rerunSpecs"][0]["specDigest"],
        )

    def test_engine_claim_detail_does_not_reattach_raw_project_graph_fields(self):
        self._install(
            _evidence_doc(
                artifact_policy={"read": False},
                anchor_policy={"classification": "sensitive"},
            ),
            _project_payload(
                graph_policy={"classification": "restricted"},
                claim_policy={"read": False},
            ),
        )

        detail = self.engine.claim_detail(PROJECT_KEY, CLAIM_ID, self.project_digest)
        self.assertIsNotNone(detail)
        serialized = json.dumps(detail, ensure_ascii=False)
        for secret in (
            "SENSITIVE PROJECT CLAIM", "SENSITIVE COHORT", "SENSITIVE PROJECT SUPPORT",
            "SENSITIVE PROJECT SOURCE IDENTITY", "SENSITIVE PROJECT RUN ID", THREAD_ID,
            SESSION_CLAIM_ID, "SENSITIVE CONTRADICTION ID", "SENSITIVE ASSESSMENT RATIONALE",
            "SENSITIVE SOURCE EXCERPT", "participant-identifiers.csv",
            "SENSITIVE PARTICIPANT ROW", "SENSITIVE INPUT DATASET",
        ):
            self.assertNotIn(secret, serialized)
        self.assertEqual(detail["supports"], [])
        self.assertEqual(detail["contradicts"], [])
        self.assertEqual(detail["origins"], [])
        self.assertEqual(detail["assessments"], [])
        self.assertTrue(detail["provenance"]["access"]["redacted"])

    def test_graph_and_claim_list_never_bypass_restricted_projection(self):
        project = _with_global_project_canaries(_project_payload(
            graph_policy={"classification": "restricted",
                          "allowedRoles": ["GRAPH SECRET ROLE"]},
            claim_policy={"read": False, "principals": ["CLAIM SECRET ACL"]},
        ))
        self._install(
            _evidence_doc(
                artifact_policy={"read": False, "principals": ["GRAPH SECRET ACL"]},
                anchor_policy={"classification": "sensitive"},
            ),
            project,
        )

        claims = self.engine.claims(PROJECT_KEY)
        graph = self.engine.graph(PROJECT_KEY)
        analysis = self.engine.analysis(PROJECT_KEY)
        provenance = self.engine.resolve_provenance(
            PROJECT_KEY, CLAIM_ID, self.project_digest)
        serialized = json.dumps({
            "claims": claims, "graph": graph, "analysis": analysis,
            "provenance": provenance,
        }, ensure_ascii=False)
        for secret in (
            "SENSITIVE PROJECT CLAIM", "SENSITIVE COHORT", "SENSITIVE PROJECT RUN ID",
            "SENSITIVE SESSION CLAIM", "SENSITIVE SOURCE EXCERPT", THREAD_ID,
            SESSION_CLAIM_ID, ASSERTION_ID, "participant-identifiers.csv",
            "SENSITIVE ASSESSMENT RATIONALE", "GRAPH SECRET ACL",
            "GRAPH SECRET ROLE", "CLAIM SECRET ACL", "TOP-SECRET",
        ):
            self.assertNotIn(secret, serialized)
        self.assertEqual(set(claims[0]), {
            "idHash", "status", "exists", "accessLevel",
        })
        self.assertEqual(claims[0]["accessLevel"], "restricted")
        self.assertEqual(graph["claims"], claims)
        for collection in (
            "goals", "claims", "evidence", "edges", "origins", "humanReviews",
            "reviewPackets", "decisions", "assessments",
        ):
            for item in graph[collection]:
                self.assertTrue(set(item).issubset({
                    "idHash", "status", "exists", "accessLevel",
                }))
        self.assertNotIn("threadId", graph["snapshot"]["evidenceVector"][0])
        self.assertEqual(graph["access"], {
            "level": "restricted", "redacted": True, "authorized": False,
        })
        self.assertEqual(analysis["summary"], {"n_sources": 0, "n_derived": 1})
        self.assertEqual(analysis["fragile"], [])
        self.assertEqual(analysis["conflicted"], [])
        self.assertTrue(analysis["access"]["redacted"])
        self.assertTrue(provenance["access"]["redacted"])

    def test_global_graph_and_scope_denial_is_safe_when_claims_are_empty(self):
        project = _with_global_project_canaries(_project_payload(), empty_claims=True)
        self._install(_evidence_doc(), project)
        previous_digest = self.project_digest
        latest = json.loads(json.dumps(project))
        latest["version"] = 2
        latest["createdAt"] = "2026-08-07T00:00:01Z"
        latest["graph"]["meta"]["latestCanary"] = "TOP-SECRET-LATEST-SNAPSHOT"
        latest.pop("digest", None)
        latest["digest"] = digest_json(latest, "project")
        self.project_digest = latest["digest"]
        self.store.x(
            "INSERT INTO project_snapshot (project_key,version,digest,goal_version,policy_version,"
            "evidence_vector,excluded_sessions,isolated_sessions,compiler_version,created_at,"
            "status,payload) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (
                PROJECT_KEY, 2, latest["digest"], latest["goalVersion"],
                latest["policyVersion"], json.dumps(latest["evidenceVector"]), "[]", "[]",
                latest["compilerVersion"], latest["createdAt"], json.dumps(latest),
            ),
        )
        self.store.conn.commit()
        receipt, audit_id = self._install_restricted_read_canaries()

        claims = self.engine.claims(PROJECT_KEY)
        graph = self.engine.graph(PROJECT_KEY)
        snapshot = self.engine.snapshot_view(PROJECT_KEY)
        explicit_snapshot = self.engine.snapshot_view(PROJECT_KEY, self.project_digest)
        previous_snapshot = self.engine.snapshot_view(PROJECT_KEY, previous_digest)
        status = self.engine.update_status(PROJECT_KEY)
        history = self.engine.update_history(PROJECT_KEY)
        receipt_status = self.engine.update_receipt_status(
            receipt["jobId"], receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"],
        )
        goals = self.engine.goal_tree(PROJECT_KEY)
        analysis = self.engine.analysis(PROJECT_KEY)
        findings = self.engine.findings(PROJECT_KEY)
        reviews = self.engine.reviews(PROJECT_KEY)
        attention = self.engine.attention(PROJECT_KEY, self.project_digest)
        assessments = self.engine.assessments(PROJECT_KEY, self.project_digest)
        audits = self.engine.audits(PROJECT_KEY)
        audit = self.engine.audit(audit_id)
        serialized = json.dumps(
            {
                "claims": claims, "graph": graph, "snapshot": snapshot,
                "explicitSnapshot": explicit_snapshot,
                "previousSnapshot": previous_snapshot, "status": status,
                "history": history, "receipt": receipt_status, "goals": goals,
                "analysis": analysis, "findings": findings, "reviews": reviews,
                "attention": attention, "assessments": assessments,
                "audits": audits, "audit": audit,
            },
            ensure_ascii=False,
        )

        self.assertEqual(claims, [])
        self.assertNotIn("TOP-SECRET", serialized)
        self.assertNotIn(THREAD_ID, serialized)
        self.assertNotIn("title", serialized)
        self.assertNotIn("description", serialized)
        self.assertEqual(graph["access"]["redacted"], True)
        self.assertEqual(snapshot["access"]["redacted"], True)
        self.assertEqual(status["access"]["redacted"], True)
        self.assertEqual(analysis["access"]["redacted"], True)
        self.assertEqual(set(graph["goals"][0]), {
            "idHash", "status", "exists", "accessLevel",
        })
        self.assertEqual(set(graph["humanReviews"][0]), {
            "idHash", "status", "exists", "accessLevel",
        })
        self.assertEqual(set(graph["decisions"][0]), {
            "idHash", "status", "exists", "accessLevel",
        })
        self.assertEqual(set(graph["meta"]), {
            "idHash", "exists", "accessLevel",
        })
        self.assertNotIn("projectKey", snapshot)
        self.assertNotIn("projectKey", status)
        self.assertIsNotNone(status["previousCommittedSnapshot"])
        self.assertNotIn("projectKey", status["previousCommittedSnapshot"])
        self.assertNotIn("capturedScope", serialized)
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for collection in (
            history, goals, findings, reviews, attention, assessments, audits,
        ):
            self.assertTrue(collection)
            for item in collection:
                self.assertTrue(set(item).issubset(safe_ref_fields))
                self.assertEqual(item["accessLevel"], "restricted")
        for item in (receipt_status, audit):
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")

    def test_current_restriction_revokes_three_explicit_historical_read_paths(self):
        evidence = _evidence_doc()
        evidence["entity"][ASSERTION_ID].pop("edag:run", None)
        project = _project_payload()
        self._install(evidence, project)
        old_digest = self.project_digest

        latest = _with_global_project_canaries(
            json.loads(json.dumps(project)))
        latest["version"] = 2
        latest["createdAt"] = "2026-08-07T00:00:01Z"
        latest.pop("digest", None)
        latest["digest"] = digest_json(latest, "project")
        self.store.x(
            "INSERT INTO project_snapshot (project_key,version,digest,goal_version,policy_version,"
            "evidence_vector,excluded_sessions,isolated_sessions,compiler_version,created_at,"
            "status,payload) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (
                PROJECT_KEY, 2, latest["digest"], latest["goalVersion"],
                latest["policyVersion"], json.dumps(latest["evidenceVector"]), "[]", "[]",
                latest["compilerVersion"], latest["createdAt"], json.dumps(latest),
            ),
        )
        self.store.conn.commit()

        historical_snapshot = self.engine.snapshot_view(PROJECT_KEY, old_digest)
        historical_claim = self.engine.claim_detail(PROJECT_KEY, CLAIM_ID, old_digest)
        historical_provenance = self.engine.resolve_provenance(
            PROJECT_KEY, CLAIM_ID, old_digest)
        serialized = json.dumps({
            "snapshot": historical_snapshot,
            "claim": historical_claim,
            "provenance": historical_provenance,
        }, ensure_ascii=False)

        for canary in (
            "SENSITIVE PROJECT CLAIM", "SENSITIVE COHORT", "SENSITIVE SOURCE EXCERPT",
            THREAD_ID, ASSERTION_ID, SESSION_CLAIM_ID, "TOP-SECRET",
        ):
            self.assertNotIn(canary, serialized)
        self.assertTrue(historical_snapshot["access"]["redacted"])
        self.assertTrue(historical_claim["provenance"]["access"]["redacted"])
        self.assertTrue(historical_provenance["access"]["redacted"])
        self.assertEqual(historical_claim["supports"], [])
        self.assertEqual(historical_provenance["paths"], [])

    def test_first_restricted_update_projects_precommit_receipts_and_mutations(self):
        evidence_digest = self._install_evidence_only(_evidence_doc(
            artifact_policy={
                "read": False, "principals": ["TOP-SECRET-PRECOMMIT-PRINCIPAL"],
            }))
        payload = {
            "projectKey": PROJECT_KEY,
            "evidenceVector": [{"threadId": THREAD_ID, "digest": evidence_digest}],
            "capturedScope": {
                "includedSessions": [THREAD_ID],
                "excludedSessions": ["TOP-SECRET-PRECOMMIT-EXCLUDED"],
                "isolatedSessions": ["TOP-SECRET-PRECOMMIT-ISOLATED"],
            },
            "reason": "TOP-SECRET-PRECOMMIT-REASON",
        }
        enqueue_readback = self.engine.enqueue_update(payload)
        receipt_row = self.store.q1(
            "SELECT job_id,request_version,desired_fingerprint"
            " FROM project_update_receipt WHERE project_key=?",
            (PROJECT_KEY,),
        )
        status = self.engine.update_status(PROJECT_KEY)
        history = self.engine.update_history(PROJECT_KEY)
        graph = self.engine.graph(PROJECT_KEY)
        analysis = self.engine.analysis(PROJECT_KEY)
        receipt = self.engine.update_receipt_status(
            receipt_row["job_id"], receipt_row["request_version"],
            receipt_row["desired_fingerprint"],
        )
        mutation_readback = self.engine.create_goal(
            PROJECT_KEY, "TOP-SECRET-PRECOMMIT-GOAL",
            "TOP-SECRET-PRECOMMIT-GOAL-DESCRIPTION",
        )
        serialized = json.dumps({
            "enqueue": enqueue_readback, "status": status, "history": history,
            "receipt": receipt, "mutation": mutation_readback,
            "graph": graph, "analysis": analysis,
        }, ensure_ascii=False)

        for canary in (
            THREAD_ID, "TOP-SECRET-PRECOMMIT", "SENSITIVE SOURCE EXCERPT",
            "participant-identifiers.csv", "private-runner",
        ):
            self.assertNotIn(canary, serialized)
        self.assertTrue(status["access"]["redacted"])
        self.assertTrue(graph["access"]["redacted"])
        self.assertTrue(analysis["access"]["redacted"])
        self.assertNotIn("threadId", status["desiredEvidenceVector"][0])
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for item in (enqueue_readback, receipt, mutation_readback, *history):
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")

    def test_downstream_artifact_restriction_closes_side_reads_and_write_readbacks(self):
        self._install(
            _evidence_doc(artifact_policy={
                "read": False, "principals": ["TOP-SECRET-DOWNSTREAM-ACL"],
            }),
            _project_payload(),
        )
        receipt, audit_id = self._install_restricted_read_canaries()

        status = self.engine.update_status(PROJECT_KEY)
        history = self.engine.update_history(PROJECT_KEY)
        receipt_status = self.engine.update_receipt_status(
            receipt["jobId"], receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"],
        )
        goals = self.engine.goal_tree(PROJECT_KEY)
        analysis = self.engine.analysis(PROJECT_KEY)
        findings = self.engine.findings(PROJECT_KEY)
        reviews = self.engine.reviews(PROJECT_KEY)
        attention = self.engine.attention(PROJECT_KEY, self.project_digest)
        assessments = self.engine.assessments(PROJECT_KEY, self.project_digest)
        audits = self.engine.audits(PROJECT_KEY)
        audit = self.engine.audit(audit_id)

        vector = self.engine.workflow.latest_snapshot(PROJECT_KEY)["evidenceVector"]
        enqueue_readback = self.engine.enqueue_update({
            "projectKey": PROJECT_KEY,
            "evidenceVector": vector,
            "capturedScope": {
                "includedSessions": [entry["threadId"] for entry in vector],
                "excludedSessions": [], "isolatedSessions": [],
            },
            "reason": "TOP-SECRET-MUTATION-RECEIPT",
        })
        goal_readback = self.engine.create_goal(
            PROJECT_KEY, "TOP-SECRET-MUTATION-GOAL",
            "TOP-SECRET-MUTATION-GOAL-DESCRIPTION")
        audit_readback = self.engine.enqueue_audit({
            "projectKey": PROJECT_KEY, "targetDigest": self.project_digest,
            "level": "L0", "reason": "TOP-SECRET-MUTATION-AUDIT",
        })
        retry_audit_readback = self.engine.retry_audit(audit_id)

        job = self.store.q1(
            "SELECT id,request_version FROM project_update_job WHERE project_key=?",
            (PROJECT_KEY,),
        )
        self.store.x(
            "UPDATE project_update_job SET status='failed',last_error=? WHERE id=?",
            ("TOP-SECRET-MUTATION-RETRY-ERROR", job["id"]),
        )
        self.store.x(
            "UPDATE project_update_receipt SET state='failed',last_error=?"
            " WHERE job_id=? AND request_version=?",
            ("TOP-SECRET-MUTATION-RETRY-RECEIPT", job["id"], job["request_version"]),
        )
        self.store.conn.commit()
        retry_update_readback = self.engine.retry_update(job["id"])

        payload = {
            "status": status, "history": history, "receipt": receipt_status,
            "goals": goals, "analysis": analysis, "findings": findings,
            "reviews": reviews, "attention": attention,
            "assessments": assessments, "audits": audits, "audit": audit,
            "enqueueReadback": enqueue_readback, "goalReadback": goal_readback,
            "auditReadback": audit_readback,
            "retryAuditReadback": retry_audit_readback,
            "retryUpdateReadback": retry_update_readback,
        }
        serialized = json.dumps(payload, ensure_ascii=False)
        for canary in (
            "TOP-SECRET", THREAD_ID, "SENSITIVE PROJECT CLAIM",
            "SENSITIVE SOURCE EXCERPT", "participant-identifiers.csv",
        ):
            self.assertNotIn(canary, serialized)
        self.assertTrue(status["access"]["redacted"])
        self.assertTrue(analysis["access"]["redacted"])
        safe_ref_fields = {"idHash", "status", "exists", "accessLevel"}
        for collection in (
            history, goals, findings, reviews, attention, assessments, audits,
        ):
            self.assertTrue(collection)
            for item in collection:
                self.assertTrue(set(item).issubset(safe_ref_fields))
        for item in (
            receipt_status, audit, enqueue_readback, goal_readback,
            audit_readback, retry_audit_readback, retry_update_readback,
        ):
            self.assertTrue(set(item).issubset(safe_ref_fields))
            self.assertEqual(item["accessLevel"], "restricted")


if __name__ == "__main__":
    unittest.main()
