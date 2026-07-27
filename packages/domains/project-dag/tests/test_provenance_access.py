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

from project_dag.provenance import ProvenanceResolver
from project_dag.reader import SessionReader
from project_dag.service import Engine


PROJECT_DIGEST = "sha256:" + "a" * 64
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
        "digest": PROJECT_DIGEST,
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
        project["evidenceVector"][0]["digest"] = evidence_digest
        project["graph"]["evidence"][0]["snapshot_digest"] = evidence_digest
        with open(os.path.join(self.sessions, snapshot_filename(THREAD_ID)), "w",
                  encoding="utf-8") as handle:
            json.dump(evidence, handle)
        self.store.x(
            "INSERT INTO project_snapshot (project_key,version,digest,goal_version,policy_version,"
            "evidence_vector,excluded_sessions,isolated_sessions,compiler_version,created_at,"
            "status,payload) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
            (PROJECT_KEY, 1, PROJECT_DIGEST, "goal:test", 1,
             json.dumps(project["evidenceVector"]), "[]", "[]", "project-compiler.v2",
             "2026-07-10T00:00:00Z", json.dumps(project)),
        )
        self.store.conn.commit()

    def _resolve(self, authorizer=None) -> dict:
        return ProvenanceResolver(
            self.store, SessionReader(self.sessions), authorizer=authorizer,
        ).resolve(CLAIM_ID, PROJECT_DIGEST)

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

        detail = self.engine.claim_detail(PROJECT_KEY, CLAIM_ID, PROJECT_DIGEST)
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


if __name__ == "__main__":
    unittest.main()
